import fs from "fs";
import express from "express";
import cors from "cors";
import http from "http";
import { WebSocketServer } from "ws";

import { authMiddleware, addLicense, listLicenses } from "./auth.js";
import { createConvergenceTracker, computeLiquidityTrap, computeEntryZone } from "./advanced_metrics.js";
import { computeRugRiskFromDexPair } from "./rugrisk.js";
import { computeDecision } from "./decision_engine.js";
import { scoreSignal } from "./scoring.js";

const PORT = Number(process.env.PORT || 8080);
const PUBLIC_BASE_URL = process.env.PUBLIC_BASE_URL || ""; // set on Render

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
app.use(express.json({ limit: "1mb" }));

const server = http.createServer(app);
const wss = new WebSocketServer({ server });

const feed = [];
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

// -------- Convergence Tracker --------
const convergence = createConvergenceTracker();

// -------- pair state to detect liquidity drain / crash --------
const pairState = new Map(); // key = `${chain}:${pair}`
function getStateKey(chain, pair) { return `${chain}:${pair}`; }

function parseDexUrl(url) {
  try {
    const u = new URL(url);
    if (!u.hostname.includes("dexscreener.com")) return null;
    const parts = u.pathname.split("/").filter(Boolean);
    const chain = parts[0];
    const pair = parts[1];
    if (!chain || !pair) return null;
    return { chain, pair };
  } catch {
    return null;
  }
}

async function fetchDexPair(chain, pair) {
  const api = `https://api.dexscreener.com/latest/dex/pairs/${encodeURIComponent(chain)}/${encodeURIComponent(pair)}`;
  const r = await fetch(api, { cache: "no-store" });
  if (!r.ok) throw new Error(`Dex API ${r.status}`);
  const j = await r.json();
  const p = j?.pair;
  if (!p) throw new Error("Dex pair missing");
  return p;
}

function calcSocialVelocity(pair) {
  // Approx “flow velocity” from txns + short-term volume, normalized 0–100
  const buys5 = Number(pair?.txns?.m5?.buys ?? 0);
  const sells5 = Number(pair?.txns?.m5?.sells ?? 0);
  const tx5 = buys5 + sells5;

  const vol1 = Number(pair?.volume?.h1 ?? 0);
  const chg5 = Number(pair?.priceChange?.m5 ?? 0);

  let v = 0;
  v += Math.min(60, tx5 * 2.2);          // txns dominate velocity
  v += Math.min(25, vol1 / 25000);       // 1h volume bump
  v += Math.max(-10, Math.min(15, chg5 * 1.5)); // momentum hint
  return Math.max(0, Math.min(100, v));
}

function calcRising(pair) {
  const buys5 = Number(pair?.txns?.m5?.buys ?? 0);
  const sells5 = Number(pair?.txns?.m5?.sells ?? 0);
  const t5 = buys5 + sells5;
  const buyRatio = t5 > 0 ? buys5 / t5 : 0.5;
  const chg5 = Number(pair?.priceChange?.m5 ?? 0);
  return chg5 >= 1.2 && t5 >= 10 && buyRatio >= 0.55;
}

function calcBreakout(pair) {
  const chg5 = Number(pair?.priceChange?.m5 ?? 0);
  const chg1 = Number(pair?.priceChange?.h1 ?? 0);
  return chg1 >= 5 && chg5 >= 1.0;
}

// -------- LICENSE --------
app.get("/license/status", authMiddleware("basic"), (req, res) => {
  ok(res, { plan: "LIVE" });
});

// -------- LIVE overlay from Dex API --------
app.get("/overlay", authMiddleware("basic"), async (req, res) => {
  const url = String(req.query.url || "");
  const parsed = parseDexUrl(url);
  if (!parsed) return bad(res, 400, "Invalid Dexscreener URL");

  try {
    const pair = await fetchDexPair(parsed.chain, parsed.pair);

    const token = (pair?.baseToken?.symbol || pair?.baseToken?.name || "TOKEN").toString();
    const dexLiquidityUsd = Number(pair?.liquidity?.usd ?? 0);
    const dexVolume24hUsd = Number(pair?.volume?.h24 ?? 0);

    const priceChange5m = Number(pair?.priceChange?.m5 ?? 0);
    const priceChange1h = Number(pair?.priceChange?.h1 ?? 0);
    const priceChange24h = Number(pair?.priceChange?.h24 ?? 0);

    const buys5m = Number(pair?.txns?.m5?.buys ?? 0);
    const sells5m = Number(pair?.txns?.m5?.sells ?? 0);

    // --- liquidity drop detection (stateful) ---
    const key = getStateKey(parsed.chain, parsed.pair);
    const prev = pairState.get(key);
    const ts = Date.now();

    let liqDropPct = 0;
    if (prev && Number(prev.liqUsd) > 0 && (ts - prev.ts) <= 12 * 60 * 1000) {
      liqDropPct = ((Number(prev.liqUsd) - dexLiquidityUsd) / Number(prev.liqUsd)) * 100;
      if (!Number.isFinite(liqDropPct)) liqDropPct = 0;
      if (liqDropPct < 0) liqDropPct = 0; // we only care about drops
    }

    pairState.set(key, { liqUsd: dexLiquidityUsd, ts });

    // advanced metrics
    const socialVelocity = calcSocialVelocity(pair);
    const rising = calcRising(pair);
    const breakout = calcBreakout(pair);

    const liqTrap = computeLiquidityTrap({ pair, liqDropPct });
    const entryZone = computeEntryZone({ pair });
    const conv = convergence.snapshot(token);

    // rug risk now sees crash + liquidity drain + sell pressure
    const rug = computeRugRiskFromDexPair(pair, {
      priceChange5m,
      priceChange1h,
      priceChange24h,
      buys5m,
      sells5m,
      liqDropPct
    });

    // score (wallet tier optional)
    const walletTier = null;
    const score = scoreSignal({
      walletTier,
      socialVelocity,
      dexLiquidityUsd,
      dexVolume24hUsd,
      priceChange1h,
      priceChange24h
    });

    ok(res, {
      token,
      pairUrl: url,

      score,
      rug,

      dexLiquidityUsd,
      dexVolume24hUsd,

      priceChange5m,
      priceChange1h,
      priceChange24h,

      liqDropPct,

      socialVelocity,
      rising,
      breakout,

      liqTrap,
      entryZone,
      convergence: conv
    });
  } catch (e) {
    return bad(res, 500, `Overlay error: ${String(e?.message || e)}`);
  }
});

// ✅ decision now becomes real because overlay is real
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

// basic feed endpoints (keep your existing ones)
app.get("/feed", authMiddleware("basic"), (req, res) => ok(res, { signals: feed }));
app.get("/feed/json", authMiddleware("basic"), (req, res) => res.json({ signals: feed }));
app.get("/health", (req, res) => res.json({ ok: true }));

// WS
wss.on("connection", (ws) => {
  ws.send(JSON.stringify({ type: "hello", ok: true }));
});

server.listen(PORT, () => console.log(`✅ Moon Signal backend on :${PORT}`));
