import test from 'node:test';
import assert from 'node:assert/strict';
import {
  levenshtein,
  similarity,
  normalizeForSearch,
  fuzzyMatch,
  fuzzyFilter,
  searchVariants
} from '../data/fuzzy-search.js';
import { searchNamuWiki, lookupNamuTitle } from '../data/namu-search.js';

function withFetch(stub, fn) {
  const real = globalThis.fetch;
  globalThis.fetch = stub;
  return Promise.resolve(fn()).finally(() => { globalThis.fetch = real; });
}

test('levenshtein: 표준 예제', () => {
  assert.equal(levenshtein('kitten', 'sitting'), 3);
  assert.equal(levenshtein('같음', '같음'), 0);
  assert.equal(levenshtein('', 'abc'), 3);
});

test('similarity: 동일 문자열은 1', () => {
  assert.equal(similarity('abc', 'abc'), 1);
  assert.equal(similarity('', ''), 1);
});

test('normalizeForSearch: 공백/기호/시즌 제거', () => {
  assert.equal(normalizeForSearch('귀멸의 칼날: 무한성편'), '귀멸의칼날무한성편');
  assert.equal(normalizeForSearch('귀멸의 칼날 시즌2'), '귀멸의칼날');
});

test('fuzzyMatch: 부분 포함과 오타 허용', () => {
  assert.equal(fuzzyMatch('귀멸의칼', '귀멸의 칼날'), true);
  assert.equal(fuzzyMatch('진격거인', '진격의 거인'), true);
  assert.equal(fuzzyMatch('주술회전', '진격의 거인'), false);
});

test('fuzzyFilter: 띄어쓰기/별칭/무관한 검색어', () => {
  const pool = [
    { title: { romaji: 'Kimetsu no Yaiba' } },
    { title: { romaji: 'Shingeki no Kyojin' } },
    { title: { native: '呪術廻戦' }, synonyms: ['주술회전'] }
  ];
  assert.equal(fuzzyFilter(pool, 'kimetsu yaiba').length, 1);
  assert.equal(fuzzyFilter(pool, '주술회전').length, 1);
  assert.equal(fuzzyFilter(pool, '전혀무관한작품').length, 0);
  assert.equal(fuzzyFilter(pool, '').length, 3);
});

test('searchVariants: 공백 제거 변형', () => {
  assert.deepEqual(searchVariants('귀멸의 칼날'), ['귀멸의 칼날', '귀멸의칼날']);
});

test('searchNamuWiki: MediaWiki 형태 응답 파싱', async () => {
  const body = { query: { search: { results: [
    { title: '귀멸의 칼날', snippet: '일본의 만화' },
    { title: '귀멸의 칼날/등장인물', snippet: '등장인물' }
  ] } } };
  const parsed = await withFetch(
    async () => new Response(JSON.stringify(body), { status: 200 }),
    () => searchNamuWiki('귀멸의 칼날')
  );
  assert.equal(parsed.length, 2);
  assert.equal(parsed[0].source, '나무위키');
  assert.equal(parsed[0].title, '귀멸의 칼날');
  assert.match(parsed[0].url, /^https:\/\/namu\.wiki\/wiki\//);
});

test('searchNamuWiki: 평면 results 형태도 지원', async () => {
  const parsed = await withFetch(
    async () => new Response(JSON.stringify({ results: [{ title: '진격의 거인' }] }), { status: 200 }),
    () => searchNamuWiki('진격의 거인')
  );
  assert.equal(parsed[0].title, '진격의 거인');
});

test('searchNamuWiki: 실패 응답/오류는 빈 배열', async () => {
  const notFound = await withFetch(
    async () => new Response('not found', { status: 404 }),
    () => searchNamuWiki('없는문서')
  );
  assert.deepEqual(notFound, []);

  const networkFail = await withFetch(
    async () => { throw new Error('network down'); },
    () => searchNamuWiki('네트워크실패')
  );
  assert.deepEqual(networkFail, []);

  const malformed = await withFetch(
    async () => new Response('<html>not json</html>', { status: 200 }),
    () => searchNamuWiki('깨진응답')
  );
  assert.deepEqual(malformed, []);
});

test('searchNamuWiki: 2자 미만 검색어는 요청하지 않음', async () => {
  let calls = 0;
  const result = await withFetch(
    async () => { calls += 1; return new Response('{}', { status: 200 }); },
    () => searchNamuWiki('a')
  );
  assert.equal(calls, 0);
  assert.deepEqual(result, []);
});

test('lookupNamuTitle: 첫 결과 반환', async () => {
  const found = await withFetch(
    async () => new Response(JSON.stringify({ query: { search: { results: [{ title: '강철의 연금술사' }] } } }), { status: 200 }),
    () => lookupNamuTitle({ title: { native: '鋼の錬金術師' } })
  );
  assert.equal(found?.title, '강철의 연금술사');
});
