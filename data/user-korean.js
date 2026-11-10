// 사용자 직접 입력 한국어 자료 (v4.9+)
//
// 국내 플랫폼 카탈로그에 없는 작품에 사용자가 직접 한국어 제목·소개를 입력할 수 있습니다.
// 공식 자료가 아니므로 source는 "사용자 입력"으로 표시됩니다.

const KEY = 'animehub_user_korean_v1';

function readStore(storage = (typeof localStorage !== 'undefined' ? localStorage : null)) {
  if (!storage) return {};
  try {
    const raw = storage.getItem(KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch (error) {
    return {};
  }
}

function writeStore(store, storage = (typeof localStorage !== 'undefined' ? localStorage : null)) {
  if (!storage) return false;
  try {
    storage.setItem(KEY, JSON.stringify(store));
    return true;
  } catch (error) {
    return false;
  }
}

function keyOf(media) {
  if (!media) return null;
  if (media.id != null) return `a:${media.id}`;
  if (media.idMal != null) return `m:${media.idMal}`;
  return null;
}

export function getUserKorean(media, storage) {
  const key = keyOf(media);
  if (!key) return null;
  const store = readStore(storage);
  const entry = store[key];
  if (!entry) return null;
  return {
    title: entry.title || '',
    overview: entry.overview || '',
    source: '사용자 입력',
    url: entry.url || '',
    anilistId: entry.anilistId ?? null,
    malId: entry.malId ?? null,
    searchTerm: entry.searchTerm || '',
    kind: 'user',
    checkedAt: entry.savedAt || ''
  };
}

export function setUserKorean(media, value, storage) {
  const key = keyOf(media);
  if (!key) return false;
  const store = readStore(storage);
  store[key] = {
    title: (value?.title || '').trim(),
    overview: (value?.overview || '').trim(),
    url: (value?.url || '').trim(),
    anilistId: Number.isInteger(Number(value?.anilistId)) ? Number(value.anilistId) : null,
    malId: Number.isInteger(Number(value?.malId)) ? Number(value.malId) : null,
    searchTerm: (value?.searchTerm || '').trim().slice(0, 300),
    savedAt: new Date().toISOString()
  };
  return writeStore(store, storage);
}

export function deleteUserKorean(media, storage) {
  const key = keyOf(media);
  if (!key) return false;
  const store = readStore(storage);
  if (!(key in store)) return false;
  delete store[key];
  return writeStore(store, storage);
}

export function allUserKorean(storage) {
  return readStore(storage);
}

export function mergeUserKorean(entries, storage) {
  if (!entries || typeof entries !== 'object') return 0;
  const store = readStore(storage);
  let merged = 0;
  for (const [key, value] of Object.entries(entries)) {
    if (!/^[am]:/.test(String(key)) || !value || typeof value !== 'object') continue;
    const title = String(value.title || '').trim().slice(0, 160);
    const overview = String(value.overview || '').trim().slice(0, 6000);
    const url = String(value.url || '').trim().slice(0, 600);
    if (!title && !overview) continue;
    store[key] = {
      title,
      overview,
      url,
      anilistId: Number.isInteger(Number(value.anilistId)) ? Number(value.anilistId) : null,
      malId: Number.isInteger(Number(value.malId)) ? Number(value.malId) : null,
      searchTerm: String(value.searchTerm || '').trim().slice(0, 300),
      savedAt: value.savedAt || new Date().toISOString()
    };
    merged += 1;
  }
  return writeStore(store, storage) ? merged : 0;
}
