import fs from "fs";
import express from "express";
import cors from "cors";
import http from "http";
import { WebSocketServer } from "ws";

import { authMiddleware, addLicense, listLicenses } from "./auth.js";
import { createConvergenceTracker, computeLiquidityTrap, computeEntryZone } from "./advanced_metrics.js";
import { computeRugRiskFromDexPair } from "./rugrisk.js";
import { computeDecision } from "./decision_engine.js";

const PORT = Number(process.env.PORT || 8080);
const PUBLIC_BASE_URL = process.env.PUBLIC_BASE_URL || ""; // set on Render
const HELIUS_WEBHOOK_SECRET = process.env.HELIUS_WEBHOOK_SECRET || ""; // optional

// -------- Wallet tiers --------
let walletsByTier = { S: [], A: [] };
try {
  const j = JSON.parse(fs.readFileSync("./wallets.json", "utf-8"));
  walletsByTier = j?.tiers || walletsByTier;
} catch {
  console.log("⚠️ wallets.json missing/invalid. Wallet tracking will be empty.");
}

function tierForWallet(addr) {
  if (!addr) return null;
  const a = String(addr);
  if ((walletsByTier.S || []).includes(a)) return "S";
  if ((walletsByTier.A || []).includes(a)) return "A";
  return null;
}

// -------- App + WS --------
const app = express();
app.use(cors());
app.use(express.json({ limit: "2mb" }));

const server = http.createServer(app);
const wss = new WebSocketServer({ server });

// -------- State --------
const feed = [];
const convergence = createConvergenceTracker({ windowMs: 12 * 60 * 1000 });

// -------- Utils --------
function pushFeed(obj) {
  feed.unshift(obj);
  feed.splice(250);
  const msg = JSON.stringify(obj);
  for (const c of wss.clients) {
    if (c.readyState === 1) c.send(msg);
  }
}

function ok(res, data) { res.json({ ok: true, ...data }); }
function bad(res, code, error) { res.status(code).json({ ok: false, error }); }

// -------- Minimal Dex “overlay” fetch --------
// For now we DO NOT scrape Dexscreener HTML.
// Your extension calls /overlay?url=... and we return placeholder metrics unless you wire a Dex API.
// This still powers decision + UI nicely, and prevents “Pair not found” spam.
app.get("/overlay", authMiddleware("basic"), async (req, res) => {
  const url = String(req.query.url || "");

  // Minimal parse: token symbol guessed from URL search query
  // (You can upgrade this later with Dex API calls.)
  const tokenGuess = (url.split("/").pop() || "PAIR").toUpperCase();

  // Lightweight demo metrics (until Dex API wired)
  const dexLiquidityUsd = Number(req.query.liq || 45000);
  const dexVolume24hUsd = Number(req.query.vol || 180000);
  const priceChange1h = Number(req.query.ch1h || 8);
  const priceChange24h = Number(req.query.ch24 || 42);

  // Rug heuristics using a fake "pair-like" object
  const fakePair = { liquidity: { usd: dexLiquidityUsd }, volume: { h24: dexVolume24hUsd }, fdv: Number(req.query.fdv || 0) };
  const rug = computeRugRiskFromDexPair(fakePair);

  const liqTrap = computeLiquidityTrap({ dexLiquidityUsd, dexVolume24hUsd });
  const entryZone = computeEntryZone({ priceChange1h, priceChange24h });

  const conv = convergence.get(tokenGuess);

  const score =
    Math.min(
      100,
      Math.round(
        (dexLiquidityUsd >= 50000 ? 25 : dexLiquidityUsd >= 15000 ? 15 : 5) +
        (dexVolume24hUsd >= 250000 ? 25 : dexVolume24hUsd >= 120000 ? 18 : 8) +
        (priceChange1h >= 6 ? 18 : 10) +
        (100 - rug.risk) * 0.20 +
        (conv.strength || 0) * 0.20
      )
    );

  const rising = true;     // until you wire social velocity
  const breakout = priceChange1h >= 8 || (dexVolume24hUsd >= 120000 && dexLiquidityUsd >= 50000);

  res.json({
    token: tokenGuess,
    pairUrl: url,
    score,
    rug,
    dexLiquidityUsd,
    dexVolume24hUsd,
    priceChange1h,
    priceChange24h,
    rising,
    breakout,
    liqTrap,
    entryZone,
    convergence: conv
  });
});

