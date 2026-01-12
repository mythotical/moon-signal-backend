// src/index.js
const app = require("./app");

const PORT = Number(process.env.PORT || 8787);
app.listen(PORT, "0.0.0.0", () => {
  console.log(`moon-signal-backend listening on :${PORT}`);
});
