import test from 'node:test';
import assert from 'node:assert/strict';
import { Session } from '../js/session.js';
import { uploadRanking, loadDriveRankings } from '../js/drive.js';
import { b64ToBytes, importBytes } from '../js/codec.js';

const mockFetch = (handler) => { globalThis.fetch = async (url, init) => { const r = handler(String(url), init); return { ok: r.ok ?? true, status: r.status ?? 200, json: async () => r.json }; }; };

test('upload sends a text/plain POST with a ranking that round-trips', async () => {
  const s = new Session(50, { nickname: 'ann' });
  for (let i = 0; i < 30; i++) s.pick(s.pair()[i % 2]);
  let seen;
  mockFetch((url, init) => { seen = { url, init }; return { json: { ok: true } }; });
  await uploadRanking(s, 'hash1', 'https://x/exec');
  assert.equal(seen.init.method, 'POST');
  assert.match(seen.init.headers['Content-Type'], /^text\/plain/);
  const body = JSON.parse(seen.init.body);
  assert.equal(body.nickname, 'ann');
  const { header, picks } = await importBytes(b64ToBytes(body.data));
  assert.equal(header.birdsDataHash, 'hash1');
  assert.equal(picks.length, 30);
});

test('upload surfaces an error from the script', async () => {
  mockFetch(() => ({ json: { error: 'not a ranking file' } }));
  const s = new Session(10, { nickname: 'a' });
  await assert.rejects(uploadRanking(s, 'h', 'https://x/exec'), /not a ranking file/);
});

test('loading skips files made with a different bird list', async () => {
  const s = new Session(50, { nickname: 'ann' });
  for (let i = 0; i < 10; i++) s.pick(s.pair()[0]);
  let data;
  mockFetch((url, init) => { if (init) { data = JSON.parse(init.body).data; return { json: { ok: true } }; } return { json: {} }; });
  await uploadRanking(s, 'good', 'https://x/exec');
  mockFetch((url) => {
    if (url.includes('action=list')) return { json: { files: [{ id: '1', name: 'bird-ranking-ann.birdrank' }] } };
    return { json: { data } };
  });
  const ok = await loadDriveRankings('good', 'https://x/exec');
  assert.deepEqual([ok.items.length, ok.items[0].nickname, ok.items[0].picks.length], [1, 'ann', 10]);
  const bad = await loadDriveRankings('other', 'https://x/exec');
  assert.equal(bad.items.length, 0);
  assert.match(bad.skipped[0], /different bird list/);
});

import { othersAggregate } from '../js/drive.js';
import { pack } from '../js/codec.js';

test('others aggregate skips the current user and is a fixed snapshot', () => {
  const items = [
    { nickname: 'me', picks: Uint32Array.from([pack(0, 1)]) },
    { nickname: 'sam', picks: Uint32Array.from([pack(2, 3), pack(2, 4)]) },
  ];
  const { agg, people } = othersAggregate(items, 10, 'me');
  assert.deepEqual(people, [{ nickname: 'sam', count: 2 }]);
  assert.equal(agg.wins[0], 0);
  assert.equal(agg.wins[2], 2);
  items[1].picks = Uint32Array.from([]);
  assert.equal(agg.wins[2], 2); // later changes to the source don't leak into the snapshot
});
