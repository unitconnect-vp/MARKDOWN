/**
 * CodeMirror 6 기반 마크다운 편집기 래퍼.
 * 언어 데이터 패키지는 의도적으로 뺐다(번들 용량 ↓). 코드 하이라이팅은 미리보기가 담당.
 */
import { EditorState, Compartment, EditorSelection } from '@codemirror/state';
import {
  EditorView,
  keymap,
  lineNumbers,
  highlightActiveLine,
  highlightActiveLineGutter,
  drawSelection,
  dropCursor,
  rectangularSelection,
  crosshairCursor,
  placeholder as cmPlaceholder,
} from '@codemirror/view';
import { defaultKeymap, history, historyKeymap, indentWithTab, undo, redo } from '@codemirror/commands';
import { searchKeymap, highlightSelectionMatches, search, openSearchPanel } from '@codemirror/search';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { syntaxHighlighting, HighlightStyle, bracketMatching, indentUnit } from '@codemirror/language';
import { tags as t } from '@lezer/highlight';

const markdownHighlight = HighlightStyle.define([
  { tag: t.heading1, fontSize: '1.5em', fontWeight: '700', color: 'var(--fg)' },
  { tag: t.heading2, fontSize: '1.3em', fontWeight: '700', color: 'var(--fg)' },
  { tag: t.heading3, fontSize: '1.15em', fontWeight: '700', color: 'var(--fg)' },
  { tag: [t.heading4, t.heading5, t.heading6], fontWeight: '700', color: 'var(--fg)' },
  { tag: t.strong, fontWeight: '700', color: 'var(--fg)' },
  { tag: t.emphasis, fontStyle: 'italic' },
  { tag: t.strikethrough, textDecoration: 'line-through', color: 'var(--fg-subtle)' },
  { tag: t.link, color: 'var(--accent)' },
  { tag: t.url, color: 'var(--accent)', textDecoration: 'underline' },
  { tag: [t.monospace, t.contentSeparator], color: 'var(--hl-string)' },
  { tag: t.quote, color: 'var(--fg-muted)', fontStyle: 'italic' },
  { tag: t.list, color: 'var(--hl-keyword)' },
  { tag: t.processingInstruction, color: 'var(--fg-subtle)' },
  { tag: t.meta, color: 'var(--fg-subtle)' },
  { tag: [t.labelName, t.tagName], color: 'var(--hl-title)' },
  { tag: t.comment, color: 'var(--hl-comment)', fontStyle: 'italic' },
]);

const baseTheme = EditorView.theme({
  '&': { color: 'var(--fg)', backgroundColor: 'var(--bg)', height: '100%' },
  '.cm-content': {
    caretColor: 'var(--accent)',
    padding: '16px 0 60vh',
    fontFamily: 'var(--font-mono)',
    lineHeight: '1.65',
  },
  '.cm-line': { padding: '0 20px' },
  '&.cm-focused .cm-cursor': { borderLeftColor: 'var(--accent)', borderLeftWidth: '2px' },
  '.cm-gutters': {
    backgroundColor: 'var(--bg-sunken)',
    color: 'var(--fg-subtle)',
    border: 'none',
    borderRight: '1px solid var(--border)',
    minWidth: '42px',
  },
  '.cm-activeLineGutter': { backgroundColor: 'var(--bg-hover)', color: 'var(--fg-muted)' },
  '.cm-activeLine': { backgroundColor: 'color-mix(in srgb, var(--bg-hover) 45%, transparent)' },
  '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection': {
    backgroundColor: 'var(--bg-selected)',
  },
  '.cm-selectionMatch': { backgroundColor: 'color-mix(in srgb, var(--accent) 18%, transparent)' },
  '.cm-searchMatch': {
    backgroundColor: 'color-mix(in srgb, var(--warning) 30%, transparent)',
    outline: '1px solid color-mix(in srgb, var(--warning) 60%, transparent)',
  },
  '.cm-searchMatch.cm-searchMatch-selected': { backgroundColor: 'color-mix(in srgb, var(--accent) 35%, transparent)' },
  '.cm-panels': {
    backgroundColor: 'var(--bg-chrome)',
    color: 'var(--fg)',
    borderTop: '1px solid var(--border)',
    fontFamily: 'var(--font-ui)',
  },
  '.cm-panel input, .cm-panel button, .cm-panel select': {
    fontFamily: 'var(--font-ui)',
    fontSize: '12px',
    background: 'var(--bg-raised)',
    color: 'var(--fg)',
    border: '1px solid var(--border-strong)',
    borderRadius: '4px',
    padding: '3px 6px',
  },
  '.cm-panel button': { cursor: 'pointer' },
  '.cm-scroller': { overflow: 'auto' },
  '.cm-placeholder': { color: 'var(--fg-subtle)' },
});

