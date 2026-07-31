/**
 * electron-builder afterPack 훅.
 *
 * electron-builder 는 Windows 실행 파일의 아이콘/버전 정보를 rcedit(=wine 필요)로
 * 넣는다. 리눅스에서 빌드할 때 wine 을 요구하지 않도록, 순수 JS PE 리소스 편집기인
 * resedit 로 같은 작업을 직접 수행한다.
 *
 * electron-builder.yml 에서 `win.signAndEditExecutable: false` 와 짝을 이룬다.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { NtExecutable, NtExecutableResource, Resource, Data } from 'resedit';

/** "1.2.3" → [1, 2, 3, 0] */
function versionTuple(version) {
  const parts = String(version)
    .split('-')[0]
    .split('.')
    .map((n) => Number.parseInt(n, 10) || 0);
  return [parts[0] || 0, parts[1] || 0, parts[2] || 0, 0];
}

export default async function afterPack(context) {
  if (context.electronPlatformName !== 'win32') return;

  const { packager, appOutDir } = context;
  const exeName = `${packager.appInfo.productFilename}.exe`;
  const exePath = path.join(appOutDir, exeName);
  const icoPath = path.join(packager.projectDir, 'build', 'icon.ico');

  const [exeBuffer, icoBuffer] = await Promise.all([fs.readFile(exePath), fs.readFile(icoPath)]);

  const executable = NtExecutable.from(exeBuffer);
  const resource = NtExecutableResource.from(executable);

  // ---- 아이콘 교체 -------------------------------------------------------
  const iconFile = Data.IconFile.from(icoBuffer);
  Resource.IconGroupEntry.replaceIconsForResource(
    resource.entries,
    1, // 아이콘 그룹 ID (Electron 기본값)
    1033, // en-US: Electron 원본 리소스와 동일한 언어여야 교체된다
    iconFile.icons.map((item) => item.data),
  );

  // ---- 버전 정보 ---------------------------------------------------------
  // 새 VersionInfo 를 만들면 Electron 원본("Electron / electron.exe")이 그대로 남아
  // 탐색기 속성 창에 그쪽이 표시된다. 반드시 기존 항목을 읽어 덮어써야 한다.
  const { version, productName, companyName, copyright, description } = packager.appInfo;
  const numeric = versionTuple(version);
  const LANG = { lang: 1033, codepage: 1200 }; // en-US / Unicode

  const existing = Resource.VersionInfo.fromEntries(resource.entries);
  const versionInfo = existing[0] ?? Resource.VersionInfo.createEmpty();

  // Electron 브랜딩이 섞이지 않도록 기존 문자열 테이블을 모두 비운다.
  for (const table of versionInfo.getAllLanguagesForStringValues()) {
    versionInfo.removeAllStringValues(table);
  }

  versionInfo.setFileVersion(...numeric, LANG.lang);
  versionInfo.setProductVersion(...numeric, LANG.lang);
  versionInfo.setStringValues(LANG, {
    ProductName: productName,
    FileDescription: description || productName,
    CompanyName: companyName || productName,
    LegalCopyright: copyright || '',
    OriginalFilename: exeName,
    InternalName: productName,
    FileVersion: version,
    ProductVersion: version,
  });
  versionInfo.lang = LANG.lang;
  versionInfo.outputToResourceEntries(resource.entries);

  // 혹시 남아 있을 수 있는 다른 언어의 VERSIONINFO 항목 제거
  const VERSION_INFO_TYPE = 16;
  for (let i = resource.entries.length - 1; i >= 0; i -= 1) {
    const entry = resource.entries[i];
    if (entry.type === VERSION_INFO_TYPE && entry.lang !== LANG.lang) resource.entries.splice(i, 1);
  }

  resource.outputResource(executable);
  await fs.writeFile(exePath, Buffer.from(executable.generate()));

  console.log(
    `  • afterPack: ${exeName} 아이콘(${iconFile.icons.length}종) + 버전 정보(${version}) 적용 [resedit, wine 불필요]`,
  );
}
