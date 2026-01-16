const app = require("./server");
const PORT = process.env.PORT || 8787;
app.listen(PORT, "0.0.0.0", () => {
  console.log("Moon Signal backend listening on", PORT);
});