export function createEditor({ parent, onChange, onCursor, onScroll, settings }) {
  const wrapCompartment = new Compartment();
  const gutterCompartment = new Compartment();
  const fontCompartment = new Compartment();

  const fontTheme = (size) =>
    EditorView.theme({ '.cm-content, .cm-gutters': { fontSize: `${size}px` } });

  let notifyScroll = true;

  const view = new EditorView({
    parent,
    state: EditorState.create({
      doc: '',
      extensions: [
        history(),
        drawSelection(),
        dropCursor(),
        bracketMatching(),
        rectangularSelection(),
        crosshairCursor(),
        highlightActiveLine(),
        highlightActiveLineGutter(),
        highlightSelectionMatches(),
        search({ top: true }),
        indentUnit.of('  '),
        EditorState.tabSize.of(2),
        markdown({ base: markdownLanguage, addKeymap: true }),
        syntaxHighlighting(markdownHighlight, { fallback: true }),
        keymap.of([...defaultKeymap, ...historyKeymap, ...searchKeymap, indentWithTab]),
        cmPlaceholder('여기에 마크다운을 입력하세요…  (Ctrl+O 로 파일 열기)'),
        gutterCompartment.of(settings.lineNumbers === false ? [] : lineNumbers()),
        wrapCompartment.of(settings.wordWrap === false ? [] : EditorView.lineWrapping),
        fontCompartment.of(fontTheme(settings.editorFontSize || 14)),
        baseTheme,
        EditorView.updateListener.of((update) => {
          if (update.docChanged) onChange?.(update.state.doc.toString());
          if (update.selectionSet || update.docChanged) {
            const head = update.state.selection.main.head;
            const line = update.state.doc.lineAt(head);
            onCursor?.({ line: line.number, column: head - line.from + 1, total: update.state.doc.lines });
          }
        }),
        EditorView.domEventHandlers({
          scroll: (_event, v) => {
            if (notifyScroll) onScroll?.(topVisibleLine(v));
            return false;
          },
        }),
      ],
    }),
  });

  /** 화면 최상단에 보이는 원본 라인 번호(0-base). */
  function topVisibleLine(v = view) {
    const rect = v.scrollDOM.getBoundingClientRect();
    const pos = v.posAtCoords({ x: rect.left + 12, y: rect.top + 4 }, false);
    if (pos == null) return 0;
    return v.state.doc.lineAt(pos).number - 1;
  }

  return {
    view,

    getValue: () => view.state.doc.toString(),

    /** 확장(테마·키맵)을 유지한 채 내용만 교체한다. 탭 전환에 사용. */
    replaceAll(text, { selection, scrollTop } = {}) {
      const doc = text ?? '';
      notifyScroll = false;
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: doc },
        selection: EditorSelection.single(
          Math.min(selection?.anchor ?? 0, doc.length),
          Math.min(selection?.head ?? selection?.anchor ?? 0, doc.length),
        ),
        scrollIntoView: false,
      });
      requestAnimationFrame(() => {
        if (typeof scrollTop === 'number') view.scrollDOM.scrollTop = scrollTop;
        notifyScroll = true;
      });
    },

    getSelection: () => {
      const { anchor, head } = view.state.selection.main;
      return { anchor, head };
    },
    getScrollTop: () => view.scrollDOM.scrollTop,
    topVisibleLine,

    focus: () => view.focus(),
    undo: () => undo(view),
    redo: () => redo(view),
    openSearch: () => openSearchPanel(view),

    /** 특정 라인(0-base)이 화면 상단에 오도록 스크롤 (사용자 스크롤 이벤트 억제). */
    scrollToLine(lineIndex) {
      const total = view.state.doc.lines;
      const line = view.state.doc.line(Math.min(Math.max(lineIndex + 1, 1), total));
      notifyScroll = false;
      view.dispatch({ effects: EditorView.scrollIntoView(line.from, { y: 'start', yMargin: 8 }) });
      requestAnimationFrame(() => {
        notifyScroll = true;
      });
    },

    setCursorToLine(lineIndex) {
      const total = view.state.doc.lines;
      const line = view.state.doc.line(Math.min(Math.max(lineIndex + 1, 1), total));
      view.dispatch({
        selection: EditorSelection.cursor(line.from),
        effects: EditorView.scrollIntoView(line.from, { y: 'start', yMargin: 8 }),
      });
      view.focus();
    },

    setOption(key, value) {
      if (key === 'wordWrap') {
        view.dispatch({ effects: wrapCompartment.reconfigure(value ? EditorView.lineWrapping : []) });
      } else if (key === 'lineNumbers') {
        view.dispatch({ effects: gutterCompartment.reconfigure(value ? lineNumbers() : []) });
      } else if (key === 'editorFontSize') {
        view.dispatch({ effects: fontCompartment.reconfigure(fontTheme(value)) });
      }
    },

    /** 커서 위치/선택 영역을 감싸거나 치환하는 서식 명령. */
    surround(before, after = before, placeholderText = '') {
      const { from, to } = view.state.selection.main;
      const selected = view.state.sliceDoc(from, to) || placeholderText;
      const already =
        view.state.sliceDoc(Math.max(0, from - before.length), from) === before &&
        view.state.sliceDoc(to, to + after.length) === after;

      if (already) {
        view.dispatch({
          changes: [
            { from: from - before.length, to: from, insert: '' },
            { from: to, to: to + after.length, insert: '' },
          ],
          selection: EditorSelection.range(from - before.length, to - before.length),
        });
      } else {
        view.dispatch({
          changes: { from, to, insert: `${before}${selected}${after}` },
          selection: EditorSelection.range(from + before.length, from + before.length + selected.length),
        });
      }
      view.focus();
    },

    /** 선택된 각 줄 앞에 접두어를 토글한다 (목록·인용·제목). */
    toggleLinePrefix(prefixFn) {
      const { from, to } = view.state.selection.main;
      const first = view.state.doc.lineAt(from);
      const last = view.state.doc.lineAt(to);
      const changes = [];
      for (let n = first.number; n <= last.number; n += 1) {
        const line = view.state.doc.line(n);
        const next = prefixFn(line.text, n - first.number);
        if (next !== line.text) changes.push({ from: line.from, to: line.to, insert: next });
      }
      if (changes.length) view.dispatch({ changes });
      view.focus();
    },

    insertBlock(text) {
      const { from, to } = view.state.selection.main;
      const line = view.state.doc.lineAt(to);
      const atLineStart = from === line.from;
      const prefix = atLineStart ? '' : '\n';
      const insert = `${prefix}${text}`;
      view.dispatch({
        changes: { from: line.to, to: line.to, insert: line.length === 0 && atLineStart ? text : insert },
        selection: EditorSelection.cursor(line.to + insert.length),
      });
      view.focus();
    },

    insertText(text) {
      const { from, to } = view.state.selection.main;
      view.dispatch({
        changes: { from, to, insert: text },
        selection: EditorSelection.cursor(from + text.length),
      });
      view.focus();
    },

    destroy: () => view.destroy(),
  };
}
