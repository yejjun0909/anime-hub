// 방영 일정 로컬 캐시 (v4.7)
//
// 네트워크 실패 시 빈 화면 대신 마지막으로 성공한 일정을 보여줍니다.
// TTL 6시간; 만료되어도 캐시는 "stale"로 표시해 사용할 수 있습니다.

const KEY = 'animehub_airing_cache_v1';
const TTL_MS = 6 * 60 * 60 * 1000;
const MAX_ITEMS = 500;

export function readAiringCache(storage = (typeof localStorage !== 'undefined' ? localStorage : null)) {
  if (!storage) return null;
  try {
    const raw = storage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || !Array.isArray(parsed.items)) return null;
    return {
      items: parsed.items,
      source: parsed.source || '캐시',
      savedAt: Number(parsed.savedAt) || 0
    };
  } catch (error) {
    return null;
  }
}

export function writeAiringCache(items, source, storage = (typeof localStorage !== 'undefined' ? localStorage : null), now = Date.now()) {
  if (!storage) return false;
  try {
    const payload = {
      version: 1,
      savedAt: now,
      source: source || 'AniList 방영 일정',
      items: (items || []).slice(0, MAX_ITEMS)
    };
    storage.setItem(KEY, JSON.stringify(payload));
    return true;
  } catch (error) {
    return false;
  }
}

export function isFreshAiringCache(cache, now = Date.now(), ttl = TTL_MS) {
  return !!cache && cache.savedAt > 0 && (now - cache.savedAt) < ttl;
}

export function clearAiringCache(storage = (typeof localStorage !== 'undefined' ? localStorage : null)) {
  if (!storage) return;
  try { storage.removeItem(KEY); } catch (error) { /* ignore */ }
}
