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
    const licenseKey = String(req.body?.licenseKey || req.body?.key || "").trim();
    if (!licenseKey) return res.status(400).json({ ok: false, error: "Missing licenseKey or key" });

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

/**
 * POST /license/trial
 * Body: { email: "user@example.com" } (optional)
 * Generates a 7-day free trial license key via the Keygen "Obsidian 7-Day Free Trial" policy.
 * Returns: { ok, key, license }
 */
router.post("/license/trial", async (req, res) => {
  try {
    const email = String(req.body?.email || "").trim();
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ ok: false, error: "Invalid email format" });
    }

    const accountId = process.env.KEYGEN_ACCOUNT_ID;
    const token = process.env.KEYGEN_TOKEN;
    const policyId = process.env.KEYGEN_POLICY_ObsidianTrial;

    if (!accountId) throw new Error("Missing KEYGEN_ACCOUNT_ID env var");
    if (!token) throw new Error("Missing KEYGEN_TOKEN env var");
    if (!policyId) throw new Error("Missing KEYGEN_POLICY_ObsidianTrial env var");

    const body = {
      data: {
        type: "licenses",
        attributes: {
          metadata: {
            tier: "PROPLUS",
            source: "trial",
            customer_email: email,
          },
        },
        relationships: {
          policy: {
            data: {
              type: "policies",
              id: policyId,
            },
          },
        },
      },
    };

    const apiRes = await fetch(
      `https://api.keygen.sh/v1/accounts/${accountId}/licenses`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/vnd.api+json",
          Accept: "application/vnd.api+json",
        },
        body: JSON.stringify(body),
      }
    );

    const json = await apiRes.json().catch(() => ({}));
    if (!apiRes.ok) {
      const errMsg = json?.errors?.[0]?.detail || "Failed to create trial license";
      throw new Error(errMsg);
    }

    const key = json?.data?.attributes?.key;
    console.log("🔑 Trial license key generated:", key);

    return res.json({ ok: true, key, license: json.data });
  } catch (e) {
    console.log("❌ /license/trial error:", e.message);
    return res.status(500).json({ ok: false, error: e.message });
  }
});

module.exports = router;
