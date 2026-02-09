const express = require("express");

const router = express.Router();

/**
 * Verify license key
 */
router.post("/license/verify", async (req, res) => {
  try {
    const { licenseKey } = req.body;
    if (!licenseKey) return res.status(400).json({ ok: false });

    const resp = await fetch(
      `https://api.keygen.sh/v1/accounts/${process.env.KEYGEN_ACCOUNT_ID}/licenses/actions/validate-key`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.KEYGEN_TOKEN}`,
          "Content-Type": "application/vnd.api+json",
          Accept: "application/vnd.api+json"
        },
        body: JSON.stringify({ meta: { key: licenseKey.trim() } })
      }
    );

    const json = await resp.json();
    if (!json?.meta?.valid) return res.status(401).json({ ok: false });

    const tier = json.data.attributes.metadata?.tier || "UNKNOWN";
    return res.json({ ok: true, tier });

  } catch (err) {
    console.log("❌ Verify error:", err.message);
    return res.status(500).json({ ok: false });
  }
});

/**
 * Activate license to one machine
 */
router.post("/license/activate", async (req, res) => {
  try {
    const { licenseKey, machineFingerprint } = req.body;
    if (!licenseKey || !machineFingerprint) {
      return res.status(400).json({ ok: false });
    }

    // Validate first
    const v = await fetch(
      `https://api.keygen.sh/v1/accounts/${process.env.KEYGEN_ACCOUNT_ID}/licenses/actions/validate-key`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.KEYGEN_TOKEN}`,
          "Content-Type": "application/vnd.api+json"
        },
        body: JSON.stringify({ meta: { key: licenseKey.trim() } })
      }
    );

    const vj = await v.json();
    if (!vj.meta.valid) return res.status(401).json({ ok: false });

    const licenseId = vj.data.id;
    const tier = vj.data.attributes.metadata?.tier || "UNKNOWN";

    const m = await fetch(
      `https://api.keygen.sh/v1/accounts/${process.env.KEYGEN_ACCOUNT_ID}/machines`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.KEYGEN_TOKEN}`,
          "Content-Type": "application/vnd.api+json"
        },
        body: JSON.stringify({
          data: {
            type: "machines",
            attributes: { fingerprint: machineFingerprint },
            relationships: {
              license: {
                data: { type: "licenses", id: licenseId }
              }
            }
          }
        })
      }
    );

    if (!m.ok) return res.status(403).json({ ok: false });

    return res.json({ ok: true, tier });

  } catch (err) {
    console.log("❌ Activate error:", err.message);
    return res.status(500).json({ ok: false });
  }
});

module.exports = router;
