// cors.js
const ALLOWED_ORIGINS = new Set([
  "https://axiom.trade",
  "https://dexscreener.com",
  "https://www.dexscreener.com",
  // If you ever test locally:
  "http://localhost:3000",
  "http://localhost:5173",
]);

function corsMiddleware(req, res, next) {
  const origin = req.headers.origin;

  // If request has an Origin header and it's allowed, reflect it back.
  if (origin && ALLOWED_ORIGINS.has(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin"); // critical for caches/proxies
    res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
    res.setHeader(
      "Access-Control-Allow-Headers",
      req.headers["access-control-request-headers"] || "content-type,authorization"
    );
    // Only set this if you truly use cookies/auth across origins.
    // res.setHeader("Access-Control-Allow-Credentials", "true");
    res.setHeader("Access-Control-Max-Age", "86400"); // cache preflight 24h
  }

  // Always respond to preflight if it's OPTIONS and origin is allowed
  if (req.method === "OPTIONS") {
    // If origin isn't allowed, returning 204 still prevents hanging.
    // But it won’t include ACAO if not allowed.
    return res.status(204).end();
  }

  next();
}

module.exports = { corsMiddleware };
