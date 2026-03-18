/**
 * email.mjs — Transactional email via Resend HTTP API
 *
 * No SMTP, no nodemailer — just fetch().
 *
 * Required env vars (optional — falls back to console log if absent):
 *   RESEND_API_KEY — Resend API key (re_xxxx)
 *   EMAIL_FROM     — Sender address (default: noreply@agentidcard.org)
 */

const RESEND_URL = "https://api.resend.com/emails";

/**
 * Send an OTP verification email to a newly registered owner.
 */
export async function sendOwnerOtp(env, email, otp, expiresAt) {
  const apiKey = env.RESEND_API_KEY;
  const from = env.EMAIL_FROM ?? "noreply@agentidcard.org";

  if (!apiKey) {
    console.log(`[EMAIL] To: ${email}  OTP: ${otp}  Expires: ${expiresAt}`);
    return;
  }

  const expiry = new Date(expiresAt).toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    timeZoneName: "short",
  });

  await fetch(RESEND_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: `Agent ID Card <${from}>`,
      to: [email],
      subject: `Your Agent ID Card verification code: ${otp}`,
      html: `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family:system-ui,sans-serif;background:#0a0a0a;color:#e5e5e5;padding:40px 20px">
  <div style="max-width:480px;margin:0 auto;background:#111;border:1px solid #333;border-radius:12px;padding:32px">
    <h1 style="font-size:18px;color:#fff;margin:0 0 8px">Agent ID <span style="color:#4f8ef7">Card</span></h1>
    <p style="color:#999;margin:0 0 32px;font-size:14px">Email Verification</p>
    <p style="margin:0 0 16px;font-size:14px;color:#ccc">Your verification code:</p>
    <div style="background:#1e1e2e;border:1px solid #7c3aed;border-radius:8px;padding:20px;text-align:center;letter-spacing:12px;font-size:32px;font-weight:700;font-family:monospace;color:#fff">
      ${otp}
    </div>
    <p style="margin:24px 0 0;font-size:12px;color:#666">Valid until ${expiry}. Do not share this code.</p>
  </div>
</body>
</html>`,
    }),
  });
}
