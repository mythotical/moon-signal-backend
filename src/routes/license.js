const express = require("express");

const router = express.Router();

/**
 * ✅ EXACT tier feature gating
 * Only these features are "true" per tier.
 */
const TIER_FEATURES = {
  BASIC: {
    // BASIC
    rugWarnings: true,
    waitWatchSignals: true,
    liquidityWhaleDetection: true,
    exitAlerts: true,
    overlaySites: ["dexscreener", "pumpfun"],
    liveUpdates: "sub-second",

    // PRO extras (locked)
    aiDecisionEngine: false,
    momentumAcceleration: false,
    volumeSurgeAnalysis: false,
    sellPressureTracking: false,
    confirmationStates: false, // ENTER / HOLD / EXIT
    fasterRefresh: false,

    // PRO+ extras (locked)
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
    // BASIC included
    rugWarnings: true,
    waitWatchSignals: true,
    liquidityWhaleDetection: true,
    exitAlerts: true,
    overlaySites: ["dexscreener", "pumpfun"],
    liveUpdates: "sub-second",

    // PRO
    aiDecisionEngine: true,
    momentumAcceleration: true,
    volumeSurgeAnalysis: true,
    sellPressureTracking: true,
    confirmationStates: true,
    fasterRefresh: true,

    // PRO+ (locked)
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
    // BASIC included
    rugWarnings: true,
    waitWatchSignals: true,
    liquidityWhaleDetection: true,
    exitAlerts: true,
    overlaySites: ["dexscreener", "pumpfun"],
    liveUpdates: "sub-second",

    // PRO included
    aiDecisionEngine: true,
    momentumAcceleration: true,
    volumeSurgeAnalysis: true,
    sellPressureTracking: true,
    confirmationStates: true,
    fasterRefresh: true,

    // PRO+
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

async function keygenValidateLicense({ accountId, token, licenseKey }) {
  const url = `https://api.keygen.sh/v1/accounts/${accountId}/licenses/actions/validate-key`;

  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/vnd.api+json",
      Accept: "application/vnd.api+json",
    },
    body: JSON.stringify({
      meta: { key: String(licenseKey).trim() },
    }),
  });

  const json = await res.json().catch(() => ({}));
  if (!res.ok || json?.meta?.valid !== true) {
    const err = new Error("Invalid or expired license key");
    err.details = json;
    throw err;
  }

  return json;
}

/**
 * POST /license/verify
 * Body: { licenseKey: "XXXXX-....-V3" }
 * Returns: { ok, tier, tierFeatures }
 */
router.post("/license/verify", async (req, res) => {
  try {
    const licenseKey = String(req.body?.licenseKey || "").trim();
    if (!licenseKey) return res.status(400).json({ ok: false, error: "Missing licenseKey" });

    const accountId = process.env.KEYGEN_ACCOUNT_ID;
    const token = process.env.KEYGEN_TOKEN;
    if (!accountId) throw new Error("Missing KEYGEN_ACCOUNT_ID env var");
    if (!token) throw new Error("Missing KEYGEN_TOKEN env var");

    const validated = await keygenValidateLicense({ accountId, token, licenseKey });

    // We stored tier in metadata when license is created in the webhook:
    const metaTier = validated?.data?.attributes?.metadata?.tier;
    const tier = normalizeTier(metaTier);

    const tierFeatures = TIER_FEATURES[tier] || TIER_FEATURES.BASIC;

    return res.json({ ok: true, tier, tierFeatures });
  } catch (err) {
    console.error("❌ /license/verify error:", err?.message || err);
    return res.status(401).json({ ok: false, error: "Invalid or expired license key" });
  }
});

module.exports = router;
