// watchers/dexscreener.js
// Tries pair endpoint first. If not found, falls back to token pools endpoint.

export function createDexscreenerClient() {
  async function fetchJson(url) {
    const res = await fetch(url, { headers: { accept: "application/json" } });
    if (!res.ok) throw new Error(`Dexscreener HTTP ${res.status}`);
    return res.json();
  }

  async function fetchPair(chain, id) {
    // 1) Try "pair by chain + pairId"
    const pairUrl = `https://api.dexscreener.com/latest/dex/pairs/${encodeURIComponent(
      chain
    )}/${encodeURIComponent(id)}`;

    try {
      const json = await fetchJson(pairUrl);
      if (json?.pair) return json.pair;
    } catch {
      // fall through
    }

    // 2) Fallback: treat "id" as token address and fetch pools
    const tokenPoolsUrl = `https://api.dexscreener.com/token-pairs/v1/${encodeURIComponent(
      chain
    )}/${encodeURIComponent(id)}`;

    try {
      const pools = await fetchJson(tokenPoolsUrl);
      if (!Array.isArray(pools) || pools.length === 0) return null;

      // pick best pool by liquidity.usd
      pools.sort((a, b) => (b?.liquidity?.usd ?? 0) - (a?.liquidity?.usd ?? 0));
      return pools[0] || null;
    } catch {
      return null;
    }
  }

  function parseDexUrl(url) {
    // https://dexscreener.com/<chain>/<id>
    try {
      const u = new URL(url);
      const parts = u.pathname.split("/").filter(Boolean);
      if (parts.length >= 2) return { chain: parts[0], id: parts[1] };
    } catch {}
    return null;
  }

  return { fetchPair, parseDexUrl };
}
