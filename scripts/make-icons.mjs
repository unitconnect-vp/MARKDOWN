/**
 * 앱 아이콘과 샘플 이미지를 만든다.
 * 별도 래스터라이저 의존성 없이 Electron 자체로 SVG → PNG 변환한다.
 *
 *   npx electron scripts/make-icons.mjs
 */
import { app, BrowserWindow } from 'electron';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const ICON_SVG = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#3b82f6"/>
      <stop offset="55%" stop-color="#2563eb"/>
      <stop offset="100%" stop-color="#1e3a8a"/>
    </linearGradient>
    <linearGradient id="paper" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#ffffff"/>
      <stop offset="100%" stop-color="#eef2f8"/>
    </linearGradient>
    <filter id="shadow" x="-30%" y="-30%" width="160%" height="160%">
      <feDropShadow dx="0" dy="10" stdDeviation="14" flood-color="#0b1b3a" flood-opacity="0.35"/>
    </filter>
  </defs>

  <rect x="16" y="16" width="480" height="480" rx="108" fill="url(#bg)"/>
  <rect x="16" y="16" width="480" height="480" rx="108" fill="none" stroke="#ffffff" stroke-opacity="0.18" stroke-width="3"/>

  <!-- 문서 -->
  <g filter="url(#shadow)">
    <path d="M132 108h168l80 80v216a28 28 0 0 1-28 28H132a28 28 0 0 1-28-28V136a28 28 0 0 1 28-28z" fill="url(#paper)"/>
    <path d="M300 108l80 80h-56a24 24 0 0 1-24-24z" fill="#c7d5ec"/>
  </g>

  <!-- 마크다운 화살표 마크 -->
  <g fill="none" stroke="#2563eb" stroke-width="22" stroke-linecap="round" stroke-linejoin="round">
    <path d="M150 320V232l46 54 46-54v88"/>
    <path d="M300 232v74"/>
    <path d="M272 288l28 32 28-32"/>
  </g>

  <!-- 다이어그램 힌트 -->
  <g fill="#22c55e">
    <circle cx="150" cy="372" r="13"/>
    <circle cx="222" cy="372" r="13"/>
    <circle cx="294" cy="372" r="13"/>
  </g>
  <g stroke="#22c55e" stroke-width="8" stroke-linecap="round">
    <path d="M163 372h46"/>
    <path d="M235 372h46"/>
  </g>
</svg>`;

const SCREENSHOT_SVG = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 720 380">
  <defs>
    <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#eff6ff"/>
      <stop offset="100%" stop-color="#dbeafe"/>
    </linearGradient>
  </defs>
  <rect width="720" height="380" fill="url(#sky)"/>
  <rect x="0" y="0" width="720" height="44" fill="#1e40af"/>
  <circle cx="26" cy="22" r="7" fill="#f87171"/><circle cx="50" cy="22" r="7" fill="#fbbf24"/><circle cx="74" cy="22" r="7" fill="#4ade80"/>
  <text x="104" y="28" font-family="sans-serif" font-size="15" fill="#dbeafe">로컬 이미지 렌더링 테스트</text>

  <g font-family="sans-serif">
    <rect x="40" y="80" width="300" height="120" rx="10" fill="#ffffff" stroke="#93c5fd" stroke-width="2"/>
    <text x="60" y="115" font-size="19" font-weight="700" fill="#1e3a8a">상대 경로 이미지</text>
    <text x="60" y="145" font-size="14" fill="#475569">./assets/screenshot.png</text>
    <text x="60" y="172" font-size="14" fill="#475569">문서 폴더 기준으로 해석됩니다.</text>

    <rect x="380" y="80" width="300" height="120" rx="10" fill="#ffffff" stroke="#93c5fd" stroke-width="2"/>
    <text x="400" y="115" font-size="19" font-weight="700" fill="#1e3a8a">한글 파일명 지원</text>
    <text x="400" y="145" font-size="14" fill="#475569">공백·한글·퍼센트 인코딩 모두 OK</text>

    <g>
      <rect x="40" y="228" width="640" height="112" rx="10" fill="#1e293b"/>
      <text x="64" y="264" font-size="14" font-family="monospace" fill="#7ee2a8">![스크린샷](./assets/screenshot.png)</text>
      <text x="64" y="292" font-size="14" font-family="monospace" fill="#93c5fd">&lt;img src="assets/chart.png" width="420"&gt;</text>
      <text x="64" y="320" font-size="14" font-family="monospace" fill="#fbbf24">![](./assets/로고 이미지.svg)</text>
    </g>
  </g>
</svg>`;

