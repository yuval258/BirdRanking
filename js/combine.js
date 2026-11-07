import { loadBirds } from './data.js';
import { importBytes } from './codec.js';
import { Aggregate, rank, TIERS } from './scoring.js';
import { icon } from './card.js';

const TIER_COLOR = { S: '#e24b4a', A: '#ef9f27', B: '#c9a227', C: '#639922', D: '#378add', F: '#888780' };
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const out = document.getElementById('out');

document.getElementById('files').onchange = async (e) => {
  const { birds, hash } = await loadBirds();
  const users = new Map(); // nickname+exportedAt dedupe: later file for the same nickname replaces earlier
  const problems = [];
  for (const f of e.target.files) {
    try {
      const { header, picks } = await importBytes(new Uint8Array(await f.arrayBuffer()));
      if (header.birdsDataHash !== hash) throw new Error('different bird list');
      users.set(header.nickname, picks);
    } catch (err) {
      problems.push(`${f.name}: ${err.message}`);
    }
  }
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
