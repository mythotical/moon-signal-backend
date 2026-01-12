const express = require("express");
const router = express.Router();

router.get("/contract/:chain/:token", (req, res) => {
  const { chain, token } = req.params;
  const flags = [];

  if (!/^0x[a-fA-F0-9]{40}$/.test(token)) {
    flags.push({ key: "address_format", severity: "medium", note: "Not an EVM-style address" });
  }

  res.json({
    chain,
    token,
    flags,
    summary: { risk: "unknown", note: "Static analysis scaffold (add RPC checks next)." }
  });
});

module.exports = router;