const CHART_SVG = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 360">
  <rect width="640" height="360" fill="#ffffff"/>
  <text x="40" y="46" font-family="sans-serif" font-size="20" font-weight="700" fill="#0f172a">분기별 처리 문서 수</text>
  <g stroke="#e2e8f0" stroke-width="1">
    <line x1="70" y1="300" x2="600" y2="300"/>
    <line x1="70" y1="240" x2="600" y2="240"/>
    <line x1="70" y1="180" x2="600" y2="180"/>
    <line x1="70" y1="120" x2="600" y2="120"/>
    <line x1="70" y1="80" x2="600" y2="80"/>
  </g>
  <g font-family="sans-serif" font-size="12" fill="#64748b">
    <text x="34" y="304">0</text><text x="28" y="244">50</text>
    <text x="22" y="184">100</text><text x="22" y="124">150</text>
  </g>
  <g>
    <rect x="110" y="216" width="64" height="84" rx="4" fill="#93c5fd"/>
    <rect x="230" y="168" width="64" height="132" rx="4" fill="#60a5fa"/>
    <rect x="350" y="120" width="64" height="180" rx="4" fill="#3b82f6"/>
    <rect x="470" y="84" width="64" height="216" rx="4" fill="#2563eb"/>
  </g>
  <g font-family="sans-serif" font-size="13" fill="#334155" text-anchor="middle">
    <text x="142" y="322">1분기</text><text x="262" y="322">2분기</text>
    <text x="382" y="322">3분기</text><text x="502" y="322">4분기</text>
  </g>
  <g font-family="sans-serif" font-size="13" font-weight="700" fill="#1e3a8a" text-anchor="middle">
    <text x="142" y="208">70</text><text x="262" y="160">110</text>
    <text x="382" y="112">150</text><text x="502" y="76">180</text>
  </g>
</svg>`;

const LOGO_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 80" width="240" height="80">
  <rect width="240" height="80" rx="12" fill="#0f172a"/>
  <circle cx="44" cy="40" r="18" fill="#22c55e"/>
  <text x="76" y="48" font-family="sans-serif" font-size="24" font-weight="700" fill="#f8fafc">MarkView</text>
</svg>
`;

/** 16~32px 에서는 세부 묘사가 뭉개지므로 단순화한 글리프를 쓴다. */
const ICON_SVG_SMALL = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <defs>
    <linearGradient id="bg2" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#3b82f6"/>
      <stop offset="100%" stop-color="#1e40af"/>
    </linearGradient>
  </defs>
  <rect x="8" y="8" width="496" height="496" rx="96" fill="url(#bg2)"/>
  <g fill="none" stroke="#ffffff" stroke-width="46" stroke-linecap="round" stroke-linejoin="round">
    <path d="M112 350V162l72 86 72-86v188"/>
    <path d="M384 162v150"/>
    <path d="M330 268l54 62 54-62"/>
  </g>
