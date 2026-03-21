import { Hono } from "hono";
import authVerifyHtml from "../../server/auth-verify.html";
import { buildVerificationResult, filterVerificationResult } from "../lib/verification.mjs";

export const authRoutes = new Hono();
const VALID_SCOPES = new Set(["identity", "identity+reputation", "full"]);

function checkAdminAuth(c) {
  const adminKey = c.env.ADMIN_API_KEY;
  if (!adminKey) return false;

  const provided =
    c.req.header("x-admin-key") ??
    c.req.header("authorization")?.replace(/^Bearer\s+/i, "");

  return provided === adminKey;
}

function isValidUrl(value) {
  if (typeof value !== "string" || value.length === 0) return false;

  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol);
  } catch {
    return false;
  }
}

function sanitizeStringArray(input) {
  if (!Array.isArray(input) || input.length === 0) return null;

  const values = [...new Set(
    input
      .filter((value) => typeof value === "string")
      .map((value) => value.trim())
      .filter(Boolean)
  )];

  return values.length > 0 ? values : null;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function parseJson(text, fallback) {
  try {
    return JSON.parse(text);
  } catch {
    return fallback;
  }
}

async function getClientById(db, clientId) {
  const row = await db.prepare(`
    SELECT client_id, client_secret, name, allowed_origins, redirect_uris, created_at
    FROM registered_clients
    WHERE client_id = ?
  `).bind(clientId).first();

  if (!row) return null;

  return {
    ...row,
    allowed_origins: parseJson(row.allowed_origins, []),
    redirect_uris: parseJson(row.redirect_uris, []),
  };
}

function normalizeBearerToken(value) {
  return value?.replace(/^Bearer\s+/i, "") ?? "";
}

function originAllowed(client, origin) {
  return !origin || client.allowed_origins.includes(origin);
}

authRoutes.post("/auth/clients/register", async (c) => {
  if (!checkAdminAuth(c)) {
    return c.json({ error: "unauthorized" }, 401);
  }

  const body = await c.req.json();
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  const allowedOrigins = sanitizeStringArray(body?.allowed_origins);
  const redirectUris = sanitizeStringArray(body?.redirect_uris);

  if (!name || !allowedOrigins || !redirectUris) {
    return c.json({ error: "missing_fields" }, 400);
  }

  if (!allowedOrigins.every(isValidUrl)) {
    return c.json({ error: "invalid_allowed_origins" }, 400);
  }

  if (!redirectUris.every(isValidUrl)) {
    return c.json({ error: "invalid_redirect_uris" }, 400);
  }

  const clientId = `ail_client_${crypto.randomUUID().replace(/-/g, "")}`;
  const clientSecret = `ail_secret_${crypto.randomUUID().replace(/-/g, "")}`;
  const createdAt = new Date().toISOString();

  await c.env.DB.prepare(`
    INSERT INTO registered_clients (
      client_id, client_secret, name, allowed_origins, redirect_uris, created_at
    ) VALUES (?, ?, ?, ?, ?, ?)
  `).bind(
    clientId,
    clientSecret,
    name,
    JSON.stringify(allowedOrigins),
    JSON.stringify(redirectUris),
    createdAt
  ).run();

  return c.json({
    client_id: clientId,
    client_secret: clientSecret,
    name,
    allowed_origins: allowedOrigins,
    redirect_uris: redirectUris,
  }, 201);
});

authRoutes.get("/auth/verify", async (c) => {
  const clientId = c.req.query("client_id");
  const redirectUri = c.req.query("redirect_uri");
  const scope = c.req.query("scope") || "identity";
  const state = c.req.query("state") || "";

  if (!clientId || !redirectUri) {
    return c.html("<h1>Missing client configuration</h1>", 400);
  }

  const client = await getClientById(c.env.DB, clientId);
  if (!client) {
    return c.html("<h1>Unknown application</h1>", 404);
  }

  if (!client.redirect_uris.includes(redirectUri)) {
    return c.html("<h1>Invalid redirect URI</h1>", 400);
  }

  const redirectOrigin = new URL(redirectUri).origin;
  const bootstrap = JSON.stringify({
    client_id: client.client_id,
    client_name: client.name,
    redirect_uri: redirectUri,
    redirect_origin: redirectOrigin,
    scope,
    state,
  }).replace(/</g, "\\u003c");

  const html = authVerifyHtml
    .replace(/__CLIENT_NAME__/g, escapeHtml(client.name))
    .replace("__AUTH_BOOTSTRAP__", bootstrap);

  return c.html(html);
});

authRoutes.post("/auth/authorize", async (c) => {
  const body = await c.req.json();
  const token = typeof body?.token === "string" ? body.token.trim() : "";
  const clientId = typeof body?.client_id === "string" ? body.client_id.trim() : "";
  const redirectUri = typeof body?.redirect_uri === "string" ? body.redirect_uri.trim() : "";
  const scope = typeof body?.scope === "string" && body.scope ? body.scope : "identity";
  const state = typeof body?.state === "string" ? body.state : "";

  if (!token || !clientId || !redirectUri) {
    return c.json({ error: "missing_fields" }, 400);
  }

  if (!VALID_SCOPES.has(scope)) {
    return c.json({ error: "invalid_scope" }, 400);
  }

  const client = await getClientById(c.env.DB, clientId);
  if (!client) {
    return c.json({ error: "invalid_client" }, 404);
  }

  if (!client.redirect_uris.includes(redirectUri)) {
    return c.json({ error: "invalid_redirect_uri" }, 400);
  }

  const masterKey = c.get("masterKey");
  if (!masterKey) {
    return c.json({ error: "master_key_not_configured" }, 500);
  }

  const verification = await buildVerificationResult({
    db: c.env.DB,
    masterKey,
    token,
  });

  if (!verification.valid) {
    return c.json({
      error: verification.reason ?? "invalid_credential",
      valid: false,
      ...(verification.ail_id && { ail_id: verification.ail_id }),
    }, 401);
  }

  const code = `auth_code_${crypto.randomUUID().replace(/-/g, "")}`;
  const createdAt = new Date();
  const expiresAt = new Date(createdAt.getTime() + (5 * 60 * 1000));
  const scopedResult = filterVerificationResult(verification, scope);

  await c.env.DB.prepare(`
    INSERT INTO auth_codes (
      code, ail_id, client_id, redirect_uri, scope,
      result_json, created_at, used, expires_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?)
  `).bind(
    code,
    verification.ail_id,
    client.client_id,
    redirectUri,
    scope,
    JSON.stringify(scopedResult),
    createdAt.toISOString(),
    expiresAt.toISOString()
  ).run();

  const redirectUrl = new URL(redirectUri);
  redirectUrl.searchParams.set("code", code);
  if (state) {
    redirectUrl.searchParams.set("state", state);
  }

  return c.json({
    code,
    scope,
    expires_at: expiresAt.toISOString(),
    redirect_url: redirectUrl.toString(),
    post_message_origin: redirectUrl.origin,
  }, 201);
});

authRoutes.post("/auth/exchange", async (c) => {
  const body = await c.req.json();
  const code = typeof body?.code === "string" ? body.code.trim() : "";
  const clientId = typeof body?.client_id === "string" ? body.client_id.trim() : "";
  const clientSecret = typeof body?.client_secret === "string" ? body.client_secret.trim() : "";

  if (!code || !clientId || !clientSecret) {
    return c.json({ error: "missing_fields" }, 400);
  }

  const client = await getClientById(c.env.DB, clientId);
  if (!client || client.client_secret !== clientSecret) {
    return c.json({ error: "invalid_client_credentials" }, 401);
  }

  const origin = c.req.header("origin");
  if (!originAllowed(client, origin)) {
    return c.json({ error: "origin_not_allowed" }, 403);
  }
  if (origin) {
    c.header("Access-Control-Allow-Origin", origin);
    c.header("Vary", "Origin");
  }

  const authCode = await c.env.DB.prepare(`
    SELECT code, client_id, redirect_uri, result_json, used, expires_at
    FROM auth_codes
    WHERE code = ?
  `).bind(code).first();

  if (!authCode) {
    return c.json({ error: "auth_code_not_found" }, 404);
  }

  if (authCode.client_id !== client.client_id) {
    return c.json({ error: "auth_code_client_mismatch" }, 403);
  }

  if (Number(authCode.used) === 1) {
    return c.json({ error: "auth_code_used" }, 409);
  }

  if (Date.parse(authCode.expires_at) <= Date.now()) {
    return c.json({ error: "auth_code_expired" }, 410);
  }

  if (!client.redirect_uris.includes(authCode.redirect_uri)) {
    return c.json({ error: "invalid_redirect_uri" }, 403);
  }

  await c.env.DB.prepare(`
    UPDATE auth_codes
    SET used = 1
    WHERE code = ?
  `).bind(code).run();

  return c.json(parseJson(authCode.result_json, {}));
});

authRoutes.get("/auth/verify-quick", async (c) => {
  const token = c.req.query("token")?.trim() ?? "";
  const clientId = c.req.query("client_id")?.trim() ?? "";
  const clientSecret = normalizeBearerToken(c.req.header("authorization"));

  if (!token || !clientId) {
    return c.json({ error: "missing_fields" }, 400);
  }

  const client = await getClientById(c.env.DB, clientId);
  if (!client || client.client_secret !== clientSecret) {
    return c.json({ error: "invalid_client_credentials" }, 401);
  }

  const origin = c.req.header("origin");
  if (!originAllowed(client, origin)) {
    return c.json({ error: "origin_not_allowed" }, 403);
  }
  if (origin) {
    c.header("Access-Control-Allow-Origin", origin);
    c.header("Vary", "Origin");
  }

  const masterKey = c.get("masterKey");
  if (!masterKey) {
    return c.json({ error: "master_key_not_configured" }, 500);
  }

  const verification = await buildVerificationResult({
    db: c.env.DB,
    masterKey,
    token,
  });

  if (!verification.valid) {
    return c.json(verification, 401);
  }

  return c.json(verification);
});
