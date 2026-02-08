const fetch = (...args) =>
  import("node-fetch").then(({ default: fetch }) => fetch(...args));

const KEYGEN_BASE = "https://api.keygen.sh/v1";

function policyForTier(tier) {
  if (tier === "basic") return process.env.KEYGEN_POLICY_BASIC;
  if (tier === "pro") return process.env.KEYGEN_POLICY_PRO;
  if (tier === "pro_plus") return process.env.KEYGEN_POLICY_PROPLUS;
  throw new Error("Invalid tier");
}

async function issueLicenseKey({ email, tier, orderId }) {
  const res = await fetch(
    `${KEYGEN_BASE}/accounts/${process.env.KEYGEN_ACCOUNT_ID}/licenses`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.KEYGEN_TOKEN}`,
        "Content-Type": "application/vnd.api+json",
        Accept: "application/vnd.api+json",
      },
      body: JSON.stringify({
        data: {
          type: "licenses",
          attributes: {
            name: `${tier.toUpperCase()} – ${email}`,
            metadata: { email, tier, orderId },
          },
          relationships: {
            policy: {
              data: {
                type: "policies",
                id: policyForTier(tier),
              },
            },
          },
        },
      }),
    }
  );

  const json = await res.json();
  if (!res.ok) throw new Error(JSON.stringify(json));

  return { key: json.data.attributes.key };
}

module.exports = { issueLicenseKey };
