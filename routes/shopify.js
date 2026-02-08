const express = require("express");
const crypto = require("crypto");

const router = express.Router();

// IMPORTANT:
// Shopify webhook signature is calculated on the *raw* request body.
// So this route uses express.raw() to capture raw bytes.
router.post(
  "/webhooks/shopify/order-paid",
  express.raw({ type: "application/json" }),
  (req, res) => {
    try {
      console.log("✅ SHOPIFY WEBHOOK HIT: /order-paid");

      // 1) Verify signature (HMAC)
      const secret = process.env.SHOPIFY_WEBHOOK_SECRET;
      if (!secret) {
        console.log("❌ Missing SHOPIFY_WEBHOOK_SECRET env var");
        return res.status(500).send("Missing SHOPIFY_WEBHOOK_SECRET");
      }

      const hmacHeader = req.get("X-Shopify-Hmac-Sha256");
      if (!hmacHeader) {
        console.log("❌ Missing X-Shopify-Hmac-Sha256 header");
        return res.status(401).send("Missing HMAC header");
      }

      const rawBody = req.body; // Buffer because of express.raw()
      const digest = crypto
        .createHmac("sha256", secret)
        .update(rawBody, "utf8")
        .digest("base64");

      const valid = crypto.timingSafeEqual(
        Buffer.from(digest),
        Buffer.from(hmacHeader)
      );

      if (!valid) {
        console.log("❌ Invalid Shopify HMAC signature");
        return res.status(401).send("Invalid signature");
      }

      // 2) Parse payload JSON (after signature check)
      const payload = JSON.parse(rawBody.toString("utf8"));

      // 3) Log useful bits (so you SEE it in Render)
      console.log("🧾 Order name:", payload?.name);
      console.log("📧 Email:", payload?.email);
      console.log("💰 Total:", payload?.total_price);
      console.log("🧩 Line items:", (payload?.line_items || []).map(li => ({
        title: li.title,
        quantity: li.quantity,
        sku: li.sku
      })));

      // TODO NEXT: Based on tier product, create a Keygen license + email the key.

      return res.status(200).send("ok");
    } catch (err) {
      console.log("🔥 Webhook handler error:", err?.message || err);
      return res.status(500).send("server error");
    }
  }
);

// OPTIONAL: a simple GET route to confirm the router is mounted
router.get("/webhooks/shopify/ping", (req, res) => {
  console.log("✅ Shopify ping hit");
  res.json({ ok: true });
});

module.exports = router;
