/**
 * Crypto utilities for the AIL JS SDK.
 * Uses the WebCrypto API (globalThis.crypto.subtle) — works in Node.js 18+
 * and all modern browsers.
 */

import { createHash } from "node:crypto";

// ---------------------------------------------------------------------------
// Canonical JSON
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
// SHA-256 hex
// ---------------------------------------------------------------------------
export function sha256hex(data) {
  // Works in Node.js; in browsers, use SubtleCrypto instead
  try {
    return createHash("sha256").update(data).digest("hex");
  } catch {
    // Browser fallback (sync not available — caller should use sha256hexAsync)
    throw new Error("Use sha256hexAsync in browser environments.");
  }
}

export async function sha256hexAsync(data) {
  const buf = new TextEncoder().encode(data);
  const hash = await globalThis.crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// ---------------------------------------------------------------------------
// Owner keypair — EC P-256
// ---------------------------------------------------------------------------
export async function generateOwnerKeypair() {
  const { privateKey, publicKey } = await globalThis.crypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    true,
    ["sign", "verify"]
  );

  const private_key_jwk = await globalThis.crypto.subtle.exportKey("jwk", privateKey);
  const public_key_jwk = await globalThis.crypto.subtle.exportKey("jwk", publicKey);

  // owner_key_id is assigned by the server; return a local placeholder
  return { public_key_jwk, private_key_jwk };
}

// ---------------------------------------------------------------------------
// Sign payload (owner signs registration or revoke payload)
// Returns base64url IEEE P1363 signature (64 bytes for P-256)
// ---------------------------------------------------------------------------
export async function signPayload(payload, privateKeyJwk) {
  const key = await globalThis.crypto.subtle.importKey(
    "jwk",
    privateKeyJwk,
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"]
  );
  const data = new TextEncoder().encode(canonicalJson(payload));
  const sig = await globalThis.crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    key,
    data
  );
  return Buffer.from(sig).toString("base64url");
}

// ---------------------------------------------------------------------------
// Verify owner signature
// ---------------------------------------------------------------------------
export async function verifyOwnerSignature(payload, signatureB64url, publicKeyJwk) {
  try {
    const key = await globalThis.crypto.subtle.importKey(
      "jwk",
      publicKeyJwk,
      { name: "ECDSA", namedCurve: "P-256" },
      false,
      ["verify"]
    );
    const data = new TextEncoder().encode(canonicalJson(payload));
    const sig = Buffer.from(signatureB64url, "base64url");
    return await globalThis.crypto.subtle.verify(
      { name: "ECDSA", hash: "SHA-256" },
      key,
      sig,
      data
    );
  } catch {
    return false;
  }
}
