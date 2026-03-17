# Agent Identity Envelope v1

Status: Draft v1 — Phase 1

## Overview

v1 introduces the **22B Labs Signed Credential** — an AI agent identity certificate issued by 22B Labs acting as a trusted registry.

Think of it as a **resident registration card for AI agents**: a government-issued document that proves who the agent is, who owns it, and what it is allowed to do — verifiable by any third party.

v0 was self-asserted, documentation-first metadata. v1 upgrades the envelope to `cryptographically_signed` by:

1. Binding an owner to the agent via keypair delegation
2. Issuing a globally unique `ail_id` (format: `AIL-YYYY-NNNNN`)
3. Attaching a visual identity (`signal_glyph`) derived deterministically from registration data
4. Computing a `behavior_fingerprint` from the agent's declared capabilities
5. Issuing a signed JWT that any third party can verify against the 22B Labs public key

v1 is **backward-compatible** with v0 consumers. A v0 receiver can ignore v1-only fields.

---

## What's new in v1

| Feature | v0 | v1 |
|---------|----|----|
| Signature | None | JWT signed by 22B Labs |
| Registry ID | None | `AIL-YYYY-NNNNN` |
| Owner binding | Self-declared string | Cryptographically bound via owner keypair |
| Visual identity | None | `signal_glyph` |
| Behavior hash | None | `behavior_fingerprint` |
| Third-party verification | Not possible | `POST /verify` API |

---

## Top-level shape

```json
{
  "version": "ail.v1",
  "ail_id": "AIL-2026-00001",
  "credential": {},
  "agent": {},
  "owner": {},
  "scope": {},
  "signal_glyph": {},
  "behavior_fingerprint": {},
  "delegation": {},
  "runtime": {},
  "verification": {},
  "extensions": {}
}
```

---

## Field definitions

### `version`

String. Required.

Value for v1:

```json
"ail.v1"
```

### `ail_id`

String or null. Required.

Format: `AIL-YYYY-NNNNN`

- `YYYY` — four-digit issuance year
- `NNNNN` — zero-padded sequential registration number assigned by 22B Labs

Examples:

```json
"AIL-2026-00001"
"AIL-2026-00042"
```

Set to `null` for local, unregistered agents that have not obtained a credential from 22B Labs.

### `credential`

Object or null. Required for registered agents.

Wraps the JWT issued by 22B Labs.

```json
{
  "type": "AIL.SignedCredential.v1",
  "issuer": "22blabs.ai",
  "issuer_key_id": "22blabs-master-2026",
  "issued_at": "2026-03-17T00:00:00Z",
  "expires_at": "2027-03-17T00:00:00Z",
  "token": "<base64url-header>.<base64url-payload>.<base64url-signature>"
}
```

Fields:

- `type` — credential type identifier, always `AIL.SignedCredential.v1` for this version
- `issuer` — the issuing authority domain
- `issuer_key_id` — identifier for the 22B Labs signing key used (for key rotation)
- `issued_at` — ISO 8601 issuance timestamp
- `expires_at` — ISO 8601 expiration timestamp
- `token` — the compact JWT string (header.payload.signature, base64url encoded)

Set to `null` for unregistered agents.

### JWT structure

The `credential.token` is a standard compact JWT with three base64url-encoded parts.

**Header:**

```json
{
  "alg": "ES256",
  "typ": "JWT",
  "kid": "22blabs-master-2026"
}
```

**Payload:**

```json
{
  "iss": "22blabs.ai",
  "sub": "AIL-2026-00001",
  "iat": 1742169600,
  "exp": 1773705600,
  "ail_id": "AIL-2026-00001",
  "display_name": "ClaudeCoder",
  "role": "review_engineer",
  "owner_key_id": "owk_22blabs_example_001",
  "owner_org": "22b_labs",
  "scope_hash": "sha256:<hash-of-scope-object-at-registration>",
  "signal_glyph_seed": "AIL-2026-00001:ClaudeCoder:owk_22blabs_example_001",
  "behavior_fingerprint": "sha256:<hash>"
}
```

