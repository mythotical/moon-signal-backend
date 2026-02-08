export async function sendLicenseEmail({ email, tier, key, orderId }) {
  console.log("SEND KEY EMAIL:", { email, tier, key, orderId });
  // Later: SendGrid/Mailgun
  return true;
}

