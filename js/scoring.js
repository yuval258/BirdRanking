// Win-count aggregate, weighted scoring and tier assignment. All pure.

const key = (w, l) => w * 65536 + l;

export class Aggregate {
  constructor(n) {
    this.n = n;
    this.pairs = new Map(); // key(winner, loser) -> times winner beat loser
    this.wins = new Uint32Array(n);
    this.losses = new Uint32Array(n);
  }

  add(w, l, d = 1) {
    const k = key(w, l);
    const c = (this.pairs.get(k) || 0) + d;
    if (c > 0) this.pairs.set(k, c);
    else this.pairs.delete(k);
    this.wins[w] += d;
    this.losses[l] += d;
  }

  merge(other) {
    for (const [k, c] of other.pairs) this.add(Math.floor(k / 65536), k % 65536, c);
  }

  // How many times a and b have faced each other, in either direction.
  meetings(a, b) {
    return (this.pairs.get(key(a, b)) || 0) + (this.pairs.get(key(b, a)) || 0);
  }

  matches(b) {
    return this.wins[b] + this.losses[b];
  }

  // [[loser, count], ...] for everyone `b` beat
  winsOf(b) {
    const out = [];
    for (const [k, c] of this.pairs) if (Math.floor(k / 65536) === b) out.push([k % 65536, c]);
    return out;
  }
}

// A win is worth the loser's own strength (plus a small base), so beating a bird that
// itself keeps winning counts for more than beating one that never wins. The prior pulls
// birds with few matches toward zero so a lucky streak can't top the list.
export function computeScores(agg, { base = 0.1, prior = 2, iters = 25 } = {}) {
  const { n } = agg;
  const beat = Array.from({ length: n }, () => []);
  for (const [k, c] of agg.pairs) beat[Math.floor(k / 65536)].push([k % 65536, c]);
  let q = new Float64Array(n);
  for (let b = 0; b < n; b++) q[b] = agg.wins[b] / (agg.matches(b) + prior);
  for (let it = 0; it < iters; it++) {
    const next = new Float64Array(n);
    for (let b = 0; b < n; b++) {
      let s = 0;
      for (const [l, c] of beat[b]) s += c * (base + q[l]);
      next[b] = s / (agg.matches(b) + prior);
    }
    q = next;
  }
  return q;
}

export const TIERS = [['S', 0.02], ['A', 0.1], ['B', 0.3], ['C', 0.3], ['D', 0.2], ['F', 0.08]];

// Only birds with at least one match, and not filtered out, are ranked. Best first.
// Filtered birds' past wins and losses still count toward everyone else's scores.
export function rank(agg, opts, exclude = null) {
  const q = computeScores(agg, opts);
  const order = [];
  for (let b = 0; b < agg.n; b++) if (agg.matches(b) > 0 && !(exclude && exclude.has(b))) order.push(b);
  order.sort((a, b) => q[b] - q[a] || a - b);
  const tiers = TIERS.map(([name]) => ({ name, birds: [] }));
  let cum = 0;
  const bounds = TIERS.map(([, share]) => (cum += share));
  order.forEach((b, r) => {
    const pos = (r + 0.5) / order.length;
    let t = bounds.findIndex((x) => pos <= x);
    if (t < 0) t = TIERS.length - 1;
    tiers[t].birds.push(b);
  });
  return { scores: q, order, tiers };
}
