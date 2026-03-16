# Suggested Repository Structure

```text
Agent-Identity-Layer/
├─ README.md
├─ LICENSE
├─ CONTRIBUTING.md
├─ CODE_OF_CONDUCT.md
├─ docs/
│  ├─ thesis-one-pager.md
│  ├─ mvp-scope.md
│  ├─ repo-structure.md
│  ├─ publish-checklist.md
│  ├─ threat-model.md
│  ├─ terminology.md
│  └─ use-cases/
│     ├─ delegated-subagents.md
│     ├─ tool-gateway.md
│     └─ audit-trails.md
├─ spec/
│  ├─ agent-identity-envelope.v0.md
│  ├─ agent-identity-envelope.schema.json
│  └─ examples/
│     ├─ primary-agent.json
│     ├─ delegated-agent.json
│     └─ tool-call.json
├─ adapters/
│  ├─ openclaw/
│  ├─ mcp/
│  └─ generic-http/
├─ examples/
│  ├─ display-card.md
│  ├─ policy-check-flow.md
│  └─ log-records.md
└─ governance/
   ├─ design-principles.md
   ├─ versioning.md
   └─ decision-log/
```

## Purpose of each area

- `docs/` — public explanation, framing, use cases, and operational guidance
- `spec/` — the normative-ish schema drafts and example payloads
- `adapters/` — reference mappings to real runtimes and protocols
- `examples/` — UX, logs, and policy illustrations
- `governance/` — project principles, versioning, and architectural decisions

## First-pass recommendation

Do **not** create everything at once. For the public first pass, the minimum useful structure is:

```text
Agent-Identity-Layer/
├─ README.md
├─ docs/
│  ├─ thesis-one-pager.md
│  ├─ mvp-scope.md
│  ├─ repo-structure.md
│  └─ publish-checklist.md
└─ spec/
   └─ README.md
```

This keeps the repo light while signaling a credible direction.

## Naming guidance

Prefer:

- `identity envelope`
- `delegation chain`
- `scope`
- `verification strength`
- `runtime context`
- `approval policy`

Avoid overloaded or legally risky names unless carefully defined, such as:

- passport
- certificate authority
- sovereign identity
- verified human

## OSS positioning advice

Keep the repo grounded in concrete software system needs:

- provenance
- trust boundaries
- auditability
- least privilege
- interoperability

That keeps the project legible to builders and lowers the chance of being misread as a speculative identity protocol.
