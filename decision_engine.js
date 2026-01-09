function clamp(n, a, b) { return Math.max(a, Math.min(b, n)); }

export function computeDecision(overlay) {
  const score = Number(overlay?.score ?? 0);
  const rugRisk = Number(overlay?.rug?.risk ?? overlay?.rug ?? 0);

  const liq = Number(overlay?.dexLiquidityUsd ?? 0);
  const vol = Number(overlay?.dexVolume24hUsd ?? 0);
  const rising = overlay?.rising === true;
  const breakout = overlay?.breakout === true;

  const conv = overlay?.convergence || { status: "NONE", strength: 0, sCount: 0, aCount: 0 };
  const trap = overlay?.liqTrap || { trap: false, severity: "LOW" };
  const entry = overlay?.entryZone || { zone: "NEUTRAL", entryScore: 60 };

  const reasons = [];
  let confidence = 55;

  // Always honor hard rug risk (Phase 1 heuristic hard fail)
  if (overlay?.rug?.hardFail === true || rugRisk >= 90) {
    return {
      action: "RUG_WARNING",
      confidence: 99,
      score,
      rug: rugRisk,
      reasons: ["Hard rug conditions detected", ...(overlay?.rug?.reasons || [])].slice(0, 6),
      tags: ["RUG:HARD", `SCORE:${score}`, `RUG:${rugRisk}`]
    };
  }

  if (rugRisk <= 35) { confidence += 10; reasons.push("Rug risk reasonable"); }
  else if (rugRisk >= 65) { confidence -= 16; reasons.push("High rug risk"); }

  if (trap.trap) {
    confidence -= (trap.severity === "HIGH" ? 20 : 12);
    reasons.push(`Liquidity trap (${trap.severity})`);
  }

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

  const enter =
    score >= 78 &&
    rugRisk <= 55 &&
    rising &&
    entry.zone !== "CHASE" &&
    !trap.trap &&
    (breakout || (liq >= 50000 && vol >= 120000)) &&
    (conv.status === "STRONG" || conv.status === "MED");

  // --- STATE MACHINE ---
  let action = "WAIT";

  if (rugRisk >= 85) action = "RUG_WARNING";
  else if (enter) action = "ENTER";
  else if (score >= 68 && rugRisk <= 65 && entry.zone !== "CHASE" && !trap.trap) action = "READY";
  else if (score >= 58 && rugRisk <= 75) action = "ARM";

  // Confidence must reflect STABILITY, not just alpha.
  const maxByState =
    action === "ENTER" ? 85 :
    action === "READY" ? 75 :
    action === "ARM" ? 65 : 50;

  confidence = Math.min(confidence, maxByState);

  return {
    action,
    confidence,
    score,
    rug: rugRisk,
    reasons: reasons.slice(0, 7),
    tags: [
      `SCORE:${score}`,
      `RUG:${rugRisk}`,
      rising ? "ACCEL:ON" : "ACCEL:OFF",
      breakout ? "BREAKOUT:ON" : "BREAKOUT:OFF",
      `CONV:${conv.status}`,
      trap.trap ? `TRAP:${trap.severity}` : "TRAP:OFF",
      `ENTRY:${entry.zone}`
    ]
  };
}
