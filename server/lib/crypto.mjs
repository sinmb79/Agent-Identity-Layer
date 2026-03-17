import { webcrypto } from "node:crypto";
import { createHash, randomBytes } from "node:crypto";
import { SignJWT, jwtVerify, importJWK } from "jose";

// ---------------------------------------------------------------------------
// Canonical JSON — sorts object keys recursively for consistent hashing
// ---------------------------------------------------------------------------
export function canonicalJson(obj) {
  return JSON.stringify(obj, (key, value) => {
    if (value !== null && typeof value === "object" && !Array.isArray(value)) {
      return Object.fromEntries(
        Object.entries(value).sort(([a], [b]) => a.localeCompare(b))
      );
    }
    return value;
  });
}

// ---------------------------------------------------------------------------
// SHA-256 hex hash
// ---------------------------------------------------------------------------
export function sha256hex(data) {
  return createHash("sha256").update(data).digest("hex");
}

// ---------------------------------------------------------------------------
// Owner keypair — EC P-256
// Returns { owner_key_id, public_key_jwk, private_key_jwk }
// The private key is returned to the caller and NEVER stored by 22B Labs.
// ---------------------------------------------------------------------------
export async function generateOwnerKeypair() {
  const { privateKey, publicKey } = await webcrypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    true,
    ["sign", "verify"]
  );

  const privateJwk = await webcrypto.subtle.exportKey("jwk", privateKey);
  const publicJwk = await webcrypto.subtle.exportKey("jwk", publicKey);
  const owner_key_id = "owk_" + randomBytes(12).toString("hex");

  return { owner_key_id, public_key_jwk: publicJwk, private_key_jwk: privateJwk };
}

// ---------------------------------------------------------------------------
// Verify owner signature
//
// The owner signs canonical JSON of the registration payload using their
// EC P-256 private key (ECDSA/SHA-256).
// Signature encoding: raw IEEE P1363 (r || s, 64 bytes), base64url.
// ---------------------------------------------------------------------------
export async function verifyOwnerSignature(payload, signatureB64url, publicKeyJwk) {
  try {
    const key = await webcrypto.subtle.importKey(
      "jwk",
      publicKeyJwk,
      { name: "ECDSA", namedCurve: "P-256" },
      false,
      ["verify"]
    );

    const data = new TextEncoder().encode(canonicalJson(payload));
    const sig = Buffer.from(signatureB64url, "base64url");

    return await webcrypto.subtle.verify(
      { name: "ECDSA", hash: "SHA-256" },
      key,
      sig,
      data
    );
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Sign owner's registration payload (used in demo scripts)
// ---------------------------------------------------------------------------
export async function signPayload(payload, privateKeyJwk) {
  const key = await webcrypto.subtle.importKey(
    "jwk",
    privateKeyJwk,
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"]
  );

  const data = new TextEncoder().encode(canonicalJson(payload));
  const sig = await webcrypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, data);
  return Buffer.from(sig).toString("base64url");
}

// ---------------------------------------------------------------------------
// Behavior fingerprint
// Inputs: role, scope.network, scope.secrets, scope.write_access, provider
// ---------------------------------------------------------------------------
export function computeBehaviorFingerprint(agentData) {
  const { role, provider, scope } = agentData;
  const inputs = {
    network: scope?.network ?? null,
    provider: provider ?? null,
    role: role ?? null,
    secrets: scope?.secrets ?? null,
    write_access: scope?.write_access ?? null,
  };
  const hash = sha256hex(canonicalJson(inputs));
  return {
    hash: `sha256:${hash}`,
    algorithm: "sha256",
    inputs: ["role", "scope.network", "scope.secrets", "scope.write_access", "provider"],
  };
}

// ---------------------------------------------------------------------------
// Signal glyph seed
// seed = "{ail_id}:{display_name}:{owner_key_id}"
// ---------------------------------------------------------------------------
export function computeGlyphSeed(ailId, displayName, ownerKeyId) {
  return {
    seed: `${ailId}:${displayName}:${ownerKeyId}`,
    algorithm: "sha256-visual-v1",
    version: "glyph.v1",
  };
}

// ---------------------------------------------------------------------------
// Scope hash — SHA-256 of canonical JSON of the scope object
// ---------------------------------------------------------------------------
export function computeScopeHash(scope) {
  return `sha256:${sha256hex(canonicalJson(scope))}`;
}

// ---------------------------------------------------------------------------
// Issue signed credential JWT
// masterKeyData = { kid, private_key_jwk }
// ---------------------------------------------------------------------------
export async function issueCredentialJWT(claims, masterKeyData) {
  const privateKey = await importJWK(masterKeyData.private_key_jwk, "ES256");

  const issuedAt = new Date();
  const expiresAt = new Date(issuedAt);
  expiresAt.setFullYear(expiresAt.getFullYear() + 1);

  const token = await new SignJWT(claims)
    .setProtectedHeader({ alg: "ES256", typ: "JWT", kid: masterKeyData.kid })
    .setIssuer("22blabs.ai")
    .setSubject(claims.ail_id)
    .setIssuedAt(issuedAt)
    .setExpirationTime(expiresAt)
    .sign(privateKey);

  return { token, issuedAt, expiresAt };
}

// ---------------------------------------------------------------------------
// Verify credential JWT
// masterKeyData = { kid, public_key_jwk }
// ---------------------------------------------------------------------------
export async function verifyCredentialJWT(token, masterKeyData) {
  const publicKey = await importJWK(masterKeyData.public_key_jwk, "ES256");
  return jwtVerify(token, publicKey, {
    issuer: "22blabs.ai",
    algorithms: ["ES256"],
  });
}

// ---------------------------------------------------------------------------
// Generate a 6-digit OTP
// ---------------------------------------------------------------------------
export function generateOtp() {
  return String(Math.floor(100000 + Math.random() * 900000));
}
