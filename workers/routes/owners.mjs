import { Hono } from "hono";
import { generateOwnerKeypair, generateOtp, randomHex } from "../lib/crypto.mjs";
import { sendOwnerOtp } from "../lib/email.mjs";

export const ownersRoutes = new Hono();

/**
 * POST /owners/register
 */
ownersRoutes.post("/owners/register", async (c) => {
  const { email, org = null } = await c.req.json();
  if (!email) return c.json({ error: "email_required" }, 400);

  const db = c.env.DB;

  const existing = await db.prepare("SELECT id FROM owners WHERE email = ?").bind(email).first();
  if (existing) {
    return c.json({
      error: "email_already_registered",
      message: "An owner with this email already exists.",
    }, 409);
  }

  const { owner_key_id, public_key_jwk, private_key_jwk } = await generateOwnerKeypair();
  const now = new Date().toISOString();

  await db.prepare(
    "INSERT INTO owners (id, email, org, public_key_jwk, created_at) VALUES (?, ?, ?, ?, ?)"
  ).bind(owner_key_id, email, org, JSON.stringify(public_key_jwk), now).run();

  const otp = generateOtp();
  const otpId = randomHex(8);
  const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();

  await db.prepare(
    "INSERT INTO owner_otps (id, owner_id, otp, expires_at) VALUES (?, ?, ?, ?)"
  ).bind(otpId, owner_key_id, otp, expiresAt).run();

  await sendOwnerOtp(c.env, email, otp, expiresAt);

  return c.json({
    owner_key_id,
    public_key_jwk,
    private_key_jwk,
    message:
      "Keypair issued. Verify your email with POST /owners/verify-email. " +
      "Store your private key securely — it will not be shown again.",
    _dev_otp: otp,
  }, 201);
});

/**
 * POST /owners/verify-email
 */
ownersRoutes.post("/owners/verify-email", async (c) => {
  const { owner_key_id, otp } = await c.req.json();
  if (!owner_key_id || !otp) return c.json({ error: "missing_fields" }, 400);

  const db = c.env.DB;

  const owner = await db.prepare("SELECT id, email_verified FROM owners WHERE id = ?")
    .bind(owner_key_id).first();

  if (!owner) return c.json({ error: "owner_not_found" }, 404);

  if (owner.email_verified) {
    return c.json({ verified: true, owner_key_id, message: "Already verified." });
  }

  const record = await db.prepare(
    "SELECT id FROM owner_otps WHERE owner_id = ? AND otp = ? AND used = 0 AND expires_at > ?"
  ).bind(owner_key_id, otp, new Date().toISOString()).first();

  if (!record) {
    return c.json({
      error: "invalid_otp",
      message: "OTP is incorrect, expired, or already used.",
    }, 400);
  }

  await db.batch([
    db.prepare("UPDATE owners SET email_verified = 1 WHERE id = ?").bind(owner_key_id),
    db.prepare("UPDATE owner_otps SET used = 1 WHERE id = ?").bind(record.id),
  ]);

  return c.json({ verified: true, owner_key_id });
});
