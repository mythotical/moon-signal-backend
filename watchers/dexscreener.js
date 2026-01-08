export function createDexscreenerClient() {
  async function fetchJson(url) {
    const res = await fetch(url, { headers: { accept: "application/json" } });
    if (!res.ok) throw new Error(`Dexscreener HTTP ${res.status}`);
    return res.json();
  }

  async function fetchPair(chain, id) {
    const pairUrl = `https://api.dexscreener.com/latest/dex/pairs/${encodeURIComponent(chain)}/${encodeURIComponent(id)}`;
    try {
      const json = await fetchJson(pairUrl);
      if (json?.pair) return json.pair;
    } catch {}

    const tokenPoolsUrl = `https://api.dexscreener.com/token-pairs/v1/${encodeURIComponent(chain)}/${encodeURIComponent(id)}`;
    try {
      const pools = await fetchJson(tokenPoolsUrl);
      if (!Array.isArray(pools) || pools.length === 0) return null;
      pools.sort((a, b) => (b?.liquidity?.usd ?? 0) - (a?.liquidity?.usd ?? 0));
      return pools[0] || null;
    } catch {
      return null;
    }
  }

  function parseDexUrl(url) {
    try {
      const u = new URL(url);
      const parts = u.pathname.split("/").filter(Boolean);
      if (parts.length >= 2) return { chain: parts[0], id: parts[1] };
    } catch {}
    return null;
  }

  return { fetchPair, parseDexUrl };
}
