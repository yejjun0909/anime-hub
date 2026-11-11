// 사전 계산 한국어 제목 DB (v4.7+)
//
// tools/build_korean_titles_db.py로 생성된 DB를 로드합니다.
// 이 파일은 "확인된 한국어 출처"만 화면에 노출합니다.
// Google/Gemini 같은 기계 번역 결과는 원본 DB에 남아 있을 수 있지만
// lookupKoreanTitle()에서는 절대 반환하지 않습니다.

// DB는 빌드 시 인라인되거나, 런타임에 fetch됩니다.
// 단일 파일 모드에서는 인라인, 다중 파일 모드에서는 fetch.

export const VERIFIED_KOREAN_SOURCES = Object.freeze([
  'anilist',
  'tmdb',
  'mal',
  'jikan',
  'namu',
  'wiki',
  'catalog',
  'curated',
  'manual'
]);

const SOURCE_META = Object.freeze({
  anilist: { label: 'AniList 한글 별칭', kind: 'anilist' },
  tmdb: { label: 'TMDB 한국어 등록 번역', kind: 'tmdb' },
  mal: { label: 'MyAnimeList 대체 제목', kind: 'jikan' },
  jikan: { label: 'MyAnimeList 대체 제목', kind: 'jikan' },
  namu: { label: '나무위키', kind: 'namu' },
  wiki: { label: '한국어 위키백과', kind: 'wiki' },
  catalog: { label: '국내 카탈로그 확인 자료', kind: 'curated' },
  curated: { label: '국내 카탈로그 확인 자료', kind: 'curated' },
  manual: { label: '수동 확인 자료', kind: 'curated' }
});

let _db = null;
let _dbLoaded = false;

export function isVerifiedKoreanSource(source) {
  return VERIFIED_KOREAN_SOURCES.includes(String(source || '').trim().toLowerCase());
}

function sourceMeta(source) {
  return SOURCE_META[String(source || '').trim().toLowerCase()] || null;
}

function hasDisplayValue(entry) {
  return Boolean(entry && (String(entry.title || '').trim() || String(entry.overview || '').trim()));
}

// 원본 DB는 보존하고, 화면에 표시 가능한 항목만 새 객체로 돌려줍니다.
export function filterVerifiedDb(db) {
  if (!db || typeof db !== 'object') return db;
  const entries = {};
  const rawEntries = db.entries && typeof db.entries === 'object' ? db.entries : {};
  for (const [id, entry] of Object.entries(rawEntries)) {
    if (!hasDisplayValue(entry) || !isVerifiedKoreanSource(entry.source)) continue;
    entries[id] = entry;
  }
  // `wikiEntries`는 한국어 위키백과에서 확인한 제목/소개만 담습니다.
  // 기존 `entries`의 우선순위를 덮지 않도록 별도 저장하고, 별도 조회 함수로만 씁니다.
  const wikiEntries = {};
  const rawWiki = db.wikiEntries && typeof db.wikiEntries === 'object' ? db.wikiEntries : {};
  for (const [key, entry] of Object.entries(rawWiki)) {
    if (!hasDisplayValue(entry)) continue;
    if (entry.source && !isVerifiedKoreanSource(entry.source)) continue;
    wikiEntries[key] = entry;
  }
  return {
    ...db,
    entries,
    count: Object.keys(entries).length,
    wikiEntries,
    wikiCount: Object.keys(wikiEntries).length
  };
}

export function setKoreanTitlesDb(db) {
  _db = filterVerifiedDb(db);
  _dbLoaded = true;
}

export function getKoreanTitlesDb() {
  return _db;
}

export function isDbLoaded() {
  return _dbLoaded;
}

export function getKoreanTitlesDbStats() {
  return {
    loaded: _dbLoaded,
    count: _db?.entries ? Object.keys(_db.entries).length : 0,
    wikiCount: _db?.wikiEntries ? Object.keys(_db.wikiEntries).length : 0,
    sources: _db?.entries
      ? Object.values(_db.entries).reduce((acc, entry) => {
          const source = String(entry?.source || 'none');
          acc[source] = (acc[source] || 0) + 1;
          return acc;
        }, {})
      : {}
  };
}

export function lookupKoreanTitle(media) {
  if (!_db?.entries) return null;
  const id = media?.id != null ? String(media.id) : null;
  if (!id) return null;
  const entry = _db.entries[id];
  if (!entry || !hasDisplayValue(entry)) return null;
  if (!isVerifiedKoreanSource(entry.source)) return null;
  const meta = sourceMeta(entry.source);
  return {
    title: String(entry.title || '').trim(),
    overview: String(entry.overview || '').trim(),
    source: meta?.label || '사전 계산 DB',
    url: String(entry.url || '').trim(),
    kind: meta?.kind || 'db'
  };
}

// 한국어 위키백과에서 수확한 제목/소개를 조회합니다.
// `entries`보다 우선순위가 낮으므로 앱의 제목/소개 체인에서 나무위키·캐시 뒤,
// 국내 통용 표기 앞에서 호출합니다.
export function lookupKoreanWikiTitle(media) {
  const wiki = _db?.wikiEntries;
  if (!wiki) return null;
  const keys = [
    media?.id != null ? String(media.id) : null,
    media?.idMal ? `mal:${media.idMal}` : null,
    media?.mal_id ? `mal:${media.mal_id}` : null
  ].filter(Boolean);
  for (const key of keys) {
    const entry = wiki[key];
    if (!entry || !hasDisplayValue(entry)) continue;
    if (entry.source && !isVerifiedKoreanSource(entry.source)) continue;
    return {
      title: String(entry.title || '').trim(),
      overview: String(entry.overview || '').trim(),
      source: sourceMeta(entry.source || 'wiki')?.label || '한국어 위키백과',
      url: String(entry.url || '').trim(),
      kind: 'wiki'
    };
  }
  return null;
}

export async function loadKoreanTitlesDb(url = './data/korean-titles-db.json') {
  if (_dbLoaded) return _db;
  try {
    const response = await fetch(url);
    if (!response.ok) return null;
    const data = await response.json();
    setKoreanTitlesDb(data);
    return _db;
  } catch (error) {
    return null;
  }
}
