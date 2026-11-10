import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getCachedMachineTranslation,
  isMachineTranslationAutoShowEnabled,
  isMachineTranslationEnabled,
  machineTranslate,
  setMachineTranslationAutoShowEnabled,
  setMachineTranslationEnabled
} from '../data/machine-translate.js';

function memoryStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => { map.set(key, String(value)); },
    removeItem: (key) => { map.delete(key); }
  };
}

function stubFetch(payload, counter) {
  return async (url) => {
    counter.count += 1;
    counter.url = String(url);
    return { ok: true, json: async () => payload };
  };
}

test('자동 번역: 기본값은 비활성', () => {
  const storage = memoryStorage();
  assert.equal(isMachineTranslationEnabled(storage), false);
  assert.equal(getCachedMachineTranslation('鬼滅の刃', 'ja', 'ko', storage), null);
});

test('자동 번역: 설정 토글', () => {
  const storage = memoryStorage();
  assert.equal(setMachineTranslationEnabled(true, storage), true);
  assert.equal(isMachineTranslationEnabled(storage), true);
  assert.equal(setMachineTranslationEnabled(false, storage), true);
  assert.equal(isMachineTranslationEnabled(storage), false);
});

test('자동 번역: 바로 표시 옵션은 자동 번역이 켜져 있을 때만 유효', () => {
  const storage = memoryStorage();
  assert.equal(setMachineTranslationAutoShowEnabled(true, storage), true);
  assert.equal(isMachineTranslationAutoShowEnabled(storage), false);
  setMachineTranslationEnabled(true, storage);
  assert.equal(isMachineTranslationAutoShowEnabled(storage), true);
  setMachineTranslationAutoShowEnabled(false, storage);
  assert.equal(isMachineTranslationAutoShowEnabled(storage), false);
});

test('자동 번역: 한국어 결과를 반환하고 캐시한다', async () => {
  const storage = memoryStorage();
  setMachineTranslationEnabled(true, storage);
  const counter = { count: 0 };
  const originalFetch = globalThis.fetch;
  globalThis.fetch = stubFetch([[['귀멸의 칼날', '鬼滅の刃']]], counter);
  try {
    const first = await machineTranslate('鬼滅の刃', 'ja', 'ko', storage);
    const second = await machineTranslate('鬼滅の刃', 'ja', 'ko', storage);
    assert.equal(first?.text, '귀멸의 칼날');
    assert.match(first?.source || '', /자동 번역/);
    assert.equal(second?.text, '귀멸의 칼날');
    assert.equal(counter.count, 1, '캐시된 결과는 네트워크를 다시 호출하지 않아야 합니다.');
    assert.match(counter.url, /translate\.googleapis\.com/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('자동 번역: 비활성 상태에서는 네트워크를 호출하지 않는다', async () => {
  const storage = memoryStorage();
  const counter = { count: 0 };
  const originalFetch = globalThis.fetch;
  globalThis.fetch = stubFetch([[['귀멸의 칼날', '鬼滅の刃']]], counter);
  try {
    assert.equal(await machineTranslate('鬼滅の刃', 'ja', 'ko', storage), null);
    assert.equal(counter.count, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('자동 번역: 한글이 없는 응답은 표시하지 않는다', async () => {
  const storage = memoryStorage();
  setMachineTranslationEnabled(true, storage);
  const counter = { count: 0 };
  const originalFetch = globalThis.fetch;
  globalThis.fetch = stubFetch([[['Demon Slayer', '鬼滅の刃']]], counter);
  try {
    assert.equal(await machineTranslate('鬼滅の刃', 'ja', 'ko', storage), null);
    assert.equal(getCachedMachineTranslation('鬼滅の刃', 'ja', 'ko', storage), null);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('자동 번역: 빈 입력은 요청하지 않는다', async () => {
  const storage = memoryStorage();
  setMachineTranslationEnabled(true, storage);
  const counter = { count: 0 };
  const originalFetch = globalThis.fetch;
  globalThis.fetch = stubFetch([[['번역', '']]], counter);
  try {
    assert.equal(await machineTranslate('  ', 'ja', 'ko', storage), null);
    assert.equal(counter.count, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
