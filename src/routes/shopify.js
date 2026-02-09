// src/routes/shopify.js
const express = require("express");
const crypto = require("crypto");

const router = express.Router();

const KEYGEN_BASE = "https://api.keygen.sh/v1";

/**
 * ✅ Ping route (browser test)
 * https://moon-signal-backend.onrender.com/webhooks/shopify/ping
 */
router.get("/ping", (req, res) => {
  res.json({ ok: true, route: "shopify webhook router alive" });
});

/**
 * ✅ Verify Shopify HMAC using RAW body (Buffer)
 * req.body MUST be a Buffer because app.js uses express.raw() on /webhooks/shopify
 */
function verifyShopifyHmac(req) {
  const secret = process.env.SHOPIFY_WEBHOOK_SECRET;
  const hmacHeader = req.get("X-Shopify-Hmac-Sha256");

  if (!secret) throw new Error("Missing SHOPIFY_WEBHOOK_SECRET env var");
  if (!hmacHeader) throw new Error("Missing X-Shopify-Hmac-Sha256 header");
  if (!req.body || !Buffer.isBuffer(req.body)) {
    throw new Error("Expected raw Buffer body. Check app.js middleware order.");
  }

  const digest = crypto
    .createHmac("sha256", secret)
    .update(req.body)
    .digest("base64");

  const a = Buffer.from(digest);
  const b = Buffer.from(hmacHeader);

  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    throw new Error("Shopify HMAC verification failed");
  }
}

/**
 * ✅ Detect tier from line items (priority: PRO+ > PRO > BASIC)
 */
function detectTier(lineItems) {
  const titles = (lineItems || []).map((li) => String(li.title || "").toUpperCase());

  if (titles.some((t) => t.includes("PRO+"))) return "PROPLUS";
  if (titles.some((t) => t.includes("PRO"))) return "PRO";
  if (titles.some((t) => t.includes("BASIC"))) return "BASIC";

  return null;
}

function policyIdForTier(tier) {
  if (tier === "BASIC") return process.env.KEYGEN_POLICY_BASIC;
  if (tier === "PRO") return process.env.KEYGEN_POLICY_PRO;
  if (tier === "PROPLUS") return process.env.KEYGEN_POLICY_PROPLUS;
  return null;
}

function keygenHeaders() {
  const token = process.env.KEYGEN_TOKEN;
  if (!token) throw new Error("Missing KEYGEN_TOKEN env var");

  return {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/vnd.api+json",
    Accept: "application/vnd.api+json",
  };
}

/**
 * ✅ Shopify webhook endpoint:
 * POST https://moon-signal-backend.onrender.com/webhooks/shopify/order-paid
 */
router.post("/order-paid", async (req, res) => {
  try {
    console.log("✅ Webhook hit: POST /webhooks/shopify/order-paid");
    console.log("Topic:", req.get("X-Shopify-Topic"));
    console.log("Shop:", req.get("X-Shopify-Shop-Domain"));

    // 1) Verify Shopify HMAC
    verifyShopifyHmac(req);
    console.log("✅ Shopify HMAC OK");

    // 2) Parse the order JSON from RAW buffer
    const order = JSON.parse(req.body.toString("utf8"));

    console.log("Order ID:", order?.id);
    console.log("Email:", order?.email);

    const lineItems = (order?.line_items || []).map((li) => ({
      title: li.title,
      sku: li.sku,
      quantity: li.quantity,
      price: li.price,
    }));

    console.log("Line items:", lineItems);

    // 3) Pick tier (highest tier wins)
    const tier = detectTier(lineItems);
    if (!tier) {
      console.log("❌ Tier not recognized from line items");
      return res.status(200).json({ ok: true, note: "Tier not recognized" });
    }
    console.log("✅ Tier:", tier);

    // 4) Create Keygen license for that tier
    const accountId = process.env.KEYGEN_ACCOUNT_ID;
    if (!accountId) throw new Error("Missing KEYGEN_ACCOUNT_ID env var");

    const policyId = policyIdForTier(tier);
    if (!policyId) throw new Error(`Missing policy env var for tier ${tier}`);

    const createLicenseUrl = `${KEYGEN_BASE}/accounts/${accountId}/licenses`;

    const payload = {
      data: {
        type: "licenses",
        attributes: {
          name: `${tier} - ${order?.email || "unknown"}`,
          metadata: {
            tier,
            shopify_order_id: String(order?.id || ""),
            shopify_email: String(order?.email || ""),
          },
        },
        relationships: {
          policy: {
            data: { type: "policies", id: policyId },
          },
        },
      },
    };

    const kgResp = await fetch(createLicenseUrl, {
      method: "POST",
      headers: keygenHeaders(),
      body: JSON.stringify(payload),
    });

    const kgJson = await kgResp.json();

    if (!kgResp.ok) {
      console.log("❌ Keygen error:", kgJson);
      throw new Error(`Keygen license create failed (${kgResp.status})`);
    }

    const licenseKey = kgJson?.data?.attributes?.key;
    console.log("🔑 Keygen license created:", licenseKey);

    // ✅ Respond 200 to Shopify
    return res.status(200).json({ ok: true, tier });
  } catch (err) {
    console.log("❌ Webhook error:", err.message);
    // Return 200 so Shopify doesn't retry spam while debugging
    return res.status(200).json({ ok: false, error: err.message });
  }
});

module.exports = router;
