/**
 * MarkView 렌더러 진입점 — 탭 관리, 편집기/미리보기 연결, 명령 처리.
 */
import './styles/index.css';

import { createEditor } from './editor.mjs';
import { createPreview } from './preview.mjs';
import {
  resolvePath,
  relativePath,
  dirname,
  basename,
  stripExtension,
  normalizeHref,
  isExternalUrl,
  isImageFile,
  isMarkdownFile,
} from '../shared/pathutil.mjs';

const api = window.markview;

const $ = (id) => document.getElementById(id);
const el = {
  app: $('app'),
  tabbar: $('tabbar'),
  editorHost: $('editor'),
  preview: $('preview'),
  previewScroll: $('previewScroll'),
  outlinePane: $('outlinePane'),
  outlineList: $('outlineList'),
  splitter: $('splitter'),
  editorPane: $('editorPane'),
  statusPath: $('statusPath'),
  statusCursor: $('statusCursor'),
  statusCount: $('statusCount'),
  statusRead: $('statusRead'),
  statusZoom: $('statusZoom'),
  statusDiagram: $('statusDiagram'),
  toasts: $('toasts'),
  modalBackdrop: $('modalBackdrop'),
  modalTitle: $('modalTitle'),
  modalBody: $('modalBody'),
  modalClose: $('modalClose'),
};

// ---------------------------------------------------------------------------
// 상태
// ---------------------------------------------------------------------------

const state = {
  docs: [],
  activeId: null,
  settings: {},
  systemTheme: 'light',
  appInfo: {},
  nextId: 1,
  lastRender: null,
  syncing: false,
  closing: false,
};

const WELCOME = `# 환영합니다 👋

**MarkView** 는 Claude 가 만들어 준 마크다운 문서를 그대로, 제대로 보기 위한 편집기입니다.

- \`Ctrl+O\` 로 \`.md\` 파일을 열거나, 창에 파일을 끌어다 놓으세요.
- 왼쪽에서 편집하면 오른쪽 미리보기가 즉시 갱신됩니다.
- 도움말 › **기능 안내 문서 열기** 로 모든 기능을 한 번에 확인할 수 있습니다.
`;

const newDocId = () => `doc-${state.nextId++}`;

const activeDoc = () => state.docs.find((d) => d.id === state.activeId) || null;
const isDirty = (doc) => doc && doc.text !== doc.savedText;

// ---------------------------------------------------------------------------
// 알림
// ---------------------------------------------------------------------------

function toast(message, kind = 'info', ms = 2800) {
  const node = document.createElement('div');
  node.className = `toast ${kind}`;
  node.textContent = message;
  el.toasts.appendChild(node);
  setTimeout(() => {
    node.style.transition = 'opacity 180ms ease';
    node.style.opacity = '0';
    setTimeout(() => node.remove(), 200);
  }, ms);
}

function showModal(title, bodyHtml) {
  el.modalTitle.textContent = title;
  el.modalBody.innerHTML = bodyHtml;
  el.modalBackdrop.hidden = false;
  el.modalClose.focus();
}
el.modalClose.addEventListener('click', () => {
  el.modalBackdrop.hidden = true;
});
el.modalBackdrop.addEventListener('click', (e) => {
  if (e.target === el.modalBackdrop) el.modalBackdrop.hidden = true;
});

// ---------------------------------------------------------------------------
// 테마
// ---------------------------------------------------------------------------

function effectiveTheme() {
  const pref = state.settings.theme || 'system';
  return pref === 'system' ? state.systemTheme : pref;
}

function applyTheme() {
  document.documentElement.dataset.theme = effectiveTheme();
}

// ---------------------------------------------------------------------------
// 에셋 / 링크 해석
// ---------------------------------------------------------------------------

function assetUrlFor(docDir, href) {
  if (!docDir) return href;
  const absolute = resolvePath(docDir, normalizeHref(href));
  return `md-asset://local/asset?p=${encodeURIComponent(absolute)}`;
}

function makeResolvers(doc) {
  const docDir = doc?.dir || null;
  return {
    resolveAsset: (href) => (docDir ? assetUrlFor(docDir, href) : href),
    resolveLink: (href) => href, // 문서 링크는 클릭 시점에 처리
  };
}

// ---------------------------------------------------------------------------
// 편집기 / 미리보기
// ---------------------------------------------------------------------------

let editor;
let preview;
let renderTimer = null;

function scheduleRender(immediate = false) {
  clearTimeout(renderTimer);
  if (immediate) {
    renderPreview();
    return;
  }
  renderTimer = setTimeout(renderPreview, 140);
}

