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

import { computeDecision } from "./decision_engine.js";
import { createWatchlistStore } from "./watchlist_store.js";

const PORT = Number(process.env.PORT || 8080);
const SIGNAL_TOKEN = process.env.SIGNAL_TOKEN || ""; // optional shared secret

const HELIUS_API_KEY = process.env.HELIUS_API_KEY || "";
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || "";
const TELEGRAM_ALLOWED_CHATS = (process.env.TELEGRAM_ALLOWED_CHATS || "")
  .split(",").map(s => s.trim()).filter(Boolean);

const X_BEARER_TOKEN = process.env.X_BEARER_TOKEN || "";
const X_HANDLES = (process.env.X_HANDLES || "")
  .split(",").map(s => s.trim()).filter(Boolean);

// HC tuning
const MIN_SCORE_HC = Number(process.env.MIN_SCORE_HC || 78);
const MAX_RUG_HC = Number(process.env.MAX_RUG_HC || 60);
const MIN_LIQ_HC = Number(process.env.MIN_LIQ_HC || 15000);
const MIN_SOCIAL_HC = Number(process.env.MIN_SOCIAL_HC || 25);

const REQUIRE_ACCEL = (process.env.REQUIRE_ACCEL || "1") === "1";
const ACCEL_MIN_DELTA = Number(process.env.ACCEL_MIN_DELTA || 6);
const ACCEL_MIN_NOW = Number(process.env.ACCEL_MIN_NOW || 20);

const REQUIRE_BREAKOUT = (process.env.REQUIRE_BREAKOUT || "1") === "1";
const DEX_REFRESH_MS = Number(process.env.DEX_REFRESH_MS || 15000);
const WATCHLIST_SCAN_MS = Number(process.env.WATCHLIST_SCAN_MS || 20000);

// wallets tiers
let walletsByTier = { S: [], A: [], B: [], C: [] };
try {
  const j = JSON.parse(fs.readFileSync("./wallets.json", "utf-8"));
  walletsByTier = j?.tiers || walletsByTier;
} catch {
  console.log("⚠️ wallets.json missing/invalid.");
}

// labels
let walletLabels = {};
try {
  const j = JSON.parse(fs.readFileSync("./wallet_labels.json", "utf-8"));
  walletLabels = j?.labels || {};
} catch {
  console.log("⚠️ wallet_labels.json missing/invalid (labels disabled).");
}

const walletRank = createWalletRanker();
const velocity = createVelocityTracker({ windowSize: 10 });
const watchlist = createWatchlistStore();

const app = express();
app.use(cors());
app.use(express.json());

const server = http.createServer(app);
const wss = new WebSocketServer({ server });

const dex = createDexscreenerClient();
const outcomes = createOutcomeTracker({
  dexClient: dex,
  walletRanker: walletRank,
  onNote: (type, meta) => console.log(`📈 Outcome ${type}`, meta)
});

const latestSignals = [];
const dexCache = new Map();
const pairSnapshots = new Map(); // key -> { ts, vol24, liqUsd }

function broadcast(obj) {
  const msg = JSON.stringify(obj);
  for (const c of wss.clients) if (c.readyState === 1) c.send(msg);
}

function cacheGet(k) {
  const v = dexCache.get(k);
  if (!v) return null;
  if (Date.now() - v.ts > DEX_REFRESH_MS) return null;
  return v.data;
}
function cacheSet(k, data) { dexCache.set(k, { ts: Date.now(), data }); }

function computeBreakout(pair) {
  const liqUsd = Number(pair?.liquidity?.usd ?? 0);
  const vol24 = Number(pair?.volume?.h24 ?? 0);
  const ch1h = Number(pair?.priceChange?.h1 ?? 0);

  const key = `${pair?.chainId || ""}:${pair?.pairAddress || pair?.url || ""}`;
  const prev = pairSnapshots.get(key);
  pairSnapshots.set(key, { ts: Date.now(), liqUsd, vol24 });

  const rule1 = ch1h >= 8;
  const rule2 = vol24 >= 120000 && ch1h >= 3;
  const rule3 = liqUsd >= 50000 && ch1h >= 2;

  let volAccel = false;
  let liqAccel = false;
  if (prev?.vol24 > 0) volAccel = ((vol24 - prev.vol24) / prev.vol24) >= 0.15;
  if (prev?.liqUsd > 0) liqAccel = ((liqUsd - prev.liqUsd) / prev.liqUsd) >= 0.05;

  const breakout = rule1 || rule2 || rule3 || volAccel || liqAccel;

  return { breakout, details: { ch1h, liqUsd, vol24, volAccel, liqAccel } };
}

