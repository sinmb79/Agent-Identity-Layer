/**
 * crypto.mjs — Cloudflare Workers version
 *
 * Uses Web Crypto API (global `crypto`) instead of node:crypto.
 * jose library works natively in Workers.
 */

import { SignJWT, jwtVerify, importJWK } from "jose";

export const DEFAULT_CREDENTIAL_ISSUER = "agentidcard.org";
export const LEGACY_CREDENTIAL_ISSUER = "22blabs.ai";
export const VALID_CREDENTIAL_ISSUERS = [DEFAULT_CREDENTIAL_ISSUER, LEGACY_CREDENTIAL_ISSUER];

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
// SHA-256 hex hash (Web Crypto)
// ---------------------------------------------------------------------------
export async function sha256hex(data) {
  const encoded = new TextEncoder().encode(data);
  const hash = await crypto.subtle.digest("SHA-256", encoded);
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// ---------------------------------------------------------------------------
// Random bytes as hex string
// ---------------------------------------------------------------------------
export function randomHex(bytes) {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  return [...buf].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// ---------------------------------------------------------------------------
// Owner keypair — EC P-256
// ---------------------------------------------------------------------------
export async function generateOwnerKeypair() {
  const { privateKey, publicKey } = await crypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    true,
    ["sign", "verify"]
  );

  const privateJwk = await crypto.subtle.exportKey("jwk", privateKey);
  const publicJwk = await crypto.subtle.exportKey("jwk", publicKey);
  const owner_key_id = "owk_" + randomHex(12);

  return { owner_key_id, public_key_jwk: publicJwk, private_key_jwk: privateJwk };
}

// ---------------------------------------------------------------------------
// Verify owner signature (ECDSA P-256 / SHA-256, base64url IEEE P1363)
// ---------------------------------------------------------------------------
export async function verifyOwnerSignature(payload, signatureB64url, publicKeyJwk) {
  try {
    const key = await crypto.subtle.importKey(
      "jwk",
      publicKeyJwk,
      { name: "ECDSA", namedCurve: "P-256" },
      false,
      ["verify"]
    );

    const data = new TextEncoder().encode(canonicalJson(payload));

    // base64url decode
    const b64 = signatureB64url.replace(/-/g, "+").replace(/_/g, "/");
    const binStr = atob(b64);
    const sig = new Uint8Array(binStr.length);
    for (let i = 0; i < binStr.length; i++) sig[i] = binStr.charCodeAt(i);

    return await crypto.subtle.verify(
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
// Sign payload (used in demo scripts)
// ---------------------------------------------------------------------------
export async function signPayload(payload, privateKeyJwk) {
  const key = await crypto.subtle.importKey(
    "jwk",
    privateKeyJwk,
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"]
  );

  const data = new TextEncoder().encode(canonicalJson(payload));
  const sig = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, data);

  // base64url encode
  const bytes = new Uint8Array(sig);
  let binStr = "";
  for (const b of bytes) binStr += String.fromCharCode(b);
  return btoa(binStr).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

// ---------------------------------------------------------------------------
// Behavior fingerprint
// ---------------------------------------------------------------------------
export async function computeBehaviorFingerprint(agentData) {
  const { role, provider, scope } = agentData;
  const inputs = {
    network: scope?.network ?? null,
    provider: provider ?? null,
    role: role ?? null,
    secrets: scope?.secrets ?? null,
    write_access: scope?.write_access ?? null,
  };
  const hash = await sha256hex(canonicalJson(inputs));
  return {
    hash: `sha256:${hash}`,
    algorithm: "sha256",
    inputs: ["role", "scope.network", "scope.secrets", "scope.write_access", "provider"],
  };
}

// ---------------------------------------------------------------------------
// Signal glyph seed
// ---------------------------------------------------------------------------
export function computeGlyphSeed(ailId, displayName, ownerKeyId) {
  return {
    seed: `${ailId}:${displayName}:${ownerKeyId}`,
    algorithm: "sha256-visual-v1",
    version: "glyph.v1",
  };
}

// ---------------------------------------------------------------------------
// Scope hash
// ---------------------------------------------------------------------------
export async function computeScopeHash(scope) {
  return `sha256:${await sha256hex(canonicalJson(scope))}`;
}

// ---------------------------------------------------------------------------
// Issue signed credential JWT
// ---------------------------------------------------------------------------
export async function issueCredentialJWT(claims, masterKeyData, issuer = DEFAULT_CREDENTIAL_ISSUER) {
  const privateKey = await importJWK(masterKeyData.private_key_jwk, "ES256");

  const issuedAt = new Date();
  const expiresAt = new Date(issuedAt);
  expiresAt.setFullYear(expiresAt.getFullYear() + 1);

  const token = await new SignJWT(claims)
    .setProtectedHeader({ alg: "ES256", typ: "JWT", kid: masterKeyData.kid })
    .setIssuer(issuer)
    .setSubject(claims.ail_id)
    .setIssuedAt(issuedAt)
    .setExpirationTime(expiresAt)
    .sign(privateKey);

  return { token, issuedAt, expiresAt };
}

// ---------------------------------------------------------------------------
// Verify credential JWT
// ---------------------------------------------------------------------------
export async function verifyCredentialJWT(token, masterKeyData, validIssuers = VALID_CREDENTIAL_ISSUERS) {
  const publicKey = await importJWK(masterKeyData.public_key_jwk, "ES256");
  return jwtVerify(token, publicKey, {
    issuer: validIssuers,
    algorithms: ["ES256"],
  });
}

// ---------------------------------------------------------------------------
// Generate a 6-digit OTP
// ---------------------------------------------------------------------------
export function generateOtp() {
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  return String(100000 + (buf[0] % 900000));
}
