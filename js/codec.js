// Compact pick storage: one pick = winner<<16 | loser in memory, 3 bytes (12 bits each)
// on disk and in export files, gzip-compressed when the browser supports it.

export const MAX_BIRDS = 4096;
const MAGIC = [0x42, 0x52, 0x4b, 0x31]; // "BRK1"

export const pack = (w, l) => ((w << 16) | l) >>> 0;
export const winnerOf = (p) => p >>> 16;
export const loserOf = (p) => p & 0xffff;

export function encodePicks(picks, count) {
  const out = new Uint8Array(count * 3);
  for (let i = 0; i < count; i++) {
    const v = (winnerOf(picks[i]) << 12) | loserOf(picks[i]);
    out[i * 3] = v & 255;
    out[i * 3 + 1] = (v >> 8) & 255;
    out[i * 3 + 2] = v >> 16;
  }
  return out;
}

export function decodePicks(bytes) {
  const count = Math.floor(bytes.length / 3);
  const picks = new Uint32Array(count);
  for (let i = 0; i < count; i++) {
    const v = bytes[i * 3] | (bytes[i * 3 + 1] << 8) | (bytes[i * 3 + 2] << 16);
    picks[i] = pack(v >> 12, v & 4095);
  }
  return picks;
}

export function buildFile(header, picks, count) {
  const head = new TextEncoder().encode(JSON.stringify({ ...header, pickCount: count }));
  const body = encodePicks(picks, count);
  const out = new Uint8Array(8 + head.length + body.length);
  out.set(MAGIC, 0);
  new DataView(out.buffer).setUint32(4, head.length, true);
  out.set(head, 8);
  out.set(body, 8 + head.length);
  return out;
}

export function parseFile(bytes) {
  if (MAGIC.some((m, i) => bytes[i] !== m)) throw new Error('Not a bird ranking file');
  const len = new DataView(bytes.buffer, bytes.byteOffset).getUint32(4, true);
  const header = JSON.parse(new TextDecoder().decode(bytes.subarray(8, 8 + len)));
  const picks = decodePicks(bytes.subarray(8 + len));
  if (picks.length !== header.pickCount) throw new Error('Ranking file is truncated');
  return { header, picks };
}

async function pipe(bytes, stream) {
  const buf = await new Response(new Blob([bytes]).stream().pipeThrough(stream)).arrayBuffer();
  return new Uint8Array(buf);
}

export async function compress(bytes) {
  return typeof CompressionStream === 'undefined' ? bytes : pipe(bytes, new CompressionStream('gzip'));
}

export async function decompress(bytes) {
  if (bytes[0] !== 0x1f || bytes[1] !== 0x8b) return bytes;
  return pipe(bytes, new DecompressionStream('gzip'));
}

export async function exportBytes(header, picks, count) {
  return compress(buildFile(header, picks, count));
}

export async function importBytes(bytes) {
  return parseFile(await decompress(bytes));
}

export function bytesToB64(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

export function b64ToBytes(b64) {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}
