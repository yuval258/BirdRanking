import { loadBirds } from './data.js';
import { importBytes } from './codec.js';
import { Aggregate, rank, TIERS } from './scoring.js';
import { driveEnabled, loadDriveRankings } from './drive.js';

const TIER_COLOR = { S: '#e24b4a', A: '#ef9f27', B: '#c9a227', C: '#639922', D: '#378add', F: '#888780' };
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const out = document.getElementById('out');

// Combines [{nickname, picks}] (a later entry with the same nickname replaces an earlier one).
async function show(items, problems) {
  const { birds } = await loadBirds();
  const users = new Map(items.map((i) => [i.nickname, i.picks]));
  const total = new Aggregate(birds.length);
  const per = [];
  for (const [nickname, picks] of users) {
    const a = new Aggregate(birds.length);
    for (const p of picks) a.add(p >>> 16, p & 0xffff);
    total.merge(a);
    per.push({ nickname, picks, count: picks.length });
  }
  const { tiers, order, scores } = rank(total);
  const agree = per.map((u) => {
    let ok = 0;
    for (const p of u.picks) if (scores[p >>> 16] >= scores[p & 0xffff]) ok++;
    return `<div class="row"><span class="nm">${esc(u.nickname)}</span><span class="muted">${u.count} picks</span><span>${u.count ? Math.round((ok / u.count) * 100) : 0}% agree with the group</span></div>`;
  }).join('');
  out.innerHTML = `${problems.map((p) => `<p class="muted">Skipped ${esc(p)}</p>`).join('')}
    <h2>${users.size} ${users.size === 1 ? 'person' : 'people'}, ${order.length} birds ranked</h2>
    <div class="tiers">${tiers.map((t) => `<div class="tier"><div class="tl" style="background:${TIER_COLOR[t.name]}">${t.name}</div>
      <div class="chips">${t.birds.map((b) => `<span class="chip"><span class="dot" data-color="${birds[b].c}"></span>${esc(birds[b].n)}</span>`).join('')}</div></div>`).join('')}</div>
    <h2>Agreement</h2>${agree}`;
};

document.getElementById('files').onchange = async (e) => {
  const { hash } = await loadBirds();
  const items = [];
  const problems = [];
  for (const f of e.target.files) {
    try {
      const { header, picks } = await importBytes(new Uint8Array(await f.arrayBuffer()));
      if (header.birdsDataHash !== hash) throw new Error('different bird list');
      items.push({ nickname: header.nickname, picks });
    } catch (err) {
      problems.push(`${f.name}: ${err.message}`);
    }
  }
  await show(items, problems);
};

if (driveEnabled()) {
  const btn = document.getElementById('drive');
  btn.hidden = false;
  btn.onclick = async () => {
    out.innerHTML = '<p class="muted">Loading rankings from Drive…</p>';
    try {
      const { hash } = await loadBirds();
      const { items, skipped } = await loadDriveRankings(hash);
      await show(items, skipped);
    } catch (err) {
      out.innerHTML = `<p>Couldn't load from Drive: ${esc(err.message)}</p>`;
    }
  };
}
