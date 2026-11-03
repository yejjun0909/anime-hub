// 오프라인 동기화 큐 (v4.8)
//
// 네트워크가 없을 때 변경을 큐에 쌓고, 온라인이 되면 mutation_id 기반으로
// idempotent하게 재전송합니다.

const QUEUE_KEY = 'animehub_sync_queue_v1';

export function readQueue(storage = (typeof localStorage !== 'undefined' ? localStorage : null)) {
  if (!storage) return [];
  try {
    const raw = storage.getItem(QUEUE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    return [];
  }
}

export function writeQueue(queue, storage = (typeof localStorage !== 'undefined' ? localStorage : null)) {
  if (!storage) return false;
  try {
    storage.setItem(QUEUE_KEY, JSON.stringify(queue || []));
    return true;
  } catch (error) {
    return false;
  }
}

export function enqueue(queue, mutation) {
  const next = Array.isArray(queue) ? [...queue] : [];
  const id = mutation?.mutation_id || `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const entry = {
    mutation_id: id,
    type: mutation?.type || 'upsert',
    payload: mutation?.payload || null,
    created_at: mutation?.created_at || new Date().toISOString(),
    attempts: 0
  };
  next.push(entry);
  return { queue: next, entry };
}

export function dequeue(queue, mutationId) {
  return (queue || []).filter((entry) => entry.mutation_id !== mutationId);
}

export function markAttempt(queue, mutationId) {
  return (queue || []).map((entry) =>
    entry.mutation_id === mutationId ? { ...entry, attempts: (entry.attempts || 0) + 1 } : entry
  );
}

export function pendingCount(queue) {
  return (queue || []).length;
}
