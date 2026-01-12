const express = require("express");
const router = express.Router();

const feedback = [];

router.post("/feedback", express.json(), (req, res) => {
  const { chain, pair, outcome, notes } = req.body || {};
  if (!chain || !pair || !outcome) return res.status(400).json({ error: "missing fields" });

  feedback.unshift({
    time: Date.now(),
    chain: String(chain),
    pair: String(pair),
    outcome: String(outcome),
    notes: notes ? String(notes) : ""
  });

  if (feedback.length > 1000) feedback.pop();
  res.json({ ok: true });
});

router.get("/feedback/recent", (req, res) => {
  const limit = Math.min(100, Number(req.query.limit || 50));
  res.json({ feedback: feedback.slice(0, limit) });
});

module.exports = router;
