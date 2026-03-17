/**
 * One-time setup: generates the 22B Labs master signing keypair (EC P-256).
 *
 * Output: data/master-key.json  (gitignored — keep it secret)
 *
 * Usage:
 *   npm run setup:master-key
 */

import { webcrypto } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.resolve(__dirname, "../data");
const keyFile = path.join(dataDir, "master-key.json");

if (existsSync(keyFile)) {
  console.log("Master key already exists at", keyFile);
  console.log("Delete it and run again only if you intend to rotate the signing key.");
  console.log("WARNING: rotating the master key invalidates all previously issued credentials.");
  process.exit(0);
}

await mkdir(dataDir, { recursive: true });

const { privateKey, publicKey } = await webcrypto.subtle.generateKey(
  { name: "ECDSA", namedCurve: "P-256" },
  true,
  ["sign", "verify"]
);

const private_key_jwk = await webcrypto.subtle.exportKey("jwk", privateKey);
const public_key_jwk = await webcrypto.subtle.exportKey("jwk", publicKey);

const masterKey = {
  kid: "22blabs-master-2026",
  algorithm: "ES256",
  curve: "P-256",
  created_at: new Date().toISOString(),
  private_key_jwk,
  public_key_jwk,
};

await writeFile(keyFile, JSON.stringify(masterKey, null, 2), "utf8");

console.log("Master key generated:", keyFile);
console.log("kid:", masterKey.kid);
console.log("\nPublic key JWK (safe to publish):");
console.log(JSON.stringify(public_key_jwk, null, 2));
console.log("\ndata/master-key.json is gitignored. Back it up securely.");
