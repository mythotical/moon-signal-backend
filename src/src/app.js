const express = require("express");

const assist = require("./routes/assist");
const wallet = require("./routes/wallet");
const contract = require("./routes/contract");
const feedback = require("./routes/feedback");

const shopify = require("./routes/shopify");
const license = require("./routes/license");

const app = express();
app.disable("x-powered-by");

// ✅ CORS (needed for Chrome extension + browser calls)
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

app.get("/health", (req, res) => res.json({ ok: true }));

// ✅ Shopify webhook router (uses raw body INSIDE shopify.js)
app.use(shopify);

// ✅ Everything else uses JSON
app.use(express.json({ limit: "1mb" }));

app.use(assist);
app.use(wallet);
app.use(contract);
app.use(feedback);

// ✅ License verify route for the extension
app.use(license);

module.exports = app;
