import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { unstable_dev } from "wrangler";
import { exportJWK } from "jose";
import { AilClient } from "../sdk/js/src/client.mjs";
import {
  computeBehaviorFingerprint,
  computeGlyphSeed,
  computeScopeHash,
  issueCredentialJWT,
} from "../workers/lib/crypto.mjs";

const ADMIN_API_KEY = "verify-widget-admin-key";
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

function seedReputationData(db, { ailId, sourceId, sourceName }) {
  const now = new Date("2026-03-20T10:00:00.000Z").toISOString();
  const scores = [
    ["overall", 78.5],
    ["strategic_reasoning", 82],
    ["adaptability", 71],
    ["cooperation", 68],
    ["consistency", 74],
  ];

  for (const [dimension, score] of scores) {
    db.prepare(`
      INSERT INTO composite_scores (agent_id, dimension, score, data_points, updated_at)
      VALUES (?, ?, ?, 4, ?)
    `).run(ailId, dimension, score, now);
  }

  db.prepare(`
    INSERT INTO reputation_records (
      id, agent_id, source_id, season, epoch,
      metrics_json, source_signature, verified, submitted_at
    ) VALUES (?, ?, ?, 1, 1, ?, 'test-signature', 1, ?)
  `).run(
    crypto.randomUUID(),
    ailId,
    sourceId,
    JSON.stringify({
      actions_taken: 24,
      tiles_captured: 14,
      team_synergy_score: 77,
    }),
    now
  );

  db.prepare(`
    INSERT INTO achievements (
      id, agent_id, badge_id, source_id, earned_at, metadata_json
    ) VALUES (?, ?, 'pioneer', ?, ?, ?)
  `).run(
    crypto.randomUUID(),
    ailId,
    sourceId,
    now,
    JSON.stringify({
      title: "Pioneer",
      rarity: "Common",
      criteria: "Participated in Season 1",
      source: sourceName,
    })
  );
}

