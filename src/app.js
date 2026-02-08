const express = require("express");

const assist = require("./routes/assist");
const wallet = require("./routes/wallet");
const contract = require("./routes/contract");
const feedback = require("./routes/feedback");
const shopifyWebhook = require("./routes/shopifyWebhook");

const app = express();
app.disable("x-powered-by");

// ⚠️ JSON for normal routes
app.use(express.json());

app.get("/health", (req, res) => res.json({ ok: true }));

app.use(assist);
app.use(wallet);
app.use(contract);
app.use(feedback);

// 🔥 Shopify webhook LAST (uses raw body)
app.use(shopifyWebhook);

module.exports = app;
