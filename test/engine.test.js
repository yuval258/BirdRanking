import test from 'node:test';
import assert from 'node:assert/strict';
import { Engine } from '../js/engine.js';

function lcg(seed) { let s = seed; return () => (s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296; }

test('no bird repeats within a cycle and cycles shrink to winners', () => {
  const e = new Engine(11, lcg(1));
  const seen = new Set();
  let cycle = e.cycleId;
  const sizes = [];
  for (let i = 0; i < 40; i++) {
    if (e.cycleId !== cycle) { sizes.push(seen.size); seen.clear(); cycle = e.cycleId; }
    const [a, b] = e.current();
    assert.ok(!seen.has(a) && !seen.has(b));
    seen.add(a); seen.add(b);
    e.pick(a);
  }
  assert.ok(sizes[0] <= 11 && sizes[1] < sizes[0]);
});

test('odd pools give one bird a bye and everyone is covered', () => {
  const e = new Engine(7, lcg(2));
  const pairs = e.queue.flat();
  assert.equal(pairs.length, 6);
  assert.equal(e.winners.length, 1);
  assert.equal(new Set([...pairs, ...e.winners]).size, 7);
});

test('a new round starts when one bird is left', () => {
  const e = new Engine(4, lcg(3));
  const start = e.cycleId;
  for (let i = 0; i < 3; i++) e.pick(e.current()[0]);
  assert.ok(e.cycleId > start + 1);
  assert.equal(new Set([...e.queue.flat(), ...e.winners]).size, 4);
});

test('serialize then restore resumes identically', () => {
  const e = new Engine(10, lcg(4));
  for (let i = 0; i < 7; i++) e.pick(e.current()[1]);
  const r = new Engine(10, lcg(9), JSON.parse(JSON.stringify(e.serialize())));
  assert.deepEqual(r.current(), e.current());
  assert.deepEqual(r.serialize(), e.serialize());
});

test('switching in the current cycle changes who advances, no duplicates', () => {
  const e = new Engine(8, lcg(5));
  const [a, b] = e.current();
  e.pick(a);
  e.switchRecent(0);
  assert.ok(e.winners.includes(b) && !e.winners.includes(a));
  const all = [...e.queue.flat(), ...e.winners];
  assert.equal(new Set(all).size, all.length);
});

test('switching across a cycle boundary keeps the pool unique', () => {
  const e = new Engine(4, lcg(6));
  e.pick(e.current()[0]);
  e.pick(e.current()[0]);
  for (let i = 0; i < 2; i++) {
    e.switchRecent(i);
    const all = [...e.queue.flat(), ...e.winners];
    assert.equal(new Set(all).size, all.length);
  }
});

test('only the last 10 picks are kept editable', () => {
  const e = new Engine(40, lcg(7));
  for (let i = 0; i < 25; i++) e.pick(e.current()[0]);
  assert.equal(e.recent.length, 10);
  assert.equal(e.switchRecent(10), null);
});

test('filtering drops birds, re-pairs orphans, and never shows a filtered bird', () => {
  const e = new Engine(20, lcg(11));
  const gone = new Set([0, 1, 2, 3, 4, 5, 6, 7]);
  e.setExcluded([...gone]);
  const all = [...e.queue.flat(), ...e.winners];
  assert.equal(new Set(all).size, all.length);
  assert.ok(all.every((b) => !gone.has(b)));
  assert.equal(all.length, 12); // every remaining bird still owes its cycle match or has advanced
  for (let i = 0; i < 60; i++) {
    const [a, b] = e.current();
    assert.ok(!gone.has(a) && !gone.has(b));
    e.pick(a);
  }
});

test('a broken current pair refreshes to a new matchup', () => {
  const e = new Engine(10, lcg(12));
  const [a] = e.current();
  e.setExcluded([a]);
  assert.ok(!e.current().includes(a));
  assert.equal(new Set([...e.queue.flat(), ...e.winners]).size, 9);
});

test('filter state survives serialize and restore', () => {
  const e = new Engine(10, lcg(13));
  e.setExcluded([1, 2]);
  const r = new Engine(10, lcg(1), JSON.parse(JSON.stringify(e.serialize())));
  assert.deepEqual([...r.excluded], [1, 2]);
});

test('pairing uses only unmet partners when they exist', () => {
  const k = (a, b) => Math.min(a, b) * 100 + Math.max(a, b);
  const unmet = new Set([k(0, 1), k(2, 3), k(4, 5)]);
  for (let seed = 1; seed < 20; seed++) {
    const e = new Engine(6, lcg(seed), null, (a, b) => (unmet.has(k(a, b)) ? 0 : 1));
    assert.deepEqual(e.queue.map((p) => k(...p)).sort(), [...unmet].sort());
  }
});

test('when everyone has met everyone, a rematch is allowed and the cycle still completes', () => {
  const e = new Engine(6, lcg(5), null, () => 1);
  assert.equal(e.queue.length, 3);
  assert.equal(new Set(e.queue.flat()).size, 6);
});

test('after filtering, orphans are re-paired with unmet partners first', () => {
  const k = (a, b) => Math.min(a, b) * 100 + Math.max(a, b);
  for (let seed = 1; seed < 20; seed++) {
    const met = new Set();
    const e = new Engine(8, lcg(seed), null, (a, b) => (met.has(k(a, b)) ? 1 : 0));
    const [p1, p2, p3, p4] = e.queue;
    met.add(k(p1[1], p2[1]));
    met.add(k(p3[1], p4[1]));
    e.setExcluded([p1[0], p2[0], p3[0], p4[0]]);
    assert.equal(e.queue.length, 2);
    assert.ok(e.queue.every((p) => !met.has(k(...p))));
  }
});

const snap = (e) => JSON.stringify([e.queue, e.winners, e.cycleId]);

test('undo inside a cycle restores the exact state and matchup', () => {
  const e = new Engine(12, lcg(31));
  e.pick(e.current()[0]);
  const before = snap(e);
  const pair = [...e.current()];
  e.pick(pair[1]);
  assert.deepEqual(e.undoLast(), { w: pair[1], l: pair[0] });
  assert.equal(snap(e), before);
  assert.equal(e.recent.length, 1);
});

test('undo restores the previous cycle when the pick closed it', () => {
  const e = new Engine(8, lcg(32));
  for (let i = 0; i < 3; i++) e.pick(e.current()[0]);
  const before = snap(e);
  const pair = [...e.current()];
  e.pick(pair[0]); // closes cycle 1, builds cycle 2
  assert.equal(e.cycleId, 2);
  e.undoLast();
  assert.equal(snap(e), before);
  assert.deepEqual(e.current(), pair);
  e.pick(pair[1]);
  assert.equal(e.cycleId, 2);
});

test('undo restores the previous round when the pick ended a round', () => {
  const e = new Engine(2, lcg(33));
  const before = snap(e);
  e.pick(e.current()[0]); // one bird left -> new round
  assert.equal(e.cycleId, 2);
  e.undoLast();
  assert.equal(snap(e), before);
});

test('undo with nothing recorded does nothing, and repeated undo walks back', () => {
  const e = new Engine(10, lcg(34));
  assert.equal(e.undoLast(), null);
  const start = snap(e);
  for (let i = 0; i < 4; i++) e.pick(e.current()[0]);
  for (let i = 0; i < 4; i++) e.undoLast();
  assert.equal(snap(e), start);
});
