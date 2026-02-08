const express = require("express");

const assist = require("./routes/assist");
const wallet = require("./routes/wallet");
const contract = require("./routes/contract");
const feedback = require("./routes/feedback");
const shopify = require("./routes/shopify");

const app = express();
app.disable("x-powered-by");

// ✅ Global request logger (YOU WILL SEE EVERY HIT IN RENDER LOGS)
app.use((req, res, next) => {
  console.log("➡️ INCOMING", req.method, req.url);
  next();
});

// ✅ Health check
app.get("/health", (req, res) => res.json({ ok: true }));

// IMPORTANT:
// Do NOT use app.use(express.json()) globally if you want raw body for Shopify,
// unless you do it conditionally.
// For now, if your other routes require JSON, we’ll add it only for them:

app.use(express.json({ limit: "1mb" })); // for your existing API routes (assist/wallet/etc)

app.use(assist);
app.use(wallet);
app.use(contract);
app.use(feedback);

// Shopify routes include express.raw internally for the webhook POST.
app.use(shopify);

module.exports = app;
