/**
 * AIL Issuance Server — Cloudflare Workers entry point
 *
 * Uses Hono framework with D1 SQLite database.
 */

import { Hono } from "hono";
import { cors } from "hono/cors";
import { initSchema } from "./lib/db.mjs";
import { ownersRoutes } from "./routes/owners.mjs";
import { agentsRoutes } from "./routes/agents.mjs";
import { verifyRoutes } from "./routes/verify.mjs";
import { adminRoutes } from "./routes/admin.mjs";
import dashboardHtml from "../server/dashboard.html";
import registerHtml from "../server/register.html";

const app = new Hono();

// CORS
app.use("*", cors());

// Inject env bindings into context
app.use("*", async (c, next) => {
  // Parse master key once per request
  if (!c.get("masterKey") && c.env.MASTER_KEY_JSON) {
    try {
      c.set("masterKey", JSON.parse(c.env.MASTER_KEY_JSON));
    } catch {
      return c.json({ error: "invalid_master_key" }, 500);
    }
  }
  // Ensure D1 schema is initialized
  await initSchema(c.env.DB);
  await next();
});

// Health check
app.get("/health", (c) => c.json({ status: "ok", service: "22blabs-ail-issuer" }));

// Dashboard UI (admin)
app.get("/dashboard", (c) => c.html(dashboardHtml));

// Public registration UI
app.get("/register", (c) => c.html(registerHtml));

// Routes
app.route("/", ownersRoutes);
app.route("/", agentsRoutes);
app.route("/", verifyRoutes);
app.route("/", adminRoutes);

export default app;
