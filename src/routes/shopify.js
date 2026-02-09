const express = require("express");
const crypto = require("crypto");

const router = express.Router();

/**
 * Ping test
 */
router.get("/webhooks/shopify/ping", (req, res) => {
  res.json({ ok: true, route: "shopify webhook alive" });
});

/**
 * Shopify webhook (RAW BODY REQUIRED)
 */
router.post(
  "/webhooks/shopify/order-paid",
  express.raw({ type: "*/*" }),
  async (req, res) => {
    try {
      console.log("✅ Webhook hit: POST /webhooks/shopify/order-paid");

      const secret = process.env.SHOPIFY_WEBHOOK_SECRET;
      if (!secret) throw new Error("Missing SHOPIFY_WEBHOOK_SECRET");

      const hmac = req.get("X-Shopify-Hmac-Sha256");
      if (!hmac) throw new Error("Missing Shopify HMAC");

      const rawBody = req.body;

      const digest = crypto
        .createHmac("sha256", secret)
        .update(rawBody)
        .digest("base64");

      if (digest !== hmac) {
        console.log("❌ HMAC mismatch");
        return res.status(401).send("HMAC failed");
      }

      console.log("✅ Shopify HMAC OK");

      const order = JSON.parse(rawBody.toString("utf8"));
      const email = order.email;
      const lineItems = order.line_items || [];

      console.log("Order ID:", order.id);
      console.log("Email:", email);
      console.log("Line items:", lineItems.map(i => i.title));

      // Detect tier (highest wins)
      const titles = lineItems.map(i => String(i.title).toUpperCase());
      const tier =
        titles.includes("PRO+") ? "PROPLUS" :
        titles.includes("PRO") ? "PRO" :
        titles.includes("BASIC") ? "BASIC" :
        null;

      if (!tier) {
        console.log("❌ No tier detected");
        return res.status(200).json({ ok: true });
      }

      console.log("✅ Tier:", tier);

      const policyId =
        tier === "BASIC" ? process.env.KEYGEN_POLICY_BASIC :
        tier === "PRO" ? process.env.KEYGEN_POLICY_PRO :
        process.env.KEYGEN_POLICY_PROPLUS;

      if (!policyId) throw new Error(`Missing policy env for ${tier}`);

      const resp = await fetch(
        `https://api.keygen.sh/v1/accounts/${process.env.KEYGEN_ACCOUNT_ID}/licenses`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${process.env.KEYGEN_TOKEN}`,
            "Content-Type": "application/vnd.api+json",
            Accept: "application/vnd.api+json"
          },
          body: JSON.stringify({
            data: {
              type: "licenses",
              relationships: {
                policy: {
                  data: { type: "policies", id: policyId }
                }
              },
              attributes: {
                metadata: {
                  tier,
                  email,
                  shopify_order_id: String(order.id)
                }
              }
            }
          })
        }
      );

      const data = await resp.json();
      if (!resp.ok) {
        console.log("❌ Keygen error:", data);
        throw new Error("Keygen license creation failed");
      }

      console.log("🔑 Keygen license created:", data.data.attributes.key);
      return res.status(200).json({ ok: true });

    } catch (err) {
      console.log("❌ Webhook error:", err.message);
      return res.status(200).json({ ok: false });
    }
  }
);

module.exports = router;
