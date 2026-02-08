const express = require("express");
const crypto = require("crypto");

const router = express.Router();

// IMPORTANT: use express.raw for Shopify webhooks
router.post(
  "/webhooks/shopify/order-paid",
  express.raw({ type: "application/json" }),
  (req, res) => {
    try {
      const hmacHeader = req.get("X-Shopify-Hmac-Sha256");
      const secret = process.env.SHOPIFY_WEBHOOK_SECRET;

      // 1) Basic logging so we KNOW it hit
      console.log("✅ Shopify webhook HIT: /order-paid");
      console.log("Topic:", req.get("X-Shopify-Topic"));
      console.log("Shop:", req.get("X-Shopify-Shop-Domain"));

      // 2) Verify HMAC (optional to start, but recommended)
      if (!secret) {
        console.log("⚠️ Missing SHOPIFY_WEBHOOK_SECRET env var");
        return res.status(500).send("Missing secret");
      }

      const digest = crypto
        .createHmac("sha256", secret)
        .update(req.body)
        .digest("base64");

      if (digest !== hmacHeader) {
        console.log("❌ Shopify HMAC invalid");
        return res.status(401).send("Invalid signature");
      }

      // 3) Parse JSON body
      const payload = JSON.parse(req.body.toString("utf8"));

      console.log("✅ Shopify HMAC OK");
      console.log("Order ID:", payload?.id);
      console.log("Email:", payload?.email);
      console.log("Line items:", payload?.line_items?.map(i => `${i.title} x${i.quantity}`));

      // TODO: create Keygen license here based on line_items

      return res.status(200).send("ok");
    } catch (err) {
      console.error("Webhook error:", err);
      return res.status(500).send("Webhook error");
    }
  }
);

module.exports = router;
