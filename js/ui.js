import { loadBirds } from './data.js';
import { cardHTML } from './card.js';
import { Session } from './session.js';
import { Aggregate, rank, TIERS } from './scoring.js';
import { exportBytes, importBytes, MAX_BIRDS } from './codec.js';
import * as store from './store.js';
import { driveEnabled, uploadRanking, loadDriveRankings, othersAggregate } from './drive.js';
import { collectionStats, wingSummary, rangeOdds, histogram, shareOf, HABITATS, FOODS, NESTS } from './stats.js';
import { icon, nestIcon } from './card.js';

const $ = (id) => document.getElementById(id);
const view = $('view');
const TIER_COLOR = { S: '#e24b4a', A: '#ef9f27', B: '#c9a227', C: '#639922', D: '#378add', F: '#888780' };
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

let birds;
let hash;
let session = null;

const bar = (mode) => {
  $('who').textContent = session ? session.nickname : '';
  $('btnRank').hidden = !session;
  $('btnFilter').hidden = !session;
  // The statistics panel sits beside the cards, so it is only shown on the card screens.
  $('stats').hidden = !session || !['duel', 'review'].includes(mode);
  renderStats();
  $('btnRecent').hidden = !session;
  $('btnDuel').hidden = !session || mode === 'duel';
};

async function persist(dirtyFrom) {
  try { await store.saveUser(session, dirtyFrom); } catch (e) { console.error('save failed', e); }
}

async function start(nickname, data) {
  session = new Session(birds.length, { nickname, ...(data || {}) });
  // New users start with these expansions filtered out; they can turn them on under Filters.
  if (!data) session.setExcluded(birds.map((b, i) => (DEFAULT_FILTERED.includes(b.set) ? i : -1)).filter((i) => i >= 0));
  await store.setCurrent(nickname);
  await persist(0);
  showDuel();
}

async function showLogin() {
  session = null;
  bar('login');
  const users = await store.listUsers();
  view.innerHTML = `<h2>Who's ranking?</h2>
    ${users.map((u) => `<div class="row"><span class="nm">${esc(u.nickname)}</span><span class="muted">${u.count} picks</span><button data-user="${esc(u.nickname)}">Continue</button></div>`).join('')}
    <form id="newUser" class="actions"><input id="nick" placeholder="Pick a nickname" maxlength="30" required autocapitalize="off" autocorrect="off" autocomplete="off" spellcheck="false">
      <button class="primary">Start ranking</button>
      <button type="button" id="imp">Import a ranking file</button></form>
    <input id="file" type="file" accept=".birdrank" hidden>`;
  view.querySelectorAll('[data-user]').forEach((b) => b.onclick = async () => {
    const data = await store.loadUser(b.dataset.user);
    await start(b.dataset.user, data);
  });
  $('newUser').onsubmit = async (e) => {
    e.preventDefault();
    // Nicknames are case-insensitive: reuse an existing user whose name differs only in case.
    const typed = $('nick').value.trim().toLowerCase();
    if (!typed) return;
    const nick = users.find((u) => u.nickname.toLowerCase() === typed)?.nickname ?? typed;
    await start(nick, await store.loadUser(nick));
  };
  $('imp').onclick = () => $('file').click();
  $('file').onchange = onImport;
}

function showDuel() {
  bar('duel');
  const [a, b] = session.pair();
  view.innerHTML = `<div class="duel">
      <button class="opt" data-w="${a}" aria-label="Pick ${esc(birds[a].n)}">${cardHTML(birds[a])}</button>
      <button class="opt" data-w="${b}" aria-label="Pick ${esc(birds[b].n)}">${cardHTML(birds[b])}</button>
    </div>
    <div class="count">${session.canUndo() ? '<button id="undo">Undo last pick</button> ' : ''}${session.count} picks · ← → to pick${session.canUndo() ? ' · ⌘/Ctrl+Z to undo' : ''}</div>`;
  view.querySelectorAll('.opt').forEach((o) => o.onclick = () => choose(+o.dataset.w));
  if (session.canUndo()) $('undo').onclick = undo;
}

async function undo() {
  if (!session.canUndo() || !session.undo()) return;
  showDuel();
  await persist(session.count);
}

async function choose(w) {
  const pos = session.pick(w);
  showDuel();
  await persist(pos);
  // Background backup to Drive every 50 picks; the Save to Drive button covers the rest.
  if (driveEnabled() && session.count % 50 === 0) uploadRanking(session, hash).catch(() => {});
}

