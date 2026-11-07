import test from 'node:test';
import assert from 'node:assert/strict';
import { collectionStats, wingSummary, rangeOdds, histogram } from '../js/stats.js';

const b = (o) => ({ h: [], f: [], nest: 'bowl', w: 50, ...o });

test('counts habitats, foods (incl. wild) and nests', () => {
  const s = collectionStats([
    b({ h: ['F', 'W'], f: [['fish', 1], ['wild', 1]], nest: 'cavity' }),
    b({ h: ['F'], f: [['seed', 2]], nest: 'cavity' }),
    b({ w: '*', nest: 'none' }),
  ]);
  assert.deepEqual([s.habitat.F, s.habitat.G, s.habitat.W], [2, 0, 1]);
  assert.deepEqual([s.food.fish, s.food.wild, s.food.seed], [1, 1, 1]);
  assert.deepEqual([s.nest.cavity, s.nest.none], [2, 1]);
  assert.equal(s.flightless, 1);
  assert.equal(s.wings.length, 2);
});

test('wing summary and range odds', () => {
  const wings = [10, 20, 30, 40, 100];
  assert.deepEqual(wingSummary(wings), { min: 10, max: 100, mean: 40, median: 30 });
  const r = rangeOdds(wings, 0, 20, 40);
  assert.deepEqual([r.inRange, r.below, r.above, r.pct], [3, 1, 1, 60]);
});

test('flightless birds join the sample only when asked', () => {
  const wings = [10, 20];
  assert.equal(rangeOdds(wings, 2, 0, 15).total, 2);
  const r = rangeOdds(wings, 2, 0, 15, true);
  assert.deepEqual([r.total, r.inRange], [4, 3]);
});

test('histogram buckets cover every bird', () => {
  const bins = histogram([5, 30, 31, 260]);
  assert.equal(bins.reduce((a, x) => a + x.n, 0), 4);
  assert.equal(bins[0].n, 1);
});

import { shareOf } from '../js/stats.js';

test('wildcards count toward every nest and food, but not toward none or themselves', () => {
  const birds = [
    b({ nest: 'bowl' }), b({ nest: 'wild' }), b({ nest: 'none' }), b({ nest: 'cavity' }),
    b({ f: [['wild', 1]] }), b({ f: [['fish', 1]] }), b({ f: [['fish', 1], ['wild', 1]] }),
  ];
  const bowl = shareOf(birds, 'nest', 'bowl');
  assert.deepEqual([bowl.direct, bowl.wild, bowl.count], [4, 1, 5]);
  assert.equal(shareOf(birds, 'nest', 'none').count, 1);
  assert.equal(shareOf(birds, 'nest', 'wild').count, 1);
  const fish = shareOf(birds, 'food', 'fish');
  assert.deepEqual([fish.direct, fish.wild], [2, 1]);
  assert.equal(shareOf(birds, 'food', 'wild').count, 2);
  assert.equal(shareOf([b({ h: ['F'] }), b({ h: ['G'] })], 'habitat', 'F').pct, 50);
});
