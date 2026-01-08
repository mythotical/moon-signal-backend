// velocity.js
// Tracks social velocity over time and computes acceleration (rising trend).

export function createVelocityTracker({ windowSize = 10 } = {}) {
  const samples = []; // [{ts, v}]

  function push(v) {
    const n = Math.max(0, Math.min(100, Number(v || 0)));
    samples.push({ ts: Date.now(), v: n });
    while (samples.length > windowSize) samples.shift();
  }

  function current() {
    return samples.length ? samples[samples.length - 1].v : 0;
  }

  // Returns true if velocity is rising across last 3 samples
  function isRising({ minDelta = 6, minNow = 20 } = {}) {
    if (samples.length < 3) return false;
    const a = samples[samples.length - 3].v;
    const b = samples[samples.length - 2].v;
    const c = samples[samples.length - 1].v;

    // rising pattern + enough delta
    return c >= minNow && (b >= a) && (c >= b) && ((c - a) >= minDelta);
  }

  function slope() {
    if (samples.length < 2) return 0;
    const first = samples[0].v;
    const last = samples[samples.length - 1].v;
    return last - first; // simple slope
  }

  function debug() {
    return samples.slice();
  }

  return { push, current, isRising, slope, debug };
}
