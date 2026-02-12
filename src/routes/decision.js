const express = require("express");
const router = express.Router();

// Decision thresholds (BASIC tier defaults)
const ALPHA_BASE_SCORE = 20;
const RUG_BASE_RISK = 18;
const CONFIDENCE_BASE_SCORE = 55;
const RUG_WARNING_THRESHOLD = 82;

// BASIC tier thresholds
const DECISION_THRESHOLDS = {
  ENTER: { alpha: 78, rugMax: 60 },
  READY: { alpha: 70, rugMax: 65 },
  ARM: { alpha: 62, rugMax: 70 }
};

// Rug risk thresholds
const CRASH_5M_THRESHOLD = -18;
const CRASH_1H_THRESHOLD = -35;
const CRASH_24H_THRESHOLD = -70;
const MIN_TRANSACTIONS_THRESHOLD = 12;
const SELL_PRESSURE_THRESHOLD = 0.38;
const BUY_PRESSURE_THRESHOLD = 0.65;
const HIGH_VOLUME_THRESHOLD = 300000;
const LOW_LIQUIDITY_THRESHOLD = 25000;

// Parse Dexscreener URL to extract chain and pair/token
function parseDexscreenerUrl(url) {
  if (!url) return null;
  
  try {
    const urlObj = new URL(url);
    
    // Check if it's a dexscreener.com URL (exact hostname match or subdomain)
    if (urlObj.hostname !== "dexscreener.com" && !urlObj.hostname.endsWith(".dexscreener.com")) {
      return null;
    }
    
    const parts = urlObj.pathname.split("/").filter(Boolean);
    
    // Format: /pair/<chain>/<pair>
    if (parts[0] === "pair" && parts.length >= 3) {
      return { chain: parts[1], id: parts[2] };
    }
    
    // Format: /token/<address>
    if (parts[0] === "token" && parts.length >= 2) {
      // For token format, we'll need to search or use the token address as ID
      // We'll use the token address and try to fetch from API
      return { chain: null, id: parts[1], isToken: true };
    }
    
    // Format: /<chain>/<pair>
    if (parts.length >= 2) {
      return { chain: parts[0], id: parts[1] };
    }
    
    return null;
  } catch (err) {
    return null;
  }
}

// Fetch pair data from Dexscreener API
async function fetchPairData(chain, id, isToken = false) {
  const headers = { accept: "application/json" };
  
  if (isToken) {
    // Try token endpoint - format: https://api.dexscreener.com/latest/dex/tokens/<address>
    const tokenUrl = `https://api.dexscreener.com/latest/dex/tokens/${encodeURIComponent(id)}`;
    try {
      const res = await fetch(tokenUrl, { headers });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      
      // Token endpoint returns { pairs: [...] }
      if (json?.pairs && Array.isArray(json.pairs) && json.pairs.length > 0) {
        // Sort by liquidity and return the most liquid pair
        const sorted = json.pairs.sort((a, b) => 
          (b?.liquidity?.usd ?? 0) - (a?.liquidity?.usd ?? 0)
        );
        return sorted[0];
      }
    } catch (err) {
      // Continue to fallback
    }
  }
  
  // Try pair endpoint - format: https://api.dexscreener.com/latest/dex/pairs/<chain>/<pair>
  if (chain && id) {
    const pairUrl = `https://api.dexscreener.com/latest/dex/pairs/${encodeURIComponent(chain)}/${encodeURIComponent(id)}`;
    try {
      const res = await fetch(pairUrl, { headers });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      
      if (json?.pair) {
        return json.pair;
      }
      
      // Some endpoints return { pairs: [...] }
      if (json?.pairs && Array.isArray(json.pairs) && json.pairs.length > 0) {
        return json.pairs[0];
      }
    } catch (err) {
      // Continue to fallback
    }
  }
  
  return null;
}

// Compute alpha score from pair data
function computeAlphaScore(pair) {
  let score = ALPHA_BASE_SCORE;
  
  const liq = Number(pair?.liquidity?.usd ?? 0);
  const vol24 = Number(pair?.volume?.h24 ?? 0);
  const chg1h = Number(pair?.priceChange?.h1 ?? 0);
  const chg24h = Number(pair?.priceChange?.h24 ?? 0);
  
  // Liquidity scoring
  if (liq >= 100000) score += 18;
  else if (liq >= 50000) score += 14;
  else if (liq >= 20000) score += 10;
  else if (liq >= 10000) score += 6;
  else if (liq >= 5000) score += 3;
  else score -= 4;
  
  // Volume scoring
  if (vol24 >= 500000) score += 12;
  else if (vol24 >= 200000) score += 9;
  else if (vol24 >= 100000) score += 7;
  else if (vol24 >= 25000) score += 4;
  else score -= 2;
  
  // Momentum scoring
  if (chg1h >= 80) score += 8;
  else if (chg1h >= 30) score += 5;
  else if (chg1h <= -40) score -= 6;
  
  if (chg24h >= 200) score += 6;
  else if (chg24h <= -60) score -= 6;
  
  return Math.max(0, Math.min(100, Math.round(score)));
}

