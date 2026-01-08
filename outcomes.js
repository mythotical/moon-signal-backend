// outcomes.js
// Schedules outcome checks (15m + 60m) for wallet-triggered signals using Dexscreener pair fetch.
// If price goes up enough -> win; down enough -> loss; otherwise neutral.

export function createOutcomeTracker({ dexClient, walletRanker, onNote } = {}) {
  const pending = new Map(); // key -> { wallet, chain, id, startPrice, ts, checksDone: Set }

  function keyOf({ wallet, chain, id }) {
    return `${wallet}:${chain}:${id}`;
  }

  async function fetchPairPrice(chain, id) {
    const pair = await dexClient.fetchPair(chain, id);
    if (!pair) return null;

    // Dexscreener commonly returns priceUsd as string
    const p = Number(pair.priceUsd ?? pair.priceNative ?? NaN);
    if (!Number.isFinite(p) || p <= 0) return null;
    return { price: p, pair };
  }

  function scheduleCheck({ wallet, chain, id, minutes, winPct, lossPct }) {
    const delayMs = minutes * 60 * 1000;

    setTimeout(async () => {
      try {
        const k = keyOf({ wallet, chain, id });
        const item = pending.get(k);
        if (!item || item.checksDone.has(minutes)) return;

        const now = await fetchPairPrice(chain, id);
        if (!now) return;

        const pct = ((now.price - item.startPrice) / item.startPrice) * 100;
        item.checksDone.add(minutes);

        if (pct >= winPct) {
          walletRanker.noteWin(wallet);
          onNote?.(`WIN ${minutes}m`, { wallet, chain, id, pct });
        } else if (pct <= -Math.abs(lossPct)) {
          walletRanker.noteLoss(wallet);
          onNote?.(`LOSS ${minutes}m`, { wallet, chain, id, pct });
        } else {
          onNote?.(`NEUTRAL ${minutes}m`, { wallet, chain, id, pct });
        }

        // cleanup after 60m check
        if (minutes >= 60) pending.delete(k);
      } catch {
        // ignore
      }
    }, delayMs);
  }

  async function armFromSignal({ wallet, dexUrl }) {
    if (!wallet || !dexUrl) return false;

    const ctx = dexClient.parseDexUrl(dexUrl);
    if (!ctx) return false;

    const first = await fetchPairPrice(ctx.chain, ctx.id);
    if (!first) return false;

    const k = keyOf({ wallet, chain: ctx.chain, id: ctx.id });

    // Don’t re-arm if already tracking
    if (pending.has(k)) return true;

    pending.set(k, {
      wallet,
      chain: ctx.chain,
      id: ctx.id,
      startPrice: first.price,
      ts: Date.now(),
      checksDone: new Set()
    });

    // 15m and 60m checks (tune thresholds)
    scheduleCheck({ wallet, chain: ctx.chain, id: ctx.id, minutes: 15, winPct: 18, lossPct: 18 });
    scheduleCheck({ wallet, chain: ctx.chain, id: ctx.id, minutes: 60, winPct: 30, lossPct: 25 });

    return true;
  }

  function stats() {
    return { pending: pending.size };
  }

  return { armFromSignal, stats };
}
