// src/routes/shopify.js
const express = require("express");
const router = express.Router();

// Debug ping (to verify route is mounted)
router.get("/ping", (req, res) => {
  console.log("✅ Shopify ping hit");
  return res.json({ ok: true });
});

// Debug endpoint (to verify POST hits your server)
router.post("/order-paid", (req, res) => {
  console.log("✅ Shopify order-paid hit");
  console.log("Headers:", req.headers);
  console.log("Body:", req.body);
  return res.status(200).json({ received: true });
});

module.exports = router;