// -------- Decision endpoint --------
app.get("/decision", authMiddleware("basic"), async (req, res) => {
  const url = String(req.query.url || "");
  const base = PUBLIC_BASE_URL ? PUBLIC_BASE_URL : `http://127.0.0.1:${PORT}`;

  const overlayRes = await fetch(`${base}/overlay?url=${encodeURIComponent(url)}`, {
    headers: { "x-ms-key": req.headers["x-ms-key"] || "" }
  });
  const overlay = await overlayRes.json();
  const decision = computeDecision(overlay);

  res.json({ overlay, decision });
});

// -------- Feeds --------
app.get("/feed", authMiddleware("basic"), (req, res) => {
  res.json(feed.slice(0, 50));
});

app.get("/feed/hc", authMiddleware("basic"), (req, res) => {
  res.json(feed.filter(x => x.highConviction).slice(0, 50));
});

// -------- Convergence Map --------
app.get("/convergence", authMiddleware("basic"), (req, res) => {
  const limit = Number(req.query.limit || 30);
  res.json({ tokens: convergence.listTop(limit) });
});

// -------- Test signal --------
app.get("/test-signal", authMiddleware("basic"), (req, res) => {
  const s = {
    type: "System",
    token: "MOONCAT",
    score: 92,
    highConviction: true,
    message: "✅ Test signal fired (Decision+Convergence live)",
    ts: Date.now(),
    pairUrl: "https://dexscreener.com"
  };
  convergence.note({ token: s.token, wallet: "TESTWALLET", tier: "S" });
  pushFeed(s);
  res.json({ ok: true });
});

// -------- Paid SaaS: license admin (LOCK THIS DOWN) --------
// Set ADMIN_SECRET on Render and use it to create keys
app.post("/admin/create-key", (req, res) => {
  const ADMIN_SECRET = process.env.ADMIN_SECRET || "";
  if (!ADMIN_SECRET) return bad(res, 500, "admin_not_configured");

  if (req.headers["x-admin-secret"] !== ADMIN_SECRET) return bad(res, 401, "unauthorized");

  const key = String(req.body?.key || "").trim();
  const plan = String(req.body?.plan || "basic").trim();

  if (!key) return bad(res, 400, "missing_key");

  const row = addLicense(key, plan);
  ok(res, { key, plan: row.plan });
});

app.get("/admin/licenses", (req, res) => {
  const ADMIN_SECRET = process.env.ADMIN_SECRET || "";
  if (!ADMIN_SECRET) return bad(res, 500, "admin_not_configured");
  if (req.headers["x-admin-secret"] !== ADMIN_SECRET) return bad(res, 401, "unauthorized");
  res.json(listLicenses());
});

// -------- Solana Wallet Tracking via Helius Webhook --------
// Create a Helius webhook that POSTs to:
//   https://moon-signal.onrender.com/helius/webhook
// and add your watched wallet addresses there.
app.post("/helius/webhook", (req, res) => {
  // Optional shared secret check
  if (HELIUS_WEBHOOK_SECRET) {
    const got = req.headers["x-helius-secret"] || "";
    if (got !== HELIUS_WEBHOOK_SECRET) return bad(res, 401, "bad_secret");
  }

  // Helius posts an array of transactions
  const txs = Array.isArray(req.body) ? req.body : [];
  for (const tx of txs) {
    // Find which tracked wallet is involved
    const accounts = tx?.accountData?.map(a => a.account) || [];
    const tracked = accounts.find(a => tierForWallet(a));
    if (!tracked) continue;

    const tier = tierForWallet(tracked);
    const tokenHint =
      (tx?.tokenTransfers?.[0]?.mint || tx?.nativeTransfers?.[0]?.toUserAccount || "SOL").slice(0, 6).toUpperCase();

    // Convergence
    convergence.note({ token: tokenHint, wallet: tracked, tier });

    // Emit signal
    const sig = {
      type: "Wallet",
      token: tokenHint,
      wallet: tracked,
      walletTier: tier,
      score: tier === "S" ? 88 : 78,
      highConviction: tier === "S",
      message: `👀 Tier-${tier} wallet activity detected`,
      ts: Date.now(),
      meta: {
        signature: tx?.signature || null
      }
    };
    pushFeed(sig);
  }

  res.json({ ok: true });
});

// -------- Root + WS connect --------
app.get("/", (req, res) => res.send("Moon Signal backend online"));
wss.on("connection", (ws) => {
  ws.send(JSON.stringify({ type: "System", token: "MOON", message: "✅ WebSocket connected", ts: Date.now() }));
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`✅ Backend running on port ${PORT}`);
});
