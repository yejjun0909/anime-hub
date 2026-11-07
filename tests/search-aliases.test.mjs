import test from 'node:test';
import assert from 'node:assert/strict';
import { POPULAR_SEARCHES, SEARCH_SYNONYMS, expandSearchQuery, searchAliasSuggestions } from '../data/search-aliases.js';

test('인기 검색어: 중복 없음', () => {
  assert.equal(new Set(POPULAR_SEARCHES).size, POPULAR_SEARCHES.length);
});

test('인기 검색어: 깨진 항목 없이 분리됨', () => {
  assert.ok(POPULAR_SEARCHES.includes('명탐정 코난'));
  assert.ok(POPULAR_SEARCHES.includes('카우보이 비밥'));
  assert.ok(!POPULAR_SEARCHES.some((item) => item.includes('코난카우보이')));
});

test('동의어: 아포스트로피가 있는 제목 보존', () => {
  assert.equal(SEARCH_SYNONYMS['하울의 움직이는 성'], "Howl's Moving Castle");
  assert.equal(SEARCH_SYNONYMS['마녀 배달부 키키'], "Kiki's Delivery Service");
});

test('동의어: 중복 키 없음(객체 특성상 마지막 값 사용)', () => {
  const keys = Object.keys(SEARCH_SYNONYMS);
  assert.equal(new Set(keys).size, keys.length);
});

test('expandSearchQuery: 한국어 → 영어', () => {
  assert.deepEqual(expandSearchQuery('귀멸의 칼날'), ['귀멸의 칼날', 'Demon Slayer']);
});

test('expandSearchQuery: 영어 → 한국어', () => {
  assert.deepEqual(expandSearchQuery('Attack on Titan'), ['Attack on Titan', '진격의 거인']);
});

test('searchAliasSuggestions: 빈 검색어는 인기 검색어 8건', () => {
  assert.equal(searchAliasSuggestions('').length, 8);
});

test('searchAliasSuggestions: 부분 일치', () => {
  const results = searchAliasSuggestions('귀멸');
  assert.ok(results.length >= 1);
  assert.ok(results.every((item) => item.includes('귀멸')));
});
