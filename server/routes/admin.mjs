import { getDb } from "../lib/db.mjs";

/**
 * Admin routes — protected by X-Admin-Key header.
 *
 * Set ADMIN_API_KEY env var before starting the server.
 * If not set, a random key is generated and printed to the console at startup.
 */
export async function adminRoutes(fastify, options) {
  const { adminKey } = options;

  function checkAuth(request, reply) {
    const provided =
      request.headers["x-admin-key"] ??
      request.headers["authorization"]?.replace(/^Bearer\s+/i, "");
    if (provided !== adminKey) {
      reply.code(401).send({ error: "unauthorized" });
      return false;
    }
    return true;
  }

  /**
   * GET /admin/agents
   * List all registered agents with status.
   */
  fastify.get("/admin/agents", async (request, reply) => {
    if (!checkAuth(request, reply)) return;
    const db = getDb();
    const agents = db
      .prepare(
        `SELECT ail_id, display_name, role, provider, model,
                owner_key_id, owner_org, scope_hash,
                signal_glyph_seed, behavior_fingerprint,
                issued_at, expires_at, revoked, revoked_at
         FROM agents ORDER BY issued_at DESC`
      )
      .all();
    return reply.send({ agents, total: agents.length });
  });

  /**
   * GET /admin/agents/:ail_id
   * Get a single agent's full record.
   */
  fastify.get("/admin/agents/:ail_id", async (request, reply) => {
    if (!checkAuth(request, reply)) return;
    const db = getDb();
    const agent = db
      .prepare("SELECT * FROM agents WHERE ail_id = ?")
      .get(request.params.ail_id);
    if (!agent) return reply.code(404).send({ error: "agent_not_found" });
    return reply.send(agent);
  });

  /**
   * GET /admin/owners
   * List all registered owners.
   */
  fastify.get("/admin/owners", async (request, reply) => {
    if (!checkAuth(request, reply)) return;
    const db = getDb();
    const owners = db
      .prepare(
        `SELECT id, email, email_verified, org, created_at FROM owners ORDER BY created_at DESC`
      )
      .all();
    return reply.send({ owners, total: owners.length });
  });

  /**
   * GET /admin/stats
   * Summary statistics.
   */
  fastify.get("/admin/stats", async (request, reply) => {
    if (!checkAuth(request, reply)) return;
    const db = getDb();
    const total = db.prepare("SELECT COUNT(*) AS n FROM agents").get().n;
    const active = db.prepare("SELECT COUNT(*) AS n FROM agents WHERE revoked = 0").get().n;
    const revoked = db.prepare("SELECT COUNT(*) AS n FROM agents WHERE revoked = 1").get().n;
    const owners = db.prepare("SELECT COUNT(*) AS n FROM owners WHERE email_verified = 1").get().n;
    return reply.send({ total_agents: total, active_agents: active, revoked_agents: revoked, verified_owners: owners });
  });

  /**
   * DELETE /admin/agents/:ail_id/revoke
   * Admin revoke — no owner signature required.
   */
  fastify.delete("/admin/agents/:ail_id/revoke", async (request, reply) => {
    if (!checkAuth(request, reply)) return;
    const { ail_id } = request.params;
    const db = getDb();
    const agent = db.prepare("SELECT ail_id, revoked FROM agents WHERE ail_id = ?").get(ail_id);
    if (!agent) return reply.code(404).send({ error: "agent_not_found" });
    if (agent.revoked) return reply.send({ revoked: true, ail_id, message: "Already revoked." });
    db.prepare("UPDATE agents SET revoked = 1, revoked_at = ? WHERE ail_id = ?").run(
      new Date().toISOString(),
      ail_id
    );
    fastify.log.info(`[ADMIN] Revoked agent ${ail_id}`);
    return reply.send({ revoked: true, ail_id });
  });
}
