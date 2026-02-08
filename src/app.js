const express = require("express");

const assist = require("./routes/assist");
const wallet = require("./routes/wallet");
const contract = require("./routes/contract");
const feedback = require("./routes/feedback");
const shopify = require("./routes/shopify");

const app = express();
app.disable("x-powered-by");

// Log all incoming requests
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
  next();
});

app.get("/health", (req, res) => res.json({ ok: true }));

app.use(assist);
app.use(wallet);
app.use(contract);
app.use(feedback);
app.use(shopify);

// 404 handler
app.use((req, res) => {
  console.log("[404] Route not found:", req.method, req.path);
  res.status(404).json({ error: "Not found" });
});

module.exports = app;
