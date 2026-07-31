import test from 'node:test';
import assert from 'node:assert/strict';

import {
  renderMarkdown,
  createRenderer,
  splitFrontMatter,
  computeStats,
  SANITIZE_CONFIG,
} from '../../src/shared/markdown.mjs';

const render = (src, opts) => renderMarkdown(src, opts);

// ---------------------------------------------------------------------------
test('front matter — YAML 을 분리하고 본문만 렌더링한다', () => {
  const result = render('---\ntitle: 보고서\ntags: [a, b]\n---\n\n# 제목\n');
  assert.deepEqual(result.frontMatter, { title: '보고서', tags: ['a', 'b'] });
  assert.match(result.html, /<h1[^>]*>제목/);
  assert.doesNotMatch(result.html, /title: 보고서/);
});

test('front matter — 잘못된 YAML 은 본문으로 되돌린다', () => {
  const { data, body } = splitFrontMatter('---\n: : :\n---\n본문\n');
  assert.equal(data, null);
  assert.match(body, /^---/);
});

test('front matter — 없는 문서는 그대로 통과한다', () => {
  const { data, body, offset } = splitFrontMatter('# 그냥 제목\n');
  assert.equal(data, null);
  assert.equal(offset, 0);
  assert.equal(body, '# 그냥 제목\n');
});

// ---------------------------------------------------------------------------
test('제목 — 한글 슬러그와 앵커를 만든다', () => {
  const result = render('# 첫 번째 제목\n## 두 번째 제목\n');
  assert.deepEqual(
    result.headings.map((h) => [h.level, h.text, h.slug]),
    [
      [1, '첫 번째 제목', '첫-번째-제목'],
      [2, '두 번째 제목', '두-번째-제목'],
    ],
  );
  assert.match(result.html, /id="첫-번째-제목"/);
});

test('제목 — 중복 제목에 고유 슬러그를 부여한다', () => {
  const result = render('# 개요\n# 개요\n# 개요\n');
  assert.deepEqual(
    result.headings.map((h) => h.slug),
    ['개요', '개요-1', '개요-2'],
  );
});

test('제목 — 원본 라인 번호를 기록한다 (목차 이동용)', () => {
  const result = render('개요 문단\n\n## 두 번째 절\n');
  assert.equal(result.headings[0].line, 2);
});

test('제목 — front matter 가 있어도 라인 번호가 원본 기준이다', () => {
  const result = render('---\ntitle: x\n---\n\n# 제목\n');
  // 원본 5번째 줄(0-base 4)이 "# 제목"
  assert.equal(result.headings[0].line, 4);
  assert.match(result.html, /<h1[^>]*data-line="4"/);
});

// ---------------------------------------------------------------------------
test('표 — GFM 표를 가로 스크롤 컨테이너로 감싼다', () => {
  const result = render('| A | B |\n| --- | ---: |\n| 1 | 2 |\n');
  assert.match(result.html, /<div class="table-wrap"><table/);
  assert.match(result.html, /style="text-align:right"/);
  assert.match(result.html, /<\/table>\n<\/div>/);
});

