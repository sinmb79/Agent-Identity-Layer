import { getDb } from "../lib/db.mjs";
import { verifyCredentialJWT } from "../lib/crypto.mjs";

export async function verifyRoutes(fastify, options) {
  const { masterKey } = options;

  /**
   * POST /verify
   *
   * Third-party credential verification endpoint.
   * Verifies the JWT signature and checks revocation status.
   */
  fastify.post(
    "/verify",
    {
      schema: {
        body: {
          type: "object",
          required: ["token"],
          properties: {
            token: { type: "string" },
          },
        },
      },
    },
    async (request, reply) => {
      const { token } = request.body;

      let payload;
      try {
        const result = await verifyCredentialJWT(token, masterKey);
        payload = result.payload;
      } catch (err) {
        return reply.code(200).send({
          valid: false,
          reason: "jwt_verification_failed",
          detail: err.message,
        });
      }

      const db = getDb();
      const agent = db
        .prepare(
          "SELECT ail_id, revoked, revoked_at FROM agents WHERE ail_id = ?"
        )
        .get(payload.ail_id);

      if (!agent) {
        return reply.code(200).send({
          valid: false,
          reason: "agent_not_found",
          ail_id: payload.ail_id,
        });
      }

      if (agent.revoked) {
        return reply.code(200).send({
          valid: false,
          reason: "credential_revoked",
          ail_id: agent.ail_id,
          revoked_at: agent.revoked_at,
        });
      }

      return reply.code(200).send({
        valid: true,
        ail_id: payload.ail_id,
        display_name: payload.display_name,
        role: payload.role,
        owner_org: payload.owner_org,
        issued: new Date(payload.iat * 1000).toISOString(),
        expires: new Date(payload.exp * 1000).toISOString(),
        revoked: false,
      });
    }
  );

  /**
   * GET /keys/:kid
   *
   * Returns the 22B Labs public key in JWK format for offline verification.
   */
  fastify.get(
    "/keys/:kid",
    {
      schema: {
        params: {
          type: "object",
          required: ["kid"],
          properties: { kid: { type: "string" } },
        },
      },
    },
    async (request, reply) => {
      const { kid } = request.params;

      if (kid !== masterKey.kid) {
        return reply.code(404).send({ error: "key_not_found" });
      }

      return reply.send({
        kid: masterKey.kid,
        alg: "ES256",
        use: "sig",
        ...masterKey.public_key_jwk,
      });
    }
  );

  /**
   * GET /keys
   *
   * Returns a JWKS (JSON Web Key Set) with the active public signing key.
   */
  fastify.get("/keys", async (_request, reply) => {
    return reply.send({
      keys: [
        {
          kid: masterKey.kid,
          alg: "ES256",
          use: "sig",
          ...masterKey.public_key_jwk,
        },
      ],
    });
  });
}
