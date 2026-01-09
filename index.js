import fs from "fs";
import express from "express";
import cors from "cors";
import http from "http";
import { WebSocketServer } from "ws";

import { authMiddleware, addLicense, listLicenses } from "./auth.js";
import { createConvergenceTracker } from "./advanced_metrics.js";
import { computeRugRiskFromDexPair } from "./rugrisk.js";
import { computeDecision } from "./decision_engine.js";

const PORT = Number(process.env.PORT || 8080);
const PUBLIC_BASE_URL = process.env.PUBLIC_BASE_URL || ""; // set on Render

// -------- Wallet tiers (optional; keep your existing) --------
const walletsByTier = { S: [], A: [] };
try {
  const raw = fs.readFileSync("./wallets.json", "utf8");
  const j = JSON.parse(raw);
  walletsByTier.S = Array.isArray(j?.S) ? j.S : [];
  walletsByTier.A = Array.isArray(j?.A) ? j.A : [];
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

// -------- Convergence (optional) --------
const convergence = createConvergenceTracker({
  maxTokens: 2000,
  maxEventsPerToken: 300,
  decayMs: 60 * 60 * 1000
});

// -------- Health --------
app.get("/health", (req, res) => res.json({ ok: true }));

// ✅ REAL per-pair overlay (Dex API)
app.get("/overlay", authMiddleware("basic"), async (req, res) => {
  const url = String(req.query.url || "").trim();

  function parseDexUrl(u) {
    try {
      const U = new URL(u);
      const parts = U.pathname.split("/").filter(Boolean);
      const chain = parts[0] || "";
      const pair = parts[1] || "";
      return chain && pair ? { chain, pair } : null;
    } catch {
      return null;
    }
  }

  const parsed = parseDexUrl(url);

  // Defaults ONLY if Dex API fails
  let token = (url.split("/").pop() || "PAIR").toUpperCase();
  let dexLiquidityUsd = 0;
  let dexVolume24hUsd = 0;
  let priceChange1h = 0;
  let priceChange24h = 0;
  let fdv = 0;

  let dexPair = null;

  if (parsed) {
    try {
      const dexUrl = `https://api.dexscreener.com/latest/dex/pairs/${encodeURIComponent(parsed.chain)}/${encodeURIComponent(parsed.pair)}`;
      const r = await fetch(dexUrl, { cache: "no-store" });
      if (!r.ok) throw new Error(`dex_api_${r.status}`);
      const j = await r.json();
      dexPair = j?.pair || null;

      if (dexPair) {
        token = String(dexPair?.baseToken?.symbol || dexPair?.baseToken?.name || token);
        dexLiquidityUsd = Number(dexPair?.liquidity?.usd ?? 0);
        dexVolume24hUsd = Number(dexPair?.volume?.h24 ?? 0);
        priceChange1h = Number(dexPair?.priceChange?.h1 ?? 0);
        priceChange24h = Number(dexPair?.priceChange?.h24 ?? 0);
        fdv = Number(dexPair?.fdv ?? 0);
      }
    } catch (e) {
      console.log("⚠️ Dex API fetch failed:", e?.message || e);
    }
  }

  const rug = computeRugRiskFromDexPair(
    dexPair || { liquidity: { usd: dexLiquidityUsd }, volume: { h24: dexVolume24hUsd }, fdv }
  );

  const tokenKey = String(dexPair?.baseToken?.address || token);
  const conv = convergence.get(tokenKey);

  const rising = priceChange1h >= 3 || dexVolume24hUsd >= 120000;
  const breakout = priceChange1h >= 8 || (dexVolume24hUsd >= 120000 && dexLiquidityUsd >= 50000);

  const score = Math.min(
    100,
    Math.round(
      (dexLiquidityUsd >= 50000 ? 25 : dexLiquidityUsd >= 15000 ? 15 : 5) +
      (dexVolume24hUsd >= 250000 ? 25 : dexVolume24hUsd >= 120000 ? 18 : 8) +
      (priceChange1h >= 6 ? 18 : priceChange1h >= 3 ? 12 : 6) +
      (100 - rug.risk) * 0.20 +
      (conv.strength || 0) * 0.20
    )
  );

  const bars = {
    score: score,
    accel: (() => {
      const buys = Number(dexPair?.txns?.m5?.buys ?? 0);
      const sells = Number(dexPair?.txns?.m5?.sells ?? 0);
      const ratio = buys + sells > 0 ? buys / (buys + sells) : 0.5;
      return Math.max(0, Math.min(100, Math.round(ratio * 100)));
    })(),
    breakout: Math.max(0, Math.min(100, Math.round(Math.max(0, Number(dexPair?.priceChange?.m5 ?? 0)) * 6))),
    rugInv: Math.max(0, Math.min(100, 100 - rug.risk)),
    liquidity: Math.max(0, Math.min(100, Math.round(Math.min(100, dexLiquidityUsd / 1000)))),
    volume: Math.max(0, Math.min(100, Math.round(Math.min(100, dexVolume24hUsd / 5000))))
  };

  res.json({
    token,
    tokenKey,
    score,
    rug,
    bars,
    dexLiquidityUsd,
    dexVolume24hUsd,
    priceChange1h,
    priceChange24h,
    fdv,
    rising,
    breakout,
    convergence: conv
  });
});

// Decision endpoint
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

// Root
app.get("/", (req, res) => res.send("Moon Signal backend online"));

// WS (optional)
wss.on("connection", (ws) => {
  ws.send(JSON.stringify({ type: "System", message: "✅ WS connected", ts: Date.now() }));
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`✅ Backend running on port ${PORT}`);
});
