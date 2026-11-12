import test from 'node:test';
import assert from 'node:assert/strict';
import {
  setKoreanTitlesDb,
  lookupKoreanTitle,
  lookupKoreanNamuTitle,
  lookupKoreanWikiTitle,
  filterVerifiedDb,
  isVerifiedKoreanSource
} from '../data/korean-titles-db.js';
import {
  generateKoreanQueryCandidates,
  normalizeKoreanQueryCandidates
} from '../data/korean-query.js';
import { lookupKoreanSource, createKoreanSourceResolver } from '../data/korean-source.js';

test('verified source: 실제 한국어 출처만 허용', () => {
  assert.equal(isVerifiedKoreanSource('anilist'), true);
  assert.equal(isVerifiedKoreanSource('tmdb'), true);
  assert.equal(isVerifiedKoreanSource('namu'), true);
  assert.equal(isVerifiedKoreanSource('wiki'), true);
  assert.equal(isVerifiedKoreanSource('google'), false);
  assert.equal(isVerifiedKoreanSource('gemini'), false);
  assert.equal(isVerifiedKoreanSource('machine'), false);
  assert.equal(isVerifiedKoreanSource(''), false);
});

test('filterVerifiedDb: 기계 번역/빈 항목을 제거하고 원본은 보존', () => {
  const raw = {
    version: 1,
    entries: {
      '1': { title: '귀멸의 칼날', source: 'anilist' },
      '2': { title: '날씨의 아이', source: 'google' },
      '3': { title: 'AI 제목', source: 'gemini' },
      '4': { title: null, source: 'none' },
      '5': { title: '주술회전', source: 'tmdb' }
    }
  };
  const filtered = filterVerifiedDb(raw);
  assert.deepEqual(Object.keys(filtered.entries).sort(), ['1', '5']);
  assert.equal(filtered.count, 2);
  assert.equal(Object.keys(raw.entries).length, 5, '원본 DB는 변경하지 않아야 합니다.');
});

test('lookupKoreanTitle: 기계 번역 항목은 반환하지 않음', () => {
  setKoreanTitlesDb({
    entries: {
      '1': { title: '귀멸의 칼날', source: 'anilist' },
      '2': { title: '날씨의 아이', source: 'google' },
      '3': { title: 'AI 제목', source: 'gemini' },
      '4': { title: null, source: 'none' }
    }
  });
  assert.equal(lookupKoreanTitle({ id: 1 })?.title, '귀멸의 칼날');
  assert.equal(lookupKoreanTitle({ id: 1 })?.kind, 'anilist');
  assert.equal(lookupKoreanTitle({ id: 2 }), null);
  assert.equal(lookupKoreanTitle({ id: 3 }), null);
  assert.equal(lookupKoreanTitle({ id: 4 }), null);
});

test('lookupKoreanTitle: TMDB 항목은 TMDB 출처로 표시', () => {
  setKoreanTitlesDb({
    entries: {
      '10': { title: '진격의 거인', overview: '거인과 싸우는 이야기.', source: 'tmdb', url: 'https://www.themoviedb.org/tv/1' }
    }
  });
  const found = lookupKoreanTitle({ id: 10 });
  assert.equal(found?.source, 'TMDB 한국어 등록 번역');
  assert.equal(found?.kind, 'tmdb');
  assert.equal(found?.overview, '거인과 싸우는 이야기.');
});

test('lookupKoreanWikiTitle: wikiEntries를 AniList ID/MAL ID로 조회', () => {
  setKoreanTitlesDb({
    entries: { '1': { title: '귀멸의 칼날', source: 'anilist' } },
    wikiEntries: {
      '2': {
        anilistId: 2,
        title: '장송의 프리렌',
        overview: '마왕을 쓰러뜨린 뒤의 이야기.',
        source: 'wiki',
        url: 'https://ko.wikipedia.org/wiki/장송의_프리렌'
      },
      'mal:3': { anilistId: null, malId: 3, title: '체인소 맨', source: 'wiki' }
    }
  });
  const byId = lookupKoreanWikiTitle({ id: 2 });
  assert.equal(byId?.title, '장송의 프리렌');
  assert.equal(byId?.kind, 'wiki');
  assert.equal(byId?.source, '한국어 위키백과');
  assert.equal(byId?.overview, '마왕을 쓰러뜨린 뒤의 이야기.');
  assert.equal(byId?.url, 'https://ko.wikipedia.org/wiki/장송의_프리렌');
  assert.equal(lookupKoreanWikiTitle({ id: 99, idMal: 3 })?.title, '체인소 맨');
  assert.equal(lookupKoreanWikiTitle({ id: 1 }), null);
});

