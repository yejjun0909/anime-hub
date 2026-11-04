// 한국어 위키백과 조회 모듈 (v4.9+)
//
// 나무위키 API가 브라우저에서 접근 불가(CORS/DNS)일 때 사용할 수 있는 실제 한국어 소스입니다.
// 위키백과 Action API는 `origin=*`을 지원하므로 브라우저에서 직접 조회할 수 있습니다.
// 애니메이션·만화 문서로 확인된 경우에만 제목/소개를 반환합니다. (best-effort)

const API = 'https://ko.wikipedia.org/w/api.php';
const SUMMARY_LIMIT = 600;
const ANIME_HINTS = ['애니메이션', '만화', '극장판', 'OVA', '라이트 노벨', '일본의'];

function decodeEntities(value) {
  return String(value || '')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&#x27;/gi, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ');
}

function stripHtml(value) {
  return decodeEntities(String(value || '').replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]*>/g, '')).replace(/\s+/g, ' ').trim();
}

async function fetchJson(params) {
  const url = `${API}?${params.toString()}`;
  const response = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!response.ok) return null;
  const text = await response.text();
  try { return JSON.parse(text); } catch (error) { return null; }
}

function isAnimeArticle(text) {
  const value = String(text || '');
  return ANIME_HINTS.some((hint) => value.includes(hint));
}

function isDisambiguation(title, extract) {
  if (/동음이의|가리킨다|목록 문서/.test(String(title || ''))) return true;
  return /다음을 가리킨다|가리키는 문서|동음이의/.test(String(extract || ''));
}

function trimSummary(text) {
  const value = String(text || '').replace(/\s+/g, ' ').trim();
  if (value.length <= SUMMARY_LIMIT) return value;
  const cut = value.slice(0, SUMMARY_LIMIT);
  const lastStop = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('다. '), cut.lastIndexOf('。'));
  return `${(lastStop > 120 ? cut.slice(0, lastStop + 1) : cut).trim()}…`;
}

export async function searchKoreanWikipedia(query, options = {}) {
  const value = String(query || '').trim();
  if (!value || value.length < 2) return [];
  const limit = Math.min(Math.max(Number(options?.limit || 5) || 5, 1), 10);
  const params = new URLSearchParams({
    action: 'query',
    list: 'search',
    srsearch: value,
    srlimit: String(limit),
    srnamespace: '0',
    format: 'json',
    formatversion: '2',
    origin: '*'
  });
  try {
    const data = await fetchJson(params);
    const list = data?.query?.search;
    if (!Array.isArray(list)) return [];
    return list
      .map((row) => ({
        title: String(row?.title || ''),
        pageid: row?.pageid,
        snippet: stripHtml(row?.snippet || '')
      }))
      .filter((row) => row.title);
  } catch (error) {
    return [];
  }
}

async function fetchKoreanWikipediaSummary(title) {
  const value = String(title || '').trim();
  if (!value) return null;
  const params = new URLSearchParams({
    action: 'query',
    prop: 'extracts',
    exintro: '1',
    explaintext: '1',
    redirects: '1',
    titles: value,
    format: 'json',
    formatversion: '2',
    origin: '*'
  });
  try {
    const data = await fetchJson(params);
    const page = data?.query?.pages?.[0];
    const resolvedTitle = String(page?.title || value);
    const overview = trimSummary(page?.extract || '');
    if (!overview) return null;
    return { title: resolvedTitle, overview };
  } catch (error) {
    return null;
  }
}

export async function lookupKoreanWikipedia(query, options = {}) {
  const value = String(query || '').trim();
  if (!value || value.length < 2) return null;
  const candidates = await searchKoreanWikipedia(value, { limit: options?.limit || 3 });
  const maxChecks = Math.min(candidates.length, Math.max(Number(options?.maxChecks || 2) || 2, 1));
  for (let index = 0; index < maxChecks; index += 1) {
    const candidate = candidates[index];
    const summary = await fetchKoreanWikipediaSummary(candidate.title);
    if (!summary?.overview) continue;
    if (isDisambiguation(summary.title, summary.overview)) continue;
    if (!isAnimeArticle(summary.overview) && !isAnimeArticle(candidate.snippet)) continue;
    return {
      title: summary.title,
      overview: summary.overview,
      url: `https://ko.wikipedia.org/wiki/${encodeURIComponent(summary.title.replace(/ /g, '_'))}`,
      source: '한국어 위키백과',
      kind: 'wiki'
    };
  }
  return null;
}
