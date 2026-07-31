#!/usr/bin/env node
/**
 * 배포 산출물 검증기.
 *
 *   npm run verify:installer
 *
 * Windows 실행 파일/설치 파일을 열어 PE 구조·아이콘·버전 정보를 확인하고,
 * asar 안에 필요한 파일이 모두 들어갔는지, 샘플 리소스가 제자리에 있는지 점검한다.
 * (Windows 머신 없이도 "설치 파일이 제대로 만들어졌는지" 를 확인하기 위한 것)
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { NtExecutable, NtExecutableResource, Resource } from 'resedit';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const RELEASE = path.join(ROOT, 'release');

let failed = 0;
const ok = (msg, extra = '') => console.log(`  \x1b[32m✓\x1b[0m ${msg}${extra ? ` \x1b[90m${extra}\x1b[0m` : ''}`);
const bad = (msg, detail) => {
  failed += 1;
  console.log(`  \x1b[31m✗ ${msg}\x1b[0m`);
  if (detail) console.log(`      ${detail}`);
};
const section = (title) => console.log(`\n\x1b[1m${title}\x1b[0m`);
const mb = (bytes) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;

/** 디렉터리 전체 크기 */
async function dirSize(dir) {
  let total = 0;
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) total += await dirSize(full);
    else total += (await fs.stat(full)).size;
  }
  return total;
}

async function check(name, fn, extra) {
  try {
    const result = await fn();
    if (result === false) bad(name);
    else ok(name, typeof result === 'string' ? result : extra);
  } catch (error) {
    bad(name, error.message);
  }
}

/** asar 아카이브의 헤더(파일 목록)를 읽는다. */
async function readAsarHeader(asarPath) {
  const handle = await fs.open(asarPath, 'r');
  try {
    const head = Buffer.alloc(16);
    await handle.read(head, 0, 16, 0);
    const jsonLength = head.readUInt32LE(12);
    const json = Buffer.alloc(jsonLength);
    await handle.read(json, 0, jsonLength, 16);
    return JSON.parse(json.toString('utf8'));
  } finally {
    await handle.close();
  }
}

/** asar 헤더를 순회해 "a/b/c" 형태의 경로 목록을 만든다. */
function flattenAsar(node, prefix = '') {
  const out = [];
  for (const [name, entry] of Object.entries(node.files || {})) {
    const full = prefix ? `${prefix}/${name}` : name;
    if (entry.files) out.push(...flattenAsar(entry, full));
    else out.push({ path: full, size: entry.size ?? 0 });
  }
  return out;
}

function readPeInfo(buffer) {
  if (buffer.subarray(0, 2).toString() !== 'MZ') throw new Error('MZ 시그니처 없음 (PE 파일이 아님)');
  const peOffset = buffer.readUInt32LE(0x3c);
  if (buffer.subarray(peOffset, peOffset + 4).toString('latin1') !== 'PE\0\0') throw new Error('PE 헤더 없음');
  const machine = buffer.readUInt16LE(peOffset + 4);

  const executable = NtExecutable.from(buffer, { ignoreCert: true });
  const resource = NtExecutableResource.from(executable);
  const versions = Resource.VersionInfo.fromEntries(resource.entries);
  const iconGroups = Resource.IconGroupEntry.fromEntries(resource.entries);

  // 언어별 문자열 테이블을 하나로 합친다.
  const strings = {};
  for (const info of versions) {
    for (const table of info.getAllLanguagesForStringValues()) {
      Object.assign(strings, info.getStringValues(table));
    }
  }

  const fixed = versions[0]?.fixedInfo;
  return {
    machine: machine === 0x8664 ? 'x64' : machine === 0x14c ? 'x86' : `0x${machine.toString(16)}`,
    versionInfoCount: versions.length,
    strings: Object.keys(strings).length ? strings : null,
    fileVersion: fixed
      ? [fixed.fileVersionMS >>> 16, fixed.fileVersionMS & 0xffff, fixed.fileVersionLS >>> 16, fixed.fileVersionLS & 0xffff].join('.')
      : null,
    iconCount: iconGroups[0]?.icons?.length ?? 0,
  };
}

