# Threat Model

## Goal

Agent Identity Layer does not try to solve all trust problems. It aims to reduce ambiguity around agent provenance, delegation, scope, and verification so downstream systems can make safer decisions.

## Assets worth protecting

- Human trust in agent actions
- Accurate attribution of who launched what
- Scope boundaries for files, tools, repos, and network access
- Approval boundaries for destructive or external actions
- Auditability of delegation chains

## Primary threats

### 1. Identity spoofing

An agent claims to be a different role, owner, or provider than it really is.

Impact:
- humans trust the wrong actor
- tools grant excessive access
- audit trails become misleading

Mitigations:
- stable local agent identifiers
- runtime-attached metadata instead of prompt-only claims
- explicit verification strength field
- future support for signatures or attestations

### 2. Delegation laundering

A child agent hides or truncates the parent chain to avoid scrutiny.

Impact:
- responsibility becomes unclear
- policy based on delegation depth can be bypassed
- humans cannot tell who initiated risky work

Mitigations:
- first-class `delegation` object
- `chain_depth` field
- `delegated_by` run reference
- policy engines should reject missing chain metadata in delegated contexts

### 3. Scope inflation

An agent presents itself as having broader permissions than it actually has, or consumers assume too much from role/title alone.

Impact:
- accidental over-trust
- policy bypass
- unsafe execution

Mitigations:
- represent scope explicitly, not implicitly through role names
- human-readable approval policy summary
- separate role identity from scope claims
- receivers should prefer runtime-enforced scope over self-description

### 4. Verification confusion

Systems or humans mistake descriptive metadata for cryptographic proof.

Impact:
- false confidence
- unsafe automation
- compliance theater

Mitigations:
- coarse verification strength labels
- explicit `signed` boolean
- clear docs that v0 is not proof by default
- UI should visibly distinguish asserted vs signed identities

### 5. Secret leakage inside identity metadata

Developers stuff API keys, emails, raw tokens, or sensitive user data into identity fields.

Impact:
- secret exposure in logs and traces
- privacy violations
- broader blast radius during debugging

Mitigations:
- prohibit raw secrets in envelope fields
- keep extensions privacy-conscious
- prefer references over raw sensitive payloads
- add redaction guidance in future versions

### 6. Replay and stale-context misuse

A previously valid identity envelope is replayed in a different run or environment.

Impact:
- stale approvals reused incorrectly
- misleading attribution
- context mismatch

Mitigations:
- include `run_id`, `session_id`, and timestamp-like runtime context
- bind approvals to task references where possible
- future work: expirations and signed freshness claims

## Trust boundaries

Agent Identity Layer sits between:

- the runtime that launches agents
- the tools that receive agent requests
- the humans auditing or approving work

It improves communication across those boundaries but does not replace:

- authentication systems
- authorization systems
- sandboxing
- logging and monitoring
- human review

## Assumptions

- Many adopters will start in local or single-team environments
- v0 deployments may be unsigned and runtime-asserted only
- downstream consumers can read structured metadata
- policy enforcement may be partial at first

## What success looks like

A receiver can safely say:

- who the agent appears to be
- who launched it
- what its declared scope is
- how strong the evidence is
- whether a human approval boundary should apply

That is enough to make multi-agent systems more legible even before stronger security primitives arrive.