Payload field definitions:

- `iss` — issuer; must be `22blabs.ai` for 22B Labs credentials
- `sub` — subject; the `ail_id` string
- `iat` — issued-at as Unix timestamp (seconds)
- `exp` — expiration as Unix timestamp (seconds)
- `ail_id` — the assigned registration ID
- `display_name` — the agent's registered display name
- `role` — the agent's declared role at registration time
- `owner_key_id` — the owner's key identifier at 22B Labs
- `owner_org` — the owner organization identifier
- `scope_hash` — SHA-256 of the canonical JSON of the `scope` object at registration
- `signal_glyph_seed` — deterministic seed for visual identity generation
- `behavior_fingerprint` — SHA-256 hash of declared capability inputs

**Signature:**

EC P-256 signature over `base64url(header).base64url(payload)`, using the 22B Labs master signing key identified by `issuer_key_id`.

### `agent`

Required object. Same structure as v0, with `owner` promoted to top-level.

```json
{
  "id": "agent_claudecoder_01",
  "display_name": "ClaudeCoder",
  "role": "review_engineer",
  "provider": "anthropic",
  "model": "claude-sonnet-4-6",
  "runtime": "claude_code"
}
```

Fields:

- `id` — stable local agent identifier
- `display_name` — human-readable name; must match `credential` payload if registered
- `role` — functional role; must match `credential` payload if registered
- `provider` — model or execution provider namespace
- `model` — specific model identifier when known (new in v1)
- `runtime` — execution harness or runtime type

### `owner`

Object or null. Required for registered agents. Promoted to top-level from v0's `agent.owner`.

```json
{
  "key_id": "owk_22blabs_example_001",
  "org": "22b_labs",
  "email_hash": "sha256:placeholder-hash-of-owner-email"
}
```

Fields:

- `key_id` — the owner's key ID at 22B Labs registry; matches `owner_key_id` in JWT payload
- `org` — organization identifier
- `email_hash` — SHA-256 hash of the owner's registered email (not raw email — privacy-preserving)

Set to `null` for unregistered agents.

### `scope`

Required. Same structure as v0.

```json
{
  "workspace": ["/workspace/example"],
  "repos": ["Agent-Identity-Layer"],
  "network": "restricted",
  "secrets": "none",
  "write_access": false,
  "approval_policy": {
    "irreversible_actions": "not_allowed",
    "external_posting": "not_allowed",
    "destructive_file_ops": "human_required"
  }
}
```

See v0 spec for full field definitions.

### `signal_glyph`

Object or null. Required for registered agents.

A deterministic visual identity derived from registration data. The glyph uniquely identifies the agent across surfaces.

```json
{
  "seed": "AIL-2026-00001:ClaudeCoder:owk_22blabs_example_001",
  "algorithm": "sha256-visual-v1",
  "version": "glyph.v1"
}
```

Fields:

- `seed` — deterministic seed string used to generate the glyph
- `algorithm` — rendering algorithm identifier
- `version` — glyph spec version

**Seed construction:**

```
seed = "{ail_id}:{display_name}:{owner_key_id}"
```

The seed is committed inside the JWT payload as `signal_glyph_seed`. The glyph cannot be forged without a valid credential.

Set to `null` for unregistered agents.

### `behavior_fingerprint`

Object or null. Required for registered agents.

A hash capturing the agent's declared behavior profile at registration time. Enables downstream detection of runtime drift from declared behavior.

```json
{
  "hash": "sha256:placeholder-hash",
  "algorithm": "sha256",
  "inputs": ["role", "scope.network", "scope.secrets", "scope.write_access", "provider"]
}
```

Fields:

- `hash` — the computed SHA-256 hash
- `algorithm` — hashing algorithm (currently always `sha256`)
- `inputs` — list of field paths used to compute the hash

**Computation:**

```
hash = SHA-256(JSON.stringify({
  role: agent.role,
  network: scope.network,
  secrets: scope.secrets,
  write_access: scope.write_access,
  provider: agent.provider
}))
```

