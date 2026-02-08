const express = require("express");
const crypto = require("crypto");

const router = express.Router();

// IMPORTANT: Shopify needs raw body for HMAC validation
router.post(
  "/webhooks/shopify/order-paid",
  express.raw({ type: "application/json" }),
  (req, res) => {
    // LOG FIRST so you can’t miss it
    console.log("✅ WEBHOOK HIT /webhooks/shopify/order-paid");
    console.log("Topic:", req.get("X-Shopify-Topic"));
    console.log("Shop:", req.get("X-Shopify-Shop-Domain"));

    const secret = process.env.SHOPIFY_WEBHOOK_SECRET;
    const hmac = req.get("X-Shopify-Hmac-Sha256");

    if (!secret) {
      console.log("❌ Missing SHOPIFY_WEBHOOK_SECRET");
      return res.status(500).send("Missing secret");
    }

    const digest = crypto
      .createHmac("sha256", secret)
      .update(req.body)
      .digest("base64");

    if (digest !== hmac) {
      console.log("❌ HMAC INVALID");
      return res.status(401).send("Invalid signature");
    }

    console.log("✅ HMAC OK");

    const payload = JSON.parse(req.body.toString("utf8"));
    console.log("Order:", payload?.id, "Email:", payload?.email);

    return res.status(200).send("ok");
  }
);

module.exports = router;
