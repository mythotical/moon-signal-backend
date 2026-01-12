// src/routes/feedback.js
const express = require("express");
const router = express.Router();

const feedback = []; // store up to N

router.post("/feedback", express.json(), (req, res) => {
  const { chain, pair, outcome, notes } = req.body || {};
  if (!chain || !pair || !outcome) return res.status(400).json({ error: "missing_fields" });

  feedback.unshift({
    t: Date.now(),
    chain: String(chain),
    pair: String(pair),
    outcome: String(outcome), // e.g. "win", "loss", "rug", "missed"
    notes: notes ? String(notes) : ""
  });
  while (feedback.length > 500) feedback.pop();

  res.json({ ok: true });
});

module.exports = router;
