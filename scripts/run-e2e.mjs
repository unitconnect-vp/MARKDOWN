#!/usr/bin/env node
/**
 * 실제 Electron 창을 띄워 앱을 검증하는 시뮬레이션.
 *
 *   npm run test:e2e            (헤드리스 환경이면 자동으로 xvfb-run 사용)
 *
 * 검사 항목: 로컬 이미지 실제 로딩, Mermaid SVG 생성, KaTeX, 표/체크리스트,
 * 편집→미리보기 반영, 테마 전환, 저장, HTML/PDF 내보내기, XSS 차단,
 * 문서 폴더 밖 파일 접근 차단, 콘솔 오류 없음.
 */
import { _electron as electron } from 'playwright-core';
import electronPath from 'electron';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = path.join(ROOT, 'test-results');

/**
 * 기본은 소스 트리를 그대로 실행한다.
 * `--packaged <앱디렉터리>` 를 주면 패키징된 앱(asar + extraResources)을 검증한다.
 * → asar 안에서의 경로 해석, resources/samples 배치 같은 "포장 후에만 깨지는" 문제를 잡는다.
 */
const packagedIndex = process.argv.indexOf('--packaged');
const PACKAGED_DIR = packagedIndex >= 0 ? path.resolve(process.argv[packagedIndex + 1]) : null;
const SAMPLES = PACKAGED_DIR ? path.join(PACKAGED_DIR, 'resources', 'samples') : path.join(ROOT, 'samples');

// ---- 헤드리스 환경이면 xvfb 아래에서 자기 자신을 다시 실행 -----------------
if (!process.env.DISPLAY && process.platform === 'linux' && !process.env.MARKVIEW_E2E_NESTED) {
  const result = spawnSync('xvfb-run', ['-a', process.execPath, fileURLToPath(import.meta.url), ...process.argv.slice(2)], {
    stdio: 'inherit',
    env: { ...process.env, MARKVIEW_E2E_NESTED: '1' },
  });
  process.exit(result.status ?? 1);
}

// ---------------------------------------------------------------------------
// 초소형 테스트 하네스
// ---------------------------------------------------------------------------
const results = [];
let failed = 0;

