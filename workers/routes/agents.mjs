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
import { mintAgent, revokeAgent, isChainEnabled } from "../lib/chain.mjs";

export const agentsRoutes = new Hono();

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

  // 1. Verify owner exists and is email-verified
  const owner = await db.prepare(
    "SELECT id, org, public_key_jwk, email_verified FROM owners WHERE id = ?"
  ).bind(owner_key_id).first();

  if (!owner) return c.json({ error: "owner_not_found" }, 404);

  if (!owner.email_verified) {
    return c.json({
      error: "email_not_verified",
      message: "Complete email verification before registering agents.",
    }, 403);
  }

  // 2. Verify owner's signature
  const publicKeyJwk = JSON.parse(owner.public_key_jwk);
  const signatureValid = await verifyOwnerSignature(payload, owner_signature, publicKeyJwk);

  if (!signatureValid) {
    return c.json({ error: "invalid_signature", message: "Owner signature verification failed." }, 401);
  }

  // 3. Compute derived fields
  const ail_id = await nextAilId(db);
  const { display_name, role, provider = null, model = null, scope } = payload;
  const owner_org = owner.org ?? null;

  const behavior_fingerprint = await computeBehaviorFingerprint({ role, provider, scope });
  const signal_glyph = computeGlyphSeed(ail_id, display_name, owner_key_id);
  const scope_hash = await computeScopeHash(scope);

  // 4. Issue signed JWT
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

  const { token, issuedAt, expiresAt } = await issueCredentialJWT(jwtClaims, masterKey);
  const issuedAtStr = issuedAt.toISOString();
  const expiresAtStr = expiresAt.toISOString();

  // 5. Generate NFT ID card SVG
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

  // 6. Persist agent record
  await db.prepare(
    `INSERT INTO agents
       (ail_id, display_name, role, provider, model,
        owner_key_id, owner_org, scope_json, scope_hash,
        signal_glyph_seed, behavior_fingerprint,
        credential_token, issued_at, expires_at, nft_image_svg)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
  ).bind(
    ail_id, display_name, role, provider, model,
    owner_key_id, owner_org, JSON.stringify(scope), scope_hash,
    signal_glyph.seed, behavior_fingerprint.hash,
    token, issuedAtStr, expiresAtStr, nft_image_svg
  ).run();

  console.log(`Registered agent ${ail_id} (${display_name}) for owner ${owner_key_id}`);

  // 7. Mint NFT on-chain (non-blocking)
  let nft = { token_id: null, tx_hash: null };
  if (isChainEnabled(c.env)) {
    const baseUrl = c.env.AIL_BASE_URL ?? "";
    const metadataUri = `${baseUrl}/agents/${ail_id}/metadata`;
    const chainResult = await mintAgent(c.env, ail_id, null, metadataUri);
    if (chainResult) {
      nft = { token_id: chainResult.tokenId, tx_hash: chainResult.txHash };
      await db.prepare(
        "UPDATE agents SET nft_token_id = ?, nft_tx_hash = ? WHERE ail_id = ?"
      ).bind(chainResult.tokenId, chainResult.txHash, ail_id).run();
    }
  }

  return c.json({
    ail_id,
    credential: {
      type: "AIL.SignedCredential.v1",
      issuer: "22blabs.ai",
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
  }, 201);
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

  // Burn NFT on-chain
  if (isChainEnabled(c.env)) {
    const row = await db.prepare("SELECT nft_token_id FROM agents WHERE ail_id = ?")
      .bind(ail_id).first();
    if (row?.nft_token_id) {
      await revokeAgent(c.env, row.nft_token_id);
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
    // Cache it
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
