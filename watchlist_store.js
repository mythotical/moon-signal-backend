// watchlist_store.js
// Very simple persistent watchlist. On Render free tier, filesystem may reset.
// Still works for MVP.

import fs from "fs";

const FILE = "./watchlist.json";

export function createWatchlistStore() {
  let state = { items: [] };

  try {
    if (fs.existsSync(FILE)) state = JSON.parse(fs.readFileSync(FILE, "utf-8"));
  } catch {}

  function save() {
    try { fs.writeFileSync(FILE, JSON.stringify(state, null, 2)); } catch {}
  }

  function add(item) {
    const key = item.key;
    if (!key) return false;
    if (state.items.some(x => x.key === key)) return true;
    state.items.unshift({ ...item, addedAt: Date.now(), lastDecision: null, lastSeen: 0 });
    state.items = state.items.slice(0, 200);
    save();
    return true;
  }

  function remove(key) {
    const before = state.items.length;
    state.items = state.items.filter(x => x.key !== key);
    save();
    return state.items.length !== before;
  }

  function list() {
    return state.items;
  }

  function updateDecision(key, decision) {
    const it = state.items.find(x => x.key === key);
    if (!it) return false;
    it.lastSeen = Date.now();
    it.lastDecision = decision;
    save();
    return true;
  }

  return { add, remove, list, updateDecision };
}
