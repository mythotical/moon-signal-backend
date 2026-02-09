const express = require("express");

const assist = require("./routes/assist");
const wallet = require("./routes/wallet");
const contract = require("./routes/contract");
const feedback = require("./routes/feedback");
const shopify = require("./routes/shopify");
const license = require("./routes/license");

const app = express();
app.disable("x-powered-by");

/**
 * ✅ CORS (required for Chrome extension)
 */
app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-Shopify-Hmac-Sha256");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

/**
 * ✅ Health check
 */
app.get("/health", (req, res) => res.json({ ok: true }));

/**
 * ✅ JSON for normal routes
 */
app.use(express.json());

/**
 * Existing routes
 */
app.use(assist);
app.use(wallet);
app.use(contract);
app.use(feedback);

/**
 * Shopify webhook + license routes
 */
app.use(shopify);
app.use(license);

module.exports = app;
