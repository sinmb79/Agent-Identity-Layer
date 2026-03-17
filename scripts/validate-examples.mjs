import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");
const examplesDir = path.join(repoRoot, "examples");

const required = {
  version: "string",
  agent: "object",
  delegation: "object",
  scope: "object",
  runtime: "object",
  verification: "object",
};

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function checkEnvelope(data) {
  const errors = [];

  for (const [key, type] of Object.entries(required)) {
    if (!(key in data)) {
      errors.push(`missing top-level field: ${key}`);
      continue;
    }
    if (type === "object" && !isObject(data[key])) {
      errors.push(`field must be object: ${key}`);
    }
    if (type === "string" && typeof data[key] !== "string") {
      errors.push(`field must be string: ${key}`);
    }
  }

  if (data.version !== "ail.v0") {
    errors.push(`version must be ail.v0`);
  }

  if (!isObject(data.agent) || typeof data.agent.id !== "string") {
    errors.push("agent.id must exist");
  }
  if (!isObject(data.agent) || typeof data.agent.display_name !== "string") {
    errors.push("agent.display_name must exist");
  }
  if (!isObject(data.agent) || typeof data.agent.role !== "string") {
    errors.push("agent.role must exist");
  }

  if (!isObject(data.delegation) || typeof data.delegation.mode !== "string") {
    errors.push("delegation.mode must exist");
  }

  if (!isObject(data.scope) || !isObject(data.scope.approval_policy)) {
    errors.push("scope.approval_policy must exist");
  }

  const hasRunId = isObject(data.runtime) && typeof data.runtime.run_id === "string";
  const hasSessionId = isObject(data.runtime) && typeof data.runtime.session_id === "string";
  if (!hasRunId && !hasSessionId) {
    errors.push("runtime.run_id or runtime.session_id must exist");
  }

  if (!isObject(data.verification) || typeof data.verification.strength !== "string") {
    errors.push("verification.strength must exist");
  }

  return errors;
}

const files = fs.readdirSync(examplesDir).filter((name) => name.endsWith(".json"));
const summary = [];

for (const file of files) {
  const fullPath = path.join(examplesDir, file);
  const raw = fs.readFileSync(fullPath, "utf8");
  try {
    const data = JSON.parse(raw);
    const errors = checkEnvelope(data);
    summary.push({ file, ok: errors.length === 0, errors });
  } catch (error) {
    summary.push({ file, ok: false, errors: [`invalid JSON: ${error.message}`] });
  }
}

const failed = summary.filter((item) => !item.ok);

console.log("Agent Identity Layer example validation\n");
for (const item of summary) {
  console.log(`- ${item.file}: ${item.ok ? "PASS" : "FAIL"}`);
  for (const error of item.errors) {
    console.log(`  - ${error}`);
  }
}

console.log(`\nResult: ${summary.length - failed.length}/${summary.length} examples passed`);
process.exit(failed.length === 0 ? 0 : 1);
