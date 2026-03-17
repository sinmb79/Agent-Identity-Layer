# @22blabs/ail-sdk

JavaScript SDK for 22B Labs Agent Identity Layer.

Works in Node.js 18+ and modern browsers (uses WebCrypto API).

## Install

```bash
npm install @22blabs/ail-sdk
```

## Quick start

```js
import { AilClient } from "@22blabs/ail-sdk";

const client = new AilClient({ serverUrl: "http://127.0.0.1:3317" });

// 1. Register owner
const owner = await client.registerOwner({ email: "you@example.com", org: "your_org" });

// 2. Verify email
await client.verifyEmail({ owner_key_id: owner.owner_key_id, otp: owner._dev_otp });

// 3. Register agent (SDK handles signing automatically)
const agent = await client.registerAgent({
  owner_key_id: owner.owner_key_id,
  private_key_jwk: owner.private_key_jwk,
  payload: {
    display_name: "MyAgent",
    role: "assistant",
    scope: {
      network: "none",
      secrets: "none",
      write_access: false,
      approval_policy: {
        irreversible_actions: "human_required",
        external_posting: "human_required",
        destructive_file_ops: "human_required",
      },
    },
  },
});

console.log(agent.ail_id); // AIL-2026-00001

// 4. Verify credential (online)
const result = await client.verify(agent.credential.token);
console.log(result.valid, result.display_name);

// 5. Verify offline (no server call)
const keys = await client.getPublicKeys();
const offline = await verifyOffline(agent.credential.token, keys.keys[0]);
```

## Build a v1 envelope

```js
import { buildEnvelope } from "@22blabs/ail-sdk";

const envelope = buildEnvelope({
  ail_id:               agent.ail_id,
  credential:           agent.credential,
  signal_glyph:         agent.signal_glyph,
  behavior_fingerprint: agent.behavior_fingerprint,
  agent: {
    id:          "agent_myagent_01",
    provider:    "anthropic",
    model:       "claude-sonnet-4-6",
    runtime:     "claude_code",
  },
  owner: {
    key_id:     owner.owner_key_id,
    org:        "your_org",
    email_hash: "sha256:...",
  },
  scope: agent_scope,
  delegation: { mode: "direct", chain_depth: 0 },
  runtime: {
    session_id: "sess_001",
    run_id:     "run_001",
    surface:    "cli",
    host:       "localhost",
  },
});
```

## Revoke an agent

```js
await client.revokeAgent({
  ail_id:          agent.ail_id,
  owner_key_id:    owner.owner_key_id,
  private_key_jwk: owner.private_key_jwk,
});
```

## API

### `new AilClient({ serverUrl })`

### `client.registerOwner({ email, org? })`
### `client.verifyEmail({ owner_key_id, otp })`
### `client.registerAgent({ owner_key_id, private_key_jwk, payload })`
### `client.revokeAgent({ ail_id, owner_key_id, private_key_jwk })`
### `client.verify(token)` — online verification
### `client.verifyOffline(token)` — offline (fetches JWKS once, caches)
### `client.getPublicKeys()` — returns JWKS

### `verifyOffline(token, publicKeyJwk)` — standalone offline verification

### `buildEnvelope(options)` — assemble a v1 envelope

### `generateOwnerKeypair()` — generate EC P-256 keypair (returns `{ public_key_jwk, private_key_jwk }`)
### `signPayload(payload, privateKeyJwk)` — sign a payload, returns base64url
### `canonicalJson(obj)` — canonical JSON serialization
