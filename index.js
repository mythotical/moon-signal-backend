import "dotenv/config";
import fs from "fs";
import express from "express";
import http from "http";
import cors from "cors";
import { WebSocketServer } from "ws";

import { createHeliusWatcher } from "./watchers/helius_solana.js";
import { createTelegramWatcher } from "./watchers/telegram.js";
import { createXWatcher } from "./watchers/x_influencers.js";
import { createDexscreenerClient } from "./watchers/dexscreener.js";

import { scoreSignal, buildReasons } from "./scoring.js";
import { computeRugRiskFromDexPair } from "./rugrisk.js";

const PORT = Number(process.env.PORT || 8080);

const HELIUS_API_KEY = process.env.HELIUS_API_KEY || "";
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || "";
const TELEGRAM_ALLOWED_CHATS = (process.env.TELEGRAM_ALLOWED_CHATS || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

const X_BEARER_TOKEN = process.env.X_BEARER_TOKEN || "";
const X_HANDLES = (process.env.X_HANDLES || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

const DEX_REFRESH_MS = Number(process.env.DEX_REFRESH_MS || 15000);

let walletsByTier = { S: [], A: [], B: [], C: [] };
try {
  const j = JSON.parse(fs.readFileSync("./wallets.json", "utf-8"));
  walletsByTier = j?.tiers || walletsByTier;
} catch {
  console.log("⚠️ wallets.json missing/invalid.");
}

const app = express();
app.use(cors());
app.use(express.json());

const server = http.createServer(app);
const wss = new WebSocketServer({ server });

const latestSignals = [];
let lastSocialVelocity = 0;

function broadcast(obj) {
  const msg = JSON.stringify(obj);
  for (const client of wss.clients) {
    if (client.readyState === 1) client.send(msg);
  }
}

function pushSignal(raw) {
  const walletTier = raw?.walletTier || null;

  const socialVelocity =
    typeof raw?.scoreHints?.socialVelocity === "number"
      ? raw.scoreHints.socialVelocity
      : lastSocialVelocity;

  const dexLiquidityUsd = raw?.dexLiquidityUsd ?? null;
  const dexVolume24hUsd = raw?.dexVolume24hUsd ?? null;
  const priceChange1h = raw?.priceChange1h ?? null;
  const priceChange24h = raw?.priceChange24h ?? null;

  const score = scoreSignal({
    walletTier,
    socialVelocity,
    dexLiquidityUsd,
    dexVolume24hUsd,
    priceChange1h,
    priceChange24h
  });

  const reasons = raw?.reasons?.length
    ? raw.reasons
    : buildReasons({
        walletTier,
        socialVelocity,
        dexLiquidityUsd,
        dexVolume24hUsd,
        priceChange1h,
        priceChange24h
      });

  const s = {
    id: globalThis.crypto?.randomUUID?.() || String(Date.now()),
    ts: Date.now(),
    score,
    reasons,
    ...raw
  };

  latestSignals.unshift(s);
  latestSignals.splice(200);
  broadcast(s);
}

// Websocket connects
wss.on("connection", (ws) => {
  ws.send(
    JSON.stringify({
      type: "System",
      token: "MOON",
      score: 100,
      message: "✅ Connected to Moon Signal (live backend)"
    })
  );
});

// Routes
app.get("/", (req, res) => res.send("Moon Signal backend OK"));

app.get("/feed", (req, res) => {
  res.json(latestSignals.slice(0, 20));
});

// One-click test
app.get("/test-signal", (req, res) => {
  pushSignal({
    type: "Test",
    token: "MOONCAT",
    chain: "SOL",
    walletTier: "A",
    scoreHints: { socialVelocity: 60 },
    message: "🚀 Test signal fired (live)",
    reasons: ["Feed OK", "WS OK"]
  });
  res.json({ ok: true });
});

const dex = createDexscreenerClient();
const dexCache = new Map();
function cacheGet(k) {
  const v = dexCache.get(k);
  if (!v) return null;
  if (Date.now() - v.ts > DEX_REFRESH_MS) return null;
  return v.data;
}
function cacheSet(k, data) {
  dexCache.set(k, { ts: Date.now(), data });
}

// Real overlay (Dexscreener + rug risk)
app.get("/overlay", async (req, res) => {
  const url = String(req.query.url || "");
  const ctx = dex.parseDexUrl(url);

  const rugEmpty = { risk: 0, level: "—", reasons: ["No pair data"] };

  if (!ctx) {
    return res.json({
      token: "Unknown",
      score: 0,
      reasons: ["Not a Dexscreener URL"],
      rug: rugEmpty
    });
  }

  const key = `${ctx.chain}:${ctx.id}`;
  const cached = cacheGet(key);
  if (cached) return res.json(cached);

  try {
    const pair = await dex.fetchPair(ctx.chain, ctx.id);

    if (!pair) {
      const out = { token: "Unknown", score: 0, reasons: ["Pair not found"], rug: rugEmpty };
      cacheSet(key, out);
      return res.json(out);
    }

    const token = pair?.baseToken?.symbol || pair?.baseToken?.name || "Pair";
    const dexLiquidityUsd = pair?.liquidity?.usd ?? null;
    const dexVolume24hUsd = pair?.volume?.h24 ?? null;
    const priceChange1h = pair?.priceChange?.h1 ?? null;
    const priceChange24h = pair?.priceChange?.h24 ?? null;

    const score = scoreSignal({
      walletTier: null,
      socialVelocity: lastSocialVelocity,
      dexLiquidityUsd,
      dexVolume24hUsd,
      priceChange1h,
      priceChange24h
    });

    const reasons = buildReasons({
      walletTier: null,
      socialVelocity: lastSocialVelocity,
      dexLiquidityUsd,
      dexVolume24hUsd,
      priceChange1h,
      priceChange24h
    });

    const rug = computeRugRiskFromDexPair(pair);

    const out = { token, score, reasons, pairUrl: pair.url, rug };
    cacheSet(key, out);
    return res.json(out);
  } catch {
    const out = { token: "Error", score: 0, reasons: ["Dexscreener fetch failed"], rug: rugEmpty };
    cacheSet(key, out);
    return res.json(out);
  }
});

// Watchers
const solWatcher = createHeliusWatcher({
  apiKey: HELIUS_API_KEY,
  pollMs: Number(process.env.SOL_POLL_MS || 8000),
  walletsByTier,
  onSignal: pushSignal
});

const tgWatcher = createTelegramWatcher({
  botToken: TELEGRAM_BOT_TOKEN,
  pollMs: Number(process.env.TELEGRAM_POLL_MS || 3000),
  allowedChats: TELEGRAM_ALLOWED_CHATS,
  onVelocity: (v) => (lastSocialVelocity = v),
  onSignal: pushSignal
});

const xWatcher = createXWatcher({
  bearerToken: X_BEARER_TOKEN,
  handles: X_HANDLES,
  pollMs: Number(process.env.X_POLL_MS || 20000),
  onSocialVelocity: (v) => (lastSocialVelocity = v),
  onSignal: pushSignal
});

// Start (Render requires 0.0.0.0)
server.listen(PORT, "0.0.0.0", () => {
  console.log(`✅ Listening on port ${PORT}`);
  solWatcher.start();
  tgWatcher.start();
  xWatcher.start();

  // Seed
  pushSignal({
    type: "System",
    token: "MOON",
    chain: "LIVE",
    message: "Backend online: Dex overlay + RugRisk + Telegram + Helius"
  });
});
