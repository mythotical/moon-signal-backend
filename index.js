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
import { createWalletRanker } from "./wallet_rank.js";

import { createVelocityTracker } from "./velocity.js";
import { createOutcomeTracker } from "./outcomes.js";

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

// High Conviction Filters (tune)
const MIN_SCORE_HC = Number(process.env.MIN_SCORE_HC || 78);
const MAX_RUG_HC = Number(process.env.MAX_RUG_HC || 60);
const MIN_LIQ_HC = Number(process.env.MIN_LIQ_HC || 15000);
const MIN_SOCIAL_HC = Number(process.env.MIN_SOCIAL_HC || 25);

// NEW: acceleration gating
const REQUIRE_ACCEL = (process.env.REQUIRE_ACCEL || "1") === "1";
const ACCEL_MIN_DELTA = Number(process.env.ACCEL_MIN_DELTA || 6);
const ACCEL_MIN_NOW = Number(process.env.ACCEL_MIN_NOW || 20);

const DEX_REFRESH_MS = Number(process.env.DEX_REFRESH_MS || 15000);

let walletsByTier = { S: [], A: [], B: [], C: [] };
try {
  const j = JSON.parse(fs.readFileSync("./wallets.json", "utf-8"));
  walletsByTier = j?.tiers || walletsByTier;
} catch {
  console.log("⚠️ wallets.json missing/invalid.");
}

const walletRank = createWalletRanker();
const velocity = createVelocityTracker({ windowSize: 10 });

const app = express();
app.use(cors());
app.use(express.json());

const server = http.createServer(app);
const wss = new WebSocketServer({ server });

const latestSignals = [];

function broadcast(obj) {
  const msg = JSON.stringify(obj);
  for (const client of wss.clients) {
    if (client.readyState === 1) client.send(msg);
  }
}

function isHighConviction(signal) {
  const scoreOk = typeof signal.score === "number" && signal.score >= MIN_SCORE_HC;

  const rugOk = !signal.rug || typeof signal.rug.risk !== "number" || signal.rug.risk <= MAX_RUG_HC;

  const liqOk =
    signal.dexLiquidityUsd == null || (typeof signal.dexLiquidityUsd === "number" && signal.dexLiquidityUsd >= MIN_LIQ_HC);

  const socialNow = typeof signal.socialVelocity === "number" ? signal.socialVelocity : velocity.current();
  const socialOk = socialNow >= MIN_SOCIAL_HC;

  // Wallet signals must be A/S
  const tier = signal.walletTier;
  const tierOk = !tier || tier === "S" || tier === "A";

  const accelOk = !REQUIRE_ACCEL || velocity.isRising({ minDelta: ACCEL_MIN_DELTA, minNow: ACCEL_MIN_NOW });

  return scoreOk && rugOk && liqOk && socialOk && tierOk && accelOk;
}

function pushSignal(raw) {
  let walletTier = raw?.walletTier || null;

  // If wallet present, auto-rank tier based on behavior
  if (raw?.wallet) {
    const w = walletRank.noteActivity(raw.wallet, raw.token);
    walletTier = w.tier;
  }

  const socialVelocity =
    typeof raw?.scoreHints?.socialVelocity === "number"
      ? raw.scoreHints.socialVelocity
      : velocity.current();

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
    walletTier,
    socialVelocity,
    dexLiquidityUsd,
    dexVolume24hUsd,
    priceChange1h,
    priceChange24h,
    ...raw
  };

  s.highConviction = isHighConviction(s);

  latestSignals.unshift(s);
  latestSignals.splice(200);

  broadcast(s);
}

// WS connect
wss.on("connection", (ws) => {
  ws.send(JSON.stringify({
    type: "System",
    token: "MOON",
    score: 100,
    message: "✅ Connected to Moon Signal (live backend)"
  }));
});

// Routes
app.get("/", (req, res) => res.send("Moon Signal backend OK"));

app.get("/feed", (req, res) => res.json(latestSignals.slice(0, 20)));

app.get("/feed/hc", (req, res) => {
  res.json(latestSignals.filter((s) => s.highConviction).slice(0, 20));
});

