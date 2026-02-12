const express = require("express");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const shopifyRouter = require("./routes/shopify");
const licenseRouter = require("./routes/license");
const decisionRouter = require("./routes/decision");

const app = express();

app.disable("x-powered-by");

// -------------------------------
// CORS + PREFLIGHT FIX (AXIOM)
// -------------------------------
// IMPORTANT:
// - Axiom runs at https://axiom.trade (cross-origin to your Render backend)
// - Browser sends OPTIONS preflight first
// - If OPTIONS is blocked or missing headers, the browser blocks all calls
//
// This middleware:
// 1) Whitelists allowed origins (axiom.trade, dexscreener.com, chrome-extension://...)
// 2) Adds Access-Control-* headers
// 3) Short-circuits OPTIONS with 204 BEFORE any auth/license middleware
//
const isAllowedOrigin = (origin) => {
  if (!origin) return false;

  // Chrome extension pages
  if (origin.startsWith("chrome-extension://")) return true;

  // Axiom + subdomains if any
  if (origin === "https://axiom.trade") return true;
  if (/^https:\/\/([a-z0-9-]+\.)*axiom\.trade$/i.test(origin)) return true;

  // Dexscreener
  if (origin === "https://dexscreener.com") return true;
  if (/^https:\/\/([a-z0-9-]+\.)*dexscreener\.com$/i.test(origin)) return true;

  return false;
};

app.use((req, res, next) => {
  const origin = (req.headers.origin || "").toString();

  // If the request has an Origin and it's allowed, echo it back.
  // (Echoing is safest; using "*" can be fine too, but echo keeps future credential options open.)
  if (origin && isAllowedOrigin(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
  }

  // Always allow these methods/headers for preflight + actual calls
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,OPTIONS");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization, X-MS-License, X-MS-Key"
  );
  res.setHeader("Access-Control-Max-Age", "86400");

  // CRITICAL: end OPTIONS here so it never hits requireLicense and never returns 401
  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }

  next();
});

// Mount Shopify webhook routes with raw body middleware for HMAC verification
app.use("/webhooks/shopify", express.raw({ type: "application/json" }), shopifyRouter);

app.use(express.json({ limit: "200kb" }));

// Mount license routes
app.use(licenseRouter);
// --- License/Auth Gate ---
// Set env var: MS_LICENSE_KEYS="KEY1,KEY2,KEY3"
// If not set, server runs in open mode.
const LICENSE_KEYS = (process.env.MS_LICENSE_KEYS || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
const OPEN_MODE = LICENSE_KEYS.length === 0;

function getLicenseFromReq(req) {
  // Prefer explicit header used by the extension.
  const h1 = (req.headers["x-ms-license"] || "").toString().trim();
  if (h1) return h1;

  // Allow Authorization: Bearer <key>
  const auth = (req.headers["authorization"] || "").toString();
  const m = auth.match(/^Bearer\s+(.+)$/i);
  if (m && m[1]) return m[1].trim();

  // Back-compat: some older client code used x-ms-key
  const h2 = (req.headers["x-ms-key"] || "").toString().trim();
  if (h2) return h2;

  return "";
}

function licenseOk(key) {
  if (OPEN_MODE) return true;
  return !!key && LICENSE_KEYS.includes(key);
}

function licenseHash(key) {
  return crypto.createHash("sha256").update(String(key)).digest("hex");
}

const DATA_DIR = path.join(process.cwd(), "data");
const USERS_FILE = path.join(DATA_DIR, "users.json");
const WALLET_BUYS_FILE = path.join(DATA_DIR, "wallet_buys.json");
const CONV_FILE = path.join(DATA_DIR, "convergence_hits.json");

function ensureDataDir() {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  } catch {}
}

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf-8"));
  } catch {
    return fallback;
  }
}

function writeJson(file, obj) {
  try {
    fs.writeFileSync(file, JSON.stringify(obj, null, 2));
  } catch {}
}

ensureDataDir();

// In-memory state with disk persistence (best-effort).
const usersByHash = readJson(USERS_FILE, {});
const walletBuysByUser = readJson(WALLET_BUYS_FILE, {});
const convergenceByUser = readJson(CONV_FILE, {});

function saveAll() {
  writeJson(USERS_FILE, usersByHash);
  writeJson(WALLET_BUYS_FILE, walletBuysByUser);
  writeJson(CONV_FILE, convergenceByUser);
}

function upsertUserForKey(key) {
  const h = licenseHash(key);
  if (!usersByHash[h]) {
    usersByHash[h] = { tier: "PRO", wallets: [], createdAt: Date.now() };
  }
  if (!walletBuysByUser[h]) walletBuysByUser[h] = [];
  if (!convergenceByUser[h]) convergenceByUser[h] = [];
  return { hash: h, user: usersByHash[h] };
}