test('체크리스트 — 체크박스와 라인 번호를 만든다', () => {
  const result = render('- [x] 완료\n- [ ] 미완\n');
  assert.match(result.html, /class="contains-task-list"/);
  assert.match(result.html, /task-list-item-checkbox/);
  assert.equal((result.html.match(/data-line="/g) || []).length >= 3, true);
});

// ---------------------------------------------------------------------------
test('Mermaid — 코드펜스를 다이어그램 자리표시자로 바꾼다', () => {
  const result = render('```mermaid\ngraph TD; A-->B;\n```\n');
  assert.equal(result.mermaid.length, 1);
  assert.equal(result.mermaid[0].code.trim(), 'graph TD; A-->B;');
  assert.match(result.html, /class="mermaid-block" id="mermaid-0" data-mermaid="pending"/);
  assert.match(result.html, /A--&gt;B/, 'mermaid 원본은 HTML 이스케이프되어야 한다');
});

test('Mermaid — mmd 별칭도 인식한다', () => {
  assert.equal(render('```mmd\ngraph LR; A-->B;\n```\n').mermaid.length, 1);
});

test('Mermaid — 여러 블록에 서로 다른 id 를 준다', () => {
  const result = render('```mermaid\ngraph TD; A-->B;\n```\n\n```mermaid\npie\n  "a": 1\n```\n');
  assert.deepEqual(result.mermaid.map((m) => m.id), ['mermaid-0', 'mermaid-1']);
});

test('Mermaid — 렌더링 사이에 상태가 남지 않는다', () => {
  const renderer = createRenderer();
  renderer.render('```mermaid\ngraph TD; A-->B;\n```\n');
  const second = renderer.render('# 다이어그램 없음\n');
  assert.equal(second.mermaid.length, 0);
  assert.equal(second.headings.length, 1);
});

// ---------------------------------------------------------------------------
test('코드 블록 — 하이라이팅과 복사 버튼을 붙인다', () => {
  const result = render('```js\nconst x = 1;\n```\n');
  assert.match(result.html, /data-lang="js"/);
  assert.match(result.html, /hljs-keyword/);
  assert.match(result.html, /data-action="copy-code"/);
});

test('코드 블록 — 알 수 없는 언어는 이스케이프만 한다', () => {
  const result = render('```어쩌구\n<script>alert(1)</script>\n```\n');
  assert.match(result.html, /&lt;script&gt;/);
  assert.doesNotMatch(result.html, /<script>/);
});

test('코드 블록 — 언어가 없으면 text 로 표시한다', () => {
  assert.match(render('```\nplain\n```\n').html, /data-lang="text"/);
});

test('코드 블록 — Claude 가 쓰는 언어 별칭이 모두 해석된다', async () => {
  const hljs = (await import('../../src/shared/highlight.mjs')).default;
  const aliases = [
    'py', 'python', 'js', 'javascript', 'jsx', 'ts', 'typescript', 'tsx',
    'sh', 'bash', 'shell', 'zsh', 'console', 'ps1', 'powershell',
    'yml', 'yaml', 'json', 'toml', 'ini', 'html', 'xml', 'css', 'scss',
    'sql', 'go', 'golang', 'rs', 'rust', 'java', 'kotlin', 'swift',
    'c', 'cpp', 'c++', 'cs', 'csharp', 'php', 'rb', 'ruby', 'r', 'lua',
    'diff', 'patch', 'dockerfile', 'makefile', 'graphql', 'markdown',
    'text', 'txt', 'plaintext',
  ];
  for (const alias of aliases) {
    assert.ok(hljs.getLanguage(alias), `별칭 미등록: ${alias}`);
  }
});

test('코드 블록 — 대표 언어에서 실제로 토큰이 칠해진다', () => {
  const cases = [
    ['py', 'def f(x):\n    return x + 1'],
    ['sh', 'if [ -f a.txt ]; then echo hi; fi'],
    ['yml', 'name: build\non: [push]'],
    ['ts', 'const x: number = 1;'],
    ['json', '{"a": 1}'],
    ['sql', 'SELECT * FROM t;'],
  ];
  for (const [lang, code] of cases) {
    const html = render(`\`\`\`${lang}\n${code}\n\`\`\`\n`).html;
    assert.match(html, /class="hljs-/, `${lang} 하이라이팅 실패`);
  }
});

// ---------------------------------------------------------------------------
test('이미지 — 상대 경로만 변환하고 절대 URL 은 그대로 둔다', () => {
  const result = render(
    '![a](./img/a.png)\n\n![b](https://x.test/b.png)\n\n![c](data:image/png;base64,AAA)\n',
    { resolveAsset: (href) => `RESOLVED:${href}` },
  );
  assert.match(result.html, /src="RESOLVED:.\/img\/a.png"/);
  assert.match(result.html, /src="https:\/\/x.test\/b.png"/);
  assert.match(result.html, /src="data:image\/png;base64,AAA"/);
});

test('이미지 — 지연 로딩을 쓰지 않는다 (화면 밖 이미지도 즉시 로드)', () => {
  const html = render('![a](./a.png)').html;
  assert.match(html, /decoding="async"/);
  assert.doesNotMatch(html, /loading="lazy"/);
});

test('이미지 — 한글/공백 파일명의 퍼센트 인코딩을 리졸버에 그대로 넘긴다', () => {
  const seen = [];
  render('![로고](./로고%20이미지.svg)', {
    resolveAsset: (href) => {
      seen.push(href);
      return 'OK';
    },
  });
  assert.equal(seen.length, 1);
  assert.match(decodeURIComponent(seen[0]), /로고 이미지\.svg$/);
});

test('이미지 — data URI 는 이미지 타입만 통과시킨다', () => {
  const allowed = [
    'data:image/png;base64,AAA',
    'data:image/gif;base64,AAA',
    'data:image/jpeg;base64,AAA',
    'data:image/webp;base64,AAA',
    'data:image/svg+xml;base64,AAA',
    'data:image/svg+xml,%3Csvg%3E%3C/svg%3E',
  ];
  for (const uri of allowed) {
    assert.match(render(`![x](${uri})`).html, /<img/, `허용되어야 함: ${uri}`);
  }

  const blocked = ['data:text/html;base64,AAA', 'data:application/javascript,alert(1)'];
  for (const uri of blocked) {
    assert.doesNotMatch(render(`![x](${uri})`).html, /<img[^>]*src=/, `차단되어야 함: ${uri}`);
  }
});

test('링크 — javascript: · vbscript: · file: 은 계속 차단한다', () => {
  for (const scheme of ['javascript:alert(1)', 'vbscript:msgbox(1)', 'file:///etc/passwd']) {
    const html = render(`[클릭](${scheme})`).html;
    assert.doesNotMatch(html, /href="(javascript|vbscript|file):/i, `차단되어야 함: ${scheme}`);
  }
});

test('링크 — data-doclink 는 퍼센트 디코딩된 실제 경로를 담는다', () => {
  const result = render('[보고서](./보고서-예시.md)');
  assert.match(result.html, /data-doclink="\.\/보고서-예시\.md"/);
});

test('링크 — 외부/내부 링크를 구분해 표시한다', () => {
  const result = render('[외부](https://x.test) [문서](./other.md) [앵커](#절)');
  assert.match(result.html, /data-external="1"/);
  assert.match(result.html, /rel="noopener noreferrer"/);
  assert.match(result.html, /data-doclink="\.\/other\.md"/);
  assert.doesNotMatch(result.html, /data-doclink="#/);
});

// ---------------------------------------------------------------------------
test('수식 — 인라인과 블록을 KaTeX 로 렌더링한다', () => {
  const result = render('인라인 $E=mc^2$ 입니다.\n\n$$\n\\int_0^1 x\\,dx\n$$\n');
  assert.match(result.html, /class="math-inline"/);
  assert.match(result.html, /class="math-block"/);
  assert.match(result.html, /katex/);
  assert.match(result.html, /<annotation encoding="application\/x-tex">E=mc\^2<\/annotation>/);
});

test('수식 — \\(...\\) 와 \\[...\\] 표기도 지원한다', () => {
  const inline = render('값은 \\(a^2 + b^2\\) 입니다.');
  assert.match(inline.html, /class="math-inline"/);
  const block = render('\\[\nx = 1\n\\]\n');
  assert.match(block.html, /class="math-block"/);
});

test('수식 — 통화 표기를 수식으로 오인하지 않는다', () => {
  const result = render('가격은 $100 이고 배송비는 $5 입니다.');
  assert.doesNotMatch(result.html, /katex/);
  assert.match(result.html, /\$100/);
});

test('수식 — 잘못된 수식은 오류 표시로 남기고 렌더링을 계속한다', () => {
  const result = render('$\\frac{1}{$\n\n다음 문단');
  assert.match(result.html, /다음 문단/);
});

test('수식 — 한 줄짜리 $$ ... $$ 도 처리한다', () => {
  assert.match(render('$$ a + b $$\n').html, /class="math-block"/);
});

// ---------------------------------------------------------------------------
test('확장 문법 — 각주·정의목록·형광펜·첨자를 지원한다', () => {
  const result = render(
    '본문[^1]\n\n[^1]: 각주 내용\n\n용어\n: 설명\n\n==강조== H~2~O x^2^\n',
  );
  assert.match(result.html, /class="footnotes"/);
  assert.match(result.html, /<dl[ >]/);
  assert.match(result.html, /<dt[^>]*>용어<\/dt>/);
  assert.match(result.html, /<dd[^>]*>설명<\/dd>/);
  assert.match(result.html, /<mark>강조<\/mark>/);
  assert.match(result.html, /<sub>2<\/sub>/);
  assert.match(result.html, /<sup>2<\/sup>/);
});

test('줄바꿈 — 단일 개행을 <br> 로 처리한다 (Claude 결과물 호환)', () => {
  assert.match(render('첫 줄\n둘째 줄\n').html, /<br>/);
});

// ---------------------------------------------------------------------------
test('통계 — 한글은 글자 수, 영문은 단어 수로 센다', () => {
  const stats = computeStats('안녕하세요 hello world 12');
  assert.equal(stats.words, 5 + 3); // 한글 5자 + 영문/숫자 3단어
  assert.equal(stats.lines, 1);
  assert.ok(stats.readingMinutes >= 1);
});

test('통계 — 빈 문서', () => {
  const stats = computeStats('');
  assert.equal(stats.chars, 0);
  assert.equal(stats.words, 0);
  assert.equal(stats.lines, 0);
});

// ---------------------------------------------------------------------------
test('정화 설정 — 위험한 태그/속성을 차단 목록에 둔다', () => {
  assert.ok(SANITIZE_CONFIG.FORBID_TAGS.includes('script'));
  assert.ok(SANITIZE_CONFIG.FORBID_TAGS.includes('iframe'));
  assert.ok(SANITIZE_CONFIG.ADD_ATTR.includes('data-line'));
  assert.equal(SANITIZE_CONFIG.USE_PROFILES.svg, true);
  assert.equal(SANITIZE_CONFIG.USE_PROFILES.mathMl, true);
});

test('정화 — DOMPurify 로 스크립트와 이벤트 핸들러를 제거한다', async () => {
  const { JSDOM } = await import('jsdom');
  const createDOMPurify = (await import('dompurify')).default;
  const purify = createDOMPurify(new JSDOM('').window);
  const sanitize = (html) => purify.sanitize(html, SANITIZE_CONFIG);

  const malicious = [
    '<script>alert(1)</script>',
    '<img src=x onerror="alert(1)">',
    '<a href="javascript:alert(1)">클릭</a>',
    '<iframe src="https://evil.test"></iframe>',
    '<svg><script>alert(1)</script></svg>',
  ].join('\n\n');

  const result = render(malicious, { sanitize });
  assert.doesNotMatch(result.html, /<script/i);
  assert.doesNotMatch(result.html, /onerror/i);
  assert.doesNotMatch(result.html, /javascript:/i);
  assert.doesNotMatch(result.html, /<iframe/i);
});

test('정화 — 표·체크박스·수식·다이어그램은 살아남는다', async () => {
  const { JSDOM } = await import('jsdom');
  const createDOMPurify = (await import('dompurify')).default;
  const purify = createDOMPurify(new JSDOM('').window);
  const sanitize = (html) => purify.sanitize(html, SANITIZE_CONFIG);

  const source = [
    '| A | B |',
    '| --- | --- |',
    '| 1 | 2 |',
    '',
    '- [x] 완료',
    '',
    '$E=mc^2$',
    '',
    '```mermaid',
    'graph TD; A-->B;',
    '```',
  ].join('\n');

  const result = render(source, { sanitize });
  assert.match(result.html, /<table/);
  assert.match(result.html, /type="checkbox"/);
  assert.match(result.html, /checked/);
  assert.match(result.html, /<math/);
  assert.match(result.html, /class="mermaid-block"/);
  assert.match(result.html, /data-mermaid="pending"/);
  assert.match(result.html, /data-line="/);
});

// ---------------------------------------------------------------------------
test('종합 — 샘플 문서를 문제 없이 렌더링한다', async () => {
  const fs = await import('node:fs/promises');
  const url = new URL('../../samples/기능-안내.md', import.meta.url);
  const source = await fs.readFile(url, 'utf8');

  const result = render(source);
  assert.ok(result.headings.length >= 10, '제목이 수집되어야 한다');
  assert.equal(result.mermaid.length, 6, 'mermaid 블록 6개');
  assert.match(result.html, /class="table-wrap"/);
  assert.match(result.html, /katex/);
  assert.match(result.html, /task-list-item/);
  assert.match(result.html, /class="footnotes"/);
  assert.equal(result.frontMatter.title, 'MarkView 기능 안내');
});
