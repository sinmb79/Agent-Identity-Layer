import { canonicalJson, sha256hex } from "./crypto.mjs";

const MANIFEST_TYPE = "AIL.AccountabilityManifest.v1";
const AGENT_CARD_PROTOCOL = "agentidcard.agent-card.v1";
const DEFAULT_BASE_URL = "https://api.agentidcard.org";

function parseJson(text, fallback = null) {
  try {
    return JSON.parse(text);
  } catch {
    return fallback;
  }
}

function cleanString(value, fallback = null) {
  if (typeof value !== "string") return fallback;
  const trimmed = value.trim();
  return trimmed || fallback;
}

function cleanArray(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value
    .filter((item) => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean))];
}

function cleanObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function normalizeParty(input, fallback = {}) {
  const party = cleanObject(input);
  return {
    name: cleanString(party.name, fallback.name ?? null),
    type: cleanString(party.type, fallback.type ?? null),
    contact: cleanString(party.contact, fallback.contact ?? null),
    url: cleanString(party.url, fallback.url ?? null),
    wallet: cleanString(party.wallet, fallback.wallet ?? null),
    owner_key_id: cleanString(party.owner_key_id, fallback.owner_key_id ?? null),
  };
}

function trimNulls(value) {
  if (Array.isArray(value)) {
    return value.map(trimNulls);
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, entry]) => entry !== undefined)
        .map(([key, entry]) => [key, entry === null ? null : trimNulls(entry)])
    );
  }
  return value;
}

function profileUrl(baseUrl, ailId) {
  return `${baseUrl.replace(/\/$/, "")}/agent/${encodeURIComponent(ailId)}`;
}

function manifestUrl(baseUrl, ailId) {
  return `${profileUrl(baseUrl, ailId)}/manifest.json`;
}

function cardUrl(baseUrl, ailId) {
  return `${profileUrl(baseUrl, ailId)}/card.json`;
}

export function responsibleContact(manifest) {
  return (
    manifest?.responsible_parties?.operator?.contact ||
    manifest?.responsible_parties?.creator?.contact ||
    manifest?.responsible_parties?.owner?.contact ||
    null
  );
}

export async function buildAccountabilityManifest({
  ail_id,
  display_name,
  role,
  provider = null,
  model = null,
  owner_key_id,
  owner_org = null,
  scope,
  scope_hash,
  behavior_fingerprint,
  issued_at,
  expires_at,
  issuer = "agentidcard.org",
  accountability = {},
}) {
  const input = cleanObject(accountability);
  const origin = cleanObject(input.origin ?? input.provenance);
  const purpose = cleanObject(input.purpose);
  const capabilities = cleanObject(input.capabilities);
  const ownerName = owner_org || owner_key_id || "Independent";

  const manifestBody = trimNulls({
    type: MANIFEST_TYPE,
    subject: {
      ail_id,
      display_name,
      role,
      provider,
      model,
    },
    responsible_parties: {
      creator: normalizeParty(input.creator, {
        name: ownerName,
        type: owner_org ? "organization" : "owner",
      }),
      owner: normalizeParty(input.owner, {
        name: ownerName,
        type: owner_org ? "organization" : "owner",
        owner_key_id,
      }),
      operator: normalizeParty(input.operator, {
        name: ownerName,
        type: owner_org ? "organization" : "owner",
      }),
      issuer: {
        name: "Agent ID Card",
        type: "identity_issuer",
        url: "https://agentidcard.org",
        issuer,
      },
    },
    provenance: {
      origin_domain: cleanString(origin.domain ?? origin.origin_domain),
      deployment_url: cleanString(origin.deployment_url),
      repository_url: cleanString(origin.repository_url ?? origin.repo_url),
      commit_hash: cleanString(origin.commit_hash),
      build_timestamp: cleanString(origin.build_timestamp),
      runtime: cleanString(origin.runtime),
      jurisdiction: cleanString(origin.jurisdiction),
    },
    purpose: {
      declared: cleanString(purpose.declared ?? purpose.declared_purpose),
      intended_users: cleanArray(purpose.intended_users),
      prohibited_uses: cleanArray(purpose.prohibited_uses),
      risk_class: cleanString(purpose.risk_class, "unspecified"),
    },
    capabilities: {
      role,
      provider,
      model,
      tools: cleanArray(capabilities.tools),
      external_endpoints: cleanArray(capabilities.external_endpoints),
      data_access: cleanArray(capabilities.data_access),
      scope,
      human_approval_required: Boolean(scope?.approval_policy),
    },
    lifecycle: {
      created_at: issued_at,
      activated_at: issued_at,
      last_verified_at: issued_at,
      expires_at,
      status: "active",
    },
    hashes: {
      scope_hash,
      behavior_fingerprint,
    },
  });

  const manifest_hash = `sha256:${await sha256hex(canonicalJson(manifestBody))}`;
  return {
    ...manifestBody,
    manifest_hash,
  };
}

