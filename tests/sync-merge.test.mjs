import test from 'node:test';
import assert from 'node:assert/strict';
import { diffWatchlist, mergeWatchlistWithConflicts } from '../data/sync-merge.js';

test('diff: 추가·삭제·변경 분류', () => {
  const local = [
    { media_id: 1, status: 'CURRENT', updated_at: '2026-11-03T10:00:00Z' },
    { media_id: 2, status: 'COMPLETED', updated_at: '2026-11-03T10:00:00Z', deleted_at: '2026-11-03T10:00:00Z' }
  ];
  const remote = [
    { media_id: 1, status: 'COMPLETED', updated_at: '2026-11-03T11:00:00Z' },
    { media_id: 3, status: 'PLANNING', updated_at: '2026-11-03T09:00:00Z' }
  ];
  const diff = diffWatchlist(local, remote);
  assert.equal(diff.changed.length, 1);
  assert.equal(diff.changed[0].winner, 'remote');
  assert.equal(diff.added.length, 1);
  assert.equal(diff.removed.length, 1);
});

test('merge: tombstone 삭제 우선', () => {
  const local = [{ media_id: 1, status: 'CURRENT', updated_at: '2026-11-03T10:00:00Z' }];
  const remote = [{ media_id: 1, status: 'CURRENT', updated_at: '2026-11-03T09:00:00Z', deleted_at: '2026-11-03T09:30:00Z' }];
  const result = mergeWatchlistWithConflicts(local, remote);
  assert.equal(result.merged.length, 0);
  assert.equal(result.stats.removed, 1);
});

test('merge: 충돌 감지 (동일 시각)', () => {
  const local = [{ media_id: 1, status: 'CURRENT', updated_at: '2026-11-03T10:00:00.000Z' }];
  const remote = [{ media_id: 1, status: 'COMPLETED', updated_at: '2026-11-03T10:00:00.000Z' }];
  const result = mergeWatchlistWithConflicts(local, remote);
  assert.equal(result.conflicts.length, 1);
});

test('merge: 빈 입력', () => {
  const result = mergeWatchlistWithConflicts([], []);
  assert.deepEqual(result.merged, []);
  assert.equal(result.conflicts.length, 0);
});
