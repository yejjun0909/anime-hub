import test from 'node:test';
import assert from 'node:assert/strict';
import { KOREAN_TITLE_INDEX, findKoreanTitleEntry, normalizeTitleKey } from '../data/korean-title-index.js';

test('제목 인덱스: 규모와 필수 필드', () => {
  const entries = Object.entries(KOREAN_TITLE_INDEX);
  assert.ok(entries.length >= 100, `항목이 너무 적습니다: ${entries.length}`);
  for (const [title, entry] of entries) {
    assert.ok(title.trim().length > 0);
    assert.ok(Number.isInteger(entry.malId) && entry.malId > 0, `${title}: malId`);
    assert.match(String(entry.anilistId), /^\d+$/, `${title}: anilistId`);
    assert.ok(entry.searchTerm && entry.searchTerm.length > 0, `${title}: searchTerm`);
  }
});

test('제목 인덱스: 정확 매칭', () => {
  const entry = findKoreanTitleEntry('원령공주');
  assert.equal(entry?.malId, 164);
  assert.equal(entry?.searchTerm, 'Princess Mononoke');
  assert.equal(entry?.romaji, 'Mononoke-hime');
});

test('제목 인덱스: 띄어쓰기 누락 퍼지 매칭', () => {
  assert.equal(findKoreanTitleEntry('진격거인')?.malId, 16498);
});

test('제목 인덱스: 대표 제목은 파생 작품이 아닌 본편을 가리킨다', () => {
  assert.equal(findKoreanTitleEntry('진격의 거인')?.malId, 16498);
  assert.equal(findKoreanTitleEntry('진격의 거인 1기')?.malId, 16498);
});

test('제목 인덱스: 시즌 표기 무시', () => {
  assert.equal(findKoreanTitleEntry('귀멸의 칼날 시즌2')?.title, '귀멸의 칼날');
});

test('제목 인덱스: 플랫폼 확인 제목은 같은 작품을 가리킨다', () => {
  const entry = findKoreanTitleEntry('귀환자의 마법은 특별해야 합니다');
  assert.equal(entry?.anilistId, '163142');
});

test('제목 인덱스: 기호/공백 차이 무시', () => {
  assert.equal(findKoreanTitleEntry('Re:제로부터 시작하는 이세계 생활')?.malId, 31240);
});

test('제목 인덱스: 무관한 검색어는 null', () => {
  assert.equal(findKoreanTitleEntry('zzzzqqqqxxxx'), null);
});

test('제목 인덱스: 빈 입력 안전', () => {
  assert.equal(findKoreanTitleEntry(''), null);
  assert.equal(findKoreanTitleEntry('   '), null);
  assert.equal(findKoreanTitleEntry(null), null);
});

test('제목 인덱스: 정규화 규칙', () => {
  assert.equal(normalizeTitleKey('귀멸의 칼날'), '귀멸의칼날');
  assert.equal(normalizeTitleKey('귀멸의 칼날 시즌 3'), '귀멸의칼날');
  assert.equal(normalizeTitleKey('Demon Slayer season 2'), 'demonslayer');
});
