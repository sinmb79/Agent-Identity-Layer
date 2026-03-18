/**
 * D1 database schema initialization for Cloudflare Workers.
 *
 * D1 is Cloudflare's serverless SQLite — async API, auto-replicated.
 * Schema init is idempotent (CREATE IF NOT EXISTS).
 */

let _initialized = false;

export async function initSchema(db) {
  if (_initialized) return;

  await db.batch([
    db.prepare(`
      CREATE TABLE IF NOT EXISTS owners (
        id             TEXT PRIMARY KEY,
        email          TEXT UNIQUE NOT NULL,
        email_verified INTEGER NOT NULL DEFAULT 0,
        org            TEXT,
        public_key_jwk TEXT NOT NULL,
        created_at     TEXT NOT NULL
      )
    `),
    db.prepare(`
      CREATE TABLE IF NOT EXISTS owner_otps (
        id         TEXT PRIMARY KEY,
        owner_id   TEXT NOT NULL REFERENCES owners(id),
        otp        TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        used       INTEGER NOT NULL DEFAULT 0
      )
    `),
    db.prepare(`
      CREATE TABLE IF NOT EXISTS agents (
        ail_id               TEXT PRIMARY KEY,
        display_name         TEXT NOT NULL,
        role                 TEXT NOT NULL,
        provider             TEXT,
        model                TEXT,
        owner_key_id         TEXT NOT NULL,
        owner_org            TEXT,
        scope_json           TEXT NOT NULL,
        scope_hash           TEXT NOT NULL,
        signal_glyph_seed    TEXT NOT NULL,
        behavior_fingerprint TEXT NOT NULL,
        credential_token     TEXT NOT NULL,
        issued_at            TEXT NOT NULL,
        expires_at           TEXT NOT NULL,
        revoked              INTEGER NOT NULL DEFAULT 0,
        revoked_at           TEXT,
        nft_image_svg        TEXT,
        nft_token_id         TEXT,
        nft_tx_hash          TEXT
      )
    `),
    db.prepare(`
      CREATE TABLE IF NOT EXISTS ail_sequence (
        year     INTEGER PRIMARY KEY,
        next_seq INTEGER NOT NULL DEFAULT 1
      )
    `),
    db.prepare(`
      CREATE TABLE IF NOT EXISTS owner_sessions (
        token      TEXT PRIMARY KEY,
        owner_id   TEXT NOT NULL REFERENCES owners(id),
        created_at TEXT NOT NULL,
        expires_at TEXT NOT NULL
      )
    `),
  ]);

  _initialized = true;
}
