/**
 * userData 폴더에 저장되는 아주 작은 JSON 설정 저장소.
 * (별도 의존성 없이 동작하도록 직접 구현)
 */
import { app } from 'electron';
import fs from 'node:fs';
import path from 'node:path';

const DEFAULTS = {
  theme: 'system', // 'light' | 'dark' | 'system'
  viewMode: 'split', // 'editor' | 'split' | 'preview'
  showOutline: true,
  previewZoom: 1,
  editorFontSize: 14,
  wordWrap: true,
  lineNumbers: true,
  scrollSync: true,
  recent: [],
  windowBounds: null,
};

const MAX_RECENT = 15;

let cache = null;
let filePath = null;
let flushTimer = null;

function file() {
  if (!filePath) filePath = path.join(app.getPath('userData'), 'markview-settings.json');
  return filePath;
}

function load() {
  if (cache) return cache;
  try {
    const raw = fs.readFileSync(file(), 'utf8');
    cache = { ...DEFAULTS, ...JSON.parse(raw) };
  } catch {
    cache = { ...DEFAULTS };
  }
  if (!Array.isArray(cache.recent)) cache.recent = [];
  return cache;
}

function flush() {
  clearTimeout(flushTimer);
  flushTimer = setTimeout(() => {
    try {
      fs.mkdirSync(path.dirname(file()), { recursive: true });
      fs.writeFileSync(file(), JSON.stringify(cache, null, 2), 'utf8');
    } catch (err) {
      console.error('[markview] 설정 저장 실패:', err.message);
    }
  }, 200);
}

export const settings = {
  all: () => ({ ...load() }),
  get(key) {
    return load()[key];
  },
  set(key, value) {
    load()[key] = value;
    flush();
  },
  merge(patch) {
    Object.assign(load(), patch);
    flush();
  },
  /** 저장 대기 중인 변경사항을 즉시 기록 (앱 종료 직전 호출). */
  flushNow() {
    clearTimeout(flushTimer);
    try {
      fs.mkdirSync(path.dirname(file()), { recursive: true });
      fs.writeFileSync(file(), JSON.stringify(load(), null, 2), 'utf8');
    } catch {
      /* 종료 경로에서는 무시 */
    }
  },
};

export const recentFiles = {
  list() {
    return load()
      .recent.filter((p) => typeof p === 'string')
      .filter((p) => fs.existsSync(p));
  },
  add(filePathToAdd) {
    const store = load();
    const normalized = path.normalize(filePathToAdd);
    store.recent = [normalized, ...store.recent.filter((p) => path.normalize(p) !== normalized)].slice(0, MAX_RECENT);
    flush();
    try {
      app.addRecentDocument(normalized);
    } catch {
      /* 일부 플랫폼에서 미지원 */
    }
  },
  clear() {
    load().recent = [];
    flush();
    try {
      app.clearRecentDocuments();
    } catch {
      /* 무시 */
    }
  },
};
