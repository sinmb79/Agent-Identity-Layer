import { Hono } from "hono";
import { nextAilId } from "../lib/ail-id.mjs";
import {
  verifyOwnerSignature,
  computeBehaviorFingerprint,
  computeGlyphSeed,
  computeScopeHash,
  issueCredentialJWT,
} from "../lib/crypto.mjs";
import { generateIdCardSvg, generateNftMetadata } from "../lib/image-generator.mjs";
import { mintAgent, revokeAgent as revokeOnChain, isChainEnabled } from "../lib/chain.mjs";

export const agentsRoutes = new Hono();

const BULK_MIN_AGENTS = 2;
const BULK_MAX_AGENTS = 20;
const STANDARD_PRICE_USDC = 2;
const BULK_TWENTY_TOTAL_USDC = 30;
const USDC_DECIMALS = 6;
const ERC20_TRANSFER_SELECTOR = "0xa9059cbb";
const DEFAULT_PAYMENT_RECEIVER = "0x4eead61df800fcfa7a9f698f811a855389f74b6c";
const SUPPORTED_USDC_ADDRESSES = new Set([
  "0x036cbd53842c5426634e7929541ec2318f3dcf7e",
  "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
]);

class HttpError extends Error {
  constructor(status, error, message) {
    super(message ?? error);
    this.status = status;
    this.error = error;
    this.message = message ?? error;
  }
}

function normalizeAddress(value) {
  return typeof value === "string" ? value.toLowerCase() : null;
}

function getPaymentReceiver(env) {
  return normalizeAddress(env.PAYMENT_RECEIVER) ?? normalizeAddress(env.NFT_CONTRACT_ADDRESS) ?? DEFAULT_PAYMENT_RECEIVER;
}

function getBulkTotalUsd(count) {
  return count === BULK_MAX_AGENTS ? BULK_TWENTY_TOTAL_USDC : count * STANDARD_PRICE_USDC;
}

function getBulkTotalMinorUnits(count) {
  return BigInt(getBulkTotalUsd(count)) * BigInt(10 ** USDC_DECIMALS);
}

function formatUsd(amount) {
  return Number(amount).toFixed(2);
}

function buildCredentialResponse({ ail_id, masterKey, issuedAtStr, expiresAtStr, token, signal_glyph, behavior_fingerprint, nft, issuer }) {
  return {
    ail_id,
    credential: {
      type: "AIL.SignedCredential.v1",
      issuer,
      issuer_key_id: masterKey.kid,
      issued_at: issuedAtStr,
      expires_at: expiresAtStr,
      token,
    },
    signal_glyph,
    behavior_fingerprint,
    nft_image_url: `/agents/${ail_id}/image`,
    nft_metadata_url: `/agents/${ail_id}/metadata`,
    ...(nft.token_id && { nft: { token_id: nft.token_id, tx_hash: nft.tx_hash } }),
  };
}

async function callRpc(env, method, params) {
  if (!env.CHAIN_RPC_URL) {
    throw new HttpError(503, "payment_validation_unavailable", "CHAIN_RPC_URL is required for bulk payment validation.");
  }

  const response = await fetch(env.CHAIN_RPC_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: crypto.randomUUID(),
      method,
      params,
    }),
  });

  if (!response.ok) {
    throw new HttpError(502, "payment_rpc_error", "Unable to reach the chain RPC endpoint.");
  }

  const payload = await response.json();
  if (payload.error) {
    throw new HttpError(502, "payment_rpc_error", payload.error.message ?? "RPC request failed.");
  }

  return payload.result;
}

