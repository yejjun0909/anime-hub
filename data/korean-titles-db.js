// 사전 계산 한국어 제목 DB (v4.9+)
//
// tools/harvest_korean_titles.py로 생성된 DB를 로드합니다.
// AniList synonyms + TMDB + Gemini/Google Translate로 수확된 한국어 제목을 제공합니다.

// DB는 빌드 시 인라인되거나, 런타임에 fetch됩니다.
// 단일 파일 모드에서는 인라인, 다중 파일 모드에서는 fetch.

let _db = null;
let _dbLoaded = false;

export function setKoreanTitlesDb(db) {
  _db = db;
  _dbLoaded = true;
}

export function getKoreanTitlesDb() {
  return _db;
}

export function isDbLoaded() {
  return _dbLoaded;
}

export function lookupKoreanTitle(media) {
  if (!_db?.entries) return null;
  const id = media?.id != null ? String(media.id) : null;
  if (!id) return null;
  const entry = _db.entries[id];
  if (!entry || !entry.title) return null;
  return {
    title: entry.title,
    overview: entry.overview || '',
    source: entry.source === 'anilist' ? 'AniList 한글 별칭' :
            entry.source === 'tmdb' ? 'TMDB 한국어 등록 번역' :
            entry.source === 'gemini' ? 'Gemini AI 번역 (비공식, 실험적)' :
            entry.source === 'google' ? '자동 번역 (Google, 비공식)' :
            '사전 계산 DB',
    url: '',
    kind: entry.source === 'anilist' ? 'anilist' :
          entry.source === 'tmdb' ? 'tmdb' :
          entry.source === 'gemini' ? 'gemini' :
          entry.source === 'google' ? 'machine' : 'db'
  };
}

export async function loadKoreanTitlesDb(url = './data/korean-titles-db.json') {
  if (_dbLoaded) return _db;
  try {
    const response = await fetch(url);
    if (!response.ok) return null;
    const data = await response.json();
    _db = data;
    _dbLoaded = true;
    return data;
  } catch (error) {
    return null;
  }
}