export function buildAgentCard(manifest, { baseUrl = DEFAULT_BASE_URL } = {}) {
  const subject = manifest.subject;
  return {
    protocol: AGENT_CARD_PROTOCOL,
    schema_version: "1.0",
    agent_id: subject.ail_id,
    name: subject.display_name,
    description: manifest.purpose.declared,
    profile_url: profileUrl(baseUrl, subject.ail_id),
    manifest_url: manifestUrl(baseUrl, subject.ail_id),
    provider: {
      name: subject.provider,
      model: subject.model,
    },
    capabilities: {
      role: subject.role,
      tools: manifest.capabilities.tools,
      external_endpoints: manifest.capabilities.external_endpoints,
      scope: manifest.capabilities.scope,
      human_approval_required: manifest.capabilities.human_approval_required,
    },
    accountability: {
      creator: manifest.responsible_parties.creator,
      operator: manifest.responsible_parties.operator,
      owner: manifest.responsible_parties.owner,
      responsible_contact: responsibleContact(manifest),
      risk_class: manifest.purpose.risk_class,
      manifest_hash: manifest.manifest_hash,
    },
    authentication_schemes: [
      {
        type: "jwt",
        jwks_uri: `${baseUrl.replace(/\/$/, "")}/keys`,
      },
      {
        type: "oauth_style_authorization_code",
        authorization_endpoint: `${baseUrl.replace(/\/$/, "")}/auth/verify`,
        token_endpoint: `${baseUrl.replace(/\/$/, "")}/auth/exchange`,
      },
    ],
  };
}

export function summarizeAccountability(manifest, { baseUrl = DEFAULT_BASE_URL } = {}) {
  return {
    manifest_hash: manifest.manifest_hash,
    manifest_url: manifestUrl(baseUrl, manifest.subject.ail_id),
    card_url: cardUrl(baseUrl, manifest.subject.ail_id),
    creator: manifest.responsible_parties.creator,
    operator: manifest.responsible_parties.operator,
    owner: manifest.responsible_parties.owner,
    responsible_contact: responsibleContact(manifest),
    purpose: manifest.purpose.declared,
    risk_class: manifest.purpose.risk_class,
  };
}

export async function saveAgentManifest(db, { manifest, card }) {
  const now = new Date().toISOString();
  await db.prepare(`
    INSERT INTO agent_manifests (
      ail_id, manifest_hash, manifest_json, card_json, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(ail_id) DO UPDATE SET
      manifest_hash = excluded.manifest_hash,
      manifest_json = excluded.manifest_json,
      card_json = excluded.card_json,
      updated_at = excluded.updated_at
  `).bind(
    manifest.subject.ail_id,
    manifest.manifest_hash,
    JSON.stringify(manifest),
    JSON.stringify(card),
    now,
    now
  ).run();
}

async function loadAgentForManifest(db, ailId) {
  return db.prepare(`
    SELECT ail_id, display_name, role, provider, model,
           owner_key_id, owner_org, scope_json, scope_hash,
           behavior_fingerprint, issued_at, expires_at
    FROM agents
    WHERE ail_id = ?
  `).bind(ailId).first();
}

export async function loadAccountabilityManifest(db, ailId) {
  const row = await db.prepare(`
    SELECT manifest_json
    FROM agent_manifests
    WHERE ail_id = ?
  `).bind(ailId).first();

  if (row?.manifest_json) {
    return parseJson(row.manifest_json, null);
  }

  const agent = await loadAgentForManifest(db, ailId);
  if (!agent) return null;

  return buildAccountabilityManifest({
    ail_id: agent.ail_id,
    display_name: agent.display_name,
    role: agent.role,
    provider: agent.provider,
    model: agent.model,
    owner_key_id: agent.owner_key_id,
    owner_org: agent.owner_org,
    scope: parseJson(agent.scope_json, {}),
    scope_hash: agent.scope_hash,
    behavior_fingerprint: agent.behavior_fingerprint,
    issued_at: agent.issued_at,
    expires_at: agent.expires_at,
    accountability: {},
  });
}

export async function loadAgentCard(db, ailId, { baseUrl = DEFAULT_BASE_URL } = {}) {
  const row = await db.prepare(`
    SELECT card_json
    FROM agent_manifests
    WHERE ail_id = ?
  `).bind(ailId).first();

  if (row?.card_json) {
    return parseJson(row.card_json, null);
  }

  const manifest = await loadAccountabilityManifest(db, ailId);
  return manifest ? buildAgentCard(manifest, { baseUrl }) : null;
}
