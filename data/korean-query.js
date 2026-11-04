// AI 한국어 검색 후보 생성 (v4.7+)
//
// 이 모듈의 결과는 "검색어"로만 사용합니다.
// 화면 제목/소개, 캐시의 출처, 메타데이터로 저장하지 않습니다.
// 실제 표시는 나무위키·한국어 위키백과·TMDB·AniList·MAL에서 확인된 자료만 사용합니다.

const HANGUL = /[가-힣]/;
const MAX_CANDIDATE_LENGTH = 80;
const DEFAULT_MAX_CANDIDATES = 4;
const DELIMITER = /\s*(?::|：|\s[-–—]\s|~|～)\s*/;
const SEASON_SUFFIX = /\s*(?:제\s*\d+\s*(?:기|쿨)|시즌\s*\d+|\d+\s*(?:기|쿨)|part\s*\d+|the\s+final\s+season)\s*$/i;
const BRACKETS = /\s*[\(（\[【][^\)）\]】]*[\)）\]】]\s*/g;

function stripDecorations(value) {
  return String(value || '')
    .replace(/^\s*(?:번역|한국어\s*제목|제목)\s*[:：]\s*/i, '')
    .replace(/[「」『』"'“”]/g, '')
    .replace(BRACKETS, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function baseTitle(value) {
  return String(value || '').split(DELIMITER)[0].trim();
}

function removeSeasonSuffix(value) {
  return String(value || '').replace(SEASON_SUFFIX, '').replace(/\s+/g, ' ').trim();
}

// AI가 만든 제목 하나에서 실제 검색에 쓸 수 있는 변형을 만듭니다.
// 예: "귀멸의 칼날: 무한열차편" → ["귀멸의 칼날: 무한열차편", "귀멸의 칼날"]
export function normalizeKoreanQueryCandidates(text, original = '') {
  const raw = stripDecorations(text);
  if (!raw) return [];
  const originalValue = String(original || '').trim();
  const variants = [raw, baseTitle(raw), removeSeasonSuffix(raw), removeSeasonSuffix(baseTitle(raw))];
  const candidates = [];
  for (const variant of variants) {
    if (!variant || variant.length < 2 || variant.length > MAX_CANDIDATE_LENGTH) continue;
    if (!HANGUL.test(variant)) continue;
    if (originalValue && variant === originalValue) continue;
    if (candidates.includes(variant)) continue;
    candidates.push(variant);
  }
  return candidates;
}

export async function generateKoreanQueryCandidates(nativeTitle, options = {}) {
  const original = String(nativeTitle || '').trim();
  if (original.length < 2) return [];
  if (typeof options.translate !== 'function') return [];
  const limit = Math.min(Math.max(Number(options.maxCandidates || DEFAULT_MAX_CANDIDATES) || DEFAULT_MAX_CANDIDATES, 1), 6);
  try {
    const result = await options.translate(original, 'ja', 'ko');
    const text = typeof result === 'string' ? result : result?.text;
    return normalizeKoreanQueryCandidates(text, original).slice(0, limit);
  } catch (error) {
    return [];
  }
}
