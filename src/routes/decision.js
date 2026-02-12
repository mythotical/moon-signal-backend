const express = require("express");
const router = express.Router();

// Configuration constants
const RUG_WARNING_THRESHOLD = 82;

// Helper to clamp values
function clamp(n, a, b) {
  return Math.max(a, Math.min(b, n));
}

// Validate address format for common chains
function isValidAddress(address) {
  if (!address || typeof address !== 'string') return false;
  
  // EVM chains (Ethereum, BSC, Polygon, etc.) - 0x followed by 40 hex chars
  if (/^0x[a-fA-F0-9]{40}$/.test(address)) return true;
  
  // Solana - base58 encoded, typically 32-44 chars
  if (/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address)) return true;
  
  return false;
}

// Sanitize user input for error messages to prevent log injection
function sanitizeForLog(input) {
  if (!input || typeof input !== 'string') return '';
  // Truncate and remove control characters
  return input.slice(0, 100).replace(/[\r\n\t]/g, '');
}

// Parse Dexscreener URL to extract chain and pair/token
function parseDexscreenerUrl(url) {
  if (!url) return null;

  try {
    const urlObj = new URL(url);
    
    // Expected formats:
    // https://dexscreener.com/solana/ABC123...
    // https://dexscreener.com/pair/solana/ABC123...
    // https://dexscreener.com/token/ABC123...
    
    const pathname = urlObj.pathname;
    const parts = pathname.split('/').filter(Boolean);
    
    if (parts.length === 0) return null;
    
    // Format: /pair/<chain>/<pair>
    if (parts[0] === 'pair' && parts.length >= 3) {
      return { chain: parts[1], pairOrToken: parts[2], isPair: true };
    }
    
    // Format: /token/<address>
    if (parts[0] === 'token' && parts.length >= 2) {
      // Token address - will need to fetch and find best pair
      return { chain: null, pairOrToken: parts[1], isPair: false, isToken: true };
    }
    
    // Format: /<chain>/<pair>
    if (parts.length >= 2) {
      return { chain: parts[0], pairOrToken: parts[1], isPair: true };
    }
    
    return null;
  } catch (e) {
    return null;
  }
}

// Fetch pair data from Dexscreener API
async function fetchDexscreenerPair(chain, pairOrToken, isToken = false) {
  const fetchJson = async (url) => {
    const res = await fetch(url, { headers: { accept: "application/json" } });
    if (!res.ok) {
      // Don't expose full URL in error message to prevent information disclosure
      throw new Error(`Dexscreener HTTP ${res.status}`);
    }
    return res.json();
  };

  if (isToken) {
    // Validate address format for token lookups
    if (!isValidAddress(pairOrToken)) {
      throw new Error(`Invalid token address format: ${sanitizeForLog(pairOrToken)}`);
    }
    
    // Validate length to prevent URL length issues (Dexscreener has reasonable limits)
    if (pairOrToken.length > 100) {
      throw new Error('Token address exceeds maximum length');
    }
    
    // For token addresses, use search endpoint to find best pair
    // Note: This uses Dexscreener's public search API with their rate limits
    const searchUrl = `https://api.dexscreener.com/latest/dex/search/?q=${encodeURIComponent(pairOrToken)}`;
    try {
      const json = await fetchJson(searchUrl);
      const pairs = Array.isArray(json?.pairs) ? json.pairs : [];
      if (pairs.length === 0) return null;
      
      // Sort by liquidity and return best pair
      pairs.sort((a, b) => (b?.liquidity?.usd ?? 0) - (a?.liquidity?.usd ?? 0));
      return pairs[0];
    } catch (e) {
      return null;
    }
  }

  // Validate chain parameter for API requests
  const validChains = ['ethereum', 'bsc', 'polygon', 'arbitrum', 'optimism', 'base', 
                       'avalanche', 'solana', 'sui', 'aptos', 'fantom', 'cronos'];
  if (chain && !validChains.includes(chain.toLowerCase())) {
    // Allow unknown chains but log for monitoring
    console.warn(`Unknown chain identifier: ${sanitizeForLog(chain)}`);
  }

  // Try standard pair endpoint first (latest API version)
  const pairUrl = `https://api.dexscreener.com/latest/dex/pairs/${encodeURIComponent(chain)}/${encodeURIComponent(pairOrToken)}`;
  try {
    const json = await fetchJson(pairUrl);
    if (json?.pair) return json.pair;
    if (json?.pairs && Array.isArray(json.pairs) && json.pairs.length > 0) {
      return json.pairs[0];
    }
  } catch (e) {
    // Fall through to try token endpoint
  }

  // Try token endpoint as fallback
  // Note: This uses v1 API (legacy endpoint still supported by Dexscreener)
  // while pair endpoint uses 'latest'. This is Dexscreener's API design.
  const tokenUrl = `https://api.dexscreener.com/token-pairs/v1/${encodeURIComponent(chain)}/${encodeURIComponent(pairOrToken)}`;
  try {
    const pools = await fetchJson(tokenUrl);
    if (!Array.isArray(pools) || pools.length === 0) return null;
    pools.sort((a, b) => (b?.liquidity?.usd ?? 0) - (a?.liquidity?.usd ?? 0));
    return pools[0];
  } catch (e) {
    return null;
  }
}

