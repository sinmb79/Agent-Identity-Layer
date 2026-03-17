import { getDb } from "../lib/db.mjs";
import { nextAilId } from "../lib/ail-id.mjs";
import {
  verifyOwnerSignature,
  computeBehaviorFingerprint,
  computeGlyphSeed,
  computeScopeHash,
  issueCredentialJWT,
} from "../lib/crypto.mjs";

export async function agentsRoutes(fastify, options) {
  const { masterKey } = options;

  /**
   * POST /agents/register
   *
   * Registers an agent and issues a signed v1 credential JWT.
   *
   * The owner must:
   *   1. Serialize `payload` to canonical JSON (sorted keys, recursively)
   *   2. Sign it with their EC P-256 private key (ECDSA/SHA-256)
   *   3. Encode the IEEE P1363 signature (64 bytes) as base64url
   *   4. Submit { owner_key_id, payload, owner_signature }
   */
  fastify.post(
    "/agents/register",
    {
      schema: {
        body: {
          type: "object",
          required: ["owner_key_id", "payload", "owner_signature"],
          properties: {
            owner_key_id: { type: "string" },
            owner_signature: { type: "string" },
            payload: {
              type: "object",
              required: ["display_name", "role", "scope"],
              properties: {
                display_name: { type: "string" },
                role: { type: "string" },
                provider: { type: "string" },
                model: { type: "string" },
                scope: {
                  type: "object",
                  required: ["network", "secrets", "write_access", "approval_policy"],
                  properties: {
                    workspace: { type: "array", items: { type: "string" } },
                    repos: { type: "array", items: { type: "string" } },
                    network: { type: "string", enum: ["none", "restricted", "allowed"] },
                    secrets: { type: "string", enum: ["none", "indirect", "direct"] },
                    write_access: { type: "boolean" },
                    approval_policy: { type: "object" },
                  },
                },
              },
            },
          },
        },
      },
    },
    async (request, reply) => {
      const { owner_key_id, payload, owner_signature } = request.body;
      const db = getDb();

      // 1. Verify owner exists and is email-verified
      const owner = db
        .prepare(
          "SELECT id, org, public_key_jwk, email_verified FROM owners WHERE id = ?"
        )
        .get(owner_key_id);

      if (!owner) {
        return reply.code(404).send({ error: "owner_not_found" });
      }

      if (!owner.email_verified) {
        return reply.code(403).send({
          error: "email_not_verified",
          message: "Complete email verification before registering agents.",
        });
      }

      // 2. Verify owner's signature over the registration payload
      const publicKeyJwk = JSON.parse(owner.public_key_jwk);
      const signatureValid = await verifyOwnerSignature(
        payload,
        owner_signature,
        publicKeyJwk
      );

      if (!signatureValid) {
        return reply.code(401).send({
          error: "invalid_signature",
          message: "Owner signature verification failed.",
        });
      }

      // 3. Compute derived fields
      const ail_id = nextAilId(db);
      const { display_name, role, provider = null, model = null, scope } = payload;
      const owner_org = owner.org ?? null;

      const behavior_fingerprint = computeBehaviorFingerprint({ role, provider, scope });
      const signal_glyph = computeGlyphSeed(ail_id, display_name, owner_key_id);
      const scope_hash = computeScopeHash(scope);

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

      const { token, issuedAt, expiresAt } = await issueCredentialJWT(
        jwtClaims,
        masterKey
      );

      const issuedAtStr = issuedAt.toISOString();
      const expiresAtStr = expiresAt.toISOString();

      // 5. Persist agent record
      db.prepare(
        `INSERT INTO agents
           (ail_id, display_name, role, provider, model,
            owner_key_id, owner_org, scope_json, scope_hash,
            signal_glyph_seed, behavior_fingerprint,
            credential_token, issued_at, expires_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
      ).run(
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
        expiresAtStr
      );

      fastify.log.info(`Registered agent ${ail_id} (${display_name}) for owner ${owner_key_id}`);

      return reply.code(201).send({
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
      });
    }
  );

  /**
   * DELETE /agents/:ail_id/revoke
   *
   * Revokes a credential. The owner must provide a signature over
   * the canonical JSON of { ail_id, action: "revoke" }.
   */
  fastify.delete(
    "/agents/:ail_id/revoke",
    {
      schema: {
        params: {
          type: "object",
          required: ["ail_id"],
          properties: { ail_id: { type: "string" } },
        },
        body: {
          type: "object",
          required: ["owner_key_id", "owner_signature"],
          properties: {
            owner_key_id: { type: "string" },
            owner_signature: { type: "string" },
          },
        },
      },
    },
    async (request, reply) => {
      const { ail_id } = request.params;
      const { owner_key_id, owner_signature } = request.body;
      const db = getDb();

      const agent = db
        .prepare("SELECT ail_id, owner_key_id, revoked FROM agents WHERE ail_id = ?")
        .get(ail_id);

      if (!agent) {
        return reply.code(404).send({ error: "agent_not_found" });
      }

      if (agent.owner_key_id !== owner_key_id) {
        return reply.code(403).send({ error: "not_agent_owner" });
      }

      if (agent.revoked) {
        return reply.send({ revoked: true, ail_id, message: "Already revoked." });
      }

      const owner = db
        .prepare("SELECT public_key_jwk FROM owners WHERE id = ?")
        .get(owner_key_id);

      if (!owner) {
        return reply.code(404).send({ error: "owner_not_found" });
      }

      const revokePayload = { action: "revoke", ail_id };
      const publicKeyJwk = JSON.parse(owner.public_key_jwk);
      const signatureValid = await verifyOwnerSignature(
        revokePayload,
        owner_signature,
        publicKeyJwk
      );

      if (!signatureValid) {
        return reply.code(401).send({ error: "invalid_signature" });
      }

      db.prepare(
        "UPDATE agents SET revoked = 1, revoked_at = ? WHERE ail_id = ?"
      ).run(new Date().toISOString(), ail_id);

      fastify.log.info(`Revoked agent ${ail_id}`);

      return reply.send({ revoked: true, ail_id });
    }
  );
}
