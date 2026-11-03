// 나무위키 조회 모듈 (v4.9+) — 실제 한국어 소스 우선, 미등록 시 폴백
//
// 참고: 나무위키는 MediaWiki가 아닌 자체 엔진(the seed)을 사용하고, 공개 읽기 API가
// 제한적입니다. 현재는 best-effort 방식으로 조회를 시도하고 실패 시 빈 배열을 반환합니다.
// AI 번역(Google/Gemini) 대신 실제 한국어 소스(나무위키)를 우선 사용하기 위한 모듈입니다.

const ENDPOINTS = [
  'https://wiki-api.namu.la/api',
  'https://namu.wiki/api',
];

async function fetchJson(url) {
  const response = await fetch(url, { headers: { Accept: 'application/json, text/plain, */*' } });
  if (!response.ok) return null;
  const text = await response.text();
  try { return JSON.parse(text); } catch (error) { return null; }
}

function extractResults(data) {
  if (!data || typeof data !== 'object') return [];
  const direct = data?.query?.search?.results;
  const nested = data?.data?.query?.search?.results;
  const flat = data?.results;
  const list = Array.isArray(direct) ? direct : Array.isArray(nested) ? nested : Array.isArray(flat) ? flat : [];
  const found = [];
  for (const row of list) {
    const title = row?.title || row?.name || row?.fullTitle || '';
    if (!title || typeof title !== 'string') continue;
    found.push({
      title,
      originTitle: row?.originTitle || row?.originalTitle || '',
      overview: String(row?.snippet || row?.description || ''),
    });
  }
  return found;
}

export async function searchNamuWiki(query, options = {}) {
  const value = String(query || '').trim();
  if (!value || value.length < 2) return [];
  const maxResults = Number(options?.maxResults || 5) || 5;
  const results = [];
  const seen = new Set();
  for (const base of ENDPOINTS) {
    if (results.length >= maxResults) break;
    const url = `${base}?action=query&list=search&srsearch=${encodeURIComponent(value)}&srlimit=5&format=json`;
    try {
      const data = await fetchJson(url);
      const found = extractResults(data);
      for (const item of found) {
        const key = `${item.originTitle || ''}|${item.title}`;
        if (seen.has(key)) continue;
        seen.add(key);
        results.push({ ...item, source: '나무위키', url: options?.baseUrl || `https://namu.wiki/wiki/${encodeURIComponent(item.title)}` });
        if (results.length >= maxResults) break;
      }
    } catch (error) { /* best-effort */ }
  }
  return results;
}

export async function lookupNamuTitle(media, options = {}) {
  const candidates = [media?.title?.native, media?.title?.romaji, media?.title?.english].filter(Boolean);
  for (const candidate of candidates) {
    const found = await searchNamuWiki(candidate, options);
    if (found.length) return found[0];
  }
  return null;
}
