/**
 * 컨텍스트 브리지: 렌더러에는 아래 화이트리스트 API 만 노출된다.
 * (nodeIntegration 은 꺼져 있고 contextIsolation 은 켜져 있다)
 */
import { contextBridge, ipcRenderer, webUtils } from 'electron';

const listeners = new Map();

function on(channel, callback) {
  const wrapped = (_event, payload) => callback(payload);
  ipcRenderer.on(channel, wrapped);
  listeners.set(callback, { channel, wrapped });
  return () => {
    ipcRenderer.removeListener(channel, wrapped);
    listeners.delete(callback);
  };
}

contextBridge.exposeInMainWorld('markview', {
  // --- 초기화 -------------------------------------------------------------
  ready: () => ipcRenderer.invoke('app:ready'),

  // --- 파일 ---------------------------------------------------------------
  openDialog: () => ipcRenderer.invoke('dialog:open'),
  readFile: (filePath) => ipcRenderer.invoke('file:read', filePath),
  writeFile: (payload) => ipcRenderer.invoke('file:write', payload),
  saveDialog: (payload) => ipcRenderer.invoke('dialog:save', payload),
  confirmDiscard: (name) => ipcRenderer.invoke('dialog:confirmDiscard', name),
  message: (options) => ipcRenderer.invoke('dialog:message', options),

  // --- 경로/에셋 ----------------------------------------------------------
  assetUrl: (docDir, href) => ipcRenderer.invoke('asset:url', { docDir, href }),
  resolvePath: (base, href) => ipcRenderer.invoke('path:resolve', { base, href }),

  // --- 내보내기 -----------------------------------------------------------
  exportDocument: (payload) => ipcRenderer.invoke('export:run', payload),
  saveClipboardImage: (payload) => ipcRenderer.invoke('clipboard:saveImage', payload),

  // --- 설정 / 최근 문서 ---------------------------------------------------
  getSettings: () => ipcRenderer.invoke('settings:get'),
  setSettings: (patch) => ipcRenderer.invoke('settings:set', patch),
  recentList: () => ipcRenderer.invoke('recent:list'),
  recentClear: () => ipcRenderer.invoke('recent:clear'),

  // --- 셸 -----------------------------------------------------------------
  openExternal: (url) => ipcRenderer.invoke('shell:openExternal', url),
  showItemInFolder: (filePath) => ipcRenderer.invoke('shell:showItem', filePath),
  copyText: (text) => ipcRenderer.invoke('clipboard:writeText', text),

  // --- 윈도우 -------------------------------------------------------------
  setTitle: (title) => ipcRenderer.send('window:title', title),
  setDirty: (dirty) => ipcRenderer.send('window:dirty', dirty),
  approveClose: () => ipcRenderer.send('app:close-approved'),
  quit: () => ipcRenderer.send('app:quit'),

  // --- 이벤트 -------------------------------------------------------------
  onMenuCommand: (cb) => on('menu:command', cb),
  onOpenPath: (cb) => on('file:open-path', cb),
  onFileChanged: (cb) => on('file:changed', cb),
  onThemeChanged: (cb) => on('theme:changed', cb),
  onBeforeClose: (cb) => on('app:before-close', cb),
});

/**
 * Electron 32 부터 `File.path` 가 제거되어 드래그앤드롭 파일의 실제 경로는
 * webUtils 를 거쳐야 한다.
 */
contextBridge.exposeInMainWorld('markviewFilePath', (file) => {
  try {
    return webUtils.getPathForFile(file);
  } catch {
    return null;
  }
});
