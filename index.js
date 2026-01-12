const express = require("express");

const assist = require("./routes/assist");
const wallet = require("./routes/wallet");
const contract = require("./routes/contract");
const feedback = require("./routes/feedback");

const app = express();
app.disable("x-powered-by");

// health
app.get("/health", (req, res) => res.json({ ok: true }));

// routes
app.use(assist);
app.use(wallet);
app.use(contract);
app.use(feedback);

// IMPORTANT for Render: must listen on process.env.PORT
const PORT = process.env.PORT || 8787;
app.listen(PORT, "0.0.0.0", () => {
  console.log("Moon Signal backend listening on", PORT);
});