async function renderPreview() {
  const doc = activeDoc();
  if (!doc) return;
  const result = await preview.render(doc.text, {
    theme: effectiveTheme(),
    ...makeResolvers(doc),
  });
  state.lastRender = result;
  renderOutline(result.headings);
  updateStatus(result.stats);
}

// ---------------------------------------------------------------------------
// 탭
// ---------------------------------------------------------------------------

function renderTabs() {
  el.tabbar.textContent = '';
  for (const doc of state.docs) {
    const tab = document.createElement('div');
    tab.className = `tab${doc.id === state.activeId ? ' active' : ''}${isDirty(doc) ? ' dirty' : ''}`;
    tab.title = doc.path || '저장되지 않은 문서';
    tab.dataset.id = doc.id;

    const name = document.createElement('span');
    name.className = 'tab-name';
    name.textContent = doc.name;
    tab.appendChild(name);

    const close = document.createElement('button');
    close.className = 'tab-close';
    close.type = 'button';
    close.title = '닫기 (Ctrl+W)';
    close.addEventListener('click', (e) => {
      e.stopPropagation();
      closeDoc(doc.id);
    });
    tab.appendChild(close);

    tab.addEventListener('click', () => activateDoc(doc.id));
    tab.addEventListener('auxclick', (e) => {
      if (e.button === 1) closeDoc(doc.id);
    });
    el.tabbar.appendChild(tab);
  }

  const add = document.createElement('button');
  add.className = 'tab-new';
  add.type = 'button';
  add.textContent = '+';
  add.title = '새 문서 (Ctrl+N)';
  add.addEventListener('click', () => createDoc());
  el.tabbar.appendChild(add);
}

function stashActive() {
  const doc = activeDoc();
  if (!doc || !editor) return;
  doc.text = editor.getValue();
  doc.selection = editor.getSelection();
  doc.editorScroll = editor.getScrollTop();
  doc.previewScroll = el.previewScroll.scrollTop;
}

/**
 * @param {object} options
 *   force  — 이미 활성 탭이어도 편집기를 다시 채운다
 *   stash  — 현재 편집기 내용을 문서로 되쓸지 여부.
 *            디스크에서 새로 읽어온 직후에는 false 여야 한다(안 그러면 방금 읽은 내용을 덮어쓴다).
 */
function activateDoc(id, { force = false, stash = true } = {}) {
  if (!force && id === state.activeId) return;
  if (stash) stashActive();
  state.activeId = id;
  const doc = activeDoc();
  if (!doc) return;

  editor.replaceAll(doc.text, { selection: doc.selection, scrollTop: doc.editorScroll });
  renderTabs();
  updateWindowTitle();
  scheduleRender(true);
  requestAnimationFrame(() => {
    el.previewScroll.scrollTop = doc.previewScroll || 0;
  });
}

function createDoc(payload = {}) {
  const doc = {
    id: newDocId(),
    path: payload.path || null,
    name: payload.name || '제목 없음.md',
    dir: payload.dir || null,
    text: payload.text ?? '',
    savedText: payload.text ?? '',
    bom: payload.bom ?? false,
    crlf: payload.crlf ?? false,
    mtimeMs: payload.mtimeMs ?? 0,
    selection: { anchor: 0, head: 0 },
    editorScroll: 0,
    previewScroll: 0,
  };
  state.docs.push(doc);
  activateDoc(doc.id, { force: true });
  return doc;
}

async function closeDoc(id) {
  const index = state.docs.findIndex((d) => d.id === id);
  if (index < 0) return true;
  const doc = state.docs[index];
  if (id === state.activeId) stashActive();

  if (isDirty(doc)) {
    const choice = await api.confirmDiscard(doc.name);
    if (choice === 'cancel') return false;
    if (choice === 'save') {
      const saved = await saveDoc(doc);
      if (!saved) return false;
    }
  }

  state.docs.splice(index, 1);
  if (state.docs.length === 0) {
    state.activeId = null;
    createDoc();
    return true;
  }
  if (state.activeId === id) {
    activateDoc(state.docs[Math.max(0, index - 1)].id, { force: true });
  } else {
    renderTabs();
  }
  return true;
}

// ---------------------------------------------------------------------------
// 파일 열기 / 저장
// ---------------------------------------------------------------------------

