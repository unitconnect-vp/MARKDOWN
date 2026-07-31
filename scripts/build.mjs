#!/usr/bin/env node
/**
 * esbuild 번들링:
 *   dist/main/index.js      (CJS, Electron 메인)
 *   dist/preload/index.js   (CJS, 프리로드)
 *   dist/renderer/app.js    (IIFE — file:// 에서는 ES 모듈을 못 쓴다)
 *   dist/renderer/app.css   (+ KaTeX 폰트)
 *   dist/renderer/mermaid.js(지연 로드용 별도 번들)
 *   dist/export/style.css   (HTML/PDF 내보내기용, 폰트 포함)
 */
import * as esbuild from 'esbuild';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(ROOT, 'dist');
const watch = process.argv.includes('--watch');

const FONT_LOADERS = {
  '.woff': 'file',
  '.woff2': 'file',
  '.ttf': 'file',
  '.eot': 'file',
  '.svg': 'file',
  '.png': 'file',
};

const shared = {
  bundle: true,
  minify: !watch,
  sourcemap: watch ? 'inline' : false,
  logLevel: 'info',
  legalComments: 'none',
  define: { 'process.env.NODE_ENV': JSON.stringify(watch ? 'development' : 'production') },
};

/**
 * 소스는 ESM 이지만 Electron 메인/프리로드는 CJS 로 번들한다.
 * CJS 에서는 `import.meta.url` 이 비어 버리므로 동등한 값으로 치환해 준다.
 * (이걸 빠뜨리면 메인 프로세스가 로드 시점에 조용히 죽는다)
 */
const nodeInterop = {
  banner: { js: "const __importMetaUrl = require('node:url').pathToFileURL(__filename).href;" },
  define: { ...shared.define, 'import.meta.url': '__importMetaUrl' },
};

/** @type {esbuild.BuildOptions[]} */
const configs = [
  {
    ...shared,
    ...nodeInterop,
    entryPoints: [path.join(ROOT, 'src/main/index.mjs')],
    outfile: path.join(DIST, 'main/index.js'),
    platform: 'node',
    format: 'cjs',
    target: 'node20',
    external: ['electron'],
  },
  {
    ...shared,
    ...nodeInterop,
    entryPoints: [path.join(ROOT, 'src/preload/index.mjs')],
    outfile: path.join(DIST, 'preload/index.js'),
    platform: 'node',
    format: 'cjs',
    target: 'node20',
    external: ['electron'],
  },
  {
    ...shared,
    entryPoints: [path.join(ROOT, 'src/renderer/app.mjs')],
    outfile: path.join(DIST, 'renderer/app.js'),
    platform: 'browser',
    format: 'iife',
    target: 'chrome128',
    loader: { ...FONT_LOADERS },
    assetNames: 'assets/[name]-[hash]',
  },
  {
    ...shared,
    entryPoints: [path.join(ROOT, 'src/renderer/mermaid-entry.mjs')],
    outfile: path.join(DIST, 'renderer/mermaid.js'),
    platform: 'browser',
    format: 'iife',
    target: 'chrome128',
    loader: { ...FONT_LOADERS },
    assetNames: 'assets/[name]-[hash]',
  },
  {
    ...shared,
    entryPoints: [path.join(ROOT, 'src/renderer/styles/export.css')],
    outfile: path.join(DIST, 'export/style.css'),
    platform: 'browser',
    loader: { ...FONT_LOADERS },
    assetNames: 'assets/[name]-[hash]',
  },
];

async function copyStatic() {
  await fs.mkdir(path.join(DIST, 'renderer'), { recursive: true });
  await fs.copyFile(path.join(ROOT, 'src/renderer/index.html'), path.join(DIST, 'renderer/index.html'));
  // BrowserWindow 아이콘(리눅스/개발용). Windows 실행 파일 아이콘은 electron-builder 가 넣는다.
  try {
    await fs.copyFile(path.join(ROOT, 'build/icon.png'), path.join(DIST, 'icon.png'));
  } catch {
    console.warn('build/icon.png 이 없습니다 — `npm run icons` 로 생성하세요.');
  }
}

/**
 * KaTeX 는 woff2/woff/ttf 세 벌을 모두 배포한다. Chromium 은 woff2 만 있으면 되므로
 * 나머지를 CSS 에서 지우고 파일도 삭제한다 (약 1MB × 2 절감).
 */
async function pruneLegacyFonts() {
  for (const dir of [path.join(DIST, 'renderer'), path.join(DIST, 'export')]) {
    const cssFiles = (await fs.readdir(dir)).filter((name) => name.endsWith('.css'));
    for (const name of cssFiles) {
      const cssPath = path.join(dir, name);
      const original = await fs.readFile(cssPath, 'utf8');
      const pruned = original
        .replace(/,\s*url\((["']?)[^)]*\.woff\1\)\s*format\((["']?)woff\2\)/g, '')
        .replace(/,\s*url\((["']?)[^)]*\.ttf\1\)\s*format\((["']?)truetype\2\)/g, '');
      if (pruned !== original) await fs.writeFile(cssPath, pruned, 'utf8');
    }

    const assetDir = path.join(dir, 'assets');
    let assets = [];
    try {
      assets = await fs.readdir(assetDir);
    } catch {
      continue;
    }
    const css = (await Promise.all(cssFiles.map((n) => fs.readFile(path.join(dir, n), 'utf8')))).join('\n');
    for (const asset of assets) {
      if (!css.includes(asset)) await fs.rm(path.join(assetDir, asset), { force: true });
    }
  }
}

async function report() {
  const rows = [];
  const walk = async (dir, prefix = '') => {
    for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) await walk(full, `${prefix}${entry.name}/`);
      else {
        const { size } = await fs.stat(full);
        if (size > 20 * 1024) rows.push([`${prefix}${entry.name}`, size]);
      }
    }
  };
  await walk(DIST);
  rows.sort((a, b) => b[1] - a[1]);
  const total = rows.reduce((sum, [, size]) => sum + size, 0);
  console.log('\n번들 크기 (20KB 이상):');
  for (const [name, size] of rows) console.log(`  ${(size / 1024).toFixed(0).padStart(6)} KB  ${name}`);
  console.log(`  ${'-'.repeat(30)}\n  ${(total / 1024 / 1024).toFixed(2)} MB 합계\n`);
}

async function main() {
  await fs.rm(DIST, { recursive: true, force: true });
  await copyStatic();

  if (watch) {
    for (const config of configs) {
      const context = await esbuild.context(config);
      await context.watch();
    }
    console.log('watch 모드로 빌드 중… (Ctrl+C 로 종료)');
    return;
  }

  const built = await Promise.all(configs.map((config) => esbuild.build(config)));

  // 경고를 그냥 흘려보내면(예: cjs 에서 비어 버리는 import.meta) 런타임에만 터진다.
  const warnings = built.flatMap((result) => result.warnings || []);
  if (warnings.length) {
    console.error(`\n빌드 경고 ${warnings.length}건 — 배포를 중단합니다:`);
    for (const warning of warnings) {
      const where = warning.location ? `${warning.location.file}:${warning.location.line}` : '';
      console.error(`  • ${warning.text} ${where}`);
    }
    process.exit(1);
  }

  // app.css 는 app.mjs 가 CSS 를 import 하므로 esbuild 가 자동 생성한다.
  await pruneLegacyFonts();
  await report();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