function showRecent() {
  bar('recent');
  const rows = session.recent().map((r, i) => `<button class="row recent" data-i="${i}">
      <span class="dot" data-color="${birds[r.w].c}"></span><span class="nm"><strong>${esc(birds[r.w].n)}</strong> <span class="muted">beat ${esc(birds[r.l].n)}</span></span>
      <span class="muted">Open</span></button>`).join('');
  view.innerHTML = `<h2>Recent picks</h2><p class="muted">Open one of your last 10 picks to see the matchup again and change it.</p>${rows || '<p class="muted">No picks yet.</p>'}`;
  view.querySelectorAll('[data-i]').forEach((b) => b.onclick = () => showReview(+b.dataset.i));
}

function showReview(i) {
  bar('review');
  const r = session.recent()[i];
  if (!r) { showRecent(); return; }
  const [a, b] = [r.w, r.l].sort((x, y) => x - y);
  view.innerHTML = `<h2>Change this pick?</h2><p class="muted">Tap the bird you prefer. Your current pick is marked.</p>
    <div class="duel">${[a, b].map((x) => `<button class="opt${x === r.w ? ' was' : ''}" data-w="${x}">${x === r.w ? '<span class="badge">Your pick</span>' : ''}${cardHTML(birds[x])}</button>`).join('')}</div>
    <div class="actions"><button id="backRecent">Back to recent picks</button></div>`;
  view.querySelectorAll('.opt').forEach((o) => o.onclick = async () => {
    if (+o.dataset.w !== r.w) {
      const pos = session.switchRecent(i);
      if (pos >= 0) await persist(pos);
    }
    showRecent();
  });
  $('backRecent').onclick = showRecent;
}

// Other people's Drive files are read once when the page opens. After that only the current
// user's own picks change the view, until the page is reloaded.
let remote = Promise.resolve(null);
const othersCache = new Map();
async function combined() {
  const snap = await remote;
  if (!othersCache.has(session.nickname)) {
    othersCache.set(session.nickname, snap ? othersAggregate(snap.items, birds.length, session.nickname) : { agg: new Aggregate(birds.length), people: [] });
  }
  const others = othersCache.get(session.nickname);
  const agg = new Aggregate(birds.length);
  agg.merge(others.agg);
  agg.merge(session.agg);
  return { agg, others: others.people, offline: driveEnabled() && !snap };
}

async function showRankings() {
  bar('rank');
  view.innerHTML = '<p class="muted">Loading the rankings…</p>';
  const { agg, others, offline } = await combined();
  const { tiers, order, scores } = rank(agg, undefined, session.excluded());
  const total = order.length;
  const picksTotal = session.count + others.reduce((a, o) => a + o.count, 0);
  const rows = tiers.map((t) => `<div class="tier"><div class="tl" style="background:${TIER_COLOR[t.name]}">${t.name}</div>
      <div class="chips">${t.birds.map((b) => `<button class="chip" data-b="${b}"><span class="dot" data-color="${birds[b].c}"></span>${esc(birds[b].n)}</button>`).join('')}</div>
      <div class="pct">${total ? Math.round((t.birds.length / total) * 100) : 0}%</div></div>`).join('');
  const max = Math.max(1, ...tiers.map((t) => t.birds.length));
  const who = [`you ${session.count}`, ...others.map((o) => `${esc(o.nickname)} ${o.count}`)].join(', ');
  view.innerHTML = `<h2>${others.length ? 'Combined rankings' : 'Your rankings'}</h2>
    <p class="muted">${total} of ${birds.length - session.excluded().size} birds ranked from ${picksTotal} picks${others.length ? ` (${who}). Others' picks are as of when you opened the page; yours update live` : ''}.${picksTotal < birds.length ? ' This is provisional and firms up as you pick.' : ''}${offline ? ' Couldn\'t reach Drive, so only your picks are shown.' : ''}</p>
    <div class="tiers">${rows || '<p class="muted">Make a few picks to see a ranking.</p>'}</div>
    <div class="bars">${tiers.map((t) => `<div style="height:${(t.birds.length / max) * 100}%;background:${TIER_COLOR[t.name]}"></div>`).join('')}</div>
    <div class="bars-l">${TIERS.map(([n]) => `<span>${n}</span>`).join('')}</div>
    <div class="actions"><button id="exp">Export ranking</button>${driveEnabled() ? '<button id="drive">Save to Drive</button>' : ''}<button id="imp">Import ranking</button><button id="sw">Switch user</button></div>
    <p id="driveMsg" class="muted"></p><input id="file" type="file" accept=".birdrank" hidden>`;
  if (driveEnabled()) {
    $('drive').onclick = async () => {
      $('driveMsg').textContent = 'Saving to Drive…';
      try { await uploadRanking(session, hash); $('driveMsg').textContent = 'Saved to Drive.'; }
      catch (e) { $('driveMsg').textContent = `Couldn't save to Drive: ${e.message}`; }
    };
  }
  view.querySelectorAll('[data-b]').forEach((c) => c.onclick = () => showWhy(+c.dataset.b, scores, order, agg));
  $('exp').onclick = onExport;
  $('imp').onclick = () => $('file').click();
  $('file').onchange = onImport;
  $('sw').onclick = showLogin;
}