function adoptDocument(payload) {
  const existing = state.docs.find((d) => d.path && payload.path && d.path === payload.path);
  if (existing) {
    // 이미 열려 있는 문서를 다시 열면 디스크 내용으로 새로고침한다.
    stashActive();
    existing.text = payload.text;
    existing.savedText = payload.text;
    existing.mtimeMs = payload.mtimeMs;
    existing.selection = { anchor: 0, head: 0 };
    activateDoc(existing.id, { force: true, stash: false });
    return existing;
  }

  // 비어 있는 "제목 없음" 탭이 하나뿐이면 그 자리를 재사용한다.
  const current = activeDoc();
  if (state.docs.length === 1 && current && !current.path && current.text.trim() === '') {
    Object.assign(current, {
      path: payload.path,
      name: payload.name,
      dir: payload.dir,
      text: payload.text,
      savedText: payload.text,
      bom: payload.bom,
      crlf: payload.crlf,
      mtimeMs: payload.mtimeMs,
      selection: { anchor: 0, head: 0 },
      editorScroll: 0,
      previewScroll: 0,
    });
    activateDoc(current.id, { force: true, stash: false });
    return current;
  }

  return createDoc(payload);
}

async function openPath(filePath) {
  const result = await api.readFile(filePath);
  if (!result.ok) {
    toast(`파일을 열 수 없습니다: ${result.error}`, 'error', 5000);
    return null;
  }
  const doc = adoptDocument(result.document);
  toast(`${doc.name} 열기 완료`, 'success', 1600);
  return doc;
}

async function openDialog() {
  const result = await api.openDialog();
  if (result.canceled) return;
  for (const document_ of result.documents) {
    if (document_.error) {
      toast(`${document_.path}: ${document_.error}`, 'error', 5000);
      continue;
    }
    adoptDocument(document_);
  }
}

async function saveDoc(doc, { saveAs = false } = {}) {
  if (!doc) return false;
  if (doc.id === state.activeId) stashActive();

  let target = doc.path;
  if (!target || saveAs) {
    const result = await api.saveDialog({ defaultPath: doc.path || doc.name });
    if (result.canceled || !result.path) return false;
    target = result.path;
  }

  const written = await api.writeFile({ filePath: target, text: doc.text, bom: doc.bom, crlf: doc.crlf });
  if (!written.ok) {
    toast(`저장 실패: ${written.error}`, 'error', 5000);
    return false;
  }

  doc.path = written.path;
  doc.name = written.name;
  doc.dir = written.dir;
  doc.mtimeMs = written.mtimeMs;
  doc.savedText = doc.text;
  renderTabs();
  updateWindowTitle();
  if (doc.id === state.activeId) scheduleRender(true); // 상대 경로 기준 갱신
  toast(`저장했습니다 — ${doc.name}`, 'success', 1600);
  return true;
}

// ---------------------------------------------------------------------------
// 아웃라인
// ---------------------------------------------------------------------------

function renderOutline(headings) {
  el.outlineList.textContent = '';
  if (!headings || headings.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'outline-empty';
    empty.textContent = '제목(#)이 없습니다.';
    el.outlineList.appendChild(empty);
    return;
  }
  for (const heading of headings) {
    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'outline-item';
    item.dataset.level = String(heading.level);
    item.dataset.slug = heading.slug;
    item.dataset.line = String(heading.line);
    item.textContent = heading.text;
    item.title = heading.text;
    item.addEventListener('click', () => {
      const target = el.preview.querySelector(`[id="${CSS.escape(heading.slug)}"]`);
      if (target) {
        state.syncing = true;
        target.scrollIntoView({ block: 'start' });
        setTimeout(() => {
          state.syncing = false;
        }, 60);
      }
      editor.setCursorToLine(heading.line);
    });
    el.outlineList.appendChild(item);
  }
  highlightOutline();
}

function highlightOutline() {
  const items = [...el.outlineList.querySelectorAll('.outline-item')];
  if (!items.length) return;
  const top = el.previewScroll.getBoundingClientRect().top + 8;
  let activeSlug = items[0].dataset.slug;
  for (const item of items) {
    const target = el.preview.querySelector(`[id="${CSS.escape(item.dataset.slug)}"]`);
    if (target && target.getBoundingClientRect().top <= top + 24) activeSlug = item.dataset.slug;
  }
  for (const item of items) item.classList.toggle('active', item.dataset.slug === activeSlug);
}

// ---------------------------------------------------------------------------
// 상태바 / 타이틀
// ---------------------------------------------------------------------------

function updateStatus(stats) {
  if (stats) {
    el.statusCount.textContent = `${stats.words.toLocaleString()} 단어 · ${stats.chars.toLocaleString()} 자`;
    el.statusRead.textContent = `읽기 ${stats.readingMinutes}분`;
  }
  const doc = activeDoc();
  el.statusPath.textContent = doc?.path || (doc ? `${doc.name} (저장 안 됨)` : '');
  el.statusPath.title = doc?.path || '';
  el.statusZoom.textContent = `${Math.round((state.settings.previewZoom || 1) * 100)}%`;
}

function updateWindowTitle() {
  const doc = activeDoc();
  const dirty = isDirty(doc) ? '● ' : '';
  const where = doc?.path ? ` — ${doc.path}` : '';
  api.setTitle(`${dirty}${doc?.name || '제목 없음'}${where} — MarkView`);
  api.setDirty(Boolean(isDirty(doc)));
}

