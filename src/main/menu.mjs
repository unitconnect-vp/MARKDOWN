import { Menu, app, shell } from 'electron';
import { recentFiles } from './store.mjs';

/**
 * 애플리케이션 메뉴. 모든 항목은 렌더러로 `menu:command` 를 보낸다.
 */
export function buildMenu(sendCommand, openRecent) {
  const recent = recentFiles.list();
  const isMac = process.platform === 'darwin';

  const template = [
    // macOS 는 첫 메뉴가 항상 앱 이름 메뉴가 된다. 없으면 '파일' 메뉴가 그 자리를 빼앗긴다.
    ...(isMac
      ? [
          {
            label: app.name,
            submenu: [
              { label: `${app.name} 정보`, click: () => sendCommand('help:about') },
              { type: 'separator' },
              { role: 'services', label: '서비스' },
              { type: 'separator' },
              { role: 'hide', label: `${app.name} 가리기` },
              { role: 'hideOthers', label: '기타 가리기' },
              { role: 'unhide', label: '모두 보기' },
              { type: 'separator' },
              { role: 'quit', label: `${app.name} 종료` },
            ],
          },
        ]
      : []),
    {
      label: '파일(&F)',
      submenu: [
        { label: '새 문서', accelerator: 'CmdOrCtrl+N', click: () => sendCommand('file:new') },
        { label: '열기…', accelerator: 'CmdOrCtrl+O', click: () => sendCommand('file:open') },
        {
          label: '최근 문서',
          submenu: recent.length
            ? [
                ...recent.map((p, i) => ({
                  label: `${i + 1}. ${p}`,
                  click: () => openRecent(p),
                })),
                { type: 'separator' },
                { label: '목록 지우기', click: () => sendCommand('recent:clear') },
              ]
            : [{ label: '(없음)', enabled: false }],
        },
        { type: 'separator' },
        { label: '저장', accelerator: 'CmdOrCtrl+S', click: () => sendCommand('file:save') },
        { label: '다른 이름으로 저장…', accelerator: 'CmdOrCtrl+Shift+S', click: () => sendCommand('file:saveAs') },
        { type: 'separator' },
        { label: 'HTML로 내보내기…', click: () => sendCommand('export:html') },
        { label: 'PDF로 내보내기…', accelerator: 'CmdOrCtrl+P', click: () => sendCommand('export:pdf') },
        { type: 'separator' },
        { label: '탭 닫기', accelerator: 'CmdOrCtrl+W', click: () => sendCommand('tab:close') },
        // macOS 는 앱 메뉴의 '종료'(⌘Q)를 쓴다.
        ...(isMac ? [] : [{ label: '끝내기', accelerator: 'Alt+F4', click: () => sendCommand('app:quit') }]),
      ],
    },
    {
      label: '편집(&E)',
      submenu: [
        { role: 'undo', label: '실행 취소' },
        { role: 'redo', label: '다시 실행' },
        { type: 'separator' },
        { role: 'cut', label: '잘라내기' },
        { role: 'copy', label: '복사' },
        { role: 'paste', label: '붙여넣기' },
        { role: 'selectAll', label: '모두 선택' },
        { type: 'separator' },
        { label: '찾기 / 바꾸기', accelerator: 'CmdOrCtrl+F', click: () => sendCommand('edit:find') },
        { type: 'separator' },
        { label: '굵게', accelerator: 'CmdOrCtrl+B', click: () => sendCommand('format:bold') },
        { label: '기울임', accelerator: 'CmdOrCtrl+I', click: () => sendCommand('format:italic') },
        { label: '인라인 코드', accelerator: 'CmdOrCtrl+`', click: () => sendCommand('format:code') },
        { label: '링크', accelerator: 'CmdOrCtrl+K', click: () => sendCommand('format:link') },
      ],
    },
    {
      label: '보기(&V)',
      submenu: [
        { label: '편집기만', accelerator: 'CmdOrCtrl+1', click: () => sendCommand('view:editor') },
        { label: '나란히 보기', accelerator: 'CmdOrCtrl+2', click: () => sendCommand('view:split') },
        { label: '미리보기만', accelerator: 'CmdOrCtrl+3', click: () => sendCommand('view:preview') },
        { type: 'separator' },
        { label: '목차 패널', accelerator: 'CmdOrCtrl+\\', click: () => sendCommand('view:outline') },
        { label: '스크롤 동기화', click: () => sendCommand('view:scrollSync') },
        { type: 'separator' },
        { label: '확대', accelerator: 'CmdOrCtrl+=', click: () => sendCommand('view:zoomIn') },
        { label: '축소', accelerator: 'CmdOrCtrl+-', click: () => sendCommand('view:zoomOut') },
        { label: '기본 크기', accelerator: 'CmdOrCtrl+0', click: () => sendCommand('view:zoomReset') },
        { type: 'separator' },
        { label: '테마 전환', accelerator: 'CmdOrCtrl+Shift+T', click: () => sendCommand('view:toggleTheme') },
        { type: 'separator' },
        { role: 'togglefullscreen', label: '전체 화면' },
        { role: 'toggleDevTools', label: '개발자 도구' },
        { role: 'reload', label: '새로 고침' },
      ],
    },
    ...(isMac ? [{ role: 'windowMenu', label: '윈도우' }] : []),
    {
      role: 'help',
      label: '도움말(&H)',
      submenu: [
        { label: '기능 안내 문서 열기', click: () => sendCommand('help:sample') },
        { label: '단축키', click: () => sendCommand('help:shortcuts') },
        { type: 'separator' },
        {
          label: 'Mermaid 문법 참고',
          click: () => shell.openExternal('https://mermaid.js.org/intro/'),
        },
        { type: 'separator' },
        { label: `MarkView ${app.getVersion()} 정보`, click: () => sendCommand('help:about') },
      ],
    },
  ];

  // 접근 키 표기(&F 등)는 Windows/Linux 전용 — macOS 에서는 글자 그대로 보이므로 뗀다.
  const menu = Menu.buildFromTemplate(isMac ? stripMnemonics(template) : template);
  Menu.setApplicationMenu(menu);
  return menu;
}

function stripMnemonics(items) {
  return items.map((item) => ({
    ...item,
    ...(typeof item.label === 'string' ? { label: item.label.replace(/\(&\w\)$/, '') } : {}),
    ...(Array.isArray(item.submenu) ? { submenu: stripMnemonics(item.submenu) } : {}),
  }));
}
