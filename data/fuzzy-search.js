// 퍼지 검색 (v4.9+)
//
// Levenshtein distance 기반 유사도 매칭.
// 정확한 매칭이 실패해도 비슷한 이름의 결과를 반환합니다.

export function levenshtein(a, b) {
  a = String(a || '');
  b = String(b || '');
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;

  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let curr = [i];
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
    }
    prev = curr;
  }
  return prev[b.length];
}

export function similarity(a, b) {
  a = String(a || '');
  b = String(b || '');
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return 1;
  return 1 - levenshtein(a, b) / maxLen;
}

export function normalizeForSearch(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFKC')
    .replace(/[\s\p{P}\p{S}]+/gu, '')
    .replace(/시즌\d+|season\d+/g, '');
}

export function fuzzyMatch(query, target, threshold = 0.6) {
  const q = normalizeForSearch(query);
  const t = normalizeForSearch(target);
  if (!q || !t) return false;
  if (t.includes(q)) return true;
  if (q.includes(t)) return true;
  return similarity(q, t) >= threshold;
}

export function fuzzyFilter(items, query, threshold = 0.6) {
  if (!query || !items?.length) return items || [];
  return items.filter((item) => {
    const title = item?.title?.userPreferred || item?.title?.english || item?.title?.romaji || item?.title?.native || '';
    const synonyms = item?.synonyms || [];
    if (fuzzyMatch(query, title, threshold)) return true;
    return synonyms.some((s) => fuzzyMatch(query, s, threshold));
  });
}

export function searchVariants(query) {
  const q = String(query || '').trim();
  if (!q) return [];
  const variants = new Set([q]);
  // 띄어쓰기 제거
  variants.add(q.replace(/\s+/g, ''));
  // 영어/일본어 혼용
  // (추가 변형은 호출자가 처리)
  return [...variants];
}
