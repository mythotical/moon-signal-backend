// Minimal wallet activity watcher using Helius parsed transactions endpoint.
// Emits signals when tracked wallets have new txs.

export function createHeliusWatcher({
  apiKey,
  pollMs = 7000,
  walletsByTier = { S: [], A: [], B: [], C: [] },
  onSignal
}) {
  let timer = null;

  const allWallets = [];
  for (const [tier, arr] of Object.entries(walletsByTier || {})) {
    for (const w of arr || []) allWallets.push({ tier, address: w });
  }

  const seen = new Map(); // address -> lastSignature

  async function fetchLatestSignature(address) {
    const rpc = `https://mainnet.helius-rpc.com/?api-key=${encodeURIComponent(apiKey)}`;
    const body = {
      jsonrpc: "2.0",
      id: 1,
      method: "getSignaturesForAddress",
      params: [address, { limit: 1 }]
    };

    const res = await fetch(rpc, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body)
    });
    const json = await res.json();
    const sig = json?.result?.[0]?.signature || null;
    return sig;
  }

  async function parseTx(signature) {
    // Helius “Parse Transactions” endpoint (array in, array out)
    const url = `https://api-mainnet.helius-rpc.com/v0/transactions/?api-key=${encodeURIComponent(apiKey)}`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ transactions: [signature] })
    });
    const json = await res.json();
    return Array.isArray(json) ? json[0] : null;
  }

  function pickTokenFromParsed(parsed) {
    // best-effort: find a token transfer symbol/mint
    const transfers = parsed?.tokenTransfers;
    if (Array.isArray(transfers) && transfers.length) {
      const t = transfers[0];
      return t?.tokenSymbol || t?.mint || null;
    }
    return null;
  }

  async function tickOne({ tier, address }) {
    const latest = await fetchLatestSignature(address);
    if (!latest) return;

    const prev = seen.get(address);
    if (!prev) {
      seen.set(address, latest);
      return; // first run = baseline, no spam
    }
    if (prev === latest) return;

    seen.set(address, latest);

    // Try parse for more context (optional)
    let token = null;
    try {
      const parsed = await parseTx(latest);
      token = pickTokenFromParsed(parsed);
    } catch {}

    onSignal?.({
      type: "Wallet",
      chain: "SOL",
      token: token || "SOL",
      walletTier: tier,
      message: `Tracked wallet activity (${tier}) — ${address.slice(0, 4)}…${address.slice(-4)}`
    });
  }

  async function tick() {
    // don’t DDOS yourself; rotate wallets
    for (const w of allWallets) {
      try { await tickOne(w); } catch {}
    }
  }

  return {
    start() {
      if (!apiKey) {
        console.log("⚠️ HELIUS_API_KEY missing. Solana watcher disabled.");
        return;
      }
      if (!allWallets.length) {
        console.log("⚠️ No wallets configured. Solana watcher disabled.");
        return;
      }
      if (timer) return;
      console.log("✅ Solana watcher armed");
      timer = setInterval(tick, pollMs);
      tick();
    },
    stop() {
      if (timer) clearInterval(timer);
      timer = null;
    }
  };
}
