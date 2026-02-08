const express = require("express");
const crypto = require("crypto");

const router = express.Router();

// Shopify webhook verification middleware
function verifyShopifyWebhook(req, res, next) {
  const hmacHeader = req.get("X-Shopify-Hmac-Sha256");
  
  if (!hmacHeader) {
    console.error("[Shopify] Missing HMAC header");
    return res.status(401).json({ error: "Missing HMAC header" });
  }

  const rawBody = req.rawBody;
  if (!rawBody) {
    console.error("[Shopify] Missing raw body");
    return res.status(400).json({ error: "Missing body" });
  }

  const hash = crypto
    .createHmac("sha256", process.env.SHOPIFY_WEBHOOK_SECRET)
    .update(rawBody, "utf8")
    .digest("base64");

  if (hash !== hmacHeader) {
    console.error("[Shopify] HMAC verification failed");
    return res.status(401).json({ error: "HMAC verification failed" });
  }

  console.log("[Shopify] HMAC verified successfully");
  next();
}

// Raw body capture middleware
router.use(
  "/webhooks/shopify",
  express.raw({ type: "application/json", limit: "10mb" }),
  (req, res, next) => {
    req.rawBody = req.body.toString("utf8");
    try {
      req.body = JSON.parse(req.rawBody);
    } catch (e) {
      console.error("[Shopify] Failed to parse JSON:", e);
      return res.status(400).json({ error: "Invalid JSON" });
    }
    next();
  }
);

// Detect tier from line items
function detectTier(lineItems) {
  for (const item of lineItems) {
    const title = (item.title || "").toLowerCase();
    const sku = (item.sku || "").toLowerCase();
    const combined = `${title} ${sku}`;

    if (combined.includes("pro+") || combined.includes("proplus") || combined.includes("pro plus")) {
      return "proplus";
    }
    if (combined.includes("pro") && !combined.includes("pro+")) {
      return "pro";
    }
    if (combined.includes("basic")) {
      return "basic";
    }
  }
  
  // Default to basic if no match
  console.warn("[Shopify] No tier detected, defaulting to basic");
  return "basic";
}

// Create Keygen license
async function createKeygenLicense(tier, email, orderName) {
  const policyMap = {
    basic: process.env.KEYGEN_POLICY_BASIC,
    pro: process.env.KEYGEN_POLICY_PRO,
    proplus: process.env.KEYGEN_POLICY_PROPLUS,
  };

  const policyId = policyMap[tier];
  if (!policyId) {
    throw new Error(`No policy found for tier: ${tier}`);
  }

  const url = `https://api.keygen.sh/v1/accounts/${process.env.KEYGEN_ACCOUNT_ID}/licenses`;
  
  const payload = {
    data: {
      type: "licenses",
      attributes: {
        maxActivations: 1,
        metadata: {
          tier,
          email,
          shopifyOrder: orderName,
        },
      },
      relationships: {
        policy: {
          data: { type: "policies", id: policyId },
        },
      },
    },
  };

  console.log("[Keygen] Creating license for tier:", tier);

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/vnd.api+json",
      "Accept": "application/vnd.api+json",
      "Authorization": `Bearer ${process.env.KEYGEN_TOKEN}`,
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error("[Keygen] API error:", response.status, errorText);
    throw new Error(`Keygen API error: ${response.status}`);
  }

  const data = await response.json();
  const licenseKey = data.data?.attributes?.key;

  if (!licenseKey) {
    console.error("[Keygen] No license key in response:", JSON.stringify(data));
    throw new Error("No license key in Keygen response");
  }

  console.log("[Keygen] License created:", licenseKey);
  return licenseKey;
}

// Webhook endpoint
router.post("/webhooks/shopify/order-paid", verifyShopifyWebhook, async (req, res) => {
  try {
    const order = req.body;
    
    console.log("[Shopify] Order received:", {
      id: order.id,
      name: order.name,
      email: order.email,
      itemCount: order.line_items?.length || 0,
    });

    const lineItems = order.line_items || [];
    if (lineItems.length === 0) {
      console.warn("[Shopify] No line items in order");
      return res.status(200).json({ message: "No items to process" });
    }

    const tier = detectTier(lineItems);
    const email = order.email || order.customer?.email || "noemail@unknown.com";
    const orderName = order.name || `#${order.id}`;

    console.log("[Shopify] Detected tier:", tier, "for email:", email);

    const licenseKey = await createKeygenLicense(tier, email, orderName);

    console.log("[SUCCESS] License created for order", orderName, "- Key:", licenseKey);

    return res.status(200).json({
      success: true,
      licenseKey,
      tier,
      order: orderName,
    });

  } catch (error) {
    console.error("[ERROR] Webhook processing failed:", error.message);
    console.error(error.stack);
    return res.status(500).json({ error: "Internal server error" });
  }
});

module.exports = router;
