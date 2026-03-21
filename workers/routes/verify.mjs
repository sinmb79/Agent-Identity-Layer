import { Hono } from "hono";
import { buildVerificationResult } from "../lib/verification.mjs";

export const verifyRoutes = new Hono();

/**
 * POST /verify
 */
verifyRoutes.post("/verify", async (c) => {
  const { token } = await c.req.json();
  if (!token) return c.json({ error: "token_required" }, 400);

  const masterKey = c.get("masterKey");
  if (!masterKey) return c.json({ error: "master_key_not_configured" }, 500);
  return c.json(await buildVerificationResult({
    db: c.env.DB,
    masterKey,
    token,
  }));
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
