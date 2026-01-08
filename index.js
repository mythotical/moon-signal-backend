import "dotenv/config";
import fs from "fs";
import express from "express";
import http from "http";
import cors from "cors";
import { WebSocketServer } from "ws";

import { createHeliusWatcher } from "./watchers/helius_solana.js";
import { createXWatcher } from "./watchers/x_influencers.js";
import { createDexscreenerClient } from "./watchers/dexscreener.js";
import { createTelegramWatcher } from "./watchers/telegram.js";

import { scoreSignal, buildReasons } from "./scoring.js";
import { computeRugRiskFromDexPair } from "./rugrisk.js";

// --------------------
// ENV
// --------------------
const PORT = Number(process.env.PORT || 8080);

const HELIUS_API_KEY = process.env.HELIUS_API_KEY || "";
const SOL_POLL_MS = Number(process.env.SOL_POLL_MS || 5000);

const X_BEARER_TOKEN = process.env.X_BEARER_TOKEN || "";
const X_HANDLES = (process.env.X_HANDLES || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
const X_POLL_MS = Number(process.env.X_POLL_MS || 20000);

const DEX_REFRESH_MS = Number(process.env.DEX_REFRESH_MS || 15000);

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || "";
const TELEGRAM_POLL_MS = Number(process.env.TELEGRAM_POLL_MS || 3000);
const TELEGRAM_ALLOWED_CHATS = (process.env.TELEGRAM_ALLOWED_CHATS || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

// --------------------
// Load wallet tiers
// --------------------
let walletsByTier = { S: [], A: [] };
try {
  const walletsCfg = JSON.parse(fs.readFileSync("./wallets.json", "utf-8"));
  walletsByTier = walletsCfg?.tiers || walletsByTier;
} catch {
  console.log("⚠️ wallets.json missing or invalid. Solana watcher will have no wallets.");
}

// --------------------
// Signal store + scoring context
// --------------------
const latestSignals = []; // newest first
let lastSocialVelocity = 0; // updated by Telegram (and X if enabled)

// --------------------
// Helpers
// --------------------
function pushSignal(raw) {
  const walletTier = raw?.walletTier || raw?.scoreHints?.walletTier || null;

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

  const signal = {
    id: globalThis.crypto?.randomUUID?.() || String(Date.now()),
    ts: Date.now(),
    score,
    reasons,
    ...raw
  };

  latestSignals.unshift(signal);
  latestSignals.splice(200);

  broadcast(signal);
}

function broadcast(signal) {
  const payload = JSON.stringify(signal);
  for (const client of wss.clients) {
    if (client.readyState === 1) client.send(payload);
  }
}

// --------------------
// Express + WS server
// --------------------
const app = express();
app.use(cors());
app.use(express.json());

const server = http.createServer(app);
const wss = new WebSocketServer({ server });

wss.on("connection", (ws) => {
  ws.send(
    JSON.stringify({
      type: "Startup",
      score: 100,
      message: "✅ WebSocket connected to Moon Signal backend"
    })
  );
});

// --------------------
// API endpoints
// --------------------
app.get("/feed", (req, res) => {
  res.json(latestSignals.slice(0, 20));
});

// Dex overlay (Dexscreener API enrichment)
const dex = createDexscreenerClient();

// Cache pair data briefly (avoid hammering Dexscreener)
const dexCache = new Map(); // key -> { ts, data }
function cacheGet(key) {
  const v = dexCache.get(key);
  if (!v) return null;
  if (Date.now() - v.ts > DEX_REFRESH_MS) return null;
  return v.data;
}
function cacheSet(key, data) {
  dexCache.set(key, { ts: Date.now(), data });
}

// ✅ FULL /overlay endpoint with Rug Risk
app.get("/overlay", async (req, res) => {
  const url = String(req.query.url || "");
  const ctx = dex.parseDexUrl(url);

  // Always return a rug object so UI can always draw a bar
  const rugEmpty = { risk: 0, level: "—", reasons: ["No pair data"] };

  if (!ctx) {
    return res.json({
      token: "Unknown",
      score: 0,
      reasons: ["Not a Dexscreener URL"],
      rug: rugEmpty
    });
  }

  const cacheKey = `${ctx.chain}:${ctx.id}`;
  const cached = cacheGet(cacheKey);
  if (cached) return res.json(cached);

  try {
    // fetchPair() now supports pairId OR tokenAddress (fallback)
    const pair = await dex.fetchPair(ctx.chain, ctx.id);

    if (!pair) {
      const out = {
        token: "Unknown",
        score: 0,
        reasons: ["Pair not found"],
        rug: rugEmpty
      };
      cacheSet(cacheKey, out);
      return res.json(out);
    }

    const token = pair?.baseToken?.symbol || pair?.baseToken?.name || "Pair";

    const dexLiquidityUsd = pair?.liquidity?.usd ?? null;
    const dexVolume24hUsd = pair?.volume?.h24 ?? null;
    const priceChange1h = pair?.priceChange?.h1 ?? null;
    const priceChange24h = pair?.priceChange?.h24 ?? null;

    const walletTier = null; // overlay is per-page, not per-wallet
    const socialVelocity = lastSocialVelocity ?? 0;

    const score = scoreSignal({
      walletTier,
      socialVelocity,
      dexLiquidityUsd,
      dexVolume24hUsd,
      priceChange1h,
      priceChange24h
    });

    const reasons = buildReasons({
      walletTier,
      socialVelocity,
      dexLiquidityUsd,
      dexVolume24hUsd,
      priceChange1h,
      priceChange24h
    });

    const rug = computeRugRiskFromDexPair(pair);

    const out = {
      token,
      score,
      reasons,
      pairUrl: pair.url,
      rug
    };

    cacheSet(cacheKey, out);
    return res.json(out);
  } catch {
    const out = {
      token: "Error",
      score: 0,
      reasons: ["Dexscreener fetch failed"],
      rug: rugEmpty
    };
    cacheSet(cacheKey, out);
    return res.json(out);
  }
});

// --------------------
// Watchers
// --------------------
const solWatcher = createHeliusWatcher({
  apiKey: HELIUS_API_KEY,
  pollMs: SOL_POLL_MS,
  walletsByTier,
  onSignal: pushSignal
});

const xWatcher = createXWatcher({
  bearerToken: X_BEARER_TOKEN,
  handles: X_HANDLES,
  pollMs: X_POLL_MS,
  onSocialVelocity: (v) => {
    lastSocialVelocity = v;
  },
  onSignal: pushSignal
});

const tgWatcher = createTelegramWatcher({
  botToken: TELEGRAM_BOT_TOKEN,
  pollMs: TELEGRAM_POLL_MS,
  allowedChats: TELEGRAM_ALLOWED_CHATS,
  onVelocity: (v) => {
    lastSocialVelocity = v;
  },
  onSignal: pushSignal
});

// --------------------
// Seed signal
// --------------------
pushSignal({
  type: "System",
  chain: "LOCAL",
  walletTier: "B",
  scoreHints: { socialVelocity: 10 },
  message: "Moon Signal backend online (Dex + RugRisk + TG + Solana enabled)",
  reasons: ["Backend boot", "WebSocket ready", "Overlay endpoint ready"]
});

// --------------------
// Start server + watchers
// --------------------
server.listen(PORT, () => {
  console.log(`✅ Backend running: ${process.env.PUBLIC_URL || "http://localhost:" + PORT}`);
  console.log(`✅ Feed endpoint:   /feed`);
  console.log(`✅ Overlay endpoint:/overlay?url=...`);
  console.log(`✅ WebSocket:       (same host)`);
  
  solWatcher.start();
  tgWatcher.start();
  xWatcher.start();
});
  solWatcher.start();
  tgWatcher.start();
  xWatcher.start(); // will self-disable if token/handles missing
});
