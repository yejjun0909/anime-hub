import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeAiringRows, filterAiringWindow } from '../data/schedule-merge.js';

test('mergeAiringRows: 빈 입력', () => {
  assert.deepEqual(mergeAiringRows([]), []);
  assert.deepEqual(mergeAiringRows(null), []);
});

test('mergeAiringRows: 같은 작품의 가까운 회차만 남김', () => {
  const rows = [
    { airingAt: 100, episode: 2, media: { id: 1, title: { userPreferred: 'A' } } },
    { airingAt: 200, episode: 3, media: { id: 1, title: { userPreferred: 'A' } } }
  ];
  const merged = mergeAiringRows(rows);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].nextAiringEpisode.episode, 2);
  assert.equal(merged[0].nextAiringEpisode.airingAt, 100);
});

test('mergeAiringRows: airingAt 오름차순 정렬', () => {
  const rows = [
    { airingAt: 300, episode: 1, media: { id: 2, title: { userPreferred: 'B' } } },
    { airingAt: 100, episode: 1, media: { id: 1, title: { userPreferred: 'A' } } }
  ];
  const merged = mergeAiringRows(rows);
  assert.deepEqual(merged.map((m) => m.id), [1, 2]);
});

test('mergeAiringRows: media가 없는 행은 건너뜀', () => {
  const rows = [
    { airingAt: 100, episode: 1, media: null },
    { airingAt: 200, episode: 1, media: { id: 1, title: { userPreferred: 'A' } } }
  ];
  assert.equal(mergeAiringRows(rows).length, 1);
});

test('filterAiringWindow: 범위 밖 제외', () => {
  const items = [
    { id: 1, nextAiringEpisode: { airingAt: 50 } },
    { id: 2, nextAiringEpisode: { airingAt: 150 } },
    { id: 3, nextAiringEpisode: { airingAt: 250 } }
  ];
  assert.deepEqual(filterAiringWindow(items, 100, 200).map((m) => m.id), [2]);
});