function showWhy(b, scores, order, agg) {
  const pos = new Map(order.map((x, i) => [x, i]));
  const wins = agg.winsOf(b).sort((x, y) => scores[y[0]] - scores[x[0]]).slice(0, 6);
  const m = $('modal');
  m.innerHTML = `${cardHTML(birds[b])}
    <div class="why"><strong>#${pos.get(b) + 1} of ${order.length}</strong> · ${agg.wins[b]} wins, ${agg.losses[b]} losses
      ${wins.map(([l, c]) => `<div><span>Beat ${esc(birds[l].n)}${c > 1 ? ` ×${c}` : ''}</span><span class="muted">${pos.has(l) ? `#${pos.get(l) + 1}` : 'filtered'}</span></div>`).join('')}</div>
    <div class="actions"><button id="closeM">Close</button></div>`;
  m.showModal();
  $('closeM').onclick = () => m.close();
}

async function onExport() {
  const bytes = await exportBytes(session.header({ birdsDataHash: hash }), session.picks, session.count);
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([bytes]));
  a.download = `bird-ranking-${session.nickname}.birdrank`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

async function onImport(e) {
  const f = e.target.files[0];
  if (!f) return;
  try {
    const { header, picks } = await importBytes(new Uint8Array(await f.arrayBuffer()));
    if (header.birdsDataHash !== hash) throw new Error('This file was made with a different bird list');
    const nick = header.nickname;
    if ((await store.listUsers()).some((u) => u.nickname === nick) && !confirm(`Replace the saved ranking for "${nick}"?`)) return;
    await store.deleteUser(nick);
    await start(nick, { picks, count: picks.length, engineState: header.state });
  } catch (err) {
    alert(`Couldn't import: ${err.message}`);
  }
}

const DEFAULT_FILTERED = ['oceania', 'americas'];
const GROUPS = [
  ['core', 'Base game'], ['european', 'European expansion'], ['oceania', 'Oceania expansion'],
  ['asia', 'Asia expansion'], ['americas', 'Americas expansion'],
  ['promoUS', 'US promo birds (fan-made)'], ['promoCA', 'Canada promo birds (fan-made)'], ['promoUK', 'UK promo birds (fan-made)'],
  ['promoEurope', 'Europe promo birds (fan-made)'], ['promoAsia', 'Asia promo birds (fan-made)'], ['promoNZ', 'New Zealand promo birds (fan-made)'],
];
const groupOf = (b) => b.set;

function showFilters() {
  bar('filters');
  const ex = session.excluded();
  const members = (g) => birds.map((b, i) => (groupOf(b) === g ? i : -1)).filter((i) => i >= 0);
  view.innerHTML = `<h2>Filter expansions</h2>
    <p class="muted">Unchecked sets stop appearing in duels and are hidden from your rankings. Your past picks are kept.</p>
    ${GROUPS.map(([g, label]) => {
      const m = members(g);
      return `<label class="row"><input type="checkbox" data-g="${g}" ${m.every((i) => ex.has(i)) ? '' : 'checked'}>
        <span class="nm">${label}</span><span class="muted">${m.length} birds</span></label>`;
    }).join('')}
    <p id="fmsg" class="muted"></p>`;
  view.querySelectorAll('[data-g]').forEach((c) => c.onchange = async () => {
    const off = new Set(GROUPS.map(([g]) => g).filter((g) => !view.querySelector(`[data-g="${g}"]`).checked));
    const idx = birds.map((b, i) => (off.has(groupOf(b)) ? i : -1)).filter((i) => i >= 0);
    if (birds.length - idx.length < 2) {
      c.checked = true;
      $('fmsg').textContent = 'Keep at least one set selected.';
      return;
    }
    session.setExcluded(idx);
    renderStats();
    await persist(0);
    $('fmsg').textContent = `${birds.length - idx.length} birds in play.`;
  });
}

const wing = { lo: 0, hi: 60, flightlessAsZero: false };
let sel = null; // {kind, key} for a clicked row; null shows the wingspan range result

const cap = (k) => k[0].toUpperCase() + k.slice(1);

function rows(counts, label, kind) {
  const max = Math.max(1, ...counts.map(([, n]) => n));
  return counts.map(([k, n]) => `<div class="srow pick${sel && sel.kind === kind && sel.key === k ? ' on' : ''}" role="button" tabindex="0" data-kind="${kind}" data-key="${k}" style="--w:${(n / max) * 100}%">
    <span class="lab">${label(k)}</span><span class="sn">${n}</span></div>`).join('');
}

