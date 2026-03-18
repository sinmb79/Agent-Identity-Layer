import { Hono } from "hono";
import { verifyCredentialJWT } from "../lib/crypto.mjs";

export const verifyRoutes = new Hono();

/**
 * POST /verify
 */
verifyRoutes.post("/verify", async (c) => {
  const { token } = await c.req.json();
  if (!token) return c.json({ error: "token_required" }, 400);

  const masterKey = c.get("masterKey");
  if (!masterKey) return c.json({ error: "master_key_not_configured" }, 500);

  let payload;
  try {
    const result = await verifyCredentialJWT(token, masterKey);
    payload = result.payload;
  } catch (err) {
    return c.json({
      valid: false,
      reason: "jwt_verification_failed",
      detail: err.message,
    });
  }

  const db = c.env.DB;
  const agent = await db.prepare(
    "SELECT ail_id, revoked, revoked_at FROM agents WHERE ail_id = ?"
  ).bind(payload.ail_id).first();

  if (!agent) {
    return c.json({ valid: false, reason: "agent_not_found", ail_id: payload.ail_id });
  }

  if (agent.revoked) {
    return c.json({
      valid: false,
      reason: "credential_revoked",
      ail_id: agent.ail_id,
      revoked_at: agent.revoked_at,
    });
  }

  return c.json({
    valid: true,
    ail_id: payload.ail_id,
    display_name: payload.display_name,
    role: payload.role,
    owner_org: payload.owner_org,
    issued: new Date(payload.iat * 1000).toISOString(),
    expires: new Date(payload.exp * 1000).toISOString(),
    revoked: false,
  });
});

/**
 * GET /keys/:kid
 */
verifyRoutes.get("/keys/:kid", (c) => {
  const kid = c.req.param("kid");
  const masterKey = c.get("masterKey");
  if (!masterKey) return c.json({ error: "master_key_not_configured" }, 500);

  if (kid !== masterKey.kid) return c.json({ error: "key_not_found" }, 404);

  return c.json({
    kid: masterKey.kid,
    alg: "ES256",
    use: "sig",
    ...masterKey.public_key_jwk,
  });
});

/**
 * GET /keys
 */
verifyRoutes.get("/keys", (c) => {
  const masterKey = c.get("masterKey");
  if (!masterKey) return c.json({ error: "master_key_not_configured" }, 500);

  return c.json({
    keys: [{
      kid: masterKey.kid,
      alg: "ES256",
      use: "sig",
      ...masterKey.public_key_jwk,
    }],
  });
});
