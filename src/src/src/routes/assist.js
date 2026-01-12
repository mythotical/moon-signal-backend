const express = require("express");
const router = express.Router();

router.get("/assist/:chain/:pair", (req, res) => {
  const alpha = Number(req.query.alpha || 0);
  const rug = Number(req.query.rug || 0);
  const chg5 = Number(req.query.chg5 || 0);
  const chg1 = Number(req.query.chg1 || 0);
  const buys5 = Number(req.query.buys5 || 0);
  const sells5 = Number(req.query.sells5 || 0);

  const tx5 = buys5 + sells5;
  const buyRatio = tx5 > 0 ? buys5 / tx5 : 0.5;

  // Probability of pump (0–1)
  const p_pump_30m = clamp01(
    0.15 +
    alpha / 160 +
    Math.max(0, chg5) / 80 +
    Math.max(0, chg1) / 160 +
    (buyRatio - 0.5) * 0.8
  );

  // Probability of rug (0–1)
  const p_rug_15m = clamp01(
    0.1 +
    rug / 140 +
    Math.max(0, -chg5) / 60 +
    Math.max(0, -chg1) / 120 +
    (0.5 - buyRatio) * 0.9
  );

  const regime =
    p_rug_15m >= 0.62 ? "high-risk" :
    p_pump_30m >= 0.62 ? "momentum" :
    chg5 < 0 ? "pullback" :
    "neutral";

  const assistantConfidence = clamp01(
    0.55 + Math.abs(p_pump_30m - p_rug_15m) * 0.65
  );

  res.json({
    p_pump_30m: round(p_pump_30m),
    p_rug_15m: round(p_rug_15m),
    regime,
    assistantConfidence: round(assistantConfidence)
  });
});

function clamp01(x) {
  return Math.max(0, Math.min(1, x));
}
function round(x) {
  return Math.round(x * 1000) / 1000;
}

module.exports = router;