async function validateBulkPayment(env, txHash, count) {
  const transaction = await callRpc(env, "eth_getTransactionByHash", [txHash]);
  if (!transaction) {
    throw new HttpError(400, "payment_not_found", "Payment transaction was not found.");
  }

  const receipt = await callRpc(env, "eth_getTransactionReceipt", [txHash]);
  if (!receipt || receipt.status !== "0x1") {
    throw new HttpError(400, "payment_not_confirmed", "Payment transaction is not confirmed.");
  }

  const tokenAddress = normalizeAddress(transaction.to);
  if (!tokenAddress || !SUPPORTED_USDC_ADDRESSES.has(tokenAddress)) {
    throw new HttpError(400, "invalid_payment_token", "Payment must be sent with supported USDC.");
  }

  const input = (transaction.input ?? transaction.data ?? "").toLowerCase();
  if (!input.startsWith(ERC20_TRANSFER_SELECTOR) || input.length < 138) {
    throw new HttpError(400, "invalid_payment_data", "Payment transaction is not a valid ERC-20 transfer.");
  }

  const recipientSlot = input.slice(10, 74);
  const amountSlot = input.slice(74, 138);
  const recipient = `0x${recipientSlot.slice(24)}`;
  const amount = BigInt(`0x${amountSlot}`);
  const expectedRecipient = getPaymentReceiver(env);
  const expectedAmount = getBulkTotalMinorUnits(count);

  if (normalizeAddress(recipient) !== expectedRecipient) {
    throw new HttpError(400, "invalid_payment_receiver", "Payment was sent to the wrong receiver.");
  }

  if (amount !== expectedAmount) {
    throw new HttpError(
      400,
      "invalid_payment_amount",
      `Expected ${formatUsd(getBulkTotalUsd(count))} USDC for ${count} agents.`
    );
  }
}

async function getVerifiedOwner(db, owner_key_id, { includePublicKey = false } = {}) {
  const columns = includePublicKey
    ? "id, org, email_verified, public_key_jwk"
    : "id, org, email_verified";

  const owner = await db.prepare(`SELECT ${columns} FROM owners WHERE id = ?`)
    .bind(owner_key_id)
    .first();

  if (!owner) {
    throw new HttpError(404, "owner_not_found");
  }

  if (!owner.email_verified) {
    throw new HttpError(
      403,
      "email_not_verified",
      "Complete email verification before registering agents."
    );
  }

  return owner;
}

async function requireSessionOwner(db, sessionToken) {
  const session = await db.prepare(
    "SELECT owner_id, expires_at FROM owner_sessions WHERE token = ?"
  ).bind(sessionToken).first();

  if (!session) {
    throw new HttpError(401, "invalid_session", "Session not found or expired.");
  }

  if (new Date(session.expires_at) < new Date()) {
    throw new HttpError(401, "session_expired", "Session expired. Please login again.");
  }

  return session.owner_id;
}

