// 추천 점수 계산 (v4.9)
//
// app.js의 scoreRecommendations에서 수치 계산만 분리했습니다.
// UI용 이유 문구는 호출자가 반환된 필드로 조립합니다.

export function computeCandidateScore(item, profile, options = {}) {
  const genres = item?.genres || [];
  const maxFormat = Math.max(1, ...(profile?.format?.values?.() || [1]));
  const maxStudio = Math.max(1, ...(profile?.studio?.values?.() || [1]));
  const maxPopularity = Math.max(1, options.maxPopularity || 1);

  const positive = genres.reduce((sum, g) => sum + (profile?.genre?.get?.(g) || 0), 0);
  const negative = genres.reduce((sum, g) => sum + (profile?.disliked?.get?.(g) || 0), 0);

  const genreFit = profile?.positiveGenreTotal
    ? Math.min(1, positive / (profile.positiveGenreTotal * 0.42))
    : 0;
  const negativePenalty = profile?.dislikedGenreTotal
    ? Math.min(1, negative / (profile.dislikedGenreTotal * 0.48))
    : 0;

  const formatWeight = profile?.format?.get?.(item?.format) || 0;
  const formatFit = formatWeight ? Math.min(1, formatWeight / maxFormat) : 0;

  const studioMatch = (item?.studios?.nodes || []).reduce(
    (best, st) => Math.max(best, profile?.studio?.get?.(st?.name) || 0),
    0
  );
  const studioFit = studioMatch ? Math.min(1, studioMatch / maxStudio) : 0;

  const quality = Math.max(0, Math.min(1, (Number(item?.averageScore) || 0) / 100));
  const popularity = Math.log1p(Math.max(0, Number(item?.popularity) || 0)) / Math.log1p(maxPopularity);

  const matched = genres
    .filter((g) => (profile?.genre?.get?.(g) || 0) > 0)
    .sort((a, b) => (profile.genre.get(b) || 0) - (profile.genre.get(a) || 0))
    .slice(0, 3);
  const dislikedMatched = genres
    .filter((g) => (profile?.disliked?.get?.(g) || 0) > 0)
    .sort((a, b) => (profile.disliked.get(b) || 0) - (profile.disliked.get(a) || 0))
    .slice(0, 2);

  const personalScore = genreFit * 52 + formatFit * 11 + studioFit * 7 + quality * 20 + popularity * 10 - negativePenalty * 32;
  const fallbackScore = quality * 70 + popularity * 30;
  const score = profile?.hasTaste ? personalScore : fallbackScore;

  return {
    score: Math.max(0, Math.min(100, score)),
    genreFit,
    negativePenalty,
    formatFit,
    studioFit,
    quality,
    popularity,
    matched,
    dislikedMatched,
    maxFormat,
    maxStudio
  };
}

export function rankCandidates(candidates, profile) {
  const maxPopularity = Math.max(1, ...(candidates || []).map((m) => Number(m?.popularity) || 0));
  return (candidates || [])
    .map((item) => {
      const result = computeCandidateScore(item, profile, { maxPopularity });
      return { item, ...result };
    })
    .sort((a, b) => b.score - a.score || (Number(b.item?.averageScore) || 0) - (Number(a.item?.averageScore) || 0));
}

export function selectDiverse(ranked, k = 24, lambda = 0.7) {
  if (!ranked?.length) return [];
  const selected = [];
  const remaining = [...ranked];
  // 첫 번째는 최고 점수
  selected.push(remaining.shift());

  while (selected.length < k && remaining.length) {
    let bestIndex = 0;
    let bestValue = -Infinity;
    for (let i = 0; i < remaining.length; i++) {
      const candidate = remaining[i];
      // 다양성: 이미 선택된 항목과 장르 겹침이 적을수록 가산
      const overlap = selected.reduce((sum, sel) => {
        const a = new Set(candidate.item?.genres || []);
        const b = new Set(sel.item?.genres || []);
        const inter = [...a].filter((g) => b.has(g)).length;
        const union = new Set([...a, ...b]).size || 1;
        return sum + inter / union;
      }, 0) / selected.length;
      const mmr = lambda * candidate.score - (1 - lambda) * overlap * 100;
      if (mmr > bestValue) {
        bestValue = mmr;
        bestIndex = i;
      }
    }
    selected.push(remaining.splice(bestIndex, 1)[0]);
  }
  return selected;
}

export function recommendationMetrics(ranked, selected) {
  const selectedGenres = new Set((selected || []).flatMap((r) => r.item?.genres || []));
  const allGenres = new Set((ranked || []).flatMap((r) => r.item?.genres || []));
  const coverage = allGenres.size ? selectedGenres.size / allGenres.size : 0;
  const avgScore = selected?.length
    ? selected.reduce((sum, r) => sum + (r.score || 0), 0) / selected.length
    : 0;
  const distinctGenres = selectedGenres.size;
  return { coverage, avgScore, distinctGenres, selectedCount: selected?.length || 0 };
}
