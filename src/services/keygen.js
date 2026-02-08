const KEYGEN_BASE = "https://api.keygen.sh/v1";

function getPolicyIdForTier(tier) {
  // PUT YOUR REAL POLICY IDS HERE from Keygen dashboard
  // example: return process.env.KEYGEN_POLICY_BASIC_ID, etc
  if (tier === "basic") return process.env.KEYGEN_POLICY_BASIC_ID;
  if (tier === "pro") return process.env.KEYGEN_POLICY_PRO_ID;
  if (tier === "pro_plus") return process.env.KEYGEN_POLICY_PROPLUS_ID;
  throw new Error("Unknown tier: " + tier);
}

export async function issueLicenseKey({ email, tier, orderId }) {
  const policyId = getPolicyIdForTier(tier);

  // Create license (Keygen will generate the key unless you override)
  const resp = await fetch(`${KEYGEN_BASE}/accounts/${process.env.KEYGEN_ACCOUNT_ID}/licenses`, {
    method: "POST",
    headers: {
      "Content-Type": "application/vnd.api+json",
      "Accept": "application/vnd.api+json",
      "Authorization": `Bearer ${process.env.KEYGEN_TOKEN}`,
    },
    body: JSON.stringify({
      data: {
        type: "licenses",
        attributes: {
          name: `${tier.toUpperCase()} - ${email}`,
          metadata: {
            email,
            tier,
            order_id: orderId,
          },
        },
        relationships: {
          policy: {
            data: { type: "policies", id: policyId },
          },
        },
      },
    }),
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Keygen create license failed: ${resp.status} ${text}`);
  }

  const json = await resp.json();

  // Keygen returns the license key in attributes.key (usually)
  const key = json?.data?.attributes?.key;
  if (!key) throw new Error("Keygen did not return a key");

  return { key, licenseId: json.data.id };
}

