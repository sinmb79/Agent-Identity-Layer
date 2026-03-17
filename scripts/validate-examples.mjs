import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");
const examplesDir = path.join(repoRoot, "examples");

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function checkV0(data) {
  const errors = [];

  if (data.version !== "ail.v0") {
    errors.push(`version must be ail.v0`);
  }

  for (const key of ["agent", "delegation", "scope", "runtime", "verification"]) {
    if (!isObject(data[key])) errors.push(`missing or invalid top-level field: ${key}`);
  }

  if (!isObject(data.agent) || typeof data.agent.id !== "string") errors.push("agent.id must exist");
  if (!isObject(data.agent) || typeof data.agent.display_name !== "string") errors.push("agent.display_name must exist");
  if (!isObject(data.agent) || typeof data.agent.role !== "string") errors.push("agent.role must exist");

  if (!isObject(data.delegation) || typeof data.delegation.mode !== "string") errors.push("delegation.mode must exist");

  if (!isObject(data.scope) || !isObject(data.scope.approval_policy)) errors.push("scope.approval_policy must exist");

  const hasRunId = isObject(data.runtime) && typeof data.runtime.run_id === "string";
  const hasSessionId = isObject(data.runtime) && typeof data.runtime.session_id === "string";
  if (!hasRunId && !hasSessionId) errors.push("runtime.run_id or runtime.session_id must exist");

  if (!isObject(data.verification) || typeof data.verification.strength !== "string") errors.push("verification.strength must exist");

  return errors;
}

function checkV1(data) {
  const errors = [];

  if (data.version !== "ail.v1") {
    errors.push(`version must be ail.v1`);
  }

  // Base fields (same as v0)
  for (const key of ["agent", "delegation", "scope", "runtime", "verification"]) {
    if (!isObject(data[key])) errors.push(`missing or invalid top-level field: ${key}`);
  }

  if (!isObject(data.agent) || typeof data.agent.id !== "string") errors.push("agent.id must exist");
  if (!isObject(data.agent) || typeof data.agent.display_name !== "string") errors.push("agent.display_name must exist");
  if (!isObject(data.agent) || typeof data.agent.role !== "string") errors.push("agent.role must exist");

  if (!isObject(data.delegation) || typeof data.delegation.mode !== "string") errors.push("delegation.mode must exist");

  if (!isObject(data.scope) || !isObject(data.scope.approval_policy)) errors.push("scope.approval_policy must exist");

  const hasRunId = isObject(data.runtime) && typeof data.runtime.run_id === "string";
  const hasSessionId = isObject(data.runtime) && typeof data.runtime.session_id === "string";
  if (!hasRunId && !hasSessionId) errors.push("runtime.run_id or runtime.session_id must exist");

  if (!isObject(data.verification) || typeof data.verification.strength !== "string") errors.push("verification.strength must exist");

  // v1-specific: registered agent checks
  const isRegistered = data.ail_id !== null && data.ail_id !== undefined;

  if (isRegistered) {
    if (typeof data.ail_id !== "string" || !/^AIL-\d{4}-\d{5}$/.test(data.ail_id)) {
      errors.push("ail_id must match format AIL-YYYY-NNNNN");
    }

    if (!isObject(data.credential)) errors.push("credential must be an object for registered agents");
    if (isObject(data.credential)) {
      if (typeof data.credential.token !== "string") errors.push("credential.token must exist");
      if (typeof data.credential.issuer !== "string") errors.push("credential.issuer must exist");
      if (typeof data.credential.issued_at !== "string") errors.push("credential.issued_at must exist");
      if (typeof data.credential.expires_at !== "string") errors.push("credential.expires_at must exist");
    }

    if (!isObject(data.owner) || typeof data.owner.key_id !== "string") errors.push("owner.key_id must exist for registered agents");

    if (!isObject(data.signal_glyph) || typeof data.signal_glyph.seed !== "string") errors.push("signal_glyph.seed must exist for registered agents");

    if (!isObject(data.behavior_fingerprint) || typeof data.behavior_fingerprint.hash !== "string") errors.push("behavior_fingerprint.hash must exist for registered agents");

    if (!isObject(data.verification) || data.verification.signed !== true) errors.push("verification.signed must be true for registered agents");
  }

  return errors;
}

function checkEnvelope(data) {
  if (data.version === "ail.v0") return checkV0(data);
  if (data.version === "ail.v1") return checkV1(data);
  return [`unknown version: ${data.version} (expected ail.v0 or ail.v1)`];
}

const files = fs.readdirSync(examplesDir).filter((name) => name.endsWith(".json"));
const summary = [];

for (const file of files) {
  const fullPath = path.join(examplesDir, file);
  const raw = fs.readFileSync(fullPath, "utf8");
  try {
    const data = JSON.parse(raw);
    const errors = checkEnvelope(data);
    summary.push({ file, version: data.version ?? "unknown", ok: errors.length === 0, errors });
  } catch (error) {
    summary.push({ file, version: "unknown", ok: false, errors: [`invalid JSON: ${error.message}`] });
  }
}

const failed = summary.filter((item) => !item.ok);

console.log("Agent Identity Layer example validation\n");
for (const item of summary) {
  console.log(`- ${item.file} [${item.version}]: ${item.ok ? "PASS" : "FAIL"}`);
  for (const error of item.errors) {
    console.log(`  - ${error}`);
  }
}

console.log(`\nResult: ${summary.length - failed.length}/${summary.length} examples passed`);
process.exit(failed.length === 0 ? 0 : 1);
