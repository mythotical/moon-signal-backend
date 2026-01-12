const express = require("express");
const router = express.Router();

const hits = [];

router.post("/wallet/hit", express.json(), (req, res) => {
  const { token, chain, pair, score, detail } = req.body || {};

  if (!token || !chain) {
    return res.status(400).json({ error: "missing token or chain" });
  }

  hits.unshift({
    time: Date.now(),
    token,
    chain,
    pair: pair || "",
    score: score || "ARM",
    detail: detail || ""
  });

  if (hits.length > 200) hits.pop();

  res.json({ ok: true });
});

router.get("/wallet/hits", (req, res) => {
  const limit = Math.min(50, Number(req.query.limit || 20));
  res.json({ hits: hits.slice(0, limit) });
});

module.exports = router;
