"""
build_envelope — assembles a complete AIL v1 envelope from a registered credential.
"""

from datetime import datetime, timezone


def build_envelope(
    *,
    ail_id: str | None = None,
    credential: dict | None = None,
    signal_glyph: dict | None = None,
    behavior_fingerprint: dict | None = None,
    agent: dict,
    owner: dict | None = None,
    scope: dict | None = None,
    delegation: dict | None = None,
    runtime: dict | None = None,
    extensions: dict | None = None,
) -> dict:
    """
    Assemble a complete AIL v1 envelope.

    Args:
        ail_id:               AIL-YYYY-NNNNN (None for unregistered agents)
        credential:           credential object from registerAgent response
        signal_glyph:         signal_glyph object from registerAgent response
        behavior_fingerprint: behavior_fingerprint object from registerAgent response
        agent:                { id, display_name?, role?, provider?, model?, runtime? }
        owner:                { key_id, org?, email_hash? } or None
        scope:                scope object (uses safe defaults if not provided)
        delegation:           delegation object (uses direct/depth-0 defaults if not provided)
        runtime:              runtime context (session_id, run_id, surface, host, cwd)
        extensions:           optional free-form extensions

    Returns:
        Complete AIL v1 envelope dict.
    """
    now = datetime.now(tz=timezone.utc).isoformat()

    default_scope = {
        "workspace": [],
        "repos": [],
        "network": "restricted",
        "secrets": "none",
        "write_access": False,
        "approval_policy": {
            "irreversible_actions": "human_required",
            "external_posting": "human_required",
            "destructive_file_ops": "human_required",
        },
    }

    is_registered = bool(ail_id and credential)

    return {
        "version": "ail.v1",
        "ail_id": ail_id,
        "credential": credential,

        "agent": {
            "id": agent.get("id"),
            "display_name": agent.get("display_name") or (credential or {}).get("display_name"),
            "role": agent.get("role"),
            "provider": agent.get("provider"),
            "model": agent.get("model"),
            "runtime": agent.get("runtime"),
        },

        "owner": {
            "key_id": owner["key_id"],
            "org": owner.get("org"),
            "email_hash": owner.get("email_hash"),
        } if owner else None,

        "scope": scope or default_scope,
        "signal_glyph": signal_glyph,
        "behavior_fingerprint": behavior_fingerprint,

        "delegation": {
            "mode": (delegation or {}).get("mode", "direct"),
            "delegated_by": (delegation or {}).get("delegated_by"),
            "approved_by": (delegation or {}).get("approved_by"),
            "chain_depth": (delegation or {}).get("chain_depth", 0),
            "task_ref": (delegation or {}).get("task_ref"),
        },

        "runtime": {
            "session_id": (runtime or {}).get("session_id"),
            "run_id": (runtime or {}).get("run_id"),
            "surface": (runtime or {}).get("surface"),
            "host": (runtime or {}).get("host"),
            "cwd": (runtime or {}).get("cwd"),
            "time": (runtime or {}).get("time", now),
        },

        "verification": {
            "strength": "cryptographically_signed",
            "issuer": credential["issuer"],
            "issuer_key_id": credential["issuer_key_id"],
            "token_type": "JWT",
            "signed": True,
            "verify_url": f"https://{credential['issuer']}/api/verify",
            "evidence": ["22blabs_registry", "owner_key_delegation", "jwt_signature"],
            "attestation_ref": f"ail_id:{ail_id}",
        } if is_registered else {
            "strength": "local_runtime_asserted",
            "signed": False,
            "evidence": ["runtime_session_binding"],
            "attestation_ref": None,
        },

        "extensions": extensions or {},
    }
