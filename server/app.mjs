import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import Fastify from "fastify";
import cors from "@fastify/cors";
import { ownersRoutes } from "./routes/owners.mjs";
import { agentsRoutes } from "./routes/agents.mjs";
import { verifyRoutes } from "./routes/verify.mjs";
import { adminRoutes } from "./routes/admin.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function buildApp(masterKey, adminKey, opts = {}) {
  const fastify = Fastify({
    logger: opts.logger ?? true,
  });

  fastify.register(cors, { origin: true });

  // Health check
  fastify.get("/health", async () => ({ status: "ok", service: "22blabs-ail-issuer" }));

  // Dashboard UI
  fastify.get("/dashboard", async (_request, reply) => {
    const html = await readFile(
      path.join(__dirname, "dashboard.html"),
      "utf8"
    );
    return reply.type("text/html").send(html);
  });

  fastify.register(ownersRoutes);
  fastify.register(agentsRoutes, { masterKey });
  fastify.register(verifyRoutes, { masterKey });
  fastify.register(adminRoutes, { adminKey });

  return fastify;
}
