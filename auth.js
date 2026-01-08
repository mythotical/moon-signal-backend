// auth.js — simple license key auth + plans (starter SaaS gate)
import fs from "fs";

const DB_PATH = "./licenses.json";

function loadDb() {
  try {
    return JSON.parse(fs.readFileSync(DB_PATH, "utf-8"));
  } catch {
    return {
      // Put your own key here for yourself (example key)
      "DEV-KEY-123": { plan: "pro", active: true, createdAt: Date.now() }
    };
  }
}

function saveDb(db) {
  fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2));
}

let db = loadDb();

export function authMiddleware(requiredPlan = "free") {
  return (req, res, next) => {
    const key = req.headers["x-ms-key"] || req.query.key || "";
    if (!key) return res.status(401).json({ ok: false, error: "missing_key" });

    const row = db[String(key)];
    if (!row || !row.active) return res.status(403).json({ ok: false, error: "invalid_or_inactive_key" });

    // plan order
    const order = { free: 0, basic: 1, pro: 2, enterprise: 3 };
    const have = order[row.plan] ?? 0;
    const need = order[requiredPlan] ?? 0;

    if (have < need) {
      return res.status(402).json({ ok: false, error: "upgrade_required", have: row.plan, need: requiredPlan });
    }

    req.license = { key: String(key), ...row };
    next();
  };
}

// optional admin endpoint helpers (manual)
export function addLicense(key, plan = "basic") {
  db[String(key)] = { plan, active: true, createdAt: Date.now() };
  saveDb(db);
  return db[String(key)];
}

export function deactivateLicense(key) {
  if (!db[String(key)]) return false;
  db[String(key)].active = false;
  saveDb(db);
  return true;
}

export function listLicenses() {
  return db;
}
