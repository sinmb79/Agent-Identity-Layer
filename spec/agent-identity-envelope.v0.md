# Agent Identity Envelope v0

Status: Draft v0

## Purpose

The Agent Identity Envelope is a minimal, portable metadata object attached to an agent, run, message, task, or tool invocation.

It exists to answer five practical questions:

1. Who is this agent?
2. Who authorized or delegated it?
3. What scope does it have?
4. What runtime context is it operating in?
5. What evidence supports those claims?

This document defines a documentation-first v0. It is intended to be useful before cryptographic signing, centralized registries, or standards formalization.

## Design goals

- Small enough to attach to ordinary agent events
- Readable by humans during debugging or review
- Structured enough for policy checks and logging
- Explicit about delegation and approval boundaries
- Safe to adopt incrementally across runtimes

## Non-goals

- Legal identity, KYC, or personhood claims
- Guaranteeing that an agent is truthful
- Replacing authentication, authorization, or sandboxing
- Mandating a single trust provider or global registry
- Requiring signatures in v0

## Top-level shape

```json
{
  "version": "ail.v0",
  "agent": {},
  "delegation": {},
  "scope": {},
  "runtime": {},
  "verification": {},
  "extensions": {}
}
```

## Field definitions

### `version`

String. Required.

Current value:

```json
"ail.v0"
```

### `agent`

Required object describing the active agent identity.

```json
{
  "id": "agent_codexcoder_01",
  "display_name": "CodexCoder",
  "role": "implementation_engineer",
  "provider": "openai",
  "runtime": "codex",
  "owner": {
    "type": "company",
    "id": "22b_labs"
  }
}
```

Fields:

- `id` — stable identifier within the local trust domain
- `display_name` — human-readable name shown in UI/logs
- `role` — functional role, not marketing persona
- `provider` — model or execution provider namespace when relevant
- `runtime` — runtime or harness type
- `owner` — organization, workspace, product, or operator responsible for the agent definition

### `delegation`

Required object describing launch and chain-of-command context.

```json
{
  "mode": "delegated",
  "delegated_by": {
    "agent_id": "agent_cto_01",
    "run_id": "run_cto_20260316_1127"
  },
  "approved_by": {
    "type": "human",
    "id": "boss"
  },
  "chain_depth": 2,
  "task_ref": "issue_BLA-12"
}
```

Fields:

- `mode` — `direct | delegated | scheduled | system`
- `delegated_by` — parent agent/run reference when applicable
- `approved_by` — human or board authority for privileged work when applicable
- `chain_depth` — integer depth of delegation for quick policy checks
- `task_ref` — ticket, job, issue, or workflow reference

### `scope`

Required object defining what the agent is allowed to touch and how approvals apply.

```json
{
  "workspace": ["/workspace/example"],
  "repos": ["Agent-Identity-Layer"],
  "network": "restricted",
  "secrets": "none",
  "write_access": true,
  "approval_policy": {
    "irreversible_actions": "human_required",
    "external_posting": "human_required",
    "destructive_file_ops": "human_required"
  }
}
```

Fields:

- `workspace` — allowed filesystem roots
- `repos` — allowed repository identifiers if scoped to repos
- `network` — `none | restricted | allowed`
- `secrets` — `none | indirect | direct`
- `write_access` — whether local writes are permitted
- `approval_policy` — human-readable enforcement summary for sensitive operations

### `runtime`

Required object describing the execution environment.

```json
{
  "session_id": "sess_20260317_main",
  "run_id": "run_codexcoder_20260317_0805",
  "surface": "telegram",
  "host": "local-host-example",
  "cwd": "/workspace/example",
  "time": "2026-03-17T08:05:00+09:00"
}
```

Fields:

- `session_id` — conversational or orchestration session
- `run_id` — current run or task execution identifier
- `surface` — chat, API, cron, CLI, workflow, etc.
- `host` — machine, service, or control-plane host
- `cwd` — current working directory when relevant
- `time` — envelope creation time in ISO 8601 format

### `verification`

Required object describing how a receiver should interpret trust strength.

```json
{
  "strength": "local_runtime_asserted",
  "evidence": [
    "runtime_session_binding",
    "workspace_path_match",
    "delegation_parent_present"
  ],
  "signed": false,
  "attestation_ref": null
}
```

Fields:

- `strength` — coarse verification level
- `evidence` — machine or human-verifiable support claims
- `signed` — whether a signature is attached
- `attestation_ref` — optional pointer to stronger proof material

Recommended `strength` values:

- `self_asserted`
- `local_runtime_asserted`
- `platform_asserted`
- `cryptographically_signed`

### `extensions`

Optional free-form object for runtime-specific data.

Rules:

- Must not redefine core field semantics
- Must not contain raw secrets
- Should use namespaced keys when possible

Example:

```json
{
  "openclaw": {
    "channel": "telegram",
    "chat_type": "direct"
  }
}
```

## Minimal validation rules

An envelope is valid for v0 if:

- `version` is `ail.v0`
- `agent.id`, `agent.display_name`, `agent.role` exist
- `delegation.mode` exists
- `scope.approval_policy` exists, even if minimal
- `runtime.run_id` or `runtime.session_id` exists
- `verification.strength` exists

## Example policies enabled by this envelope

- Reject tool execution when `chain_depth > 2`
- Require explicit approval when `approval_policy.irreversible_actions = human_required`
- Block cross-repo writes when target repo is outside `scope.repos`
- Show warning badge when `verification.strength = self_asserted`
- Hide high-trust UI affordances unless `signed = true`

## Trust interpretation guidance

Receivers should treat the envelope as descriptive metadata, not proof, unless stronger verification material is present.

Practical interpretation:

- `self_asserted` means informational only
- `local_runtime_asserted` means the local control plane attached the claims
- `platform_asserted` means a hosting platform attached or enforced the claims
- `cryptographically_signed` means signatures can be independently checked

## Recommended future work

- JSON Schema draft
- detached signature envelope format
- standard delegation chain references
- privacy-safe redaction profile
- interoperability examples across major agent runtimes
