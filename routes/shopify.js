const express = require("express");
const crypto = require("crypto");

const router = express.Router();

// IMPORTANT: raw body required for Shopify signature verification
router.post(
  "/webhooks/shopify/order-paid",
  express.raw({ type: "application/json" }),
  (req, res) => {
    try {
      const hmac = req.headers["x-shopify-hmac-sha256"];
      const body = req.body;

      const generatedHash = crypto
        .createHmac("sha256", process.env.SHOPIFY_WEBHOOK_SECRET)
        .update(body)
        .digest("base64");

      if (generatedHash !== hmac) {
        console.error("❌ Shopify webhook HMAC verification failed");
        return res.status(401).send("Unauthorized");
      }

      const payload = JSON.parse(body.toString());

      console.log("✅ Shopify webhook received");
      console.log("Order ID:", payload.id);
      console.log("Customer email:", payload.email);

      // later: generate Keygen license here
      res.status(200).send("OK");
    } catch (err) {
      console.error("❌ Shopify webhook error:", err);
      res.status(500).send("Server error");
    }
  }
);

module.exports = router;
