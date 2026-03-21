import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { unstable_dev } from "wrangler";

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

async function main() {
  const htmlPath = path.resolve("server", "register.html");
  const html = fs.readFileSync(htmlPath, "utf8");

  assert.match(
    html,
    /Save your AIL ID and JWT credential now/i,
    "register result should warn users to save the AIL ID and JWT credential immediately"
  );

  assert.match(
    html,
    /copyText\('res-ail-id'\)/,
    "register result should allow copying the AIL ID directly"
  );

  assert.match(
    html,
    /localStorage\.setItem\(SESSION_STORAGE_KEY,/,
    "register page should persist authenticated owner sessions in localStorage"
  );

  assert.match(
    html,
    /restorePersistedSession\(\);/,
    "register page should attempt to restore the persisted owner session on load"
  );

  const persistRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ail-register-session-"));
  let worker;
  let sqlite;

  try {
    worker = await unstable_dev("workers/index.mjs", {
      config: "wrangler.toml",
      persistTo: persistRoot,
      logLevel: "error",
      experimental: {
        disableExperimentalWarning: true,
      },
    });

    await expectJson(await worker.fetch("/health"), 200, "health");

    const dbPath = findFirstSqliteFile(persistRoot);
    sqlite = new DatabaseSync(dbPath);
    sqlite.exec("PRAGMA foreign_keys = ON");

    const now = new Date("2026-03-21T10:00:00.000Z");
    const activeExpiry = new Date(now.getTime() + (24 * 60 * 60 * 1000)).toISOString();
    const expiredAt = new Date(now.getTime() - (60 * 1000)).toISOString();

    sqlite.prepare(`
      INSERT INTO owners (id, email, email_verified, org, public_key_jwk, created_at)
      VALUES (?, ?, 1, ?, ?, ?)
    `).run(
      "owk_restore_owner",
      "restore@example.com",
      "restore_labs",
      JSON.stringify({ kty: "EC" }),
      now.toISOString()
    );

    sqlite.prepare(`
      INSERT INTO owner_sessions (token, owner_id, created_at, expires_at)
      VALUES (?, ?, ?, ?)
    `).run(
      "active-session-token",
      "owk_restore_owner",
      now.toISOString(),
      activeExpiry
    );

    sqlite.prepare(`
      INSERT INTO owner_sessions (token, owner_id, created_at, expires_at)
      VALUES (?, ?, ?, ?)
    `).run(
      "expired-session-token",
      "owk_restore_owner",
      now.toISOString(),
      expiredAt
    );

    sqlite.prepare(`
      INSERT INTO agents (
        ail_id, display_name, role, provider, model,
        owner_key_id, owner_org, scope_json, scope_hash,
        signal_glyph_seed, behavior_fingerprint,
        credential_token, issued_at, expires_at, revoked
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
    `).run(
      "AIL-2026-00077",
      "RestoreAgent",
      "assistant",
      "openai",
      "gpt-5.4",
      "owk_restore_owner",
      "restore_labs",
      JSON.stringify({ network: "read-only" }),
      "sha256:scope",
      "seed",
      "sha256:fingerprint",
      "jwt-token",
      now.toISOString(),
      activeExpiry
    );

    const activeSession = await expectJson(
      await worker.fetch("/owners/session", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ session_token: "active-session-token" }),
      }),
      200,
      "owners/session active"
    );

    assert.equal(activeSession.authenticated, true);
    assert.equal(activeSession.owner.owner_key_id, "owk_restore_owner");
    assert.equal(activeSession.agents.length, 1);
    assert.equal(activeSession.agents[0].ail_id, "AIL-2026-00077");

    const expiredSession = await expectJson(
      await worker.fetch("/owners/session", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ session_token: "expired-session-token" }),
      }),
      401,
      "owners/session expired"
    );

    assert.equal(expiredSession.error, "session_expired");

    console.log("Register session persistence test passed");
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
