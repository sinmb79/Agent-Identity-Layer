import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { unstable_dev } from "wrangler";
import { exportJWK } from "jose";
import {
  computeBehaviorFingerprint,
  computeGlyphSeed,
  computeScopeHash,
  issueCredentialJWT,
} from "../workers/lib/crypto.mjs";

const DEFAULT_SCOPE = {
  network: "read-only",
  secrets: false,
  write_access: false,
};

async function createEcKeypairJwk() {
  const { privateKey, publicKey } = await crypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    true,
    ["sign", "verify"]
  );

  return {
    private_key_jwk: await exportJWK(privateKey),
    public_key_jwk: await exportJWK(publicKey),
  };
}

function readJson(response, bodyText) {
  try {
    return JSON.parse(bodyText);
  } catch {
    return null;
  }
}

async function expectJson(response, expectedStatus, label) {
  const bodyText = await response.text();
  assert.equal(
    response.status,
    expectedStatus,
    `${label} expected ${expectedStatus}, got ${response.status}: ${bodyText}`
  );

  const json = readJson(response, bodyText);
  assert.ok(json, `${label} should return JSON`);
  return json;
}

function findFirstSqliteFile(rootDir) {
  const queue = [rootDir];

  while (queue.length > 0) {
    const current = queue.shift();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        queue.push(fullPath);
        continue;
      }
      if (entry.isFile() && entry.name.endsWith(".sqlite")) {
        return fullPath;
      }
    }
  }

  throw new Error(`No SQLite database found under ${rootDir}`);
}

