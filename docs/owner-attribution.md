# Owner Attribution Mechanism

## Purpose

This document defines how 22B Labs binds an **owner** to every registered AI agent credential.

The core guarantee: any agent holding an `AIL-YYYY-NNNNN` credential can be traced back to a human or organization who accepted responsibility for it — without requiring the agent to be truthful about its own origins.

---

## Problem

When an AI agent takes an action, the question "who is responsible?" is often unanswerable:

- The agent may self-declare an owner, but nothing enforces this claim.
- A rogue agent can claim any owner it wants.
- Even a well-intentioned agent may have unclear provenance in multi-agent chains.

A credential system without owner binding is just a naming convention.

---

## Solution: keypair delegation

22B Labs uses a two-layer keypair model:

1. **Owner keypair** — issued to a human or organization after identity verification
2. **22B Labs master keypair** — used to issue and sign agent credentials

The critical property: **a valid agent credential can only be issued if the owner signed the registration request**. The agent cannot register itself without the owner's private key.

```
Human/Org  ──[1. authenticate]──►  22B Labs Registry
           ◄──[2. issue keypair]──

Owner      ──[3. sign agent registration]──►  22B Labs Registry
           ◄──[4. issue signed JWT credential]──
```

---

## Step-by-step flow

### Step 1: Owner registration

The owner authenticates with 22B Labs once.

**Accepted authentication methods:**
- Email verification (OTP)
- OAuth2 (GitHub, Google)

**22B Labs issues:**
- `owner_key_id` — stable identifier (e.g., `owk_22blabs_example_001`)
- EC P-256 keypair
  - Private key: returned to owner, stored by owner only
  - Public key: stored by 22B Labs registry

The owner is responsible for keeping their private key secure.

### Step 2: Agent registration request

The owner prepares an agent registration payload:

```json
{
  "display_name": "ClaudeCoder",
  "role": "review_engineer",
  "provider": "anthropic",
  "model": "claude-sonnet-4-6",
  "scope": {
    "network": "none",
    "secrets": "none",
    "write_access": false,
    "approval_policy": {
      "irreversible_actions": "not_allowed",
      "external_posting": "not_allowed",
      "destructive_file_ops": "human_required"
    }
  }
}
```

The owner signs this payload with their private key:

```
owner_signature = ES256_sign(
  private_key = owner_private_key,
  message     = SHA-256(canonical_json(registration_payload))
)
```

The signed request is submitted to:

```
POST https://22blabs.ai/api/agents/register
{
  "owner_key_id": "owk_22blabs_example_001",
  "payload": { ...registration_payload },
  "signature": "<base64url-owner-signature>"
}
```

### Step 3: 22B Labs issues the credential

22B Labs:

1. Looks up the owner public key for `owner_key_id`
2. Verifies the signature against the registration payload
3. Assigns the next sequential `ail_id`
4. Computes `signal_glyph_seed` and `behavior_fingerprint`
5. Issues a JWT credential signed with the 22B Labs master key

The owner (and no one else) can now distribute the credential to the agent.

### Step 4: Credential delivery

The owner delivers the signed JWT to the agent's runtime. **22B Labs never delivers the credential directly to the agent** — the delivery path goes through the owner, preserving the accountability chain.

---

## Why this prevents impersonation

| Attack | Why it fails |
|--------|-------------|
| Agent self-registers without an owner | No owner keypair → registration rejected |
| Agent claims a different owner | Owner signature would not verify |
| Third party registers an agent under someone else's name | Cannot sign with the victim's private key |
| Replaying an old credential | JWT `exp` enforces expiration; revocation list checked |

---

## Trust chain summary

```
22B Labs master key
  └── signs ──► agent credential JWT
                  └── binds ──► owner_key_id
                                  └── owned by ──► verified human/org
```

A third party verifying a credential can trace:

1. JWT signature → 22B Labs master key (verifiable from public key endpoint)
2. `owner_key_id` in JWT → 22B Labs registry → owner identity
3. Owner identity → accepted terms and responsibility at registration

---

## Privacy considerations

- Raw owner email is **never embedded** in the credential or envelope.
- `email_hash` (SHA-256 of email) is stored for reference but cannot be reversed.
- 22B Labs stores the owner's verified email internally and provides it only in verified third-party verification API responses.
- The owner keypair never leaves the owner's possession; 22B Labs only stores the public key.

---

## Key rotation

If an owner's private key is compromised:

1. Owner contacts 22B Labs (authenticated via backup method)
2. 22B Labs revokes all credentials signed under the old `owner_key_id`
3. A new `owner_key_id` + keypair is issued
4. Owner re-registers affected agents

Agents holding revoked credentials will fail verification:

```json
{
  "valid": false,
  "reason": "owner_key_revoked",
  "revoked_at": "2026-06-01T00:00:00Z"
}
```

---

## Relationship to v0

v0 envelopes included `agent.owner` as a self-declared string — informational only, no enforcement.

v1 replaces this with a cryptographically enforced owner binding. The `owner` field at top-level in v1 is not self-asserted: it is derived from the registration payload signed by the owner's private key and embedded in the JWT by 22B Labs.

---

## Scope of this mechanism

This mechanism solves **accountability attribution** — ensuring a responsible party exists.

It does **not** solve:
- Whether the agent's claims about its behavior are truthful at runtime
- Authorization enforcement (what the agent is actually allowed to do in the target system)
- Agent behavior monitoring or anomaly detection
- Legal liability or regulatory compliance
