function clamp(n, a, b) { return Math.max(a, Math.min(b, n)); }

// Hard rug warning threshold (applies to all tiers)
const RUG_WARNING_THRESHOLD = 82;

// Tier-based thresholds for early-but-safer decision tuning
const TIER_THRESHOLDS = {
  BASIC: {
    scoreEnter: 78,
    scoreReady: 70,
    scoreArm: 62,
    rugMaxEnter: 60,
    rugMaxReady: 65,
    rugMaxArm: 70,
    minConfirmations: 3,
    volumeSurgeMultiplier: 3.0,
    txAccelThreshold: 1.8,
    buyRatioAccelMin: 0.15,
    sellStreakMax: 4,
  },
  PRO: {
    scoreEnter: 72,
    scoreReady: 65,
    scoreArm: 58,
    rugMaxEnter: 65,
    rugMaxReady: 70,
    rugMaxArm: 75,
    minConfirmations: 2,
    volumeSurgeMultiplier: 2.5,
    txAccelThreshold: 1.5,
    buyRatioAccelMin: 0.12,
    sellStreakMax: 5,
  },
  PROPLUS: {
    scoreEnter: 68,
    scoreReady: 62,
    scoreArm: 55,
    rugMaxEnter: 68,
    rugMaxReady: 72,
    rugMaxArm: 78,
    minConfirmations: 2,
    volumeSurgeMultiplier: 2.0,
    txAccelThreshold: 1.4,
    buyRatioAccelMin: 0.10,
    sellStreakMax: 6,
  },
};

// Detect leading indicators for early signal generation
function detectLeadingIndicators(overlay, thresholds) {
  const indicators = {
    buyRatioAccel: false,
    txAccel: false,
    volumeSurge: false,
    sellStreak: false,
    count: 0,
  };

  // Buy-ratio acceleration (comparing recent vs baseline)
  const buys5 = Number(overlay?.buys5m ?? 0);
  const sells5 = Number(overlay?.sells5m ?? 0);
  const tx5 = buys5 + sells5;
  const buyRatio = tx5 > 0 ? buys5 / tx5 : 0.5;
  
  const buyRatioPrev = Number(overlay?.buyRatioPrev ?? 0.5);
  const buyRatioAccel = buyRatio - buyRatioPrev;
  
  if (buyRatioAccel > thresholds.buyRatioAccelMin) {
    indicators.buyRatioAccel = true;
    indicators.count++;
  }

  // TX acceleration (tx count increasing rapidly)
  const tx5Prev = Number(overlay?.tx5mPrev ?? 0);
  const txAccelRatio = tx5Prev > 0 ? tx5 / tx5Prev : 1;
  
  if (txAccelRatio >= thresholds.txAccelThreshold) {
    indicators.txAccel = true;
    indicators.count++;
  }

  // Volume surge vs short baseline
  const vol5m = Number(overlay?.volume5m ?? 0);
  const vol5mBaseline = Number(overlay?.volume5mBaseline ?? vol5m);
  const volumeSurgeRatio = vol5mBaseline > 0 ? vol5m / vol5mBaseline : 1;
  
  if (volumeSurgeRatio >= thresholds.volumeSurgeMultiplier) {
    indicators.volumeSurge = true;
    indicators.count++;
  }

  // Sell streak detection (consecutive periods of sell dominance)
  const sellStreakCount = Number(overlay?.sellStreakCount ?? 0);
  
  // Use a threshold 2 less than max to trigger earlier warnings
  // (e.g., 3 for BASIC where max is 4, allowing some headroom before max)
  // Minimum threshold is 3 to avoid false positives from short-term noise
  const SELL_STREAK_MIN_THRESHOLD = 3;
  const SELL_STREAK_OFFSET = 2;
  const sellStreakMinThreshold = Math.max(
    SELL_STREAK_MIN_THRESHOLD, 
    thresholds.sellStreakMax - SELL_STREAK_OFFSET
  );
  
  if (sellStreakCount >= sellStreakMinThreshold) {
    indicators.sellStreak = true;
    indicators.count++;
  }

  return indicators;
}

// Normalize tier name to standard format
function normalizeTier(tier) {
  if (!tier) return 'BASIC';
  const t = String(tier).toUpperCase();
  if (t === 'PRO+' || t === 'PROPLUS') return 'PROPLUS';
  if (t === 'PRO') return 'PRO';
  return 'BASIC';
}

