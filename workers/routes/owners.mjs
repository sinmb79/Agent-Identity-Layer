import { Hono } from "hono";
import { generateOwnerKeypair, generateOtp, randomHex } from "../lib/crypto.mjs";
import { sendOwnerOtp } from "../lib/email.mjs";

export const ownersRoutes = new Hono();

async function loadOwnerAgents(db, owner_key_id) {
  const agents = await db.prepare(
    `SELECT ail_id, display_name, role, provider, model, issued_at, expires_at, revoked
     FROM agents WHERE owner_key_id = ? ORDER BY issued_at DESC`
  ).bind(owner_key_id).all();

  return agents.results || [];
}

async function buildSessionResponse(db, sessionToken, owner_key_id) {
  const owner = await db.prepare(
    "SELECT id, email, org, email_verified FROM owners WHERE id = ?"
  ).bind(owner_key_id).first();

  if (!owner) {
    return null;
  }

  return {
    authenticated: true,
    session_token: sessionToken,
    owner: {
      owner_key_id: owner.id,
      email: owner.email,
      org: owner.org,
    },
    agents: await loadOwnerAgents(db, owner_key_id),
  };
}

async function requireSessionState(db, sessionToken) {
  const session = await db.prepare(
    "SELECT owner_id, expires_at FROM owner_sessions WHERE token = ?"
  ).bind(sessionToken).first();

  if (!session) {
    return { error: "invalid_session", status: 401, message: "Session not found or expired." };
  }

  if (new Date(session.expires_at) < new Date()) {
    return { error: "session_expired", status: 401, message: "Session expired. Please login again." };
  }

  const snapshot = await buildSessionResponse(db, sessionToken, session.owner_id);
  if (!snapshot) {
    return { error: "owner_not_found", status: 404, message: "Owner not found." };
  }

  return snapshot;
}

/**
 * POST /owners/register
 *
 * If the email was previously registered but NOT verified,
 * delete the old record and allow re-registration.
 */
ownersRoutes.post("/owners/register", async (c) => {
  const { email, org = null } = await c.req.json();
  if (!email) return c.json({ error: "email_required" }, 400);

  const db = c.env.DB;

  const existing = await db.prepare(
    "SELECT id, email_verified FROM owners WHERE email = ?"
  ).bind(email).first();

  if (existing) {
    if (existing.email_verified) {
      // Already verified — tell user to login instead
      return c.json({
        error: "email_already_verified",
        message: "This email is already registered and verified. Please use Login instead.",
      }, 409);
    }
    // Not verified — delete old record and OTPs so user can re-register
    await db.batch([
      db.prepare("DELETE FROM owner_otps WHERE owner_id = ?").bind(existing.id),
      db.prepare("DELETE FROM agents WHERE owner_key_id = ?").bind(existing.id),
      db.prepare("DELETE FROM owners WHERE id = ?").bind(existing.id),
    ]);
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

/**
 * POST /owners/login
 *
 * Send a login OTP to an existing verified owner.
 * Returns owner_key_id (but NOT private key — user must have saved it).
 */
ownersRoutes.post("/owners/login", async (c) => {
  const { email } = await c.req.json();
  if (!email) return c.json({ error: "email_required" }, 400);

  const db = c.env.DB;

  const owner = await db.prepare(
    "SELECT id, email_verified, public_key_jwk FROM owners WHERE email = ?"
  ).bind(email).first();

  if (!owner) {
    return c.json({ error: "owner_not_found", message: "No account found with this email." }, 404);
  }

  if (!owner.email_verified) {
    return c.json({
      error: "email_not_verified",
      message: "Email not yet verified. Please register again.",
    }, 403);
  }

  const otp = generateOtp();
  const otpId = randomHex(8);
  const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();

  await db.prepare(
    "INSERT INTO owner_otps (id, owner_id, otp, expires_at) VALUES (?, ?, ?, ?)"
  ).bind(otpId, owner.id, otp, expiresAt).run();

  await sendOwnerOtp(c.env, email, otp, expiresAt);

  return c.json({
    owner_key_id: owner.id,
    message: "Login OTP sent to your email.",
  });
});

/**
 * POST /owners/verify-login
 *
 * Verify login OTP. Returns owner info + list of agents.
 */
ownersRoutes.post("/owners/verify-login", async (c) => {
  const { owner_key_id, otp } = await c.req.json();
  if (!owner_key_id || !otp) return c.json({ error: "missing_fields" }, 400);

  const db = c.env.DB;

  const owner = await db.prepare(
    "SELECT id, email, org, email_verified FROM owners WHERE id = ?"
  ).bind(owner_key_id).first();

  if (!owner) return c.json({ error: "owner_not_found" }, 404);

  const record = await db.prepare(
    "SELECT id FROM owner_otps WHERE owner_id = ? AND otp = ? AND used = 0 AND expires_at > ?"
  ).bind(owner_key_id, otp, new Date().toISOString()).first();

  if (!record) {
    return c.json({ error: "invalid_otp", message: "OTP is incorrect, expired, or already used." }, 400);
  }

  await db.prepare("UPDATE owner_otps SET used = 1 WHERE id = ?").bind(record.id).run();

  // Issue session token (valid 24 hours)
  const sessionToken = randomHex(32);
  const sessionExpires = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  await db.prepare(
    "INSERT INTO owner_sessions (token, owner_id, created_at, expires_at) VALUES (?, ?, ?, ?)"
  ).bind(sessionToken, owner_key_id, new Date().toISOString(), sessionExpires).run();

  return c.json(await buildSessionResponse(db, sessionToken, owner.id));
});

/**
 * POST /owners/session
 *
 * Restore an authenticated owner session from a stored session token.
 */
ownersRoutes.post("/owners/session", async (c) => {
  const { session_token } = await c.req.json();
  if (!session_token) return c.json({ error: "missing_fields" }, 400);

  const sessionState = await requireSessionState(c.env.DB, session_token);
  if (!sessionState.authenticated) {
    return c.json({ error: sessionState.error, message: sessionState.message }, sessionState.status);
  }

  return c.json(sessionState);
});
