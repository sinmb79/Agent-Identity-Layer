import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { randomBytes } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildApp } from "./app.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Production: load master key from MASTER_KEY_JSON env var
// Development: load from data/master-key.json file
let masterKey;
if (process.env.MASTER_KEY_JSON) {
  try {
    masterKey = JSON.parse(process.env.MASTER_KEY_JSON);
  } catch {
    console.error("MASTER_KEY_JSON is set but contains invalid JSON.");
    process.exit(1);
  }
} else {
  const masterKeyPath = path.resolve(__dirname, "../data/master-key.json");
  if (!existsSync(masterKeyPath)) {
    console.error(
      "Master key not found. Run:\n\n  npm run setup:master-key\n\n" +
      "In production, set the MASTER_KEY_JSON environment variable instead."
    );
    process.exit(1);
  }
  masterKey = JSON.parse(await readFile(masterKeyPath, "utf8"));
}

// Admin key: use env var or generate a random one for this session
const adminKey =
  process.env.ADMIN_API_KEY ?? randomBytes(16).toString("hex");

const PORT = parseInt(process.env.PORT ?? "3317", 10);
const HOST = process.env.HOST ?? "127.0.0.1";

const app = buildApp(masterKey, adminKey);

try {
  await app.listen({ port: PORT, host: HOST });
  console.log(`22B Labs AIL Issuer running at http://${HOST}:${PORT}`);
  console.log(`Dashboard:   http://${HOST}:${PORT}/dashboard`);
  if (!process.env.ADMIN_API_KEY) {
    console.log(`Admin key:   ${adminKey}  (set ADMIN_API_KEY env var to fix this)`);
  }
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
