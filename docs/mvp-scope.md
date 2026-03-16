# MVP Scope

## MVP goal

Publish the smallest credible version of Agent Identity Layer that lets builders understand the concept, critique the boundaries, and experiment with a minimal schema.

## What v0 should include

### 1) Clear public framing

Deliver:
- README
- one-page thesis
- terminology notes
- explicit non-goals

Why:
Without crisp framing, the project will be misunderstood as generic AI safety branding or a replacement for authentication systems.

### 2) Minimal identity envelope spec

Deliver:
- a markdown spec for `agent identity envelope v0`
- a JSON schema draft
- 2–3 example payloads

Minimum fields:
- `agent_id`
- `session_id`
- `kind` (primary, delegated, tool-runner, etc.)
- `delegated_by`
- `runtime`
- `scope`
- `approval_policy`
- `created_at`
- `evidence`

### 3) Delegation model

Deliver:
- one short document explaining parent/child delegation
- examples showing limited scope inheritance

Why:
Delegation is one of the strongest reasons this category matters. If the repo ignores it, it loses distinctiveness.

### 4) Trust and verification model

Deliver:
- a short note defining verification strengths such as `self-asserted`, `runtime-asserted`, and `cryptographically-attested`

Why:
The project should avoid pretending all identity claims are equally strong.

### 5) Basic threat model

Deliver:
- spoofed identity claims
- over-broad scope claims
- missing audit lineage
- misleading UX around approval state

Why:
This signals seriousness without overbuilding.

## What v0 should NOT include

- a token or blockchain design
- a heavy PKI architecture
- enterprise IAM integration matrix
- production SDKs in multiple languages
- promises of universal interoperability
- biometric or human identity features
- legal/compliance claims you cannot support

## Success criteria for first public release

- an informed reader understands the problem in under 3 minutes
- the repo has a stable vocabulary
- the schema is small enough to implement quickly
- examples demonstrate real agent workflows
- the non-goals reduce confusion

## Suggested milestone sequence

### Milestone 0 — public framing
- README
- thesis one-pager
- MVP scope

### Milestone 1 — spec skeleton
- terminology
- identity envelope markdown spec
- example payloads

### Milestone 2 — trust model
- verification strengths
- delegation chain examples
- threat model

### Milestone 3 — reference integrations
- one runtime adapter example
- one policy-check example
- one UI display example

## Opinionated recommendation

Do not chase completeness yet. A narrow, sharp repo with a memorable thesis will outperform a bloated pseudo-standard.
