import { Hono } from "hono";

export const sourcesRoutes = new Hono();

const SOURCE_NAME_PATTERN = /^[a-z0-9_]+$/;
const ETH_ADDRESS_PATTERN = /^0x[a-fA-F0-9]{40}$/;

function checkAdminAuth(c) {
  const adminKey = c.env.ADMIN_API_KEY;
  if (!adminKey) return false;

  const provided =
    c.req.header("x-admin-key") ??
    c.req.header("authorization")?.replace(/^Bearer\s+/i, "");

  return provided === adminKey;
}

function isValidEthAddress(value) {
  return typeof value === "string" && ETH_ADDRESS_PATTERN.test(value);
}

async function isValidPublicKeyJwk(publicKeyJwk) {
  if (!publicKeyJwk || typeof publicKeyJwk !== "object" || Array.isArray(publicKeyJwk)) {
    return false;
  }

  try {
    await crypto.subtle.importKey(
      "jwk",
      publicKeyJwk,
      { name: "ECDSA", namedCurve: "P-256" },
      false,
      ["verify"]
    );
    return true;
  } catch {
    return false;
  }
}

/**
 * POST /sources/register
 */
sourcesRoutes.post("/sources/register", async (c) => {
  const body = await c.req.json();
  const {
    name,
    contract_address = null,
    chain_id = null,
    admin_wallet,
    verification_method = "signature",
    public_key_jwk,
  } = body;

  if (!name || !admin_wallet || !public_key_jwk) {
    return c.json({ error: "missing_fields" }, 400);
  }

  if (!SOURCE_NAME_PATTERN.test(name)) {
    return c.json({
      error: "invalid_source_name",
      message: "name must be lowercase alphanumeric with underscores only.",
    }, 400);
  }

  if (!["signature", "merkle_proof"].includes(verification_method)) {
    return c.json({ error: "invalid_verification_method" }, 400);
  }

  if (!isValidEthAddress(admin_wallet)) {
    return c.json({ error: "invalid_admin_wallet" }, 400);
  }

  if (contract_address && !isValidEthAddress(contract_address)) {
    return c.json({ error: "invalid_contract_address" }, 400);
  }

  if (!(await isValidPublicKeyJwk(public_key_jwk))) {
    return c.json({ error: "invalid_public_key_jwk" }, 400);
  }

  const db = c.env.DB;
  const existing = await db.prepare(
    "SELECT id FROM registered_sources WHERE name = ?"
  ).bind(name).first();

  if (existing) {
    return c.json({ error: "source_name_taken", message: "Source name already registered." }, 409);
  }

  const sourceId = crypto.randomUUID();
  const registeredAt = new Date().toISOString();

  await db.prepare(`
    INSERT INTO registered_sources (
      id, name, contract_address, chain_id, admin_wallet,
      verification_method, public_key_jwk, status, registered_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?)
  `).bind(
    sourceId,
    name,
    contract_address,
    chain_id,
    admin_wallet.toLowerCase(),
    verification_method,
    JSON.stringify(public_key_jwk),
    registeredAt
  ).run();

  return c.json({
    source_id: sourceId,
    name,
    status: "pending",
    message: "Source registered. Awaiting admin approval.",
  }, 201);
});

/**
 * GET /sources
 */
sourcesRoutes.get("/sources", async (c) => {
  const db = c.env.DB;
  const { results } = await db.prepare(`
    SELECT id, name, status, verification_method, registered_at
    FROM registered_sources
    WHERE status = 'approved'
    ORDER BY registered_at ASC
  `).all();

  return c.json({ sources: results || [] });
});

/**
 * POST /sources/:id/approve
 */
sourcesRoutes.post("/sources/:id/approve", async (c) => {
  if (!checkAdminAuth(c)) {
    return c.json({ error: "unauthorized" }, 401);
  }

  const sourceId = c.req.param("id");
  const db = c.env.DB;
  const source = await db.prepare(
    "SELECT id, status FROM registered_sources WHERE id = ?"
  ).bind(sourceId).first();

  if (!source) {
    return c.json({ error: "source_not_found" }, 404);
  }

  const approvedAt = new Date().toISOString();
  await db.prepare(`
    UPDATE registered_sources
    SET status = 'approved', approved_at = COALESCE(approved_at, ?)
    WHERE id = ?
  `).bind(approvedAt, sourceId).run();

  return c.json({
    source_id: sourceId,
    status: "approved",
    message: "Source approved and can now submit reputation data.",
  });
});
