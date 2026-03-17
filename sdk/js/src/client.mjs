import { signPayload } from "./crypto.mjs";
import { jwtVerify, importJWK } from "jose";

/**
 * AilClient — communicates with a 22B Labs AIL Issuance Server.
 *
 * Usage:
 *   const client = new AilClient({ serverUrl: 'http://127.0.0.1:3317' })
 *   const owner  = await client.registerOwner({ email: '...', org: '...' })
 *   await client.verifyEmail({ owner_key_id: ..., otp: owner._dev_otp })
 *   const agent  = await client.registerAgent({ owner_key_id, private_key_jwk, payload })
 *   const result = await client.verify(agent.credential.token)
 */
export class AilClient {
  constructor({ serverUrl = "http://127.0.0.1:3317" } = {}) {
    this.serverUrl = serverUrl.replace(/\/$/, "");
  }

  async #post(path, body) {
    const res = await fetch(`${this.serverUrl}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok) {
      const err = new Error(data.message ?? data.error ?? `HTTP ${res.status}`);
      err.code = data.error;
      err.status = res.status;
      throw err;
    }
    return data;
  }

  async #get(path) {
    const res = await fetch(`${this.serverUrl}${path}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  }

  // -------------------------------------------------------------------------
  // Owner registration
  // -------------------------------------------------------------------------

  /**
   * Register a new owner and receive their EC P-256 keypair.
   * Store private_key_jwk securely — it is not kept by the server.
   */
  async registerOwner({ email, org }) {
    return this.#post("/owners/register", { email, org });
  }

  /**
   * Verify owner email with the OTP received after registration.
   */
  async verifyEmail({ owner_key_id, otp }) {
    return this.#post("/owners/verify-email", { owner_key_id, otp });
  }

  // -------------------------------------------------------------------------
  // Agent registration
  // -------------------------------------------------------------------------

  /**
   * Register an agent and receive a signed v1 credential.
   *
   * The SDK handles signing the payload with the owner's private key automatically.
   *
   * @param {object} options
   * @param {string} options.owner_key_id
   * @param {object} options.private_key_jwk   - owner's private key JWK
   * @param {object} options.payload            - { display_name, role, provider, model, scope }
   * @returns {Promise<{ ail_id, credential, signal_glyph, behavior_fingerprint }>}
   */
  async registerAgent({ owner_key_id, private_key_jwk, payload }) {
    const owner_signature = await signPayload(payload, private_key_jwk);
    return this.#post("/agents/register", { owner_key_id, payload, owner_signature });
  }

  // -------------------------------------------------------------------------
  // Revocation
  // -------------------------------------------------------------------------

  /**
   * Revoke an agent credential.
   * The SDK handles signing the revoke payload automatically.
   */
  async revokeAgent({ ail_id, owner_key_id, private_key_jwk }) {
    const revokePayload = { action: "revoke", ail_id };
    const owner_signature = await signPayload(revokePayload, private_key_jwk);
    const res = await fetch(`${this.serverUrl}/agents/${ail_id}/revoke`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ owner_key_id, owner_signature }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
    return data;
  }

  // -------------------------------------------------------------------------
  // Verification
  // -------------------------------------------------------------------------

  /**
   * Verify a credential online (calls the server).
   */
  async verify(token) {
    return this.#post("/verify", { token });
  }

  /**
   * Verify a credential offline using the server's public key.
   * Fetches the JWKS once and caches it.
   */
  async verifyOffline(token) {
    if (!this._cachedJwks) {
      this._cachedJwks = await this.#get("/keys");
    }
    return verifyOffline(token, this._cachedJwks.keys[0]);
  }

  /**
   * Fetch the 22B Labs JWKS (public keys for offline verification).
   */
  async getPublicKeys() {
    return this.#get("/keys");
  }
}

// ---------------------------------------------------------------------------
// Standalone offline verification (no server required)
// Provide the public key JWK from GET /keys
// ---------------------------------------------------------------------------
export async function verifyOffline(token, publicKeyJwk) {
  try {
    const publicKey = await importJWK(publicKeyJwk, "ES256");
    const { payload } = await jwtVerify(token, publicKey, {
      issuer: "22blabs.ai",
      algorithms: ["ES256"],
    });
    return {
      valid: true,
      ail_id: payload.ail_id,
      display_name: payload.display_name,
      role: payload.role,
      owner_org: payload.owner_org,
      issued: new Date(payload.iat * 1000).toISOString(),
      expires: new Date(payload.exp * 1000).toISOString(),
    };
  } catch (err) {
    return { valid: false, reason: err.message };
  }
}
