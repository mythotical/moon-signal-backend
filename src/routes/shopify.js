const express = require("express");
const crypto = require("crypto");
const axios = require("axios");

const router = express.Router();

// ✅ IMPORTANT: raw body ONLY for Shopify webhook route
router.post(
  "/webhooks/shopify/order-paid",
  express.raw({ type: "*/*" }),
  async (req, res) => {
    try {
      console.log("✅ Webhook hit: POST /webhooks/shopify/order-paid");

      const shop = req.get("X-Shopify-Shop-Domain") || "unknown";
      const topic = req.get("X-Shopify-Topic") || "unknown";
      console.log("Topic:", topic);
      console.log("Shop:", shop);

      const secret = process.env.SHOPIFY_WEBHOOK_SECRET;
      if (!secret) throw new Error("Missing SHOPIFY_WEBHOOK_SECRET env var");

      const hmacHeader = req.get("X-Shopify-Hmac-Sha256");
      if (!hmacHeader) throw new Error("Missing X-Shopify-Hmac-Sha256 header");

      const rawBody = req.body; // Buffer
      const computed = crypto
        .createHmac("sha256", secret)
        .update(rawBody)
        .digest("base64");

      if (computed !== hmacHeader) {
        console.log("❌ HMAC mismatch");
        return res.status(401).send("HMAC verification failed");
      }

      console.log("✅ Shopify HMAC OK");

      // parse JSON AFTER verifying HMAC
      const payload = JSON.parse(rawBody.toString("utf8"));

      const orderId = payload?.id;
      const email = payload?.email || payload?.customer?.email || null;
      const lineItems = payload?.line_items || [];

      console.log("Order ID:", orderId);
      console.log("Email:", email);
      console.log(
        "Line items:",
        lineItems.map((x) => ({
          title: x.title,
          sku: x.sku ?? null,
          quantity: x.quantity,
          price: String(x.price),
        }))
      );

      // ✅ decide tier from line items
      const titles = lineItems.map((i) => String(i.title || "").toUpperCase());
      const tier =
        titles.includes("PRO+") ? "PROPLUS" : titles.includes("PRO") ? "PRO" : titles.includes("BASIC") ? "BASIC" : null;

      if (!tier) {
        console.log("❌ No tier product found in this order");
        return res.status(200).json({ ok: true, ignored: true });
      }

      console.log(`✅ Tier: ${tier}`);

      // ✅ choose policy env var
      const policyId =
        tier === "BASIC"
          ? process.env.KEYGEN_POLICY_BASIC
          : tier === "PRO"
          ? process.env.KEYGEN_POLICY_PRO
          : process.env.KEYGEN_POLICY_PROPLUS;

      if (!policyId) throw new Error(`Missing policy env var for tier ${tier}`);

      const accountId = process.env.KEYGEN_ACCOUNT_ID;
      if (!accountId) throw new Error("Missing KEYGEN_ACCOUNT_ID env var");

      const token = process.env.KEYGEN_TOKEN;
      if (!token) throw new Error("Missing KEYGEN_TOKEN env var");

      // ✅ Create license in Keygen
      const resp = await axios.post(
        `https://api.keygen.sh/v1/accounts/${accountId}/licenses`,
        {
          data: {
            type: "licenses",
            relationships: {
              policy: {
                data: { type: "policies", id: policyId },
              },
            },
            attributes: {
              // optional metadata
              metadata: {
                shopify_order_id: String(orderId || ""),
                email: email || "",
                tier,
              },
            },
          },
        },
        {
          headers: {
            Authorization: `Bearer ${token}`, // MUST be "prod-...." token value
            "Content-Type": "application/vnd.api+json",
            Accept: "application/vnd.api+json",
          },
        }
      );

      const key = resp?.data?.data?.attributes?.key;
      console.log("🔑 Keygen license created:", key);

      // ✅ For now we just log the key.
      // Next step: email it to customer automatically (we can add after this works).
      return res.status(200).json({ ok: true });
    } catch (err) {
      console.log("❌ Webhook error:", err.response?.data || err.message);
      return res.status(500).json({ ok: false });
    }
  }
);

// quick test route
router.get("/webhooks/shopify/ping", (req, res) => {
  res.json({ ok: true, route: "shopify webhook router alive" });
});

module.exports = router;
