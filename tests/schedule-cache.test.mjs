import test from 'node:test';
import assert from 'node:assert/strict';
import {
  readAiringCache,
  writeAiringCache,
  isFreshAiringCache,
  clearAiringCache
} from '../data/schedule-cache.js';

function fakeStorage() {
  const store = new Map();
  return {
    getItem: (key) => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => store.set(key, String(value)),
    removeItem: (key) => store.delete(key)
  };
}

test('write/read round trip', () => {
  const storage = fakeStorage();
  const items = [{ id: 1, nextAiringEpisode: { airingAt: 100, episode: 1 } }];
  assert.equal(writeAiringCache(items, 'AniList 방영 일정', storage, 1000), true);
  const cache = readAiringCache(storage);
  assert.equal(cache.source, 'AniList 방영 일정');
  assert.equal(cache.savedAt, 1000);
  assert.equal(cache.items.length, 1);
});

test('read: 손상된 JSON은 null', () => {
  const storage = fakeStorage();
  storage.setItem('animehub_airing_cache_v1', '{not json');
  assert.equal(readAiringCache(storage), null);
});

test('read: items가 배열이 아니면 null', () => {
  const storage = fakeStorage();
  storage.setItem('animehub_airing_cache_v1', JSON.stringify({ items: 'x', savedAt: 1 }));
  assert.equal(readAiringCache(storage), null);
});

test('isFresh: TTL 이내면 true, 이후 false', () => {
  const cache = { savedAt: 1000, items: [] };
  assert.equal(isFreshAiringCache(cache, 1000 + 1000, 2000), true);
  assert.equal(isFreshAiringCache(cache, 1000 + 3000, 2000), false);
});

test('clear: 키 제거', () => {
  const storage = fakeStorage();
  writeAiringCache([{ id: 1 }], 'x', storage, 1);
  clearAiringCache(storage);
  assert.equal(readAiringCache(storage), null);
});

test('storage 없으면 안전하게 실패', () => {
  assert.equal(writeAiringCache([{ id: 1 }], 'x', null), false);
  assert.equal(readAiringCache(null), null);
});
