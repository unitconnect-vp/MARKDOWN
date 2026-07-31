/**
 * KaTeX 수식 플러그인 (markdown-it).
 *
 * Claude 가 생성하는 마크다운은 아래 네 가지 표기를 섞어서 쓴다.
 *   인라인 : $E=mc^2$      \(E=mc^2\)
 *   블록   : $$ ... $$     \[ ... \]
 *
 * 통화 표기($100 처럼)를 수식으로 오인하지 않도록,
 * 여는 `$` 뒤와 닫는 `$` 앞의 공백/숫자 조합을 검사한다.
 */
import katex from 'katex';

const isSpace = (c) => c === 0x20 || c === 0x09 || c === 0x0a;
const isDigit = (c) => c >= 0x30 && c <= 0x39;

function renderTex(tex, displayMode) {
  try {
    return katex.renderToString(tex, {
      displayMode,
      throwOnError: false,
      strict: false,
      output: 'htmlAndMathml',
      trust: false,
      maxSize: 64,
      maxExpand: 1000,
    });
  } catch (err) {
    const escaped = String(tex).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]);
    return `<span class="katex-error" title="${String(err.message || err).replace(/"/g, '&quot;')}">${escaped}</span>`;
  }
}

/** `$...$` 또는 `\(...\)` 인라인 수식 */
function inlineMath(state, silent) {
  const src = state.src;
  const start = state.pos;

  // ---- \( ... \) ----
  if (src.charCodeAt(start) === 0x5c /* \ */ && src.charCodeAt(start + 1) === 0x28 /* ( */) {
    const end = src.indexOf('\\)', start + 2);
    if (end < 0) return false;
    if (!silent) {
      const token = state.push('math_inline', 'math', 0);
      token.content = src.slice(start + 2, end);
      token.markup = '\\(';
    }
    state.pos = end + 2;
    return true;
  }

  if (src.charCodeAt(start) !== 0x24 /* $ */) return false;
  // `$$` 는 블록 규칙이 처리한다.
  if (src.charCodeAt(start + 1) === 0x24) return false;
  // 이스케이프된 `\$`
  if (start > 0 && src.charCodeAt(start - 1) === 0x5c) return false;
  // `$ 100` 처럼 여는 기호 뒤가 공백이면 수식이 아니다.
  if (isSpace(src.charCodeAt(start + 1)) || Number.isNaN(src.charCodeAt(start + 1))) return false;

  let pos = start + 1;
  while (pos < src.length) {
    const code = src.charCodeAt(pos);
    if (code === 0x5c) {
      pos += 2;
      continue;
    }
    if (code === 0x24) {
      // 닫는 기호 앞이 공백이면 수식이 아니다.
      if (isSpace(src.charCodeAt(pos - 1))) return false;
      // `$100 ... 50$` 같은 통화 나열 방지: 닫는 기호 바로 뒤가 숫자면 무시.
      if (isDigit(src.charCodeAt(pos + 1))) return false;
      break;
    }
    if (code === 0x0a) return false; // 인라인 수식은 줄바꿈을 넘지 않는다
    pos += 1;
  }
  if (pos >= src.length || src.charCodeAt(pos) !== 0x24) return false;
  if (pos === start + 1) return false; // 빈 수식

  if (!silent) {
    const token = state.push('math_inline', 'math', 0);
    token.content = src.slice(start + 1, pos);
    token.markup = '$';
  }
  state.pos = pos + 1;
  return true;
}

/** `$$ ... $$` 또는 `\[ ... \]` 블록 수식 */
function blockMath(state, startLine, endLine, silent) {
  const startPos = state.bMarks[startLine] + state.tShift[startLine];
  const maxPos = state.eMarks[startLine];
  const firstLine = state.src.slice(startPos, maxPos);

  let opener = null;
  if (firstLine.startsWith('$$')) opener = { open: '$$', close: '$$' };
  else if (firstLine.startsWith('\\[')) opener = { open: '\\[', close: '\\]' };
  if (!opener) return false;
  if (silent) return true;

  let rest = firstLine.slice(opener.open.length);
  const lines = [];
  let line = startLine;
  let found = false;

  // 한 줄로 끝나는 형태: $$ x = 1 $$
  const inlineClose = rest.lastIndexOf(opener.close);
  if (inlineClose >= 0) {
    lines.push(rest.slice(0, inlineClose));
    found = true;
  } else {
    if (rest.trim()) lines.push(rest);
    while (!found && ++line < endLine) {
      const from = state.bMarks[line] + state.tShift[line];
      const to = state.eMarks[line];
      const text = state.src.slice(from, to);
      const closeAt = text.lastIndexOf(opener.close);
      if (closeAt >= 0) {
        const head = text.slice(0, closeAt);
        if (head.trim()) lines.push(head);
        found = true;
      } else {
        lines.push(text);
      }
    }
  }
  if (!found) return false;

  state.line = line + 1;
  const token = state.push('math_block', 'math', 0);
  token.block = true;
  token.content = lines.join('\n').trim();
  token.map = [startLine, state.line];
  token.markup = opener.open;
  return true;
}

export default function mathPlugin(md) {
  md.inline.ruler.before('escape', 'math_inline', inlineMath);
  md.block.ruler.before('fence', 'math_block', blockMath, {
    alt: ['paragraph', 'reference', 'blockquote', 'list'],
  });

  md.renderer.rules.math_inline = (tokens, idx) =>
    `<span class="math-inline">${renderTex(tokens[idx].content, false)}</span>`;

  md.renderer.rules.math_block = (tokens, idx) =>
    `<div class="math-block">${renderTex(tokens[idx].content, true)}</div>\n`;
}