Keys must be sorted alphabetically before hashing to ensure canonical output.

Set to `null` for unregistered agents.

### `delegation`

Required. Same structure as v0.

```json
{
  "mode": "delegated",
  "delegated_by": {
    "agent_id": "agent_cto_01",
    "run_id": "run_cto_20260317_0900"
  },
  "approved_by": {
    "type": "human",
    "id": "boss"
  },
  "chain_depth": 1,
  "task_ref": "issue:AIL-Phase1"
}
```

### `runtime`

Required. Same structure as v0.

```json
{
  "session_id": "sess_20260317_main",
  "run_id": "run_claudecoder_20260317_0900",
  "surface": "cli",
  "host": "local-host-example",
  "cwd": "/workspace/agent-identity-layer",
  "time": "2026-03-17T09:00:00+09:00"
}
```

### `verification`

Required. Enhanced from v0.

**For registered agents:**

```json
{
  "strength": "cryptographically_signed",
  "issuer": "22blabs.ai",
  "issuer_key_id": "22blabs-master-2026",
  "token_type": "JWT",
  "signed": true,
  "verify_url": "https://22blabs.ai/api/verify",
  "evidence": [
    "22blabs_registry",
    "owner_key_delegation",
    "jwt_signature"
  ],
  "attestation_ref": "ail_id:AIL-2026-00001"
}
```

**For unregistered agents** (v0-compatible):

```json
{
  "strength": "local_runtime_asserted",
  "signed": false,
  "evidence": ["runtime_session_binding"],
  "attestation_ref": null
}
```

New fields vs v0:

- `issuer` — who issued the credential
- `issuer_key_id` — which public key to use for verification
- `token_type` — `JWT`
- `verify_url` — endpoint for third-party verification

### `extensions`

Optional. Same as v0.

---

## Minimal validation rules

### All v1 envelopes

- `version` is `"ail.v1"`
- `agent.id`, `agent.display_name`, `agent.role` exist and are strings
- `delegation.mode` exists
- `scope.approval_policy` exists
- `runtime.run_id` or `runtime.session_id` exists
- `verification.strength` exists

### Registered agents (when `ail_id` is non-null)

Additional requirements:

- `ail_id` matches format `AIL-\d{4}-\d{5}`
- `credential` is a non-null object with `token`, `issuer`, `issued_at`, `expires_at`
- `owner.key_id` exists
- `signal_glyph.seed` exists
- `behavior_fingerprint.hash` starts with `sha256:`
- `verification.signed` is `true`

---

## Third-party verification flow

Any receiver holding a v1 registered credential can verify it:

```
POST https://22blabs.ai/api/verify
Content-Type: application/json

{ "token": "<credential.token>" }
```

Response:

```json
{
  "valid": true,
  "ail_id": "AIL-2026-00001",
  "display_name": "ClaudeCoder",
  "owner_org": "22b_labs",
  "role": "review_engineer",
  "issued": "2026-03-17T00:00:00Z",
  "expires": "2027-03-17T00:00:00Z",
  "revoked": false
}
```

Alternatively, receivers can verify offline using the 22B Labs public key from:

```
GET https://22blabs.ai/api/keys/22blabs-master-2026
```

---

## Migration from v0

A v0 envelope can be upgraded to **unregistered v1** by:

1. Change `version` from `"ail.v0"` to `"ail.v1"`
2. Set `ail_id: null`
3. Set `credential: null`
4. Promote `agent.owner` → top-level `owner` (or set `owner: null`)
5. Set `signal_glyph: null`
6. Set `behavior_fingerprint: null`

To obtain a signed credential and register the agent, proceed to Phase 2 (issuance system).

---

## Recommended next steps (Phase 2)

- Owner registration API: email/OAuth → keypair issuance
- Agent registration API: owner key signature → credential issuance
- 22B Labs master key management and rotation
- DB schema: `owners`, `agents`, `credentials`, `revocations`
- Issuance numbering: `AIL-YYYY-NNNNN` sequential counter
