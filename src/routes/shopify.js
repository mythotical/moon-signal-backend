const express = require("express");
const crypto = require("crypto");

const router = express.Router();

/**
 * ✅ Ping route
 * URL: https://moon-signal-backend.onrender.com/webhooks/shopify/ping
 */
router.get("/ping", (req, res) => {
  res.json({ ok: true, route: "shopify webhook alive" });
});

/**
 * ✅ Webhook route
 * URL: https://moon-signal-backend.onrender.com/webhooks/shopify/order-paid
 */
router.post("/order-paid", async (req, res) => {
  try {
    console.log("✅ Webhook hit: POST /webhooks/shopify/order-paid");
    console.log("Topic:", req.get("X-Shopify-Topic"));
    console.log("Shop:", req.get("X-Shopify-Shop-Domain"));

    const secret = process.env.SHOPIFY_WEBHOOK_SECRET;
    if (!secret) throw new Error("Missing SHOPIFY_WEBHOOK_SECRET");

    const hmac = req.get("X-Shopify-Hmac-Sha256");
    if (!hmac) throw new Error("Missing X-Shopify-Hmac-Sha256");

    // req.body is a Buffer because app.js uses express.raw() for /webhooks/shopify
    const rawBody = req.body;

    const digest = crypto
      .createHmac("sha256", secret)
      .update(rawBody)
      .digest("base64");

    if (digest !== hmac) {
      console.log("❌ Shopify HMAC verification failed");
      return res.status(401).send("HMAC failed");
    }

    console.log("✅ Shopify HMAC OK");

    const order = JSON.parse(rawBody.toString("utf8"));
    const email = order?.email || null;
    const lineItems = order?.line_items || [];

    console.log("Order ID:", order?.id);
    console.log("Email:", email);
    console.log("Line items:", lineItems.map((x) => ({ title: x.title, price: x.price })));

    // ✅ Highest tier wins
    const titles = lineItems.map((i) => String(i.title || "").toUpperCase());
    const tier =
      titles.includes("PRO+") ? "PROPLUS" :
      titles.includes("PRO") ? "PRO" :
      titles.includes("BASIC") ? "BASIC" :
      null;

    if (!tier) {
      console.log("❌ No tier detected in order");
      return res.status(200).json({ ok: true, ignored: true });
    }

    console.log("✅ Tier:", tier);

    const policyId =
      tier === "BASIC" ? process.env.KEYGEN_POLICY_BASIC :
      tier === "PRO" ? process.env.KEYGEN_POLICY_PRO :
      process.env.KEYGEN_POLICY_PROPLUS;

    if (!policyId) throw new Error(`Missing policy env var for tier ${tier}`);

    const accountId = process.env.KEYGEN_ACCOUNT_ID;
    const token = process.env.KEYGEN_TOKEN;
    if (!accountId) throw new Error("Missing KEYGEN_ACCOUNT_ID");
    if (!token) throw new Error("Missing KEYGEN_TOKEN");

    const resp = await fetch(`https://api.keygen.sh/v1/accounts/${accountId}/licenses`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/vnd.api+json",
        Accept: "application/vnd.api+json",
      },
      body: JSON.stringify({
        data: {
          type: "licenses",
          relationships: {
            policy: { data: { type: "policies", id: policyId } },
          },
          attributes: {
            metadata: {
              tier,
              email: email || "",
              shopify_order_id: String(order?.id || ""),
            },
          },
        },
      }),
    });

    const json = await resp.json();
    if (!resp.ok) {
      console.log("❌ Keygen error:", json);
      throw new Error(`Keygen license create failed (${resp.status})`);
    }

    console.log("🔑 Keygen license created:", json?.data?.attributes?.key);
    return res.status(200).json({ ok: true });
  } catch (err) {
    console.log("❌ Webhook error:", err.message);
    return res.status(200).json({ ok: false, error: err.message });
  }
});

module.exports = router;
