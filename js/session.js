// One user's ranking state: picks buffer, win aggregate and pairing engine.
import { Engine } from './engine.js';
import { Aggregate } from './scoring.js';
import { pack, winnerOf, loserOf } from './codec.js';

export class Session {
  constructor(n, { nickname, picks = new Uint32Array(0), count = picks.length, engineState = null } = {}, rng) {
    this.n = n;
    this.nickname = nickname;
    this.picks = picks;
    this.count = count;
    this.agg = new Aggregate(n);
    for (let i = 0; i < count; i++) this.agg.add(winnerOf(picks[i]), loserOf(picks[i]));
    this.engine = new Engine(n, rng, engineState, (a, b) => this.agg.meetings(a, b));
  }

  pair() {
    return this.engine.current();
  }

  // Returns the index of the appended pick.
  pick(winner) {
    const pair = this.engine.current();
    if (!pair.includes(winner)) throw new Error('winner is not in the current pair');
    // Count the meeting before the engine may build the next cycle from it.
    this.agg.add(winner, pair[0] === winner ? pair[1] : pair[0]);
    const { w, l } = this.engine.pick(winner);
    if (this.count === this.picks.length) {
      const grown = new Uint32Array(Math.max(1024, this.picks.length * 2));
      grown.set(this.picks);
      this.picks = grown;
    }
    this.picks[this.count] = pack(w, l);
    return this.count++;
  }

  // Flips the i-th most recent pick (0 = newest). Returns the changed buffer index.
  switchRecent(i) {
    const r = this.engine.switchRecent(i);
    if (!r) return -1;
    const pos = this.count - 1 - i;
    this.picks[pos] = pack(r.newW, r.newL);
    this.agg.add(r.oldW, r.oldL, -1);
    this.agg.add(r.newW, r.newL, 1);
    return pos;
  }

  setExcluded(indices) {
    this.engine.setExcluded(indices);
  }

  excluded() {
    return this.engine.excluded;
  }

  // Drops the newest pick and re-opens its matchup. Returns false when nothing can be undone.
  undo() {
    const r = this.engine.undoLast();
    if (!r) return false;
    this.agg.add(r.w, r.l, -1);
    this.count--;
    return true;
  }

  canUndo() {
    return this.engine.recent.length > 0;
  }

  recent() {
    return this.engine.recent.map((r) => ({ w: r.w, l: r.l }));
  }

  header(extra) {
    return { version: 1, nickname: this.nickname, ...extra, state: this.engine.serialize() };
  }
}
