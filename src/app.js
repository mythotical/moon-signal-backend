const express = require("express");

// Existing routes
const assist = require("./routes/assist");
const wallet = require("./routes/wallet");
const contract = require("./routes/contract");
const feedback = require("./routes/feedback");

// NEW: Shopify webhook route
const shopify = require("./routes/shopify");

const app = express();
app.disable("x-powered-by");

// IMPORTANT:
// Do NOT use express.json() globally
// Shopify webhooks require RAW body (handled inside the route)

// Health check
app.get("/health", (req, res) => {
  res.json({ ok: true });
});

// Existing routes
app.use(assist);
app.use(wallet);
app.use(contract);
app.use(feedback);

// NEW: Shopify webhooks
app.use(shopify);

module.exports = app;
