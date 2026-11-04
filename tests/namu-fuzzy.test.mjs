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
import { searchKoreanWikipedia, lookupKoreanWikipedia } from '../data/korean-wiki.js';

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

test('searchKoreanWikipedia: 검색 결과와 스니펫 HTML 제거', async () => {
  const results = await withFetch(
    async () => new Response(JSON.stringify({ query: { search: [
      { title: '귀멸의 칼날', pageid: 1, snippet: '일본의 <span class="searchmatch">만화</span>다.' }
    ] } }), { status: 200 }),
    () => searchKoreanWikipedia('鬼滅の刃')
  );
  assert.equal(results.length, 1);
  assert.equal(results[0].title, '귀멸의 칼날');
  assert.equal(results[0].snippet, '일본의 만화다.');
});

test('lookupKoreanWikipedia: 애니메이션 문서 조회', async () => {
  const found = await withFetch(
    async (url) => {
      if (String(url).includes('list=search')) {
        return new Response(JSON.stringify({ query: { search: [{ title: '귀멸의 칼날', snippet: '일본의 만화' }] } }), { status: 200 });
      }
      return new Response(JSON.stringify({ query: { pages: [{ title: '귀멸의 칼날', extract: '《귀멸의 칼날》은 일본의 만화다. 애니메이션으로도 제작되었다.' }] } }), { status: 200 });
    },
    () => lookupKoreanWikipedia('鬼滅の刃')
  );
  assert.equal(found?.title, '귀멸의 칼날');
  assert.equal(found?.source, '한국어 위키백과');
  assert.equal(found?.kind, 'wiki');
  assert.match(found?.url, /^https:\/\/ko\.wikipedia\.org\/wiki\//);
});

test('lookupKoreanWikipedia: 비애니/동음이의 문서 제외', async () => {
  const notAnime = await withFetch(
    async (url) => {
      if (String(url).includes('list=search')) {
        return new Response(JSON.stringify({ query: { search: [{ title: '부산광역시', snippet: '대한민국의 도시' }] } }), { status: 200 });
      }
      return new Response(JSON.stringify({ query: { pages: [{ title: '부산광역시', extract: '부산광역시는 대한민국의 도시이다.' }] } }), { status: 200 });
    },
    () => lookupKoreanWikipedia('부산')
  );
  assert.equal(notAnime, null);

  const disambiguation = await withFetch(
    async (url) => {
      if (String(url).includes('list=search')) {
        return new Response(JSON.stringify({ query: { search: [{ title: '진격 (동음이의)', snippet: '애니메이션' }] } }), { status: 200 });
      }
      return new Response(JSON.stringify({ query: { pages: [{ title: '진격 (동음이의)', extract: '진격은 다음을 가리킨다. 애니메이션 진격의 거인.' }] } }), { status: 200 });
    },
    () => lookupKoreanWikipedia('진격')
  );
  assert.equal(disambiguation, null);
});

test('lookupKoreanWikipedia: 2자 미만 검색어는 요청하지 않음', async () => {
  let calls = 0;
  const found = await withFetch(
    async () => { calls += 1; return new Response('{}', { status: 200 }); },
    () => lookupKoreanWikipedia('a')
  );
  assert.equal(calls, 0);
  assert.equal(found, null);
});

test('lookupKoreanWikipedia: 네트워크 실패는 null', async () => {
  const found = await withFetch(
    async () => { throw new Error('network down'); },
    () => lookupKoreanWikipedia('네트워크실패')
  );
  assert.equal(found, null);
});
