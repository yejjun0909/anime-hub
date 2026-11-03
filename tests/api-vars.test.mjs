// AniList 요청 변수 정리 회귀 테스트
import test from 'node:test';
import assert from 'node:assert/strict';
import { pruneNullVariables } from '../data/api-vars.js';

test('null/undefined 제거', () => {
  const input = { page: 1, search: null, minScore: null, maxScore: undefined, sort: ['POPULARITY_DESC'] };
  assert.deepEqual(pruneNullVariables(input), { page: 1, sort: ['POPULARITY_DESC'] });
});

test('0, false, 빈 문자열은 유지', () => {
  assert.deepEqual(pruneNullVariables({ page: 0, isAdult: false, search: '' }), {
    page: 0,
    isAdult: false,
    search: ''
  });
});

test('빈 배열은 유지 (의미가 있는 필터일 수 있음)', () => {
  assert.deepEqual(pruneNullVariables({ formats: [] }), { formats: [] });
});

test('입력 객체를 변경하지 않음', () => {
  const input = { a: null, b: 1 };
  pruneNullVariables(input);
  assert.deepEqual(input, { a: null, b: 1 });
});
