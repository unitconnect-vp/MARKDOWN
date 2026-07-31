/**
 * Mermaid 는 별도 번들로 분리해 첫 다이어그램이 등장할 때만 로드한다.
 * (초기 실행 속도를 위해 — 앱 기본 번들에는 포함되지 않는다)
 */
import mermaid from 'mermaid';

const FONT =
  "'Pretendard','Malgun Gothic','맑은 고딕',-apple-system,BlinkMacSystemFont,'Segoe UI','Noto Sans KR',system-ui,sans-serif";

let currentTheme = null;

function configure(theme) {
  if (currentTheme === theme) return;
  currentTheme = theme;
  mermaid.initialize({
    startOnLoad: false,
    securityLevel: 'strict',
    theme: theme === 'dark' ? 'dark' : 'default',
    fontFamily: FONT,
    darkMode: theme === 'dark',
    // useMaxWidth:false 로 두면 mermaid 가 width/height 를 실제 크기로 박아 넣는다.
    // 그 위에 CSS(max-width:100%; height:auto)를 얹으면
    // "넘칠 때만 축소, 절대 확대하지 않음" 이라는 원하는 동작이 나온다.
    flowchart: { htmlLabels: true, useMaxWidth: false, curve: 'basis' },
    sequence: { useMaxWidth: false, wrap: true },
    gantt: { useMaxWidth: false },
    er: { useMaxWidth: false },
    journey: { useMaxWidth: false },
    mindmap: { useMaxWidth: false },
    timeline: { useMaxWidth: false },
    pie: { useMaxWidth: false },
    class: { useMaxWidth: false },
    state: { useMaxWidth: false },
    quadrantChart: { useMaxWidth: false },
    xyChart: { useMaxWidth: false },
  });
}

window.__markviewMermaid = {
  /**
   * @param {string} id  고유 id
   * @param {string} code mermaid 소스
   * @param {'light'|'dark'} theme
   * @returns {Promise<{ok:true, svg:string} | {ok:false, error:string}>}
   */
  async render(id, code, theme) {
    configure(theme);
    try {
      const { svg } = await mermaid.render(`${id}-svg`, code);
      return { ok: true, svg };
    } catch (err) {
      return { ok: false, error: String(err?.message || err) };
    } finally {
      // mermaid 가 측정을 위해 남긴 임시 노드를 정리한다.
      document.getElementById(`d${id}-svg`)?.remove();
      document.getElementById(`${id}-svg`)?.remove();
    }
  },
  /** 테마가 바뀌면 다음 렌더에서 재설정되도록 강제한다. */
  invalidate() {
    currentTheme = null;
  },
};

window.dispatchEvent(new Event('markview:mermaid-ready'));
