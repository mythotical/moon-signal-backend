const express = require("express");
const crypto = require("crypto");
const fetch = require("node-fetch");

const router = express.Router();

router.post(
  "/webhooks/shopify/order-paid",
  express.raw({ type: "application/json" }),
  async (req, res) => {
    try {
      // 🔐 Verify Shopify signature
      const hmac = req.headers["x-shopify-hmac-sha256"];
      const body = req.body.toString("utf8");

      const digest = crypto
        .createHmac("sha256", process.env.SHOPIFY_WEBHOOK_SECRET)
        .update(body)
        .digest("base64");

      if (digest !== hmac) {
        return res.status(401).send("Invalid webhook signature");
      }

      const order = JSON.parse(body);

      // 🧠 Decide tier (based on product title / SKU)
      const lineItem = order.line_items[0];
      let policyId;

      if (lineItem.title.includes("Basic")) {
        policyId = process.env.KEYGEN_POLICY_BASIC;
      } else if (lineItem.title.includes("Pro+")) {
        policyId = process.env.KEYGEN_POLICY_PROPLUS;
      } else if (lineItem.title.includes("Pro")) {
        policyId = process.env.KEYGEN_POLICY_PRO;
      } else {
        return res.status(400).send("Unknown product tier");
      }

      // 🔑 Create license in Keygen
      const response = await fetch(
        `https://api.keygen.sh/v1/accounts/${process.env.KEYGEN_ACCOUNT_ID}/licenses`,
        {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${process.env.KEYGEN_TOKEN}`,
            "Content-Type": "application/vnd.api+json",
            "Accept": "application/vnd.api+json",
          },
          body: JSON.stringify({
            data: {
              type: "licenses",
              relationships: {
                policy: {
                  data: { type: "policies", id: policyId },
                },
              },
            },
          }),
        }
      );

      const json = await response.json();
      const licenseKey = json.data.attributes.key;

      // TODO: email customer (or store it)
      console.log("LICENSE KEY:", licenseKey);

      res.status(200).send("OK");
    } catch (err) {
      console.error(err);
      res.status(500).send("Server error");
    }
  }
);

module.exports = router;