function setDiagramStatus(progress) {
  if (!progress) {
    el.statusDiagram.hidden = true;
    return;
  }
  el.statusDiagram.hidden = false;
  el.statusDiagram.textContent =
    progress.done >= progress.total
      ? `다이어그램 ${progress.total}개`
      : `다이어그램 ${progress.done}/${progress.total} 렌더링…`;
}

// ---------------------------------------------------------------------------
// 스크롤 동기화
// ---------------------------------------------------------------------------

function lineElements() {
  return [...el.preview.querySelectorAll('[data-line]')];
}

function syncPreviewToLine(line) {
  if (!state.settings.scrollSync || state.syncing) return;
  const elements = lineElements();
  if (!elements.length) return;

  let candidate = elements[0];
  for (const node of elements) {
    if (Number(node.dataset.line) <= line) candidate = node;
    else break;
  }
  state.syncing = true;
  const containerTop = el.previewScroll.getBoundingClientRect().top;
  const delta = candidate.getBoundingClientRect().top - containerTop;
  el.previewScroll.scrollTop += delta - 4;
  requestAnimationFrame(() => {
    state.syncing = false;
  });
}

function syncEditorToPreview() {
  if (!state.settings.scrollSync || state.syncing) return;
  const elements = lineElements();
  if (!elements.length) return;
  const top = el.previewScroll.getBoundingClientRect().top + 6;

  let line = 0;
  for (const node of elements) {
    if (node.getBoundingClientRect().top <= top) line = Number(node.dataset.line);
    else break;
  }
  state.syncing = true;
  editor.scrollToLine(line);
  requestAnimationFrame(() => {
    state.syncing = false;
  });
}

// ---------------------------------------------------------------------------
// 서식 명령
// ---------------------------------------------------------------------------

const TABLE_TEMPLATE = `| 항목 | 설명 | 비고 |
| --- | --- | --- |
|  |  |  |
|  |  |  |
`;

const MERMAID_TEMPLATE = `\`\`\`mermaid
graph TD
    A[시작] --> B{조건 확인}
    B -- 예 --> C[처리]
    B -- 아니오 --> D[종료]
    C --> D
\`\`\`
`;

