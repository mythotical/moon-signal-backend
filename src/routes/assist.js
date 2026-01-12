// src/routes/assist.js
const express = require("express");
const router = express.Router();

/**
 * ML-assistant endpoint (heuristic baseline).
 * Returns probabilities + regime label.
 * IMPORTANT: assistant does NOT return "ENTER/WAIT" – the extension rules decide.
 */
router.get("/assist/:chain/:pair", async (req, res) => {
  try {
    const { chain, pair } = req.params;

    // Optional: accept computed features from client for consistency.
    // If not provided, you can fetch from Dexscreener here.
    const alpha = Number(req.query.alpha ?? NaN);
    const rug = Number(req.query.rug ?? NaN);
    const chg5 = Number(req.query.chg5 ?? NaN);
    const chg1 = Number(req.query.chg1 ?? NaN);
    const buys5 = Number(req.query.buys5 ?? NaN);
    const sells5 = Number(req.query.sells5 ?? NaN);

    // Heuristic "ML-like" probabilities (stable baseline).
    // Later you can replace this with a real model, keeping the same output schema.
    const tx5 = (Number.isFinite(buys5) ? buys5 : 0) + (Number.isFinite(sells5) ? sells5 : 0);
    const buyRatio = tx5 > 0 ? (buys5 / tx5) : 0.5;

    // Pump probability: high alpha + positive momentum + buy dominance
    const p_pump_30m = clamp01(
      0.15
      + (Number.isFinite(alpha) ? alpha / 160 : 0)
      + (Number.isFinite(chg5) ? Math.max(0, chg5) / 80 : 0)
      + (Number.isFinite(chg1) ? Math.max(0, chg1) / 160 : 0)
      + (buyRatio - 0.5) * 0.8
    );

    // Rug probability: high rug + negative momentum + sell dominance
    const p_rug_15m = clamp01(
      0.10
      + (Number.isFinite(rug) ? rug / 140 : 0)
      + (Number.isFinite(chg5) ? Math.max(0, -chg5) / 60 : 0)
      + (Number.isFinite(chg1) ? Math.max(0, -chg1) / 120 : 0)
      + (0.5 - buyRatio) * 0.9
    );

    const regime =
      p_rug_15m >= 0.62 ? "high-risk" :
      p_pump_30m >= 0.62 ? "momentum" :
      (Number.isFinite(chg5) && chg5 < 0) ? "pullback" :
      "neutral";

    // Confidence in assistant output (not trade confidence)
    const assistantConfidence = clamp01(0.55 + Math.abs(p_pump_30m - p_rug_15m) * 0.65);

    return res.json({
      chain,
      pair,
      p_pump_30m: round3(p_pump_30m),
      p_rug_15m: round3(p_rug_15m),
      regime,
      assistantConfidence: round3(assistantConfidence)
    });
  } catch (e) {
    return res.status(500).json({ error: "assist_failed" });
  }
});

function clamp01(x) {
  if (!Number.isFinite(x)) return 0;
  return Math.max(0, Math.min(1, x));
}
function round3(x) { return Math.round(x * 1000) / 1000; }

module.exports = router;
