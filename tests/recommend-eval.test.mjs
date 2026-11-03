import test from 'node:test';
import assert from 'node:assert/strict';
import {
  precisionAtK,
  recallAtK,
  ndcgAtK,
  coverage,
  intraListDiversity,
  novelty,
  evaluateRecommendation,
  coldStartStrategy
} from '../data/recommend-eval.js';

test('precision@k', () => {
  assert.equal(precisionAtK([1, 2, 3, 4], new Set([1, 3, 5]), 4), 0.5);
  assert.equal(precisionAtK([], new Set([1]), 4), 0);
});

test('recall@k', () => {
  assert.equal(recallAtK([1, 2, 3], new Set([1, 3, 5]), 3), 2 / 3);
});

test('ndcg@k: 완벽한 순위는 1', () => {
  assert.equal(ndcgAtK([1, 2], new Set([1, 2]), 2), 1);
});

test('coverage', () => {
  assert.equal(coverage([[1, 2], [3]], 10), 0.3);
});

test('intraListDiversity: 같은 장르면 0', () => {
  const items = [{ genres: ['Action'] }, { genres: ['Action'] }];
  assert.equal(intraListDiversity(items, 2), 0);
});

test('intraListDiversity: 다른 장르면 1', () => {
  const items = [{ genres: ['Action'] }, { genres: ['Comedy'] }];
  assert.equal(intraListDiversity(items, 2), 1);
});

test('evaluateRecommendation 통합', () => {
  const result = evaluateRecommendation({
    recommended: [1, 2, 3],
    relevant: new Set([1, 3]),
    catalogSize: 10,
    items: [{ genres: ['Action'] }, { genres: ['Comedy'] }, { genres: ['Drama'] }],
    k: 3
  });
  assert.ok(result.precision > 0);
  assert.ok(result.diversity > 0);
  assert.equal(result.selectedCount, undefined); // not part of eval
});

test('coldStartStrategy', () => {
  assert.equal(coldStartStrategy(null), 'popular-quality');
  assert.equal(coldStartStrategy({ hasTaste: false }), 'popular-quality');
  assert.equal(coldStartStrategy({ hasTaste: true, genre: new Map([['A', 1]]) }), 'explore-genres');
  assert.equal(coldStartStrategy({ hasTaste: true, genre: new Map([['A', 1], ['B', 1], ['C', 1]]) }), 'personalized');
});
