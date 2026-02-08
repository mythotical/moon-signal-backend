const express = require("express");

const shopifyWebhook = require("./routes/shopifyWebhook");

const assist = require("./routes/assist");
const wallet = require("./routes/wallet");
const contract = require("./routes/contract");
const feedback = require("./routes/feedback");

const app = express();
app.disable("x-powered-by");

app.get("/health", (req, res) => res.json({ ok: true }));

// ✅ MUST COME BEFORE express.json()
app.use(shopifyWebhook);

// For your other routes that expect JSON:
app.use(express.json());

app.use(assist);
app.use(wallet);
app.use(contract);
app.use(feedback);

module.exports = app;
