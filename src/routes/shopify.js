// src/routes/shopify.js
const express = require("express");
const crypto = require("crypto");

const router = express.Router();

/**
 * Capture RAW body for Shopify HMAC verification
 */
router.use(
  express.json({
    verify: (req, res, buf) => {
      req.rawBody = buf; // Buffer
    },
  })
);

function verifyShopifyHmac(req) {
  const secret = process.env.SHOPIFY_WEBHOOK_SECRET;
  if (!secret) throw new Error("Missing SHOPIFY_WEBHOOK_SECRET");

  const hmacHeader = req.get("X-Shopify-Hmac-Sha256");
  if (!hmacHeader) return false;

  const digest = crypto
    .createHmac("sha256", secret)
    .update(req.rawBody)
    .digest("base64");

  const a = Buffer.from(digest, "utf8");
  const b = Buffer.from(hmacHeader, "utf8");
  if (a.length !== b.length) return false;

  return crypto.timingSafeEqual(a, b);
}

router.get("/ping", (req, res) => {
  res.json({ ok: true, route: "shopify webhook router alive" });
});

router.post("/order-paid", async (req, res) => {
  try {
    // 1) Verify Shopify signature
    const ok = verifyShopifyHmac(req);
    if (!ok) {
      console.log("❌ Shopify HMAC failed");
      return res.status(401).send("Unauthorized");
    }

    // 2) Parse order
    const order = req.body;
    console.log("✅ Shopify webhook received: order-paid");
    console.log("Order ID:", order?.id);
    console.log("Email:", order?.email);

    const item = order?.line_items?.[0];
    if (!item) {
      console.log("❌ No line_items found");
      return res.status(400).json({ error: "No line items" });
    }

    const title = (item.title || "").trim().toUpperCase();
    console.log("Item title:", title);

    // 3) Map product title -> Keygen policy
    let policyId = null;
    if (title === "BASIC") policyId = process.env.KEYGEN_POLICY_BASIC;
    else if (title === "PRO") policyId = process.env.KEYGEN_POLICY_PRO;
    else if (title === "PRO+") policyId = process.env.KEYGEN_POLICY_PROPLUS;

    if (!policyId) {
      console.log("❌ Unknown tier/title:", title);
      return res.status(400).json({ error: "Unknown tier/title" });
    }

    const token = process.env.KEYGEN_TOKEN;
    if (!token) throw new Error("Missing KEYGEN_TOKEN");

    // 4) Create Keygen license (using Node 20 built-in fetch)
    const keygenResp = await fetch("https://api.keygen.sh/v1/licenses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/vnd.api+json",
        Accept: "application/vnd.api+json",
      },
      body: JSON.stringify({
        data: {
          type: "licenses",
          relationships: {
            policy: {
              data: {
                type: "policies",
                id: policyId,
              },
            },
          },
          attributes: {
            metadata: {
              shopify_order_id: String(order?.id || ""),
              shopify_email: String(order?.email || ""),
              tier: title,
            },
          },
        },
      }),
    });

    const keygenJson = await keygenResp.json();

    if (!keygenResp.ok) {
      console.log("❌ Keygen error:", keygenJson);
      return res.status(500).json({ error: "Keygen create failed" });
    }

    const licenseKey = keygenJson?.data?.attributes?.key;
    console.log("🔑 Keygen license created:", licenseKey);

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.log("❌ Webhook error:", err?.message || err);
    return res.status(500).json({ error: "Webhook failed" });
  }
});

module.exports = router;
