import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { unstable_dev } from "wrangler";
import { exportJWK } from "jose";

const DEFAULT_SCOPE = {
  network: "restricted",
  secrets: "none",
  write_access: false,
  approval_policy: {
    irreversible_actions: "human_required",
    external_posting: "human_required",
    destructive_file_ops: "human_required",
  },
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

async function expectJson(response, expectedStatus, label) {
  const bodyText = await response.text();
  assert.equal(
    response.status,
    expectedStatus,
    `${label} expected ${expectedStatus}, got ${response.status}: ${bodyText}`
  );
  return JSON.parse(bodyText);
}

async function main() {
  const persistRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ail-accountability-"));
  const masterKey = {
    kid: "mk_accountability_test",
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

    const ownerKeys = await createEcKeypairJwk();
    const now = new Date("2026-06-12T10:00:00.000Z").toISOString();
    const sessionExpiry = new Date("2026-06-13T10:00:00.000Z").toISOString();

    sqlite.prepare(`
      INSERT INTO owners (id, email, email_verified, org, public_key_jwk, created_at)
      VALUES (?, ?, 1, ?, ?, ?)
    `).run(
      "owk_accountability_owner",
      "accountability@example.com",
      "Koinara Labs",
      JSON.stringify(ownerKeys.public_key_jwk),
      now
    );

    sqlite.prepare(`
      INSERT INTO owner_sessions (token, owner_id, created_at, expires_at)
      VALUES (?, ?, ?, ?)
    `).run("session-accountability-owner", "owk_accountability_owner", now, sessionExpiry);

    const registration = await expectJson(
      await worker.fetch("/agents/register-session", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          session_token: "session-accountability-owner",
          payload: {
            display_name: "OpenClaw Sentinel",
            role: "security_monitor",
            provider: "openai",
            model: "gpt-5.4",
            scope: DEFAULT_SCOPE,
            plan: "free",
            accountability: {
              creator: {
                name: "Koinara Labs",
                type: "organization",
                contact: "koinara.xyz@gmail.com",
              },
              operator: {
                name: "OpenClaw Market Ops",
                url: "https://www.koinara.xyz/openclaw",
              },
              origin: {
                domain: "www.koinara.xyz",
                deployment_url: "https://www.koinara.xyz/agents/openclaw-sentinel",
                repository_url: "https://github.com/sinmb79/openclaw",
                commit_hash: "abc123def456",
                runtime: "cloudflare-workers",
              },
              purpose: {
                declared: "Monitor agent listings for unsafe behavior before marketplace exposure.",
                intended_users: ["marketplace operators", "agent buyers"],
                prohibited_uses: ["autonomous purchasing", "credential harvesting"],
                risk_class: "medium",
              },
              capabilities: {
                tools: ["market_scan", "reputation_lookup"],
                external_endpoints: ["https://www.koinara.xyz/api/agents"],
              },
            },
          },
        }),
      }),
      201,
      "register-session with accountability"
    );

    assert.match(registration.ail_id, /^AIL-\d{4}-\d{5}$/);
    assert.match(registration.accountability.manifest_hash, /^sha256:[a-f0-9]{64}$/);
    assert.equal(registration.accountability.responsible_contact, "koinara.xyz@gmail.com");

    const manifest = await expectJson(
      await worker.fetch(`/agent/${registration.ail_id}/manifest.json`),
      200,
      "manifest"
    );
    assert.equal(manifest.type, "AIL.AccountabilityManifest.v1");
    assert.equal(manifest.subject.ail_id, registration.ail_id);
    assert.equal(manifest.responsible_parties.creator.name, "Koinara Labs");
    assert.equal(manifest.responsible_parties.operator.name, "OpenClaw Market Ops");
    assert.equal(manifest.provenance.origin_domain, "www.koinara.xyz");
    assert.equal(manifest.provenance.repository_url, "https://github.com/sinmb79/openclaw");
    assert.equal(manifest.purpose.risk_class, "medium");
    assert.ok(manifest.hashes.scope_hash);
    assert.equal(manifest.manifest_hash, registration.accountability.manifest_hash);

    const card = await expectJson(
      await worker.fetch(`/agent/${registration.ail_id}/card.json`),
      200,
      "agent card"
    );
    assert.equal(card.protocol, "agentidcard.agent-card.v1");
    assert.equal(card.agent_id, registration.ail_id);
    assert.equal(card.name, "OpenClaw Sentinel");
    assert.equal(card.provider.name, "openai");
    assert.equal(card.accountability.manifest_hash, registration.accountability.manifest_hash);
    assert.equal(card.accountability.responsible_contact, "koinara.xyz@gmail.com");
    assert.deepEqual(card.capabilities.tools, ["market_scan", "reputation_lookup"]);

    const verification = await expectJson(
      await worker.fetch("/verify", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token: registration.credential.token }),
      }),
      200,
      "verify"
    );
    assert.equal(verification.valid, true);
    assert.equal(verification.accountability.manifest_hash, registration.accountability.manifest_hash);
    assert.equal(verification.accountability.creator.name, "Koinara Labs");
    assert.equal(verification.accountability.risk_class, "medium");
    assert.match(verification.accountability.manifest_url, new RegExp(`/agent/${registration.ail_id}/manifest\\.json$`));

    console.log("Accountability manifest E2E passed");
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
