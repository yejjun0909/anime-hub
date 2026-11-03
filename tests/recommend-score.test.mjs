import test from 'node:test';
import assert from 'node:assert/strict';
import {
  computeCandidateScore,
  rankCandidates,
  selectDiverse,
  recommendationMetrics
} from '../data/recommend-score.js';

const profile = {
  genre: new Map([['Action', 5], ['Fantasy', 3]]),
  disliked: new Map(),
  format: new Map([['TV', 4]]),
  studio: new Map([['ufotable', 2]]),
  positiveGenreTotal: 8,
  dislikedGenreTotal: 0,
  hasTaste: true
};

test('computeCandidateScore: 선호 장르 작품은 높은 점수', () => {
  const item = { genres: ['Action', 'Fantasy'], format: 'TV', studios: { nodes: [{ name: 'ufotable' }] }, averageScore: 85, popularity: 1000 };
  const result = computeCandidateScore(item, profile, { maxPopularity: 1000 });
  assert.ok(result.score > 60, `score ${result.score}`);
  assert.deepEqual(result.matched, ['Action', 'Fantasy']);
});

test('computeCandidateScore: 비선호 장르 페널티', () => {
  const p = { ...profile, disliked: new Map([['Horror', 4]]), dislikedGenreTotal: 4 };
  const item = { genres: ['Action', 'Horror'], format: 'TV', studios: { nodes: [] }, averageScore: 80, popularity: 500 };
  const result = computeCandidateScore(item, p, { maxPopularity: 1000 });
  assert.ok(result.negativePenalty > 0);
});

test('computeCandidateScore: 취향 없으면 fallback (quality+popularity)', () => {
  const item = { genres: ['Comedy'], format: 'TV', studios: { nodes: [] }, averageScore: 90, popularity: 2000 };
  const result = computeCandidateScore(item, { ...profile, hasTaste: false }, { maxPopularity: 2000 });
  assert.ok(result.score > 50);
});

test('rankCandidates: 점수 내림차순', () => {
  const items = [
    { id: 1, genres: ['Action'], format: 'TV', studios: { nodes: [] }, averageScore: 70, popularity: 100 },
    { id: 2, genres: ['Action', 'Fantasy'], format: 'TV', studios: { nodes: [{ name: 'ufotable' }] }, averageScore: 85, popularity: 1000 }
  ];
  const ranked = rankCandidates(items, profile);
  assert.equal(ranked[0].item.id, 2);
});

test('selectDiverse: k개 선택', () => {
  const items = Array.from({ length: 10 }, (_, i) => ({
    item: { id: i, genres: [i % 2 ? 'Action' : 'Comedy'], averageScore: 70 + i, popularity: 100 },
    score: 70 + i
  }));
  const selected = selectDiverse(items, 4);
  assert.equal(selected.length, 4);
});

test('recommendationMetrics: 커버리지 계산', () => {
  const ranked = [{ item: { genres: ['Action', 'Fantasy'] }, score: 80 }, { item: { genres: ['Comedy'] }, score: 70 }];
  const selected = [ranked[0]];
  const m = recommendationMetrics(ranked, selected);
  assert.equal(m.selectedCount, 1);
  assert.ok(m.coverage > 0);
});