async function check(name, fn) {
  const started = Date.now();
  try {
    await fn();
    results.push({ name, ok: true, ms: Date.now() - started });
    console.log(`  [32m✓[0m ${name} [90m(${Date.now() - started}ms)[0m`);
  } catch (error) {
    failed += 1;
    results.push({ name, ok: false, ms: Date.now() - started, error: String(error?.message || error) });
    console.log(`  [31m✗ ${name}[0m`);
    console.log(`      ${String(error?.message || error).split('\n').join('\n      ')}`);
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
function assertEqual(actual, expected, message) {
  if (actual !== expected) throw new Error(`${message}\n  기대: ${expected}\n  실제: ${actual}`);
}

const section = (title) => console.log(`\n[1m${title}[0m`);

// ---------------------------------------------------------------------------

/** 어딘가에서 멈추더라도 CI 가 몇 시간씩 돌지 않도록 전체 시간을 제한한다. */
const WATCHDOG_MS = Number(process.env.MARKVIEW_E2E_TIMEOUT_MS || 10 * 60 * 1000);
const watchdog = setTimeout(() => {
  console.error(`\n\x1b[31mE2E 전체 제한 시간(${Math.round(WATCHDOG_MS / 1000)}초) 초과 — 중단합니다.\x1b[0m`);
  process.exit(1);
}, WATCHDOG_MS);
watchdog.unref();

async function main() {
  await fs.rm(OUT_DIR, { recursive: true, force: true });
  await fs.mkdir(OUT_DIR, { recursive: true });
  const userData = await fs.mkdtemp(path.join(os.tmpdir(), 'markview-e2e-'));

  console.log(`\n[1mMarkView E2E 시뮬레이션[0m`);
  console.log(`[90m대상: ${PACKAGED_DIR ? `패키징된 앱 (${path.relative(ROOT, PACKAGED_DIR)})` : '소스 트리'}[0m`);
  console.log(`[90m결과물: ${path.relative(ROOT, OUT_DIR)}/[0m`);

  // 패키징된 앱은 자체 실행 파일을, 개발 모드는 electron + 프로젝트 경로를 쓴다.
  // CI 러너는 /dev/shm 이 작아 --disable-dev-shm-usage 없이는 Chromium 이 멈출 수 있다.
  const CHROMIUM_FLAGS = [
    '--no-sandbox',
    '--disable-gpu',
    '--disable-dev-shm-usage',
    '--disable-software-rasterizer',
    `--user-data-dir=${userData}`,
  ];
  const launchOptions = PACKAGED_DIR
    ? {
        executablePath: path.join(PACKAGED_DIR, process.platform === 'win32' ? 'MarkView.exe' : 'markview'),
        args: CHROMIUM_FLAGS,
      }
    : {
        executablePath: electronPath,
        args: ['.', ...CHROMIUM_FLAGS],
        cwd: ROOT,
      };

  const app = await electron.launch({
    ...launchOptions,
    timeout: 60_000,
  });

  const page = await app.firstWindow({ timeout: 60_000 });

  const consoleErrors = [];
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('pageerror', (error) => consoleErrors.push(`pageerror: ${error.message}`));

  // 테스트 중에 실제 파일 탐색기/브라우저가 뜨지 않도록 셸 연동을 막는다.
  // (CI 러너에서 xdg-open 이 파이어폭스를 띄워 프로세스가 남았다)
  await app.evaluate(({ shell }) => {
    shell.showItemInFolder = () => {};
    shell.openExternal = async () => {};
    shell.openPath = async () => '';
  });

  await page.waitForFunction(() => document.documentElement.dataset.markviewReady === '1', null, { timeout: 60_000 });

  // -------------------------------------------------------------------------
  section('1. 앱 기동');

  await check('창이 열리고 렌더러가 준비된다', async () => {
    const title = await page.title();
    assertEqual(title, 'MarkView', '문서 제목');
  });

  await check('환영 문서가 렌더링된다', async () => {
    const text = await page.locator('#preview h1').first().innerText();
    assert(text.includes('환영합니다'), `h1 내용: ${text}`);
  });

  await check('편집기(CodeMirror)가 초기화된다', async () => {
    assertEqual(await page.locator('.cm-editor').count(), 1, 'CodeMirror 인스턴스 수');
  });

  // -------------------------------------------------------------------------
  section('2. 샘플 문서 열기 (이미지 · 다이어그램 · 수식)');

  const samplePath = path.join(SAMPLES, '기능-안내.md');
  await check('한글 파일명 문서를 연다', async () => {
    const ok = await page.evaluate((p) => window.__markview.openPath(p).then((d) => Boolean(d)), samplePath);
    assert(ok, 'openPath 실패');
    await page.waitForFunction(
      () => document.querySelectorAll('#preview .mermaid-block').length > 0,
      null,
      { timeout: 20_000 },
    );
  });

  await check('탭이 만들어지고 제목이 표시된다', async () => {
    const names = await page.locator('.tab .tab-name').allInnerTexts();
    assert(names.includes('기능-안내.md'), `탭 목록: ${JSON.stringify(names)}`);
  });

  await check('front matter 가 속성 카드로 표시된다', async () => {
    // <details> 는 접혀 있으면 innerText 가 비므로 textContent 로 확인한다.
    const text = await page.locator('#preview details.front-matter').evaluate((node) => node.textContent);
    assert(text.includes('MarkView 기능 안내'), `front matter: ${text}`);
    assert(text.includes('version'), 'front matter 키가 표시되지 않음');
  });

  await check('목차 패널에 제목이 채워진다', async () => {
    const count = await page.locator('.outline-item').count();
    assert(count >= 10, `목차 항목 수: ${count}`);
  });

  // ---- 이미지: 실제로 픽셀이 로드됐는지 -----------------------------------
  await check('로컬 이미지가 실제로 로드된다 (PNG · SVG · 한글/공백 파일명 · HTML img · data URI)', async () => {
    await page.waitForFunction(
      () => {
        const images = [...document.querySelectorAll('#preview img')];
        return images.length >= 4 && images.every((img) => img.complete);
      },
      null,
      { timeout: 20_000 },
    );

    const report = await page.evaluate(() =>
      [...document.querySelectorAll('#preview img')].map((img) => ({
        src: img.getAttribute('src'),
        alt: img.getAttribute('alt'),
        width: img.naturalWidth,
        height: img.naturalHeight,
      })),
    );

    assert(report.length >= 4, `이미지 개수: ${report.length}`);
    const broken = report.filter((img) => img.width === 0 || img.height === 0);
    assert(
      broken.length === 0,
      `로드 실패한 이미지:\n${broken.map((b) => `    ${b.alt} → ${b.src}`).join('\n')}`,
    );

    // 각 유형이 최소 하나씩 존재하는지
    assert(report.some((i) => /screenshot\.png/.test(i.src)), 'PNG 상대 경로 이미지 없음');
    assert(report.some((i) => /%EB%A1%9C%EA%B3%A0|로고/.test(decodeURIComponent(i.src))), '한글/공백 파일명 SVG 없음');
    assert(report.some((i) => /chart\.png/.test(i.src)), 'HTML <img> 태그 이미지 없음');
    assert(report.some((i) => i.src.startsWith('data:')), 'data URI 이미지 없음');
    assert(report.every((i) => !/^file:/.test(i.src)), 'file:// 로 직접 노출된 이미지가 있음');
  });

  // ---- Mermaid ------------------------------------------------------------
  await check('Mermaid 다이어그램 6종이 모두 SVG 로 그려진다', async () => {
    await page.waitForFunction(
      () => {
        const blocks = [...document.querySelectorAll('#preview .mermaid-block')];
        return blocks.length > 0 && blocks.every((b) => b.dataset.mermaid !== 'pending');
      },
      null,
      { timeout: 60_000 },
    );

    const report = await page.evaluate(() =>
      [...document.querySelectorAll('#preview .mermaid-block')].map((block) => {
        const svg = block.querySelector('svg');
        const rect = svg?.getBoundingClientRect();
        return {
          state: block.dataset.mermaid,
          hasSvg: Boolean(svg),
          width: Math.round(rect?.width || 0),
          height: Math.round(rect?.height || 0),
          error: block.querySelector('.mermaid-error-msg')?.textContent || null,
          kind: (block.querySelector('.mermaid-source')?.textContent || '').trim().split(/\s|\n/)[0],
        };
      }),
    );

    assertEqual(report.length, 6, '다이어그램 블록 수');
    const bad = report.filter((r) => r.state !== 'done' || !r.hasSvg || r.width < 40 || r.height < 20);
    assert(
      bad.length === 0,
      `그려지지 않은 다이어그램:\n${bad.map((b) => `    ${b.kind}: state=${b.state} ${b.width}x${b.height} ${b.error || ''}`).join('\n')}`,
    );
    console.log(
      `      → ${report.map((r) => `${r.kind}(${r.width}×${r.height})`).join(', ')}`,
    );
  });

  // ---- KaTeX --------------------------------------------------------------
  await check('KaTeX 수식이 렌더링된다 (인라인 · 블록 · 행렬)', async () => {
    const stats = await page.evaluate(() => ({
      inline: document.querySelectorAll('#preview .math-inline .katex').length,
      block: document.querySelectorAll('#preview .math-block .katex').length,
      errors: document.querySelectorAll('#preview .katex-error').length,
      mathml: document.querySelectorAll('#preview math').length,
      width: Math.round(document.querySelector('#preview .math-block .katex')?.getBoundingClientRect().width || 0),
    }));
    assert(stats.inline >= 2, `인라인 수식 수: ${stats.inline}`);
    assert(stats.block >= 2, `블록 수식 수: ${stats.block}`);
    assertEqual(stats.errors, 0, 'KaTeX 오류 수');
    assert(stats.mathml > 0, 'MathML 접근성 노드 없음');
    assert(stats.width > 50, `블록 수식 폭: ${stats.width}`);
  });

  await check('통화 표기($100)는 수식으로 오인되지 않는다', async () => {
    const text = await page.locator('#preview').innerText();
    assert(text.includes('$100'), '$100 텍스트가 사라짐');
  });

  // ---- 표 · 체크리스트 · 코드 ---------------------------------------------
  await check('GFM 표가 렌더링되고 정렬이 적용된다', async () => {
    const info = await page.evaluate(() => {
      const table = document.querySelector('#preview .table-wrap table');
      return {
        exists: Boolean(table),
        rows: table?.querySelectorAll('tbody tr').length || 0,
        rightAligned: document.querySelectorAll('#preview td[style*="right"]').length,
      };
    });
    assert(info.exists, '표가 없음');
    assert(info.rows >= 5, `표 행 수: ${info.rows}`);
    assert(info.rightAligned > 0, '오른쪽 정렬 셀 없음');
  });

  await check('코드 블록이 하이라이팅되고 복사 버튼이 있다', async () => {
    const info = await page.evaluate(() => ({
      blocks: document.querySelectorAll('#preview .code-block').length,
      tokens: document.querySelectorAll('#preview .code-block [class^="hljs-"]').length,
      copy: document.querySelectorAll('#preview .code-copy').length,
      langs: [...document.querySelectorAll('#preview .code-block')].map((b) => b.dataset.lang),
    }));
    assert(info.blocks >= 5, `코드 블록 수: ${info.blocks}`);
    assert(info.tokens > 30, `하이라이팅 토큰 수: ${info.tokens}`);
    assertEqual(info.copy, info.blocks, '복사 버튼 수');
    for (const lang of ['python', 'javascript', 'sql', 'bash', 'diff']) {
      assert(info.langs.includes(lang), `${lang} 코드 블록 없음`);
    }
  });

  await check('미리보기 체크박스를 누르면 원본 마크다운도 바뀐다', async () => {
    const before = await page.evaluate(() => window.__markview.getState().docs.find((d) => d.dirty)?.name || null);
    assertEqual(before, null, '열자마자 수정됨 상태이면 안 됨');

    const box = page.locator('#preview .task-list-item-checkbox').nth(3); // "- [ ] 아직 안 한 일"
    await box.check();
    await page.waitForTimeout(500);

    const state = await page.evaluate(() => ({
      dirty: window.__markview.getState().docs.some((d) => d.dirty),
      checked: document.querySelectorAll('#preview .task-list-item-checkbox:checked').length,
      source: window.__markview.getText(),
    }));
    assert(state.dirty, '원본이 수정됨으로 표시되지 않음');
    assert(state.checked >= 4, `체크된 항목 수: ${state.checked}`);
    assert(state.source.includes('- [x] 아직 안 한 일'), '원본 마크다운이 [x] 로 바뀌지 않음');

    // 다음 검사에 영향이 없도록 디스크 내용으로 되돌린다.
    await page.evaluate(() => window.__markview.discardChanges());
    await page.waitForTimeout(300);
  });

  // -------------------------------------------------------------------------
  section('3. 편집 · 반응성');

  await check('편집기 입력이 미리보기에 반영된다', async () => {
    await page.evaluate(() => window.__markview.setText('# 실시간 반영 테스트\n\n**굵게** 그리고 `코드`\n'));
    await page.waitForFunction(
      () => document.querySelector('#preview h1')?.textContent?.includes('실시간 반영 테스트'),
      null,
      { timeout: 10_000 },
    );
    const html = await page.locator('#preview').innerHTML();
    assert(html.includes('<strong>굵게</strong>'), '굵게 서식 미반영');
    assert(html.includes('<code>코드</code>'), '인라인 코드 미반영');
  });

  await check('새로 입력한 Mermaid 블록도 즉시 그려진다', async () => {
    await page.evaluate(() =>
      window.__markview.setText('# 새 다이어그램\n\n```mermaid\nflowchart LR\n  A[입력] --> B[출력]\n```\n'),
    );
    await page.waitForFunction(
      () => document.querySelector('#preview .mermaid-block[data-mermaid="done"] svg') !== null,
      null,
      { timeout: 30_000 },
    );
    const size = await page.evaluate(() => {
      const rect = document.querySelector('#preview .mermaid-block svg').getBoundingClientRect();
      return { w: Math.round(rect.width), h: Math.round(rect.height) };
    });
    assert(size.w > 40 && size.h > 20, `SVG 크기: ${size.w}x${size.h}`);
  });

  await check('잘못된 Mermaid 문법은 오류 표시만 하고 앱을 죽이지 않는다', async () => {
    await page.evaluate(() =>
      window.__markview.setText('# 오류 테스트\n\n```mermaid\n이건 절대 유효하지 않은 문법 @@@ >>> !!!\n```\n\n정상 문단입니다.\n'),
    );
    await page.waitForFunction(
      () => document.querySelector('#preview .mermaid-block')?.dataset.mermaid !== 'pending',
      null,
      { timeout: 30_000 },
    );
    const info = await page.evaluate(() => ({
      state: document.querySelector('#preview .mermaid-block')?.dataset.mermaid,
      hasMessage: Boolean(document.querySelector('#preview .mermaid-error-msg')),
      sourceVisible: Boolean(document.querySelector('#preview .mermaid-source')),
      paragraph: document.body.innerText.includes('정상 문단입니다'),
    }));
    assertEqual(info.state, 'error', '오류 상태');
    assert(info.hasMessage, '오류 메시지가 표시되지 않음');
    assert(info.sourceVisible, '원본 소스 폴백이 보이지 않음');
    assert(info.paragraph, '나머지 본문이 사라짐');
  });

  await check('통계(단어/글자/읽기 시간)가 갱신된다', async () => {
    await page.evaluate(() => window.__markview.setText('안녕하세요 반갑습니다 hello world\n'));
    await page.waitForTimeout(400);
    const text = await page.locator('#statusCount').innerText();
    assert(/단어/.test(text) && /자/.test(text), `상태바: ${text}`);
    const stats = await page.evaluate(() => window.__markview.getState().stats);
    assertEqual(stats.words, 10 + 2, '한글 10자 + 영문 2단어');
  });

  // -------------------------------------------------------------------------
  section('4. 보안 (신뢰할 수 없는 마크다운)');

  await check('script · onerror · javascript: · iframe 이 모두 제거된다', async () => {
    await page.evaluate(() =>
      window.__markview.setText(
        [
          '# 보안 테스트',
          '',
          '<script>window.__pwned = true;</script>',
          '',
          '<img src="x" onerror="window.__pwned = true">',
          '',
          '<a href="javascript:window.__pwned=true">클릭</a>',
          '',
          '<iframe src="https://evil.test"></iframe>',
          '',
          '<svg onload="window.__pwned = true"></svg>',
        ].join('\n'),
      ),
    );
    await page.waitForTimeout(500);
    const result = await page.evaluate(() => ({
      pwned: Boolean(window.__pwned),
      scripts: document.querySelectorAll('#preview script').length,
      iframes: document.querySelectorAll('#preview iframe').length,
      onerror: document.querySelector('#preview [onerror]') !== null,
      jsHref: document.querySelector('#preview a[href^="javascript:"]') !== null,
    }));
    assert(!result.pwned, 'XSS 페이로드가 실행됨');
    assertEqual(result.scripts, 0, 'script 태그 수');
    assertEqual(result.iframes, 0, 'iframe 수');
    assert(!result.onerror, 'onerror 속성이 남아 있음');
    assert(!result.jsHref, 'javascript: 링크가 남아 있음');
  });

  await check('문서 폴더 밖의 파일은 md-asset 프로토콜이 거부한다', async () => {
    const status = await page.evaluate(async () => {
      const url = `md-asset://local/asset?p=${encodeURIComponent('/etc/passwd')}`;
      try {
        const response = await fetch(url);
        return response.status;
      } catch {
        return 'blocked';
      }
    });
    assert(status === 403 || status === 404 || status === 'blocked', `응답 상태: ${status} (차단되어야 함)`);
  });

  await check('깨진 이미지 경로는 눈에 띄게 표시된다', async () => {
    await page.evaluate(() => window.__markview.setText('![없는 그림](./존재하지-않는-파일.png)\n'));
    await page.waitForFunction(
      () => document.querySelector('#preview img.broken-asset') !== null,
      null,
      { timeout: 10_000 },
    );
    assertEqual(await page.locator('#preview img.broken-asset').count(), 1, '깨진 이미지 표시 수');
  });

  // -------------------------------------------------------------------------
  section('5. 보기 · 테마');

  await check('보기 모드 전환(편집 / 분할 / 미리보기)', async () => {
    for (const mode of ['editor', 'preview', 'split']) {
      await page.evaluate((m) => window.__markview.runCommand(`view:${m}`), mode);
      await page.waitForTimeout(120);
      assertEqual(await page.evaluate(() => document.getElementById('app').dataset.view), mode, `모드 ${mode}`);
    }
    assert(await page.locator('#editorPane').isVisible(), '분할 모드에서 편집기가 보여야 함');
    assert(await page.locator('#previewPane').isVisible(), '분할 모드에서 미리보기가 보여야 함');
  });

  await check('목차 패널 토글', async () => {
    await page.evaluate(() => window.__markview.runCommand('view:outline'));
    await page.waitForTimeout(120);
    assert(!(await page.locator('#outlinePane').isVisible()), '목차가 숨겨져야 함');
    await page.evaluate(() => window.__markview.runCommand('view:outline'));
    await page.waitForTimeout(120);
    assert(await page.locator('#outlinePane').isVisible(), '목차가 다시 보여야 함');
  });

  await check('확대/축소가 미리보기 글자 크기에 반영된다', async () => {
    const before = await page.evaluate(() => getComputedStyle(document.getElementById('preview')).fontSize);
    await page.evaluate(() => window.__markview.runCommand('view:zoomIn'));
    await page.waitForTimeout(150);
    const after = await page.evaluate(() => getComputedStyle(document.getElementById('preview')).fontSize);
    assert(parseFloat(after) > parseFloat(before), `${before} → ${after}`);
    await page.evaluate(() => window.__markview.runCommand('view:zoomReset'));
  });

  await check('다크 테마 전환 시 다이어그램이 다시 그려진다', async () => {
    await page.evaluate((p) => window.__markview.openPath(p), samplePath);
    await page.waitForFunction(
      () =>
        [...document.querySelectorAll('#preview .mermaid-block')].length === 6 &&
        [...document.querySelectorAll('#preview .mermaid-block')].every((b) => b.dataset.mermaid === 'done'),
      null,
      { timeout: 60_000 },
    );

    await page.evaluate(() => window.__markview.runCommand('view:toggleTheme'));
    await page.waitForFunction(() => document.documentElement.dataset.theme === 'dark', null, { timeout: 10_000 });
    await page.waitForFunction(
      () => [...document.querySelectorAll('#preview .mermaid-block')].every((b) => b.dataset.mermaid === 'done'),
      null,
      { timeout: 60_000 },
    );

    const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    assert(bg !== 'rgb(255, 255, 255)', `다크 배경색: ${bg}`);
    const svgCount = await page.locator('#preview .mermaid-block svg').count();
    assertEqual(svgCount, 6, '다크 테마 재렌더 후 SVG 수');

    await page.screenshot({ path: path.join(OUT_DIR, '02-다크테마.png'), fullPage: false });
  });

  await check('라이트 테마로 되돌리고 각 구역을 캡처한다', async () => {
    await page.evaluate(() => window.__markview.runCommand('view:toggleTheme'));
    await page.waitForFunction(() => document.documentElement.dataset.theme === 'light', null, { timeout: 10_000 });
    await page.waitForFunction(
      () => [...document.querySelectorAll('#preview .mermaid-block')].every((b) => b.dataset.mermaid === 'done'),
      null,
      { timeout: 60_000 },
    );
    await page.screenshot({ path: path.join(OUT_DIR, '01-라이트테마.png') });

    // 미리보기만 보이게 한 뒤 주요 구역으로 스크롤해 시각적 증거를 남긴다.
    await page.evaluate(() => window.__markview.runCommand('view:preview'));
    await page.waitForTimeout(200);

    const shots = [
      ['4-이미지', '04-이미지.png'],
      ['5-mermaid-다이어그램', '05-다이어그램.png'],
      ['6-수식-katex', '06-수식.png'],
      ['3-표', '07-표.png'],
    ];
    for (const [slug, file] of shots) {
      const scrolled = await page.evaluate((s) => {
        const target = document.querySelector(`#preview [id="${CSS.escape(s)}"]`);
        if (!target) return false;
        target.scrollIntoView({ block: 'start' });
        return true;
      }, slug);
      assert(scrolled, `앵커를 찾지 못함: ${slug}`);
      await page.waitForTimeout(400);
      await page.screenshot({ path: path.join(OUT_DIR, file) });
    }

    await page.evaluate(() => window.__markview.runCommand('view:split'));
    await page.waitForTimeout(200);
  });

  // -------------------------------------------------------------------------
  section('6. 탭 · 문서 간 링크');

  await check('문서 링크를 누르면 새 탭으로 열린다', async () => {
    const link = page.locator('#preview a[data-doclink$="보고서-예시.md"]').first();
    await link.click();
    await page.waitForFunction(
      () => window.__markview.getState().docs.some((d) => d.name === '보고서-예시.md'),
      null,
      { timeout: 15_000 },
    );
    const names = await page.evaluate(() => window.__markview.getState().docs.map((d) => d.name));
    assert(names.includes('보고서-예시.md'), `탭 목록: ${JSON.stringify(names)}`);
  });

  await check('두 번째 문서의 이미지와 다이어그램도 정상 렌더링된다', async () => {
    await page.waitForFunction(
      () => {
        const images = [...document.querySelectorAll('#preview img')];
        const blocks = [...document.querySelectorAll('#preview .mermaid-block')];
        return (
          images.length > 0 &&
          images.every((i) => i.complete && i.naturalWidth > 0) &&
          blocks.length > 0 &&
          blocks.every((b) => b.dataset.mermaid === 'done')
        );
      },
      null,
      { timeout: 40_000 },
    );
    await page.screenshot({ path: path.join(OUT_DIR, '03-보고서-예시.png') });
  });

  // -------------------------------------------------------------------------
  section('7. 저장 · 내보내기');

  const savePath = path.join(OUT_DIR, '저장-테스트.md');
  await check('다른 이름으로 저장이 실제 파일을 만든다', async () => {
    await app.evaluate(({ dialog }, target) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: target });
    }, savePath);

    await page.evaluate(() => window.__markview.runCommand('file:new'));
    await page.evaluate(() => window.__markview.setText('# 저장 테스트\n\n한글 내용이 그대로 저장되어야 합니다.\n'));
    await page.waitForTimeout(300);
    await page.evaluate(() => window.__markview.runCommand('file:saveAs'));
    await page.waitForTimeout(1200);

    const saved = await fs.readFile(savePath, 'utf8');
    assert(saved.includes('# 저장 테스트'), `저장된 내용: ${saved.slice(0, 80)}`);
    assert(saved.includes('한글 내용이 그대로'), 'UTF-8 한글 손상');

    const active = await page.evaluate(() => {
      const s = window.__markview.getState();
      return s.docs.find((d) => d.id === s.activeId);
    });
    assert(!active.dirty, '저장 후에도 수정됨 표시가 남아 있음');
    assertEqual(active.name, '저장-테스트.md', '탭 이름이 저장한 파일명으로 갱신되어야 함');
  });

  const htmlPath = path.join(OUT_DIR, '내보내기.html');
  await check('HTML 내보내기가 이미지·다이어그램을 포함한 단일 파일을 만든다', async () => {
    await page.evaluate((p) => window.__markview.openPath(p), samplePath);
    await page.waitForFunction(
      () =>
        [...document.querySelectorAll('#preview .mermaid-block')].length === 6 &&
        [...document.querySelectorAll('#preview .mermaid-block')].every((b) => b.dataset.mermaid === 'done') &&
        [...document.querySelectorAll('#preview img')].every((i) => i.complete),
      null,
      { timeout: 60_000 },
    );

    await app.evaluate(({ dialog }, target) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: target });
    }, htmlPath);

    await page.evaluate(() => window.__markview.runCommand('export:html'));
    await page.waitForTimeout(3000);

    const html = await fs.readFile(htmlPath, 'utf8');
    const stat = await fs.stat(htmlPath);
    assert(html.startsWith('<!doctype html>'), 'HTML 문서 형식이 아님');
    assert(!/md-asset:/.test(html), 'md-asset:// 참조가 남아 있음 (이미지 인라인 실패)');
    assert(!/src="\.\//.test(html), '상대 경로 이미지 참조가 남아 있음');
    assertEqual((html.match(/data:image\/png;base64,/g) || []).length >= 2, true, 'PNG 인라인 개수');
    assert((html.match(/<svg/g) || []).length >= 6, 'Mermaid SVG 가 포함되지 않음');
    assert(/@font-face/.test(html) && /data:font\/woff2/.test(html), 'KaTeX 폰트가 인라인되지 않음');
    assert(/class="katex"/.test(html), 'KaTeX 출력 없음');
    assert(/<table/.test(html), '표 없음');
    console.log(`      → ${(stat.size / 1024).toFixed(0)} KB, 완전 자립형(외부 참조 0)`);
  });

  const pdfPath = path.join(OUT_DIR, '내보내기.pdf');
  await check('PDF 내보내기가 유효한 PDF 를 만든다', async () => {
    await app.evaluate(({ dialog }, target) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: target });
    }, pdfPath);

    await page.evaluate(() => window.__markview.runCommand('export:pdf'));
    await page.waitForTimeout(8000);

    const buffer = await fs.readFile(pdfPath);
    assertEqual(buffer.subarray(0, 5).toString(), '%PDF-', 'PDF 시그니처');
    assert(buffer.length > 50_000, `PDF 크기가 너무 작음: ${buffer.length} bytes`);
    const pages = (buffer.toString('latin1').match(/\/Type\s*\/Page[^s]/g) || []).length;
    assert(pages >= 3, `PDF 페이지 수: ${pages}`);
    console.log(`      → ${(buffer.length / 1024).toFixed(0)} KB, ${pages} 페이지`);
  });

  // -------------------------------------------------------------------------
  section('8. 콘솔 위생');

  await check('치명적인 콘솔 오류가 없다', async () => {
    const ignorable = [
      /Autofill/i,
      /devtools/i,
      /Request Autofill/i,
      /^$/,
      /GPU|gpu_/i,
      /Failed to load resource.*존재하지-않는-파일/i, // 의도적인 깨진 이미지 테스트
      /net::ERR_.*존재하지-않는/i,
      /md-asset:\/\/local\/asset\?p=%2Fetc%2Fpasswd/i, // 의도적인 접근 차단 테스트
      /Failed to load resource: the server responded with a status of 40[34]/i,
    ];
    const real = consoleErrors.filter((message) => !ignorable.some((re) => re.test(message)));
    assert(
      real.length === 0,
      `콘솔 오류 ${real.length}건:\n${real.slice(0, 10).map((m) => `    ${m}`).join('\n')}`,
    );
  });

  await check('CSP 위반이 발생하지 않는다', async () => {
    const violations = consoleErrors.filter((m) => /Content Security Policy/i.test(m));
    assert(violations.length === 0, `CSP 위반:\n${violations.map((m) => `    ${m}`).join('\n')}`);
  });

  // -------------------------------------------------------------------------
  // -------------------------------------------------------------------------
  section('9. 종료');

  // 종료 확인을 렌더러에 위임하는 구조라, 렌더러가 응답하지 못하면 창이 영영 닫히지
  // 않는다. (실제로 CI 에서 이 문제로 잡이 멈췄다) 제한 시간 안에 닫히는지 검사한다.
  await check('앱이 제한 시간 안에 정상 종료된다', async () => {
    const started = Date.now();
    const closed = await Promise.race([
      app.close().then(() => true).catch(() => true),
      new Promise((resolve) => setTimeout(() => resolve(false), 20_000)),
    ]);
    const elapsed = Date.now() - started;
    assert(closed, `20초 안에 종료되지 않음 (${elapsed}ms 경과) — 종료 확인 절차가 막혀 있을 수 있음`);
    return `${elapsed}ms`;
  });

  clearTimeout(watchdog);
  try {
    const child = app.process();
    if (child && child.exitCode === null) child.kill('SIGKILL');
  } catch {
    /* 이미 종료됨 */
  }
  await fs.rm(userData, { recursive: true, force: true }).catch(() => {});

  // -------------------------------------------------------------------------
  const passed = results.filter((r) => r.ok).length;
  console.log(`\n${'─'.repeat(60)}`);
  console.log(
    failed === 0
      ? `[32m✓ 전체 통과 — ${passed}/${results.length}[0m`
      : `[31m✗ 실패 ${failed}건 — ${passed}/${results.length} 통과[0m`,
  );
  console.log(`스크린샷·산출물: ${path.relative(ROOT, OUT_DIR)}/`);

  await fs.writeFile(
    path.join(OUT_DIR, 'e2e-report.json'),
    JSON.stringify({ passed, failed, total: results.length, results }, null, 2),
    'utf8',
  );

  process.exit(failed === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error('\n[31mE2E 실행 실패:[0m', error);
  process.exit(1);
});
