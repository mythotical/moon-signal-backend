// src/app.js
const express = require("express");

const assist = require("./routes/assist");
const wallet = require("./routes/wallet");
const contract = require("./routes/contract");
const feedback = require("./routes/feedback");
const shopify = require("./routes/shopify");

const app = express();
app.disable("x-powered-by");

// ✅ MUST have this to read JSON bodies
app.use(express.json());

// ✅ simple request logger so you SEE hits in Render logs
app.use((req, res, next) => {
  console.log(`➡️ ${req.method} ${req.path}`);
  next();
});

app.get("/health", (req, res) => res.json({ ok: true }));

app.use(assist);
app.use(wallet);
app.use(contract);
app.use(feedback);

// ✅ Mount Shopify routes under the correct prefix
app.use("/webhooks/shopify", shopify);

module.exports = app;
