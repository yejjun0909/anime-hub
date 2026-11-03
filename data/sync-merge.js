// 동기화 충돌 해결 (v4.8)
//
// last-write-wins 기본 + 양쪽에서 같은 항목이 바뀐 경우 충돌 목록을 반환합니다.
// 호출자는 conflicts를 UI에 보여주고 사용자 선택을 받습니다.

export const CONFLICT_RESOLUTION = {
  LOCAL: 'local',
  REMOTE: 'remote',
  MANUAL: 'manual'
};

function stamp(item) {
  return Date.parse(item?.updated_at || item?.updatedAt || item?.savedAt || 0) || 0;
}

export function diffWatchlist(localItems = [], remoteItems = []) {
  const localMap = new Map((localItems || []).map((item) => [String(item.media_id), item]));
  const remoteMap = new Map((remoteItems || []).map((item) => [String(item.media_id), item]));
  const allKeys = new Set([...localMap.keys(), ...remoteMap.keys()]);

  const added = [];
  const removed = [];
  const changed = [];
  const conflicts = [];

  for (const key of allKeys) {
    const local = localMap.get(key);
    const remote = remoteMap.get(key);
    if (local && !remote) {
      // 원격에 없음: 삭제되었거나 아직 업로드되지 않음. tombstone이 있으면 삭제로 간주.
      if (local.deleted_at) removed.push(local);
      else added.push(local);
      continue;
    }
    if (!local && remote) {
      if (remote.deleted_at) removed.push(remote);
      else added.push(remote);
      continue;
    }
    // 둘 다 있음
    if (local.deleted_at || remote.deleted_at) {
      // 한쪽이 삭제 → 삭제 우선 (tombstone)
      removed.push(local.deleted_at ? local : remote);
      continue;
    }
    const ls = stamp(local);
    const rs = stamp(remote);
    if (ls === rs) {
      // 동일 시각이면 내용이 같을 때만 무변경으로 처리
      if (JSON.stringify({ ...local, updated_at: undefined }) === JSON.stringify({ ...remote, updated_at: undefined })) continue;
      conflicts.push({ key, local, remote });
      continue;
    }
    if (ls > rs) changed.push({ winner: 'local', item: local, other: remote });
    else if (rs > ls) changed.push({ winner: 'remote', item: remote, other: local });
    else conflicts.push({ key, local, remote });
  }

  return { added, removed, changed, conflicts };
}

export function mergeWatchlistWithConflicts(localItems = [], remoteItems = []) {
  const { added, removed, changed, conflicts } = diffWatchlist(localItems, remoteItems);
  const mergedMap = new Map();

  for (const item of remoteItems || []) {
    if (item?.deleted_at) continue;
    mergedMap.set(String(item.media_id), { ...item });
  }
  for (const entry of changed) {
    if (entry.winner === 'local') mergedMap.set(String(entry.item.media_id), { ...entry.item });
  }
  for (const item of added) {
    if (item?.deleted_at) continue;
    mergedMap.set(String(item.media_id), { ...item });
  }

  return {
    merged: [...mergedMap.values()],
    conflicts,
    stats: { added: added.length, removed: removed.length, changed: changed.length, conflicts: conflicts.length }
  };
}
