const express = require("express");
const crypto = require("crypto");

const router = express.Router();

// Raw body parsing for HMAC verification
router.use(
  "/webhooks/shopify",
  express.raw({ type: "application/json", limit: "10mb" }),
  (req, res, next) => {
    console.log("🔵 RAW BODY MIDDLEWARE HIT");
    req.rawBody = req.body;
    next();
  }
);

// Shopify webhook verification
function verifyShopifyWebhook(req, res, next) {
  console.log("🔵 VERIFY MIDDLEWARE HIT");
  
  const hmacHeader = req.get("X-Shopify-Hmac-Sha256");
  const topic = req.get("X-Shopify-Topic");
  const shop = req.get("X-Shopify-Shop-Domain");
  
  console.log("📩 Headers:", { topic, shop, hmac: hmacHeader ? "present" : "missing" });
  
  if (!hmacHeader) {
    console.error("❌ Missing HMAC header");
    return res.status(401).json({ error: "Missing HMAC header" });
  }

  if (!req.rawBody) {
    console.error("❌ Missing raw body");
    return res.status(400).json({ error: "Missing body" });
  }

  const secret = process.env.SHOPIFY_WEBHOOK_SECRET;
  if (!secret) {
    console.error("❌ Missing SHOPIFY_WEBHOOK_SECRET");
    return res.status(500).json({ error: "Missing secret" });
  }

  const hash = crypto
    .createHmac("sha256", secret)
    .update(req.rawBody)
    .digest("base64");

  if (hash !== hmacHeader) {
    console.error("❌ HMAC verification failed");
    return res.status(401).json({ error: "HMAC verification failed" });
  }

  console.log("✅ HMAC verified");
  
  // Parse body
  try {
    req.body = JSON.parse(req.rawBody.toString("utf8"));
  } catch (e) {
    console.error("❌ Failed to parse JSON:", e);
    return res.status(400).json({ error: "Invalid JSON" });
  }
  
  next();
}

// Detect tier
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
  
  console.warn("⚠️ No tier detected, defaulting to basic");
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

  console.log("🔑 Creating Keygen license for tier:", tier);

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
    console.error("❌ Keygen API error:", response.status, errorText);
    throw new Error(`Keygen API error: ${response.status}`);
  }

  const data = await response.json();
  const licenseKey = data.data?.attributes?.key;

  if (!licenseKey) {
    console.error("❌ No license key in response:", JSON.stringify(data));
    throw new Error("No license key in Keygen response");
  }

  console.log("✅ License created:", licenseKey);
  return licenseKey;
}

// Main webhook endpoint
router.post("/webhooks/shopify/order-paid", verifyShopifyWebhook, async (req, res) => {
  console.log("🎯 WEBHOOK HANDLER RUNNING");
  
  try {
    const order = req.body;
    
    console.log("📦 Order received:", {
      id: order.id,
      name: order.name,
      email: order.email,
      items: order.line_items?.length || 0,
    });

    const lineItems = order.line_items || [];
    if (lineItems.length === 0) {
      console.warn("⚠️ No line items in order");
      return res.status(200).json({ message: "No items to process" });
    }

    const tier = detectTier(lineItems);
    const email = order.email || order.customer?.email || "noemail@unknown.com";
    const orderName = order.name || `#${order.id}`;

    console.log(`🎫 Tier: ${tier} | Email: ${email}`);

    const licenseKey = await createKeygenLicense(tier, email, orderName);

    console.log(`🎉 SUCCESS! Order ${orderName} → License: ${licenseKey}`);

    return res.status(200).json({
      success: true,
      licenseKey,
      tier,
      order: orderName,
    });

  } catch (error) {
    console.error("❌ ERROR:", error.message);
    console.error(error.stack);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// Test endpoint (remove after debugging)
router.get("/webhooks/shopify/test", (req, res) => {
  console.log("🧪 Test endpoint hit");
  res.json({ message: "Shopify route is loaded", timestamp: new Date().toISOString() });
});

console.log("✅ Shopify routes loaded");

module.exports = router;
```

## 3. Test it:

After deploying, try:
```
https://moon-signal-backend.onrender.com/webhooks/shopify/test
