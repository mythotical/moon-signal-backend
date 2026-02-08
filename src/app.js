const express = require("express");

const assist = require("./routes/assist");
const wallet = require("./routes/wallet");
const contract = require("./routes/contract");
const feedback = require("./routes/feedback");
const shopify = require("./routes/shopify");

const app = express();
app.disable("x-powered-by");

app.get("/health", (req, res) => res.json({ ok: true }));

app.use(assist);
app.use(wallet);
app.use(contract);
app.use(feedback);
app.use(shopify);

module.exports = app;
