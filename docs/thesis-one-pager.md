# Agent Identity Layer — Thesis One-Pager

## One-line thesis

AI agents need a portable identity layer that makes delegation, scope, runtime context, and verification legible to both machines and humans.

## Why now

Agent systems are becoming multi-runtime, tool-using, delegated, and semi-autonomous. That creates a trust gap:

- downstream systems do not reliably know which agent is calling them
- humans cannot easily distinguish a primary assistant from a spawned worker
- approvals, permissions, and audit trails are often runtime-specific
- agent claims are inconsistent across platforms

As the number of agents rises, the absence of a common identity layer becomes an operational and safety problem.

## Core claim

An agent should not just send outputs or tool requests. It should carry a minimal identity envelope that states:

- agent identifier
- role and type
- delegator / parent relationship
- execution environment
- declared permissions or scope
- approval requirements
- evidence or verification method
- timestamps and session lineage

This does not have to be perfect to be useful. Even unsigned metadata improves observability. Over time, stronger verification can be layered in.

## What the identity layer does

The Agent Identity Layer helps systems answer:

1. Is this the same agent I interacted with before?
2. Is this agent acting directly, or on behalf of another agent or user?
3. What is it allowed to access or do?
4. What environment or workspace is it operating inside?
5. How much should I trust these claims?
6. What audit trail should I preserve?

## Key design stance

Start practical, not maximalist.

A good v0 should be:

- small enough to implement in a week
- readable in logs and dashboards
- compatible with existing auth systems
- useful without requiring new infrastructure
- strict about non-goals

## Example fields

```json
{
  "agent_id": "julie-main",
  "session_id": "sess_abc123",
  "role": "assistant",
  "kind": "primary",
  "delegated_by": null,
  "user_handle": "boss",
  "workspace": "C:/Users/.../.openclaw/workspace",
  "scope": ["read", "write-docs"],
  "approval_policy": "human-required-for-destructive-actions",
  "runtime": {
    "platform": "openclaw",
    "model": "gpt-5.4",
    "host": "22B"
  },
  "evidence": {
    "method": "runtime-attested-metadata",
    "strength": "basic"
  }
}
```

## Primary use cases

### 1) Delegated subagents
A parent agent spawns a worker to research or edit files. The worker should carry a clear parent link, limited scope, and session lineage.

### 2) Tool gateways and MCP-like integrations
External tools need to know what sort of agent is calling, what scope it claims, and whether the action requires human approval.

### 3) Agent fleet operations
Platform operators need consistent logs, routing, policy checks, and incident review across many agents.

### 4) Human trust UX
Interfaces should be able to display understandable facts: “spawned by X”, “allowed to edit docs only”, “cannot publish without approval”.

## Non-goals

- proving personhood
- replacing OAuth, IAM, or enterprise policy engines
- embedding secrets in identity payloads
- inventing a token economy
- claiming cryptographic certainty in the absence of real attestation

## Risks to avoid

- over-collecting personal data
- implying stronger verification than actually exists
- building a spec too abstract to implement
- coupling the model to one vendor or runtime
- turning a lightweight identity envelope into a surveillance layer

## What success looks like

In the short term:

- a clear public vocabulary for agent identity and delegation
- a small schema others can implement or critique
- examples that make safety and trust boundaries explicit

In the medium term:

- runtime adapters that emit identity envelopes
- policy engines that inspect them
- interoperable patterns across agent frameworks

## Positioning

Agent Identity Layer is best framed as **trust infrastructure for agentic systems**: not identity in the human KYC sense, but identity in the systems sense — provenance, delegation, scope, and verification.
