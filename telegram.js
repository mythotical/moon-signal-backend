export function createTelegramWatcher({
  botToken,
  pollMs = 3000,
  allowedChats = [],
  onVelocity,
  onSignal
}) {
  let timer = null;
  let offset = 0;

  // rolling velocity window
  const hits = []; // timestamps of “token mention” events

  function bumpVelocity() {
    const now = Date.now();
    // keep last 5 minutes
    while (hits.length && now - hits[0] > 5 * 60 * 1000) hits.shift();
    const v = hits.length; // mentions/5min
    onVelocity?.(Math.min(100, v * 2)); // convert to 0..100-ish
  }

  function extractTickers(text) {
    // $PEPE, $BONK, etc (2-12 chars)
    const m = text.match(/\$[A-Za-z0-9]{2,12}/g);
    return (m || []).map((x) => x.toUpperCase());
  }

  async function poll() {
    try {
      const url = `https://api.telegram.org/bot${botToken}/getUpdates?timeout=30&offset=${offset}`;
      const res = await fetch(url);
      const json = await res.json();

      if (!json?.ok || !Array.isArray(json.result)) return;

      for (const upd of json.result) {
        offset = Math.max(offset, (upd.update_id || 0) + 1);

        const msg = upd.message || upd.channel_post;
        if (!msg) continue;

        const chatId = String(msg.chat?.id ?? "");
        if (allowedChats.length && !allowedChats.includes(chatId)) continue;

        const text = (msg.text || msg.caption || "").trim();
        if (!text) continue;

        const tickers = extractTickers(text);
        if (!tickers.length) continue;

        hits.push(Date.now());
        bumpVelocity();

        const token = tickers[0].replace("$", "");
        onSignal?.({
          type: "Telegram",
          token,
          chain: "SOCIAL",
          walletTier: null,
          scoreHints: { socialVelocity: 60 },
          message: `Telegram mention: ${tickers.join(" ")}`
        });
      }
    } catch {
      // ignore
    }
  }

  return {
    start() {
      if (!botToken) {
        console.log("⚠️ TELEGRAM_BOT_TOKEN missing. Telegram watcher disabled.");
        return;
      }
      if (timer) return;
      console.log("✅ Telegram watcher armed");
      timer = setInterval(poll, pollMs);
      poll();
    },
    stop() {
      if (timer) clearInterval(timer);
      timer = null;
    }
  };
}
