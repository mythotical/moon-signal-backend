import "dotenv/config";
import express from "express";
import http from "http";
import cors from "cors";
import { WebSocketServer } from "ws";

const PORT = Number(process.env.PORT || 8080);

const app = express();
app.use(cors());
app.use(express.json());

const server = http.createServer(app);
const wss = new WebSocketServer({ server });

// store signals
const latestSignals = [];

// broadcast helper
function broadcast(obj) {
  const msg = JSON.stringify(obj);
  for (const client of wss.clients) {
    if (client.readyState === 1) client.send(msg);
  }
}

// websocket connect
wss.on("connection", (ws) => {
  ws.send(
    JSON.stringify({
      type: "System",
      token: "MOON",
      score: 100,
      message: "✅ Connected to Moon Signal (live)"
    })
  );
});

// health
app.get("/", (req, res) => {
  res.status(200).send("Moon Signal backend OK");
});

// feed
app.get("/feed", (req, res) => {
  res.json(latestSignals.slice(0, 20));
});

// test signal (proves extension updates)
app.get("/test-signal", (req, res) => {
  const s = {
    type: "Test",
    token: "MOONCAT",
    chain: "SOL",
    score: 88,
    message: "🚀 Test signal fired (Render live)",
    reasons: ["Feed OK", "WS OK"],
    rug: { risk: 55, level: "MED", reasons: ["Demo risk"] },
    ts: Date.now()
  };

  latestSignals.unshift(s);
  latestSignals.splice(200);
  broadcast(s);

  res.json({ ok: true, sent: s });
});

// overlay (demo response so your UI shows rug bar)
app.get("/overlay", (req, res) => {
  res.json({
    token: "DEMO",
    score: 77,
    reasons: ["Render live", "Overlay OK"],
    pairUrl: "https://dexscreener.com",
    rug: { risk: 55, level: "MED", reasons: ["Demo: wire Dex next"] }
  });
});

// IMPORTANT: Render needs 0.0.0.0
server.listen(PORT, "0.0.0.0", () => {
  console.log(`✅ Listening on port ${PORT}`);
});