async function createAgentRegistration({
  db,
  env,
  masterKey,
  owner_key_id,
  owner_org,
  payload,
  issuer,
  requireMint = false,
}) {
  const ail_id = await nextAilId(db);
  const { display_name, role, provider = null, model = null, scope, wallet_address = null } = payload;

  const behavior_fingerprint = await computeBehaviorFingerprint({ role, provider, scope });
  const signal_glyph = computeGlyphSeed(ail_id, display_name, owner_key_id);
  const scope_hash = await computeScopeHash(scope);

  const jwtClaims = {
    ail_id,
    display_name,
    role,
    owner_key_id,
    owner_org,
    scope_hash,
    signal_glyph_seed: signal_glyph.seed,
    behavior_fingerprint: behavior_fingerprint.hash,
  };

  const { token, issuedAt, expiresAt } = await issueCredentialJWT(jwtClaims, masterKey, issuer);
  const issuedAtStr = issuedAt.toISOString();
  const expiresAtStr = expiresAt.toISOString();

  const agentDataForImage = {
    ail_id,
    agent: { display_name, role, provider, model, owner: { org: owner_org } },
    scope,
    delegation: null,
    verification: { signed: true, strength: "cryptographically_signed" },
    credential: { issued_at: issuedAtStr },
    owner: { org: owner_org },
  };
  const nft_image_svg = generateIdCardSvg(agentDataForImage);

  await db.prepare(
    `INSERT INTO agents
       (ail_id, display_name, role, provider, model,
        owner_key_id, owner_org, scope_json, scope_hash,
        signal_glyph_seed, behavior_fingerprint,
        credential_token, issued_at, expires_at, nft_image_svg)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
  ).bind(
    ail_id,
    display_name,
    role,
    provider,
    model,
    owner_key_id,
    owner_org,
    JSON.stringify(scope),
    scope_hash,
    signal_glyph.seed,
    behavior_fingerprint.hash,
    token,
    issuedAtStr,
    expiresAtStr,
    nft_image_svg
  ).run();

  let nft = { token_id: null, tx_hash: null };
  if (isChainEnabled(env)) {
    const baseUrl = env.AIL_BASE_URL ?? "";
    const metadataUri = `${baseUrl}/agents/${ail_id}/metadata`;
    const chainResult = await mintAgent(env, ail_id, wallet_address, metadataUri);

    if (!chainResult && requireMint) {
      throw new HttpError(502, "nft_mint_failed", `Failed to mint NFT for ${ail_id}.`);
    }

    if (chainResult) {
      nft = { token_id: chainResult.tokenId, tx_hash: chainResult.txHash };
      await db.prepare(
        "UPDATE agents SET nft_token_id = ?, nft_tx_hash = ? WHERE ail_id = ?"
      ).bind(chainResult.tokenId, chainResult.txHash, ail_id).run();
    }
  }

  return {
    ail_id,
    display_name,
    credential_token: token,
    nft_token_id: nft.token_id,
    response: buildCredentialResponse({
      ail_id,
      masterKey,
      issuedAtStr,
      expiresAtStr,
      token,
      signal_glyph,
      behavior_fingerprint,
      nft,
      issuer,
    }),
  };
}

async function rollbackBulkRegistrations(db, env, createdAgents) {
  for (const agent of [...createdAgents].reverse()) {
    try {
      if (agent.nft_token_id) {
        await revokeOnChain(env, agent.nft_token_id);
      }
    } catch (err) {
      console.error(`[bulk] failed to revoke NFT for ${agent.ail_id}:`, err.message);
    }

    try {
      await db.prepare("DELETE FROM agents WHERE ail_id = ?").bind(agent.ail_id).run();
    } catch (err) {
      console.error(`[bulk] failed to delete ${agent.ail_id}:`, err.message);
    }
  }
}

/**
 * POST /agents/register
 */
agentsRoutes.post("/agents/register", async (c) => {
  const body = await c.req.json();
  const { owner_key_id, payload, owner_signature } = body;

  if (!owner_key_id || !payload || !owner_signature) {
    return c.json({ error: "missing_fields" }, 400);
  }

  const db = c.env.DB;
  const masterKey = c.get("masterKey");
  if (!masterKey) return c.json({ error: "master_key_not_configured" }, 500);

  try {
    const owner = await getVerifiedOwner(db, owner_key_id, { includePublicKey: true });
    const publicKeyJwk = JSON.parse(owner.public_key_jwk);
    const signatureValid = await verifyOwnerSignature(payload, owner_signature, publicKeyJwk);

    if (!signatureValid) {
      return c.json({
        error: "invalid_signature",
        message: "Owner signature verification failed.",
      }, 401);
    }

    const agent = await createAgentRegistration({
      db,
      env: c.env,
      masterKey,
      owner_key_id,
      owner_org: owner.org ?? null,
      payload,
      issuer: "agentidcard.org",
    });

    console.log(`Registered agent ${agent.ail_id} (${payload.display_name}) for owner ${owner_key_id}`);
    return c.json(agent.response, 201);
  } catch (err) {
    if (err instanceof HttpError) {
      return c.json({ error: err.error, message: err.message }, err.status);
    }
    console.error("[agents/register] unexpected error:", err);
    return c.json({ error: "registration_failed", message: "Failed to register agent." }, 500);
  }
});

/**
 * POST /agents/register-session
 *
 * Register an agent using a session token (from OTP login).
 * No owner_signature required - session proves ownership.
 */
agentsRoutes.post("/agents/register-session", async (c) => {
  const body = await c.req.json();
  const { session_token, payload } = body;

  if (!session_token || !payload) {
    return c.json({ error: "missing_fields", message: "session_token and payload required." }, 400);
  }

  const db = c.env.DB;
  const masterKey = c.get("masterKey");
  if (!masterKey) return c.json({ error: "master_key_not_configured" }, 500);

  try {
    const owner_key_id = await requireSessionOwner(db, session_token);
    const owner = await getVerifiedOwner(db, owner_key_id);

    const agent = await createAgentRegistration({
      db,
      env: c.env,
      masterKey,
      owner_key_id,
      owner_org: owner.org ?? null,
      payload,
      issuer: "agentidcard.org",
    });

    console.log(`Registered agent ${agent.ail_id} (${payload.display_name}) for owner ${owner_key_id} via session`);
    return c.json(agent.response, 201);
  } catch (err) {
    if (err instanceof HttpError) {
      return c.json({ error: err.error, message: err.message }, err.status);
    }
    console.error("[agents/register-session] unexpected error:", err);
    return c.json({ error: "registration_failed", message: "Failed to register agent." }, 500);
  }
});

/**
 * POST /agents/register-bulk
 */
agentsRoutes.post("/agents/register-bulk", async (c) => {
  const body = await c.req.json();
  const { session_token, agents, tx_hash } = body;

  if (!session_token || !Array.isArray(agents) || !tx_hash) {
    return c.json({
      error: "missing_fields",
      message: "session_token, agents, and tx_hash are required.",
    }, 400);
  }

  if (agents.length < BULK_MIN_AGENTS || agents.length > BULK_MAX_AGENTS) {
    return c.json({
      error: "invalid_agent_count",
      message: `Bulk registration supports ${BULK_MIN_AGENTS}-${BULK_MAX_AGENTS} agents per request.`,
    }, 400);
  }

  const db = c.env.DB;
  const masterKey = c.get("masterKey");
  if (!masterKey) return c.json({ error: "master_key_not_configured" }, 500);

  try {
    const owner_key_id = await requireSessionOwner(db, session_token);
    const owner = await getVerifiedOwner(db, owner_key_id);

    await validateBulkPayment(c.env, tx_hash, agents.length);

    const createdAgents = [];
    try {
      for (const payload of agents) {
        const created = await createAgentRegistration({
          db,
          env: c.env,
          masterKey,
          owner_key_id,
          owner_org: owner.org ?? null,
          payload,
          issuer: "agentidcard.org",
          requireMint: isChainEnabled(c.env),
        });
        createdAgents.push(created);
      }
    } catch (err) {
      await rollbackBulkRegistrations(db, c.env, createdAgents);
      throw err;
    }

    return c.json({
      agents: createdAgents.map((agent) => ({
        ail_id: agent.ail_id,
        display_name: agent.display_name,
        credential_token: agent.credential_token,
        nft_image_url: `/agents/${agent.ail_id}/image`,
        nft_token_id: agent.nft_token_id,
      })),
      total_paid: formatUsd(getBulkTotalUsd(createdAgents.length)),
      count: createdAgents.length,
    }, 201);
  } catch (err) {
    if (err instanceof HttpError) {
      return c.json({ error: err.error, message: err.message }, err.status);
    }
    console.error("[agents/register-bulk] unexpected error:", err);
    return c.json({ error: "bulk_registration_failed", message: "Failed to register agents in bulk." }, 500);
  }
});

/**
 * DELETE /agents/:ail_id/revoke
 */
agentsRoutes.delete("/agents/:ail_id/revoke", async (c) => {
  const ail_id = c.req.param("ail_id");
  const { owner_key_id, owner_signature } = await c.req.json();
  const db = c.env.DB;

  const agent = await db.prepare(
    "SELECT ail_id, owner_key_id, revoked FROM agents WHERE ail_id = ?"
  ).bind(ail_id).first();

  if (!agent) return c.json({ error: "agent_not_found" }, 404);
  if (agent.owner_key_id !== owner_key_id) return c.json({ error: "not_agent_owner" }, 403);
  if (agent.revoked) return c.json({ revoked: true, ail_id, message: "Already revoked." });

  const owner = await db.prepare("SELECT public_key_jwk FROM owners WHERE id = ?")
    .bind(owner_key_id).first();
  if (!owner) return c.json({ error: "owner_not_found" }, 404);

  const revokePayload = { action: "revoke", ail_id };
  const publicKeyJwk = JSON.parse(owner.public_key_jwk);
  const signatureValid = await verifyOwnerSignature(revokePayload, owner_signature, publicKeyJwk);

  if (!signatureValid) return c.json({ error: "invalid_signature" }, 401);

  await db.prepare(
    "UPDATE agents SET revoked = 1, revoked_at = ? WHERE ail_id = ?"
  ).bind(new Date().toISOString(), ail_id).run();

  if (isChainEnabled(c.env)) {
    const row = await db.prepare("SELECT nft_token_id FROM agents WHERE ail_id = ?")
      .bind(ail_id).first();
    if (row?.nft_token_id) {
      await revokeOnChain(c.env, row.nft_token_id);
    }
  }

  return c.json({ revoked: true, ail_id });
});

/**
 * GET /agents/:ail_id/image
 */
agentsRoutes.get("/agents/:ail_id/image", async (c) => {
  const ail_id = c.req.param("ail_id");
  const db = c.env.DB;

  const agent = await db.prepare(
    `SELECT ail_id, display_name, role, provider, model,
            owner_org, scope_json, issued_at, nft_image_svg
     FROM agents WHERE ail_id = ?`
  ).bind(ail_id).first();

  if (!agent) return c.json({ error: "agent_not_found" }, 404);

  let svg = agent.nft_image_svg;

  if (!svg) {
    const scope = JSON.parse(agent.scope_json);
    const agentDataForImage = {
      ail_id: agent.ail_id,
      agent: {
        display_name: agent.display_name,
        role: agent.role,
        provider: agent.provider,
        model: agent.model,
        owner: { org: agent.owner_org },
      },
      scope,
      delegation: null,
      verification: { signed: true, strength: "cryptographically_signed" },
      credential: { issued_at: agent.issued_at },
      owner: { org: agent.owner_org },
    };
    svg = generateIdCardSvg(agentDataForImage);
    await db.prepare("UPDATE agents SET nft_image_svg = ? WHERE ail_id = ?")
      .bind(svg, ail_id).run();
  }

  return new Response(svg, {
    headers: {
      "Content-Type": "image/svg+xml",
      "Cache-Control": "public, max-age=31536000, immutable",
    },
  });
});

/**
 * GET /agents/:ail_id/metadata
 */
agentsRoutes.get("/agents/:ail_id/metadata", async (c) => {
  const ail_id = c.req.param("ail_id");
  const db = c.env.DB;

  const agent = await db.prepare(
    `SELECT ail_id, display_name, role, provider, model,
            owner_org, scope_json, issued_at, nft_image_svg
     FROM agents WHERE ail_id = ?`
  ).bind(ail_id).first();

  if (!agent) return c.json({ error: "agent_not_found" }, 404);

  const scope = JSON.parse(agent.scope_json);
  const agentDataForImage = {
    ail_id: agent.ail_id,
    agent: {
      display_name: agent.display_name,
      role: agent.role,
      provider: agent.provider,
      model: agent.model,
      owner: { org: agent.owner_org },
    },
    scope,
    delegation: null,
    verification: { signed: true, strength: "cryptographically_signed" },
    credential: { issued_at: agent.issued_at },
    owner: { org: agent.owner_org },
  };

  if (agent.nft_image_svg) {
    agentDataForImage._cached_svg = agent.nft_image_svg;
  }

  const metadata = generateNftMetadata(agentDataForImage);

  return c.json(metadata, 200, {
    "Cache-Control": "public, max-age=31536000, immutable",
  });
});
