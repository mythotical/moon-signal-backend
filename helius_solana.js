export function createHeliusWatcher({ apiKey, pollMs, walletsByTier, onSignal }) {
  if (!apiKey) {
    console.log("⚠️ HELIUS_API_KEY missing. Solana watcher disabled.");
    return { start() {}, stop() {} };
  }

  const lastSeenSig = new Map();
  let timer = null;

  async function fetchJson(url) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Helius HTTP ${res.status}`);
    return res.json();
  }

  async function pollWallet(address, tier) {
    const url = `https://api.helius.xyz/v0/addresses/${address}/transactions?api-key=${apiKey}`;
    const txs = await fetchJson(url);

    if (!Array.isArray(txs) || txs.length === 0) return;

    const newestSig = txs[0]?.signature;
    const seen = lastSeenSig.get(address);

    if (!seen) {
      lastSeenSig.set(address, newestSig);
      return;
    }

    for (const tx of txs) {
      if (tx.signature === seen) break;

      onSignal({
        type: "Smart Wallet Activity",
        chain: "SOL",
        wallet: address,
        walletTier: tier,
        scoreHints: { walletTier: tier },
        message: `Tier-${tier} wallet tx: ${tx.signature.slice(0, 8)}…`,
        links: { solscan: `https://solscan.io/tx/${tx.signature}` }
      });
    }

    lastSeenSig.set(address, newestSig);
  }

  async function tick() {
    try {
      for (const tier of Object.keys(walletsByTier)) {
        for (const w of walletsByTier[tier]) {
          await pollWallet(w, tier);
        }
      }
    } catch {}
  }

  return {
    start() {
      if (timer) return;
      timer = setInterval(tick, pollMs);
      tick();
      console.log("✅ Solana watcher armed");
    },
    stop() {
      if (timer) clearInterval(timer);
      timer = null;
    }
  };
}