function applyFormat(command) {
  switch (command) {
    case 'format:bold':
      return editor.surround('**', '**', '굵은 텍스트');
    case 'format:italic':
      return editor.surround('*', '*', '기울인 텍스트');
    case 'format:strike':
      return editor.surround('~~', '~~', '취소선');
    case 'format:code':
      return editor.surround('`', '`', 'code');
    case 'format:link':
      return editor.surround('[', '](https://)', '링크 텍스트');
    case 'format:heading':
      return editor.toggleLinePrefix((text) => {
        const match = /^(#{1,6})\s/.exec(text);
        if (!match) return `# ${text}`;
        if (match[1].length >= 6) return text.replace(/^#{1,6}\s/, '');
        return `#${text}`;
      });
    case 'format:ul':
      return editor.toggleLinePrefix((text) =>
        /^\s*[-*+]\s/.test(text) ? text.replace(/^(\s*)[-*+]\s/, '$1') : `- ${text}`,
      );
    case 'format:task':
      return editor.toggleLinePrefix((text) =>
        /^\s*[-*+]\s\[[ xX]\]\s/.test(text)
          ? text.replace(/^(\s*)[-*+]\s\[[ xX]\]\s/, '$1')
          : `- [ ] ${text.replace(/^(\s*)[-*+]\s/, '$1')}`,
      );
    case 'format:quote':
      return editor.toggleLinePrefix((text) => (/^\s*>\s?/.test(text) ? text.replace(/^(\s*)>\s?/, '$1') : `> ${text}`));
    case 'format:table':
      return editor.insertBlock(TABLE_TEMPLATE);
    case 'format:mermaid':
      return editor.insertBlock(MERMAID_TEMPLATE);
    default:
      return undefined;
  }
}

// ---------------------------------------------------------------------------
// 보기 설정
// ---------------------------------------------------------------------------

async function patchSettings(patch) {
  state.settings = { ...state.settings, ...patch };
  await api.setSettings(patch);
}

function applyViewSettings() {
  el.app.dataset.view = state.settings.viewMode || 'split';
  el.app.dataset.outline = state.settings.showOutline === false ? 'off' : 'on';
  el.preview.style.setProperty('--preview-scale', String(state.settings.previewZoom || 1));

  for (const button of document.querySelectorAll('.tb[data-cmd]')) {
    const cmd = button.dataset.cmd;
    if (cmd.startsWith('view:') && ['view:editor', 'view:split', 'view:preview'].includes(cmd)) {
      button.classList.toggle('active', cmd === `view:${state.settings.viewMode}`);
    }
    if (cmd === 'view:outline') button.classList.toggle('active', state.settings.showOutline !== false);
  }
  updateStatus(state.lastRender?.stats);
}

async function setZoom(delta) {
  const next = Math.min(2.4, Math.max(0.6, Math.round(((state.settings.previewZoom || 1) + delta) * 100) / 100));
  await patchSettings({ previewZoom: next });
  applyViewSettings();
}

// ---------------------------------------------------------------------------
// 내보내기
// ---------------------------------------------------------------------------

async function runExport(kind) {
  const doc = activeDoc();
  if (!doc) return;
  stashActive();
  await renderPreview(); // 다이어그램이 모두 그려진 상태를 보장
  const result = await api.exportDocument({
    kind,
    html: preview.exportHtml(),
    title: stripExtension(doc.name),
    docPath: doc.path,
    theme: kind === 'pdf' ? 'light' : effectiveTheme(),
  });
  if (result.canceled) return;
  if (result.ok) {
    toast(`${kind.toUpperCase()} 내보내기 완료`, 'success', 3200);
    api.showItemInFolder(result.path);
  } else {
    toast(`내보내기 실패: ${result.error}`, 'error', 6000);
  }
}

// ---------------------------------------------------------------------------
// 명령 라우터
// ---------------------------------------------------------------------------

async function runCommand(command) {
  switch (command) {
    case 'file:new':
      createDoc();
      break;
    case 'file:open':
      await openDialog();
      break;
    case 'file:save':
      await saveDoc(activeDoc());
      break;
    case 'file:saveAs':
      await saveDoc(activeDoc(), { saveAs: true });
      break;
    case 'tab:close':
      await closeDoc(state.activeId);
      break;
    case 'app:quit':
      await handleBeforeClose();
      break;
    case 'edit:find':
      editor.openSearch();
      break;
    case 'export:html':
      await runExport('html');
      break;
    case 'export:pdf':
      await runExport('pdf');
      break;
    case 'export:menu':
      showModal(
        '내보내기',
        `<p style="margin:0 0 14px;color:var(--fg-muted)">현재 문서를 다른 형식으로 저장합니다. 이미지와 다이어그램이 파일 안에 포함되어 어디서든 그대로 열립니다.</p>
         <div style="display:flex;gap:10px">
           <button class="btn primary" data-export="html">HTML 파일로</button>
           <button class="btn" data-export="pdf">PDF 파일로</button>
         </div>`,
      );
      for (const button of el.modalBody.querySelectorAll('[data-export]')) {
        button.addEventListener('click', () => {
          el.modalBackdrop.hidden = true;
          runExport(button.dataset.export);
        });
      }
      break;
    case 'recent:clear':
      await api.recentClear();
      toast('최근 문서 목록을 지웠습니다.');
      break;
    case 'view:editor':
    case 'view:split':
    case 'view:preview':
      await patchSettings({ viewMode: command.split(':')[1] });
      applyViewSettings();
      break;
    case 'view:outline':
      await patchSettings({ showOutline: state.settings.showOutline === false });
      applyViewSettings();
      break;
    case 'view:scrollSync':
      await patchSettings({ scrollSync: !state.settings.scrollSync });
      toast(`스크롤 동기화 ${state.settings.scrollSync ? '켬' : '끔'}`);
      break;
    case 'view:zoomIn':
      await setZoom(0.1);
      break;
    case 'view:zoomOut':
      await setZoom(-0.1);
      break;
    case 'view:zoomReset':
      await patchSettings({ previewZoom: 1 });
      applyViewSettings();
      break;
    case 'view:toggleTheme': {
      const next = effectiveTheme() === 'dark' ? 'light' : 'dark';
      await patchSettings({ theme: next });
      applyTheme();
      await preview.refreshDiagrams(next);
      break;
    }
    case 'help:sample': {
      const target = `${state.appInfo.sampleDir}/기능-안내.md`;
      const opened = await openPath(target);
      if (!opened) toast('샘플 문서를 찾을 수 없습니다.', 'error');
      break;
    }
    case 'help:shortcuts':
      showModal('단축키', shortcutTable());
      break;
    case 'help:about':
      showModal(
        'MarkView 정보',
        `<p><b>MarkView ${state.appInfo.version}</b><br><span style="color:var(--fg-muted)">가벼운 마크다운 편집기 & 뷰어</span></p>
         <p style="color:var(--fg-muted);font-size:12px;line-height:1.8">
           Mermaid 다이어그램 · KaTeX 수식 · GFM 표/체크리스트 · 로컬 이미지 · 코드 하이라이팅<br>
           Electron ${state.appInfo.versions?.electron} · Chromium ${state.appInfo.versions?.chrome} · Node ${state.appInfo.versions?.node}
         </p>`,
      );
      break;
    default:
      if (command.startsWith('format:')) applyFormat(command);
  }
}

function shortcutTable() {
  const rows = [
    ['새 문서', 'Ctrl+N'],
    ['열기', 'Ctrl+O'],
    ['저장', 'Ctrl+S'],
    ['다른 이름으로 저장', 'Ctrl+Shift+S'],
    ['PDF로 내보내기', 'Ctrl+P'],
    ['탭 닫기', 'Ctrl+W'],
    ['찾기 / 바꾸기', 'Ctrl+F'],
    ['굵게 / 기울임 / 코드', 'Ctrl+B · Ctrl+I · Ctrl+`'],
    ['링크', 'Ctrl+K'],
    ['편집기 · 분할 · 미리보기', 'Ctrl+1 · Ctrl+2 · Ctrl+3'],
    ['목차 패널', 'Ctrl+\\'],
    ['확대 / 축소 / 원래대로', 'Ctrl++ · Ctrl+- · Ctrl+0'],
    ['테마 전환', 'Ctrl+Shift+T'],
    ['다음 / 이전 탭', 'Ctrl+Tab · Ctrl+Shift+Tab'],
  ];
  return `<table class="shortcut-table"><tbody>${rows
    .map(([label, keys]) => `<tr><td>${label}</td><td><kbd>${keys.replace(/ · /g, '</kbd> · <kbd>')}</kbd></td></tr>`)
    .join('')}</tbody></table>`;
}

// ---------------------------------------------------------------------------
// 미리보기 상호작용 (링크·코드복사·체크박스)
// ---------------------------------------------------------------------------

function bindPreviewInteractions() {
  el.preview.addEventListener('click', async (event) => {
    const copyButton = event.target.closest('[data-action="copy-code"]');
    if (copyButton) {
      const code = copyButton.closest('.code-block')?.querySelector('code')?.textContent ?? '';
      await api.copyText(code);
      copyButton.textContent = '복사됨';
      copyButton.classList.add('copied');
      setTimeout(() => {
        copyButton.textContent = '복사';
        copyButton.classList.remove('copied');
      }, 1400);
      return;
    }

    const anchor = event.target.closest('a[href]');
    if (!anchor) return;
    const href = anchor.getAttribute('href') || '';
    event.preventDefault();

    if (/^https?:|^mailto:/i.test(href)) {
      api.openExternal(href);
      return;
    }
    if (href.startsWith('#')) {
      const slug = normalizeHref(href).slice(1) || decodeURIComponent(href.slice(1));
      const target =
        el.preview.querySelector(`[id="${CSS.escape(slug)}"]`) ||
        el.preview.querySelector(`[id="${CSS.escape(decodeURIComponent(href.slice(1)))}"]`);
      target?.scrollIntoView({ block: 'start', behavior: 'smooth' });
      return;
    }

    const doc = activeDoc();
    const relative = anchor.dataset.doclink || href;
    if (!doc?.dir) {
      toast('문서를 먼저 저장하면 상대 경로 링크를 열 수 있습니다.', 'error');
      return;
    }
    const target = resolvePath(doc.dir, normalizeHref(relative));
    if (isMarkdownFile(target)) await openPath(target);
    else api.showItemInFolder(target);
  });

  // 미리보기에서 체크박스를 누르면 원본 마크다운도 함께 바뀐다.
  el.preview.addEventListener('change', (event) => {
    const box = event.target.closest('.task-list-item-checkbox');
    if (!box) return;
    const item = box.closest('.task-list-item');
    const line = Number(item?.dataset.line ?? item?.closest('[data-line]')?.dataset.line ?? NaN);
    if (Number.isNaN(line)) return;

    const doc = activeDoc();
    if (!doc) return;
    const lines = editor.getValue().split('\n');
    const original = lines[line];
    if (original == null) return;
    lines[line] = box.checked
      ? original.replace(/^(\s*[-*+]\s*)\[\s\]/, '$1[x]')
      : original.replace(/^(\s*[-*+]\s*)\[[xX]\]/, '$1[ ]');
    if (lines[line] !== original) {
      editor.replaceAll(lines.join('\n'), { selection: editor.getSelection(), scrollTop: editor.getScrollTop() });
    }
  });
}

// ---------------------------------------------------------------------------
// 드래그 앤 드롭 / 붙여넣기
// ---------------------------------------------------------------------------

function bindDropAndPaste() {
  const overlay = document.createElement('div');
  overlay.className = 'drop-overlay';
  overlay.textContent = '여기에 놓아 파일 열기 / 이미지 삽입';
  document.body.appendChild(overlay);

  let depth = 0;
  window.addEventListener('dragenter', (e) => {
    e.preventDefault();
    depth += 1;
    document.body.classList.add('dragging-file');
  });
  window.addEventListener('dragover', (e) => e.preventDefault());
  window.addEventListener('dragleave', (e) => {
    e.preventDefault();
    depth = Math.max(0, depth - 1);
    if (depth === 0) document.body.classList.remove('dragging-file');
  });

  window.addEventListener('drop', async (event) => {
    event.preventDefault();
    depth = 0;
    document.body.classList.remove('dragging-file');

    const files = [...(event.dataTransfer?.files || [])];
    if (!files.length) return;

    for (const file of files) {
      const filePath = window.markviewFilePath?.(file) || file.path;
      if (!filePath) {
        toast(`${file.name}: 경로를 확인할 수 없습니다.`, 'error');
        continue;
      }
      if (isMarkdownFile(file.name)) {
        await openPath(filePath);
      } else if (isImageFile(file.name)) {
        const doc = activeDoc();
        const href = doc?.dir ? relativePath(doc.dir, filePath) : filePath.replace(/\\/g, '/');
        editor.insertText(`![${stripExtension(file.name)}](${href.replace(/ /g, '%20')})`);
      } else {
        toast(`${file.name}: 지원하지 않는 형식입니다.`, 'error');
      }
    }
  });

  // 클립보드 이미지 → 문서 옆 .assets 폴더에 저장 후 삽입
  el.editorHost.addEventListener('paste', async (event) => {
    const items = [...(event.clipboardData?.items || [])];
    const imageItem = items.find((item) => item.type.startsWith('image/'));
    if (!imageItem) return;
    event.preventDefault();

    const blob = imageItem.getAsFile();
    if (!blob) return;
    const dataUrl = await new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.readAsDataURL(blob);
    });

    const doc = activeDoc();
    const result = await api.saveClipboardImage({ docPath: doc?.path || null, dataUrl, name: 'paste' });
    if (!result.ok) {
      toast(`이미지 저장 실패: ${result.error}`, 'error');
      return;
    }
    editor.insertText(`![붙여넣은 이미지](${result.relative.replace(/ /g, '%20')})`);
    toast('이미지를 문서 폴더에 저장했습니다.', 'success');
  });
}

