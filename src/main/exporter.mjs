/**
 * 내보내기: 단일 HTML 파일 / PDF.
 *
 * 렌더러가 이미 완성한 미리보기 DOM(HTML 문자열)을 넘겨주면,
 * 여기서 CSS·폰트·이미지를 전부 인라인해 "어디서나 열리는" 파일로 만든다.
 */
import { BrowserWindow } from 'electron';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

import { fromAssetUrl } from './assets.mjs';

const MIME = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.bmp': 'image/bmp',
  '.ico': 'image/x-icon',
  '.avif': 'image/avif',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
};

/** 인라인 대상 이미지 최대 크기 (그 이상은 원본 경로 유지). */
const MAX_INLINE_BYTES = 12 * 1024 * 1024;

async function toDataUri(filePath) {
  const buf = await fs.readFile(filePath);
  const mime = MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream';
  return `data:${mime};base64,${buf.toString('base64')}`;
}

/** export 용 스타일시트를 읽고 폰트를 data URI 로 치환한다. */
let cachedCss = null;
async function loadExportCss(distDir) {
  if (cachedCss) return cachedCss;
  const cssPath = path.join(distDir, 'export', 'style.css');
  let css = await fs.readFile(cssPath, 'utf8');

  const urls = [...new Set([...css.matchAll(/url\(["']?([^"')]+)["']?\)/g)].map((m) => m[1]))];
  for (const url of urls) {
    if (/^(data:|https?:)/i.test(url)) continue;
    const fontPath = path.resolve(path.dirname(cssPath), url);
    try {
      const dataUri = await toDataUri(fontPath);
      css = css.split(url).join(dataUri);
    } catch {
      /* 폰트가 없으면 그대로 둔다 */
    }
  }
  cachedCss = css;
  return css;
}

/** `md-asset://` / 상대 경로 이미지를 data URI 로 치환. */
async function inlineImages(html, docDir) {
  const tasks = [];
  const replacements = new Map();

  const srcPattern = /(<img\b[^>]*?\bsrc=)(["'])(.*?)\2/gi;
  for (const match of html.matchAll(srcPattern)) {
    const raw = match[3];
    if (!raw || replacements.has(raw)) continue;
    if (/^(data:|https?:)/i.test(raw)) continue;

    let absolute = fromAssetUrl(raw);
    if (!absolute) {
      if (/^[a-z][a-z0-9+.-]*:/i.test(raw)) continue; // 알 수 없는 스킴
      absolute = path.resolve(docDir || process.cwd(), decodeURIComponent(raw));
    }
    replacements.set(raw, absolute);
    tasks.push(
      (async () => {
        try {
          const stat = await fs.stat(absolute);
          if (stat.size > MAX_INLINE_BYTES) {
            replacements.set(raw, null);
            return;
          }
          replacements.set(raw, await toDataUri(absolute));
        } catch {
          replacements.set(raw, null);
        }
      })(),
    );
  }

  await Promise.all(tasks);

  return html.replace(srcPattern, (whole, prefix, quote, raw) => {
    const value = replacements.get(raw);
    return value ? `${prefix}${quote}${value}${quote}` : whole;
  });
}

/**
 * 자체 완결형 HTML 문서를 만든다.
 * @returns {Promise<string>} 완성된 HTML
 */
export async function buildStandaloneHtml({ html, title, docPath, distDir, theme = 'light' }) {
  const css = await loadExportCss(distDir);
  const body = await inlineImages(html, docPath ? path.dirname(docPath) : null);
  const safeTitle = String(title || 'Markdown')
    .replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]);

  return `<!doctype html>
<html lang="ko" data-theme="${theme === 'dark' ? 'dark' : 'light'}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="generator" content="MarkView">
<title>${safeTitle}</title>
<style>
${css}
</style>
</head>
<body class="markview-export">
<article class="markdown-body">
${body}
</article>
</body>
</html>
`;
}

export async function exportHtml(options) {
  const html = await buildStandaloneHtml(options);
  await fs.writeFile(options.outPath, html, 'utf8');
  return options.outPath;
}

export async function exportPdf(options) {
  const html = await buildStandaloneHtml({ ...options, theme: 'light' });
  const tempFile = path.join(
    await fs.mkdtemp(path.join(os.tmpdir(), 'markview-')),
    'print.html',
  );
  await fs.writeFile(tempFile, html, 'utf8');

  const win = new BrowserWindow({
    show: false,
    webPreferences: { offscreen: true, javascript: false, sandbox: true, contextIsolation: true },
  });

  try {
    await win.loadFile(tempFile);
    // 웹폰트/레이아웃이 안정될 시간을 준다.
    await new Promise((resolve) => setTimeout(resolve, 400));
    const pdf = await win.webContents.printToPDF({
      printBackground: true,
      pageSize: options.pageSize || 'A4',
      margins: { marginType: 'custom', top: 0.5, bottom: 0.5, left: 0.5, right: 0.5 },
      preferCSSPageSize: false,
    });
    await fs.writeFile(options.outPath, pdf);
    return options.outPath;
  } finally {
    if (!win.isDestroyed()) win.destroy();
    fs.rm(path.dirname(tempFile), { recursive: true, force: true }).catch(() => {});
  }
}