test('lookupKoreanNamuTitle: namuEntries를 AniList ID/MAL ID로 조회', () => {
  setKoreanTitlesDb({
    entries: { '1': { title: '귀멸의 칼날', source: 'anilist' } },
    namuEntries: {
      '2': {
        anilistId: 2,
        title: '장송의 프리렌',
        overview: '마왕을 쓰러뜨린 뒤의 이야기.',
        source: 'namu',
        url: 'https://namu.wiki/w/장송의_프리렌'
      },
      'mal:3': { anilistId: null, malId: 3, title: '체인소 맨', source: 'namu' }
    }
  });
  const byId = lookupKoreanNamuTitle({ id: 2 });
  assert.equal(byId?.title, '장송의 프리렌');
  assert.equal(byId?.kind, 'namu');
  assert.equal(byId?.source, '나무위키');
  assert.equal(byId?.overview, '마왕을 쓰러뜨린 뒤의 이야기.');
  assert.equal(byId?.url, 'https://namu.wiki/w/장송의_프리렌');
  assert.equal(lookupKoreanNamuTitle({ id: 99, idMal: 3 })?.title, '체인소 맨');
  assert.equal(lookupKoreanNamuTitle({ id: 1 }), null);
});

test('lookupKoreanNamuTitle: 검증되지 않은 출처는 반환하지 않음', () => {
  setKoreanTitlesDb({
    entries: {},
    namuEntries: {
      '5': { title: 'AI 번역 제목', source: 'gemini' }
    }
  });
  assert.equal(lookupKoreanNamuTitle({ id: 5 }), null);
});

test('filterVerifiedDb: namuEntries도 검증 출처만 남김', () => {
  const filtered = filterVerifiedDb({
    entries: { '1': { title: '귀멸의 칼날', source: 'anilist' } },
    namuEntries: {
      '1': { title: '나무위키 제목', source: 'namu' },
      '2': { title: 'AI 제목', source: 'gemini' },
      '3': { title: '' }
    }
  });
  assert.deepEqual(Object.keys(filtered.namuEntries), ['1']);
  assert.equal(filtered.namuCount, 1);
  assert.equal(filtered.count, 1);
});

test('lookupKoreanWikiTitle: 검증되지 않은 출처는 반환하지 않음', () => {
  setKoreanTitlesDb({
    entries: {},
    wikiEntries: {
      '5': { title: 'AI 번역 제목', source: 'gemini' }
    }
  });
  assert.equal(lookupKoreanWikiTitle({ id: 5 }), null);
});

test('filterVerifiedDb: wikiEntries도 검증 출처만 남김', () => {
  const filtered = filterVerifiedDb({
    entries: { '1': { title: '귀멸의 칼날', source: 'anilist' } },
    wikiEntries: {
      '1': { title: '위키 제목', source: 'wiki' },
      '2': { title: 'AI 제목', source: 'gemini' },
      '3': { title: '' }
    }
  });
  assert.deepEqual(Object.keys(filtered.wikiEntries), ['1']);
  assert.equal(filtered.wikiCount, 1);
  assert.equal(filtered.count, 1);
});

test('한국어 검색 후보: 부제/시즌 표기 변형 생성', () => {
  assert.deepEqual(
    normalizeKoreanQueryCandidates('귀멸의 칼날: 무한열차편', 'Kimetsu no Yaiba'),
    ['귀멸의 칼날: 무한열차편', '귀멸의 칼날']
  );
  assert.deepEqual(
    normalizeKoreanQueryCandidates('진격의 거인 제2기', 'Shingeki no Kyojin'),
    ['진격의 거인 제2기', '진격의 거인']
  );
});

test('한국어 검색 후보: 한국어가 없거나 너무 짧으면 제외', () => {
  assert.deepEqual(normalizeKoreanQueryCandidates('Steins;Gate', 'Steins;Gate'), []);
  assert.deepEqual(normalizeKoreanQueryCandidates('a', 'a'), []);
  assert.deepEqual(normalizeKoreanQueryCandidates('', 'x'), []);
});

test('generateKoreanQueryCandidates: AI 응답을 검색 후보로만 변환', async () => {
  const candidates = await generateKoreanQueryCandidates('鬼滅の刃', {
    translate: async () => ({ text: '귀멸의 칼날: 무한열차편' })
  });
  assert.deepEqual(candidates, ['귀멸의 칼날: 무한열차편', '귀멸의 칼날']);
});

test('generateKoreanQueryCandidates: 번역 함수가 없거나 실패하면 빈 배열', async () => {
  assert.deepEqual(await generateKoreanQueryCandidates('鬼滅の刃'), []);
  assert.deepEqual(
    await generateKoreanQueryCandidates('鬼滅の刃', { translate: async () => { throw new Error('AI 실패'); } }),
    []
  );
});

