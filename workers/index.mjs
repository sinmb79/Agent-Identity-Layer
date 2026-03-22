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
import { sourcesRoutes } from "./routes/sources.mjs";
import { reputationRoutes } from "./routes/reputation.mjs";
import { profileRoutes } from "./routes/profile.mjs";
import { authRoutes } from "./routes/auth.mjs";
import dashboardHtml from "../server/dashboard.html";
import registerHtml from "../server/register.html";
import developersHtml from "../server/developers.html";
import widgetJs from "../server/widget.js";
import badgeJs from "../server/badge.js";
import landingHtml from "../web-page/index.html";

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

// Landing page
app.get("/", (c) => c.html(landingHtml));

// Health check
app.get("/health", (c) => c.json({ status: "ok", service: "agent-id-card" }));

// Dashboard UI (admin)
app.get("/dashboard", (c) => c.html(dashboardHtml));

// Public registration UI
app.get("/register", (c) => c.html(registerHtml));

// Developer documentation
app.get("/developers", (c) => c.html(developersHtml));

// Public embeddable assets
app.get("/widget.js", (c) => {
  c.header("Content-Type", "application/javascript; charset=utf-8");
  c.header("Access-Control-Allow-Origin", "*");
  return c.body(widgetJs);
});

app.get("/badge.js", (c) => {
  c.header("Content-Type", "application/javascript; charset=utf-8");
  c.header("Access-Control-Allow-Origin", "*");
  return c.body(badgeJs);
});

// Routes
app.route("/", ownersRoutes);
app.route("/", agentsRoutes);
app.route("/", verifyRoutes);
app.route("/", adminRoutes);
app.route("/", sourcesRoutes);
app.route("/", reputationRoutes);
app.route("/", profileRoutes);
app.route("/", authRoutes);

export default app;
