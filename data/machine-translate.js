// 자동 번역 (실험적, 비공식) — v4.9+
//
// Google Translate 무료 엔드포인트를 사용합니다.
// 공식 한국어 자료가 아님을 명시하고, 사용자가 설정에서 명시적으로 켠 경우에만 사용합니다.
// 정책: 작품명·줄거리는 원칙적으로 기계 번역하지 않지만, 사용자 선택에 따른 실험적 기능으로 제공합니다.

const CACHE_KEY = 'animehub_machine_translate_v1';
const ENABLED_KEY = 'animehub_machine_translate_enabled_v1';
const AUTO_SHOW_KEY = 'animehub_machine_translate_auto_show_v1';
const ENDPOINT = 'https://translate.googleapis.com/translate_a/single';

function readCache(storage = (typeof localStorage !== 'undefined' ? localStorage : null)) {
  if (!storage) return {};
  try {
    const raw = storage.getItem(CACHE_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch (error) {
    return {};
  }
}

function writeCache(cache, storage = (typeof localStorage !== 'undefined' ? localStorage : null)) {
  if (!storage) return false;
  try {
    const entries = Object.entries(cache).slice(-500);
    storage.setItem(CACHE_KEY, JSON.stringify(Object.fromEntries(entries)));
    return true;
  } catch (error) {
    return false;
  }
}

export function isMachineTranslationEnabled(storage = (typeof localStorage !== 'undefined' ? localStorage : null)) {
  if (!storage) return false;
  try {
    return storage.getItem(ENABLED_KEY) === '1';
  } catch (error) {
    return false;
  }
}

export function setMachineTranslationEnabled(enabled, storage = (typeof localStorage !== 'undefined' ? localStorage : null)) {
  if (!storage) return false;
  try {
    if (enabled) storage.setItem(ENABLED_KEY, '1');
    else storage.removeItem(ENABLED_KEY);
    return true;
  } catch (error) {
    return false;
  }
}

export function isMachineTranslationAutoShowEnabled(storage = (typeof localStorage !== 'undefined' ? localStorage : null)) {
  if (!storage) return false;
  try {
    return isMachineTranslationEnabled(storage) && storage.getItem(AUTO_SHOW_KEY) === '1';
  } catch (error) {
    return false;
  }
}

export function setMachineTranslationAutoShowEnabled(enabled, storage = (typeof localStorage !== 'undefined' ? localStorage : null)) {
  if (!storage) return false;
  try {
    if (enabled) storage.setItem(AUTO_SHOW_KEY, '1');
    else storage.removeItem(AUTO_SHOW_KEY);
    return true;
  } catch (error) {
    return false;
  }
}

function cacheKey(text, from, to) {
  return `${from}|${to}|${text}`;
}

export function getCachedMachineTranslation(text, from = 'ja', to = 'ko', storage = (typeof localStorage !== 'undefined' ? localStorage : null)) {
  if (!isMachineTranslationEnabled(storage)) return null;
  const value = String(text || '').trim();
  if (!value) return null;
  const cache = readCache(storage);
  const key = cacheKey(value, from, to);
  return cache[key] || null;
}
export async function machineTranslate(text, from = 'ja', to = 'ko', storage = (typeof localStorage !== 'undefined' ? localStorage : null)) {
  const value = String(text || '').trim();
  if (!value || value.length < 2) return null;
  if (value.length > 5000) return null; // 너무 긴 텍스트는 번역하지 않음

  const cache = readCache(storage);
  const key = cacheKey(value, from, to);
  if (cache[key]) return cache[key];

  try {
    const url = `${ENDPOINT}?client=gtx&sl=${from}&tl=${to}&dt=t&q=${encodeURIComponent(value)}`;
    const response = await fetch(url);
    if (!response.ok) return null;
    const data = await response.json();
    // data[0] is array of [translated, original, ...]
    const translated = (data?.[0] || []).map((row) => row?.[0] || '').join('').trim();
    if (!translated || translated === value) return null;
    // 한글이 포함되어야 유효한 번역으로 간주
    if (!/[가-힣]/.test(translated)) return null;
    // 검증: 길이 비율
    const ratio = translated.length / value.length;
    if (ratio < 0.2 || ratio > 4.0) return null;

    const result = { text: translated, from, to, source: '자동 번역 (Google, 비공식)' };
    cache[key] = result;
    writeCache(cache, storage);
    return result;
  } catch (error) {
    return null;
  }
}

export async function machineTranslateTitle(media, storage) {
  if (!isMachineTranslationEnabled(storage)) return null;
  const candidates = [media?.title?.native, media?.title?.romaji, media?.title?.english].filter(Boolean);
  for (const candidate of candidates) {
    const result = await machineTranslate(candidate, 'ja', 'ko', storage);
    if (result?.text) return { title: result.text, source: result.source, url: '', kind: 'machine' };
  }
  return null;
}

export async function machineTranslateOverview(media, storage) {
  if (!isMachineTranslationEnabled(storage)) return null;
  const desc = String(media?.description || '').trim();
  if (!desc || desc.length < 20) return null;
  const result = await machineTranslate(desc.slice(0, 1000), 'ja', 'ko', storage);
  if (!result?.text) return null;
  return { overview: result.text, source: result.source, url: '', kind: 'machine' };
}
