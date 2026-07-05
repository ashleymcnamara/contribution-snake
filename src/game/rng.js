// Deterministic PRNG (mulberry32). The same seed must produce the same game
// on the client and on the server replay validator — never use Math.random()
// inside game logic.
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function randomSeed() {
  // Non-deterministic on purpose: used only to *pick* a seed for offline play.
  return (Math.random() * 0x7fffffff) | 0;
}
