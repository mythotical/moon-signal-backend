// src/app.js
// Main Express application with all routes
const express = require("express");

// Import route modules
const assist = require("./routes/assist");
const wallet = require("./routes/wallet");
const contract = require("./routes/contract");
const feedback = require("./routes/feedback");
const shopify = require("./routes/shopify");
const license = require("./routes/license"); // ← ADD THIS LINE

const app = express();
app.disable("x-powered-by");

/**
 * Health check (browser-safe)
 */
app.get("/health", (req, res) => {
  res.json({ ok: true, message: "Obsidian backend online" });
});

/**
 * 🔐 Shopify webhooks MUST receive RAW body
 * This MUST come BEFORE express.json()
 */
app.use("/webhooks/shopify", express.raw({ type: "application/json" }));
app.use("/webhooks/shopify", shopify);

/**
 * 🧠 Normal JSON parsing for the rest of the app
 */
app.use(express.json());

/**
 * API routes
 */
app.use(assist);
app.use(wallet);
app.use(contract);
app.use(feedback);
app.use("/license", license); // ← ADD THIS LINE

/**
 * 404 handler
 */
app.use((req, res) => {
  res.status(404).json({ ok: false, error: "Route not found" });
});

module.exports = app;
