const express = require("express");

const assist = require("./routes/assist");
const wallet = require("./routes/wallet");
const contract = require("./routes/contract");
const feedback = require("./routes/feedback");

const app = express();

// Basic security hardening
app.disable("x-powered-by");

// Health check
app.get("/health", (req, res) => {
  res.json({ ok: true });
});

// API routes
app.use(assist);
app.use(wallet);
app.use(contract);
app.use(feedback);

module.exports = app;
