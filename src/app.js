const express = require("express");

const assist = require("./routes/assist");
const wallet = require("./routes/wallet");
const contract = require("./routes/contract");
const feedback = require("./routes/feedback");
const shopify = require("./routes/shopify");
const license = require("./routes/license"); // ✅ NEW

const app = express();
app.disable("x-powered-by");

// Health check
app.get("/health", (req, res) => {
  res.json({ ok: true });
});

// Existing routes (DO NOT CHANGE ORDER)
app.use(assist);
app.use(wallet);
app.use(contract);
app.use(feedback);
app.use(shopify);

// ✅ License verification route
app.use(license);

module.exports = app;
