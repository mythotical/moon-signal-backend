const express = require("express");
const router = express.Router();

router.get("/contract/:chain/:token", (req, res) => {
  const { chain, token } = req.params;

  const flags = [];

  if (!/^0x[a-fA-F0-9]{40}$/.test(token)) {
    flags.push({
      key: "address_format",
      severity: "medium",
      note: "Token does not look like an EVM address"
    });
  }

  res.json({
    chain,
    token,
    flags,
    summary: {
      risk: flags.length ? "unknown" : "unknown",
      note: "Static analysis placeholder"
    }
  });
});

module.exports = router;
