/**
 * email.mjs — Transactional email via SMTP (nodemailer)
 *
 * Required env vars (all optional — falls back to console log if absent):
 *   SMTP_HOST   — e.g. smtp.resend.com
 *   SMTP_PORT   — e.g. 465
 *   SMTP_USER   — SMTP username (Resend: "resend")
 *   SMTP_PASS   — SMTP password / API key (Resend: re_xxxx)
 *   EMAIL_FROM  — Sender address, e.g. noreply@agentidcard.org
 */

import nodemailer from "nodemailer";

let _transporter = null;
const FROM = process.env.EMAIL_FROM ?? "noreply@agentidcard.org";

function getTransporter() {
  if (_transporter) return _transporter;

  const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS } = process.env;
  if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS) return null;

  _transporter = nodemailer.createTransport({
    host: SMTP_HOST,
    port: Number(SMTP_PORT ?? 587),
    secure: Number(SMTP_PORT ?? 587) === 465,
    auth: { user: SMTP_USER, pass: SMTP_PASS },
  });

  return _transporter;
}

/**
 * Send an OTP verification email to a newly registered owner.
 * Falls back to console.log if SMTP is not configured.
 *
 * @param {string} email
 * @param {string} otp        — 6-digit code
 * @param {string} expiresAt  — ISO timestamp
 */
export async function sendOwnerOtp(email, otp, expiresAt) {
  const transport = getTransporter();

  if (!transport) {
    // Dev / off-email mode — just log it
    console.info(`[EMAIL] To: ${email}  OTP: ${otp}  Expires: ${expiresAt}`);
    return;
  }

  const expiry = new Date(expiresAt).toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    timeZoneName: "short",
  });

  await transport.sendMail({
    from: `"22B Labs AIL" <${FROM}>`,
    to: email,
    subject: `Your AIL verification code: ${otp}`,
    text: [
      "Welcome to 22B Labs Agent Identity Layer.",
      "",
      `Your verification code is: ${otp}`,
      `Valid until: ${expiry}`,
      "",
      "Submit it via:",
      "  POST /owners/verify-email",
      `  { "owner_key_id": "...", "otp": "${otp}" }`,
      "",
      "If you did not request this, ignore this email.",
    ].join("\n"),
    html: `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family:system-ui,sans-serif;background:#0a0a0a;color:#e5e5e5;padding:40px 20px">
  <div style="max-width:480px;margin:0 auto;background:#111;border:1px solid #333;border-radius:12px;padding:32px">
    <h1 style="font-size:18px;color:#fff;margin:0 0 8px">22B Labs<br><span style="color:#7c3aed">Agent Identity Layer</span></h1>
    <p style="color:#999;margin:0 0 32px;font-size:14px">Email Verification</p>

    <p style="margin:0 0 16px;font-size:14px;color:#ccc">Your verification code:</p>
    <div style="background:#1e1e2e;border:1px solid #7c3aed;border-radius:8px;padding:20px;text-align:center;letter-spacing:12px;font-size:32px;font-weight:700;font-family:monospace;color:#fff">
      ${otp}
    </div>

    <p style="margin:24px 0 0;font-size:12px;color:#666">Valid until ${expiry}. Do not share this code.</p>
  </div>
</body>
</html>`,
  });
}
