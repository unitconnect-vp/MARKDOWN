/**
 * 단축키 표기를 플랫폼에 맞게 바꾼다.
 *
 * 메뉴 가속기는 `CmdOrCtrl+…` 라 macOS 에서는 ⌘ 로 동작하지만, 툴팁·안내 문구는
 * `Ctrl+…` 로 적혀 있다. macOS 에서만 ⌘/⇧ 기호로 바꿔 보여 준다.
 * 단, `Ctrl+Tab` 탭 전환은 macOS 에서도 실제 Control 키이므로 그대로 둔다.
 */

export const IS_MAC = typeof navigator !== 'undefined' && /Mac/i.test(navigator.platform || navigator.userAgent || '');

/** "Ctrl+Shift+S" → "⌘⇧S" (macOS), 그 외 플랫폼은 그대로. */
export function keyLabel(text, isMac = IS_MAC) {
  const source = String(text ?? '');
  if (!isMac) return source;
  return source.replace(/Ctrl\+((?:Shift\+)?)([^\s·)]+)/g, (match, shift, key) => {
    if (key === 'Tab') return match.replace('Ctrl+', '⌃').replace('Shift+', '⇧');
    return `⌘${shift ? '⇧' : ''}${key}`;
  });
}

/** 문서 안의 title / aria 툴팁에 적힌 단축키를 일괄 변환한다. */
export function localizeKeyTitles(root = document, isMac = IS_MAC) {
  if (!isMac) return;
  for (const node of root.querySelectorAll('[title*="Ctrl+"]')) {
    node.title = keyLabel(node.title, isMac);
  }
}
