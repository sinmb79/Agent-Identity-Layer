import { mkdirSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Production: AIL_DB_PATH env var (e.g. /data/ail.db on a mounted volume)
// Development: data/ail.db relative to project root
const dbFile = process.env.AIL_DB_PATH
  ?? path.resolve(__dirname, "../../data/ail.db");
const dataDir = path.dirname(dbFile);

let db;

export function getDb() {
  if (!db) {
    if (!existsSync(dataDir)) mkdirSync(dataDir, { recursive: true });
    db = new DatabaseSync(dbFile);
    db.exec("PRAGMA journal_mode = WAL");
    db.exec("PRAGMA foreign_keys = ON");
    initSchema(db);
  }
  return db;
}

function initSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS owners (
      id             TEXT PRIMARY KEY,
      email          TEXT UNIQUE NOT NULL,
      email_verified INTEGER NOT NULL DEFAULT 0,
      org            TEXT,
      public_key_jwk TEXT NOT NULL,
      created_at     TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS owner_otps (
      id         TEXT PRIMARY KEY,
      owner_id   TEXT NOT NULL REFERENCES owners(id),
      otp        TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      used       INTEGER NOT NULL DEFAULT 0
    );

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
      revoked_at           TEXT
    );

    CREATE TABLE IF NOT EXISTS ail_sequence (
      year     INTEGER PRIMARY KEY,
      next_seq INTEGER NOT NULL DEFAULT 1
    );
  `);
}
