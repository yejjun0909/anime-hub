import test from 'node:test';
import assert from 'node:assert/strict';
import {
  KOREAN_PLATFORM_CATALOG,
  KOREAN_PLATFORM_META,
  KOREAN_PLATFORM_PRIORITY,
  findKoreanPlatformRecord,
  listKoreanPlatformNames,
  koreanPlatformName
} from '../data/korean-platform-match.js';

test('플랫폼 카탈로그: 메타데이터와 검증 상태', () => {
  assert.equal(KOREAN_PLATFORM_META.schemaVersion, 1);
  assert.equal(KOREAN_PLATFORM_META.region, 'KR');
  assert.ok(Array.isArray(KOREAN_PLATFORM_META.platforms));
  assert.ok(KOREAN_PLATFORM_META.platforms.length >= 1);
  assert.ok(KOREAN_PLATFORM_CATALOG.length >= 20);

  const hosts = {
    laftel: 'laftel.net',
    aniplus: 'aniplus.co.kr',
    watcha: 'watcha.com',
    tving: 'tving.com',
    wavve: 'wavve.com',
    netflix: 'netflix.com',
    coupangplay: 'coupangplay.com',
    disneyplus: 'disneyplus.com',
    apple: 'tv.apple.com'
  };
  for (const record of KOREAN_PLATFORM_CATALOG) {
    assert.equal(record.region, 'KR');
    assert.ok(['verified', 'alias'].includes(record.status));
    assert.match(record.title, /[가-힣]/);
    assert.match(record.overview, /[가-힣]/);
    assert.ok(record.sourceUrl.startsWith('https://'));
    assert.ok(record.sourceUrl.includes(hosts[record.platform]), `${record.title}: ${record.sourceUrl}`);
    assert.ok(Number.isInteger(record.anilistId) && record.anilistId > 0);
    assert.ok(Number.isInteger(record.platformId) && record.platformId > 0);
  }
});

test('플랫폼 우선순위: 국내 플랫폼 순서', () => {
  const order = ['laftel', 'aniplus', 'watcha', 'tving', 'wavve', 'netflix', 'coupangplay', 'disneyplus', 'apple'];
  for (let index = 1; index < order.length; index += 1) {
    assert.ok(KOREAN_PLATFORM_PRIORITY[order[index - 1]] < KOREAN_PLATFORM_PRIORITY[order[index]]);
  }
  assert.equal(koreanPlatformName('laftel'), '라프텔');
  assert.equal(koreanPlatformName('aniplus'), '애니플러스');
});

test('플랫폼 조회: AniList ID로 라프텔 항목을 찾는다', () => {
  const record = findKoreanPlatformRecord({ id: 101922 });
  assert.ok(record);
  assert.equal(record.title, '귀멸의 칼날');
  assert.equal(record.source, '라프텔');
  assert.equal(record.kind, 'platform');
  assert.equal(record.platform, 'laftel');
  assert.ok(record.url.includes('/item/39431'));
  assert.deepEqual(listKoreanPlatformNames({ id: 101922 }), ['라프텔']);
});

test('플랫폼 조회: MAL ID와 workId도 사용한다', () => {
  const byMal = findKoreanPlatformRecord({ idMal: 38000 });
  assert.equal(byMal?.title, '귀멸의 칼날');

  const byWork = findKoreanPlatformRecord({ workId: 'anilist-16498' });
  assert.equal(byWork?.title, '진격의 거인 1기');
});

test('플랫폼 조회: 제목만 같아서는 연결하지 않는다', () => {
  assert.equal(findKoreanPlatformRecord({ id: 987654321, title: { userPreferred: '귀멸의 칼날' } }), null);
  assert.deepEqual(listKoreanPlatformNames({ id: 987654321 }), []);
});
