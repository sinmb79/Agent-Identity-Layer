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
    db.prepare(`
      CREATE TABLE IF NOT EXISTS registered_sources (
        id                  TEXT PRIMARY KEY,
        name                TEXT UNIQUE NOT NULL,
        contract_address    TEXT,
        chain_id            INTEGER,
        admin_wallet        TEXT NOT NULL,
        verification_method TEXT NOT NULL DEFAULT 'signature',
        public_key_jwk      TEXT NOT NULL,
        status              TEXT NOT NULL DEFAULT 'pending',
        registered_at       TEXT NOT NULL,
        approved_at         TEXT
      )
    `),
    db.prepare(`
      CREATE TABLE IF NOT EXISTS reputation_records (
        id                TEXT PRIMARY KEY,
        agent_id          TEXT NOT NULL REFERENCES agents(ail_id),
        source_id         TEXT NOT NULL REFERENCES registered_sources(id),
        season            INTEGER,
        epoch             INTEGER,
        metrics_json      TEXT NOT NULL,
        merkle_proof      TEXT,
        source_signature  TEXT NOT NULL,
        verified          INTEGER NOT NULL DEFAULT 0,
        submitted_at      TEXT NOT NULL
      )
    `),
    db.prepare(`
      CREATE TABLE IF NOT EXISTS composite_scores (
        agent_id    TEXT NOT NULL REFERENCES agents(ail_id),
        dimension   TEXT NOT NULL,
        score       REAL NOT NULL,
        data_points INTEGER NOT NULL DEFAULT 0,
        updated_at  TEXT NOT NULL,
        PRIMARY KEY (agent_id, dimension)
      )
    `),
    db.prepare(`
      CREATE TABLE IF NOT EXISTS achievements (
        id            TEXT PRIMARY KEY,
        agent_id      TEXT NOT NULL REFERENCES agents(ail_id),
        badge_id      TEXT NOT NULL,
        source_id     TEXT NOT NULL REFERENCES registered_sources(id),
        earned_at     TEXT NOT NULL,
        nft_token_id  TEXT,
        merkle_proof  TEXT,
        metadata_json TEXT,
        UNIQUE(agent_id, badge_id)
      )
    `),
    db.prepare(`
      CREATE TABLE IF NOT EXISTS performance_history (
        id           TEXT PRIMARY KEY,
        agent_id     TEXT NOT NULL REFERENCES agents(ail_id),
        source_id    TEXT NOT NULL REFERENCES registered_sources(id),
        season       INTEGER,
        epoch        INTEGER NOT NULL,
        metrics_json TEXT NOT NULL,
        scores_json  TEXT NOT NULL,
        recorded_at  TEXT NOT NULL,
        UNIQUE(agent_id, source_id, season, epoch)
      )
    `),
    db.prepare(`
      CREATE INDEX IF NOT EXISTS idx_reputation_agent
      ON reputation_records(agent_id)
    `),
    db.prepare(`
      CREATE INDEX IF NOT EXISTS idx_reputation_source
      ON reputation_records(source_id)
    `),
    db.prepare(`
      CREATE INDEX IF NOT EXISTS idx_scores_agent
      ON composite_scores(agent_id)
    `),
    db.prepare(`
      CREATE INDEX IF NOT EXISTS idx_achievements_agent
      ON achievements(agent_id)
    `),
    db.prepare(`
      CREATE INDEX IF NOT EXISTS idx_history_agent
      ON performance_history(agent_id)
    `),
  ]);

  _initialized = true;
}
