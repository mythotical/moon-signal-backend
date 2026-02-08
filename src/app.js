// src/app.js
const express = require("express");

const assist = require("./routes/assist");
const wallet = require("./routes/wallet");
const contract = require("./routes/contract");
const feedback = require("./routes/feedback");
const shopify = require("./routes/shopify");

const app = express();
app.disable("x-powered-by");

/**
 * Health check (browser-safe)
 */
app.get("/health", (req, res) => {
  res.json({ ok: true });
});

/**
 * 🔐 Shopify webhooks MUST receive RAW body
 * This MUST come BEFORE express.json()
 */
app.use("/webhooks/shopify", express.raw({ type: "application/json" }));
app.use("/webhooks/shopify", shopify);

/**
 * 🧠 Normal JSON parsing for the rest of the app
 */
app.use(express.json());

/**
 * Existing API routes
 */
app.use(assist);
app.use(wallet);
app.use(contract);
app.use(feedback);

module.exports = app;
