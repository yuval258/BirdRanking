export async function loadBirds() {
  const text = await (await fetch('data/birds.json')).text();
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193) >>> 0;
  return { birds: JSON.parse(text), hash: h.toString(16).padStart(8, '0') };
}
