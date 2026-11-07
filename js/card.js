// Renders a bird as a Wingspan-style card using the icon and power-strip art that
// Wingsearch (GPL-3.0, github.com/navarog/wingsearch) hosts.
const ASSETS = 'https://navarog.github.io/wingsearch/assets';
export const icon = (name, cls = '') =>
  `<img class="ic ${cls}" src="${ASSETS}/icons/png/${name}.webp" alt="${name}" loading="lazy">`;

// The star-in-a-circle icon is the wild nest; the file named `wild` is the wild food icon.
export const nestIcon = (n) => (n === 'none' ? '' : icon(n === 'wild' ? 'star' : n));

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const HABITATS = { F: 'forest', G: 'grassland', W: 'wetland' };
const POWER_LABEL = {
  brown: 'When activated', white: 'When played', pink: 'Once between turns', yellow: 'Game end', teal: 'Round end',
};

// Icons inside the colored power strips use the glow variants where Wingsearch has them; the
// plain seed icon is the same orange as the brown strip and disappears, so it gets the dark one.
const GLOW = new Set(['fish', 'forest', 'fruit', 'grassland', 'invertebrate', 'nectar', 'rodent', 'wetland', 'wild']);
const strip = (n) => (n === 'seed' ? 'seed-dark-glow' : GLOW.has(n) ? `${n}-glow` : n);
const powerText = (t) => esc(t).replace(/\[([a-z_]+)\]/g, (_, n) => icon(strip(n), 'inline'));

function foodCost(b) {
  const icons = b.f.flatMap(([name, n]) => Array(n).fill(icon(name)));
  if (!icons.length) return icon('no-food');
  return icons.join(`<span class="op">${b.or ? '/' : '+'}</span>`);
}

// Scales the power text to fill its block: short powers get big type, the longest still fit.
function powerSize(b) {
  const len = (b.p || '').replace(/\[[a-z_]+\]/g, '#').length + POWER_LABEL[b.c].length + 2;
  return Math.min(7, Math.max(3.8, Math.sqrt(3300 / len))).toFixed(2);
}

export function cardHTML(b) {
  const color = b.c || 'none';
  const power = b.c
    ? `<div class="power" style="background-image:url(${ASSETS}/powers/${b.c}.webp);font-size:${powerSize(b)}cqw"><div><b>${POWER_LABEL[b.c]}:</b> ${powerText(b.p)}</div></div>`
    : '<div class="power nopower">No power</div>';
  return `<div class="wcard" data-color="${color}" style="--art:url(${ASSETS}/cards/birds/${b.id}.webp)">
    <div class="tan"><div class="habs">${b.h.map((h) => icon(HABITATS[h])).join('')}</div><div class="food">${foodCost(b)}</div></div>
    <div class="namebox"><div class="cname">${esc(b.n)}</div><div class="csci">${esc(b.s)}</div></div>
    <div class="side">
      <div class="pts">${icon('point', 'feather')}<span>${b.v}</span></div>
      <div class="nest">${nestIcon(b.nest)}</div>
      <div class="eggs">${icon('smallegg').repeat(b.e)}</div>
    </div>
    <div class="wing">${b.w == null || b.w === '*' ? '*' : `${b.w}<small>CM</small>`}${icon('wingspan')}</div>
    ${power}
    <div class="cfoot"><span>${esc(b.set.replace(/^promo/, 'promo '))}</span><span class="tags">${b.pr ? icon('predator') : ''}${b.fl ? icon('flocking') : ''}</span></div>
  </div>`;
}
