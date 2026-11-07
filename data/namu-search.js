// 나무위키 조회 모듈 (v4.9+) — 실제 한국어 소스 우선, 미등록 시 폴백
//
// 참고: 나무위키는 MediaWiki가 아닌 자체 엔진(the seed)을 사용하고, 공개 읽기 API가
// 제한적입니다. 현재는 best-effort 방식으로 조회를 시도하고 실패 시 빈 배열을 반환합니다.
// AI 번역(Google/Gemini) 대신 실제 한국어 소스(나무위키)를 우선 사용하기 위한 모듈입니다.

const ENDPOINTS = [
  'https://wiki-api.namu.la/api',
  'https://namu.wiki/api',
];

// 나무위키 API는 현재 브라우저에서 CORS/DNS 문제로 실패하는 경우가 많습니다.
// 실패가 확인되면 일정 시간 동안 재시도하지 않아 콘솔 오류와 지연을 줄입니다.
const RETRY_COOLDOWN_MS = 10 * 60 * 1000;
let lastFailureAt = 0;
let lastSuccessAt = 0;

export function isNamuWikiCoolingDown(now = Date.now(), cooldownMs = RETRY_COOLDOWN_MS) {
  return lastFailureAt > lastSuccessAt && now - lastFailureAt < cooldownMs;
}

export function getNamuWikiHealth() {
  return {
    lastFailureAt,
    lastSuccessAt,
    coolingDown: isNamuWikiCoolingDown()
  };
}

export function resetNamuWikiHealth() {
  lastFailureAt = 0;
  lastSuccessAt = 0;
}

const PROXY_KEY = 'animehub_namu_proxy_v1';

export function getNamuProxyUrl() {
  try { return String(localStorage.getItem(PROXY_KEY) || '').trim(); } catch (error) { return ''; }
}

export function setNamuProxyUrl(url) {
  try {
    const value = String(url || '').trim();
    if (value) localStorage.setItem(PROXY_KEY, value);
    else localStorage.removeItem(PROXY_KEY);
    resetNamuWikiHealth();
    return value;
  } catch (error) { return ''; }
}

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
  if (isNamuWikiCoolingDown()) return [];
  const maxResults = Number(options?.maxResults || 5) || 5;
  const proxy = getNamuProxyUrl();
  const results = [];
  const seen = new Set();

  // 프록시가 설정되면 프록시를 우선 사용합니다.
  if (proxy) {
    try {
      const url = `${proxy}?q=${encodeURIComponent(value)}`;
      const data = await fetchJson(url);
      const list = Array.isArray(data?.results) ? data.results : [];
      for (const item of list) {
        const title = String(item?.title || '').trim();
        if (!title) continue;
        const key = `${item?.originTitle || ''}|${title}`;
        if (seen.has(key)) continue;
        seen.add(key);
        results.push({ title, originTitle: item?.originTitle || '', overview: String(item?.snippet || item?.overview || ''), source: '나무위키', url: options?.baseUrl || `https://namu.wiki/wiki/${encodeURIComponent(title)}` });
        if (results.length >= maxResults) break;
      }
      if (results.length) { lastSuccessAt = Date.now(); return results; }
    } catch (error) { /* fall through to direct endpoints */ }
  }

  let attempts = 0;
  let failures = 0;
  for (const base of ENDPOINTS) {
    if (results.length >= maxResults) break;
    attempts += 1;
    const url = `${base}?action=query&list=search&srsearch=${encodeURIComponent(value)}&srlimit=5&format=json`;
    try {
      const data = await fetchJson(url);
      if (!data) {
        failures += 1;
        continue;
      }
      lastSuccessAt = Date.now();
      const found = extractResults(data);
      for (const item of found) {
        const key = `${item.originTitle || ''}|${item.title}`;
        if (seen.has(key)) continue;
        seen.add(key);
        results.push({ ...item, source: '나무위키', url: options?.baseUrl || `https://namu.wiki/wiki/${encodeURIComponent(item.title)}` });
        if (results.length >= maxResults) break;
      }
    } catch (error) {
      failures += 1;
      /* best-effort */
    }
  }
  // 모든 엔드포인트가 실패하면 일정 시간 재시도를 멈춥니다.
  if (attempts > 0 && failures === attempts) lastFailureAt = Date.now();
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
