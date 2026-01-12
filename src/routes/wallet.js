const express = require("express");
const router = express.Router();

const hits = [];

router.post("/wallet/hit", express.json(), (req, res) => {
  const { token, chain, pair, score, detail } = req.body || {};
  if (!token || !chain) return res.status(400).json({ error: "missing token or chain" });

  hits.unshift({
    time: Date.now(),
    token: String(token),
    chain: String(chain),
    pair: pair ? String(pair) : "",
    score: score ? String(score) : "ARM",
    detail: detail ? String(detail) : ""
  });

  if (hits.length > 500) hits.pop();
  res.json({ ok: true });
});

router.get("/wallet/hits", (req, res) => {
  const limit = Math.min(100, Number(req.query.limit || 25));
  res.json({ hits: hits.slice(0, limit) });
});

module.exports = router;
