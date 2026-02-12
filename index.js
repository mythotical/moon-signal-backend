const app = require("./src/server");

const PORT = process.env.PORT || 10000;

app.listen(PORT, () => {
  console.log(`✅ Server listening on ${PORT}`);
});
