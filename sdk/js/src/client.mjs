import { signPayload } from "./crypto.mjs";
import { jwtVerify, importJWK } from "jose";

/**
 * AilClient communicates with the Agent ID Card issuance server.
 *
 * Usage:
 *   const client = new AilClient({ serverUrl: "https://api.agentidcard.org" });
 */
export class AilClient {
  constructor({ serverUrl = "https://api.agentidcard.org" } = {}) {
    this.serverUrl = serverUrl.replace(/\/$/, "");
  }

  #withQuery(path, params = {}) {
    const search = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (value === undefined || value === null || value === "") continue;
      search.set(key, String(value));
    }
    const query = search.toString();
    return query ? `${path}?${query}` : path;
  }

  async #post(path, body, headers = {}) {
    const res = await fetch(`${this.serverUrl}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
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

  async #get(path, headers = {}) {
    const res = await fetch(`${this.serverUrl}${path}`, { headers });
    const data = await res.json();
    if (!res.ok) {
      const err = new Error(data.message ?? data.error ?? `HTTP ${res.status}`);
      err.code = data.error;
      err.status = res.status;
      throw err;
    }
    return data;
  }

  // -------------------------------------------------------------------------
  // Owner registration and login
  // -------------------------------------------------------------------------

  /**
   * Register a new owner and receive their EC P-256 keypair.
   * Store private_key_jwk securely - it is not kept by the server.
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

  /**
   * Request a login OTP for an existing verified owner.
   */
  async loginOwner({ email }) {
    return this.#post("/owners/login", { email });
  }

  /**
   * Verify a login OTP and receive a session token for session-based registration.
   */
  async verifyLogin({ owner_key_id, otp }) {
    return this.#post("/owners/verify-login", { owner_key_id, otp });
  }

  // -------------------------------------------------------------------------
  // Agent registration
  // -------------------------------------------------------------------------

  /**
   * Register an agent and receive a signed v1 credential.
   *
   * The SDK handles signing the payload with the owner's private key automatically.
   */
  async registerAgent({ owner_key_id, private_key_jwk, payload }) {
    const owner_signature = await signPayload(payload, private_key_jwk);
    return this.#post("/agents/register", { owner_key_id, payload, owner_signature });
  }

  /**
   * Register an agent using a session token from verifyLogin.
   */
  async registerAgentWithSession({ session_token, payload }) {
    return this.#post("/agents/register-session", { session_token, payload });
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

  getAuthUrl({ client_id, redirect_uri, scope = "identity", state = "" }) {
    const params = new URLSearchParams({
      client_id,
      redirect_uri,
      scope,
      state,
    });
    return `${this.serverUrl}/auth/verify?${params}`;
  }

  async registerClient({ name, allowed_origins, redirect_uris, admin_api_key }) {
    return this.#post("/auth/clients/register", {
      name,
      allowed_origins,
      redirect_uris,
    }, {
      "X-Admin-Key": admin_api_key,
    });
  }

  async exchangeAuthCode({ code, client_id, client_secret, origin }) {
    const headers = {};
    if (origin) headers.Origin = origin;
    return this.#post("/auth/exchange", { code, client_id, client_secret }, headers);
  }

  async verifyQuick({ token, client_id, client_secret, origin }) {
    const path = this.#withQuery("/auth/verify-quick", { token, client_id });
    const headers = { Authorization: `Bearer ${client_secret}` };
    if (origin) headers.Origin = origin;
    return this.#get(path, headers);
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
   * Fetch the Agent ID Card JWKS (public keys for offline verification).
   */
  async getPublicKeys() {
    return this.#get("/keys");
  }

  // -------------------------------------------------------------------------
  // Reputation and achievements
  // -------------------------------------------------------------------------

  async getReputation(ailId) {
    return this.#get(`/reputation/${encodeURIComponent(ailId)}`);
  }

  async getReputationHistory(ailId, params = {}) {
    return this.#get(this.#withQuery(`/reputation/${encodeURIComponent(ailId)}/history`, params));
  }

  async compareAgents(ailId, otherAilId) {
    return this.#get(this.#withQuery(`/reputation/${encodeURIComponent(ailId)}/compare`, { with: otherAilId }));
  }

  async getLeaderboard(params = {}) {
    return this.#get(this.#withQuery("/reputation/leaderboard", params));
  }

  async getBadges(ailId) {
    return this.#get(`/reputation/${encodeURIComponent(ailId)}/badges`);
  }

  async getSeasonReport(ailId, season, params = {}) {
    return this.#get(
      this.#withQuery(`/reputation/${encodeURIComponent(ailId)}/season/${season}`, params)
    );
  }

  async awardBadge({ source_name, agent_id, badge_id, private_key_jwk, merkle_proof = null }) {
    const payload = { source_name, agent_id, badge_id, merkle_proof };
    const signature = await signPayload(payload, private_key_jwk);
    return this.#post("/reputation/badge", { ...payload, signature });
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
      issuer: ["agentidcard.org", "22blabs.ai"],
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
