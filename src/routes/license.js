const express = require("express");
const router = express.Router();

// EXACT tier feature gating (only these are enabled)
const TIER_FEATURES = {
  BASIC: {
    rugWarnings: true,
    waitWatchSignals: true,
    liquidityWhaleDetection: true,
    exitAlerts: true,
    overlaySites: ["dexscreener", "pumpfun"],
    liveUpdates: "sub-second",

    aiDecisionEngine: false,
    momentumAcceleration: false,
    volumeSurgeAnalysis: false,
    sellPressureTracking: false,
    confirmationStates: false,
    fasterRefresh: false,

    allAlgorithms: false,
    multiTimeframe: false,
    smartMoneyFlow: false,
    advancedRisk: false,
    earlyDistributionDump: false,
    priorityExecution: false,
    earlyAccess: false,
    directFeedback: false,
  },
  PRO: {
    rugWarnings: true,
    waitWatchSignals: true,
    liquidityWhaleDetection: true,
    exitAlerts: true,
    overlaySites: ["dexscreener", "pumpfun"],
    liveUpdates: "sub-second",

    aiDecisionEngine: true,
    momentumAcceleration: true,
    volumeSurgeAnalysis: true,
    sellPressureTracking: true,
    confirmationStates: true,
    fasterRefresh: true,

    allAlgorithms: false,
    multiTimeframe: false,
    smartMoneyFlow: false,
    advancedRisk: false,
    earlyDistributionDump: false,
    priorityExecution: false,
    earlyAccess: false,
    directFeedback: false,
  },
  PROPLUS: {
    rugWarnings: true,
    waitWatchSignals: true,
    liquidityWhaleDetection: true,
    exitAlerts: true,
    overlaySites: ["dexscreener", "pumpfun"],
    liveUpdates: "sub-second",

    aiDecisionEngine: true,
    momentumAcceleration: true,
    volumeSurgeAnalysis: true,
    sellPressureTracking: true,
    confirmationStates: true,
    fasterRefresh: true,

    allAlgorithms: true,
    multiTimeframe: true,
    smartMoneyFlow: true,
    advancedRisk: true,
    earlyDistributionDump: true,
    priorityExecution: true,
    earlyAccess: true,
    directFeedback: true,
  },
};

function normalizeTier(tier) {
  const t = String(tier || "").toUpperCase();
  if (t === "PRO+") return "PROPLUS";
  if (t === "PROPLUS") return "PROPLUS";
  if (t === "PRO") return "PRO";
  if (t === "BASIC") return "BASIC";
  return "BASIC";
}

async function keygenValidate({ accountId, token, licenseKey }) {
  const res = await fetch(
    `https://api.keygen.sh/v1/accounts/${accountId}/licenses/actions/validate-key`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/vnd.api+json",
        Accept: "application/vnd.api+json",
      },
      body: JSON.stringify({ meta: { key: String(licenseKey).trim() } }),
    }
  );

  const json = await res.json().catch(() => ({}));
  if (!res.ok || json?.meta?.valid !== true) {
    throw new Error("Invalid or expired license key");
  }
  return json;
}

/**
 * POST /license/verify
 * Body: { licenseKey: "XXXXX-..." }
 * Returns: { ok, tier, tierFeatures }
 */
router.post("/license/verify", async (req, res) => {
  try {
    const licenseKey = String(req.body?.licenseKey || "").trim();
    if (!licenseKey) return res.status(400).json({ ok: false, error: "Missing licenseKey" });

    const accountId = process.env.KEYGEN_ACCOUNT_ID;
    const token = process.env.KEYGEN_TOKEN;
    if (!accountId) throw new Error("Missing KEYGEN_ACCOUNT_ID");
    if (!token) throw new Error("Missing KEYGEN_TOKEN");

    const validated = await keygenValidate({ accountId, token, licenseKey });

    const tierFromMeta = validated?.data?.attributes?.metadata?.tier;
    const tier = normalizeTier(tierFromMeta);

    return res.json({
      ok: true,
      tier,
      tierFeatures: TIER_FEATURES[tier] || TIER_FEATURES.BASIC,
    });
  } catch (e) {
    console.log("❌ /license/verify error:", e.message);
    return res.status(401).json({ ok: false, error: "Invalid or expired license key" });
  }
});

module.exports = router;
