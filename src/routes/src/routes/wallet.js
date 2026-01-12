// src/routes/wallet.js
const express = require("express");
const router = express.Router();

// In-memory store by default. Replace with Redis/Postgres later.
const hits = []; // { t, token, chain, pair, score, detail }

router.post("/wallet/hit", express.json(), (req, res) => {
  const { token, chain, pair, score, detail } = req.body || {};
  if (!token || !chain) return res.status(400).json({ error: "missing_token_or_chain" });

  hits.unshift({
    t: Date.now(),
    token: String(token),
    chain: String(chain),
    pair: pair ? String(pair) : "",
    score: score ? String(score) : "ARM",
    detail: detail ? String(detail) : ""
  });

  // keep last 200
  while (hits.length > 200) hits.pop();

  res.json({ ok: true });
});

router.get("/wallet/hits", (req, res) => {
  const limit = Math.max(1, Math.min(50, Number(req.query.limit || 20)));
  res.json({ hits: hits.slice(0, limit) });
});

module.exports = router;
