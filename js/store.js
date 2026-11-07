// IndexedDB persistence. Picks live in fixed-size chunks so each pick rewrites one small
// record; localStorage's string limit can't hold a long ranking history.
const DB = 'birdranker';
const CHUNK = 2048;

const open = () => new Promise((res, rej) => {
  const r = indexedDB.open(DB, 1);
  r.onupgradeneeded = () => {
    r.result.createObjectStore('users', { keyPath: 'nickname' });
    r.result.createObjectStore('chunks');
    r.result.createObjectStore('meta');
  };
  r.onsuccess = () => res(r.result);
  r.onerror = () => rej(r.error);
});

const req = (r) => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
const done = (tx) => new Promise((res, rej) => { tx.oncomplete = res; tx.onerror = () => rej(tx.error); tx.onabort = () => rej(tx.error); });

let dbp;
const db = () => (dbp ||= open());

export async function listUsers() {
  const d = await db();
  const users = await req(d.transaction('users').objectStore('users').getAll());
  return users.map((u) => ({ nickname: u.nickname, count: u.count })).sort((a, b) => a.nickname.localeCompare(b.nickname));
}

export async function getCurrent() {
  const d = await db();
  return (await req(d.transaction('meta').objectStore('meta').get('current'))) || null;
}

export async function setCurrent(nickname) {
  const d = await db();
  const tx = d.transaction('meta', 'readwrite');
  tx.objectStore('meta').put(nickname, 'current');
  await done(tx);
}

export async function loadUser(nickname) {
  const d = await db();
  const user = await req(d.transaction('users').objectStore('users').get(nickname));
  if (!user) return null;
  const picks = new Uint32Array(user.count);
  const store = d.transaction('chunks').objectStore('chunks');
  for (let c = 0; c * CHUNK < user.count; c++) {
    const chunk = await req(store.get(`${nickname}:${c}`));
    if (chunk) picks.set(chunk.subarray(0, Math.min(CHUNK, user.count - c * CHUNK)), c * CHUNK);
  }
  return { nickname, picks, count: user.count, engineState: user.state };
}

// Rewrites only the chunks touched since `dirtyFrom`, plus the small state record.
export async function saveUser(session, dirtyFrom) {
  const d = await db();
  const tx = d.transaction(['users', 'chunks'], 'readwrite');
  const chunks = tx.objectStore('chunks');
  const last = Math.floor((session.count - 1) / CHUNK);
  for (let c = Math.floor(dirtyFrom / CHUNK); c <= last; c++) {
    const end = Math.min(session.count, (c + 1) * CHUNK);
    chunks.put(session.picks.slice(c * CHUNK, end), `${session.nickname}:${c}`);
  }
  tx.objectStore('users').put({
    nickname: session.nickname, count: session.count, state: session.engine.serialize(), updated: Date.now(),
  });
  await done(tx);
}

export async function deleteUser(nickname) {
  const d = await db();
  const user = await req(d.transaction('users').objectStore('users').get(nickname));
  const tx = d.transaction(['users', 'chunks'], 'readwrite');
  for (let c = 0; user && c * CHUNK < user.count; c++) tx.objectStore('chunks').delete(`${nickname}:${c}`);
  tx.objectStore('users').delete(nickname);
  await done(tx);
}