function requireLicense(req, res, next) {
  if (OPEN_MODE) return next();
  const key = getLicenseFromReq(req);
  if (!key || !LICENSE_KEYS.includes(key)) {
    return res.status(401).json({ error: "license_required" });
  }
  return next();
}

function maxWalletsForTier(tier) {
  const t = String(tier || "PRO").toUpperCase();
  if (t === "CORE") return 0;
  if (t === "PRO") return 10;
  return 50; // ELITE default
}

function normAddr(s) {
  return String(s || "").trim();
}

function isSolanaAddr(s) {
  // base58-ish, 32-48 chars; loose validation
  const t = normAddr(s);
  return (
    t.length >= 32 &&
    t.length <= 48 &&
    /^[1-9A-HJ-NP-Za-km-z]+$/.test(t)
  );
}

// Health is always open
app.get("/health", (req, res) => res.json({ ok: true, openMode: OPEN_MODE }));

// Verify license key (used by extension)
app.get("/auth/verify", (req, res) => {
  if (OPEN_MODE) return res.json({ ok: true, openMode: true });
  const key = (req.headers["x-ms-license"] || "").toString().trim();
  return res.json({ ok: !!key && LICENSE_KEYS.includes(key), openMode: false });
});

// --- ML Assist (assistant-only) ---
app.get("/assist/:chain/:pair", requireLicense, (req, res) => {
  const alpha = Number(req.query.alpha || 0);
  const rug = Number(req.query.rug || 0);
  const chg5 = Number(req.query.chg5 || 0);
  const chg1 = Number(req.query.chg1 || 0);
  const buys5 = Number(req.query.buys5 || 0);
  const sells5 = Number(req.query.sells5 || 0);
  const tx5 = buys5 + sells5;
  const buyRatio = tx5 > 0 ? buys5 / tx5 : 0.5;

  const clamp01 = (x) => Math.max(0, Math.min(1, x));
  const round3 = (x) => Math.round(x * 1000) / 1000;

  const p_pump_30m = clamp01(
    0.15 +
      alpha / 160 +
      Math.max(0, chg5) / 80 +
      Math.max(0, chg1) / 160 +
      (buyRatio - 0.5) * 0.8
  );
  const p_rug_15m = clamp01(
    0.10 +
      rug / 140 +
      Math.max(0, -chg5) / 60 +
      Math.max(0, -chg1) / 120 +
      (0.5 - buyRatio) * 0.9
  );
  const regime =
    p_rug_15m >= 0.62
      ? "high-risk"
      : p_pump_30m >= 0.62
      ? "momentum"
      : chg5 < 0
      ? "pullback"
      : "neutral";
  const assistantConfidence = clamp01(
    0.55 + Math.abs(p_pump_30m - p_rug_15m) * 0.65
  );

  res.json({
    p_pump_30m: round3(p_pump_30m),
    p_rug_15m: round3(p_rug_15m),
    regime,
    assistantConfidence: round3(assistantConfidence),
    note: "Assistant-only (never a trade decision)",
  });
});

