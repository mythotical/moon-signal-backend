
import { Router } from "express";
import crypto from "crypto";
import { issueLicenseKey } from "../services/keygen.js";
import { sendLicenseEmail } from "../services/email.js"; // optional

const router = Router();

router.post("/order-paid", async (req, res) => {
  try {
    // 1) Verify webhook HMAC
    const hmacHeader = req.get("X-Shopify-Hmac-Sha256") || "";
    const digest = crypto
      .createHmac("sha256", process.env.SHOPIFY_WEBHOOK_SECRET)
      .update(req.body) // raw Buffer
      .digest("base64");

    const valid =
      hmacHeader.length === digest.length &&
      crypto.timingSafeEqual(Buffer.from(digest), Buffer.from(hmacHeader));

    if (!valid) return res.status(401).send("Invalid HMAC");

    // 2) Parse order
    const order = JSON.parse(req.body.toString("utf8"));

    // Only proceed if paid
    if (order.financial_status !== "paid") return res.status(200).send("Not paid");

    const email = order.email || order.customer?.email;
    if (!email) return res.status(200).send("No email");

    // 3) Determine tier from line items (YOU MUST SET THIS UP)
    // Best method: set SKU on each product in Shopify:
    // BASIC: OBS-BASIC, PRO: OBS-PRO, PRO+: OBS-PROPLUS
    const items = order.line_items || [];
    const skus = items.map(i => (i.sku || "").toUpperCase());

    let tier = null;
    if (skus.includes("OBS-BASIC")) tier = "basic";
    else if (skus.includes("OBS-PRO")) tier = "pro";
    else if (skus.includes("OBS-PROPLUS")) tier = "pro_plus";

    if (!tier) {
      // fallback: try product title contains words
      const titles = items.map(i => (i.title || "").toLowerCase());
      if (titles.some(t => t.includes("pro+"))) tier = "pro_plus";
      else if (titles.some(t => t.includes("pro"))) tier = "pro";
      else if (titles.some(t => t.includes("basic"))) tier = "basic";
    }

    if (!tier) return res.status(200).send("Tier not found");

    // 4) Create 1-time key in Keygen
    const orderId = String(order.id);
    const { key } = await issueLicenseKey({ email, tier, orderId });

    // 5) Email it
    // optional: if you don’t have email ready, comment this out and just log the key
    await sendLicenseEmail({ email, tier, key, orderId });

    return res.status(200).send("OK");
  } catch (err) {
    console.error("Shopify webhook error:", err);
    return res.status(500).send("Webhook error");
  }
});

export default router;
