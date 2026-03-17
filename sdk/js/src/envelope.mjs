/**
 * buildEnvelope — assembles a complete v1 AIL envelope from a registered credential.
 *
 * Usage:
 *   const envelope = buildEnvelope({
 *     ail_id, credential, signal_glyph, behavior_fingerprint,
 *     agent:      { id, provider, model, runtime },
 *     owner:      { key_id, org, email_hash },
 *     scope,
 *     delegation: { mode, delegated_by, approved_by, chain_depth, task_ref },
 *     runtime:    { session_id, run_id, surface, host, cwd },
 *   })
 */
export function buildEnvelope({
  ail_id,
  credential,
  signal_glyph,
  behavior_fingerprint,
  agent,
  owner = null,
  scope,
  delegation,
  runtime,
  extensions = {},
}) {
  const now = new Date().toISOString();

  return {
    version: "ail.v1",
    ail_id: ail_id ?? null,

    credential: credential ?? null,

    agent: {
      id: agent.id,
      display_name: agent.display_name ?? credential?.display_name,
      role: agent.role ?? credential?.role,
      provider: agent.provider ?? null,
      model: agent.model ?? null,
      runtime: agent.runtime ?? null,
    },

    owner: owner
      ? {
          key_id: owner.key_id,
          org: owner.org ?? null,
          email_hash: owner.email_hash ?? null,
        }
      : null,

    scope: scope ?? {
      workspace: [],
      repos: [],
      network: "restricted",
      secrets: "none",
      write_access: false,
      approval_policy: {
        irreversible_actions: "human_required",
        external_posting: "human_required",
        destructive_file_ops: "human_required",
      },
    },

    signal_glyph: signal_glyph ?? null,
    behavior_fingerprint: behavior_fingerprint ?? null,

    delegation: {
      mode: delegation?.mode ?? "direct",
      delegated_by: delegation?.delegated_by ?? null,
      approved_by: delegation?.approved_by ?? null,
      chain_depth: delegation?.chain_depth ?? 0,
      task_ref: delegation?.task_ref ?? null,
    },

    runtime: {
      session_id: runtime?.session_id ?? null,
      run_id: runtime?.run_id ?? null,
      surface: runtime?.surface ?? null,
      host: runtime?.host ?? null,
      cwd: runtime?.cwd ?? null,
      time: runtime?.time ?? now,
    },

    verification: ail_id && credential
      ? {
          strength: "cryptographically_signed",
          issuer: credential.issuer,
          issuer_key_id: credential.issuer_key_id,
          token_type: "JWT",
          signed: true,
          verify_url: `${getIssuerBase(credential.issuer)}/verify`,
          evidence: ["22blabs_registry", "owner_key_delegation", "jwt_signature"],
          attestation_ref: `ail_id:${ail_id}`,
        }
      : {
          strength: "local_runtime_asserted",
          signed: false,
          evidence: ["runtime_session_binding"],
          attestation_ref: null,
        },

    extensions,
  };
}

function getIssuerBase(issuer) {
  if (!issuer.startsWith("http")) return `https://${issuer}/api`;
  return issuer;
}
