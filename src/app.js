// src/app.js
const express = require("express");

const assist = require("./routes/assist");
const wallet = require("./routes/wallet");
const contract = require("./routes/contract");
const feedback = require("./routes/feedback");
const shopify = require("./routes/shopify");
const license = require("./routes/license");

const app = express();
app.disable("x-powered-by");

// Health check
app.get("/health", (req, res) => res.json({ ok: true }));

/**
 * ✅ Shopify webhooks MUST use RAW body for HMAC verification
 * This MUST be mounted BEFORE express.json()
 */
app.use("/webhooks/shopify", express.raw({ type: "application/json" }));
app.use("/webhooks/shopify", shopify);

/**
 * ✅ Normal JSON parsing for everything else
 */
app.use(express.json());

// Existing API routes (unchanged)
app.use(assist);
app.use(wallet);
app.use(contract);
app.use(feedback);

// ✅ License verification route
app.use(license);

module.exports = app;