app.get("/wallets/top", (req, res) => res.json(walletRank.topWallets(20)));

app.get("/debug/velocity", (req, res) => {
  res.json({ now: velocity.current(), rising: velocity.isRising(), slope: velocity.slope(), samples: velocity.debug() });
});

// HC test signal
app.get("/test-signal", (req, res) => {
  velocity.push(30);
  velocity.push(38);
  velocity.push(46);

  pushSignal({
    type: "Test",
    token: "MOONCAT",
    chain: "SOL",
    walletTier: "S",
    socialVelocity: velocity.current(),
    scoreHints: { socialVelocity: velocity.current() },
    dexLiquidityUsd: 50000,
    message: "🚀 Test HC signal fired (live)",
    rug: { risk: 25, level: "LOW", reasons: ["Demo safe"] }
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

const outcomes = createOutcomeTracker({
  dexClient: dex,
  walletRanker: walletRank,
  onNote: (type, meta) => {
    // optional: log
    console.log(`📈 Outcome ${type}`, meta);
  }
});

// Overlay (Dexscreener + Rug Risk)
app.get("/overlay", async (req, res) => {
  const url = String(req.query.url || "");
  const ctx = dex.parseDexUrl(url);

  const rugEmpty = { risk: 0, level: "—", reasons: ["No pair data"] };

  if (!ctx) {
    return res.json({ token: "Unknown", score: 0, reasons: ["Not a Dexscreener URL"], rug: rugEmpty });
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

    const rug = computeRugRiskFromDexPair(pair);

    const score = scoreSignal({
      walletTier: null,
      socialVelocity: velocity.current(),
      dexLiquidityUsd,
      dexVolume24hUsd,
      priceChange1h,
      priceChange24h
    });

    const reasons = buildReasons({
      walletTier: null,
      socialVelocity: velocity.current(),
      dexLiquidityUsd,
      dexVolume24hUsd,
      priceChange1h,
      priceChange24h
    });

    const out = {
      token,
      score,
      reasons,
      pairUrl: pair.url,
      rug,
      dexLiquidityUsd,
      dexVolume24hUsd,
      priceChange1h,
      priceChange24h,
      socialVelocity: velocity.current(),
      rising: velocity.isRising({ minDelta: ACCEL_MIN_DELTA, minNow: ACCEL_MIN_NOW })
    };

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
  onSignal: (sig) => {
    // if wallet signal includes dexUrl later, outcomes can arm
    pushSignal(sig);
  }
});

const tgWatcher = createTelegramWatcher({
  botToken: TELEGRAM_BOT_TOKEN,
  pollMs: Number(process.env.TELEGRAM_POLL_MS || 3000),
  allowedChats: TELEGRAM_ALLOWED_CHATS,
  onVelocity: (v) => {
    velocity.push(v);
  },
  onSignal: (sig) => {
    // Social mention also updates velocity through onVelocity
    pushSignal(sig);
  }
});

const xWatcher = createXWatcher({
  bearerToken: X_BEARER_TOKEN,
  handles: X_HANDLES,
  pollMs: Number(process.env.X_POLL_MS || 20000),
  onSocialVelocity: (v) => velocity.push(v),
  onSignal: (sig) => pushSignal(sig)
});

// NEW: endpoint to arm outcomes from extension (wallet + dexscreener url)
app.post("/arm-outcome", async (req, res) => {
  const wallet = String(req.body?.wallet || "");
  const dexUrl = String(req.body?.dexUrl || "");

  if (!wallet || !dexUrl) return res.status(400).json({ ok: false, error: "wallet and dexUrl required" });

  const ok = await outcomes.armFromSignal({ wallet, dexUrl });
  res.json({ ok, stats: outcomes.stats() });
});

// Start
server.listen(PORT, "0.0.0.0", () => {
  console.log(`✅ Listening on port ${PORT}`);
  solWatcher.start();
  tgWatcher.start();
  xWatcher.start();

  pushSignal({
    type: "System",
    token: "MOON",
    chain: "LIVE",
    message: "Backend online: HC accel + RugRisk + Wallet auto-rank outcomes"
  });
});
