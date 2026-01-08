function clamp(n, a, b) { return Math.max(a, Math.min(b, n)); }
function toNumOrNull(x) { const n = Number(x); return Number.isFinite(n) ? n : null; }

export function computeRugRiskFromDexPair(pair) {
  const liq = Number(pair?.liquidity?.usd ?? 0);
  const vol24 = Number(pair?.volume?.h24 ?? 0);
  const fdv = Number(pair?.fdv ?? 0);
  const mcap = Number(pair?.marketCap ?? 0);
  const pc1h = toNumOrNull(pair?.priceChange?.h1);
  const pc24h = toNumOrNull(pair?.priceChange?.h24);

  const createdAt = toNumOrNull(pair?.pairCreatedAt);
  const ageMin = createdAt ? Math.max(1, Math.round((Date.now() - createdAt) / 60000)) : null;

  const buys1h = Number(pair?.txns?.h1?.buys ?? 0);
  const sells1h = Number(pair?.txns?.h1?.sells ?? 0);

  const reasons = [];
  let risk = 0;

  if (liq <= 1000) { risk += 35; reasons.push("Very low liquidity"); }
  else if (liq <= 5000) { risk += 25; reasons.push("Low liquidity"); }
  else if (liq <= 20000) { risk += 15; reasons.push("Thin liquidity"); }
  else { risk += 5; reasons.push("Liquidity OK"); }

  const cap = fdv || mcap || 0;
  if (cap > 0 && liq > 0) {
    const ratio = cap / liq;
    if (ratio >= 200) { risk += 25; reasons.push("FDV/liquidity extremely high"); }
    else if (ratio >= 100) { risk += 18; reasons.push("FDV/liquidity very high"); }
    else if (ratio >= 50) { risk += 12; reasons.push("FDV/liquidity high"); }
    else { risk += 4; reasons.push("FDV/liquidity reasonable"); }
  } else {
    risk += 8;
    reasons.push("FDV/MCAP missing");
  }

  if (liq > 0) {
    const vRatio = vol24 / liq;
    if (vRatio >= 20) { risk += 18; reasons.push("Volume/liquidity suspiciously high"); }
    else if (vRatio >= 10) { risk += 12; reasons.push("Volume/liquidity very high"); }
    else if (vRatio >= 5) { risk += 8; reasons.push("Volume/liquidity high"); }
    else { risk += 3; reasons.push("Volume/liquidity normal"); }
  }

  if (typeof pc1h === "number") {
    if (pc1h >= 300) { risk += 14; reasons.push("1h pump extreme"); }
    else if (pc1h >= 150) { risk += 10; reasons.push("1h pump large"); }
    else if (pc1h <= -60) { risk += 10; reasons.push("1h dump large"); }
  } else {
    risk += 3;
    reasons.push("1h change missing");
  }

  if (typeof pc24h === "number") {
    if (pc24h >= 800) { risk += 10; reasons.push("24h pump extreme"); }
    else if (pc24h <= -85) { risk += 10; reasons.push("24h dump extreme"); }
  }

  if (typeof ageMin === "number") {
    if (ageMin <= 10) { risk += 18; reasons.push("Pair is extremely new"); }
    else if (ageMin <= 60) { risk += 12; reasons.push("Pair is new"); }
    else if (ageMin <= 240) { risk += 6; reasons.push("Pair is recent"); }
    else { risk += 2; reasons.push("Pair age OK"); }
  } else {
    risk += 6;
    reasons.push("Pair age unknown");
  }

  const total1h = buys1h + sells1h;
  if (total1h >= 10) {
    const sellShare = sells1h / Math.max(1, total1h);
    if (sellShare >= 0.65) { risk += 10; reasons.push("Sell pressure high (1h)"); }
    else if (sellShare <= 0.25) { risk -= 4; reasons.push("Buy pressure strong (1h)"); }
  }

  risk = Math.round(clamp(risk, 0, 100));
  const level =
    risk >= 80 ? "EXTREME" :
    risk >= 65 ? "HIGH" :
    risk >= 45 ? "MED" :
    risk >= 25 ? "LOW" : "MIN";

  return { risk, level, reasons };
}