function renderStats() {
  const panel = $('stats');
  if (panel.hidden || !session) return;
  const ex = session.excluded();
  const inPlay = birds.filter((_, i) => !ex.has(i));
  const s = collectionStats(inPlay);
  const sum = wingSummary(s.wings);
  const hist = histogram(s.wings, 25);
  const hmax = Math.max(1, ...hist.map((b) => b.n));
  panel.innerHTML = `<div class="odds" id="odds"></div>
    <h3>${s.total} birds in play</h3>
    <div class="cols hab">${rows(HABITATS.map(([k]) => [k, s.habitat[k]]), (k) => { const h = HABITATS.find((x) => x[0] === k); return `${icon(h[2])} ${h[1]}`; }, 'habitat')}</div>
    <div class="cols">
      <div><h3>Food (wild incl.)</h3>${rows(FOODS.map((f) => [f, s.food[f]]), (f) => `${icon(f)} ${cap(f)}`, 'food')}</div>
      <div><h3>Nest</h3>${rows(NESTS.map((n) => [n, s.nest[n]]), (n) => `${nestIcon(n)} ${cap(n)}`, 'nest')}</div>
    </div>
    <h3>Wingspan${sum ? ` <span class="muted">min ${sum.min} · med ${sum.median} · mean ${sum.mean.toFixed(0)} · max ${sum.max} cm</span>` : ''}</h3>
    <div class="hist">${hist.map((b) => `<i style="height:${(b.n / hmax) * 100}%" title="${b.from}-${b.to} cm: ${b.n}"></i>`).join('')}</div>
    <div class="rng"><input type="number" id="wlo" min="0" value="${wing.lo}" aria-label="Lower wingspan"> to <input type="number" id="whi" min="0" value="${wing.hi}" aria-label="Upper wingspan"> cm
      <label class="muted"><input type="checkbox" id="wfl" ${wing.flightlessAsZero ? 'checked' : ''}> flightless = 0 (${s.flightless})</label></div>`;

  const result = () => {
    if (sel) {
      const r = shareOf(inPlay, sel.kind, sel.key);
      const name = sel.kind === 'habitat' ? HABITATS.find((h) => h[0] === sel.key)[1] : cap(sel.key);
      const wildNote = r.wild ? ` (${r.direct} + ${r.wild} wild)` : '';
      $('odds').innerHTML = `<span class="big">${r.pct.toFixed(1)}%</span><span>${r.count} of ${r.total} birds · ${name} ${sel.kind}${wildNote}</span>`;
    } else {
      const r = rangeOdds(s.wings, s.flightless, wing.lo, wing.hi, wing.flightlessAsZero);
      $('odds').innerHTML = `<span class="big">${r.pct.toFixed(1)}%</span><span>${r.inRange} of ${r.total} birds · ${wing.lo}-${wing.hi} cm<br><span class="muted">${r.below} smaller · ${r.above} larger</span></span>`;
    }
  };
  const readInputs = () => {
    wing.lo = Math.max(0, +$('wlo').value || 0);
    wing.hi = +$('whi').value || 0;
    wing.flightlessAsZero = $('wfl').checked;
    sel = null;
    panel.querySelectorAll('.pick.on').forEach((r) => r.classList.remove('on'));
    result();
  };
  ['wlo', 'whi', 'wfl'].forEach((id) => { $(id).oninput = readInputs; });
  result();
  panel.querySelectorAll('.pick').forEach((row) => {
    const toggle = () => {
      const same = sel && sel.kind === row.dataset.kind && sel.key === row.dataset.key;
      sel = same ? null : { kind: row.dataset.kind, key: row.dataset.key };
      renderStats();
    };
    row.onclick = toggle;
    row.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); } };
  });
}

$('btnFilter').onclick = showFilters;
$('btnRank').onclick = showRankings;
$('btnRecent').onclick = showRecent;
$('btnDuel').onclick = showDuel;
document.addEventListener('keydown', (e) => {
  if (!session || $('btnDuel').hidden === false || $('modal').open) return;
  if (e.key === 'z' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); undo(); return; }
  const opts = view.querySelectorAll('.opt');
  if (opts.length === 2 && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) opts[e.key === 'ArrowLeft' ? 0 : 1].click();
});

(async () => {
  ({ birds, hash } = await loadBirds());
  if (driveEnabled()) remote = loadDriveRankings(hash).catch(() => null);
  if (birds.length > MAX_BIRDS) throw new Error('too many birds for the pick format');
  const cur = await store.getCurrent();
  const data = cur && await store.loadUser(cur);
  if (data) await start(cur, data); else showLogin();
})();
