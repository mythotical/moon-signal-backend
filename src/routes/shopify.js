const express = require("express");
const crypto = require("crypto");

const router = express.Router();

function pickTierFromLineItems(lineItems) {
  const titles = (lineItems || []).map((li) => String(li.title || "").trim().toUpperCase());
  if (titles.includes("PRO+") || titles.includes("PROPLUS")) return "PROPLUS";
  if (titles.includes("PRO")) return "PRO";
  if (titles.includes("BASIC")) return "BASIC";
  return null;
}

function verifyShopifyHmac(rawBodyBuffer, hmacHeader, secret) {
  const digest = crypto
    .createHmac("sha256", secret)
    .update(rawBodyBuffer)
    .digest("base64");

  const a = Buffer.from(digest, "utf8");
  const b = Buffer.from(String(hmacHeader || ""), "utf8");
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

async function keygenCreateLicense({ accountId, token, policyId, email, tier, orderId }) {
  const url = `https://api.keygen.sh/v1/accounts/${accountId}/licenses`;

  const body = {
    data: {
      type: "licenses",
      attributes: {
        metadata: {
          tier,
          customer_email: email || "",
          shopify_order_id: String(orderId || ""),
          source: "shopify",
        },
      },
      relationships: {
        policy: {
          data: { type: "policies", id: policyId },
        },
      },
    },
  };

  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`, // MUST be token VALUE like prod-...v3
      "Content-Type": "application/vnd.api+json",
      Accept: "application/vnd.api+json",
    },
    body: JSON.stringify(body),
  });

  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(`Keygen license create failed (${res.status})`);
    err.details = json;
    throw err;
  }

  return json?.data?.attributes?.key;
}

// ✅ Ping
router.get("/webhooks/shopify/ping", (req, res) => {
  res.json({ ok: true, route: "shopify webhook router alive" });
});

// ✅ Shopify orders/paid webhook
router.post(
  "/webhooks/shopify/order-paid",
  express.raw({ type: "application/json" }),
  async (req, res) => {
    try {
      console.log("✅ Webhook hit: POST /webhooks/shopify/order-paid");

      const secret = process.env.SHOPIFY_WEBHOOK_SECRET;
      if (!secret) throw new Error("Missing SHOPIFY_WEBHOOK_SECRET env var");

      const topic = req.headers["x-shopify-topic"];
      const shop = req.headers["x-shopify-shop-domain"];
      const hmac = req.headers["x-shopify-hmac-sha256"];

      console.log("Topic:", topic);
      console.log("Shop:", shop);

      const raw = req.body; // Buffer
      const ok = verifyShopifyHmac(raw, hmac, secret);
      if (!ok) throw new Error("Shopify HMAC verification failed");
      console.log("✅ Shopify HMAC OK");

      const payload = JSON.parse(raw.toString("utf8"));

      const orderId = payload?.id;
      const email = payload?.email;
      const lineItems = payload?.line_items || [];

      console.log("Order ID:", orderId);
      console.log("Email:", email);
      console.log(
        "Line items:",
        lineItems.map((li) => ({ title: li.title, price: li.price, quantity: li.quantity }))
      );

      const tier = pickTierFromLineItems(lineItems);
      if (!tier) {
        console.log("⚠️ No tier product found in line items, ignoring.");
        return res.status(200).json({ ok: true, ignored: true });
      }

      const accountId = process.env.KEYGEN_ACCOUNT_ID;
      const token = process.env.KEYGEN_TOKEN;
      if (!accountId) throw new Error("Missing KEYGEN_ACCOUNT_ID env var");
      if (!token) throw new Error("Missing KEYGEN_TOKEN env var");

      const policyId =
        tier === "BASIC"
          ? process.env.KEYGEN_POLICY_BASIC
          : tier === "PRO"
          ? process.env.KEYGEN_POLICY_PRO
          : process.env.KEYGEN_POLICY_PROPLUS;

      if (!policyId) throw new Error(`Missing policy env var for tier ${tier}`);

      const licenseKey = await keygenCreateLicense({
        accountId,
        token,
        policyId,
        email,
        tier,
        orderId,
      });

      console.log("🔑 Keygen license created:", licenseKey);
      console.log("✅ Tier:", tier);

      return res.status(200).json({ ok: true });
    } catch (err) {
      console.error("❌ Webhook error:", err?.message || err);
      if (err?.details) console.error("❌ Keygen error details:", err.details);
      return res.status(200).json({ ok: false });
    }
  }
);

module.exports = router;
