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
  signPayload,
} from "../workers/lib/crypto.mjs";

const ADMIN_API_KEY = "phase2a-admin-key";
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

  return token;
}

async function main() {
  const persistRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ail-reputation-"));
  const masterKey = {
    kid: "mk_phase2a_test",
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
        ADMIN_API_KEY,
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

    const ownerId = "owk_phase2a_owner";
    sqlite.prepare(`
      INSERT INTO owners (id, email, email_verified, org, public_key_jwk, created_at)
      VALUES (?, ?, 1, ?, ?, ?)
    `).run(
      ownerId,
      "phase2a@example.com",
      "agentcraft_labs",
      JSON.stringify((await createEcKeypairJwk()).public_key_jwk),
      new Date().toISOString()
    );

    const tokenA = await seedAgent(sqlite, masterKey, {
      ail_id: "AIL-2026-00042",
      display_name: "Agent Forty Two",
      role: "strategist",
      provider: "openai",
      model: "gpt-5.4",
      owner_key_id: ownerId,
      owner_org: "agentcraft_labs",
      scope: DEFAULT_SCOPE,
    });

    await seedAgent(sqlite, masterKey, {
      ail_id: "AIL-2026-00099",
      display_name: "Agent Ninety Nine",
      role: "coordinator",
      provider: "openai",
      model: "gpt-5.4",
      owner_key_id: ownerId,
      owner_org: "agentcraft_labs",
      scope: DEFAULT_SCOPE,
    });

    const sourceKeys = await createEcKeypairJwk();

    const registerSource = await expectJson(
      await worker.fetch("/sources/register", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: "agentcraft",
          contract_address: "0x437A730000000000000000000000000000000001",
          chain_id: 8453,
          admin_wallet: "0x437A730000000000000000000000000000000002",
          verification_method: "signature",
          public_key_jwk: sourceKeys.public_key_jwk,
        }),
      }),
      201,
      "sources/register"
    );
    assert.equal(registerSource.status, "pending");

    const sourceId = registerSource.source_id;

    const approvedSource = await expectJson(
      await worker.fetch(`/sources/${sourceId}/approve`, {
        method: "POST",
        headers: { authorization: `Bearer ${ADMIN_API_KEY}` },
      }),
      200,
      "sources/approve"
    );
    assert.equal(approvedSource.status, "approved");

    const approvedSources = await expectJson(
      await worker.fetch("/sources"),
      200,
      "sources/list"
    );
    assert.ok(Array.isArray(approvedSources.sources));
    assert.equal(approvedSources.sources.length, 1);

    const invalidSubmit = await expectJson(
      await worker.fetch("/reputation/submit", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          source_name: "agentcraft",
          agent_id: "AIL-2026-00042",
          season: 1,
          epoch: 1,
          metrics: { xp_earned: 10 },
          signature: "bad-signature",
        }),
      }),
      401,
      "reputation/submit invalid signature"
    );
    assert.equal(invalidSubmit.error, "invalid_source_signature");

    for (let epoch = 1; epoch <= 5; epoch += 1) {
      const basePayload = {
        agent_id: "AIL-2026-00042",
        season: 1,
        epoch,
        metrics: {
          attack_success_rate: 55 + epoch,
          tiles_captured: 6 + epoch,
          faction_rank: Math.max(1, 10 - epoch),
          xp_earned: 100 + (epoch * 15),
          faction_directive_compliance: 72 + epoch,
          team_synergy_score: 68 + epoch,
          actions_taken: 20 + epoch,
          tiles_defended: 3 + epoch,
        },
      };

      const response = await expectJson(
        await worker.fetch("/reputation/submit", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            source_name: "agentcraft",
            ...basePayload,
            signature: await signPayload(basePayload, sourceKeys.private_key_jwk),
          }),
        }),
        201,
        `reputation/submit agent 42 epoch ${epoch}`
      );
      assert.equal(response.agent_id, "AIL-2026-00042");
      assert.equal(response.verified, true);
      assert.equal(response.scores_updated, true);
    }

    for (let epoch = 1; epoch <= 5; epoch += 1) {
      const basePayload = {
        agent_id: "AIL-2026-00099",
        season: 1,
        epoch,
        metrics: {
          attack_success_rate: 45 + epoch,
          tiles_captured: 4 + epoch,
          faction_rank: 12 - epoch,
          xp_earned: 80 + (epoch * 11),
          faction_directive_compliance: 65 + epoch,
          team_synergy_score: 64 + epoch,
          actions_taken: 16 + epoch,
          tiles_defended: 2 + epoch,
        },
      };

      await expectJson(
        await worker.fetch("/reputation/submit", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            source_name: "agentcraft",
            ...basePayload,
            signature: await signPayload(basePayload, sourceKeys.private_key_jwk),
          }),
        }),
        201,
        `reputation/submit agent 99 epoch ${epoch}`
      );
    }

    const profile = await expectJson(
      await worker.fetch("/reputation/AIL-2026-00042"),
      200,
      "reputation/profile"
    );
    assert.equal(profile.ail_id, "AIL-2026-00042");
    assert.ok(profile.composite_scores);
    assert.equal(profile.platform_records.length, 1);
    assert.equal(profile.performance_trend.last_5_epochs.length, 5);

    const history = await expectJson(
      await worker.fetch("/reputation/AIL-2026-00042/history?source=agentcraft&season=1&limit=5"),
      200,
      "reputation/history"
    );
    assert.equal(history.history.length, 5);

    const compare = await expectJson(
      await worker.fetch("/reputation/AIL-2026-00042/compare?with=AIL-2026-00099"),
      200,
      "reputation/compare"
    );
    assert.equal(compare.agents.length, 2);
    assert.ok(compare.comparison.overall_leader);

    const leaderboard = await expectJson(
      await worker.fetch("/reputation/leaderboard?dimension=overall&source=agentcraft&limit=10"),
      200,
      "reputation/leaderboard"
    );
    assert.ok(leaderboard.entries.length >= 2);
    assert.equal(leaderboard.entries[0].rank, 1);

    const verify = await expectJson(
      await worker.fetch("/verify", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token: tokenA }),
      }),
      200,
      "verify"
    );
    assert.equal(verify.valid, true);
    assert.ok(verify.reputation);
    assert.equal(verify.reputation.data_sources, 1);
    assert.ok(verify.reputation.detail_url.endsWith("/AIL-2026-00042/reputation"));

    console.log("Phase 2a reputation E2E passed");
  } finally {
    if (worker) {
      await worker.stop();
    }
    if (sqlite) {
      sqlite.close();
    }
    try {
      fs.rmSync(persistRoot, { recursive: true, force: true });
    } catch (cleanupError) {
      console.warn(`Cleanup skipped for ${persistRoot}: ${cleanupError.message}`);
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
