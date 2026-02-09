const express = require("express");
const axios = require("axios");

const router = express.Router();

// ✅ Verify a license key + return tier
router.post("/license/verify", async (req, res) => {
  try {
    const { licenseKey } = req.body;

    if (!licenseKey) return res.status(400).json({ ok: false, error: "Missing licenseKey" });

    const accountId = process.env.KEYGEN_ACCOUNT_ID;
    const token = process.env.KEYGEN_TOKEN;
    if (!accountId) throw new Error("Missing KEYGEN_ACCOUNT_ID env var");
    if (!token) throw new Error("Missing KEYGEN_TOKEN env var");

    const resp = await axios.post(
      `https://api.keygen.sh/v1/accounts/${accountId}/licenses/actions/validate-key`,
      {
        meta: { key: String(licenseKey).trim() },
      },
      {
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/vnd.api+json",
          Accept: "application/vnd.api+json",
        },
      }
    );

    const valid = resp?.data?.meta?.valid === true;
    const license = resp?.data?.data;
    const tier = license?.attributes?.metadata?.tier || "UNKNOWN";

    if (!valid) return res.status(401).json({ ok: false, error: "Invalid license" });

    return res.json({ ok: true, tier });
  } catch (err) {
    console.log("❌ verify error:", err.response?.data || err.message);
    return res.status(401).json({ ok: false, error: "Invalid or expired license key" });
  }
});

// ✅ Activate a machine (1 key = 1 device) using fingerprint
router.post("/license/activate", async (req, res) => {
  try {
    const { licenseKey, machineFingerprint } = req.body;

    if (!licenseKey || !machineFingerprint) {
      return res.status(400).json({ ok: false, error: "Missing licenseKey or machineFingerprint" });
    }

    const accountId = process.env.KEYGEN_ACCOUNT_ID;
    const token = process.env.KEYGEN_TOKEN;
    if (!accountId) throw new Error("Missing KEYGEN_ACCOUNT_ID env var");
    if (!token) throw new Error("Missing KEYGEN_TOKEN env var");

    // 1) validate key
    const validateResp = await axios.post(
      `https://api.keygen.sh/v1/accounts/${accountId}/licenses/actions/validate-key`,
      { meta: { key: String(licenseKey).trim() } },
      {
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/vnd.api+json",
          Accept: "application/vnd.api+json",
        },
      }
    );

    const valid = validateResp?.data?.meta?.valid === true;
    if (!valid) return res.status(401).json({ ok: false, error: "Invalid license" });

    const licenseId = validateResp?.data?.data?.id; // ✅ this is UUID license ID
    const tier = validateResp?.data?.data?.attributes?.metadata?.tier || "UNKNOWN";

    // 2) create machine bound to that license
    const machineResp = await axios.post(
      `https://api.keygen.sh/v1/accounts/${accountId}/machines`,
      {
        data: {
          type: "machines",
          attributes: {
            fingerprint: String(machineFingerprint),
          },
          relationships: {
            license: {
              data: { type: "licenses", id: licenseId },
            },
          },
        },
      },
      {
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/vnd.api+json",
          Accept: "application/vnd.api+json",
        },
      }
    );

    return res.json({
      ok: true,
      tier,
      machineId: machineResp?.data?.data?.id,
    });
  } catch (err) {
    console.log("❌ activate error:", err.response?.data || err.message);
    return res.status(500).json({ ok: false, error: "Activation failed" });
  }
});

module.exports = router;
