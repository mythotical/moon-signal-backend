// src/routes/license.js
// Obsidian License Verification & Activation
// Integrates with Keygen for tier-based feature unlocking

const express = require("express");
const router = express.Router();

// ==========================================
// TIER FEATURE DEFINITIONS
// ==========================================

const TIER_FEATURES = {
  BASIC: {
    tier: "BASIC",
    displayName: "Basic Plan",
    
    // Core features
    rugWarnings: true,
    waitWatchSignals: true,
    liquidityDetection: true,
    whaleDetection: true,
    exitAlerts: true,
    overlay: true,
    
    // Performance
    refreshMs: 800, // Sub-second as promised
    maxWatchlist: 10,
    maxWallets: 5,
    
    // Advanced features (disabled)
    aiDecisionEngine: false,
    momentumDetection: false,
    volumeSurgeAnalysis: false,
    sellPressureTracking: false,
    enterHoldExitStates: false,
    multiTimeframeAnalysis: false,
    smartMoneyFlow: false,
    advancedRiskScoring: false,
    earlyDistributionDetection: false,
    prioritySignalExecution: false,
    earlyFeatureAccess: false
  },
  
  PRO: {
    tier: "PRO",
    displayName: "Pro Plan",
    
    // All BASIC features
    rugWarnings: true,
    waitWatchSignals: true,
    liquidityDetection: true,
    whaleDetection: true,
    exitAlerts: true,
    overlay: true,
    
    // Enhanced performance
    refreshMs: 500, // 2x per second
    maxWatchlist: 50,
    maxWallets: 20,
    
    // PRO features unlocked
    aiDecisionEngine: true,
    momentumDetection: true,
    volumeSurgeAnalysis: true,
    sellPressureTracking: true,
    enterHoldExitStates: true,
    
    // PRO+ features (still locked)
    multiTimeframeAnalysis: false,
    smartMoneyFlow: false,
    advancedRiskScoring: false,
    earlyDistributionDetection: false,
    prioritySignalExecution: false,
    earlyFeatureAccess: false
  },
  
  PROPLUS: {
    tier: "PROPLUS",
    displayName: "Pro+ Plan",
    
    // All features unlocked
    rugWarnings: true,
    waitWatchSignals: true,
    liquidityDetection: true,
    whaleDetection: true,
    exitAlerts: true,
    overlay: true,
    
    // Maximum performance
    refreshMs: 300, // 3x per second
    maxWatchlist: 999, // Unlimited
    maxWallets: 999, // Unlimited
    
    // All features unlocked
    aiDecisionEngine: true,
    momentumDetection: true,
    volumeSurgeAnalysis: true,
    sellPressureTracking: true,
    enterHoldExitStates: true,
    multiTimeframeAnalysis: true,
    smartMoneyFlow: true,
    advancedRiskScoring: true,
    earlyDistributionDetection: true,
    prioritySignalExecution: true,
    earlyFeatureAccess: true
  }
};

// ==========================================
// KEYGEN POLICY MAPPING
// ==========================================

function getTierFromPolicyId(policyId) {
  const basicId = process.env.KEYGEN_POLICY_BASIC;
  const proId = process.env.KEYGEN_POLICY_PRO;
  const proplusId = process.env.KEYGEN_POLICY_PROPLUS;
  
  if (policyId === basicId) return "BASIC";
  if (policyId === proId) return "PRO";
  if (policyId === proplusId) return "PROPLUS";
  
  return null;
}

// ==========================================
// KEYGEN API FUNCTIONS
// ==========================================

