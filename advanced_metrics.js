function clamp(n, a, b) { return Math.max(a, Math.min(b, n)); }

export function createConvergenceTracker({ windowMs = 12 * 60 * 1000 } = {}) {
  // token -> [{ wallet, tier, ts }]
  const hits = new Map();

  function note({ token, wallet, tier }) {
    if (!token || !wallet || !tier) return;
    const t = String(token).toUpperCase();
    const arr = hits.get(t) || [];
    arr.unshift({ wallet, tier, ts: Date.now() });
    hits.set(t, arr);
    pruneToken(t);
  }

  function pruneToken(token) {
    const arr = hits.get(token);
    if (!arr) return;
    const cutoff = Date.now() - windowMs;
    const next = arr.filter(x => x.ts >= cutoff);
    if (next.length) hits.set(token, next);
    else hits.delete(token);
  }

  function get(token) {
    const t = String(token || "").toUpperCase();
    pruneToken(t);
    const arr = hits.get(t) || [];

    const uniqS = new Set();
    const uniqA = new Set();

    for (const x of arr) {
      if (x.tier === "S") uniqS.add(x.wallet);
      if (x.tier === "A") uniqA.add(x.wallet);
    }

    const sCount = uniqS.size;
    const aCount = uniqA.size;
    const total = new Set([...uniqS, ...uniqA]).size;

    let strength = 0;
    strength += sCount * 45;
    strength += aCount * 18;
    strength = clamp(strength, 0, 100);

    const status =
      sCount >= 2 ? "STRONG" :
      (sCount >= 1 && aCount >= 2) ? "STRONG" :
      (sCount >= 1 || aCount >= 2) ? "MED" :
      (total >= 1) ? "WEAK" : "NONE";

    return { token: t, status, strength, sCount, aCount, total };
  }

  function listTop(limit = 30) {
    const out = [];
    for (const token of hits.keys()) {
      const g = get(token);
      if (g.total > 0) out.push(g);
    }
    out.sort((a, b) => (b.strength - a.strength) || (b.total - a.total));
    return out.slice(0, limit);
  }

  return { note, get, listTop };
}

export function computeLiquidityTrap({ dexLiquidityUsd, dexVolume24hUsd }) {
  const liq = Number(dexLiquidityUsd ?? 0);
  const vol = Number(dexVolume24hUsd ?? 0);

  const trap =
    (vol >= 300000 && liq < 25000) ||
    (vol >= 600000 && liq < 50000);

  let severity = "LOW";
  if (trap && vol >= 600000 && liq < 50000) severity = "HIGH";
  else if (trap) severity = "MED";

  const ratio = liq > 0 ? (vol / liq) : 9999;

  return {
    trap,
    severity,
    ratio: Number.isFinite(ratio) ? Number(ratio.toFixed(2)) : null,
    reason: trap ? "High volume without liquidity support (possible trap)" : "No obvious trap"
  };
}

export function computeEntryZone({ priceChange1h, priceChange24h }) {
  const ch1h = Number(priceChange1h ?? 0);
  const ch24 = Number(priceChange24h ?? 0);

  const chase = ch1h >= 25 || (ch1h >= 18 && ch24 >= 80);
  const early = ch1h <= 8 && ch24 <= 45;

  let zone = "NEUTRAL";
  if (chase) zone = "CHASE";
  else if (early) zone = "EARLY";

  let entryScore = 60;
  if (early) entryScore = 82;
  if (zone === "NEUTRAL") entryScore = 62;
  if (zone === "CHASE") entryScore = 30;

  return {
    zone,
    entryScore,
    reason:
      zone === "CHASE" ? "Overextended — chase risk" :
      zone === "EARLY" ? "Early move — better RR" :
      "Mixed conditions"
  };
}
