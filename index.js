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
const HELIUS_WEBHOOK_SECRET = process.env.HELIUS_WEBHOOK_SECRET || "";
const ENABLE_WS = String(process.env.ENABLE_WS || "1") === "1";

// ------------------- App + Server -------------------
const app = express();
app.use(cors());
app.use(express.json({ limit: "2mb" }));

const server = http.createServer(app);
const wss = new WebSocketServer({ server });

function bad(res, code, msg) {
  return res.status(code).json({ error: msg });
}

// ------------------- WebSocket broadcast -------------------
function wsBroadcast(obj) {
  if (!ENABLE_WS) return;
  const msg = JSON.stringify(obj);
  for (const client of wss.clients) {
    try {
      if (client.readyState === 1) client.send(msg);
    } catch {}
  }
}

// ------------------- Convergence tracker -------------------
const convergence = createConvergenceTracker({
  maxTokens: 2000,
  maxEventsPerToken: 300,
  decayMs: 60 * 60 * 1000
});

// ------------------- License load (optional local file) -------------------
const LICENSE_PATH = "./licenses.json";
if (fs.existsSync(LICENSE_PATH)) {
  try {
    const j = JSON.parse(fs.readFileSync(LICENSE_PATH, "utf8"));
    if (Array.isArray(j)) for (const k of j) addLicense(k);
  } catch {}
}

// ------------------- Health -------------------
app.get("/health", (req, res) => res.json({ ok: true }));

// ------------------- Overlay endpoint (NOW REAL PER-PAIR) -------------------
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

  // Fallback values (only used if Dex API fails)
  let tokenLabel = (url.split("/").pop() || "PAIR").toUpperCase();
  let dexLiquidityUsd = Number(req.query.liq || 0);
  let dexVolume24hUsd = Number(req.query.vol || 0);
  let priceChange1h = Number(req.query.ch1h || 0);
  let priceChange24h = Number(req.query.ch24 || 0);
  let fdv = Number(req.query.fdv || 0);
  let tokenKey = tokenLabel;

  let pairObj = null;

  if (parsed) {
    try {
      const dexUrl = `https://api.dexscreener.com/latest/dex/pairs/${encodeURIComponent(parsed.chain)}/${encodeURIComponent(parsed.pair)}`;
      const r = await fetch(dexUrl, { cache: "no-store" });
      if (!r.ok) throw new Error(`dex_api_${r.status}`);
      const j = await r.json();
      pairObj = j?.pair || null;

      if (pairObj) {
        tokenLabel = (pairObj?.baseToken?.symbol || pairObj?.baseToken?.name || tokenLabel || "TOKEN").toString();
        tokenKey = (pairObj?.baseToken?.address || tokenLabel).toString();

        dexLiquidityUsd = Number(pairObj?.liquidity?.usd ?? dexLiquidityUsd ?? 0);
        dexVolume24hUsd = Number(pairObj?.volume?.h24 ?? dexVolume24hUsd ?? 0);
        priceChange1h = Number(pairObj?.priceChange?.h1 ?? priceChange1h ?? 0);
        priceChange24h = Number(pairObj?.priceChange?.h24 ?? priceChange24h ?? 0);
        fdv = Number(pairObj?.fdv ?? fdv ?? 0);
      }
    } catch {
      // Keep fallback metrics if Dex API fails
    }
  }

  // Rug heuristics (real pair if available)
  const rug = computeRugRiskFromDexPair(pairObj || { liquidity: { usd: dexLiquidityUsd }, volume: { h24: dexVolume24hUsd }, fdv });

  const liqTrap = computeLiquidityTrap({ dexLiquidityUsd, dexVolume24hUsd });
  const entryZone = computeEntryZone({ priceChange1h, priceChange24h });

  // Convergence keyed by token address when possible (avoids symbol collisions)
  const conv = convergence.get(tokenKey);

  // Breakout + rising (until social velocity is wired)
  const breakout = priceChange1h >= 8 || (dexVolume24hUsd >= 120000 && dexLiquidityUsd >= 50000);
  const rising = priceChange1h >= 3 || dexVolume24hUsd >= 120000;

  // Alpha score driven by real metrics
  const score =
    Math.min(
      100,
      Math.round(
        (dexLiquidityUsd >= 50000 ? 25 : dexLiquidityUsd >= 15000 ? 15 : 5) +
        (dexVolume24hUsd >= 250000 ? 25 : dexVolume24hUsd >= 120000 ? 18 : 8) +
        (priceChange1h >= 6 ? 18 : priceChange1h >= 3 ? 12 : 6) +
        (100 - rug.risk) * 0.20 +
        (conv.strength || 0) * 0.20
      )
    );

  res.json({
    token: tokenLabel,
    tokenKey,
    score,
    rug,
    dexLiquidityUsd,
    dexVolume24hUsd,
    priceChange1h,
    priceChange24h,
    fdv,
    rising,
    breakout,
    liqTrap,
    entryZone,
    convergence: conv
  });
});

// ------------------- Decision endpoint -------------------
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
  const token = String(req.query.token || "MOON");
  const wallet = String(req.query.wallet || "TESTWALLET");
  const tier = String(req.query.tier || "S");
  convergence.note({ token, wallet, tier });
  const snap = convergence.get(token);
  wsBroadcast({ type: "Convergence", token, ...snap, ts: Date.now() });
  res.json({ ok: true, token, ...snap });
});

// -------- Paid SaaS: license admin (LOCK THIS DOWN) --------
app.post("/admin/create-key", (req, res) => {
  const ADMIN_SECRET = process.env.ADMIN_SECRET || "";
  if (!ADMIN_SECRET) return bad(res, 500, "admin_not_configured");
  if (req.headers["x-admin-secret"] !== ADMIN_SECRET) return bad(res, 401, "unauthorized");

  const key = String(req.body?.key || "").trim();
  if (!key) return bad(res, 400, "missing_key");

  addLicense(key);

  // Optional: write to file (for local dev). On Render filesystem may reset.
  try {
    let current = [];
    if (fs.existsSync(LICENSE_PATH)) current = JSON.parse(fs.readFileSync(LICENSE_PATH, "utf8"));
    if (!Array.isArray(current)) current = [];
    if (!current.includes(key)) current.push(key);
    fs.writeFileSync(LICENSE_PATH, JSON.stringify(current, null, 2));
  } catch {}

  res.json({ ok: true });
});

app.get("/admin/list-keys", (req, res) => {
  const ADMIN_SECRET = process.env.ADMIN_SECRET || "";
  if (!ADMIN_SECRET) return bad(res, 500, "admin_not_configured");
  if (req.headers["x-admin-secret"] !== ADMIN_SECRET) return bad(res, 401, "unauthorized");

  res.json({ ok: true, keys: listLicenses() });
});

// -------- Root + WS connect --------
app.get("/", (req, res) => res.send("Moon Signal backend online"));
wss.on("connection", (ws) => {
  ws.send(JSON.stringify({ type: "System", token: "MOON", message: "✅ WebSocket connected", ts: Date.now() }));
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`✅ Backend running on port ${PORT}`);
});