// Compute rug risk from pair data
function computeRugRisk(pair) {
  function clamp(n, a, b) { return Math.max(a, Math.min(b, n)); }
  
  const liqUsd = Number(pair?.liquidity?.usd ?? 0);
  const vol24 = Number(pair?.volume?.h24 ?? 0);
  const fdv = Number(pair?.fdv ?? 0);
  
  const chg5m = Number(pair?.priceChange?.m5 ?? 0);
  const chg1h = Number(pair?.priceChange?.h1 ?? 0);
  const chg24h = Number(pair?.priceChange?.h24 ?? 0);
  
  const buys5 = Number(pair?.txns?.m5?.buys ?? 0);
  const sells5 = Number(pair?.txns?.m5?.sells ?? 0);
  const t5 = buys5 + sells5;
  const buyRatio5 = t5 > 0 ? buys5 / t5 : 0.5;
  
  let risk = RUG_BASE_RISK;
  
  // Base liquidity / structure
  if (liqUsd < 5000) risk += 35;
  else if (liqUsd < 10000) risk += 26;
  else if (liqUsd < 25000) risk += 14;
  
  if (fdv > 0 && liqUsd > 0) {
    const ratio = fdv / liqUsd;
    if (ratio >= 500) risk += 22;
    else if (ratio >= 250) risk += 14;
  }
  
  // Crash detection
  const crash5m = chg5m <= CRASH_5M_THRESHOLD;
  const crash1h = chg1h <= CRASH_1H_THRESHOLD;
  const crash24 = chg24h <= CRASH_24H_THRESHOLD;
  
  if (crash5m) risk += 32;
  if (crash1h) risk += 28;
  if (crash24) risk += 22;
  
  // Sell pressure
  if (t5 >= MIN_TRANSACTIONS_THRESHOLD && buyRatio5 <= SELL_PRESSURE_THRESHOLD) risk += 18;
  else if (t5 >= MIN_TRANSACTIONS_THRESHOLD && buyRatio5 >= BUY_PRESSURE_THRESHOLD) risk -= 6;
  
  // Volume without liquidity support
  if (vol24 >= HIGH_VOLUME_THRESHOLD && liqUsd < LOW_LIQUIDITY_THRESHOLD) risk += 14;
  
  return clamp(risk, 0, 100);
}

// Compute decision based on alpha and rug
function computeDecision(alpha, rug) {
  // Rug warning threshold
  if (rug >= RUG_WARNING_THRESHOLD) {
    return "RUG WARNING";
  }
  
  // Decision thresholds (using BASIC tier as default)
  if (alpha >= DECISION_THRESHOLDS.ENTER.alpha && rug <= DECISION_THRESHOLDS.ENTER.rugMax) {
    return "ENTER";
  } else if (alpha >= DECISION_THRESHOLDS.READY.alpha && rug <= DECISION_THRESHOLDS.READY.rugMax) {
    return "READY";
  } else if (alpha >= DECISION_THRESHOLDS.ARM.alpha && rug <= DECISION_THRESHOLDS.ARM.rugMax) {
    return "ARM";
  }
  
  return "WAIT";
}

// Compute confidence score
function computeConfidence(alpha, rug, pair) {
  let confidence = CONFIDENCE_BASE_SCORE;
  
  const liq = Number(pair?.liquidity?.usd ?? 0);
  const vol24 = Number(pair?.volume?.h24 ?? 0);
  
  // Rug risk gradient
  if (rug <= 35) confidence += 10;
  else if (rug >= 65) confidence -= 16;
  
  // Alpha score
  if (alpha >= 85) confidence += 18;
  else if (alpha >= 78) confidence += 10;
  else if (alpha < 60) confidence -= 12;
  
  // Liquidity / volume
  if (liq >= 50000) confidence += 10;
  else if (liq >= 15000) confidence += 4;
  else confidence -= 12;
  
  if (vol24 >= 250000) confidence += 10;
  else if (vol24 >= 120000) confidence += 6;
  else if (vol24 > 0 && vol24 < 60000) confidence -= 8;
  
  return Math.max(1, Math.min(99, confidence));
}

// GET /decision endpoint
router.get("/decision", async (req, res) => {
  const { url } = req.query;
  
  // Validate URL parameter
  if (!url) {
    return res.status(400).json({ 
      ok: false, 
      error: "missing_url",
      message: "URL parameter is required" 
    });
  }
  
  // Parse Dexscreener URL
  const parsed = parseDexscreenerUrl(url);
  if (!parsed) {
    return res.status(400).json({ 
      ok: false, 
      error: "invalid_url",
      message: "Invalid Dexscreener URL format" 
    });
  }
  
  try {
    // Fetch pair data from Dexscreener API
    const pair = await fetchPairData(parsed.chain, parsed.id, parsed.isToken);
    
    if (!pair) {
      return res.status(404).json({ 
        ok: false, 
        error: "pair_not_found",
        message: "Pair data not found for the provided URL" 
      });
    }
    
    // Extract chain and pair info from the fetched data
    const chain = pair.chainId || parsed.chain || "";
    const pairAddress = pair.pairAddress || parsed.id || "";
    
    // Compute metrics
    const alpha = computeAlphaScore(pair);
    const rug = computeRugRisk(pair);
    const decision = computeDecision(alpha, rug);
    const confidence = computeConfidence(alpha, rug, pair);
    
    // Extract token info
    const tokenName = pair.baseToken?.name || "";
    const tokenSymbol = pair.baseToken?.symbol || "";
    const mint = pair.baseToken?.address || "";
    
    // Return response
    return res.json({
      ok: true,
      chain,
      pair: pairAddress,
      url,
      decision,
      alpha,
      rug,
      confidence,
      tokenName,
      tokenSymbol,
      mint
    });
    
  } catch (err) {
    console.error("Decision endpoint error:", err);
    return res.status(500).json({ 
      ok: false, 
      error: "internal_error",
      message: "Failed to compute decision" 
    });
  }
});

module.exports = router;
