import test from 'node:test';
import assert from 'node:assert/strict';
import {
  readQueue,
  writeQueue,
  enqueue,
  dequeue,
  markAttempt,
  pendingCount
} from '../data/sync-queue.js';

function fakeStorage() {
  const store = new Map();
  return {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k)
  };
}

test('enqueue/dequeue round trip', () => {
  const storage = fakeStorage();
  let queue = readQueue(storage);
  const { queue: q1, entry } = enqueue(queue, { type: 'upsert', payload: { media_id: 1 } });
  assert.equal(q1.length, 1);
  assert.equal(entry.type, 'upsert');
  writeQueue(q1, storage);
  assert.equal(readQueue(storage).length, 1);
  const q2 = dequeue(q1, entry.mutation_id);
  assert.equal(q2.length, 0);
  writeQueue(q2, storage);
  assert.equal(pendingCount(readQueue(storage)), 0);
});

test('markAttempt 증가', () => {
  const { queue } = enqueue([], { type: 'delete', payload: { media_id: 2 } });
  const id = queue[0].mutation_id;
  const marked = markAttempt(queue, id);
  assert.equal(marked[0].attempts, 1);
});

test('storage 없음 안전', () => {
  assert.deepEqual(readQueue(null), []);
  assert.equal(writeQueue([{ a: 1 }], null), false);
});
