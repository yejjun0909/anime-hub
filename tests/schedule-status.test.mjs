import test from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyAiring,
  readAiringBaseline,
  writeAiringBaseline,
  AIRING_STATE
} from '../data/schedule-status.js';

function fakeStorage() {
  const store = new Map();
  return {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k)
  };
}

const now = 1_700_000_000;

test('classify: 취소 상태', () => {
  const r = classifyAiring({ media: { status: 'CANCELLED' }, nextAiringEpisode: { airingAt: now + 1000, episode: 5 } }, now);
  assert.equal(r.state, AIRING_STATE.CANCELLED);
  assert.equal(r.label, '취소');
});

test('classify: 특별편 (episode 0)', () => {
  const r = classifyAiring({ media: { status: 'RELEASING' }, nextAiringEpisode: { airingAt: now + 1000, episode: 0 } }, now);
  assert.equal(r.state, AIRING_STATE.SPECIAL);
});

test('classify: 지난 예정', () => {
  const r = classifyAiring({ media: { status: 'RELEASING' }, nextAiringEpisode: { airingAt: now - 3600, episode: 5 } }, now);
  assert.equal(r.state, AIRING_STATE.PAST);
});

test('classify: 지연 의심 (baseline보다 6시간 이상 늦어짐)', () => {
  const r = classifyAiring(
    { media: { id: 1, status: 'RELEASING' }, nextAiringEpisode: { airingAt: now + 3600, episode: 5 } },
    now,
    { airingAt: now - 100000, episode: 5 }
  );
  assert.equal(r.state, AIRING_STATE.DELAYED);
});

test('classify: 방영 예정 (정상)', () => {
  const r = classifyAiring({ media: { status: 'RELEASING' }, nextAiringEpisode: { airingAt: now + 3600, episode: 5 } }, now);
  assert.equal(r.state, AIRING_STATE.SCHEDULED);
  assert.equal(r.label, '방영 예정');
});

test('classify: 미방영 의심 (24시간 이상 지남)', () => {
  const r = classifyAiring(
    { media: { id: 1, status: 'RELEASING' }, nextAiringEpisode: { airingAt: now - 25 * 3600, episode: 5 } },
    now,
    { airingAt: now - 26 * 3600, episode: 5 }
  );
  assert.equal(r.state, AIRING_STATE.MISSED);
  assert.equal(r.label, '미방영 의심');
});

test('classify: 결방 의심 (HIATUS)', () => {
  const r = classifyAiring({ media: { status: 'HIATUS' }, nextAiringEpisode: { airingAt: now + 3600, episode: 5 } }, now);
  assert.equal(r.state, AIRING_STATE.HIATUS);
  assert.equal(r.label, '결방 의심');
});
  const storage = fakeStorage();
  const items = [{ media: { id: 1 }, nextAiringEpisode: { airingAt: 100, episode: 2 } }];
  assert.equal(writeAiringBaseline(items, storage, now), true);
  const b = readAiringBaseline(storage);
  assert.equal(b['1'].episode, 2);
  assert.equal(b['1'].airingAt, 100);
});

test('baseline: storage 없음 안전', () => {
  assert.deepEqual(readAiringBaseline(null), {});
  assert.equal(writeAiringBaseline([{ media: { id: 1 } }], null), false);
});