// Compute alpha score from pair data (based on scoring.js logic)
function computeAlphaScore(pair) {
  let score = 20;

  const liqUsd = Number(pair?.liquidity?.usd ?? 0);
  const vol24 = Number(pair?.volume?.h24 ?? 0);
  const chg1h = Number(pair?.priceChange?.h1 ?? 0);
  const chg24h = Number(pair?.priceChange?.h24 ?? 0);

  // Liquidity scoring
  if (liqUsd >= 100000) score += 18;
  else if (liqUsd >= 50000) score += 14;
  else if (liqUsd >= 20000) score += 10;
  else if (liqUsd >= 10000) score += 6;
  else if (liqUsd >= 5000) score += 3;
  else score -= 4;

  // Volume scoring
  if (vol24 >= 500000) score += 12;
  else if (vol24 >= 200000) score += 9;
  else if (vol24 >= 100000) score += 7;
  else if (vol24 >= 25000) score += 4;
  else score -= 2;

  // Price momentum
  if (chg1h >= 80) score += 8;
  else if (chg1h >= 30) score += 5;
  else if (chg1h <= -40) score -= 6;

  if (chg24h >= 200) score += 6;
  else if (chg24h <= -60) score -= 6;

  return clamp(score, 0, 100);
}

// Compute rug risk from pair data (based on rugrisk.js logic)
function computeRugRisk(pair) {
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

  let risk = 18;

  // Base liquidity
  if (liqUsd < 5000) risk += 35;
  else if (liqUsd < 10000) risk += 26;
  else if (liqUsd < 25000) risk += 14;

  // FDV/LP ratio
  if (fdv > 0 && liqUsd > 0) {
    const ratio = fdv / liqUsd;
    if (ratio >= 500) risk += 22;
    else if (ratio >= 250) risk += 14;
  }

  // Crash detection
  const crash5m = chg5m <= -18;
  const crash1h = chg1h <= -35;
  const crash24 = chg24h <= -70;

  if (crash5m) risk += 32;
  if (crash1h) risk += 28;
  if (crash24) risk += 22;

  // Sell pressure
  if (t5 >= 12 && buyRatio5 <= 0.38) risk += 18;
  else if (t5 >= 12 && buyRatio5 >= 0.65) risk -= 6;

  // Volume without liquidity
  if (vol24 >= 300000 && liqUsd < 25000) risk += 14;

  return clamp(risk, 0, 100);
}

