// Saves and loads rankings through the Apps Script web app in apps-script/Code.gs.
// Requests use text/plain so the browser sends no CORS preflight, which Apps Script can't answer.
import { DRIVE_URL } from './config.js';
import { Aggregate } from './scoring.js';
import { exportBytes, importBytes, bytesToB64, b64ToBytes } from './codec.js';

export const driveEnabled = () => Boolean(DRIVE_URL);

async function call(url, init) {
  const res = await fetch(url, init);
  const json = await res.json();
  if (!res.ok || json.error) throw new Error(json.error || `Drive request failed (${res.status})`);
  return json;
}

export async function uploadRanking(session, hash, url = DRIVE_URL) {
  const bytes = await exportBytes(session.header({ birdsDataHash: hash }), session.picks, session.count);
  return call(url, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ nickname: session.nickname, data: bytesToB64(bytes) }),
  });
}

// Returns [{nickname, picks}] for every ranking file in the folder made with this bird list;
// `skipped` lists files that couldn't be used.
export async function loadDriveRankings(hash, url = DRIVE_URL) {
  const { files } = await call(`${url}?action=list`);
  const items = [];
  const skipped = [];
  await Promise.all(files.map(async (f) => {
    try {
      const { data } = await call(`${url}?action=get&id=${encodeURIComponent(f.id)}`);
      const { header, picks } = await importBytes(b64ToBytes(data));
      if (header.birdsDataHash !== hash) throw new Error('different bird list');
      items.push({ nickname: header.nickname, picks });
    } catch (err) {
      skipped.push(`${f.name}: ${err.message}`);
    }
  }));
  return { items, skipped };
}

// Everyone else's picks as one aggregate, ignoring the file of `ownNickname` (the live local
// picks stand in for it). `items` is a snapshot, so it never changes until the page reloads.
export function othersAggregate(items, n, ownNickname) {
  const agg = new Aggregate(n);
  const people = [];
  for (const { nickname, picks } of items) {
    if (nickname === ownNickname) continue;
    for (const p of picks) agg.add(p >>> 16, p & 0xffff);
    people.push({ nickname, count: picks.length });
  }
  return { agg, people };
}
