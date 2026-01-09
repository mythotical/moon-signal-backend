// rugrisk.js — live heuristics using Dex pair data + crash/liquidity drain detection
function clamp(n, a, b) { return Math.max(a, Math.min(b, n)); }

export function computeRugRiskFromDexPair(pair, extra = {}) {
  const liqUsd = Number(pair?.liquidity?.usd ?? 0);
  const vol24 = Number(pair?.volume?.h24 ?? 0);
  const fdv = Number(pair?.fdv ?? 0);

  const chg5m = Number(extra.priceChange5m ?? pair?.priceChange?.m5 ?? 0);
  const chg1h = Number(extra.priceChange1h ?? pair?.priceChange?.h1 ?? 0);
  const chg24h = Number(extra.priceChange24h ?? pair?.priceChange?.h24 ?? 0);

  const buys5 = Number(extra.buys5m ?? pair?.txns?.m5?.buys ?? 0);
  const sells5 = Number(extra.sells5m ?? pair?.txns?.m5?.sells ?? 0);
  const t5 = buys5 + sells5;
  const buyRatio5 = t5 > 0 ? buys5 / t5 : 0.5;

  const liqDropPct = Number(extra.liqDropPct ?? 0); // computed in backend state

  let risk = 18;
  const reasons = [];

  // ---- Base liquidity / structure ----
  if (liqUsd < 5000) { risk += 35; reasons.push("EXTREMELY low liquidity"); }
  else if (liqUsd < 10000) { risk += 26; reasons.push("Very low liquidity"); }
  else if (liqUsd < 25000) { risk += 14; reasons.push("Low liquidity"); }
  else reasons.push("Liquidity looks ok");

  if (fdv > 0 && liqUsd > 0) {
    const ratio = fdv / liqUsd;
    if (ratio >= 500) { risk += 22; reasons.push("FDV/LP extreme"); }
    else if (ratio >= 250) { risk += 14; reasons.push("FDV/LP high"); }
  }

  // ---- Crash detection (THIS is what you’re missing) ----
  // Rug-pulls look like: fast negative candles + sell dominance + liquidity drain
  const crash5m = chg5m <= -18;
  const crash1h = chg1h <= -35;
  const crash24 = chg24h <= -70;

  if (crash5m) { risk += 32; reasons.push(`Price crash (5m ${chg5m.toFixed(1)}%)`); }
  if (crash1h) { risk += 28; reasons.push(`Price crash (1h ${chg1h.toFixed(1)}%)`); }
  if (crash24) { risk += 22; reasons.push(`Deep drawdown (24h ${chg24h.toFixed(0)}%)`); }

  // Liquidity drain is a HUGE rug tell
  if (liqDropPct >= 45) { risk += 40; reasons.push(`Liquidity drained (${liqDropPct.toFixed(0)}%)`); }
  else if (liqDropPct >= 30) { risk += 26; reasons.push(`Liquidity dropping (${liqDropPct.toFixed(0)}%)`); }
  else if (liqDropPct >= 18) { risk += 14; reasons.push(`Liquidity slipping (${liqDropPct.toFixed(0)}%)`); }

  // Sell pressure
  if (t5 >= 12 && buyRatio5 <= 0.38) { risk += 18; reasons.push("Sell pressure dominant (5m)"); }
  else if (t5 >= 12 && buyRatio5 >= 0.65) { risk -= 6; reasons.push("Buy pressure dominant (5m)"); }

  // Volume without liquidity support = trap
  if (vol24 >= 300000 && liqUsd < 25000) { risk += 14; reasons.push("High vol without liquidity support"); }

  risk = clamp(risk, 0, 100);

  // Hard rug flag
  const crash = (crash5m || crash1h) && (buyRatio5 <= 0.45 || liqDropPct >= 20);
  const level = risk >= 80 ? "EXTREME" : risk >= 65 ? "HIGH" : risk >= 45 ? "MED" : "LOW";

  return { risk, level, reasons: reasons.slice(0, 6), crash, liqDropPct };
}
