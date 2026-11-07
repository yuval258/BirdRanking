// Collection statistics over a list of birds. Pure.
export const HABITATS = [['F', 'Forest', 'forest'], ['G', 'Grassland', 'grassland'], ['W', 'Wetland', 'wetland']];
export const FOODS = ['invertebrate', 'seed', 'fish', 'fruit', 'rodent', 'nectar', 'wild'];
export const NESTS = ['bowl', 'cavity', 'ground', 'platform', 'wild', 'none'];

export function collectionStats(birds) {
  const habitat = Object.fromEntries(HABITATS.map(([k]) => [k, 0]));
  const food = Object.fromEntries(FOODS.map((f) => [f, 0]));
  const nest = Object.fromEntries(NESTS.map((n) => [n, 0]));
  const wings = [];
  let flightless = 0;
  for (const b of birds) {
    for (const h of b.h) habitat[h]++;
    for (const [f] of b.f) food[f]++;
    nest[b.nest]++;
    if (typeof b.w === 'number' && b.w > 0) wings.push(b.w);
    else flightless++; // wingspan "*" in the card data
  }
  wings.sort((a, b) => a - b);
  return { total: birds.length, habitat, food, nest, wings, flightless };
}

export function wingSummary(wings) {
  if (!wings.length) return null;
  const mid = wings.length >> 1;
  return {
    min: wings[0],
    max: wings[wings.length - 1],
    mean: wings.reduce((a, b) => a + b, 0) / wings.length,
    median: wings.length % 2 ? wings[mid] : (wings[mid - 1] + wings[mid]) / 2,
  };
}

// Share of birds whose wingspan is in [lo, hi] (inclusive). Flightless birds count as
// 0 cm only when `flightlessAsZero` is set; otherwise they are outside the sample.
export function rangeOdds(wings, flightless, lo, hi, flightlessAsZero = false) {
  const total = wings.length + (flightlessAsZero ? flightless : 0);
  let inRange = wings.filter((w) => w >= lo && w <= hi).length;
  let below = wings.filter((w) => w < lo).length;
  const above = wings.filter((w) => w > hi).length;
  if (flightlessAsZero) {
    if (lo <= 0 && hi >= 0) inRange += flightless;
    else if (lo > 0) below += flightless;
  }
  return { total, inRange, below, above, pct: total ? (inRange / total) * 100 : 0 };
}

export function histogram(wings, bucket = 25) {
  const top = wings.length ? Math.ceil((wings[wings.length - 1] + 1) / bucket) : 0;
  const bins = Array.from({ length: top }, (_, i) => ({ from: i * bucket, to: (i + 1) * bucket - 1, n: 0 }));
  for (const w of wings) bins[Math.floor(w / bucket)].n++;
  return bins;
}

// Share of birds matching one attribute. Wild nests and wild food costs act as wildcards,
// so they count toward every nest type / every food (but not toward "none" or each other).
export function shareOf(birds, kind, key) {
  let direct = 0;
  let wild = 0;
  for (const b of birds) {
    const own = kind === 'habitat' ? b.h.includes(key)
      : kind === 'food' ? b.f.some(([f]) => f === key)
        : b.nest === key;
    const wildcard = kind === 'food' ? b.f.some(([f]) => f === 'wild')
      : kind === 'nest' ? b.nest === 'wild'
        : false;
    if (own) direct++;
    else if (wildcard && key !== 'wild' && key !== 'none') wild++;
  }
  const count = direct + wild;
  return { count, direct, wild, total: birds.length, pct: birds.length ? (count / birds.length) * 100 : 0 };
}