function isHighConviction(signal) {
  const scoreOk = typeof signal.score === "number" && signal.score >= MIN_SCORE_HC;

  const rugOk =
    !signal.rug || typeof signal.rug.risk !== "number" || signal.rug.risk <= MAX_RUG_HC;

  const liqOk = signal.dexLiquidityUsd == null || signal.dexLiquidityUsd >= MIN_LIQ_HC;

  const socialNow = typeof signal.socialVelocity === "number" ? signal.socialVelocity : velocity.current();
  const socialOk = socialNow >= MIN_SOCIAL_HC;

  const tier = signal.walletTier;
  const tierOk = !tier || tier === "S" || tier === "A";

  const accelOk =
    !REQUIRE_ACCEL || velocity.isRising({ minDelta: ACCEL_MIN_DELTA, minNow: ACCEL_MIN_NOW });

  const hasDex = !!signal.pairUrl;
  const breakoutOk = !REQUIRE_BREAKOUT || !hasDex || signal.breakout === true;

  return scoreOk && rugOk && liqOk && socialOk && tierOk && accelOk && breakoutOk;
}

async function pushSignal(raw) {
  const wallet = raw?.wallet ? String(raw.wallet) : "";
  const walletLabel = wallet ? (walletLabels[wallet] || null) : null;

  let walletTier = raw?.walletTier || null;
  if (wallet) walletTier = walletRank.noteActivity(wallet, raw?.token).tier;

  const socialVelocity =
    typeof raw?.socialVelocity === "number" ? raw.socialVelocity :
    typeof raw?.scoreHints?.socialVelocity === "number" ? raw.scoreHints.socialVelocity :
    velocity.current();

  const dexLiquidityUsd = raw?.dexLiquidityUsd ?? null;
  const dexVolume24hUsd = raw?.dexVolume24hUsd ?? null;
  const priceChange1h = raw?.priceChange1h ?? null;
  const priceChange24h = raw?.priceChange24h ?? null;

  const score = scoreSignal({ walletTier, socialVelocity, dexLiquidityUsd, dexVolume24hUsd, priceChange1h, priceChange24h });
  const reasons = raw?.reasons?.length ? raw.reasons : buildReasons({ walletTier, socialVelocity, dexLiquidityUsd, dexVolume24hUsd, priceChange1h, priceChange24h });

  const s = {
    id: globalThis.crypto?.randomUUID?.() || String(Date.now()),
    ts: Date.now(),
    walletTier,
    walletLabel,
    socialVelocity,
    score,
    reasons,
    ...raw
  };

  s.highConviction = isHighConviction(s);

  latestSignals.unshift(s);
  latestSignals.splice(250);

  broadcast(s);
  return s;
}

wss.on("connection", (ws) => {
  ws.send(JSON.stringify({ type: "System", token: "MOON", score: 100, message: "✅ Connected to Moon Signal" }));
});

// ROUTES
app.get("/", (req, res) => res.send("Moon Signal backend OK"));
app.get("/feed", (req, res) => res.json(latestSignals.slice(0, 30)));
app.get("/feed/hc", (req, res) => res.json(latestSignals.filter(s => s.highConviction).slice(0, 30)));

app.get("/wallets/top", (req, res) => res.json(walletRank.topWallets(20)));
app.get("/wallets/labels", (req, res) => res.json(walletLabels));

app.get("/debug/velocity", (req, res) => res.json({
  now: velocity.current(),
  rising: velocity.isRising({ minDelta: ACCEL_MIN_DELTA, minNow: ACCEL_MIN_NOW }),
  slope: velocity.slope(),
  samples: velocity.debug()
}));

// Overlay (Dex)
app.get("/overlay", async (req, res) => {
  const url = String(req.query.url || "");
  const ctx = dex.parseDexUrl(url);
  const rugEmpty = { risk: 0, level: "—", reasons: ["No pair data"] };

  if (!ctx) return res.json({ token: "Unknown", score: 0, reasons: ["Not a Dexscreener URL"], rug: rugEmpty });

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
    const b = computeBreakout(pair);

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
      rising: velocity.isRising({ minDelta: ACCEL_MIN_DELTA, minNow: ACCEL_MIN_NOW }),
      breakout: b.breakout,
      breakoutDetails: b.details
    };

    cacheSet(key, out);
    return res.json(out);
  } catch {
    const out = { token: "Error", score: 0, reasons: ["Dexscreener fetch failed"], rug: rugEmpty };
    cacheSet(key, out);
    return res.json(out);
  }
});

// DECISION ENGINE (APE/WAIT)
app.get("/decision", async (req, res) => {
  const url = String(req.query.url || "");
  const overlay = await (await fetch(`${req.protocol}://${req.get("host")}/overlay?url=${encodeURIComponent(url)}`)).json();
  const decision = computeDecision(overlay);
  res.json({ overlay, decision });
});

// Watchlist APIs
app.get("/watchlist", (req, res) => res.json(watchlist.list()));

app.post("/watchlist", (req, res) => {
  const key = String(req.body?.key || "");
  const url = String(req.body?.url || "");
  const token = String(req.body?.token || "");
  const added = watchlist.add({ key, url, token });
  res.json({ ok: added });
});

app.delete("/watchlist", (req, res) => {
  const key = String(req.query.key || "");
  const ok = watchlist.remove(key);
  res.json({ ok });
});

