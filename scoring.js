export function scoreSignal({ walletTier, socialVelocity, dexLiquidityUsd, dexVolume24hUsd, priceChange1h, priceChange24h }) {
  const tierScore =
    walletTier === "S" ? 45 :
    walletTier === "A" ? 30 :
    walletTier === "B" ? 18 : 10;

  const socialScore = clamp(socialVelocity ?? 0, 0, 100) * 0.35; // up to 35

  const liqScore = dexLiquidityUsd ? clamp(Math.log10(dexLiquidityUsd + 1) * 10, 0, 15) : 0; // up to 15
  const volScore = dexVolume24hUsd ? clamp(Math.log10(dexVolume24hUsd + 1) * 8, 0, 20) : 0; // up to 20

  // Momentum bumps (small but useful)
  const mom1h = typeof priceChange1h === "number" ? clamp(priceChange1h, -50, 200) * 0.03 : 0;  // ~ -1.5..6
  const mom24 = typeof priceChange24h === "number" ? clamp(priceChange24h, -80, 500) * 0.01 : 0; // ~ -0.8..5

  const total = tierScore + socialScore + liqScore + volScore + mom1h + mom24;
  return Math.round(clamp(total, 0, 100));
}

export function buildReasons({ walletTier, socialVelocity, dexLiquidityUsd, dexVolume24hUsd, priceChange1h, priceChange24h }) {
  const r = [];
  r.push(`Wallet tier: ${walletTier || "?"}`);

  if (typeof socialVelocity === "number") r.push(`Social velocity: ${Math.round(socialVelocity)}/100`);
  if (typeof dexLiquidityUsd === "number") r.push(`Liquidity: $${Math.round(dexLiquidityUsd).toLocaleString()}`);
  if (typeof dexVolume24hUsd === "number") r.push(`24h volume: $${Math.round(dexVolume24hUsd).toLocaleString()}`);
  if (typeof priceChange1h === "number") r.push(`1h: ${priceChange1h.toFixed(2)}%`);
  if (typeof priceChange24h === "number") r.push(`24h: ${priceChange24h.toFixed(2)}%`);

  return r;
}

function clamp(n, a, b) {
  return Math.max(a, Math.min(b, n));
}
