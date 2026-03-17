# AIL Issuance Server

22B Labs Agent Identity Layer — credential issuance API (Phase 2).

## Setup

```bash
npm install
npm run setup:master-key   # generates data/master-key.json (gitignored)
npm run server             # starts on http://127.0.0.1:3317
```

## API

### Owner registration

**POST /owners/register**

Registers an owner and issues their EC P-256 keypair. Returns the private key once — store it securely.

```json
{
  "email": "you@example.com",
  "org": "your_org"
}
```

Response:

```json
{
  "owner_key_id": "owk_...",
  "public_key_jwk": { ... },
  "private_key_jwk": { ... },
  "message": "Keypair issued. Verify your email..."
}
```

**POST /owners/verify-email**

```json
{
  "owner_key_id": "owk_...",
  "otp": "123456"
}
```

### Agent registration

**POST /agents/register**

The owner must sign the `payload` with their EC P-256 private key before submitting.

**Signing protocol:**

1. Serialize `payload` to canonical JSON:
   ```js
   // Sort all object keys recursively, then JSON.stringify
   canonicalJson(payload)
   ```
2. Sign with ECDSA/SHA-256 using your EC P-256 private key
3. Encode the IEEE P1363 signature (64 bytes for P-256) as `base64url`

Example (Node.js WebCrypto):

```js
import { webcrypto } from "node:crypto";

function canonicalJson(obj) {
  return JSON.stringify(obj, (key, value) => {
    if (value !== null && typeof value === "object" && !Array.isArray(value)) {
      return Object.fromEntries(
        Object.entries(value).sort(([a], [b]) => a.localeCompare(b))
      );
    }
    return value;
  });
}

async function signPayload(payload, privateKeyJwk) {
  const key = await webcrypto.subtle.importKey(
    "jwk", privateKeyJwk,
    { name: "ECDSA", namedCurve: "P-256" },
    false, ["sign"]
  );
  const data = new TextEncoder().encode(canonicalJson(payload));
  const sig = await webcrypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" }, key, data
  );
  return Buffer.from(sig).toString("base64url");
}
```

Request:

```json
{
  "owner_key_id": "owk_...",
  "payload": {
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
  },
  "owner_signature": "<base64url>"
}
```

Response:

```json
{
  "ail_id": "AIL-2026-00001",
  "credential": {
    "type": "AIL.SignedCredential.v1",
    "issuer": "22blabs.ai",
    "issuer_key_id": "22blabs-master-2026",
    "issued_at": "2026-03-17T00:00:00.000Z",
    "expires_at": "2027-03-17T00:00:00.000Z",
    "token": "<JWT>"
  },
  "signal_glyph": {
    "seed": "AIL-2026-00001:ClaudeCoder:owk_...",
    "algorithm": "sha256-visual-v1",
    "version": "glyph.v1"
  },
  "behavior_fingerprint": {
    "hash": "sha256:...",
    "algorithm": "sha256",
    "inputs": ["role", "scope.network", "scope.secrets", "scope.write_access", "provider"]
  }
}
```

**DELETE /agents/:ail_id/revoke**

Revokes a credential. Owner must sign `{ "action": "revoke", "ail_id": "AIL-..." }` using the same protocol as agent registration.

```json
{
  "owner_key_id": "owk_...",
  "owner_signature": "<base64url>"
}
```

### Verification

**POST /verify**

```json
{ "token": "<JWT>" }
```

Response:

```json
{
  "valid": true,
  "ail_id": "AIL-2026-00001",
  "display_name": "ClaudeCoder",
  "role": "review_engineer",
  "owner_org": "22b_labs",
  "issued": "2026-03-17T00:00:00.000Z",
  "expires": "2027-03-17T00:00:00.000Z",
  "revoked": false
}
```

**GET /keys** — JWKS with the active 22B Labs public key

**GET /keys/:kid** — single JWK by key ID

## Full demo

```bash
npm run server          # terminal 1
npm run demo:register   # terminal 2 — runs the full owner → agent → verify flow
```

## Storage

- `data/ail.db` — SQLite database (gitignored)
- `data/master-key.json` — 22B Labs master signing key (gitignored, back this up)

## Notes

- Email sending is stubbed to server console logs. The `_dev_otp` field in the registration response is only for local development.
- The master key is loaded once at startup from `data/master-key.json`.
- For production, load the key from an environment variable or secrets manager instead.