async function main() {
  const persistRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ail-auth-"));
  const masterKey = {
    kid: "mk_verify_widget_test",
    ...(await createEcKeypairJwk()),
  };
  const sdkServerUrl = "https://sdk.test";
  let worker;
  let sqlite;
  const originalFetch = globalThis.fetch;

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

    const ownerId = "owk_verify_widget_owner";
    sqlite.prepare(`
      INSERT INTO owners (id, email, email_verified, org, public_key_jwk, created_at)
      VALUES (?, ?, 1, ?, ?, ?)
    `).run(
      ownerId,
      "verify-widget@example.com",
      "agentcraft_labs",
      JSON.stringify((await createEcKeypairJwk()).public_key_jwk),
      new Date("2026-03-20T09:55:00.000Z").toISOString()
    );

    const sourceId = "source_verify_widget_agentcraft";
    sqlite.prepare(`
      INSERT INTO registered_sources (
        id, name, contract_address, chain_id, admin_wallet, verification_method,
        public_key_jwk, status, registered_at, approved_at
      ) VALUES (?, 'agentcraft', NULL, 8453, ?, 'signature', ?, 'approved', ?, ?)
    `).run(
      sourceId,
      "0x437A730000000000000000000000000000000002",
      JSON.stringify((await createEcKeypairJwk()).public_key_jwk),
      new Date("2026-03-20T09:58:00.000Z").toISOString(),
      new Date("2026-03-20T09:59:00.000Z").toISOString()
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

    seedReputationData(sqlite, {
      ailId: "AIL-2026-00042",
      sourceId,
      sourceName: "agentcraft",
    });

    globalThis.fetch = async (input, init) => {
      const target = typeof input === "string" ? input : input.url;
      const url = new URL(target);
      if (url.origin === sdkServerUrl) {
        return worker.fetch(`${url.pathname}${url.search}`, init);
      }
      return originalFetch(input, init);
    };

    const registeredClient = await expectJson(
      await worker.fetch("/auth/clients/register", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-admin-key": ADMIN_API_KEY,
        },
        body: JSON.stringify({
          name: "AgentCraft",
          allowed_origins: ["https://agentcraft.io", "http://localhost:3000"],
          redirect_uris: [
            "https://agentcraft.io/callback",
            "http://localhost:3000/callback",
          ],
        }),
      }),
      201,
      "auth/clients/register"
    );

    assert.match(registeredClient.client_id, /^ail_client_/);
    assert.match(registeredClient.client_secret, /^ail_secret_/);
    assert.equal(registeredClient.name, "AgentCraft");
    assert.deepEqual(registeredClient.allowed_origins, [
      "https://agentcraft.io",
      "http://localhost:3000",
    ]);
    assert.deepEqual(registeredClient.redirect_uris, [
      "https://agentcraft.io/callback",
      "http://localhost:3000/callback",
    ]);

    const sdkClient = new AilClient({ serverUrl: sdkServerUrl });
    const sdkRegisteredClient = await sdkClient.registerClient({
      name: "SDK Client",
      allowed_origins: ["https://sdk.example"],
      redirect_uris: ["https://sdk.example/callback"],
      admin_api_key: ADMIN_API_KEY,
    });
    assert.match(sdkRegisteredClient.client_id, /^ail_client_/);
    assert.match(sdkRegisteredClient.client_secret, /^ail_secret_/);

    const invalidClientResponse = await worker.fetch(
      "/auth/verify?client_id=ail_client_missing&redirect_uri=https%3A%2F%2Fagentcraft.io%2Fcallback"
    );
    const invalidClientHtml = await invalidClientResponse.text();
    assert.equal(invalidClientResponse.status, 404);
    assert.match(invalidClientHtml, /Unknown application/i);

    const verifyPageResponse = await worker.fetch(
      `/auth/verify?client_id=${encodeURIComponent(registeredClient.client_id)}&redirect_uri=${encodeURIComponent("https://agentcraft.io/callback")}&scope=identity&state=demo-state`
    );
    const verifyPageHtml = await verifyPageResponse.text();
    assert.equal(verifyPageResponse.status, 200);
    assert.match(verifyPageHtml, /Verify Your Agent ID Card/i);
    assert.match(verifyPageHtml, /AgentCraft<\/strong>\s+is requesting verification/i);

    const invalidRedirectResponse = await worker.fetch(
      `/auth/verify?client_id=${encodeURIComponent(registeredClient.client_id)}&redirect_uri=${encodeURIComponent("https://evil.example/callback")}`
    );
    const invalidRedirectHtml = await invalidRedirectResponse.text();
    assert.equal(invalidRedirectResponse.status, 400);
    assert.match(invalidRedirectHtml, /Invalid redirect URI/i);

    assert.equal(
      sdkClient.getAuthUrl({
        client_id: registeredClient.client_id,
        redirect_uri: "https://agentcraft.io/callback",
        scope: "identity",
        state: "sdk-state",
      }),
      `${sdkServerUrl}/auth/verify?client_id=${encodeURIComponent(registeredClient.client_id)}&redirect_uri=${encodeURIComponent("https://agentcraft.io/callback")}&scope=identity&state=sdk-state`
    );

    const authCodeIdentity = await expectJson(
      await worker.fetch("/auth/authorize", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          token: tokenA,
          client_id: registeredClient.client_id,
          redirect_uri: "https://agentcraft.io/callback",
          scope: "identity",
          state: "demo-state",
        }),
      }),
      201,
      "auth/authorize identity"
    );
    assert.match(authCodeIdentity.code, /^auth_code_/);
    assert.match(authCodeIdentity.redirect_url, /^https:\/\/agentcraft\.io\/callback\?/);

    const exchangedIdentity = await sdkClient.exchangeAuthCode({
      code: authCodeIdentity.code,
      client_id: registeredClient.client_id,
      client_secret: registeredClient.client_secret,
      origin: "https://agentcraft.io",
    });
    assert.equal(exchangedIdentity.valid, true);
    assert.equal(exchangedIdentity.ail_id, "AIL-2026-00042");
    assert.equal(exchangedIdentity.scope, "identity");
    assert.ok(!("reputation" in exchangedIdentity));

    const reusedCode = await expectJson(
      await worker.fetch("/auth/exchange", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "https://agentcraft.io",
        },
        body: JSON.stringify({
          code: authCodeIdentity.code,
          client_id: registeredClient.client_id,
          client_secret: registeredClient.client_secret,
        }),
      }),
      409,
      "auth/exchange reused code"
    );
    assert.equal(reusedCode.error, "auth_code_used");

    sqlite.prepare(`
      INSERT INTO auth_codes (
        code, ail_id, client_id, redirect_uri, scope,
        result_json, created_at, used, expires_at
      ) VALUES (?, ?, ?, ?, 'identity', ?, ?, 0, ?)
    `).run(
      "auth_code_expired_demo",
      "AIL-2026-00042",
      registeredClient.client_id,
      "https://agentcraft.io/callback",
      JSON.stringify({
        valid: true,
        ail_id: "AIL-2026-00042",
        display_name: "Agent Forty Two",
        role: "strategist",
        owner_org: "agentcraft_labs",
        issued: "2026-03-20T10:00:00.000Z",
        expires: "2027-03-20T10:00:00.000Z",
        scope: "identity",
      }),
      "2026-03-20T10:00:00.000Z",
      "2026-03-20T10:01:00.000Z"
    );

    const expiredCode = await expectJson(
      await worker.fetch("/auth/exchange", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "https://agentcraft.io",
        },
        body: JSON.stringify({
          code: "auth_code_expired_demo",
          client_id: registeredClient.client_id,
          client_secret: registeredClient.client_secret,
        }),
      }),
      410,
      "auth/exchange expired code"
    );
    assert.equal(expiredCode.error, "auth_code_expired");

    const blockedOriginCode = await expectJson(
      await worker.fetch("/auth/authorize", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          token: tokenA,
          client_id: registeredClient.client_id,
          redirect_uri: "https://agentcraft.io/callback",
          scope: "identity",
        }),
      }),
      201,
      "auth/authorize blocked origin code"
    );

    const blockedOrigin = await expectJson(
      await worker.fetch("/auth/exchange", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "https://evil.example",
        },
        body: JSON.stringify({
          code: blockedOriginCode.code,
          client_id: registeredClient.client_id,
          client_secret: registeredClient.client_secret,
        }),
      }),
      403,
      "auth/exchange invalid origin"
    );
    assert.equal(blockedOrigin.error, "origin_not_allowed");

    const authCodeReputation = await expectJson(
      await worker.fetch("/auth/authorize", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          token: tokenA,
          client_id: registeredClient.client_id,
          redirect_uri: "https://agentcraft.io/callback",
          scope: "identity+reputation",
          state: "reputation-state",
        }),
      }),
      201,
      "auth/authorize reputation"
    );

    const exchangedReputation = await expectJson(
      await worker.fetch("/auth/exchange", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "https://agentcraft.io",
        },
        body: JSON.stringify({
          code: authCodeReputation.code,
          client_id: registeredClient.client_id,
          client_secret: registeredClient.client_secret,
        }),
      }),
      200,
      "auth/exchange identity+reputation"
    );
    assert.equal(exchangedReputation.scope, "identity+reputation");
    assert.ok(exchangedReputation.reputation);
    assert.equal(exchangedReputation.reputation.overall_score, 78.5);
    assert.equal(exchangedReputation.reputation.achievements, 1);

    const quickVerify = await sdkClient.verifyQuick({
      token: tokenA,
      client_id: registeredClient.client_id,
      client_secret: registeredClient.client_secret,
      origin: "https://agentcraft.io",
    });
    assert.equal(quickVerify.valid, true);
    assert.equal(quickVerify.ail_id, "AIL-2026-00042");
    assert.ok(quickVerify.reputation);

    const quickVerifyBlocked = await expectJson(
      await worker.fetch(
        `/auth/verify-quick?client_id=${encodeURIComponent(registeredClient.client_id)}&token=${encodeURIComponent(tokenA)}`,
        {
          headers: {
            authorization: `Bearer ${registeredClient.client_secret}`,
            origin: "https://evil.example",
          },
        }
      ),
      403,
      "auth/verify-quick blocked origin"
    );
    assert.equal(quickVerifyBlocked.error, "origin_not_allowed");

    const widgetAsset = await worker.fetch("/widget.js");
    const widgetBody = await widgetAsset.text();
    assert.equal(widgetAsset.status, 200);
    assert.match(widgetAsset.headers.get("content-type") ?? "", /javascript/i);
    assert.equal(widgetAsset.headers.get("access-control-allow-origin"), "*");
    assert.match(widgetBody, /AgentIDCardWidget/);
    assert.match(widgetBody, /Verify with Agent ID Card/);

    const badgeAsset = await worker.fetch("/badge.js");
    const badgeBody = await badgeAsset.text();
    assert.equal(badgeAsset.status, 200);
    assert.match(badgeAsset.headers.get("content-type") ?? "", /javascript/i);
    assert.equal(badgeAsset.headers.get("access-control-allow-origin"), "*");
    assert.match(badgeBody, /AgentIDCardBadge/);
    assert.match(badgeBody, /Verified Agent/);

    console.log("Verify Widget auth E2E passed");
  } finally {
    globalThis.fetch = originalFetch;
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
