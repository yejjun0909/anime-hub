import test from 'node:test';
import assert from 'node:assert/strict';
import {
  allUserKorean,
  deleteUserKorean,
  getUserKorean,
  mergeUserKorean,
  setUserKorean
} from '../data/user-korean.js';

function memoryStorage() {
  const map = new Map();
  return {
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => { map.set(key, String(value)); },
    removeItem: (key) => { map.delete(key); }
  };
}

test('사용자 번역: 저장·조회·삭제', () => {
  const storage = memoryStorage();
  const media = { id: 101 };
  assert.equal(setUserKorean(media, { title: '귀멸의 칼날', overview: '소개', url: 'https://example.com', anilistId: 101, searchTerm: 'Demon Slayer' }, storage), true);
  const saved = getUserKorean(media, storage);
  assert.equal(saved?.title, '귀멸의 칼날');
  assert.equal(saved?.overview, '소개');
  assert.equal(saved?.source, '사용자 입력');
  assert.equal(saved?.anilistId, 101);
  assert.equal(saved?.searchTerm, 'Demon Slayer');
  assert.equal(deleteUserKorean(media, storage), true);
  assert.equal(getUserKorean(media, storage), null);
});

test('사용자 번역: MAL ID 키도 지원', () => {
  const storage = memoryStorage();
  setUserKorean({ idMal: 164 }, { title: '원령공주' }, storage);
  assert.equal(getUserKorean({ idMal: 164 }, storage)?.title, '원령공주');
});

test('사용자 번역: 백업 병합은 유효한 항목만 받는다', () => {
  const storage = memoryStorage();
  const merged = mergeUserKorean({
    'a:1': { title: '진격의 거인', overview: '소개', anilistId: 1, searchTerm: 'Attack on Titan' },
    'm:2': { title: '원령공주', malId: 2 },
    'bad-key': { title: '무시' },
    'a:3': { title: '', overview: '' },
    'a:4': null
  }, storage);
  assert.equal(merged, 2);
  assert.equal(getUserKorean({ id: 1 }, storage)?.title, '진격의 거인');
  assert.equal(getUserKorean({ id: 1 }, storage)?.searchTerm, 'Attack on Titan');
  assert.equal(getUserKorean({ idMal: 2 }, storage)?.malId, 2);
  assert.deepEqual(Object.keys(allUserKorean(storage)).sort(), ['a:1', 'm:2']);
});

test('사용자 번역: 병합은 기존 값을 덮어쓸 수 있다', () => {
  const storage = memoryStorage();
  setUserKorean({ id: 7 }, { title: '이전 제목' }, storage);
  assert.equal(mergeUserKorean({ 'a:7': { title: '새 제목' } }, storage), 1);
  assert.equal(getUserKorean({ id: 7 }, storage)?.title, '새 제목');
});
