import test from 'node:test';
import assert from 'node:assert/strict';

import {
  resolvePath,
  relativePath,
  dirname,
  basename,
  stripExtension,
  normalizeHref,
  isExternalUrl,
  isImageFile,
  isMarkdownFile,
  isAbsolutePath,
} from '../../src/shared/pathutil.mjs';

test('resolvePath — POSIX 상대 경로', () => {
  assert.equal(resolvePath('/home/u/docs', './img/a.png'), '/home/u/docs/img/a.png');
  assert.equal(resolvePath('/home/u/docs', 'img/a.png'), '/home/u/docs/img/a.png');
  assert.equal(resolvePath('/home/u/docs', '../img/a.png'), '/home/u/img/a.png');
  assert.equal(resolvePath('/home/u/docs/sub', '../../a.png'), '/home/u/a.png');
});

test('resolvePath — POSIX 절대 경로는 그대로', () => {
  assert.equal(resolvePath('/home/u/docs', '/etc/a.png'), '/etc/a.png');
});

test('resolvePath — Windows 상대 경로', () => {
  assert.equal(resolvePath('C:\\Users\\me\\docs', './img/a.png'), 'C:\\Users\\me\\docs\\img\\a.png');
  assert.equal(resolvePath('C:\\Users\\me\\docs', '..\\img\\a.png'), 'C:\\Users\\me\\img\\a.png');
  assert.equal(resolvePath('C:\\Users\\me\\docs', 'assets/그림.png'), 'C:\\Users\\me\\docs\\assets\\그림.png');
});

test('resolvePath — Windows 절대 경로는 그대로', () => {
  assert.equal(resolvePath('C:\\Users\\me\\docs', 'D:\\pics\\a.png'), 'D:\\pics\\a.png');
});

test('resolvePath — 드라이브 루트를 넘어 올라가지 않는다', () => {
  assert.equal(resolvePath('C:\\docs', '../../../a.png'), 'C:\\a.png');
  assert.equal(resolvePath('/a', '../../../b.png'), '/b.png');
});

test('relativePath — 같은 폴더 / 하위 / 상위', () => {
  assert.equal(relativePath('/home/u/docs', '/home/u/docs/a.png'), './a.png');
  assert.equal(relativePath('/home/u/docs', '/home/u/docs/img/a.png'), './img/a.png');
  assert.equal(relativePath('/home/u/docs', '/home/u/pics/a.png'), '../pics/a.png');
});

test('relativePath — Windows 는 대소문자를 구분하지 않는다', () => {
  assert.equal(relativePath('C:\\Users\\Me\\Docs', 'c:\\users\\me\\docs\\a.png'), './a.png');
});

test('isAbsolutePath', () => {
  assert.equal(isAbsolutePath('C:\\a', 'win32'), true);
  assert.equal(isAbsolutePath('/a', 'posix'), true);
  assert.equal(isAbsolutePath('./a', 'posix'), false);
  assert.equal(isAbsolutePath('a/b', 'win32'), false);
});

test('normalizeHref — 쿼리·프래그먼트 제거와 퍼센트 디코딩', () => {
  assert.equal(normalizeHref('./로고%20이미지.svg'), './로고 이미지.svg');
  assert.equal(normalizeHref('./a.png?v=2#x'), './a.png');
  assert.equal(normalizeHref('./100%.png'), './100%.png', '잘못된 인코딩도 죽지 않아야 한다');
});

test('isExternalUrl', () => {
  for (const url of ['https://a.test', 'http://a.test', 'data:image/png;base64,AA', '#절', 'mailto:a@b.c']) {
    assert.equal(isExternalUrl(url), true, url);
  }
  for (const url of ['./a.png', 'a.png', '../a.png', 'C:\\a.png']) {
    assert.equal(isExternalUrl(url), false, url);
  }
});

test('dirname / basename / stripExtension', () => {
  assert.equal(dirname('/home/u/a.md'), '/home/u');
  assert.equal(dirname('C:\\Users\\a.md'), 'C:\\Users');
  assert.equal(basename('/home/u/보고서.md'), '보고서.md');
  assert.equal(stripExtension('보고서.md'), '보고서');
  assert.equal(stripExtension('a.b.c.md'), 'a.b.c');
});

test('파일 종류 판별', () => {
  assert.equal(isMarkdownFile('a.md'), true);
  assert.equal(isMarkdownFile('a.MARKDOWN'), true);
  assert.equal(isMarkdownFile('a.png'), false);
  assert.equal(isImageFile('그림.PNG'), true);
  assert.equal(isImageFile('a.svg'), true);
  assert.equal(isImageFile('a.md'), false);
});