async function verifyLicenseWithKeygen(licenseKey) {
  const accountId = process.env.KEYGEN_ACCOUNT_ID;
  const token = process.env.KEYGEN_TOKEN;
  
  if (!accountId || !token) {
    throw new Error("Missing Keygen credentials (KEYGEN_ACCOUNT_ID or KEYGEN_TOKEN)");
  }
  
  // Step 1: Validate the license
  const validateUrl = `https://api.keygen.sh/v1/accounts/${accountId}/licenses/${licenseKey}/actions/validate`;
  
  const validateResp = await fetch(validateUrl, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${token}`,
      "Content-Type": "application/vnd.api+json",
      "Accept": "application/vnd.api+json"
    }
  });
  
  if (!validateResp.ok) {
    const error = await validateResp.json();
    console.log("❌ Keygen validation failed:", error);
    return { valid: false, error: "Invalid or expired license key" };
  }
  
  const validateData = await validateResp.json();
  
  if (validateData.meta?.valid !== true) {
    const detail = validateData.meta?.detail || "License is not valid";
    const code = validateData.meta?.code || "";
    console.log("❌ License not valid:", code, detail);
    return { valid: false, error: detail };
  }
  
  // Step 2: Get full license details
  const licenseUrl = `https://api.keygen.sh/v1/accounts/${accountId}/licenses/${licenseKey}`;
  
  const licenseResp = await fetch(licenseUrl, {
    headers: {
      "Authorization": `Bearer ${token}`,
      "Accept": "application/vnd.api+json"
    }
  });
  
  if (!licenseResp.ok) {
    return { valid: false, error: "Failed to fetch license details" };
  }
  
  const licenseData = await licenseResp.json();
  const policyId = licenseData.data?.relationships?.policy?.data?.id;
  const tier = getTierFromPolicyId(policyId);
  
  if (!tier) {
    console.log("❌ Unknown policy ID:", policyId);
    return { valid: false, error: "Unknown license tier" };
  }
  
  return {
    valid: true,
    tier,
    licenseData: licenseData.data
  };
}

async function activateMachineForLicense(licenseKey, machineId) {
  const accountId = process.env.KEYGEN_ACCOUNT_ID;
  const token = process.env.KEYGEN_TOKEN;
  
  const url = `https://api.keygen.sh/v1/accounts/${accountId}/machines`;
  
  const payload = {
    data: {
      type: "machines",
      attributes: {
        fingerprint: machineId,
        name: `Machine-${machineId.substring(0, 12)}`,
        metadata: {
          activatedAt: new Date().toISOString(),
          extensionVersion: "9.0"
        }
      },
      relationships: {
        license: {
          data: { type: "licenses", id: licenseKey }
        }
      }
    }
  };
  
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${token}`,
      "Content-Type": "application/vnd.api+json",
      "Accept": "application/vnd.api+json"
    },
    body: JSON.stringify(payload)
  });
  
  if (!response.ok) {
    const error = await response.json();
    const errorCode = error.errors?.[0]?.code;
    const errorDetail = error.errors?.[0]?.detail;
    
    // If fingerprint already exists, that's actually OK - already activated
    if (errorCode === "FINGERPRINT_TAKEN" || errorCode === "FINGERPRINT_CONFLICT") {
      console.log("✅ Machine already activated for this license");
      return { activated: true, alreadyActivated: true };
    }
    
    // If no activations left
    if (errorCode === "NO_MACHINES" || errorDetail?.includes("maximum")) {
      console.log("❌ No activations remaining");
      return { activated: false, error: "License already activated on another device" };
    }
    
    console.log("❌ Machine activation failed:", errorCode, errorDetail);
    return { activated: false, error: "Activation failed" };
  }
  
  console.log("✅ Machine activated successfully");
  return { activated: true, alreadyActivated: false };
}

// ==========================================
// ROUTES
// ==========================================

// Health check for license router
router.get("/ping", (req, res) => {
  res.json({ ok: true, message: "License router online" });
});

// POST /license/verify
// Verify a license key and optionally activate machine
router.post("/verify", async (req, res) => {
  try {
    const { key, machineId } = req.body;
    
    // Validate input
    if (!key || typeof key !== "string") {
      return res.status(400).json({ 
        ok: false, 
        error: "License key is required" 
      });
    }
    
    console.log("🔑 License verification request:", {
      keyPrefix: key.substring(0, 12) + "...",
      hasMachineId: !!machineId
    });
    
    // Step 1: Verify with Keygen
    const verifyResult = await verifyLicenseWithKeygen(key);
    
    if (!verifyResult.valid) {
      console.log("❌ Verification failed:", verifyResult.error);
      return res.json({ 
        ok: false, 
        error: verifyResult.error 
      });
    }
    
    const { tier } = verifyResult;
    console.log("✅ License valid - Tier:", tier);
    
    // Step 2: Activate machine if machineId provided
    if (machineId && typeof machineId === "string") {
      const activationResult = await activateMachineForLicense(key, machineId);
      
      if (!activationResult.activated) {
        return res.json({ 
          ok: false, 
          error: activationResult.error || "Machine activation failed" 
        });
      }
      
      if (activationResult.alreadyActivated) {
        console.log("ℹ️  Machine was already activated");
      }
    }
    
    // Step 3: Return tier and features
    const features = TIER_FEATURES[tier];
    
    return res.json({
      ok: true,
      tier,
      features,
      refreshMs: features.refreshMs,
      displayName: features.displayName
    });
    
  } catch (error) {
    console.log("❌ License verification error:", error.message);
    console.log(error.stack);
    
    return res.status(500).json({ 
      ok: false, 
      error: "Internal server error during verification" 
    });
  }
});

// GET /license/features/:tier
// Get feature set for a tier (for documentation/debugging)
router.get("/features/:tier", (req, res) => {
  const tier = req.params.tier.toUpperCase();
  
  if (!TIER_FEATURES[tier]) {
    return res.status(404).json({
      ok: false,
      error: "Unknown tier. Valid tiers: BASIC, PRO, PROPLUS"
    });
  }
  
  return res.json({
    ok: true,
    tier,
    features: TIER_FEATURES[tier]
  });
});

module.exports = router;
