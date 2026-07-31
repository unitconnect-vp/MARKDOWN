import { app, BrowserWindow, dialog, ipcMain, shell, nativeTheme, clipboard } from 'electron';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { registerScheme, handleProtocol, allowRoot, toAssetUrl } from './assets.mjs';
import { settings, recentFiles } from './store.mjs';
import { buildMenu } from './menu.mjs';
import { exportHtml, exportPdf } from './exporter.mjs';

const __dirname_ = path.dirname(fileURLToPath(import.meta.url));
/** dist/ 폴더 (dist/main/index.js 기준 상위) */
const DIST_DIR = path.resolve(__dirname_, '..');
const APP_ROOT = path.resolve(DIST_DIR, '..');
const RENDERER_HTML = path.join(DIST_DIR, 'renderer', 'index.html');
/** 샘플 문서: 패키징 시에는 asar 밖(resources/samples)에 놓인다. */
const SAMPLES_DIR = app.isPackaged
  ? path.join(process.resourcesPath, 'samples')
  : path.join(APP_ROOT, 'samples');

const MD_FILTERS = [
  { name: '마크다운 문서', extensions: ['md', 'markdown', 'mdx', 'mkd', 'mdown', 'txt'] },
  { name: '모든 파일', extensions: ['*'] },
];

/** @type {BrowserWindow|null} */
let mainWindow = null;
/** 렌더러가 준비되기 전에 들어온 열기 요청 큐. */
const pendingOpens = [];
let rendererReady = false;
/** path -> fs.FSWatcher */
const watchers = new Map();

registerScheme();

// ---------------------------------------------------------------------------
// 유틸
// ---------------------------------------------------------------------------

/** argv 에서 마크다운 파일 경로를 추출 (탐색기에서 더블클릭 / "연결 프로그램"). */
function fileFromArgv(argv) {
  const args = argv.slice(app.isPackaged ? 1 : 2);
  for (const arg of args) {
    if (arg.startsWith('-')) continue;
    try {
      if (fs.existsSync(arg) && fs.statSync(arg).isFile()) return path.resolve(arg);
    } catch {
      /* 무시 */
    }
  }
  return null;
}

function sendToRenderer(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, payload);
}

function requestOpen(filePath) {
  if (!filePath) return;
  if (!rendererReady) {
    pendingOpens.push(filePath);
    return;
  }
  sendToRenderer('file:open-path', filePath);
}

/** BOM 제거 + CRLF 유지 여부 판단. */
function decodeText(buffer) {
  let text = buffer.toString('utf8');
  let bom = false;
  if (text.charCodeAt(0) === 0xfeff) {
    text = text.slice(1);
    bom = true;
  }
  const crlf = /\r\n/.test(text);
  return { text: text.replace(/\r\n/g, '\n'), bom, crlf };
}

function encodeText(text, { bom = false, crlf = false } = {}) {
  let out = crlf ? text.replace(/\n/g, '\r\n') : text;
  if (bom) out = '﻿' + out;
  return Buffer.from(out, 'utf8');
}

async function readDocument(filePath) {
  const absolute = path.resolve(filePath);
  const buffer = await fsp.readFile(absolute);
  const { text, bom, crlf } = decodeText(buffer);
  const dir = path.dirname(absolute);
  allowRoot(dir);
  recentFiles.add(absolute);
  refreshMenu();
  watchDocument(absolute);
  const stat = await fsp.stat(absolute);
  return { path: absolute, name: path.basename(absolute), dir, text, bom, crlf, mtimeMs: stat.mtimeMs };
}

function watchDocument(filePath) {
  if (watchers.has(filePath)) return;
  try {
    let debounce = null;
    const watcher = fs.watch(filePath, () => {
      clearTimeout(debounce);
      debounce = setTimeout(() => sendToRenderer('file:changed', filePath), 250);
    });
    watcher.on('error', () => {});
    watchers.set(filePath, watcher);
  } catch {
    /* 감시 실패는 치명적이지 않다 */
  }
}

function unwatchDocument(filePath) {
  const watcher = watchers.get(filePath);
  if (watcher) {
    try {
      watcher.close();
    } catch {
      /* 무시 */
    }
    watchers.delete(filePath);
  }
}

function refreshMenu() {
  buildMenu(
    (cmd) => sendToRenderer('menu:command', cmd),
    (p) => requestOpen(p),
  );
}

// ---------------------------------------------------------------------------
// 윈도우
// ---------------------------------------------------------------------------

