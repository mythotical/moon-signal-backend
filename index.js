// index.js — CLEAN, SAFE, DEPLOYABLE
import express from "express";
import cors from "cors";
import http from "http";

// --------------------
// App + Server
// --------------------
const app = express();
const server = http.createServer(app);

app.use(cors());
app.use(express.json());

// --------------------
// In-memory stores
// --------------------
const feed = [];
const convergenceHits = new Map(); // token -> { sCount, aCount, strength }

// --------------------
// Helpers
// --------------------
function now() {
  return Date.now();
}

function addSignal(signal) {
  feed.unshift(signal);
  if (feed.length > 200) feed.length = 200;
}

function noteConvergence(token, tier = "A") {
  const t = token.toUpperCase();
  const row = convergenceHits.get(t) || { token: t, sCount: 0, aCount: 0 };

  if (tier === "S") row.sCount++;
  else row.aCount++;

  row.strength = Math.min(100, row.sCount * 45 + row.aCount * 18);
  convergenceHits.set(t, row);
}

// --------------------
// Routes
// --------------------
app.get("/", (req, res) => {
  res.send("Moon Signal backend online");
});

// ---- FEED ----
app.get("/feed", (req, res) => {
  res.json(feed);
});

app.get("/feed/hc", (req, res) => {
  res.json(feed.filter(s => s.highConviction === true));
});

// ---- TEST SIGNAL ----
app.get("/test-signal", (req, res) => {
  const sig = {
    token: "MOONCAT",
    score: 92,
    message: "Test HC signal fired",
    highConviction: true,
    walletLabel: "Tier-S SOL Sniper",
    rug: { risk: 28 },
    breakout: true,
    rising: true,
    ts: now(),
    dex: "https://dexscreener.com"
  };

  addSignal(sig);
  noteConvergence(sig.token, "S");

  res.json({ ok: true });
});

// ---- CONVERGENCE MAP ----
app.get("/convergence", (req, res) => {
  const limit = Number(req.query.limit || 25);

  const list = Array.from(convergenceHits.values())
    .sort((a, b) => b.strength - a.strength)
    .slice(0, limit);

  res.json({ tokens: list });
});

// --------------------
// Start server
// --------------------
const PORT = process.env.PORT || 8080;
server.listen(PORT, () => {
  console.log(`✅ Backend running on port ${PORT}`);
});
