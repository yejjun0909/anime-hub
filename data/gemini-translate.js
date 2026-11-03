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
    const isTitle = value.length < 80;
    const prompt = isTitle
      ? `다음은 일본 애니메이션의 제목입니다. 한국에서 통용되는 한국어 제목으로 번역하세요.

규칙:
- 고유명사(인명, 지명)는 한국에서 일반적으로 사용하는 표기를 사용하세요
- 이미 한국에서 널리 알려진 제목은 그대로 사용하세요
- 세미콜론, 특수문자는 자연스럽게 처리하세요
- 번역 결과만 출력하세요 (설명, 주석 없이)

예시:
鬼滅の刃 → 귀멸의 칼날
進撃の巨人 → 진격의 거인
Steins;Gate → 슈타인즈 게이트
Re:Zero → Re:제로부터 시작하는 이세계 생활
僕のヒーローアカデミア → 나의 히어로 아카데미아

번역할 제목: ${value}`
      : `다음 일본어 텍스트를 자연스러운 한국어로 번역하세요. 애니메이션 소개일 수 있습니다. 번역 결과만 출력하세요:\n\n${value}`;

    const response = await fetch(`${ENDPOINT}?key=${encodeURIComponent(key)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0, maxOutputTokens: 1024 }
      })
    });

    if (!response.ok) return null;
    const data = await response.json();
    const translated = (data?.candidates?.[0]?.content?.parts?.[0]?.text || '').trim();
    if (!translated || translated === value) return null;
    if (!/[가-힣]/.test(translated)) return null;
    // 검증: 길이 비율 확인 (원문 대비 0.3~3.0배)
    const ratio = translated.length / value.length;
    if (ratio < 0.2 || ratio > 4.0) return null;
    // 검증: 고유명사 보존 (영어/숫자가 원문에 있으면 번역에도 있어야)
    const origAlphanum = (value.match(/[A-Za-z0-9]/g) || []).length;
    const transAlphanum = (translated.match(/[A-Za-z0-9]/g) || []).length;
    if (origAlphanum > 3 && transAlphanum < origAlphanum * 0.3) return null;

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