// Compute decision and confidence (simplified version of score_engine.js logic)
function computeDecision(alpha, rug, pair) {
  const liq = Number(pair?.liquidity?.usd ?? 0);
  const vol = Number(pair?.volume?.h24 ?? 0);
  const chg5m = Number(pair?.priceChange?.m5 ?? 0);
  const chg1h = Number(pair?.priceChange?.h1 ?? 0);

  let confidence = 55;

  // Hard rug warning
  const crashNow = chg5m <= -18 || chg1h <= -35;
  if (crashNow || rug >= RUG_WARNING_THRESHOLD) {
    return {
      decision: "RUG WARNING",
      confidence: 98
    };
  }

  // Confidence adjustments
  if (rug <= 35) confidence += 10;
  else if (rug >= 65) confidence -= 16;

  if (alpha >= 85) confidence += 18;
  else if (alpha >= 78) confidence += 10;
  else if (alpha < 60) confidence -= 12;

  if (liq >= 50000) confidence += 10;
  else if (liq >= 15000) confidence += 4;
  else confidence -= 12;

  if (vol >= 250000) confidence += 10;
  else if (vol >= 120000) confidence += 6;
  else if (vol > 0 && vol < 60000) confidence -= 8;

  confidence = clamp(confidence, 1, 99);

  // Decision logic (simplified)
  let decision = "WAIT";

  // Basic thresholds for PRO tier (middle ground)
  if (alpha >= 58 && rug <= 75) {
    decision = "ARM";
  }

  if (alpha >= 65 && rug <= 70 && (chg5m > 0 || chg1h > 5)) {
    decision = "READY";
  }

  if (alpha >= 72 && rug <= 65 && chg5m > 0 && liq >= 30000 && vol >= 80000) {
    decision = "ENTER";
  }

  return { decision, confidence };
}

// GET /decision?url=<dexscreener url>
router.get("/decision", async (req, res) => {
  try {
    const url = req.query.url;

    if (!url) {
      return res.status(400).json({
        ok: false,
        error: "missing_url",
        message: "URL parameter is required"
      });
    }

    // Parse the URL
    const parsed = parseDexscreenerUrl(url);
    if (!parsed) {
      return res.status(400).json({
        ok: false,
        error: "invalid_url",
        message: "Invalid Dexscreener URL format"
      });
    }

    // Fetch pair data
    let pair;
    try {
      pair = await fetchDexscreenerPair(
        parsed.chain,
        parsed.pairOrToken,
        parsed.isToken
      );
    } catch (error) {
      // Check if it's an address validation error
      if (error.message && error.message.includes('Invalid token address format')) {
        return res.status(400).json({
          ok: false,
          error: "invalid_token_address",
          message: error.message
        });
      }
      throw error; // Re-throw other errors to be caught by outer catch
    }

    if (!pair) {
      return res.status(404).json({
        ok: false,
        error: "pair_not_found",
        message: "Could not find pair data from Dexscreener"
      });
    }

    // Extract chain and pair address
    // For token lookups, chain must come from pair data
    const chain = parsed.isToken 
      ? pair.chainId 
      : (pair.chainId || parsed.chain);
      
    if (!chain) {
      return res.status(400).json({
        ok: false,
        error: "chain_not_identified",
        message: "Could not identify chain from pair data or URL"
      });
    }
    const pairAddress = pair.pairAddress || parsed.pairOrToken;

    // Compute metrics
    const alpha = computeAlphaScore(pair);
    const rug = computeRugRisk(pair);
    const { decision, confidence } = computeDecision(alpha, rug, pair);

    // Extract token info (use empty strings for missing data for consistency)
    const tokenName = pair.baseToken?.name || pair.token0?.name || "";
    const tokenSymbol = pair.baseToken?.symbol || pair.token0?.symbol || "";
    const mint = pair.baseToken?.address || pair.token0?.address || "";

    // Construct canonical pair URL
    const pairUrl = pair.url || `https://dexscreener.com/${chain}/${pairAddress}`;

    // Return response
    return res.json({
      ok: true,
      chain,
      pair: pairAddress,
      url: pairUrl,
      decision,
      alpha,
      rug,
      confidence,
      tokenName,
      tokenSymbol,
      mint
    });

  } catch (error) {
    console.error("Error in /decision endpoint:", error);
    return res.status(500).json({
      ok: false,
      error: "internal_error",
      message: "An internal error occurred while processing the request"
    });
  }
});

module.exports = router;