// ---------------------------------------------------------------------------
// 분할 크기 조절
// ---------------------------------------------------------------------------

function bindSplitter() {
  let dragging = false;
  el.splitter.addEventListener('pointerdown', (event) => {
    dragging = true;
    el.splitter.classList.add('dragging');
    el.splitter.setPointerCapture(event.pointerId);
  });
  el.splitter.addEventListener('pointermove', (event) => {
    if (!dragging) return;
    const panes = el.splitter.parentElement.getBoundingClientRect();
    const ratio = Math.min(0.85, Math.max(0.15, (event.clientX - panes.left) / panes.width));
    el.editorPane.style.flex = `0 0 ${(ratio * 100).toFixed(2)}%`;
  });
  const stop = (event) => {
    if (!dragging) return;
    dragging = false;
    el.splitter.classList.remove('dragging');
    try {
      el.splitter.releasePointerCapture(event.pointerId);
    } catch {
      /* 무시 */
    }
  };
  el.splitter.addEventListener('pointerup', stop);
  el.splitter.addEventListener('pointercancel', stop);
}

// ---------------------------------------------------------------------------
// 창 닫기
// ---------------------------------------------------------------------------

async function handleBeforeClose() {
  if (state.closing) return;
  state.closing = true;
  stashActive();
  for (const doc of [...state.docs]) {
    if (!isDirty(doc)) continue;
    activateDoc(doc.id);
    const choice = await api.confirmDiscard(doc.name);
    if (choice === 'cancel') {
      state.closing = false;
      return;
    }
    if (choice === 'save') {
      const saved = await saveDoc(doc);
      if (!saved) {
        state.closing = false;
        return;
      }
    } else {
      doc.savedText = doc.text;
    }
  }
  api.approveClose();
}