// Allow extension to push signals from Dex overlay (so feed is never empty)
app.post("/signal", async (req, res) => {
  // Optional protection
  if (SIGNAL_TOKEN && req.headers["x-signal-token"] !== SIGNAL_TOKEN) {
    return res.status(401).json({ ok: false, error: "unauthorized" });
  }

  const s = req.body || {};
  if (!s.token) return res.status(400).json({ ok: false, error: "token required" });

  const out = await pushSignal({
    type: s.type || "Dex",
    token: String(s.token),
    message: String(s.message || "Dex signal"),
    pairUrl: s.pairUrl || null,
    rug: s.rug || null,
    dexLiquidityUsd: s.dexLiquidityUsd ?? null,
    dexVolume24hUsd: s.dexVolume24hUsd ?? null,
    priceChange1h: s.priceChange1h ?? null,
    priceChange24h: s.priceChange24h ?? null,
    rising: s.rising === true,
    breakout: s.breakout === true,
    reasons: Array.isArray(s.reasons) ? s.reasons : []
  });

  res.json({ ok: true, id: out.id });
});

// Outcome arming (from overlay)
app.post("/arm-outcome", async (req, res) => {
  const wallet = String(req.body?.wallet || "");
  const dexUrl = String(req.body?.dexUrl || "");
  if (!wallet || !dexUrl) return res.status(400).json({ ok: false, error: "wallet and dexUrl required" });

  const ok = await outcomes.armFromSignal({ wallet, dexUrl });
  res.json({ ok, stats: outcomes.stats() });
});

// TEST
app.get("/test-signal", async (req, res) => {
  velocity.push(30); velocity.push(38); velocity.push(46);
  await pushSignal({
    type: "Test",
    token: "MOONCAT",
    message: "🚀 Test signal (Decision engine ready)",
    dexLiquidityUsd: 60000,
    dexVolume24hUsd: 220000,
    priceChange1h: 9,
    rug: { risk: 22, level: "LOW", reasons: ["Demo low risk"] },
    rising: true,
    breakout: true,
    reasons: ["Accel rising", "Breakout confirmed", "Good liquidity", "Low rug risk"]
  });
  res.json({ ok: true });
});

// WATCHLIST SCANNER: alerts when WAIT -> APE
async function scanWatchlist() {
  const items = watchlist.list();
  if (!items.length) return;

  for (const it of items.slice(0, 50)) {
    if (!it.url) continue;
    try {
      const data = await (await fetch(`http://127.0.0.1:${PORT}/decision?url=${encodeURIComponent(it.url)}`)).json();
      const decision = data?.decision;
      if (!decision) continue;

      const prev = it.lastDecision?.action || null;

      // store
      watchlist.updateDecision(it.key, decision);

      // If it flips to APE, broadcast a premium alert signal
      if (prev && prev !== "APE" && decision.action === "APE") {
        await pushSignal({
          type: "Watchlist",
          token: it.token || data?.overlay?.token || "WATCH",
          message: `⚡ WATCHLIST FLIP → APE (${decision.confidence}%)`,
          pairUrl: it.url,
          rug: data?.overlay?.rug,
          dexLiquidityUsd: data?.overlay?.dexLiquidityUsd ?? null,
          dexVolume24hUsd: data?.overlay?.dexVolume24hUsd ?? null,
          priceChange1h: data?.overlay?.priceChange1h ?? null,
          breakout: data?.overlay?.breakout === true,
          rising: data?.overlay?.rising === true,
          reasons: decision.reasons || []
        });

        broadcast({ type: "DecisionFlip", key: it.key, decision });
      }
    } catch {
      // ignore
    }
  }
}

setInterval(scanWatchlist, WATCHLIST_SCAN_MS);

// Watchers (optional)
const solWatcher = createHeliusWatcher({
  apiKey: HELIUS_API_KEY,
  pollMs: Number(process.env.SOL_POLL_MS || 8000),
  walletsByTier,
  onSignal: (sig) => pushSignal(sig)
});

const tgWatcher = createTelegramWatcher({
  botToken: TELEGRAM_BOT_TOKEN,
  pollMs: Number(process.env.TELEGRAM_POLL_MS || 3000),
  allowedChats: TELEGRAM_ALLOWED_CHATS,
  onVelocity: (v) => velocity.push(v),
  onSignal: (sig) => pushSignal(sig)
});

const xWatcher = createXWatcher({
  bearerToken: X_BEARER_TOKEN,
  handles: X_HANDLES,
  pollMs: Number(process.env.X_POLL_MS || 20000),
  onSocialVelocity: (v) => velocity.push(v),
  onSignal: (sig) => pushSignal(sig)
});

server.listen(PORT, "0.0.0.0", async () => {
  console.log(`✅ Backend listening on ${PORT}`);
  solWatcher.start();
  tgWatcher.start();
  xWatcher.start();

  await pushSignal({ type: "System", token: "MOON", message: "Backend online: Decision + Heatmap + Watchlist + Signals" });
});
