const express = require("express");
const crypto = require("crypto");

const router = express.Router();

function timingSafeEqual(a, b) {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

function verifyShopifyHmac(rawBodyBuffer, hmacHeader, secret) {
  const digest = crypto
    .createHmac("sha256", secret)
    .update(rawBodyBuffer)
    .digest("base64");

  return timingSafeEqual(digest, String(hmacHeader || ""));
}

function pickTierFromLineItems(lineItems) {
  // prioritize highest tier
  const titles = (lineItems || []).map((li) => String(li.title || "").trim().toUpperCase());
  if (titles.includes("PRO+") || titles.includes("PROPLUS")) return "PROPLUS";
  if (titles.includes("PRO")) return "PRO";
  if (titles.includes("BASIC")) return "BASIC";
  return null;
}

async function keygenCreateLicense({ accountId, token, policyId, tier, email, orderId }) {
  const url = `https://api.keygen.sh/v1/accounts/${accountId}/licenses`;

  const body = {
    data: {
      type: "licenses",
      attributes: {
        metadata: {
          tier,
          customer_email: email || "",
          shopify_order_id: String(orderId || ""),
          source: "shopify",
        },
      },
      relationships: {
        policy: { data: { type: "policies", id: policyId } },
      },
    },
  };

  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/vnd.api+json",
      Accept: "application/vnd.api+json",
    },
    body: JSON.stringify(body),
  });

  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(`Keygen license create failed (${res.status})`);
    err.details = json;
    throw err;
  }

  return json?.data?.attributes?.key;
}

/**
 * ✅ Ping (this MUST work)
 * URL: https://moon-signal-backend.onrender.com/webhooks/shopify/ping
 */
router.get("/ping", (req, res) => {
  res.json({ ok: true, route: "shopify webhook router alive" });
});

/**
 * ✅ Shopify orders/paid webhook
 * URL: https://moon-signal-backend.onrender.com/webhooks/shopify/order-paid
 */
router.post("/order-paid", async (req, res) => {
  try {
    console.log("✅ Webhook hit: POST /webhooks/shopify/order-paid");
    console.log("Topic:", req.get("X-Shopify-Topic"));
    console.log("Shop:", req.get("X-Shopify-Shop-Domain"));

    const secret = process.env.SHOPIFY_WEBHOOK_SECRET;
    if (!secret) throw new Error("Missing SHOPIFY_WEBHOOK_SECRET env var");

    const hmac = req.get("X-Shopify-Hmac-Sha256");
    if (!hmac) throw new Error("Missing X-Shopify-Hmac-Sha256 header");

    // req.body is a Buffer because app.js used express.raw() for /webhooks/shopify
    const raw = req.body;
    if (!raw || !Buffer.isBuffer(raw)) throw new Error("Expected raw Buffer body");

    if (!verifyShopifyHmac(raw, hmac, secret)) {
      throw new Error("Shopify HMAC verification failed");
    }

    console.log("✅ Shopify HMAC OK");

    const payload = JSON.parse(raw.toString("utf8"));
    const orderId = payload?.id;
    const email = payload?.email;
    const lineItems = payload?.line_items || [];

    console.log("Order ID:", orderId);
    console.log("Email:", email);
    console.log(
      "Line items:",
      lineItems.map((li) => ({ title: li.title, quantity: li.quantity, price: li.price }))
    );

    const tier = pickTierFromLineItems(lineItems);
    if (!tier) {
      console.log("⚠️ No tier detected in order (ignoring).");
      return res.status(200).json({ ok: true, ignored: true });
    }

    console.log("✅ Tier:", tier);

    const accountId = process.env.KEYGEN_ACCOUNT_ID;
    const token = process.env.KEYGEN_TOKEN;
    if (!accountId) throw new Error("Missing KEYGEN_ACCOUNT_ID env var");
    if (!token) throw new Error("Missing KEYGEN_TOKEN env var");

    const policyId =
      tier === "BASIC"
        ? process.env.KEYGEN_POLICY_BASIC
        : tier === "PRO"
        ? process.env.KEYGEN_POLICY_PRO
        : process.env.KEYGEN_POLICY_PROPLUS;

    if (!policyId) throw new Error(`Missing policy env var for tier ${tier}`);

    const licenseKey = await keygenCreateLicense({
      accountId,
      token,
      policyId,
      tier,
      email,
      orderId,
    });

    console.log("🔑 Keygen license created:", licenseKey);
    console.log("✅ Tier:", tier);

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.log("❌ Webhook error:", err.message);
    if (err.details) console.log("❌ Keygen details:", err.details);
    return res.status(200).json({ ok: false, error: err.message });
  }
});

module.exports = router;
