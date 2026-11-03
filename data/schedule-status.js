// 방영 일정 상태 판정 (v4.7)
//
// AniList는 지연·결방 사유를 제공하지 않습니다. 아래 신호로 "의심" 상태를 표시합니다.
//   - status === 'CANCELLED'        → 취소
//   - episode 0 또는 null          → 특별편/미정
//   - airingAt < now               → 지난 예정 (이미 시간이 지남)
//   - baseline보다 airingAt이 늦어짐 → 지연 의심
//   - 그 외                       → 방영 예정

const BASELINE_KEY = 'animehub_airing_baseline_v1';

export const AIRING_STATE = {
  SCHEDULED: 'scheduled',
  PAST: 'past',
  DELAYED: 'delayed',
  MISSED: 'missed',
  CANCELLED: 'cancelled',
  HIATUS: 'hiatus',
  SPECIAL: 'special'
};

export function classifyAiring(item, now = Date.now() / 1000, baselineEntry = null) {
  if (!item || !item.nextAiringEpisode) {
    return { state: AIRING_STATE.SCHEDULED, label: '방영 예정', tone: 'neutral' };
  }
  const media = item.media || item;
  const status = (media?.status || '').toUpperCase();
  const episode = item.nextAiringEpisode.episode;
  const airingAt = item.nextAiringEpisode.airingAt;

  if (status === 'CANCELLED') {
    return { state: AIRING_STATE.CANCELLED, label: '취소', tone: 'danger' };
  }
  if (status === 'HIATUS') {
    return { state: AIRING_STATE.HIATUS, label: '결방 의심', tone: 'warn' };
  }
  if (episode === 0 || episode == null) {
    return { state: AIRING_STATE.SPECIAL, label: '특별편', tone: 'neutral' };
  }
  if (typeof airingAt === 'number' && airingAt < now) {
    // 24시간 이상 지났는데 같은 회차가 그대로면 미방영 의심
    if (baselineEntry && baselineEntry.episode === episode && (now - airingAt) > 24 * 3600) {
      return { state: AIRING_STATE.MISSED, label: '미방영 의심', tone: 'warn' };
    }
    return { state: AIRING_STATE.PAST, label: '지난 예정', tone: 'muted' };
  }
  if (baselineEntry && typeof baselineEntry.airingAt === 'number' && airingAt - baselineEntry.airingAt > 6 * 3600) {
    return { state: AIRING_STATE.DELAYED, label: '지연 의심', tone: 'warn' };
  }
  return { state: AIRING_STATE.SCHEDULED, label: '방영 예정', tone: 'neutral' };
}

export function readAiringBaseline(storage = (typeof localStorage !== 'undefined' ? localStorage : null)) {
  if (!storage) return {};
  try {
    const raw = storage.getItem(BASELINE_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch (error) {
    return {};
  }
}

export function writeAiringBaseline(items, storage = (typeof localStorage !== 'undefined' ? localStorage : null), now = Date.now() / 1000) {
  if (!storage || !Array.isArray(items)) return false;
  try {
    const current = readAiringBaseline(storage);
    const next = { ...current };
    for (const item of items) {
      const media = item.media || item;
      const id = media?.id;
      if (id == null) continue;
      const ep = item.nextAiringEpisode?.episode;
      const at = item.nextAiringEpisode?.airingAt;
      const prev = next[String(id)];
      // 회차가 진행되었거나 처음 보는 경우에만 갱신
      if (!prev || (typeof ep === 'number' && ep > (prev.episode ?? -1)) || (typeof at === 'number' && at > (prev.airingAt ?? 0))) {
        next[String(id)] = { episode: ep ?? null, airingAt: at ?? null, seenAt: now };
      }
    }
    // 500건으로 제한
    const keys = Object.keys(next);
    if (keys.length > 500) {
      keys.sort().slice(0, keys.length - 500).forEach((key) => delete next[key]);
    }
    storage.setItem(BASELINE_KEY, JSON.stringify(next));
    return true;
  } catch (error) {
    return false;
  }
}
