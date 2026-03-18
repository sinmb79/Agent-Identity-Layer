import { Hono } from "hono";

export const adminRoutes = new Hono();

function checkAuth(c) {
  const adminKey = c.env.ADMIN_API_KEY;
  if (!adminKey) return false;

  const provided =
    c.req.header("x-admin-key") ??
    c.req.header("authorization")?.replace(/^Bearer\s+/i, "");
  return provided === adminKey;
}

/**
 * GET /admin/agents
 */
adminRoutes.get("/admin/agents", async (c) => {
  if (!checkAuth(c)) return c.json({ error: "unauthorized" }, 401);
  const db = c.env.DB;
  const { results } = await db.prepare(
    `SELECT ail_id, display_name, role, provider, model,
            owner_key_id, owner_org, scope_hash,
            signal_glyph_seed, behavior_fingerprint,
            issued_at, expires_at, revoked, revoked_at
     FROM agents ORDER BY issued_at DESC`
  ).all();
  return c.json({ agents: results, total: results.length });
});

/**
 * GET /admin/agents/:ail_id
 */
adminRoutes.get("/admin/agents/:ail_id", async (c) => {
  if (!checkAuth(c)) return c.json({ error: "unauthorized" }, 401);
  const db = c.env.DB;
  const agent = await db.prepare("SELECT * FROM agents WHERE ail_id = ?")
    .bind(c.req.param("ail_id")).first();
  if (!agent) return c.json({ error: "agent_not_found" }, 404);
  return c.json(agent);
});

/**
 * GET /admin/owners
 */
adminRoutes.get("/admin/owners", async (c) => {
  if (!checkAuth(c)) return c.json({ error: "unauthorized" }, 401);
  const db = c.env.DB;
  const { results } = await db.prepare(
    "SELECT id, email, email_verified, org, created_at FROM owners ORDER BY created_at DESC"
  ).all();
  return c.json({ owners: results, total: results.length });
});

/**
 * GET /admin/stats
 */
adminRoutes.get("/admin/stats", async (c) => {
  if (!checkAuth(c)) return c.json({ error: "unauthorized" }, 401);
  const db = c.env.DB;

  const [total, active, revoked, owners] = await db.batch([
    db.prepare("SELECT COUNT(*) AS n FROM agents"),
    db.prepare("SELECT COUNT(*) AS n FROM agents WHERE revoked = 0"),
    db.prepare("SELECT COUNT(*) AS n FROM agents WHERE revoked = 1"),
    db.prepare("SELECT COUNT(*) AS n FROM owners WHERE email_verified = 1"),
  ]);

  return c.json({
    total_agents: total.results[0].n,
    active_agents: active.results[0].n,
    revoked_agents: revoked.results[0].n,
    verified_owners: owners.results[0].n,
  });
});

/**
 * DELETE /admin/agents/:ail_id/revoke
 */
adminRoutes.delete("/admin/agents/:ail_id/revoke", async (c) => {
  if (!checkAuth(c)) return c.json({ error: "unauthorized" }, 401);
  const ail_id = c.req.param("ail_id");
  const db = c.env.DB;

  const agent = await db.prepare("SELECT ail_id, revoked FROM agents WHERE ail_id = ?")
    .bind(ail_id).first();
  if (!agent) return c.json({ error: "agent_not_found" }, 404);
  if (agent.revoked) return c.json({ revoked: true, ail_id, message: "Already revoked." });

  await db.prepare(
    "UPDATE agents SET revoked = 1, revoked_at = ? WHERE ail_id = ?"
  ).bind(new Date().toISOString(), ail_id).run();

  console.log(`[ADMIN] Revoked agent ${ail_id}`);
  return c.json({ revoked: true, ail_id });
});