// --- Honeypot / sell simulation (scaffold) ---
app.post("/honeypot/evaluate", requireLicense, async (req, res) => {
  const { chain, token, pair } = req.body || {};
  if (!chain || !token)
    return res.status(400).json({ error: "missing_chain_or_token" });

  const isEvm = /^0x[a-fA-F0-9]{40}$/.test(token);
  const out = {
    chain,
    token,
    pair: pair || "",
    ok: true,
    source: null,
    canSell: "unknown",
    buyTaxBps: null,
    sellTaxBps: null,
    warnings: [],
  };

  try {
    if (isEvm) {
      const chainIdMap = {
        ethereum: 1,
        eth: 1,
        bsc: 56,
        binance: 56,
        polygon: 137,
        matic: 137,
        arbitrum: 42161,
        arb: 42161,
        optimism: 10,
        op: 10,
        base: 8453,
        avalanche: 43114,
        avax: 43114,
      };
      const cid = chainIdMap[String(chain).toLowerCase()] || 1;
      const url = `https://api.honeypot.is/v2/IsHoneypot?address=${token}&chainID=${cid}`;
      const hp = await fetch(url, {
        headers: { accept: "application/json" },
      }).then((r) => r.json());
      out.source = "honeypot.is";
      const isHoneypot = !!hp?.honeypotResult?.isHoneypot;
      const buyTax = hp?.simulationResult?.buyTax ?? hp?.simulationResult?.taxes?.buyTax;
      const sellTax = hp?.simulationResult?.sellTax ?? hp?.simulationResult?.taxes?.sellTax;
      out.buyTaxBps = buyTax == null ? null : Math.round(Number(buyTax) * 100);
      out.sellTaxBps = sellTax == null ? null : Math.round(Number(sellTax) * 100);
      out.canSell = isHoneypot ? "no" : "yes";
      if (isHoneypot) out.warnings.push("honeypot_flagged");
      if (out.sellTaxBps != null && out.sellTaxBps > 2500)
        out.warnings.push("high_sell_tax");
      if (out.buyTaxBps != null && out.buyTaxBps > 2500)
        out.warnings.push("high_buy_tax");
    } else {
      const url = `https://api.rugcheck.xyz/v1/tokens/${token}/report`;
      const hdr = {};
      if (process.env.RUGCHECK_API_KEY) hdr["X-API-KEY"] = process.env.RUGCHECK_API_KEY;
      const rc = await fetch(url, { headers: hdr }).then((r) => r.json());
      out.source = "rugcheck.xyz";
      const risk = rc?.score ?? rc?.riskScore ?? rc?.summary?.score ?? null;
      const warnings = [];
      const issues = rc?.risks || rc?.warnings || rc?.issues || [];
      if (Array.isArray(issues)) {
        for (const it of issues) {
          const t = (it?.name || it?.type || it?.title || it)?.toString?.() || "";
          if (t) warnings.push(t);
          if (warnings.length >= 6) break;
        }
      }
      out.warnings = warnings.length ? warnings : out.warnings;
      if (typeof risk === "number" && risk >= 700)
        out.warnings.push("high_rugcheck_score");
    }

    return res.json(out);
  } catch (e) {
    out.ok = false;
    out.warnings.push("honeypot_check_failed");
    return res.json(out);
  }
});

// --- Contract analysis (scaffold) ---
app.get("/contract/:chain/:token", requireLicense, (req, res) => {
  const { chain, token } = req.params;
  const flags = [];
  if (!/^0x[a-fA-F0-9]{40}$/.test(token)) {
    flags.push({
      key: "address_format",
      severity: "medium",
      note: "Not an EVM-style address",
    });
  }
  res.json({
    chain,
    token,
    flags,
    summary: { risk: "unknown", note: "Static scaffold. Add RPC checks next." },
  });
});

// --- Wallet convergence feed (per-license; persisted) ---
app.post("/wallet/hit", requireLicense, (req, res) => {
  const key = getLicenseFromReq(req);
  const { hash } = upsertUserForKey(key);

  const { token, chain, pair, score, detail, wallet, wallets, windowMins } =
    req.body || {};
  if (!token || !chain)
    return res.status(400).json({ error: "missing token or chain" });

  const hit = {
    time: Date.now(),
    token: String(token),
    chain: String(chain),
    pair: pair ? String(pair) : "",
    score: score ? String(score) : "ARM",
    detail: detail ? String(detail) : "",
    wallet: wallet ? String(wallet) : "",
    wallets: Array.isArray(wallets) ? wallets.slice(0, 25) : [],
    windowMins: Number(windowMins || 10),
  };

  convergenceByUser[hash].unshift(hit);
  if (convergenceByUser[hash].length > 1000) convergenceByUser[hash].pop();
  saveAll();
  res.json({ ok: true });
});

app.get("/wallet/hits", requireLicense, (req, res) => {
  const key = getLicenseFromReq(req);
  const { hash } = upsertUserForKey(key);
  const limit = Math.min(100, Number(req.query.limit || 25));
  res.json({ hits: (convergenceByUser[hash] || []).slice(0, limit) });
});

// --- User wallets (self-serve) ---
app.get("/user/wallets", requireLicense, (req, res) => {
  const key = getLicenseFromReq(req);
  const { hash, user } = upsertUserForKey(key);
  const tier = String(user.tier || "PRO").toUpperCase();
  res.json({ tier, maxWallets: maxWalletsForTier(tier), wallets: user.wallets || [] });
});

app.put("/user/wallets", requireLicense, (req, res) => {
  const key = getLicenseFromReq(req);
  const { hash, user } = upsertUserForKey(key);
  const tier = String(user.tier || "PRO").toUpperCase();
  const max = maxWalletsForTier(tier);
  const incoming = Array.isArray(req.body?.wallets) ? req.body.wallets : [];

  const cleaned = [];
  for (const w of incoming) {
    const address = normAddr(w?.address);
    if (!address) continue;
    if (!isSolanaAddr(address)) continue;
    const label = normAddr(w?.label).slice(0, 24);
    const enabled = w?.enabled !== false;
    cleaned.push({ address, label, enabled, createdAt: w?.createdAt || Date.now() });
    if (cleaned.length >= max) break;
  }

  user.wallets = cleaned;
  usersByHash[hash] = user;
  saveAll();
  res.json({ ok: true, tier, maxWallets: max, wallets: cleaned });
});