function createWindow() {
  const bounds = settings.get('windowBounds') || {};
  mainWindow = new BrowserWindow({
    width: bounds.width || 1360,
    height: bounds.height || 880,
    x: bounds.x,
    y: bounds.y,
    minWidth: 720,
    minHeight: 480,
    show: false,
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#16181d' : '#ffffff',
    title: 'MarkView',
    icon: path.join(DIST_DIR, 'icon.png'),
    webPreferences: {
      preload: path.join(DIST_DIR, 'preload', 'index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      spellcheck: false,
      webSecurity: true,
    },
  });

  if (bounds.maximized) mainWindow.maximize();

  mainWindow.once('ready-to-show', () => mainWindow.show());
  mainWindow.loadFile(RENDERER_HTML);

  // 외부 링크는 항상 기본 브라우저로.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith('file://')) {
      event.preventDefault();
      if (/^https?:/i.test(url)) shell.openExternal(url);
    }
  });

  const saveBounds = () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    const maximized = mainWindow.isMaximized();
    settings.set('windowBounds', { ...(maximized ? settings.get('windowBounds') || {} : mainWindow.getBounds()), maximized });
  };
  mainWindow.on('resize', saveBounds);
  mainWindow.on('move', saveBounds);

  // 저장하지 않은 문서가 있으면 렌더러에 확인을 위임한다.
  let allowClose = false;
  mainWindow.on('close', (event) => {
    if (allowClose) return;
    event.preventDefault();
    sendToRenderer('app:before-close', null);
    ipcMain.once('app:close-approved', () => {
      allowClose = true;
      settings.flushNow();
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.close();
    });
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
    rendererReady = false;
  });

  nativeTheme.on('updated', () => sendToRenderer('theme:changed', nativeTheme.shouldUseDarkColors ? 'dark' : 'light'));
}

// ---------------------------------------------------------------------------
// IPC
// ---------------------------------------------------------------------------

