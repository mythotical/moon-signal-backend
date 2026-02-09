const express = require("express");

const router = express.Router();

// Helpers
function tierRank(tier) {
  const t = String(tier || "").toUpperCase();
  if (t === "PROPLUS" || t === "PRO+") return 3;
  if (t === "PRO") return 2;
  if (t === "BASIC") return 1;
  return 0;
}

function normalizeTier(tier) {
  const t = String(tier || "").toUpperCase();
  if (t === "PRO+") return "PROPLUS";
  return t;
}

/**
 * POST /license/verify
 * Body: { key: "XXXXX-XXXXX-..." }
 * Returns: { ok: true, tier: "BASIC|PRO|PROPLUS", entitlements: {...} }
 */
router.post("/license/verify", express.json(), async (req, res) => {
  try {
    const key = String(req.body?.key || "").trim();
    if (!key) return res.status(400).json({ ok: false, error: "Missing key" });

    const accountId = process.env.KEYGEN_ACCOUNT_ID;
    const token = process.env.KEYGEN_TOKEN;

    if (!accountId) return res.status(500).json({ ok: false, error: "Missing KEYGEN_ACCOUNT_ID" });
    if (!token) return res.status(500).json({ ok: false, error: "Missing KEYGEN_TOKEN" });

    // ✅ Validate license key with Keygen
    const resp = await fetch(`https://api.keygen.sh/v1/accounts/${accountId}/licenses/actions/validate-key`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/vnd.api+json",
        Accept: "application/vnd.api+json",
      },
      body: JSON.stringify({
        meta: { key },
      }),
    });

    const json = await resp.json();
    if (!resp.ok) {
      console.log("❌ Keygen validation failed:", json);
      return res.status(401).json({ ok: false, error: "Invalid or expired license key" });
    }

    // Keygen validate response includes license in data
    const lic = json?.data;
    const meta = lic?.attributes?.metadata || {};

    const tier = normalizeTier(meta.tier || meta.plan || "BASIC");

    // ✅ Return entitlements for overlay gating
    // (Your extension uses this to enable/disable UI + features)
    const entitlementsByTier = {
      BASIC: {
        rugWarnings: true,
        waitWatchSignals: true,
        liquidityWhaleDetection: true,
        exitAlerts: true,
        overlaySites: ["dexscreener", "pumpfun"],
        updateMs: 800,
        aiEngine: false,
        momentum: false,
        volumeSurge: false,
        sellPressure: false,
        enterHoldExit: false,
        priorityRefresh: false,
        multiTimeframe: false,
        smartMoney: false,
        advancedRisk: false,
        earlyDump: false,
        priorityExecution: false,
        earlyFeatures: false,
        feedbackInfluence: false,
      },
      PRO: {
        rugWarnings: true,
        waitWatchSignals: true,
        liquidityWhaleDetection: true,
        exitAlerts: true,
        overlaySites: ["dexscreener", "pumpfun"],
        updateMs: 500,
        aiEngine: true,
        momentum: true,
        volumeSurge: true,
        sellPressure: true,
        enterHoldExit: true,
        priorityRefresh: true,
        multiTimeframe: false,
        smartMoney: false,
        advancedRisk: false,
        earlyDump: false,
        priorityExecution: false,
        earlyFeatures: false,
        feedbackInfluence: false,
      },
      PROPLUS: {
        rugWarnings: true,
        waitWatchSignals: true,
        liquidityWhaleDetection: true,
        exitAlerts: true,
        overlaySites: ["dexscreener", "pumpfun"],
        updateMs: 300,
        aiEngine: true,
        momentum: true,
        volumeSurge: true,
        sellPressure: true,
        enterHoldExit: true,
        priorityRefresh: true,
        multiTimeframe: true,
        smartMoney: true,
        advancedRisk: true,
        earlyDump: true,
        priorityExecution: true,
        earlyFeatures: true,
        feedbackInfluence: true,
      },
    };

    const entitlements =
      tierRank(tier) >= 3 ? entitlementsByTier.PROPLUS :
      tierRank(tier) >= 2 ? entitlementsByTier.PRO :
      entitlementsByTier.BASIC;

    return res.json({
      ok: true,
      tier,
      entitlements,
    });
  } catch (e) {
    console.log("❌ /license/verify error:", e.message);
    return res.status(500).json({ ok: false, error: "Server error" });
  }
});

module.exports = router;
