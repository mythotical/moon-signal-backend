// rugrisk.js — lightweight heuristics (not perfect, but useful)
export function computeRugRiskFromDexPair(pair) {
  const liqUsd = Number(pair?.liquidity?.usd ?? 0);
  const vol24 = Number(pair?.volume?.h24 ?? 0);
  const fdv = Number(pair?.fdv ?? 0);

  let risk = 25;
  const reasons = [];

  if (liqUsd < 10000) { risk += 30; reasons.push("Very low liquidity"); }
  else if (liqUsd < 25000) { risk += 18; reasons.push("Low liquidity"); }
  else reasons.push("Liquidity looks ok");

  if (fdv > 0 && liqUsd > 0) {
    const ratio = fdv / liqUsd;
    if (ratio >= 400) { risk += 22; reasons.push("FDV/LP extremely high"); }
    else if (ratio >= 200) { risk += 14; reasons.push("FDV/LP high"); }
  }

  // volume without liquidity can be a trap (counts toward risk too)
  if (vol24 >= 300000 && liqUsd < 25000) {
    risk += 15;
    reasons.push("High vol without liquidity support");
  }

  risk = Math.max(0, Math.min(100, risk));

  // "Hard" rug conditions (heuristic). Real hard-fails will be added in Phase 2 (LP lock/ownership, taxes, etc).
  const hardFail =
    risk >= 85 ||
    liqUsd < 5000 ||
    (fdv > 0 && liqUsd > 0 && fdv / liqUsd > 500);

  const level =
    hardFail ? "HARD" :
    risk >= 65 ? "HIGH" :
    risk >= 45 ? "MED" : "LOW";

  return { risk, level, hardFail, reasons };
}
