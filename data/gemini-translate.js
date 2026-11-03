// Google Gemini 무료 API 번역 (실험적, 비공식) — v4.9+
//
// Google AI Studio (aistudio.google.com)에서 무료 API 키 발급.
// 무료 tier: 15 req/min, 1M tokens/day.
// 모델: gemini-1.5-flash (빠르고 무료, 한국어 품질 우수)
//
// Google Translate보다 자연스러운 한국어 번역을 제공합니다.
// API 키가 없으면 Google Translate로 폴백합니다.

const CACHE_KEY = 'animehub_gemini_translate_v1';
const ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent';

function readCache(storage) {
  if (!storage) return {};
  try {
    const raw = storage.getItem(CACHE_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch (error) {
    return {};
  }
}

function writeCache(cache, storage) {
  if (!storage) return false;
  try {
    const entries = Object.entries(cache).slice(-500);
    storage.setItem(CACHE_KEY, JSON.stringify(Object.fromEntries(entries)));
    return true;
  } catch (error) {
    return false;
  }
}

export function getGeminiKey(storage = (typeof localStorage !== 'undefined' ? localStorage : null)) {
  if (!storage) return '';
  try { return String(storage.getItem('animehub_gemini_key_v1') || '').trim(); }
  catch (error) { return ''; }
}

export function setGeminiKey(key, storage = (typeof localStorage !== 'undefined' ? localStorage : null)) {
  if (!storage) return false;
  try {
    if (key) storage.setItem('animehub_gemini_key_v1', key.trim());
    else storage.removeItem('animehub_gemini_key_v1');
    return true;
  } catch (error) {
    return false;
  }
}

export function hasGeminiKey(storage) {
  return !!getGeminiKey(storage);
}

function cacheKey(text, from, to) {
  return `${from}|${to}|${text}`;
}

export async function geminiTranslate(text, from = 'ja', to = 'ko', storage = (typeof localStorage !== 'undefined' ? localStorage : null)) {
  const value = String(text || '').trim();
  if (!value || value.length < 2) return null;
  if (value.length > 2000) return null;

  const key = getGeminiKey(storage);
  if (!key) return null;

  const cache = readCache(storage);
  const ck = cacheKey(value, from, to);
  if (cache[ck]) return cache[ck];

  try {
    const prompt = `다음 ${from === 'ja' ? '일본어' : from} 텍스트를 자연스러운 한국어로 번역하세요. 애니메이션 제목/소개일 수 있습니다. 번역 결과만 출력하세요 (설명 없이):\n\n${value}`;

    const response = await fetch(`${ENDPOINT}?key=${encodeURIComponent(key)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.3, maxOutputTokens: 1024 }
      })
    });

    if (!response.ok) return null;
    const data = await response.json();
    const translated = (data?.candidates?.[0]?.content?.parts?.[0]?.text || '').trim();
    if (!translated || translated === value) return null;
    if (!/[가-힣]/.test(translated)) return null;

    const result = { text: translated, from, to, source: 'Gemini AI 번역 (비공식, 실험적)' };
    cache[ck] = result;
    writeCache(cache, storage);
    return result;
  } catch (error) {
    return null;
  }
}

export async function geminiTranslateTitle(media, storage) {
  if (!hasGeminiKey(storage)) return null;
  const candidates = [media?.title?.native, media?.title?.romaji].filter(Boolean);
  for (const candidate of candidates) {
    const result = await geminiTranslate(candidate, 'ja', 'ko', storage);
    if (result?.text) return { title: result.text, source: result.source, url: '', kind: 'gemini' };
  }
  return null;
}

export async function geminiTranslateOverview(media, storage) {
  if (!hasGeminiKey(storage)) return null;
  const desc = String(media?.description || '').trim();
  if (!desc || desc.length < 20) return null;
  const result = await geminiTranslate(desc.slice(0, 1000), 'ja', 'ko', storage);
  if (!result?.text) return null;
  return { overview: result.text, source: result.source, url: '', kind: 'gemini' };
}

export function getCachedGeminiTranslation(text, from = 'ja', to = 'ko', storage = (typeof localStorage !== 'undefined' ? localStorage : null)) {
  if (!hasGeminiKey(storage)) return null;
  const value = String(text || '').trim();
  if (!value) return null;
  const cache = readCache(storage);
  const ck = cacheKey(value, from, to);
  return cache[ck] || null;
}