// --- Helius webhook ingest (Solana) ---
app.post("/helius/webhook", async (req, res) => {
  const secret = (process.env.HELIUS_WEBHOOK_SECRET || "").trim();
  if (secret) {
    const got = (req.headers["x-ms-webhook-secret"] || req.headers["x-helius-secret"] || "")
      .toString()
      .trim();
    if (got !== secret) return res.status(401).json({ error: "bad_secret" });
  }

  const events = Array.isArray(req.body)
    ? req.body
    : Array.isArray(req.body?.events)
    ? req.body.events
    : [];
  if (!events.length) return res.json({ ok: true, ingested: 0 });

  const windowMins = Number(process.env.MS_CONV_WINDOW_MINS || 10);
  const minWallets = Math.max(2, Number(process.env.MS_CONV_MIN_WALLETS || 3));
  const now = Date.now();
  let ingested = 0;

  const walletToUsers = new Map();
  for (const [userHash, u] of Object.entries(usersByHash)) {
    for (const w of u.wallets || []) {
      if (!w?.enabled) continue;
      const addr = normAddr(w.address);
      if (!addr) continue;
      const arr = walletToUsers.get(addr) || [];
      arr.push(userHash);
      walletToUsers.set(addr, arr);
    }
  }

  const seenPairs = new Set();

  for (const ev of events) {
    const signature = ev?.signature || ev?.transactionSignature || "";
    const transfers = Array.isArray(ev?.tokenTransfers) ? ev.tokenTransfers : [];
    for (const t of transfers) {
      const to = normAddr(t?.toUserAccount || t?.toAccount || t?.to || "");
      if (!to) continue;
      const users = walletToUsers.get(to);
      if (!users || !users.length) continue;

      const mint = normAddr(t?.mint || t?.tokenAddress || "");
      if (!mint) continue;

      const rawAmt = t?.tokenAmount ?? t?.amount ?? t?.uiTokenAmount?.uiAmount ?? 0;
      const amt = Number(rawAmt);
      if (!Number.isFinite(amt) || amt <= 0) continue;

      for (const userHash of users) {
        const buys = walletBuysByUser[userHash] || [];
        const key = `${to}|${mint}`;
        if (seenPairs.has(`${userHash}|${key}`)) continue;
        if (buys.some((b) => b.wallet === to && b.mint === mint)) continue;

        buys.unshift({ wallet: to, mint, ts: now, signature: signature || "" });
        if (buys.length > 5000) buys.pop();
        walletBuysByUser[userHash] = buys;
        ingested++;
        seenPairs.add(`${userHash}|${key}`);

        const cutoff = now - windowMins * 60 * 1000;
        const recent = buys.filter((b) => b.mint === mint && b.ts >= cutoff);
        const uniq = new Map();
        for (const b of recent) uniq.set(b.wallet, true);
        const uniqCount = uniq.size;

        if (uniqCount >= minWallets) {
          const prev = (convergenceByUser[userHash] || []).find(
            (h) => h.token === mint && now - h.time <= windowMins * 60 * 1000
          );
          if (!prev) {
            const wallets = (usersByHash[userHash]?.wallets || [])
              .filter((w) => uniq.has(w.address))
              .map((w) => ({ address: w.address, label: w.label || "" }));
            const hit = {
              time: now,
              token: mint,
              chain: "solana",
              pair: "",
              score: "HC",
              detail: `${uniqCount} tracked wallets bought within ${windowMins}m`,
              wallets,
              windowMins,
            };
            (convergenceByUser[userHash] ||= []).unshift(hit);
            if (convergenceByUser[userHash].length > 1000) convergenceByUser[userHash].pop();
          }
        }
      }
    }
  }

  saveAll();
  res.json({ ok: true, ingested });
});

// --- Feedback store (in-memory) ---
const feedback = [];
app.post("/feedback", requireLicense, (req, res) => {
  const { chain, pair, outcome, notes } = req.body || {};
  if (!chain || !pair || !outcome)
    return res.status(400).json({ error: "missing_fields" });
  feedback.unshift({
    time: Date.now(),
    chain: String(chain),
    pair: String(pair),
    outcome: String(outcome),
    notes: notes ? String(notes) : "",
  });
  if (feedback.length > 5000) feedback.pop();
  res.json({ ok: true });
});
app.get("/feedback/recent", requireLicense, (req, res) => {
  const limit = Math.min(200, Number(req.query.limit || 50));
  res.json({ feedback: feedback.slice(0, limit) });
});
module.exports = app;