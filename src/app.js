const express = require("express");

const assist = require("./routes/assist");
const wallet = require("./routes/wallet");
const contract = require("./routes/contract");
const feedback = require("./routes/feedback");

const shopify = require("./routes/shopify");
const license = require("./routes/license");

const app = express();
app.disable("x-powered-by");

// ✅ CORS for Chrome extension + browser
app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, X-Shopify-Hmac-Sha256, X-Shopify-Topic, X-Shopify-Shop-Domain"
  );
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

// ✅ Health
app.get("/health", (req, res) => res.json({ ok: true }));

/**
 * ✅ IMPORTANT: Mount Shopify webhook FIRST with RAW body
 * Shopify HMAC requires raw request bytes.
 */
app.use("/webhooks/shopify", express.raw({ type: "application/json" }));
app.use("/webhooks/shopify", shopify);

/**
 * ✅ Normal JSON for everything else
 */
app.use(express.json({ limit: "1mb" }));

// Existing routes
app.use(assist);
app.use(wallet);
app.use(contract);
app.use(feedback);

// License routes
app.use(license);

module.exports = app;

