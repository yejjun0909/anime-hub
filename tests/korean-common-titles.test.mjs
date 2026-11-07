import test from 'node:test';
import assert from 'node:assert/strict';
import { COMMON_KOREAN_TITLES, COMMON_TITLE_SOURCE, lookupCommonKoreanTitle } from '../data/korean-common-titles.js';
import { KOREAN_CATALOG } from '../data/korean-catalog.js';

test('통용 제목: idMal로 조회', () => {
  const r = lookupCommonKoreanTitle({ id: 1535, idMal: 1535 });
  assert.equal(r.title, '데스노트');
  assert.equal(r.source, COMMON_TITLE_SOURCE);
  assert.equal(r.kind, 'common');
});

test('통용 제목: mal: 접두사와 mal_id 지원', () => {
  assert.equal(lookupCommonKoreanTitle({ id: 'mal:269' }).title, '블리치');
  assert.equal(lookupCommonKoreanTitle({ mal_id: '918' }).title, '은혼');
});

test('통용 제목: 숫자 id만으로는 MAL ID로 추측하지 않음', () => {
  assert.equal(lookupCommonKoreanTitle({ id: 1535 }), null);
  assert.equal(lookupCommonKoreanTitle({ id: '269' }), null);
});

test('통용 제목: 잘못된 입력은 null', () => {
  for (const v of [null, undefined, 'x', {}, { idMal: 0 }, { idMal: 'abc' }, { idMal: -5 }, { idMal: 99999999 }]) {
    assert.equal(lookupCommonKoreanTitle(v), null);
  }
});

test('통용 제목: 모든 항목은 양의 정수 ID와 한글이 포함된 제목', () => {
  const hangul = /[\uAC00-\uD7A3]/;
  const entries = Object.entries(COMMON_KOREAN_TITLES);
  assert.ok(entries.length >= 60);
  for (const [id, title] of entries) {
    assert.match(id, /^[1-9]\d*$/);
    assert.ok(hangul.test(title), `${id}: ${title}`);
    assert.equal(title, title.trim());
  }
});

test('통용 제목: 수동 카탈로그와 겹치지 않음(카탈로그가 우선)', () => {
  const mal = new Set(KOREAN_CATALOG.map((r) => String(r.malId)));
  for (const id of Object.keys(COMMON_KOREAN_TITLES)) assert.ok(!mal.has(id), `catalog와 중복: ${id}`);
});
