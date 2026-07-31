/**
 * MarkView 마크다운 렌더링 파이프라인.
 *
 * 이 모듈은 Electron 에 의존하지 않는다 (Node 에서 그대로 import 가능).
 * 덕분에 렌더링 로직 전체를 단위 테스트로 검증할 수 있다.
 */
import MarkdownIt from 'markdown-it';
import anchor from 'markdown-it-anchor';
import footnote from 'markdown-it-footnote';
import taskLists from 'markdown-it-task-lists';
import deflist from 'markdown-it-deflist';
import mark from 'markdown-it-mark';
import sub from 'markdown-it-sub';
import sup from 'markdown-it-sup';
import hljs from './highlight.mjs';
import yaml from 'js-yaml';

import mathPlugin from './math.mjs';
import { makeSlugger } from './slug.mjs';

const HTML_ESCAPE = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => HTML_ESCAPE[c]);

/** 다이어그램으로 취급할 코드펜스 언어. */
const MERMAID_LANGS = new Set(['mermaid', 'mmd']);

/** 별도 처리 없이 그대로 두는 스킴. */
const ABSOLUTE_URL = /^(https?:|data:|mailto:|tel:|blob:|md-asset:|#)/i;

/**
 * 문서 안의 상대 경로를 표시 가능한 URL 로 바꾸는 기본 구현.
 * Electron 렌더러는 `md-asset://` 로 매핑하는 함수를 주입한다.
 */
const identityResolver = (href) => href;

/** 퍼센트 인코딩된 링크를 사람이 읽을 수 있는 경로로 되돌린다. */
function decodePath(href) {
  try {
    return decodeURIComponent(href);
  } catch {
    return href;
  }
}

// ---------------------------------------------------------------------------
// front matter
// ---------------------------------------------------------------------------

const FRONT_MATTER = /^﻿?(?:---|\+\+\+)\r?\n([\s\S]*?)\r?\n(?:---|\+\+\+)[ \t]*(?:\r?\n|$)/;

export function splitFrontMatter(source) {
  const text = String(source ?? '');
  const match = text.match(FRONT_MATTER);
  if (!match) return { data: null, body: text, offset: 0 };

  let data = null;
  try {
    const parsed = yaml.load(match[1]);
    data = parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    data = null; // YAML 이 깨져 있으면 본문으로 되돌린다.
  }
  if (data === null) return { data: null, body: text, offset: 0 };

  const consumed = match[0];
  const offset = consumed.split('\n').length - 1;
  return { data, body: text.slice(consumed.length), offset };
}

// ---------------------------------------------------------------------------
// 통계
// ---------------------------------------------------------------------------

const CJK = /[ㄱ-ㆎ가-힣一-鿿぀-ヿ]/g;
const LATIN_WORD = /[A-Za-z0-9_'’-]+/g;

export function computeStats(text) {
  const src = String(text ?? '');
  const cjk = (src.match(CJK) || []).length;
  const latin = (src.replace(CJK, ' ').match(LATIN_WORD) || []).length;
  const words = cjk + latin;
  return {
    chars: [...src].length,
    charsNoSpace: [...src.replace(/\s/g, '')].length,
    words,
    lines: src.length === 0 ? 0 : src.split(/\r\n|\r|\n/).length,
    // 한국어 평균 독서 속도 ≈ 분당 500자, 영문 ≈ 분당 250단어
    readingMinutes: Math.max(1, Math.round(cjk / 500 + latin / 250)),
  };
}

// ---------------------------------------------------------------------------
// markdown-it 인스턴스
// ---------------------------------------------------------------------------

function highlightCode(code, lang) {
  if (lang && hljs.getLanguage(lang)) {
    try {
      return hljs.highlight(code, { language: lang, ignoreIllegals: true }).value;
    } catch {
      /* 아래 escape 로 폴백 */
    }
  }
  return escapeHtml(code);
}

/**
 * 렌더러를 만든다. 문서마다 상태(헤딩 목록 등)가 달라지므로
 * `render()` 호출 시점에 컨텍스트를 주입한다.
 */
export function createRenderer(options = {}) {
  const ctx = {
    headings: [],
    mermaid: [],
    resolveAsset: identityResolver,
    resolveLink: identityResolver,
    lineOffset: 0,
    counter: 0,
  };

  const md = new MarkdownIt({
    html: options.allowHtml !== false,
    linkify: true,
    breaks: options.lineBreaks !== false, // Claude 결과물은 줄바꿈이 의미를 갖는 경우가 많다
    typographer: false,
    langPrefix: 'hljs language-',
  });

  /**
   * markdown-it 기본 정책은 `data:image/{gif,png,jpeg,webp}` 만 허용하고
   * `data:image/svg+xml` 은 막는다. 하지만 <img> 로 불러오는 SVG 안의 스크립트는
   * 브라우저가 실행하지 않으므로, 이 한 가지만 추가로 허용한다.
   * javascript: · vbscript: · file: 차단은 그대로 유지한다.
   */
  const BAD_PROTO = /^(vbscript|javascript|file|data):/;
  const GOOD_DATA = /^data:image\/(gif|png|jpeg|webp|svg\+xml)[;,]/;
  md.validateLink = (url) => {
    const value = url.trim().toLowerCase();
    return BAD_PROTO.test(value) ? GOOD_DATA.test(value) : true;
  };

  md.use(mathPlugin)
    .use(footnote)
    .use(deflist)
    .use(mark)
    .use(sub)
    .use(sup)
    .use(taskLists, { enabled: true, label: true, labelAfter: false });

  // 헤딩 앵커 + 아웃라인 수집
  md.use(anchor, {
    level: [1, 2, 3, 4, 5, 6],
    slugify: (s) => ctx.slugify(s),
    permalink: anchor.permalink.linkInsideHeader({
      symbol: '#',
      class: 'heading-anchor',
      placement: 'after',
      ariaHidden: true,
    }),
    callback(token, info) {
      ctx.headings.push({
        level: Number(token.tag.slice(1)),
        text: info.title,
        slug: info.slug,
        // front matter 를 잘라낸 만큼 더해 원본 파일 기준 라인으로 되돌린다.
        line: (token.map ? token.map[0] : 0) + ctx.lineOffset,
      });
    },
  });

  // ---- 스크롤 동기화를 위한 원본 라인 번호 주입 --------------------------
  md.core.ruler.push('markview_line_numbers', (state) => {
    for (const token of state.tokens) {
      if (!token.map) continue;
      if (token.nesting === 1 || token.type === 'fence' || token.type === 'hr' || token.type === 'html_block') {
        token.attrSet('data-line', String(token.map[0] + ctx.lineOffset));
      }
    }
  });

  // ---- 이미지 / 링크 경로 해석 -------------------------------------------
  md.core.ruler.push('markview_resolve_urls', (state) => {
    const walk = (tokens) => {
      for (const token of tokens) {
        if (token.type === 'image') {
          const src = token.attrGet('src');
          if (src && !ABSOLUTE_URL.test(src)) token.attrSet('src', ctx.resolveAsset(src));
          // 로컬 파일이므로 lazy 로딩은 이득이 없고, 화면 밖 이미지가 영영 안 뜨는 문제만 만든다.
          token.attrSet('decoding', 'async');
        } else if (token.type === 'link_open') {
          const href = token.attrGet('href') || '';
          const resolved = ABSOLUTE_URL.test(href) ? href : ctx.resolveLink(href);
          token.attrSet('href', resolved);
          if (/^https?:/i.test(resolved)) {
            token.attrSet('rel', 'noopener noreferrer');
            token.attrSet('data-external', '1');
          } else if (!resolved.startsWith('#')) {
            // markdown-it 이 퍼센트 인코딩한 것을 되돌려 실제 경로로 저장한다.
            token.attrSet('data-doclink', decodePath(href));
          }
        }
        if (token.children && token.children.length) walk(token.children);
      }
    };
    walk(state.tokens);
  });

  // ---- 코드펜스: mermaid 는 플레이스홀더, 나머지는 하이라이팅 -----------
  md.renderer.rules.fence = (tokens, idx) => {
    const token = tokens[idx];
    const info = (token.info || '').trim();
    const lang = info.split(/\s+/)[0].toLowerCase();
    const lineAttr = token.attrGet('data-line');
    const dataLine = lineAttr ? ` data-line="${escapeHtml(lineAttr)}"` : '';

    if (MERMAID_LANGS.has(lang)) {
      const id = `mermaid-${ctx.counter++}`;
      ctx.mermaid.push({ id, code: token.content });
      return (
        `<figure class="mermaid-block" id="${id}" data-mermaid="pending"${dataLine}>` +
        `<pre class="mermaid-source">${escapeHtml(token.content)}</pre>` +
        `</figure>\n`
      );
    }

    const label = lang ? escapeHtml(lang) : 'text';
    const highlighted = highlightCode(token.content, lang);
    return (
      `<div class="code-block" data-lang="${label}"${dataLine}>` +
      `<div class="code-toolbar"><span class="code-lang">${label}</span>` +
      `<button type="button" class="code-copy" data-action="copy-code" title="코드 복사">복사</button></div>` +
      `<pre class="hljs"><code class="language-${label}">${highlighted}</code></pre>` +
      `</div>\n`
    );
  };

  // 표는 가로 스크롤 컨테이너로 감싼다 (넓은 표가 레이아웃을 깨지 않도록)
  md.renderer.rules.table_open = (tokens, idx, opts, _env, self) =>
    `<div class="table-wrap">${self.renderToken(tokens, idx, opts)}`;
  md.renderer.rules.table_close = (tokens, idx, opts, _env, self) =>
    `${self.renderToken(tokens, idx, opts)}</div>`;

  /**
   * @param {string} source 마크다운 원문 (front matter 제외 여부는 opts 로 제어)
   * @param {object} opts
   *   - resolveAsset(href) 상대 이미지 경로 → 표시용 URL
   *   - resolveLink(href)  상대 문서 링크 → 표시용 URL
   *   - sanitize(html)     신뢰할 수 없는 HTML 정화 함수
   */
  function render(source, opts = {}) {
    const { data: frontMatter, body, offset } = splitFrontMatter(source);

    ctx.headings = [];
    ctx.mermaid = [];
    ctx.counter = 0;
    ctx.slugify = makeSlugger();
    ctx.resolveAsset = opts.resolveAsset || identityResolver;
    ctx.resolveLink = opts.resolveLink || identityResolver;
    ctx.lineOffset = offset;

    let html = md.render(body);
    if (typeof opts.sanitize === 'function') html = opts.sanitize(html);

    return {
      html,
      headings: ctx.headings.slice(),
      mermaid: ctx.mermaid.slice(),
      frontMatter,
      stats: computeStats(source),
    };
  }

  return { md, render };
}

/** 단발성 렌더링을 위한 편의 함수. */
export function renderMarkdown(source, opts = {}) {
  return createRenderer(opts).render(source, opts);
}

/**
 * DOMPurify 의 기본 URI 화이트리스트에 `md-asset:` 을 추가한 정규식.
 * 이게 없으면 로컬 이미지의 src 가 통째로 제거된다.
 */
export const ALLOWED_URI_REGEXP =
  /^(?:(?:(?:f|ht)tps?|mailto|tel|callto|sms|cid|xmpp|md-asset):|[^a-z]|[a-z+.\-]+(?:[^a-z+.\-:]|$))/i;

/** DOMPurify 설정 — mermaid SVG, KaTeX MathML, 체크박스를 살려둔다. */
export const SANITIZE_CONFIG = {
  ALLOWED_URI_REGEXP,
  USE_PROFILES: { html: true, svg: true, svgFilters: true, mathMl: true },
  ADD_TAGS: ['figure', 'figcaption', 'details', 'summary', 'kbd', 'mark', 'abbr', 'time'],
  ADD_ATTR: [
    'target',
    'rel',
    'loading',
    'align',
    'colspan',
    'rowspan',
    'checked',
    'disabled',
    'type',
    'start',
    'reversed',
    'id',
    'class',
    'style',
    'data-line',
    'data-lang',
    'data-mermaid',
    'data-external',
    'data-doclink',
    'data-action',
  ],
  ALLOW_DATA_ATTR: true,
  FORBID_TAGS: ['script', 'iframe', 'object', 'embed', 'form', 'base', 'meta', 'link'],
  FORBID_ATTR: ['srcdoc', 'formaction', 'ping'],
};