test('resolver: 나무위키 결과가 있으면 위키백과를 호출하지 않음', async () => {
  let aiCalls = 0;
  let wikiCalls = 0;
  const found = await lookupKoreanSource('鬼滅の刃', {
    searchNamu: async () => [{ title: '귀멸의 칼날', overview: '일본의 만화', source: '나무위키' }],
    lookupWiki: async () => { wikiCalls += 1; return null; },
    isNamuCoolingDown: () => false,
    translate: async () => { aiCalls += 1; return '귀멸의 칼날'; }
  });
  assert.equal(found?.title, '귀멸의 칼날');
  assert.equal(found?.kind, 'namu');
  assert.equal(aiCalls, 0, '나무위키 직접 검색이 성공하면 AI를 쓰지 않습니다.');
  assert.equal(wikiCalls, 0);
});

test('resolver: AI 후보는 나무위키 재검색에만 쓰이고 결과로 반환되지 않음', async () => {
  const queries = [];
  const found = await lookupKoreanSource('Kimetsu no Yaiba', {
    searchNamu: async (query) => {
      queries.push(query);
      return query === '귀멸의 칼날' ? [{ title: '귀멸의 칼날', source: '나무위키' }] : [];
    },
    lookupWiki: async () => null,
    isNamuCoolingDown: () => false,
    translate: async () => '귀멸의 칼날'
  });
  assert.deepEqual(queries, ['Kimetsu no Yaiba', '귀멸의 칼날']);
  assert.equal(found?.title, '귀멸의 칼날');
  assert.equal(found?.source, '나무위키');
  assert.equal(found?.kind, 'namu');
});

test('resolver: 나무위키/AI 검색이 실패하면 AI 결과를 반환하지 않고 null', async () => {
  let returnedText = null;
  const found = await lookupKoreanSource('원제', {
    searchNamu: async () => [],
    lookupWiki: async () => null,
    isNamuCoolingDown: () => false,
    translate: async () => { returnedText = 'AI가 만든 한국어 제목'; return returnedText; },
    logger: { warn() {} }
  });
  assert.equal(found, null);
  assert.equal(returnedText, 'AI가 만든 한국어 제목', 'AI 호출 자체는 검색 후보 생성에 사용됩니다.');
});

test('resolver: 나무위키가 실패하면 한국어 위키백과로 폴백', async () => {
  let wikiQuery = null;
  const found = await lookupKoreanSource('ぼっち・ざ・ろっく！', {
    searchNamu: async () => [],
    lookupWiki: async (query) => {
      wikiQuery = query;
      return { title: '봇치 더 록!', overview: '일본의 만화.', source: '한국어 위키백과', url: 'https://ko.wikipedia.org/wiki/봇치_더_록!' };
    },
    isNamuCoolingDown: () => false,
    translate: async () => '봇치 더 록!'
  });
  assert.equal(wikiQuery, 'ぼっち・ざ・ろっく！');
  assert.equal(found?.kind, 'wiki');
  assert.equal(found?.source, '한국어 위키백과');
});

test('resolver: 나무위키 쿨다운 중에는 검색을 건너뜀', async () => {
  let namuCalls = 0;
  let wikiCalls = 0;
  const found = await lookupKoreanSource('진격의 거인', {
    searchNamu: async () => { namuCalls += 1; return []; },
    lookupWiki: async () => { wikiCalls += 1; return { title: '진격의 거인', overview: '거인과 싸우는 이야기.' }; },
    isNamuCoolingDown: () => true,
    translate: async () => '진격의 거인'
  });
  assert.equal(namuCalls, 0);
  assert.equal(wikiCalls, 1);
  assert.equal(found?.kind, 'wiki');
});

test('resolver: 모든 소스 오류는 안전하게 null', async () => {
  const found = await lookupKoreanSource('네트워크실패', {
    searchNamu: async () => { throw new Error('namu down'); },
    lookupWiki: async () => { throw new Error('wiki down'); },
    isNamuCoolingDown: () => false,
    translate: async () => { throw new Error('ai down'); },
    logger: { warn() {} }
  });
  assert.equal(found, null);
});

test('resolver: 2자 미만 제목은 조회하지 않음', async () => {
  let calls = 0;
  const found = await lookupKoreanSource('a', {
    searchNamu: async () => { calls += 1; return []; },
    lookupWiki: async () => { calls += 1; return null; },
    isNamuCoolingDown: () => false
  });
  assert.equal(found, null);
  assert.equal(calls, 0);
});

test('createKoreanSourceResolver: 의존성을 고정해 재사용', async () => {
  const resolve = createKoreanSourceResolver({
    searchNamu: async () => [{ title: '고정 결과', source: '나무위키' }],
    isNamuCoolingDown: () => false
  });
  const found = await resolve('아무 제목');
  assert.equal(found?.title, '고정 결과');
  assert.equal(found?.kind, 'namu');
});
