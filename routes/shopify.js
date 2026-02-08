const express = require("express");
const crypto = require("crypto");

const router = express.Router();

router.post(
  "/webhooks/shopify/order-paid",
  express.raw({ type: "application/json" }),
  (req, res) => {
    console.log("🟢 Shopify webhook received");

    const hmac = req.headers["x-shopify-hmac-sha256"];
    const body = req.body;

    const digest = crypto
      .createHmac("sha256", process.env.SHOPIFY_WEBHOOK_SECRET)
      .update(body, "utf8")
      .digest("base64");

    if (digest !== hmac) {
      console.error("❌ Invalid Shopify signature");
      return res.status(401).send("Invalid signature");
    }

    const order = JSON.parse(body.toString("utf8"));

    console.log("✅ Order paid:", {
      email: order.email,
      items: order.line_items.map(i => ({
        title: i.title,
        sku: i.sku
      }))
    });

    // We’ll issue Keygen licenses here next
    res.status(200).send("OK");
  }
);

module.exports = router;