</svg>`;

let tempDir = null;
let tempSeq = 0;
/** 창을 여러 개 만들면 오프스크린 렌더러가 불안정해서 하나를 재사용한다. */
let sharedWindow = null;

/** SVG 를 지정 크기로 그려 nativeImage 로 돌려준다. */
async function renderImage(svg, size) {
  if (!tempDir) tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'markview-icons-'));
  const htmlPath = path.join(tempDir, `icon-${tempSeq++}.html`);
  await fs.writeFile(
    htmlPath,
    `<!doctype html><meta charset="utf-8"><style>
      html,body{margin:0;padding:0;width:${size}px;height:${size}px;background:transparent;overflow:hidden}
      svg{display:block;width:${size}px;height:${size}px}
    </style>${svg}`,
    'utf8',
  );
  if (!sharedWindow) {
    sharedWindow = new BrowserWindow({
      width: size,
      height: size,
      show: false,
      frame: false,
      transparent: true,
      backgroundColor: '#00000000',
      useContentSize: true,
      webPreferences: { sandbox: true },
    });
  }
  sharedWindow.setContentSize(size, size);
  await sharedWindow.loadFile(htmlPath);
  await new Promise((r) => setTimeout(r, 220));
  return sharedWindow.webContents.capturePage({ x: 0, y: 0, width: size, height: size });
}

/**
 * BGRA 비트맵을 ICO 안에 들어가는 DIB(BITMAPINFOHEADER + XOR + AND) 로 만든다.
 * 작은 크기는 PNG 보다 DIB 가 호환성이 좋다.
 */
function toDib(bgraTopDown, size) {
  const header = Buffer.alloc(40);
  header.writeUInt32LE(40, 0); // biSize
  header.writeInt32LE(size, 4); // biWidth
  header.writeInt32LE(size * 2, 8); // biHeight (XOR + AND)
  header.writeUInt16LE(1, 12); // biPlanes
  header.writeUInt16LE(32, 14); // biBitCount
  header.writeUInt32LE(0, 16); // biCompression = BI_RGB

  // XOR: 아래에서 위로 쌓는다
  const xor = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y += 1) {
    bgraTopDown.copy(xor, (size - 1 - y) * size * 4, y * size * 4, (y + 1) * size * 4);
  }

  // AND 마스크: 32bpp 알파를 쓰므로 전부 0(불투명)이면 된다. 행은 4바이트 정렬.
  const maskRow = Math.ceil(size / 32) * 4;
  const and = Buffer.alloc(maskRow * size, 0);

  header.writeUInt32LE(xor.length + and.length, 20); // biSizeImage
  return Buffer.concat([header, xor, and]);
}

/** ICONDIR + ICONDIRENTRY[] + 이미지 데이터. */
function buildIco(entries) {
  const dir = Buffer.alloc(6 + entries.length * 16);
  dir.writeUInt16LE(0, 0);
  dir.writeUInt16LE(1, 2); // type = icon
  dir.writeUInt16LE(entries.length, 4);

  let offset = dir.length;
  entries.forEach((entry, index) => {
    const at = 6 + index * 16;
    dir.writeUInt8(entry.size >= 256 ? 0 : entry.size, at);
    dir.writeUInt8(entry.size >= 256 ? 0 : entry.size, at + 1);
    dir.writeUInt8(0, at + 2); // 팔레트 없음
    dir.writeUInt8(0, at + 3);
    dir.writeUInt16LE(1, at + 4); // planes
    dir.writeUInt16LE(32, at + 6); // bit count
    dir.writeUInt32LE(entry.data.length, at + 8);
    dir.writeUInt32LE(offset, at + 12);
    offset += entry.data.length;
  });

  return Buffer.concat([dir, ...entries.map((e) => e.data)]);
}

async function makeIco(outPath) {
  const sizes = [16, 24, 32, 48, 64, 128, 256];
  const entries = [];
  for (const size of sizes) {
    const image = await renderImage(size <= 32 ? ICON_SVG_SMALL : ICON_SVG, size);
    // 256 만 PNG 압축(파일 크기), 나머지는 DIB(호환성)
    const data = size === 256 ? image.toPNG() : toDib(image.toBitmap(), size);
    entries.push({ size, data });
  }
  const ico = buildIco(entries);
  await fs.mkdir(path.dirname(outPath), { recursive: true });
  await fs.writeFile(outPath, ico);
  console.log(`생성: ${path.relative(ROOT, outPath)} (${sizes.join(', ')}px, ${(ico.length / 1024).toFixed(0)} KB)`);
}

async function rasterize(svg, width, height, outPath) {
  if (!tempDir) tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'markview-icons-'));
  const htmlPath = path.join(tempDir, `frame-${tempSeq++}.html`);
  const html = `<!doctype html><meta charset="utf-8"><style>
      html,body{margin:0;padding:0;width:${width}px;height:${height}px;background:transparent;overflow:hidden}
      svg{display:block;width:${width}px;height:${height}px}
    </style>${svg}`;
  await fs.writeFile(htmlPath, html, 'utf8');

  if (!sharedWindow) {
    sharedWindow = new BrowserWindow({
      width,
      height,
      show: false,
      frame: false,
      transparent: true,
      backgroundColor: '#00000000',
      useContentSize: true,
      webPreferences: { sandbox: true },
    });
  }
  sharedWindow.setContentSize(width, height);
  await sharedWindow.loadFile(htmlPath);
  await new Promise((r) => setTimeout(r, 300));
  const image = await sharedWindow.webContents.capturePage({ x: 0, y: 0, width, height });
  await fs.mkdir(path.dirname(outPath), { recursive: true });
  await fs.writeFile(outPath, image.toPNG());
  console.log(`생성: ${path.relative(ROOT, outPath)} (${width}×${height})`);
}

app.disableHardwareAcceleration();

app.whenReady().then(async () => {
  try {
    await rasterize(ICON_SVG, 512, 512, path.join(ROOT, 'build/icon.png'));
    await makeIco(path.join(ROOT, 'build/icon.ico'));
    await rasterize(SCREENSHOT_SVG, 720, 380, path.join(ROOT, 'samples/assets/screenshot.png'));
    await rasterize(CHART_SVG, 640, 360, path.join(ROOT, 'samples/assets/chart.png'));

    await fs.mkdir(path.join(ROOT, 'samples/assets'), { recursive: true });
    await fs.writeFile(path.join(ROOT, 'samples/assets/로고 이미지.svg'), LOGO_SVG, 'utf8');
    console.log('생성: samples/assets/로고 이미지.svg');
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  }
  app.quit();
});
