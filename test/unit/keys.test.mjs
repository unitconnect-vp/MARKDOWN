import test from 'node:test';
import assert from 'node:assert/strict';

import { keyLabel } from '../../src/renderer/keys.mjs';

test('keyLabel — Windows/Linux 에서는 그대로 둔다', () => {
  assert.equal(keyLabel('저장 (Ctrl+S)', false), '저장 (Ctrl+S)');
});

test('keyLabel — macOS 에서는 ⌘/⇧ 기호로 바꾼다', () => {
  assert.equal(keyLabel('Ctrl+S', true), '⌘S');
  assert.equal(keyLabel('Ctrl+Shift+S', true), '⌘⇧S');
  assert.equal(keyLabel('열기 (Ctrl+O)', true), '열기 (⌘O)');
  assert.equal(keyLabel('Ctrl++ · Ctrl+- · Ctrl+0', true), '⌘+ · ⌘- · ⌘0');
  assert.equal(keyLabel('Ctrl+\\', true), '⌘\\');
  assert.equal(keyLabel('`Ctrl+O` 로 열기', true), '`⌘O` 로 열기');
});

test('keyLabel — 탭 전환은 macOS 에서도 Control 키다', () => {
  assert.equal(keyLabel('Ctrl+Tab · Ctrl+Shift+Tab', true), '⌃Tab · ⌃⇧Tab');
});