function registerIpc() {
  ipcMain.handle('app:ready', () => {
    rendererReady = true;
    const queued = pendingOpens.splice(0);
    return {
      version: app.getVersion(),
      name: 'MarkView',
      settings: settings.all(),
      systemTheme: nativeTheme.shouldUseDarkColors ? 'dark' : 'light',
      sampleDir: SAMPLES_DIR,
      openPaths: queued,
      platform: process.platform,
      versions: { electron: process.versions.electron, chrome: process.versions.chrome, node: process.versions.node },
    };
  });

  ipcMain.handle('dialog:open', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: '마크다운 문서 열기',
      filters: MD_FILTERS,
      properties: ['openFile', 'multiSelections'],
    });
    if (result.canceled) return { canceled: true, documents: [] };
    const documents = [];
    for (const p of result.filePaths) {
      try {
        documents.push(await readDocument(p));
      } catch (err) {
        documents.push({ path: p, error: err.message });
      }
    }
    return { canceled: false, documents };
  });

  ipcMain.handle('file:read', async (_e, filePath) => {
    try {
      return { ok: true, document: await readDocument(filePath) };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle('file:write', async (_e, { filePath, text, bom, crlf }) => {
    try {
      const absolute = path.resolve(filePath);
      // 자기 자신이 쓴 변경으로 "외부 변경" 알림이 뜨지 않도록 잠시 감시 해제.
      unwatchDocument(absolute);
      await fsp.mkdir(path.dirname(absolute), { recursive: true });
      await fsp.writeFile(absolute, encodeText(text, { bom, crlf }));
      const stat = await fsp.stat(absolute);
      allowRoot(path.dirname(absolute));
      recentFiles.add(absolute);
      refreshMenu();
      setTimeout(() => watchDocument(absolute), 300);
      return { ok: true, path: absolute, name: path.basename(absolute), dir: path.dirname(absolute), mtimeMs: stat.mtimeMs };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle('dialog:save', async (_e, { defaultPath, filters } = {}) => {
    const result = await dialog.showSaveDialog(mainWindow, {
      title: '다른 이름으로 저장',
      defaultPath: defaultPath || '제목 없음.md',
      filters: filters || MD_FILTERS,
    });
    return { canceled: result.canceled, path: result.filePath || null };
  });

  ipcMain.handle('dialog:confirmDiscard', async (_e, name) => {
    const { response } = await dialog.showMessageBox(mainWindow, {
      type: 'warning',
      buttons: ['저장', '저장 안 함', '취소'],
      defaultId: 0,
      cancelId: 2,
      title: '변경 내용 저장',
      message: `'${name}' 문서에 저장하지 않은 변경 내용이 있습니다.`,
      detail: '저장하지 않으면 변경 내용이 사라집니다.',
      noLink: true,
    });
    return ['save', 'discard', 'cancel'][response];
  });

  ipcMain.handle('dialog:message', async (_e, options) => {
    const { response } = await dialog.showMessageBox(mainWindow, { noLink: true, ...options });
    return response;
  });

  ipcMain.handle('asset:url', (_e, { docDir, href }) => {
    if (!docDir) return href;
    const decoded = decodeURIComponent(String(href).split('#')[0].split('?')[0]);
    const absolute = path.resolve(docDir, decoded);
    allowRoot(docDir);
    return toAssetUrl(absolute);
  });

  ipcMain.handle('path:resolve', (_e, { base, href }) => {
    try {
      const decoded = decodeURIComponent(String(href).split('#')[0]);
      return path.resolve(base || process.cwd(), decoded);
    } catch {
      return null;
    }
  });

  ipcMain.handle('export:run', async (_e, { kind, html, title, docPath, theme }) => {
    const base = docPath ? path.basename(docPath).replace(/\.[^.]+$/, '') : title || '문서';
    const ext = kind === 'pdf' ? 'pdf' : 'html';
    const result = await dialog.showSaveDialog(mainWindow, {
      title: kind === 'pdf' ? 'PDF로 내보내기' : 'HTML로 내보내기',
      defaultPath: path.join(docPath ? path.dirname(docPath) : app.getPath('documents'), `${base}.${ext}`),
      filters: [{ name: ext.toUpperCase(), extensions: [ext] }],
    });
    if (result.canceled || !result.filePath) return { canceled: true };

    try {
      const options = { html, title: title || base, docPath, distDir: DIST_DIR, outPath: result.filePath, theme };
      const outPath = kind === 'pdf' ? await exportPdf(options) : await exportHtml(options);
      return { canceled: false, ok: true, path: outPath };
    } catch (err) {
      return { canceled: false, ok: false, error: err.message };
    }
  });

  ipcMain.handle('clipboard:saveImage', async (_e, { docPath, dataUrl, name }) => {
    try {
      const targetDir = docPath
        ? path.join(path.dirname(docPath), `${path.basename(docPath).replace(/\.[^.]+$/, '')}.assets`)
        : path.join(app.getPath('pictures'), 'MarkView');
      await fsp.mkdir(targetDir, { recursive: true });

      const base64 = String(dataUrl).replace(/^data:[^,]+,/, '');
      const ext = /image\/(\w+)/.exec(dataUrl)?.[1]?.replace('jpeg', 'jpg') || 'png';
      const stamp = new Date().toISOString().replace(/[:.TZ-]/g, '').slice(0, 14);
      const fileName = `${name || 'image'}-${stamp}.${ext}`;
      const outPath = path.join(targetDir, fileName);
      await fsp.writeFile(outPath, Buffer.from(base64, 'base64'));
      allowRoot(path.dirname(outPath));

      const relative = docPath
        ? path.relative(path.dirname(docPath), outPath).split(path.sep).join('/')
        : outPath.split(path.sep).join('/');
      return { ok: true, relative, absolute: outPath };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle('settings:get', () => settings.all());
  ipcMain.handle('settings:set', (_e, patch) => {
    settings.merge(patch || {});
    return settings.all();
  });

  ipcMain.handle('recent:list', () => recentFiles.list());
  ipcMain.handle('recent:clear', () => {
    recentFiles.clear();
    refreshMenu();
    return [];
  });

  ipcMain.handle('shell:openExternal', (_e, url) => {
    if (/^https?:|^mailto:/i.test(url)) return shell.openExternal(url);
    return false;
  });
  ipcMain.handle('shell:showItem', (_e, filePath) => shell.showItemInFolder(filePath));
  ipcMain.handle('clipboard:writeText', (_e, text) => clipboard.writeText(String(text ?? '')));

  ipcMain.on('window:title', (_e, title) => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.setTitle(title || 'MarkView');
  });
  ipcMain.on('window:dirty', (_e, dirty) => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.setDocumentEdited?.(Boolean(dirty));
  });
  ipcMain.on('app:quit', () => app.quit());
}

// ---------------------------------------------------------------------------
// 앱 수명주기
// ---------------------------------------------------------------------------

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', (_e, argv) => {
    const file = fileFromArgv(argv);
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
    if (file) requestOpen(file);
  });

  // macOS: Finder 에서 열기
  app.on('open-file', (event, filePath) => {
    event.preventDefault();
    requestOpen(filePath);
  });

  app.whenReady().then(() => {
    handleProtocol();
    registerIpc();
    refreshMenu();

    // 번들된 샘플 문서는 항상 읽을 수 있게 허용한다.
    allowRoot(SAMPLES_DIR);

    createWindow();

    const initial = fileFromArgv(process.argv);
    if (initial) pendingOpens.push(initial);

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on('window-all-closed', () => {
    for (const [p] of watchers) unwatchDocument(p);
    settings.flushNow();
    if (process.platform !== 'darwin') app.quit();
  });
}
