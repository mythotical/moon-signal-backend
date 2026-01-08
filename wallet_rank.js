// wallet_rank.js
// Lightweight wallet performance tracker + auto-ranking.
// Works in-memory; attempts to persist to wallet_perf.json (may reset on Render restarts).

import fs from "fs";

const FILE = "./wallet_perf.json";

export function createWalletRanker() {
  let state = { wallets: {} };

  // Load if exists
  try {
    if (fs.existsSync(FILE)) {
      state = JSON.parse(fs.readFileSync(FILE, "utf-8"));
    }
  } catch {
    // ignore
  }

  function save() {
    try {
      fs.writeFileSync(FILE, JSON.stringify(state, null, 2));
    } catch {
      // ignore on Render free tier
    }
  }

  function clamp(n, a, b) {
    return Math.max(a, Math.min(b, n));
  }

  function ensure(addr) {
    if (!state.wallets[addr]) {
      state.wallets[addr] = {
        tier: "A",
        score: 50,
        wins: 0,
        losses: 0,
        lastSeen: 0,
        lastToken: null
      };
    }
    return state.wallets[addr];
  }

  function updateTier(w) {
    if (w.score >= 80) w.tier = "S";
    else if (w.score >= 60) w.tier = "A";
    else if (w.score >= 40) w.tier = "B";
    else w.tier = "C";
  }

  function noteActivity(addr, token) {
    const w = ensure(addr);
    w.lastSeen = Date.now();
    w.lastToken = token || w.lastToken;
    w.score = clamp(w.score + 2, 0, 100);
    updateTier(w);
    save();
    return w;
  }

  function noteWin(addr) {
    const w = ensure(addr);
    w.wins++;
    w.score = clamp(w.score + 10, 0, 100);
    updateTier(w);
    save();
    return w;
  }

  function noteLoss(addr) {
    const w = ensure(addr);
    w.losses++;
    w.score = clamp(w.score - 10, 0, 100);
    updateTier(w);
    save();
    return w;
  }

  function getTier(addr, fallbackTier = "A") {
    const w = ensure(addr);
    return w.tier || fallbackTier;
  }

  function topWallets(limit = 20) {
    const arr = Object.entries(state.wallets).map(([address, w]) => ({ address, ...w }));
    arr.sort((a, b) => (b.score - a.score) || (b.wins - a.wins) || (a.losses - b.losses));
    return arr.slice(0, limit);
  }

  function getState() {
    return state;
  }

  return {
    noteActivity,
    noteWin,
    noteLoss,
    getTier,
    topWallets,
    getState
  };
}
