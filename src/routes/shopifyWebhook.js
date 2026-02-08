const express = require("express");
const crypto = require("crypto");
const { issueLicenseKey } = require("../services/keygen");

const router = express.Router();

// IMPORTANT: RAW BODY for Shopify verification
router.post(
  "/webhooks/shopify/order-paid",
  express.raw({ type: "application/json" }),
  async (req, res) => {
    try {
      // 1️⃣ Verify Shopify signature
      const hmac = req.get("X-Shopify-Hmac-Sha256");
      const digest = crypto
        .createHmac("sha256", process.env.SHOPIFY_WEBHOOK_SECRET)
        .update(req.body)
        .digest("base64");

      if (hmac !== digest) {
        return res.status(401).send("Invalid webhook signature");
      }

      // 2️⃣ Parse order
      const order = JSON.parse(req.body.toString("utf8"));
      if (order.financial_status !== "paid") {
        return res.status(200).send("Not paid");
      }

      const email = order.email || order.customer?.email;
      if (!email) return res.status(200).send("No email");

      // 3️⃣ Detect tier via SKU (BEST METHOD)
      const skus = order.line_items.map(i => (i.sku || "").toUpperCase());

      let tier = null;
      if (skus.includes("OBS-BASIC")) tier = "basic";
      if (skus.includes("OBS-PRO")) tier = "pro";
      if (skus.includes("OBS-PROPLUS")) tier = "pro_plus";

      if (!tier) return res.status(200).send("Tier not detected");

      // 4️⃣ Create 1-time license key
      const { key } = await issueLicenseKey({
        email,
        tier,
        orderId: order.id,
      });

      // 5️⃣ TEMP: log key (later email it)
      console.log(`LICENSE ISSUED → ${email} → ${tier}: ${key}`);

      res.status(200).send("OK");
    } catch (err) {
      console.error("Shopify webhook error:", err);
      res.status(500).send("Server error");
    }
  }
);

module.exports = router;
