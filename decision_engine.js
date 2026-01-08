// decision_engine.js
// Turns overlay metrics into an "APE / WAIT" decision with explainable reasons.
// This is heuristic-based (MVP). You can tune thresholds later.

function clamp(n, a, b) { return Math.max(a, Math.min(b, n)); }

export function computeDecision(overlay) {
  const score = Number(overlay?.score ?? 0);
  const rug = Number(overlay?.rug?.risk ?? 0);
  const liq = Number(overlay?.dexLiquidityUsd ?? 0);
  const vol = Number(overlay?.dexVolume24hUsd ?? 0);
  const ch1h = Number(overlay?.priceChange1h ?? 0);
  const rising = overlay?.rising === true;
  const breakout = overlay?.breakout === true;

  const reasons = [];
  let confidence = 50;

  // Rug gating
  if (rug >= 80) {
    return {
      action: "WAIT",
      confidence: 95,
      severity: "EXTREME",
      reasons: ["EXTREME rug risk — do not ape", ...((overlay?.rug?.reasons || []).slice(0, 3))],
      tags: ["RUG:EXTREME"]
    };
  }
  if (rug >= 65) {
    confidence -= 18;
    reasons.push("High rug risk — size down / avoid");
  } else if (rug <= 35) {
    confidence += 10;
    reasons.push("Rug risk looks reasonable");
  }

  // Score
  if (score >= 85) { confidence += 18; reasons.push("Alpha score very high"); }
  else if (score >= 78) { confidence += 10; reasons.push("Alpha score high"); }
  else if (score < 60) { confidence -= 12; reasons.push("Alpha score low"); }

  // Momentum and confirmation
  if (rising) { confidence += 10; reasons.push("Social velocity accelerating"); }
  else { confidence -= 6; reasons.push("No clear social acceleration yet"); }

  if (breakout) { confidence += 12; reasons.push("Breakout confirmation present"); }
  else { confidence -= 6; reasons.push("No breakout confirmation yet"); }

  // Liquidity / Volume sanity
  if (liq >= 50000) { confidence += 10; reasons.push("Liquidity healthy"); }
  else if (liq >= 15000) { confidence += 4; reasons.push("Liquidity acceptable"); }
  else { confidence -= 12; reasons.push("Liquidity low (slippage risk)"); }

  if (vol >= 250000) { confidence += 10; reasons.push("Volume strong"); }
  else if (vol >= 120000) { confidence += 6; reasons.push("Volume decent"); }
  else if (vol > 0 && vol < 60000) { confidence -= 8; reasons.push("Volume weak"); }

  // Overextended warning
  if (ch1h >= 35) { confidence -= 10; reasons.push("Overextended 1h move — chase risk"); }
  else if (ch1h >= 12) { confidence -= 4; reasons.push("Fast 1h move — be careful"); }

  confidence = clamp(confidence, 1, 99);

  // Final decision rule
  // APE only if: good score + acceleration + acceptable rug + (breakout OR strong liq/vol)
  const ape =
    score >= 78 &&
    rug <= 60 &&
    rising &&
    (breakout || (liq >= 50000 && vol >= 120000));

  return {
    action: ape ? "APE" : "WAIT",
    confidence,
    severity: rug >= 65 ? "HIGH" : rug >= 45 ? "MED" : "LOW",
    reasons: reasons.slice(0, 6),
    tags: [
      `SCORE:${score}`,
      `RUG:${rug}`,
      rising ? "ACCEL:ON" : "ACCEL:OFF",
      breakout ? "BREAKOUT:ON" : "BREAKOUT:OFF"
    ]
  };
}
