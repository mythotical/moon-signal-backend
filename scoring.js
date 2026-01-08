export function scoreSignal({
  walletTier,
  socialVelocity = 0,
  dexLiquidityUsd = null,
  dexVolume24hUsd = null,
  priceChange1h = null,
  priceChange24h = null
}) {
  let score = 20;

  // Wallet tier boosts
  if (walletTier === "S") score += 50;
  else if (walletTier === "A") score += 35;
  else if (walletTier === "B") score += 20;
  else if (walletTier === "C") score += 10;

  // Social velocity boosts (0..100+)
  score += Math.min(30, Math.floor(socialVelocity / 3));

  // Dex fundamentals
  if (typeof dexLiquidityUsd === "number") {
    if (dexLiquidityUsd >= 100000) score += 18;
    else if (dexLiquidityUsd >= 50000) score += 14;
    else if (dexLiquidityUsd >= 20000) score += 10;
    else if (dexLiquidityUsd >= 10000) score += 6;
    else if (dexLiquidityUsd >= 5000) score += 3;
    else score -= 4;
  }

  if (typeof dexVolume24hUsd === "number") {
    if (dexVolume24hUsd >= 500000) score += 12;
    else if (dexVolume24hUsd >= 200000) score += 9;
    else if (dexVolume24hUsd >= 100000) score += 7;
    else if (dexVolume24hUsd >= 25000) score += 4;
    else score -= 2;
  }

  // Momentum
  if (typeof priceChange1h === "number") {
    if (priceChange1h >= 80) score += 8;
    else if (priceChange1h >= 30) score += 5;
    else if (priceChange1h <= -40) score -= 6;
  }
  if (typeof priceChange24h === "number") {
    if (priceChange24h >= 200) score += 6;
    else if (priceChange24h <= -60) score -= 6;
  }

  score = Math.max(0, Math.min(100, Math.round(score)));
  return score;
}

export function buildReasons({
  walletTier,
  socialVelocity = 0,
  dexLiquidityUsd = null,
  dexVolume24hUsd = null,
  priceChange1h = null,
  priceChange24h = null
}) {
  const r = [];

  if (walletTier) r.push(`Wallet tier: ${walletTier}`);

  if (socialVelocity >= 60) r.push("Social velocity: HIGH");
  else if (socialVelocity >= 30) r.push("Social velocity: MED");
  else if (socialVelocity > 0) r.push("Social velocity: LOW");

  if (typeof dexLiquidityUsd === "number") r.push(`Liquidity: $${Math.round(dexLiquidityUsd).toLocaleString()}`);
  if (typeof dexVolume24hUsd === "number") r.push(`Vol(24h): $${Math.round(dexVolume24hUsd).toLocaleString()}`);

  if (typeof priceChange1h === "number") r.push(`1h: ${priceChange1h}%`);
  if (typeof priceChange24h === "number") r.push(`24h: ${priceChange24h}%`);

  return r.slice(0, 6);
}