async function seedAgent(db, masterKey, agent) {
  const behaviorFingerprint = await computeBehaviorFingerprint({
    role: agent.role,
    provider: agent.provider,
    scope: agent.scope,
  });
  const signalGlyph = computeGlyphSeed(agent.ail_id, agent.display_name, agent.owner_key_id);
  const scopeHash = await computeScopeHash(agent.scope);
  const ownerOrg = agent.owner_org ?? null;

  const { token, issuedAt, expiresAt } = await issueCredentialJWT({
    ail_id: agent.ail_id,
    display_name: agent.display_name,
    role: agent.role,
    owner_key_id: agent.owner_key_id,
    owner_org: ownerOrg,
    scope_hash: scopeHash,
    signal_glyph_seed: signalGlyph.seed,
    behavior_fingerprint: behaviorFingerprint.hash,
  }, masterKey);

  db.prepare(`
    INSERT INTO agents (
      ail_id, display_name, role, provider, model,
      owner_key_id, owner_org, scope_json, scope_hash,
      signal_glyph_seed, behavior_fingerprint,
      credential_token, issued_at, expires_at, nft_image_svg
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    agent.ail_id,
    agent.display_name,
    agent.role,
    agent.provider,
    agent.model,
    agent.owner_key_id,
    ownerOrg,
    JSON.stringify(agent.scope),
    scopeHash,
    signalGlyph.seed,
    behaviorFingerprint.hash,
    token,
    issuedAt.toISOString(),
    expiresAt.toISOString(),
    `<svg xmlns="http://www.w3.org/2000/svg"><text>${agent.ail_id}</text></svg>`
  );
}

async function main() {
  const html = fs.readFileSync(path.resolve("server", "register.html"), "utf8");
  assert.match(html, /Additional agents require payment/i, "register page should explain extra agents require payment");
  assert.match(html, /function goBackFromStep3\(/, "register page should provide a back action from step 3");
  assert.match(html, /function goBackFromStep4\(/, "register page should provide a back action from step 4");
  assert.match(html, /payment_tx_hash:\s*paymentTxHash/, "paid single-agent registrations should send the payment transaction hash");
  assert.match(html, /providers\.find\(\(provider\) => provider\.isMetaMask\)/, "wallet connection should prefer the MetaMask provider");
  assert.match(html, /startAnotherRegistration\(\)/, "result page should keep authenticated users in the add-another flow");

  const persistRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ail-register-flow-"));
  const masterKey = {
    kid: "mk_register_flow_test",
    ...(await createEcKeypairJwk()),
  };
  let worker;
  let sqlite;

  try {
    worker = await unstable_dev("workers/index.mjs", {
      config: "wrangler.toml",
      persistTo: persistRoot,
      logLevel: "error",
      vars: {
        AIL_BASE_URL: "https://api.agentidcard.org",
        MASTER_KEY_JSON: JSON.stringify(masterKey),
      },
      experimental: {
        disableExperimentalWarning: true,
      },
    });

    await expectJson(await worker.fetch("/health"), 200, "health");

    const dbPath = findFirstSqliteFile(persistRoot);
    sqlite = new DatabaseSync(dbPath);
    sqlite.exec("PRAGMA foreign_keys = ON");

    const freeOwner = await createEcKeypairJwk();
    const paidOwner = await createEcKeypairJwk();
    const now = new Date("2026-03-21T11:00:00.000Z").toISOString();
    const sessionExpiry = new Date("2026-03-22T11:00:00.000Z").toISOString();

    sqlite.prepare(`
      INSERT INTO owners (id, email, email_verified, org, public_key_jwk, created_at)
      VALUES (?, ?, 1, ?, ?, ?)
    `).run(
      "owk_free_owner",
      "free-owner@example.com",
      "solo_labs",
      JSON.stringify(freeOwner.public_key_jwk),
      now
    );

    sqlite.prepare(`
      INSERT INTO owners (id, email, email_verified, org, public_key_jwk, created_at)
      VALUES (?, ?, 1, ?, ?, ?)
    `).run(
      "owk_paid_owner",
      "paid-owner@example.com",
      "team_labs",
      JSON.stringify(paidOwner.public_key_jwk),
      now
    );

    sqlite.prepare(`
      INSERT INTO owner_sessions (token, owner_id, created_at, expires_at)
      VALUES (?, ?, ?, ?)
    `).run("session-free-owner", "owk_free_owner", now, sessionExpiry);

    sqlite.prepare(`
      INSERT INTO owner_sessions (token, owner_id, created_at, expires_at)
      VALUES (?, ?, ?, ?)
    `).run("session-paid-owner", "owk_paid_owner", now, sessionExpiry);

    await seedAgent(sqlite, masterKey, {
      ail_id: "AIL-2026-00012",
      display_name: "Existing Agent",
      role: "assistant",
      provider: "openai",
      model: "gpt-5.4",
      owner_key_id: "owk_paid_owner",
      owner_org: "team_labs",
      scope: DEFAULT_SCOPE,
    });

    const freeFirstAgent = await expectJson(
      await worker.fetch("/agents/register-session", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          session_token: "session-free-owner",
          payload: {
            display_name: "First Free Agent",
            role: "assistant",
            provider: "openai",
            scope: DEFAULT_SCOPE,
            plan: "free",
          },
        }),
      }),
      201,
      "first free session registration"
    );
    assert.match(freeFirstAgent.ail_id, /^AIL-\d{4}-\d{5}$/);

    const extraFreeAgent = await expectJson(
      await worker.fetch("/agents/register-session", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          session_token: "session-paid-owner",
          payload: {
            display_name: "Should Fail Free",
            role: "assistant",
            provider: "openai",
            scope: DEFAULT_SCOPE,
            plan: "free",
          },
        }),
      }),
      402,
      "additional free agent should be rejected"
    );
    assert.equal(extraFreeAgent.error, "free_plan_exhausted");

    const missingPayment = await expectJson(
      await worker.fetch("/agents/register-session", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          session_token: "session-paid-owner",
          payload: {
            display_name: "Needs Payment",
            role: "assistant",
            provider: "openai",
            scope: DEFAULT_SCOPE,
            wallet_address: "0x1111111111111111111111111111111111111111",
            plan: "standard",
          },
        }),
      }),
      402,
      "standard plan without payment should be rejected"
    );
    assert.equal(missingPayment.error, "payment_required");

    console.log("Register flow enforcement test passed");
  } finally {
    if (worker) {
      await worker.stop();
    }
    if (sqlite) {
      sqlite.close();
    }
    try {
      fs.rmSync(persistRoot, { recursive: true, force: true });
    } catch {}
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
