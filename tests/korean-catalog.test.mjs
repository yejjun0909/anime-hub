// 한국어 카탈로그·ID 매칭 테스트 (Node 20+)
// 실행: npm test   또는   node --test tests/
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  KOREAN_CATALOG,
  KOREAN_CATALOG_META,
  findKoreanCatalogEntry,
  findKoreanCatalogRecord
} from '../data/korean-match.js';

const readJson = (relative) =>
  JSON.parse(readFileSync(new URL(relative, import.meta.url), 'utf8'));

const catalogFile = readJson('../data/korean-catalog.json');
const cases = readJson('./korean-id-cases.json');

const REQUIRED = [
  'workId', 'anilistId', 'malId', 'tmdbId', 'kind', 'title', 'overview',
  'source', 'sourceUrl', 'region', 'checkedAt', 'status', 'note'
];

test('카탈로그: 메타 정보', () => {
  assert.equal(KOREAN_CATALOG_META.schemaVersion, 1);
  assert.equal(KOREAN_CATALOG_META.region, 'KR');
});

test('카탈로그: 원본 JSON과 생성 모듈의 레코드 수가 같다', () => {
  assert.equal(KOREAN_CATALOG.length, catalogFile.records.length);
  assert.ok(KOREAN_CATALOG.length >= 13, '수동 카탈로그가 13건 이상이어야 합니다.');
});

test('카탈로그: 레코드 필수 필드·값', () => {
  for (const record of KOREAN_CATALOG) {
    for (const field of REQUIRED) assert.ok(field in record, `${record.workId}: ${field} 누락`);
    assert.match(record.workId, /^[a-z0-9-]+$/);
    assert.ok(Number.isInteger(record.anilistId) && record.anilistId > 0);
    assert.ok(record.malId === null || (Number.isInteger(record.malId) && record.malId > 0));
    assert.match(record.title, /[가-힣]/, `${record.workId}: 한국어 제목 아님`);
    assert.ok(record.overview.length >= 40, `${record.workId}: 소개가 너무 짧음`);
    assert.match(record.sourceUrl, /^https:\/\//);
    assert.match(record.checkedAt, /^\d{4}-\d{2}-\d{2}$/);
    assert.equal(record.region, 'KR');
    assert.ok(['verified', 'alias', 'community', 'unverified'].includes(record.status));
  }
});

test('카탈로그: workId·AniList ID·MAL ID 유일성', () => {
  for (const key of ['workId', 'anilistId', 'malId']) {
    const values = KOREAN_CATALOG.map((r) => r[key]).filter((v) => v != null).map(String);
    assert.equal(new Set(values).size, values.length, `${key} 중복`);
  }
});

test('카탈로그: 모든 레코드에 workId·확인일·출처 URL', () => {
  for (const record of KOREAN_CATALOG) {
    assert.ok(record.workId);
    assert.ok(record.checkedAt);
    assert.match(record.sourceUrl, /^https:\/\//);
  }
});

test('카탈로그: 표시용 레코드 형태가 v4.5.1 호출부와 호환', () => {
  const display = findKoreanCatalogRecord({ id: 16498 });
  assert.equal(typeof display.title, 'string');
  assert.equal(typeof display.overview, 'string');
  assert.equal(typeof display.source, 'string');
  assert.equal(typeof display.url, 'string');
  assert.equal(display.workId, 'attack-on-titan');
  assert.equal(display.status, 'verified');
});

for (const testCase of cases) {
  test(`매칭: ${testCase.name}`, () => {
    const record = findKoreanCatalogRecord(testCase.media);
    const actual = record?.workId ?? null;
    assert.equal(actual, testCase.expectWorkId, testCase.why);
  });
}

test('매칭: 원본 레코드 조회는 표시용과 같은 작품', () => {
  const entry = findKoreanCatalogEntry({ id: 'mal:40748' });
  assert.equal(entry.workId, 'jujutsu-kaisen');
});

test('매칭: 양수 케이스가 카탈로그 전체 작품을 커버', () => {
  const covered = new Set(cases.map((c) => c.expectWorkId).filter(Boolean));
  for (const record of KOREAN_CATALOG) {
    assert.ok(covered.has(record.workId), `${record.workId} 양수 매칭 케이스 없음`);
  }
});
