/**
 * 렌더러(브라우저 컨텍스트)에서도 쓸 수 있는 최소 경로 유틸.
 * node:path 를 쓸 수 없는 곳에서 Windows/POSIX 경로를 모두 다룬다.
 */

export const WIN_DRIVE = /^[a-zA-Z]:[\\/]/;
const UNC = /^[\\/]{2}[^\\/]/;

export function isWindowsPath(p) {
  return WIN_DRIVE.test(p) || UNC.test(p);
}

export function isAbsolutePath(p, platform = 'win32') {
  if (!p) return false;
  if (WIN_DRIVE.test(p) || UNC.test(p)) return true;
  if (platform === 'win32') return /^[\\/]/.test(p);
  return p.startsWith('/');
}

/** 원격/데이터 URL 인지 판단. */
export function isExternalUrl(href) {
  return /^(https?:|data:|blob:|mailto:|tel:|md-asset:|#)/i.test(String(href || ''));
}

function splitSegments(p) {
  return String(p).split(/[\\/]+/);
}

/**
 * `dir` 기준으로 `relative` 를 절대 경로로 만든다.
 * 결과 구분자는 입력(dir)의 스타일을 따른다.
 */
export function resolvePath(dir, relative) {
  const target = String(relative ?? '');
  const base = String(dir ?? '');
  const useBackslash = base.includes('\\') || WIN_DRIVE.test(target);
  const sep = useBackslash ? '\\' : '/';

  let segments;
  if (isAbsolutePath(target, useBackslash ? 'win32' : 'posix')) {
    segments = splitSegments(target);
  } else {
    segments = [...splitSegments(base), ...splitSegments(target)];
  }

  const out = [];
  for (let i = 0; i < segments.length; i += 1) {
    const seg = segments[i];
    if (seg === '.' ) continue;
    if (seg === '') {
      // 루트(선행 빈 세그먼트)만 유지
      if (i === 0) out.push('');
      continue;
    }
    if (seg === '..') {
      if (out.length > 1 || (out.length === 1 && out[0] !== '' && !/^[a-zA-Z]:$/.test(out[0]))) out.pop();
      continue;
    }
    out.push(seg);
  }

  const joined = out.join(sep);
  // POSIX 루트 복원 ('' + '/' + 'a' -> '/a')
  if (!useBackslash && !joined.startsWith('/') && base.startsWith('/')) return `/${joined.replace(/^\/+/, '')}`;
  return joined || sep;
}

/** `from` 디렉터리에서 `to` 파일까지의 상대 경로 (마크다운용이므로 항상 `/`). */
export function relativePath(from, to) {
  const fromSegments = splitSegments(from).filter((s, i) => s !== '' || i === 0);
  const toSegments = splitSegments(to).filter((s, i) => s !== '' || i === 0);

  const caseFold = (s) => (isWindowsPath(from) || isWindowsPath(to) ? s.toLowerCase() : s);

  let common = 0;
  while (
    common < fromSegments.length &&
    common < toSegments.length &&
    caseFold(fromSegments[common]) === caseFold(toSegments[common])
  ) {
    common += 1;
  }
  if (common === 0) return toSegments.join('/'); // 다른 드라이브 → 절대 경로 유지

  const up = fromSegments.length - common;
  const down = toSegments.slice(common);
  const parts = [...Array(up).fill('..'), ...down];
  const result = parts.join('/');
  return result.startsWith('.') ? result : `./${result}`;
}

export function dirname(p) {
  const segments = splitSegments(p);
  segments.pop();
  const sep = String(p).includes('\\') ? '\\' : '/';
  const joined = segments.join(sep);
  return joined || (String(p).startsWith('/') ? '/' : '.');
}

export function basename(p) {
  const segments = splitSegments(p).filter(Boolean);
  return segments[segments.length - 1] || '';
}

export function stripExtension(name) {
  return String(name).replace(/\.[^./\\]+$/, '');
}

/** 마크다운 링크에서 쿼리/프래그먼트를 떼고 퍼센트 디코딩. */
export function normalizeHref(href) {
  const clean = String(href || '').split('#')[0].split('?')[0];
  try {
    return decodeURIComponent(clean);
  } catch {
    return clean;
  }
}

const IMAGE_EXT = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'ico', 'avif']);
const MARKDOWN_EXT = new Set(['md', 'markdown', 'mdx', 'mkd', 'mdown', 'txt']);

export const isImageFile = (name) => IMAGE_EXT.has(String(name).split('.').pop().toLowerCase());
export const isMarkdownFile = (name) => MARKDOWN_EXT.has(String(name).split('.').pop().toLowerCase());
