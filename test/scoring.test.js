import test from 'node:test';
import assert from 'node:assert/strict';
import { Aggregate, rank, TIERS } from '../js/scoring.js';
import { Session } from '../js/session.js';
import { encodePicks, decodePicks, exportBytes, importBytes, pack } from '../js/codec.js';

test('beating a strong bird is worth more than beating a weak one', () => {
  const g = new Aggregate(6);
  // 1 is strong (beats 2,3,4,5); 0 beats strong 1 once; 5 beats weak 4 once
  for (const l of [2, 3, 4, 5]) g.add(1, l);
  g.add(0, 1); g.add(1, 0); g.add(1, 0);
  g.add(5, 4); g.add(5, 4);
  g.add(0, 4); // 0: beats 1 and 4
  const { scores } = rank(g);
  // bird 0 (beat strong 1, weak 4) and bird 5 (beat only weak 4 twice)
  assert.ok(scores[0] > 0);
  const g2 = new Aggregate(4);
  g2.add(0, 1); g2.add(2, 3); g2.add(1, 3); g2.add(1, 3); g2.add(1, 3);
  const q = rank(g2).scores;
  assert.ok(q[0] > q[2], 'win over a bird that keeps winning beats win over a bird that never does');
});

test('tier sizes follow the bell curve quantiles', () => {
  const g = new Aggregate(100);
  for (let i = 0; i < 100; i++) g.add(i, (i + 1) % 100);
  const { tiers } = rank(g);
  const sizes = tiers.map((t) => t.birds.length);
  assert.equal(sizes.reduce((a, b) => a + b), 100);
  assert.deepEqual(sizes, TIERS.map(([, s]) => Math.round(s * 100)));
});

test('unseen birds are not ranked', () => {
  const g = new Aggregate(5);
  g.add(0, 1);
  assert.deepEqual(rank(g).order.sort(), [0, 1]);
});

test('pack and 3-byte codec round trip', () => {
  const picks = Uint32Array.from([pack(0, 1), pack(706, 4095), pack(4095, 0)]);
  assert.deepEqual(decodePicks(encodePicks(picks, 3)), picks);
});

test('export then import reproduces identical scores', async () => {
  const s = new Session(50, { nickname: 'a' });
  for (let i = 0; i < 300; i++) s.pick(s.pair()[i % 2]);
  const bytes = await exportBytes(s.header({ birdsDataHash: 'x' }), s.picks, s.count);
  const { header, picks } = await importBytes(bytes);
  const r = new Session(50, { nickname: 'a', picks, count: picks.length, engineState: header.state });
  assert.deepEqual(rank(r.agg).scores, rank(s.agg).scores);
  assert.deepEqual(r.pair(), s.pair());
});

test('150k picks stay within the size budget and score quickly', async () => {
  const n = 707;
  const s = new Session(n, { nickname: 'big' });
  for (let i = 0; i < 150000; i++) s.pick(s.pair()[(i * 7) % 2]);
  const bytes = await exportBytes(s.header({ birdsDataHash: 'x' }), s.picks, s.count);
  assert.ok(bytes.length < 450_000, `export was ${bytes.length} bytes`);
  const t = Date.now();
  rank(s.agg);
  assert.ok(Date.now() - t < 1000);
});

test('combining aggregates equals scoring concatenated picks', () => {
  const a = new Session(30, { nickname: 'a' });
  const b = new Session(30, { nickname: 'b' });
  for (let i = 0; i < 200; i++) { a.pick(a.pair()[i % 2]); b.pick(b.pair()[(i + 1) % 2]); }
  const merged = new Aggregate(30); merged.merge(a.agg); merged.merge(b.agg);
  const all = new Aggregate(30);
  for (const s of [a, b]) for (let i = 0; i < s.count; i++) all.add(s.picks[i] >>> 16, s.picks[i] & 0xffff);
  assert.deepEqual(rank(merged).scores, rank(all).scores);
});

test('switching a recent pick moves the score', () => {
  const s = new Session(10, { nickname: 'a' });
  const [x] = s.pair();
  s.pick(x);
  const before = s.agg.wins[x];
  s.switchRecent(0);
  assert.equal(s.agg.wins[x], before - 1);
});

test('excluded birds are left out of the ranking', () => {
  const g = new Aggregate(4);
  g.add(0, 1); g.add(2, 3);
  assert.deepEqual(rank(g, undefined, new Set([1, 3])).order.sort(), [0, 2]);
});

test('a session never repeats a matchup while unmet partners remain in the pool', () => {
  const n = 40;
  const s = new Session(n, { nickname: 'a' });
  const seen = new Map();
  let firstCycleRepeats = 0;
  const startCycle = s.engine.cycleId;
  while (s.engine.cycleId === startCycle) {
    const [a, b] = s.pair();
    const k = Math.min(a, b) * 100 + Math.max(a, b);
    if (seen.has(k)) firstCycleRepeats++;
    seen.set(k, 1);
    s.pick(a);
  }
  assert.equal(firstCycleRepeats, 0);
  // The rest of the first round: only the tiny closing cycles may run out of unmet partners.
  let repeats = 0;
  for (let i = 0; i < 60 && s.engine.cycleId <= 7; i++) {
    const [a, b] = s.pair();
    if (s.agg.meetings(a, b) > 0) repeats++;
    s.pick(a);
  }
  assert.ok(repeats <= 3, `rematches in the first round: ${repeats}`);
});

test('session undo removes the pick from counts and history', () => {
  const s = new Session(10, { nickname: 'a' });
  const [x, y] = s.pair();
  s.pick(x);
  assert.equal(s.count, 1);
  assert.ok(s.undo());
  assert.equal(s.count, 0);
  assert.equal(s.agg.matches(x), 0);
  assert.deepEqual(s.pair().sort(), [x, y].sort());
  assert.equal(s.undo(), false);
});
