export type Jwk = Record<string, unknown>;
export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

export interface OwnerRegistrationResponse {
  owner_key_id: string;
  public_key_jwk: Jwk;
  private_key_jwk: Jwk;
  message?: string;
}

export interface LoginResponse {
  owner_key_id: string;
  message?: string;
}

export interface VerifyLoginResponse {
  authenticated: boolean;
  session_token: string;
  owner: Record<string, unknown>;
  agents: Array<Record<string, unknown>>;
}

export interface AgentRegistrationOptions {
  display_name: string;
  role: string;
  provider?: string | null;
  model?: string | null;
  scope: Record<string, unknown>;
  wallet_address?: string;
  plan?: string;
}

export interface CredentialResponse {
  ail_id: string;
  credential: Record<string, unknown>;
  signal_glyph: Record<string, unknown>;
  behavior_fingerprint: Record<string, unknown>;
  nft_image_url?: string;
  nft_metadata_url?: string;
  nft?: {
    token_id: string;
    tx_hash?: string;
  };
}

export interface OfflineVerificationResult {
  valid: boolean;
  ail_id?: string;
  display_name?: string;
  role?: string;
  owner_org?: string;
  issued?: string;
  expires?: string;
  reason?: string;
}

export interface AilClientOptions {
  serverUrl?: string;
}

export interface ReputationQueryParams {
  source?: string;
  season?: number;
  limit?: number;
  dimension?: string;
}

export interface ClientRegistrationOptions {
  name: string;
  allowed_origins: string[];
  redirect_uris: string[];
  admin_api_key: string;
}

export interface AuthCodeExchangeOptions {
  code: string;
  client_id: string;
  client_secret: string;
  origin?: string;
}

export interface QuickVerifyOptions {
  token: string;
  client_id: string;
  client_secret: string;
  origin?: string;
}

export declare class AilClient {
  constructor(options?: AilClientOptions);
  registerOwner(options: { email: string; org?: string }): Promise<OwnerRegistrationResponse>;
  verifyEmail(options: { owner_key_id: string; otp: string }): Promise<Record<string, unknown>>;
  loginOwner(options: { email: string }): Promise<LoginResponse>;
  verifyLogin(options: { owner_key_id: string; otp: string }): Promise<VerifyLoginResponse>;
  registerAgent(options: {
    owner_key_id: string;
    private_key_jwk: Jwk;
    payload: AgentRegistrationOptions;
  }): Promise<CredentialResponse>;
  registerAgentWithSession(options: {
    session_token: string;
    payload: AgentRegistrationOptions;
  }): Promise<CredentialResponse>;
  revokeAgent(options: {
    ail_id: string;
    owner_key_id: string;
    private_key_jwk: Jwk;
  }): Promise<Record<string, unknown>>;
  verify(token: string): Promise<Record<string, unknown>>;
  getAuthUrl(options: {
    client_id: string;
    redirect_uri: string;
    scope?: string;
    state?: string;
  }): string;
  registerClient(options: ClientRegistrationOptions): Promise<Record<string, unknown>>;
  exchangeAuthCode(options: AuthCodeExchangeOptions): Promise<Record<string, unknown>>;
  verifyQuick(options: QuickVerifyOptions): Promise<Record<string, unknown>>;
  verifyOffline(token: string): Promise<OfflineVerificationResult>;
  getPublicKeys(): Promise<Record<string, unknown>>;
  getReputation(ailId: string): Promise<Record<string, unknown>>;
  getReputationHistory(ailId: string, params?: ReputationQueryParams): Promise<Record<string, unknown>>;
  compareAgents(ailId: string, otherAilId: string): Promise<Record<string, unknown>>;
  getLeaderboard(params?: ReputationQueryParams): Promise<Record<string, unknown>>;
  getBadges(ailId: string): Promise<Record<string, unknown>>;
  getSeasonReport(ailId: string, season: number, params?: { source?: string }): Promise<Record<string, unknown>>;
  awardBadge(options: {
    source_name: string;
    agent_id: string;
    badge_id: string;
    private_key_jwk: Jwk;
    merkle_proof?: string | null;
  }): Promise<Record<string, unknown>>;
}

export declare function verifyOffline(token: string, publicKeyJwk: Jwk): Promise<OfflineVerificationResult>;
export declare function buildEnvelope(options: Record<string, unknown>): Record<string, unknown>;
export declare function generateOwnerKeypair(): Promise<{ public_key_jwk: Jwk; private_key_jwk: Jwk }>;
export declare function signPayload(payload: JsonValue | Record<string, unknown>, privateKeyJwk: Jwk): Promise<string>;
export declare function verifyOwnerSignature(
  payload: JsonValue | Record<string, unknown>,
  signatureB64url: string,
  publicKeyJwk: Jwk
): Promise<boolean>;
export declare function canonicalJson(obj: JsonValue | Record<string, unknown>): string;
export declare function sha256hexAsync(data: string): Promise<string>;
