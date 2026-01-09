function clamp(n, a, b) { return Math.max(a, Math.min(b, n)); }

export function computeDecision(overlay) {
  const score = Number(overlay?.score ?? 0);
  const rug = Number(overlay?.rug?.risk ?? 0);
  const liq = Number(overlay?.dexLiquidityUsd ?? 0);
  const vol = Number(overlay?.dexVolume24hUsd ?? 0);

  const chg5m = Number(overlay?.priceChange5m ?? 0);
  const chg1h = Number(overlay?.priceChange1h ?? 0);
  const liqDrop = Number(overlay?.liqDropPct ?? 0);

  const rising = overlay?.rising === true;
  const breakout = overlay?.breakout === true;

  const conv = overlay?.convergence || { status: "NONE", strength: 0, sCount: 0, aCount: 0 };
  const trap = overlay?.liqTrap || { trap: false, severity: "LOW" };
  const entry = overlay?.entryZone || { zone: "NEUTRAL", entryScore: 60 };

  const reasons = [];
  let confidence = 55;

  // ✅ HARD RUG WARNING TRIGGERS (this fixes your screenshot)
  const crashFlag = overlay?.rug?.crash === true;
  const crashNow = crashFlag || (chg5m <= -18) || (chg1h <= -35) || (liqDrop >= 35);

  if (crashNow || rug >= 82) {
    const why = [];
    if (chg5m <= -18) why.push(`Crash 5m (${chg5m.toFixed(1)}%)`);
    if (chg1h <= -35) why.push(`Crash 1h (${chg1h.toFixed(1)}%)`);
    if (liqDrop >= 18) why.push(`Liquidity drop (${liqDrop.toFixed(0)}%)`);
    why.push(`Rug risk ${Math.round(rug)}/100`);

    return {
      action: "RUG WARNING",
      confidence: 98,
      reasons: ["Rug/crash conditions detected", ...why].slice(0, 7),
      tags: ["RUG:WARNING"]
    };
  }

  // Rug risk gradient
  if (rug <= 35) { confidence += 10; reasons.push("Rug risk reasonable"); }
  else if (rug >= 65) { confidence -= 16; reasons.push("High rug risk"); }

  // Liquidity trap
  if (trap.trap) {
    confidence -= (trap.severity === "HIGH" ? 20 : 12);
    reasons.push(`Liquidity trap (${trap.severity})`);
  }

  // Alpha score
  if (score >= 85) { confidence += 18; reasons.push("Alpha score very high"); }
  else if (score >= 78) { confidence += 10; reasons.push("Alpha score high"); }
  else if (score < 60) { confidence -= 12; reasons.push("Alpha score low"); }

  // Momentum signals
  if (rising) { confidence += 10; reasons.push("Social/flow rising"); }
  else { confidence -= 6; reasons.push("No acceleration"); }

  if (breakout) { confidence += 12; reasons.push("Breakout confirmed"); }
  else { confidence -= 6; reasons.push("No breakout confirmation"); }

  // Convergence
  if (conv.status === "STRONG") { confidence += 18; reasons.push(`Convergence STRONG (S:${conv.sCount} A:${conv.aCount})`); }
  else if (conv.status === "MED") { confidence += 9; reasons.push("Convergence MED"); }
  else if (conv.status === "WEAK") { confidence += 3; reasons.push("Convergence WEAK"); }
  else { confidence -= 3; reasons.push("No convergence yet"); }

  // Liquidity / volume
  if (liq >= 50000) { confidence += 10; reasons.push("Liquidity healthy"); }
  else if (liq >= 15000) { confidence += 4; reasons.push("Liquidity acceptable"); }
  else { confidence -= 12; reasons.push("Liquidity low"); }

  if (vol >= 250000) { confidence += 10; reasons.push("Volume strong"); }
  else if (vol >= 120000) { confidence += 6; reasons.push("Volume decent"); }
  else if (vol > 0 && vol < 60000) { confidence -= 8; reasons.push("Volume weak"); }

  // Entry zone
  if (entry.zone === "CHASE") { confidence -= 18; reasons.push("Entry = CHASE (overextended)"); }
  else if (entry.zone === "EARLY") { confidence += 8; reasons.push("Entry = EARLY (better RR)"); }

  confidence = clamp(confidence, 1, 99);

  // ✅ Better state machine (what your overlay expects)
  let action = "WAIT";
  if (score >= 62 && rug <= 70) action = "ARM";
  if (score >= 70 && rug <= 65 && (rising || breakout)) action = "READY";
  if (
    score >= 78 &&
    rug <= 60 &&
    rising &&
    !trap.trap &&
    entry.zone !== "CHASE" &&
    (breakout || (liq >= 50000 && vol >= 120000)) &&
    (conv.status === "STRONG" || conv.status === "MED")
  ) action = "ENTER";

  return {
    action,
    confidence,                 // ✅ always a number 1–99 (display as %)
    reasons: reasons.slice(0, 7),
    tags: [
      `SCORE:${score}`,
      `RUG:${rug}`,
      rising ? "ACCEL:ON" : "ACCEL:OFF",
      breakout ? "BREAKOUT:ON" : "BREAKOUT:OFF",
      `CHG5M:${chg5m}`,
      `LIQDROP:${liqDrop}`,
      `CONV:${conv.status}`,
      trap.trap ? `TRAP:${trap.severity}` : "TRAP:OFF",
      `ENTRY:${entry.zone}`
    ]
  };
}
