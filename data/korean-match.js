// 한국어 수동 카탈로그 조회기 (v4.6)
//
// 데이터는 data/korean-catalog.json 에서 관리하고, 브라우저용 모듈은
// `py tools/build_korean_catalog.py` 로 생성합니다.
//
// 매칭 원칙:
//   1. AniList ID가 있으면 AniList ID로만 먼저 찾습니다.
//   2. workId가 있으면 workId로 찾습니다.
//   3. idMal / mal_id / mal: 접두사가 있을 때만 MAL ID로 찾습니다.
//   4. 제목만 같은 경우는 절대 연결하지 않습니다. (시즌·극장판 오매칭 방지)
//   5. 숫자 id를 MAL ID로 추측하지 않습니다.

import { KOREAN_CATALOG, KOREAN_CATALOG_META } from './korean-catalog.js';

const byAniListId = new Map();
const byMalId = new Map();
const byWorkId = new Map();

for (const record of KOREAN_CATALOG) {
  if (record.anilistId != null) byAniListId.set(String(record.anilistId), record);
  if (record.malId != null) byMalId.set(String(record.malId), record);
  if (record.workId) byWorkId.set(String(record.workId), record);
}

/**
 * 앱 화면에서 쓰는 표시용 레코드로 변환합니다.
 * 기존 v4.5.1의 {title, overview, source, url} 형태를 유지하고
 * checkedAt/status/workId를 추가로 제공합니다.
 */
function toDisplayRecord(record) {
  if (!record) return null;
  return {
    title: record.title,
    overview: record.overview,
    source: record.source,
    url: record.sourceUrl,
    checkedAt: record.checkedAt,
    status: record.status,
    workId: record.workId
  };
}

/** @returns {Map<string, object>} AniList ID -> 원본 레코드 (읽기 전용 용도) */
export function koreanCatalogByAniListId() {
  return new Map(byAniListId);
}

/** @returns {object|null} 일치하는 원본 카탈로그 레코드 */
export function findKoreanCatalogEntry(media) {
  if (!media || typeof media !== 'object') return null;

  const rawId = media.id ?? media.media_id ?? media.anilistId ?? media.anilist_id;
  const idKey = rawId == null ? '' : String(rawId).trim();

  // 1) AniList ID 직접 매칭
  if (idKey && byAniListId.has(idKey)) return byAniListId.get(idKey);

  // 2) workId 매칭 (v4.8 canonical work 마이그레이션 대비)
  const rawWorkId = media.workId ?? media.work_id;
  if (rawWorkId != null && byWorkId.has(String(rawWorkId))) return byWorkId.get(String(rawWorkId));

  // 3) MAL ID 매칭 — 명시된 경우에만
  let malId = media.idMal ?? media.mal_id ?? media.malId ?? media.mal;
  if (malId == null && idKey.toLowerCase().startsWith('mal:')) malId = idKey.slice(4);
  if (malId == null) return null;

  const malKey = String(malId).trim();
  if (!/^\d+$/.test(malKey) || malKey === '0') return null;
  return byMalId.get(malKey) || null;
}

/** @returns {{title:string,overview:string,source:string,url:string,checkedAt:string,status:string,workId:string}|null} */
export function findKoreanCatalogRecord(media) {
  return toDisplayRecord(findKoreanCatalogEntry(media));
}

export { KOREAN_CATALOG, KOREAN_CATALOG_META };
