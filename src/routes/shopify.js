// src/routes/shopify.js
const express = require("express");
const crypto = require("crypto");

const router = express.Router();

/**
 * HMAC verification
 * NOTE: app.js MUST mount express.raw({ type: "application/json" })
 * on /webhooks/shopify BEFORE this router.
 * That means: req.body is a Buffer here.
 */
function verifyShopifyHmac(req) {
  const secret = process.env.SHOPIFY_WEBHOOK_SECRET;
  const hmacHeader = req.get("X-Shopify-Hmac-Sha256");

  if (!secret) throw new Error("Missing SHOPIFY_WEBHOOK_SECRET env var");
  if (!hmacHeader) throw new Error("Missing X-Shopify-Hmac-Sha256 header");

  const rawBody = req.body;
  if (!rawBody || !Buffer.isBuffer(rawBody)) {
    throw new Error(
      "Expected req.body to be a Buffer. Check app.js middleware order: express.raw must run before this route."
    );
  }

  const digest = crypto
    .createHmac("sha256", secret)
    .update(rawBody)
    .digest("base64");

  const a = Buffer.from(digest);
  const b = Buffer.from(hmacHeader);

  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    throw new Error("Shopify HMAC verification failed");
  }
}

/**
 * Tier detection that works even if your Shopify product titles are like:
 * "Obsidian BASIC", "BASIC Plan", "PRO+", "Pro Plus", etc.
 */
function detectTier(order) {
  const item = order?.line_items?.[0];
  const title = String(item?.title || item?.name || "").toLowerCase();

  if (title.includes("pro+") || title.includes("pro plus") || title.includes("proplus"))
    return "PROPLUS";
  if (title.includes("pro")) return "PRO";
  if (title.includes("basic")) return "BASIC";

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

/**
 * Shopify webhook endpoint:
 * POST /webhooks/shopify/order-paid
 */
router.post("/order-paid", async (req, res) => {
  try {
    // Log immediately so you KNOW it hit even if HMAC fails
    console.log("✅ Webhook hit: POST /webhooks/shopify/order-paid");
    console.log("Topic:", req.get("X-Shopify-Topic"));
    console.log("Shop:", req.get("X-Shopify-Shop-Domain"));

    // 1) Verify HMAC
    verifyShopifyHmac(req);
    console.log("✅ Shopify HMAC OK");

    // 2) Parse JSON body from raw buffer
    const order = JSON.parse(req.body.toString("utf8"));

    console.log("Order ID:", order?.id);
    console.log("Email:", order?.email);
    console.log(
      "Line items:",
      (order?.line_items || []).map((li) => ({
        title: li.title,
        sku: li.sku,
        quantity: li.quantity,
        price: li.price,
      }))
    );

    // 3) Detect tier
    const tier = detectTier(order);
    if (!tier) {
      console.log("❌ Tier not recognized from line item title.");
      // Return 200 so Shopify doesn't keep retrying forever
      return res.status(200).json({ ok: true, note: "Tier not recognized" });
    }

    const policyId = policyIdForTier(tier);
    if (!policyId) throw new Error(`Missing KEYGEN_POLICY env var for tier ${tier}`);

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
          protected: true,
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

    const keygenResp = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/vnd.api+json",
        Accept: "application/vnd.api+json",
      },
      body: JSON.stringify(payload),
    });

    const keygenJson = await keygenResp.json();

    if (!keygenResp.ok) {
      console.log("❌ Keygen error:", keygenJson);
      throw new Error(`Keygen license create failed (${keygenResp.status})`);
    }

    const licenseKey = keygenJson?.data?.attributes?.key;
    console.log("🔑 Keygen license created:", licenseKey);
    console.log("✅ Tier:", tier);

    // Return 200 so Shopify marks webhook successful
    return res.status(200).json({ ok: true, tier });
  } catch (err) {
    console.log("❌ Webhook error:", err.message);

    // IMPORTANT: Return 200 so Shopify doesn't hammer retries while debugging
    return res.status(200).json({ ok: false, error: err.message });
  }
});

module.exports = router;
