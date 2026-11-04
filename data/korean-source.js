// 한국어 소스 통합 조회 (v4.7+)
//
// 표시 우선순위:
//   1) 나무위키 (best-effort, 직접 검색)
//   2) AI가 만든 한국어 "검색 후보"로 나무위키 재검색
//   3) 한국어 위키백과 (CORS 허용, 실제 문서 확인)
//   4) 원제 유지 (호출부에서 처리)
//
// AI 결과 자체는 절대 반환하지 않습니다. AI는 2단계의 검색어로만 사용합니다.

import { searchNamuWiki, isNamuWikiCoolingDown } from './namu-search.js';
import { lookupKoreanWikipedia } from './korean-wiki.js';
import { generateKoreanQueryCandidates } from './korean-query.js';
import { geminiTranslate } from './gemini-translate.js';

export const KOREAN_SOURCE_ORDER = Object.freeze(['namu', 'wiki', 'original']);
const AI_QUERY_LIMIT = 3;

async function safeCall(fn, logger) {
  try {
    return await fn();
  } catch (error) {
    if (logger && typeof logger.warn === 'function') {
      logger.warn('Korean source lookup skipped:', error?.message || error);
    }
    return null;
  }
}

export async function lookupKoreanSource(nativeTitle, options = {}) {
  const value = String(nativeTitle || '').trim();
  if (value.length < 2) return null;

  const logger = options.logger === undefined ? console : options.logger;
  const searchNamu = options.searchNamu || searchNamuWiki;
  const lookupWiki = options.lookupWiki || lookupKoreanWikipedia;
  const coolingDown = options.isNamuCoolingDown || isNamuWikiCoolingDown;
  const translate = options.translate === undefined ? geminiTranslate : options.translate;
  const allowAiQuery = options.allowAiQuery !== false;
  const generateCandidates = options.generateCandidates
    || ((title) => generateKoreanQueryCandidates(title, { translate }));

  const findNamu = async (query) => {
    if (coolingDown()) return null;
    const results = await safeCall(() => searchNamu(query), logger);
    return Array.isArray(results) && results.length ? results[0] : null;
  };

  // 1) 원제/원어 제목으로 나무위키 검색
  let namu = await findNamu(value);

  // 2) AI는 나무위키 검색 후보로만 사용
  if (!namu && allowAiQuery && typeof translate === 'function') {
    const candidates = await safeCall(() => generateCandidates(value), logger);
    for (const candidate of (Array.isArray(candidates) ? candidates : []).slice(0, AI_QUERY_LIMIT)) {
      if (candidate === value) continue;
      namu = await findNamu(candidate);
      if (namu) break;
    }
  }

  if (namu?.title) {
    return {
      ...namu,
      source: namu.source || '나무위키',
      kind: 'namu'
    };
  }

  // 3) 실제 한국어 문서가 확인되는 위키백과로 폴백
  const wiki = await safeCall(() => lookupWiki(value), logger);
  if (wiki?.title || wiki?.overview) {
    return { ...wiki, kind: 'wiki' };
  }

  return null;
}

// 의존성을 고정해 테스트/앱에서 재사용할 수 있는 리졸버를 만듭니다.
export function createKoreanSourceResolver(dependencies = {}) {
  return (nativeTitle, options = {}) => lookupKoreanSource(nativeTitle, { ...dependencies, ...options });
}
