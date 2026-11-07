// Pairing engine. Rounds and cycles are internal; the UI only ever sees the next pair.
// A cycle pairs up its pool so each bird shows once; winners form the next cycle's pool.
// When one bird is left, a new round starts with every bird in fresh random pairs.

export const RECENT_LIMIT = 10;

export function shuffle(a, rng = Math.random) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export class Engine {
  constructor(n, rng = Math.random, saved = null, met = () => 0) {
    this.n = n;
    this.rng = rng;
    this.met = met; // met(a, b): how many times a and b have already faced each other
    if (saved && saved.n === n) {
      Object.assign(this, {
        queue: saved.queue, winners: saved.winners, cycleId: saved.cycleId, recent: saved.recent,
        excluded: new Set(saved.excluded || []),
      });
    } else {
      this.excluded = new Set();
      this.queue = [];
      this.winners = [];
      this.cycleId = 0;
      this.recent = []; // newest first: {w, l, c}
    }
    this.#advance();
  }

  current() {
    return this.queue[0] || null;
  }

  pick(winner) {
    const pair = this.queue[0];
    if (!pair || !pair.includes(winner)) throw new Error('winner is not in the current pair');
    this.queue.shift();
    const loser = pair[0] === winner ? pair[1] : pair[0];
    // p and end let undoLast rebuild the state from before this pick.
    const entry = { w: winner, l: loser, c: this.cycleId, p: [pair[0], pair[1]] };
    if (this.queue.length === 0) entry.end = [...this.winners];
    this.winners.push(winner);
    this.recent.unshift(entry);
    this.recent.length = Math.min(this.recent.length, RECENT_LIMIT);
    this.#advance();
    return { w: winner, l: loser };
  }

  // Removes the newest pick entirely and puts its matchup back as the current one.
  // Returns null when there is nothing to undo or the matchup holds a filtered bird.
  undoLast() {
    const r = this.recent[0];
    if (!r) return null;
    const pair = r.p || [r.w, r.l];
    if (pair.some((b) => this.excluded.has(b))) return null;
    if (r.c === this.cycleId) {
      const i = this.winners.lastIndexOf(r.w);
      if (i >= 0) this.winners.splice(i, 1);
    } else {
      // The pick closed its cycle, so the next cycle was built from its winners.
      let prev = r.end;
      if (!prev) {
        const pool = [...this.queue.flat(), ...this.winners];
        const everyone = this.n - this.excluded.size;
        prev = pool.length === everyone ? [] : pool.filter((b) => b !== r.w);
      }
      this.winners = prev.filter((b) => !this.excluded.has(b));
      this.cycleId = r.c;
      this.queue = [];
    }
    this.queue.unshift([pair[0], pair[1]]);
    this.recent.shift();
    return { w: r.w, l: r.l };
  }

  // Flips a recent pick (0 = newest). The new winner takes the old winner's place in the
  // pool when that place still exists; otherwise only the record changes.
  switchRecent(i) {
    const r = this.recent[i];
    if (!r) return null;
    const oldW = r.w;
    const newW = r.l;
    const inPool = (b) => this.winners.includes(b) || this.queue.some((p) => p.includes(b));
    if ((r.c === this.cycleId || r.c === this.cycleId - 1) && !inPool(newW)) {
      const wi = this.winners.indexOf(oldW);
      if (wi >= 0) {
        this.winners[wi] = newW;
      } else {
        const pair = this.queue.find((p) => p.includes(oldW));
        if (pair) pair[pair.indexOf(oldW)] = newW;
      }
    }
    r.w = newW;
    r.l = oldW;
    return { oldW, oldL: newW, newW, newL: oldW };
  }

  // Drops filtered birds from the pending cycle. A bird whose opponent was dropped has not
  // finished the cycle, so it is re-paired with other such birds (a lone one gets a bye).
  // Birds that become included again join at the next round start.
  setExcluded(indices) {
    this.excluded = new Set(indices);
    const ok = (b) => !this.excluded.has(b);
    this.winners = this.winners.filter(ok);
    const kept = [];
    const orphans = [];
    for (const pair of this.queue) {
      if (pair.every(ok)) kept.push(pair);
      else orphans.push(...pair.filter(ok));
    }
    const { pairs, bye } = this.#pairUp(orphans);
    if (bye !== null) this.winners.push(bye);
    this.queue = kept.concat(pairs);
    this.#advance();
  }

  serialize() {
    return {
      n: this.n, queue: this.queue, winners: this.winners, cycleId: this.cycleId, recent: this.recent,
      excluded: [...this.excluded],
    };
  }

  #advance() {
    while (this.queue.length === 0) {
      const pool = this.winners.length >= 2
        ? this.winners
        : Array.from({ length: this.n }, (_, i) => i).filter((b) => !this.excluded.has(b));
      this.#startCycle(pool);
    }
  }

  #startCycle(pool) {
    this.cycleId++;
    const { pairs, bye } = this.#pairUp(pool);
    this.queue = pairs;
    this.winners = bye === null ? [] : [bye]; // odd bird out advances on a bye
  }

  // Pairs birds so nobody meets the same opponent twice while an unmet partner exists.
  // Greedy: each bird takes an unmet partner if one is left, otherwise the least-met one,
  // which is how rematches are allowed once everyone in the pool has faced everyone else.
  // A few random restarts avoid greedy dead ends; the cheapest pairing wins.
  #pairUp(birds) {
    const pool = shuffle([...birds], this.rng);
    const bye = pool.length % 2 ? pool.pop() : null;
    const attempts = pool.length > 200 ? 3 : 8;
    let best = null;
    for (let t = 0; t < attempts; t++) {
      const order = shuffle([...pool], this.rng);
      const used = new Set();
      const pairs = [];
      let cost = 0;
      for (const a of order) {
        if (used.has(a)) continue;
        used.add(a);
        let pick = -1;
        let low = Infinity;
        for (const b of order) {
          if (used.has(b)) continue;
          const m = this.met(a, b);
          if (m < low) { low = m; pick = b; }
          if (m === 0) break;
        }
        used.add(pick);
        pairs.push(this.rng() < 0.5 ? [a, pick] : [pick, a]);
        cost += low * low;
      }
      if (!best || cost < best.cost) best = { pairs, cost };
      if (cost === 0) break;
    }
    return { pairs: best ? best.pairs : [], bye };
  }
}
