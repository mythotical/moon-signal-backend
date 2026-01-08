// watchers/telegram.js

export function createTelegramWatcher({ botToken, pollMs, allowedChats, onSignal, onVelocity }) {
  if (!botToken) {
    console.log("⚠️ TELEGRAM_BOT_TOKEN missing. Telegram watcher disabled.");
    return { start() {}, stop() {} };
  }

  const allowed = new Set((allowedChats || []).filter(Boolean).map(String));
  let timer = null;
  let offset = 0;

  // Velocity tracking: mentions in last 10 minutes
  const mentionWindowMs = 10 * 60 * 1000;
  const mentions = new Map(); // key -> timestamps[]

  function addMention(key) {
    const now = Date.now();
    const arr = mentions.get(key) || [];
    arr.push(now);

    while (arr.length && now - arr[0] > mentionWindowMs) arr.shift();
    mentions.set(key, arr);

    const v = Math.min(100, arr.length * 10);
    if (typeof onVelocity === "function") onVelocity(v, key);
    return v;
  }

  function extractMentions(text) {
    const out = new Set();
    const t = text || "";

    // $TICKER patterns
    for (const m of t.matchAll(/\$([A-Za-z0-9_]{2,12})/g)) {
      out.add(`$${m[1].toUpperCase()}`);
    }

    // rough Solana mint-like base58 strings
    for (const m of t.matchAll(/\b[1-9A-HJ-NP-Za-km-z]{32,44}\b/g)) {
      out.add(m[0]);
    }

    return [...out];
  }

  async function tg(method, params) {
    const url = `https://api.telegram.org/bot${botToken}/${method}`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(params || {})
    });
    if (!res.ok) throw new Error(`Telegram HTTP ${res.status}`);

    const json = await res.json();
    if (!json.ok) throw new Error("Telegram API error");
    return json.result;
  }

  async function tick() {
    try {
      const updates = await tg("getUpdates", {
        timeout: 0,
        offset,
        allowed_updates: ["message", "channel_post"]
      });

      for (const u of updates) {
        offset = Math.max(offset, (u.update_id || 0) + 1);

        const msg = u.message || u.channel_post;
        if (!msg) continue;

        const chatId = String(msg.chat?.id ?? "");
        if (allowed.size && !allowed.has(chatId)) continue;

        const text = msg.text || msg.caption || "";
        if (!text) continue;

        const who = msg.from?.username
          ? `@${msg.from.username}`
          : (msg.chat?.title || "telegram");

        const keys = extractMentions(text);

        if (!keys.length) {
          onSignal({
            type: "Telegram",
            scoreHints: { socialVelocity: 20 },
            message: `TG ${who}: ${text.slice(0, 180)}`,
            reasons: ["Telegram message", "No token detected"]
          });
          continue;
        }

        for (const k of keys) {
          const v = addMention(k);
          onSignal({
            type: "Telegram Spike",
            token: k,
            chain: "SOCIAL",
            scoreHints: { socialVelocity: v },
            message: `TG ${who}: ${text.slice(0, 180)}`,
            reasons: ["Telegram mention", `Velocity ${Math.round(v)}/100`]
          });
        }
      }
    } catch {
      // keep alive
    }
  }

  return {
    start() {
      if (timer) return;
      timer = setInterval(tick, pollMs);
      tick();
      console.log(`✅ Telegram watcher armed (${pollMs}ms)`);
    },
    stop() {
      if (timer) clearInterval(timer);
      timer = null;
    }
  };
}
