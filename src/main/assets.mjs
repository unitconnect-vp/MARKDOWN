/**
 * `md-asset://` 커스텀 프로토콜.
 *
 * 마크다운 문서가 참조하는 로컬 이미지를 렌더러에 노출하되,
 * `webSecurity: false` 를 켜지 않고 열려 있는 문서 폴더 안으로만 접근을 제한한다.
 */
import { protocol, net } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export const SCHEME = 'md-asset';

/** 접근이 허용된 디렉터리(열려 있는 문서들의 폴더). */
const allowedRoots = new Set();

export function registerScheme() {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: SCHEME,
      privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, bypassCSP: true },
    },
  ]);
}

export function allowRoot(dir) {
  if (!dir) return;
  try {
    const real = fs.realpathSync(dir);
    allowedRoots.add(path.resolve(real));
  } catch {
    allowedRoots.add(path.resolve(dir));
  }
}

function isAllowed(target) {
  const resolved = path.resolve(target);
  for (const root of allowedRoots) {
    const rel = path.relative(root, resolved);
    if (rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel))) return true;
  }
  return false;
}

/** 절대 경로를 렌더러가 사용할 수 있는 URL 로 변환. */
export function toAssetUrl(absolutePath) {
  return `${SCHEME}://local/asset?p=${encodeURIComponent(absolutePath)}`;
}

/** `md-asset://...` URL 에서 원래 파일 경로를 복원. */
export function fromAssetUrl(url) {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== `${SCHEME}:`) return null;
    return parsed.searchParams.get('p');
  } catch {
    return null;
  }
}

export function handleProtocol() {
  protocol.handle(SCHEME, async (request) => {
    const target = fromAssetUrl(request.url);
    if (!target) return new Response('Bad request', { status: 400 });

    let resolved;
    try {
      resolved = fs.realpathSync(target);
    } catch {
      return new Response('Not found', { status: 404 });
    }

    if (!isAllowed(resolved)) {
      return new Response('Forbidden: 열려 있는 문서 폴더 밖의 파일입니다.', { status: 403 });
    }
    try {
      return await net.fetch(pathToFileURL(resolved).toString());
    } catch (err) {
      return new Response(`Read error: ${err.message}`, { status: 500 });
    }
  });
}
