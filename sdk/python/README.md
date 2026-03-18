# ail-sdk

Python SDK for 22B Labs Agent Identity Layer.

Requires Python 3.10+.

## Install

```bash
pip install ail-sdk
```

Or from source:

```bash
cd sdk/python
pip install -e .
```

## Quick start

```python
from ail_sdk import AilClient

client = AilClient(server_url="https://api.agentidcard.org")

# 1. Register owner
owner = client.register_owner(email="you@example.com", org="your_org")

# 2. Verify email
client.verify_email(owner_key_id=owner["owner_key_id"], otp=owner["_dev_otp"])

# 3. Register agent (SDK handles signing automatically)
agent = client.register_agent(
    owner_key_id=owner["owner_key_id"],
    private_key_jwk=owner["private_key_jwk"],
    payload={
        "display_name": "MyAgent",
        "role": "assistant",
        "scope": {
            "network": "none",
            "secrets": "none",
            "write_access": False,
            "approval_policy": {
                "irreversible_actions": "human_required",
                "external_posting": "human_required",
                "destructive_file_ops": "human_required",
            },
        },
    },
)

print(agent["ail_id"])  # AIL-2026-00001

# 4. Verify credential (online)
result = client.verify(agent["credential"]["token"])
print(result["valid"], result["display_name"])

# 5. Verify offline (no server call)
keys = client.get_public_keys()
from ail_sdk import verify_offline
offline = verify_offline(agent["credential"]["token"], keys["keys"][0])
```

## Build a v1 envelope

```python
from ail_sdk import build_envelope

envelope = build_envelope(
    ail_id=agent["ail_id"],
    credential=agent["credential"],
    signal_glyph=agent["signal_glyph"],
    behavior_fingerprint=agent["behavior_fingerprint"],
    agent={
        "id": "agent_myagent_01",
        "provider": "anthropic",
        "model": "claude-sonnet-4-6",
        "runtime": "custom_harness",
    },
    owner={
        "key_id": owner["owner_key_id"],
        "org": "your_org",
    },
    scope=agent["scope"] if "scope" in agent else None,
    delegation={"mode": "direct", "chain_depth": 0},
    runtime={"session_id": "sess_001", "run_id": "run_001", "surface": "cli"},
)
```

## Revoke an agent

```python
client.revoke_agent(
    ail_id=agent["ail_id"],
    owner_key_id=owner["owner_key_id"],
    private_key_jwk=owner["private_key_jwk"],
)
```

## API

### `AilClient(server_url=...)`

### `client.register_owner(email, org=None)`
### `client.verify_email(owner_key_id, otp)`
### `client.register_agent(owner_key_id, private_key_jwk, payload)`
### `client.revoke_agent(ail_id, owner_key_id, private_key_jwk)`
### `client.verify(token)` — online
### `client.verify_offline(token)` — offline (fetches JWKS once)
### `client.get_public_keys()`

### `verify_offline(token, public_key_jwk)` — standalone offline verification

### `build_envelope(...)` — assemble a v1 envelope

### `generate_owner_keypair()` — generate EC P-256 keypair
### `sign_payload(payload, private_key_jwk)` — sign a payload, returns base64url
### `canonical_json(obj)` — canonical JSON serialization
