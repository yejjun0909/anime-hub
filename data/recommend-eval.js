// 추천 평가 지표 (v4.9)
//
// 오프라인 평가와 런타임 모니터링에 쓰는 지표입니다.
//   - precision@k: 추천 상위 k개 중 실제 선호(positive) 비율
//   - recall@k: 실제 선호 중 추천 상위 k개에 포함된 비율
//   - ndcg@k: 순위 가중 적합도
//   - coverage: 카탈로그 대비 추천된 고유 작품 비율
//   - diversity: 추천 목록 내 장르 다양성 (1 - 평균 Jaccard)
//   - novelty: 인기도 역수 평균 (덜 알려진 작품 추천 정도)

function asSet(value) {
  return value instanceof Set ? value : new Set(value || []);
}

export function precisionAtK(recommended, relevant, k = 10) {
  const top = (recommended || []).slice(0, k);
  if (!top.length) return 0;
  const rel = asSet(relevant);
  const hits = top.filter((id) => rel.has(id)).length;
  return hits / top.length;
}

export function recallAtK(recommended, relevant, k = 10) {
  const rel = asSet(relevant);
  if (!rel.size) return 0;
  const top = new Set((recommended || []).slice(0, k));
  const hits = [...rel].filter((id) => top.has(id)).length;
  return hits / rel.size;
}

export function dcgAtK(recommended, relevant, k = 10) {
  const rel = asSet(relevant);
  let dcg = 0;
  (recommended || []).slice(0, k).forEach((id, index) => {
    if (rel.has(id)) dcg += 1 / Math.log2(index + 2);
  });
  return dcg;
}

export function ndcgAtK(recommended, relevant, k = 10) {
  const rel = asSet(relevant);
  const ideal = [...rel].slice(0, k);
  const idcg = ideal.reduce((sum, _, index) => sum + 1 / Math.log2(index + 2), 0);
  if (idcg === 0) return 0;
  return dcgAtK(recommended, relevant, k) / idcg;
}

export function coverage(recommendedLists, catalogSize) {
  if (!catalogSize) return 0;
  const seen = new Set((recommendedLists || []).flat());
  return seen.size / catalogSize;
}

export function intraListDiversity(items, k = 10) {
  const top = (items || []).slice(0, k);
  if (top.length < 2) return 0;
  let total = 0;
  let pairs = 0;
  for (let i = 0; i < top.length; i++) {
    for (let j = i + 1; j < top.length; j++) {
      const a = new Set(top[i]?.genres || top[i]?.item?.genres || []);
      const b = new Set(top[j]?.genres || top[j]?.item?.genres || []);
      const inter = [...a].filter((g) => b.has(g)).length;
      const union = new Set([...a, ...b]).size || 1;
      total += 1 - inter / union;
      pairs += 1;
    }
  }
  return pairs ? total / pairs : 0;
}

export function novelty(items, popularityLookup, k = 10) {
  const top = (items || []).slice(0, k);
  if (!top.length) return 0;
  const values = top.map((item) => {
    const id = item?.id ?? item?.item?.id;
    const pop = (popularityLookup && popularityLookup.get ? popularityLookup.get(id) : null) ?? item?.popularity ?? item?.item?.popularity ?? 0;
    return 1 - Math.min(1, Math.log1p(Math.max(0, pop)) / Math.log1p(100000));
  });
  return values.reduce((a, b) => a + b, 0) / values.length;
}

export function evaluateRecommendation({ recommended, relevant, catalogSize, items, popularityLookup, k = 10 }) {
  return {
    k,
    precision: precisionAtK(recommended, relevant, k),
    recall: recallAtK(recommended, relevant, k),
    ndcg: ndcgAtK(recommended, relevant, k),
    coverage: coverage([recommended], catalogSize),
    diversity: intraListDiversity(items, k),
    novelty: novelty(items, popularityLookup, k),
    avgScore: items?.length ? items.reduce((s, r) => s + (r.score || 0), 0) / items.length : 0
  };
}

export function coldStartStrategy(profile) {
  // 프로필이 비어 있을 때 사용할 전략 키를 반환합니다.
  if (!profile || !profile.hasTaste) return 'popular-quality';
  const genreCount = profile.genre?.size || 0;
  if (genreCount < 3) return 'explore-genres';
  return 'personalized';
}