// Extract tier from tierFeatures object or tier name
function extractTier(tierInput) {
  // If tierInput is an object with tier features, look for identifying features
  if (typeof tierInput === 'object' && tierInput !== null) {
    // Check for PROPLUS features
    if (tierInput.allAlgorithms === true || tierInput.earlyAccess === true) {
      return 'PROPLUS';
    }
    // Check for PRO features
    if (tierInput.aiDecisionEngine === true || tierInput.momentumAcceleration === true) {
      return 'PRO';
    }
    // Default to BASIC
    return 'BASIC';
  }
  // Otherwise treat as tier name string
  return normalizeTier(tierInput);
}

export function computeDecision(overlay, tierInput) {
  // Extract and normalize tier
  const tier = extractTier(tierInput);
  const thresholds = TIER_THRESHOLDS[tier] || TIER_THRESHOLDS.BASIC;

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

  // Detect leading indicators for early signals
  const indicators = detectLeadingIndicators(overlay, thresholds);

  const reasons = [];
  let confidence = 55;

  // ✅ HARD RUG WARNING TRIGGERS with tier-based early detection
  const crashFlag = overlay?.rug?.crash === true;
  const crashNow = crashFlag || (chg5m <= -18) || (chg1h <= -35) || (liqDrop >= 35);
  
  // Early rug detection for PRO/PROPLUS: use sell streak as leading indicator
  const earlyRugSignal = indicators.sellStreak && (chg5m <= -10 || liqDrop >= 25);
  const rugTrigger = crashNow || rug >= RUG_WARNING_THRESHOLD || (tier !== 'BASIC' && earlyRugSignal && indicators.count >= thresholds.minConfirmations);

  if (rugTrigger) {
    const why = [];
    if (chg5m <= -18) why.push(`Crash 5m (${chg5m.toFixed(1)}%)`);
    if (chg1h <= -35) why.push(`Crash 1h (${chg1h.toFixed(1)}%)`);
    if (liqDrop >= 18) why.push(`Liquidity drop (${liqDrop.toFixed(0)}%)`);
    if (indicators.sellStreak) why.push(`Sell streak detected`);
    why.push(`Rug risk ${Math.round(rug)}/100`);

    return {
      action: "RUG WARNING",
      confidence: earlyRugSignal && !crashNow ? 85 : 98,
      reasons: ["Rug/crash conditions detected", ...why].slice(0, 7),
      tags: ["RUG:WARNING", `TIER:${tier}`]
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

  // ✅ Tier-aware state machine with leading indicators and confirmation signals
  let action = "WAIT";
  
  // ARM state: basic readiness with tier-adjusted thresholds
  if (score >= thresholds.scoreArm && rug <= thresholds.rugMaxArm) {
    action = "ARM";
  }
  
  // READY state: momentum building with tier-adjusted thresholds
  if (score >= thresholds.scoreReady && rug <= thresholds.rugMaxReady && (rising || breakout)) {
    action = "READY";
  }
  
  // ENTER state: full confirmation with tier-specific logic
  // PRO/PROPLUS: Earlier entry with 2+ leading indicator confirmations
  // BASIC: Stricter requirements with 3+ confirmations
  const baseEnterConditions = 
    score >= thresholds.scoreEnter &&
    rug <= thresholds.rugMaxEnter &&
    rising &&
    !trap.trap &&
    entry.zone !== "CHASE";
  
  const confirmationsMet = indicators.count >= thresholds.minConfirmations;
  
  // Standard enter path (all tiers)
  const standardEnter = 
    baseEnterConditions &&
    (breakout || (liq >= 50000 && vol >= 120000)) &&
    (conv.status === "STRONG" || conv.status === "MED");
  
  // Early enter path (PRO/PROPLUS only) - using leading indicators
  const earlyEnter = 
    tier !== 'BASIC' &&
    baseEnterConditions &&
    confirmationsMet &&
    (indicators.buyRatioAccel || indicators.txAccel || indicators.volumeSurge) &&
    (liq >= 30000 || vol >= 80000);
  
  if (standardEnter || earlyEnter) {
    action = "ENTER";
    if (earlyEnter && !standardEnter) {
      reasons.push(`Early entry (${indicators.count} indicators)`);
    }
  }

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
      `ENTRY:${entry.zone}`,
      `TIER:${tier}`,
      `INDICATORS:${indicators.count}`
    ]
  };
}
