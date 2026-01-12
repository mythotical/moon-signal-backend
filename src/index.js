const app = require("./app");

const PORT = process.env.PORT || 8787;

app.listen(PORT, "0.0.0.0", () => {
  console.log("Moon Signal backend running on port", PORT);
});