// ---------------------------------------------------------------------------
// 외부 변경 감지
// ---------------------------------------------------------------------------

async function handleExternalChange(filePath) {
  const doc = state.docs.find((d) => d.path === filePath);
  if (!doc) return;
  const result = await api.readFile(filePath);
  if (!result.ok) return;
  if (result.document.text === doc.text) return;

  if (!isDirty(doc)) {
    doc.text = result.document.text;
    doc.savedText = result.document.text;
    doc.mtimeMs = result.document.mtimeMs;
    if (doc.id === state.activeId) {
      editor.replaceAll(doc.text, { selection: editor.getSelection(), scrollTop: editor.getScrollTop() });
      scheduleRender(true);
    }
    toast(`${doc.name}: 외부 변경을 반영했습니다.`, 'success');
    return;
  }

  const answer = await api.message({
    type: 'question',
    buttons: ['디스크 내용 불러오기', '내 편집 유지'],
    defaultId: 1,
    title: '외부에서 파일이 변경됨',
    message: `'${doc.name}' 파일이 다른 프로그램에서 변경되었습니다.`,
    detail: '저장하지 않은 편집 내용이 있습니다. 어떻게 할까요?',
  });
  if (answer === 0) {
    doc.text = result.document.text;
    doc.savedText = result.document.text;
    if (doc.id === state.activeId) {
      editor.replaceAll(doc.text);
      scheduleRender(true);
    }
  }
}

