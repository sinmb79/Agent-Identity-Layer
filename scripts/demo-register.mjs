/**
 * Full end-to-end demo of the AIL issuance flow.
 *
 * Requires the server to be running:
 *   npm run setup:master-key
 *   npm run server
 *
 * Then in another terminal:
 *   npm run demo:register
 */

import { signPayload, canonicalJson } from "../server/lib/crypto.mjs";

const BASE = process.env.AIL_SERVER ?? "http://127.0.0.1:3317";

async function post(path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(`POST ${path} → ${res.status}: ${JSON.stringify(data)}`);
  }
  return data;
}

async function get(path) {
  const res = await fetch(`${BASE}${path}`);
  return res.json();
}

// ---------------------------------------------------------------------------
console.log("=== AIL Registration Demo ===\n");

// Step 1: Register owner
console.log("1. Registering owner (boss@22blabs.ai)...");
const ownerReg = await post("/owners/register", {
  email: "demo-owner@example.com",
  org: "example_org",
});
console.log("   owner_key_id:", ownerReg.owner_key_id);
console.log("   OTP (dev only):", ownerReg._dev_otp, "\n");

const { owner_key_id, private_key_jwk } = ownerReg;

// Step 2: Verify email
console.log("2. Verifying email with OTP...");
const verified = await post("/owners/verify-email", {
  owner_key_id,
  otp: ownerReg._dev_otp,
});
console.log("   verified:", verified.verified, "\n");

// Step 3: Register agent
const registrationPayload = {
  display_name: "ClaudeCoder",
  role: "review_engineer",
  provider: "anthropic",
  model: "claude-sonnet-4-6",
  scope: {
    workspace: ["/workspace/example"],
    repos: ["Agent-Identity-Layer"],
    network: "none",
    secrets: "none",
    write_access: false,
    approval_policy: {
      irreversible_actions: "not_allowed",
      external_posting: "not_allowed",
      destructive_file_ops: "human_required",
    },
  },
};

console.log("3. Signing registration payload with owner private key...");
const owner_signature = await signPayload(registrationPayload, private_key_jwk);
console.log("   signature (base64url):", owner_signature.slice(0, 40) + "...\n");

console.log("4. Registering agent...");
const agentReg = await post("/agents/register", {
  owner_key_id,
  payload: registrationPayload,
  owner_signature,
});
console.log("   ail_id:", agentReg.ail_id);
console.log("   issued_at:", agentReg.credential.issued_at);
console.log("   expires_at:", agentReg.credential.expires_at);
console.log("   signal_glyph seed:", agentReg.signal_glyph.seed);
console.log("   behavior_fingerprint:", agentReg.behavior_fingerprint.hash, "\n");

// Step 4: Verify the credential
console.log("5. Verifying credential via POST /verify...");
const verification = await post("/verify", { token: agentReg.credential.token });
console.log("   valid:", verification.valid);
console.log("   display_name:", verification.display_name);
console.log("   owner_org:", verification.owner_org, "\n");

// Step 5: Fetch public key for offline verification
console.log("6. Fetching 22B Labs public key (GET /keys)...");
const jwks = await get("/keys");
console.log("   keys published:", jwks.keys.length);
console.log("   kid:", jwks.keys[0].kid, "\n");

console.log("=== Demo complete ===");
console.log(`\nFull v1 envelope ready to assemble. ail_id: ${agentReg.ail_id}`);
