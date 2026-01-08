function clamp(n, a, b) { return Math.max(a, Math.min(b, n)); }

export function computeDecision(overlay) {
  const score = Number(overlay?.score ?? 0);
  const rug = Number(overlay?.rug?.risk ?? 0);
  const liq = Number(overlay?.dexLiquidityUsd ?? 0);
  const vol = Number(overlay?.dexVolume24hUsd ?? 0);
  const rising = overlay?.rising === true;
  const breakout = overlay?.breakout === true;

  const conv = overlay?.convergence || { status: "NONE", strength: 0, sCount: 0, aCount: 0 };
  const trap = overlay?.liqTrap || { trap: false, severity: "LOW" };
  const entry = overlay?.entryZone || { zone: "NEUTRAL", entryScore: 60 };

  const reasons = [];
  let confidence = 55;

  if (rug >= 80) {
    return {
      action: "WAIT",
      confidence: 98,
      reasons: ["EXTREME rug risk — skip"],
      tags: ["RUG:EXTREME"]
    };
  }

  if (rug <= 35) { confidence += 10; reasons.push("Rug risk reasonable"); }
  else if (rug >= 65) { confidence -= 16; reasons.push("High rug risk"); }

  if (trap.trap) { confidence -= (trap.severity === "HIGH" ? 20 : 12); reasons.push(`Liquidity trap (${trap.severity})`); }

  if (score >= 85) { confidence += 18; reasons.push("Alpha score very high"); }
  else if (score >= 78) { confidence += 10; reasons.push("Alpha score high"); }
  else if (score < 60) { confidence -= 12; reasons.push("Alpha score low"); }

  if (rising) { confidence += 10; reasons.push("Social velocity rising"); }
  else { confidence -= 6; reasons.push("No social acceleration"); }

  if (breakout) { confidence += 12; reasons.push("Breakout confirmed"); }
  else { confidence -= 6; reasons.push("No breakout confirmation"); }

  if (conv.status === "STRONG") { confidence += 20; reasons.push(`Convergence STRONG (S:${conv.sCount} A:${conv.aCount})`); }
  else if (conv.status === "MED") { confidence += 10; reasons.push("Convergence MED"); }
  else if (conv.status === "WEAK") { confidence += 4; reasons.push("Convergence WEAK"); }
  else { confidence -= 3; reasons.push("No convergence yet"); }

  if (liq >= 50000) { confidence += 10; reasons.push("Liquidity healthy"); }
  else if (liq >= 15000) { confidence += 4; reasons.push("Liquidity acceptable"); }
  else { confidence -= 12; reasons.push("Liquidity low"); }

  if (vol >= 250000) { confidence += 10; reasons.push("Volume strong"); }
  else if (vol >= 120000) { confidence += 6; reasons.push("Volume decent"); }
  else if (vol > 0 && vol < 60000) { confidence -= 8; reasons.push("Volume weak"); }

  if (entry.zone === "CHASE") { confidence -= 18; reasons.push("Entry = CHASE (overextended)"); }
  else if (entry.zone === "EARLY") { confidence += 8; reasons.push("Entry = EARLY (better RR)"); }

  confidence = clamp(confidence, 1, 99);

  const ape =
    score >= 78 &&
    rug <= 60 &&
    rising &&
    entry.zone !== "CHASE" &&
    !trap.trap &&
    (breakout || (liq >= 50000 && vol >= 120000)) &&
    (conv.status === "STRONG" || conv.status === "MED");

  return {
    action: ape ? "APE" : "WAIT",
    confidence,
    reasons: reasons.slice(0, 7),
    tags: [
      `SCORE:${score}`,
      `RUG:${rug}`,
      rising ? "ACCEL:ON" : "ACCEL:OFF",
      breakout ? "BREAKOUT:ON" : "BREAKOUT:OFF",
      `CONV:${conv.status}`,
      trap.trap ? `TRAP:${trap.severity}` : "TRAP:OFF",
      `ENTRY:${entry.zone}`
    ]
  };
}