// ---------------------------------------------------------------------------

async function main() {
  console.log('\n\x1b[1mMarkView 배포 산출물 검증\x1b[0m');

  const pkg = JSON.parse(await fs.readFile(path.join(ROOT, 'package.json'), 'utf8'));
  const version = pkg.version;

  const setupPath = path.join(RELEASE, `MarkView-${version}-Setup.exe`);
  const portablePath = path.join(RELEASE, `MarkView-${version}-Portable.exe`);
  const unpacked = path.join(RELEASE, 'win-unpacked');
  const appExe = path.join(unpacked, 'MarkView.exe');

  // -------------------------------------------------------------------------
  section('1. 산출물 존재 여부');

  const artifacts = [
    ['NSIS 설치 파일', setupPath],
    ['포터블 실행 파일', portablePath],
    ['압축 해제된 앱', appExe],
    ['app.asar', path.join(unpacked, 'resources', 'app.asar')],
  ];
  const sizes = {};
  for (const [label, target] of artifacts) {
    try {
      const stat = await fs.stat(target);
      sizes[target] = stat.size;
      ok(label, `${path.basename(target)} · ${mb(stat.size)}`);
    } catch {
      bad(label, `없음: ${path.relative(ROOT, target)}`);
    }
  }
  if (failed) {
    console.log('\n먼저 `npm run dist:win` 을 실행하세요.');
    process.exit(1);
  }

  // -------------------------------------------------------------------------
  section('2. 앱 실행 파일 (MarkView.exe)');

  const appInfo = readPeInfo(await fs.readFile(appExe));
  await check('64비트 Windows 실행 파일이다', () => appInfo.machine === 'x64', appInfo.machine);
  await check('아이콘이 여러 해상도로 들어갔다', () => appInfo.iconCount >= 5, `${appInfo.iconCount}종`);
  await check('제품 이름이 MarkView 다', () => appInfo.strings?.ProductName === 'MarkView', appInfo.strings?.ProductName);
  await check(
    '파일 버전이 package.json 과 일치한다',
    () => appInfo.strings?.FileVersion === version && appInfo.fileVersion?.startsWith(version),
    `${appInfo.strings?.FileVersion} (PE: ${appInfo.fileVersion})`,
  );
  await check('회사/저작권 정보가 있다', () => Boolean(appInfo.strings?.CompanyName && appInfo.strings?.LegalCopyright),
    `${appInfo.strings?.CompanyName} · ${appInfo.strings?.LegalCopyright}`);
  // Electron 원본 버전 리소스가 남아 있으면 탐색기 속성 창에 "Electron" 이 뜬다.
  await check(
    'Electron 원본 브랜딩이 남아 있지 않다',
    () =>
      appInfo.versionInfoCount === 1 &&
      !JSON.stringify(appInfo.strings).includes('Electron') &&
      appInfo.strings?.OriginalFilename === 'MarkView.exe',
    `VERSIONINFO ${appInfo.versionInfoCount}개 · OriginalFilename=${appInfo.strings?.OriginalFilename}`,
  );

  // -------------------------------------------------------------------------
  section('3. 설치 파일 / 포터블');

  for (const [label, target] of [['설치 파일', setupPath], ['포터블', portablePath]]) {
    const info = readPeInfo(await fs.readFile(target));
    await check(`${label}: 유효한 PE 파일이다`, () => true, info.machine);
    await check(`${label}: 앱 전체를 담을 만한 크기다`, () => sizes[target] > 60 * 1024 * 1024, mb(sizes[target]));
  }

  const setupBuffer = await fs.readFile(setupPath);
  const setupText = setupBuffer.toString('latin1');
  // NSIS 헤더 매직. 페이로드 자체는 LZMA 로 압축돼 있어 문자열 검색으로는 확인할 수 없다.
  await check('설치 파일이 NSIS 로 만들어졌다', () => setupText.includes('NullsoftInst'));
  await check(
    '앱 페이로드가 압축되어 들어 있다',
    () => sizes[setupPath] > sizes[path.join(unpacked, 'resources', 'app.asar')] * 5,
    `${mb(sizes[setupPath])} (압축 해제 시 ${mb(await dirSize(unpacked))})`,
  );
  const setupInfo = readPeInfo(setupBuffer);
  await check(
    '설치 파일에도 제품/버전 정보가 있다',
    () => setupInfo.strings?.ProductName === 'MarkView' && setupInfo.strings?.FileVersion?.startsWith(version),
    `${setupInfo.strings?.ProductName} ${setupInfo.strings?.FileVersion}`,
  );

  // -------------------------------------------------------------------------
  section('4. app.asar 내용');

  const header = await readAsarHeader(path.join(unpacked, 'resources', 'app.asar'));
  const entries = flattenAsar(header);
  const paths = new Set(entries.map((e) => e.path));
  const totalSize = entries.reduce((sum, e) => sum + e.size, 0);

  const required = [
    'package.json',
    'dist/main/index.js',
    'dist/preload/index.js',
    'dist/renderer/index.html',
    'dist/renderer/app.js',
    'dist/renderer/app.css',
    'dist/renderer/mermaid.js',
    'dist/export/style.css',
    'dist/icon.png',
  ];
  for (const file of required) {
    const entry = entries.find((e) => e.path === file);
    await check(`포함: ${file}`, () => Boolean(entry), entry ? `${(entry.size / 1024).toFixed(0)} KB` : undefined);
  }
  await check('KaTeX 폰트(woff2)가 들어 있다', () => entries.some((e) => /renderer\/assets\/KaTeX.*\.woff2$/.test(e.path)),
    `${entries.filter((e) => /\.woff2$/.test(e.path)).length}개`);
  await check('내보내기용 폰트도 들어 있다', () => entries.some((e) => /export\/assets\/KaTeX.*\.woff2$/.test(e.path)));
  await check('소스 파일은 포함되지 않았다', () => ![...paths].some((p) => p.startsWith('src/') || p.startsWith('test/')));
  await check('소스맵이 포함되지 않았다', () => ![...paths].some((p) => p.endsWith('.map')));
  ok('asar 전체', `${entries.length}개 파일 · ${mb(totalSize)}`);

  // -------------------------------------------------------------------------
  section('5. 동봉 리소스 (샘플 문서)');

  const samplesDir = path.join(unpacked, 'resources', 'samples');
  for (const file of ['기능-안내.md', '보고서-예시.md', 'assets/screenshot.png', 'assets/chart.png', 'assets/로고 이미지.svg']) {
    const target = path.join(samplesDir, file);
    try {
      const stat = await fs.stat(target);
      ok(`포함: samples/${file}`, `${(stat.size / 1024).toFixed(0)} KB`);
    } catch {
      bad(`포함: samples/${file}`, '없음');
    }
  }
  await check(
    '샘플은 asar 밖에 있다 (사용자가 직접 열 수 있어야 함)',
    () => ![...paths].some((p) => p.startsWith('samples/')),
  );

  // -------------------------------------------------------------------------
  console.log(`\n${'─'.repeat(60)}`);
  if (failed === 0) {
    console.log('\x1b[32m✓ 모든 검증 통과\x1b[0m');
    console.log(`\n설치 파일: release/${path.basename(setupPath)}  (${mb(sizes[setupPath])})`);
    console.log(`포터블  : release/${path.basename(portablePath)}  (${mb(sizes[portablePath])})`);
  } else {
    console.log(`\x1b[31m✗ 실패 ${failed}건\x1b[0m`);
  }
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
