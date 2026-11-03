// 방영 일정 행 병합 (v4.7)
//
// AniList는 perPage 50으로 제한되므로 여러 페이지를 합쳐야 합니다.
// 같은 작품의 여러 회차가 나오면 가장 가까운 회차만 남기고,
// airingAt 오름차순으로 정렬합니다.

/**
 * @param {Array<{airingAt:number, episode:number, media:object}>} rows
 * @returns {Array<object>} media에 nextAiringEpisode가 붙은 정렬된 배열
 */
export function mergeAiringRows(rows) {
  const unique = new Map();
  for (const row of rows || []) {
    if (!row || !row.media) continue;
    const media = { ...row.media, nextAiringEpisode: { airingAt: row.airingAt, episode: row.episode } };
    const old = unique.get(media.id);
    if (!old || media.nextAiringEpisode.airingAt < old.nextAiringEpisode.airingAt) unique.set(media.id, media);
  }
  return [...unique.values()].sort((a, b) => a.nextAiringEpisode.airingAt - b.nextAiringEpisode.airingAt);
}

export function filterAiringWindow(items, from, to) {
  return (items || []).filter((m) => {
    const at = m?.nextAiringEpisode?.airingAt;
    return typeof at === 'number' && at >= from && at <= to;
  });
}
