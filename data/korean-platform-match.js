// 국내 플랫폼 카탈로그 조회기 (v4.8)
//
// 데이터는 data/korean-platform-catalog.json 에서 관리하고, 브라우저용 모듈은
// `py tools/build_korean_platform_catalog.py` 로 생성합니다.
//
// 매칭 원칙:
//   1. AniList ID가 있으면 AniList ID로만 먼저 찾습니다.
//   2. workId가 있으면 workId로 찾습니다.
//   3. idMal / mal_id / mal: 접두사가 있을 때만 MAL ID로 찾습니다.
//   4. 제목만 같은 경우는 연결하지 않습니다. (시즌·극장판 오매칭 방지)
//   5. 숫자 id를 MAL ID로 추측하지 않습니다.
//
// 표시 우선순위는 국내 플랫폼 순서(라프텔 → 애니플러스 → 왓챠 → 티빙 → 웨이브 →
// 넷플릭스 → 쿠팡플레이 → 디즈니+ → Apple TV)입니다.

import { KOREAN_PLATFORM_CATALOG, KOREAN_PLATFORM_META } from './korean-platform-catalog.js';

export const KOREAN_PLATFORM_PRIORITY = Object.freeze({
  laftel: 1,
  aniplus: 2,
  watcha: 3,
  tving: 4,
  wavve: 5,
  netflix: 6,
  coupangplay: 7,
  disneyplus: 8,
  apple: 9
});

export const KOREAN_PLATFORM_NAMES = Object.freeze({
  laftel: '라프텔',
  aniplus: '애니플러스',
  watcha: '왓챠',
  tving: '티빙',
  wavve: '웨이브',
  netflix: '넷플릭스',
  coupangplay: '쿠팡플레이',
  disneyplus: '디즈니+',
  apple: 'Apple TV'
});

const DEFAULT_PRIORITY = 50;

function platformPriority(platform) {
  const key = String(platform || '').trim().toLowerCase();
  return KOREAN_PLATFORM_PRIORITY[key] ?? DEFAULT_PRIORITY;
}

export function koreanPlatformName(platform) {
  const key = String(platform || '').trim().toLowerCase();
  return KOREAN_PLATFORM_NAMES[key] || String(platform || '').trim() || '국내 플랫폼';
}

function isDisplayable(record) {
  return Boolean(
    record &&
      String(record.title || '').trim() &&
      String(record.sourceUrl || '').startsWith('https://') &&
      record.region === 'KR' &&
      (record.status === 'verified' || record.status === 'alias')
  );
}

function compareRecords(a, b) {
  return (
    platformPriority(a.platform) - platformPriority(b.platform) ||
    Number(b.year || 0) - Number(a.year || 0) ||
    Number(a.platformId || 0) - Number(b.platformId || 0)
  );
}

function indexCatalog(records) {
  const byAniListId = new Map();
  const byMalId = new Map();
  const byWorkId = new Map();
  const push = (map, key, record) => {
    if (key == null || key === '') return;
    const list = map.get(String(key)) || [];
    list.push(record);
    map.set(String(key), list);
  };
  for (const record of records) {
    if (!isDisplayable(record)) continue;
    push(byAniListId, record.anilistId, record);
    push(byMalId, record.malId, record);
    push(byWorkId, record.workId, record);
  }
  for (const map of [byAniListId, byMalId, byWorkId]) {
    for (const list of map.values()) list.sort(compareRecords);
  }
  return { byAniListId, byMalId, byWorkId };
}

const INDEX = indexCatalog(KOREAN_PLATFORM_CATALOG);

function uniqueRecords(records) {
  const seen = new Set();
  const result = [];
  for (const record of records) {
    if (!isDisplayable(record)) continue;
    const key = `${record.platform}:${record.platformId ?? record.sourceUrl}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(record);
  }
  return result.sort(compareRecords);
}

/**
 * 해당 작품에 대해 확인된 국내 플랫폼 레코드를 우선순위 순으로 돌려줍니다.
 * ID가 일치하는 항목만 사용하며, 제목 유사도로 연결하지 않습니다.
 */
export function listKoreanPlatformRecords(media) {
  if (!media || typeof media !== 'object') return [];

  const rawId = media.id ?? media.media_id ?? media.anilistId ?? media.anilist_id;
  const idKey = rawId == null ? '' : String(rawId).trim();
  const found = [];

  if (idKey && INDEX.byAniListId.has(idKey)) {
    found.push(...INDEX.byAniListId.get(idKey));
  }

  const rawWorkId = media.workId ?? media.work_id;
  if (rawWorkId != null && INDEX.byWorkId.has(String(rawWorkId))) {
    found.push(...INDEX.byWorkId.get(String(rawWorkId)));
  }

  let malId = media.idMal ?? media.mal_id ?? media.malId ?? media.mal;
  if (malId == null && idKey.toLowerCase().startsWith('mal:')) malId = idKey.slice(4);
  if (malId != null) {
    const malKey = String(malId).trim();
    if (/^\d+$/.test(malKey) && malKey !== '0' && INDEX.byMalId.has(malKey)) {
      found.push(...INDEX.byMalId.get(malKey));
    }
  }

  return uniqueRecords(found);
}

/** @returns {{title:string,overview:string,source:string,url:string,kind:string,platform:string,platformName:string,checkedAt:string,year:number|null}|null} */
export function findKoreanPlatformRecord(media) {
  const record = listKoreanPlatformRecords(media)[0];
  if (!record) return null;
  return {
    title: String(record.title || '').trim(),
    overview: String(record.overview || '').trim(),
    source: koreanPlatformName(record.platform),
    url: String(record.sourceUrl || '').trim(),
    kind: 'platform',
    platform: String(record.platform || '').trim(),
    platformName: koreanPlatformName(record.platform),
    checkedAt: String(record.checkedAt || ''),
    year: record.year ?? null
  };
}

/** 확인된 국내 플랫폼 이름 목록 (중복 제거, 우선순위 순). */
export function listKoreanPlatformNames(media) {
  return [...new Set(listKoreanPlatformRecords(media).map((record) => koreanPlatformName(record.platform)))];
}

export { KOREAN_PLATFORM_CATALOG, KOREAN_PLATFORM_META };
