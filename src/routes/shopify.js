const express = require("express");
const crypto = require("crypto");

const router = express.Router();

/**
 * Shopify sends HMAC in header: X-Shopify-Hmac-Sha256
 * HMAC is computed over RAW request body bytes.
 */
function verifyShopifyHmac(req) {
  const secret = process.env.SHOPIFY_WEBHOOK_SECRET;
  const hmacHeader = req.get("X-Shopify-Hmac-Sha256");

  if (!secret) throw new Error("Missing SHOPIFY_WEBHOOK_SECRET env var");
  if (!hmacHeader) throw new Error("Missing X-Shopify-Hmac-Sha256 header");

  // Because we mounted express.raw() in app.js, req.body is a Buffer here
  const rawBody = req.body;
  if (!rawBody || !Buffer.isBuffer(rawBody)) {
    throw new Error("Expected raw body Buffer but got none (check express.raw middleware order)");
  }

  const digest = crypto
    .createHmac("sha256", secret)
    .update(rawBody)
    .digest("base64");

  // timing-safe compare
  const a = Buffer.from(digest);
  const b = Buffer.from(hmacHeader);

  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    throw new Error("Shopify HMAC verification failed");
  }
}

function pickTierFromOrder(order) {
  const title =
    order?.line_items?.[0]?.title ||
    order?.line_items?.[0]?.name ||
    "";

  const t = String(title).toLowerCase();

  if (t.includes("pro+")
   || t.includes("pro plus")
   || t.includes("proplus")) return "PROPLUS";

  if (t.includes("pro")) return "PRO";
  if (t.includes("basic")) return "BASIC";

  return null;
}

function policyIdForTier(tier) {
  if (tier === "BASIC") return process.env.KEYGEN_POLICY_BASIC;
  if (tier === "PRO") return process.env.KEYGEN_POLICY_PRO;
  if (tier === "PROPLUS") return process.env.KEYGEN_POLICY_PROPLUS;
  return null;
}

router.get("/ping", (req, res) => {
  res.json({ ok: true, route: "shopify webhook router alive" });
});

router.post("/order-paid", async (req, res) => {
  try {
    // 1) Verify signature (requires raw body)
    verifyShopifyHmac(req);

    // 2) Parse JSON from raw buffer
    const order = JSON.parse(req.body.toString("utf8"));

    console.log("✅ Shopify webhook received: order-paid");
    console.log("Order id:", order?.id);
    console.log("Email:", order?.email);
    console.log("Line item title:", order?.line_items?.[0]?.title);

    // 3) Determine tier
    const tier = pickTierFromOrder(order);
    if (!tier) {
      console.log("❌ Could not determine tier from order line item title.");
      return res.status(200).json({ ok: true, note: "Webhook received, but tier not recognized" });
    }

    const policyId = policyIdForTier(tier);
    if (!policyId) {
      throw new Error(`Missing Keygen policy env var for tier ${tier}`);
    }

    // 4) Create Keygen license
    const accountId = process.env.KEYGEN_ACCOUNT_ID;
    const token = process.env.KEYGEN_TOKEN;

    if (!accountId) throw new Error("Missing KEYGEN_ACCOUNT_ID env var");
    if (!token) throw new Error("Missing KEYGEN_TOKEN env var");

    const url = `https://api.keygen.sh/v1/accounts/${accountId}/licenses`;

    const payload = {
      data: {
        type: "licenses",
        attributes: {
          name: `${tier} - ${order?.email || "unknown"}`,
          protected: true
        },
        relationships: {
          policy: {
            data: { type: "policies", id: policyId }
          }
        }
      }
    };

    const resp = await fetch(url, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${token}`,
        "Content-Type": "application/vnd.api+json",
        "Accept": "application/vnd.api+json"
      },
      body: JSON.stringify(payload)
    });

    const data = await resp.json();
    if (!resp.ok) {
      console.log("❌ Keygen error:", data);
      throw new Error(`Keygen create license failed (${resp.status})`);
    }

    const licenseKey = data?.data?.attributes?.key;
    console.log("🔑 Keygen license created:", licenseKey);

    // 5) Respond to Shopify quickly
    return res.status(200).json({ ok: true, tier, licenseKey });
  } catch (err) {
    console.log("❌ Webhook error:", err.message);
    return res.status(200).json({ ok: false, error: err.message }); // Shopify expects 200s often
  }
});

module.exports = router;
