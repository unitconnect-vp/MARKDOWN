/**
 * 유니코드(한글 포함) 안전 슬러그 생성기.
 * markdown-it-anchor 및 아웃라인 패널이 공유한다.
 */
export function makeSlugger() {
  const used = new Map();

  return function slugify(raw) {
    const base =
      String(raw)
        .trim()
        .toLowerCase()
        // 인라인 마크업 잔여물 제거
        .replace(/[`*_~]/g, '')
        // 링크 [text](url) -> text
        .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
        .replace(/\s+/g, '-')
        // 문자/숫자/하이픈/언더스코어만 유지 (한글·CJK 유지)
        .replace(/[^\p{L}\p{N}\-_]/gu, '')
        .replace(/-{2,}/g, '-')
        .replace(/^-+|-+$/g, '') || 'section';

    const count = used.get(base) ?? 0;
    used.set(base, count + 1);
    return count === 0 ? base : `${base}-${count}`;
  };
}
