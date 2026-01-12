const express = require("express");
const router = express.Router();

const feedback = [];

router.post("/feedback", express.json(), (req, res) => {
  const { chain, pair, outcome, notes } = req.body || {};

  if (!chain || !pair || !outcome) {
    return res.status(400).json({ error: "missing fields" });
  }

  feedback.unshift({
    time: Date.now(),
    chain,
    pair,
    outcome,
    notes: notes || ""
  });

  if (feedback.length > 500) feedback.pop();

  res.json({ ok: true });
});

module.exports = router;