// ---------------------------------------------------------------------------
// 부팅
// ---------------------------------------------------------------------------

async function boot() {
  const info = await api.ready();
  state.appInfo = info;
  state.settings = info.settings || {};
  state.systemTheme = info.systemTheme || 'light';
  applyTheme();

  editor = createEditor({
    parent: el.editorHost,
    settings: state.settings,
    onChange: (text) => {
      const doc = activeDoc();
      if (!doc) return;
      doc.text = text;
      scheduleRender();
      renderTabs();
      updateWindowTitle();
    },
    onCursor: ({ line, column }) => {
      el.statusCursor.textContent = `${line}:${column}`;
    },
    onScroll: (line) => syncPreviewToLine(line),
  });

  preview = createPreview({
    root: el.preview,
    scroller: el.previewScroll,
    onDiagramState: setDiagramStatus,
  });

  bindPreviewInteractions();
  bindDropAndPaste();
  bindSplitter();
  applyViewSettings();

  el.previewScroll.addEventListener('scroll', () => {
    highlightOutline();
    syncEditorToPreview();
  });

  for (const button of document.querySelectorAll('.tb[data-cmd]')) {
    button.addEventListener('click', () => runCommand(button.dataset.cmd));
  }
  el.statusPath.addEventListener('click', () => {
    const doc = activeDoc();
    if (doc?.path) api.showItemInFolder(doc.path);
  });

  api.onMenuCommand((command) => runCommand(command));
  api.onOpenPath((filePath) => openPath(filePath));
  api.onFileChanged((filePath) => handleExternalChange(filePath));
  api.onBeforeClose(() => handleBeforeClose());
  api.onThemeChanged(async (theme) => {
    state.systemTheme = theme;
    if ((state.settings.theme || 'system') === 'system') {
      applyTheme();
      await preview.refreshDiagrams(effectiveTheme());
    }
  });

  // 탭 전환 단축키 (메뉴 가속기로는 잡히지 않는 조합)
  window.addEventListener('keydown', (event) => {
    if (event.ctrlKey && event.key === 'Tab') {
      event.preventDefault();
      if (state.docs.length < 2) return;
      const index = state.docs.findIndex((d) => d.id === state.activeId);
      const next = (index + (event.shiftKey ? -1 : 1) + state.docs.length) % state.docs.length;
      activateDoc(state.docs[next].id);
    }
    if (event.key === 'Escape' && !el.modalBackdrop.hidden) el.modalBackdrop.hidden = true;
  });

  createDoc({ text: WELCOME });

  for (const filePath of info.openPaths || []) await openPath(filePath);

  // 자동화 테스트/외부 호출용 훅
  window.__markview = {
    runCommand,
    openPath,
    getState: () => ({
      activeId: state.activeId,
      docs: state.docs.map((d) => ({ id: d.id, name: d.name, path: d.path, dirty: isDirty(d) })),
      settings: state.settings,
      headings: state.lastRender?.headings || [],
      stats: state.lastRender?.stats || null,
    }),
    setText(text) {
      const doc = activeDoc();
      if (!doc) return;
      doc.text = text;
      editor.replaceAll(text);
      return renderPreview();
    },
    getText: () => activeDoc()?.text ?? '',
    /** 저장하지 않은 변경을 버리고 디스크 내용으로 되돌린다. */
    discardChanges() {
      const doc = activeDoc();
      if (!doc) return;
      doc.text = doc.savedText;
      editor.replaceAll(doc.savedText);
      renderTabs();
      updateWindowTitle();
      return renderPreview();
    },
    renderNow: () => renderPreview(),
    exportHtml: () => preview.exportHtml(),
    ready: true,
  };
  document.documentElement.dataset.markviewReady = '1';
}

boot().catch((error) => {
  document.body.innerHTML = `<pre style="padding:24px;color:#d92d20;white-space:pre-wrap">시작 실패:\n${error?.stack || error}</pre>`;
});
