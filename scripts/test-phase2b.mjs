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
import { AilClient as JsClient } from "../sdk/js/src/client.mjs";

const ADMIN_API_KEY = "phase2b-admin-key";
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

async function expectJson(response, expectedStatus, label) {
  const bodyText = await response.text();
  assert.equal(
    response.status,
    expectedStatus,
    `${label} expected ${expectedStatus}, got ${response.status}: ${bodyText}`
  );
  return JSON.parse(bodyText);
}

function findFirstSqliteFile(rootDir) {
  const queue = [rootDir];

  while (queue.length) {
    const current = queue.shift();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) queue.push(fullPath);
      else if (entry.isFile() && entry.name.endsWith(".sqlite")) return fullPath;
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

  const { token, issuedAt, expiresAt } = await issueCredentialJWT({
    ail_id: agent.ail_id,
    display_name: agent.display_name,
    role: agent.role,
    owner_key_id: agent.owner_key_id,
    owner_org: agent.owner_org,
    scope_hash: scopeHash,
    signal_glyph_seed: signalGlyph.seed,
    behavior_fingerprint: behaviorFingerprint.hash,
  }, masterKey);

  db.prepare(`
    INSERT INTO agents (
      ail_id, display_name, role, provider, model,
      owner_key_id, owner_org, scope_json, scope_hash,
      signal_glyph_seed, behavior_fingerprint,
      credential_token, issued_at, expires_at, nft_image_svg, nft_token_id
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    agent.ail_id,
    agent.display_name,
    agent.role,
    agent.provider,
    agent.model,
    agent.owner_key_id,
    agent.owner_org,
    JSON.stringify(agent.scope),
    scopeHash,
    signalGlyph.seed,
    behaviorFingerprint.hash,
    token,
    issuedAt.toISOString(),
    expiresAt.toISOString(),
    `<svg xmlns="http://www.w3.org/2000/svg"><text>${agent.display_name}</text></svg>`,
    agent.nft_token_id ?? null
  );

  return token;
}

async function main() {
  const persistRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ail-phase2b-"));
  const masterKey = {
    kid: "mk_phase2b_test",
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

    const ownerId = "owk_phase2b_owner";
    sqlite.prepare(`
      INSERT INTO owners (id, email, email_verified, org, public_key_jwk, created_at)
      VALUES (?, ?, 1, ?, ?, ?)
    `).run(
      ownerId,
      "phase2b@example.com",
      "agentcraft_labs",
      JSON.stringify((await createEcKeypairJwk()).public_key_jwk),
      new Date().toISOString()
    );

    const token = await seedAgent(sqlite, masterKey, {
      ail_id: "AIL-2026-00042",
      display_name: "Agent Forty Two",
      role: "strategist",
      provider: "openai",
      model: "gpt-5.4",
      owner_key_id: ownerId,
      owner_org: "agentcraft_labs",
      scope: DEFAULT_SCOPE,
      nft_token_id: "42",
    });

    const sourceKeys = await createEcKeypairJwk();

    const source = await expectJson(
      await worker.fetch("/sources/register", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: "agentcraft",
          admin_wallet: "0x437A730000000000000000000000000000000002",
          verification_method: "signature",
          public_key_jwk: sourceKeys.public_key_jwk,
        }),
      }),
      201,
      "sources/register"
    );

    await expectJson(
      await worker.fetch(`/sources/${source.source_id}/approve`, {
        method: "POST",
        headers: { authorization: `Bearer ${ADMIN_API_KEY}` },
      }),
      200,
      "sources/approve"
    );

    for (let epoch = 1; epoch <= 5; epoch += 1) {
      const basePayload = {
        agent_id: "AIL-2026-00042",
        season: 1,
        epoch,
        metrics: {
          attack_success_rate: 0.96,
          action_success_rate: 1,
          defense_rate: 0.92,
          tiles_captured: 25,
          faction_rank: 1,
          xp_earned: 150 + (epoch * 10),
          faction_directive_compliance: 88,
          team_synergy_score: 84,
          actions_taken: 30 + epoch,
          season_end: epoch === 5,
          epoch_mvp: epoch === 2,
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
        `reputation/submit ${epoch}`
      );
    }

    const badges = await expectJson(
      await worker.fetch("/reputation/AIL-2026-00042/badges"),
      200,
      "reputation/badges"
    );
    assert.ok(badges.badges.some((badge) => badge.badge_id === "pioneer"));

    const duplicateBadgePayload = {
      source_name: "agentcraft",
      agent_id: "AIL-2026-00042",
      badge_id: "season_top10",
      merkle_proof: null,
    };
    const invalidBadge = await expectJson(
      await worker.fetch("/reputation/badge", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          ...duplicateBadgePayload,
          signature: "bad-signature",
        }),
      }),
      401,
      "reputation/badge invalid signature"
    );
    assert.equal(invalidBadge.error, "invalid_source_signature");

    const manualBadge = await expectJson(
      await worker.fetch("/reputation/badge", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          ...duplicateBadgePayload,
          signature: await signPayload(duplicateBadgePayload, sourceKeys.private_key_jwk),
        }),
      }),
      201,
      "reputation/badge"
    );
    assert.equal(manualBadge.badge_id, "season_top10");

    await expectJson(
      await worker.fetch("/reputation/badge", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          ...duplicateBadgePayload,
          signature: await signPayload(duplicateBadgePayload, sourceKeys.private_key_jwk),
        }),
      }),
      409,
      "reputation/badge duplicate"
    );

    const season = await expectJson(
      await worker.fetch("/reputation/AIL-2026-00042/season/1"),
      200,
      "reputation/season"
    );
    assert.equal(season.season, 1);
    assert.ok(Array.isArray(season.summary.badges_earned));

    const profilePage = await worker.fetch("/agent/AIL-2026-00042");
    const profileHtml = await profilePage.text();
    assert.equal(profilePage.status, 200, `profile expected 200, got ${profilePage.status}: ${profileHtml}`);
    assert.match(profileHtml, /Chart\.js/);
    assert.match(profileHtml, /Agent Forty Two/);

    const client = new JsClient({ serverUrl: `http://${worker.address}:${worker.port}` });
    const sdkManualBadge = await client.awardBadge({
      source_name: "agentcraft",
      agent_id: "AIL-2026-00042",
      badge_id: "season_champion",
      private_key_jwk: sourceKeys.private_key_jwk,
    });
    assert.equal(sdkManualBadge.badge_id, "season_champion");

    const sdkBadges = await client.getBadges("AIL-2026-00042");
    assert.ok(Array.isArray(sdkBadges.badges));
    const sdkReputation = await client.getReputation("AIL-2026-00042");
    assert.equal(sdkReputation.ail_id, "AIL-2026-00042");
    const sdkHistory = await client.getReputationHistory("AIL-2026-00042", { season: 1 });
    assert.ok(Array.isArray(sdkHistory.history));
    const sdkSeason = await client.getSeasonReport("AIL-2026-00042", 1);
    assert.equal(sdkSeason.season, 1);
    const sdkLeaderboard = await client.getLeaderboard({ dimension: "overall" });
    assert.ok(Array.isArray(sdkLeaderboard.entries));

    const verify = await expectJson(
      await worker.fetch("/verify", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token }),
      }),
      200,
      "verify"
    );
    assert.ok(verify.reputation);
    assert.equal(verify.reputation.achievements >= 1, true);

    console.log("Phase 2b E2E passed");
  } finally {
    if (worker) await worker.stop();
    if (sqlite) sqlite.close();
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
