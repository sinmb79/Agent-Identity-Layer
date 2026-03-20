"""
AilClient communicates with the Agent ID Card issuance server.

Usage:
    from agentidcard import AilClient

    client = AilClient(server_url="https://api.agentidcard.org")
"""

import requests
from urllib.parse import urlencode
from .crypto import sign_payload


class AilClient:
    def __init__(self, server_url: str = "https://api.agentidcard.org"):
        self.server_url = server_url.rstrip("/")
        self._session = requests.Session()
        self._session.headers.update({"Content-Type": "application/json"})

    def _post(self, path: str, body: dict) -> dict:
        res = self._session.post(f"{self.server_url}{path}", json=body)
        data = res.json()
        if not res.ok:
            msg = data.get("message") or data.get("error") or f"HTTP {res.status_code}"
            raise AilError(msg, code=data.get("error"), status=res.status_code)
        return data

    def _get(self, path: str) -> dict:
        res = self._session.get(f"{self.server_url}{path}")
        if not res.ok:
            raise AilError(f"HTTP {res.status_code}", status=res.status_code)
        return res.json()

    def _delete(self, path: str, body: dict) -> dict:
        res = self._session.delete(f"{self.server_url}{path}", json=body)
        data = res.json()
        if not res.ok:
            raise AilError(data.get("error") or f"HTTP {res.status_code}", status=res.status_code)
        return data

    def _with_query(self, path: str, params: dict | None = None) -> str:
        if not params:
            return path
        filtered = {
            key: value
            for key, value in params.items()
            if value is not None and value != ""
        }
        if not filtered:
            return path
        return f"{path}?{urlencode(filtered)}"

    # -------------------------------------------------------------------------
    # Owner registration and login
    # -------------------------------------------------------------------------

    def register_owner(self, email: str, org: str | None = None) -> dict:
        """
        Register a new owner and receive their EC P-256 keypair.
        Store private_key_jwk securely - the server does not keep it.
        """
        return self._post("/owners/register", {"email": email, "org": org})

    def verify_email(self, owner_key_id: str, otp: str) -> dict:
        """Confirm email ownership with the OTP received after registration."""
        return self._post("/owners/verify-email", {"owner_key_id": owner_key_id, "otp": otp})

    def login_owner(self, email: str) -> dict:
        """Request a login OTP for an existing verified owner."""
        return self._post("/owners/login", {"email": email})

    def verify_login(self, owner_key_id: str, otp: str) -> dict:
        """Verify a login OTP and receive a session token."""
        return self._post("/owners/verify-login", {"owner_key_id": owner_key_id, "otp": otp})

    # -------------------------------------------------------------------------
    # Agent registration
    # -------------------------------------------------------------------------

    def register_agent(
        self,
        owner_key_id: str,
        private_key_jwk: dict,
        payload: dict,
    ) -> dict:
        """
        Register an agent and receive a signed v1 credential.

        The SDK signs the payload with the owner's private key automatically.
        """
        owner_signature = sign_payload(payload, private_key_jwk)
        return self._post(
            "/agents/register",
            {"owner_key_id": owner_key_id, "payload": payload, "owner_signature": owner_signature},
        )

    def register_agent_with_session(self, session_token: str, payload: dict) -> dict:
        """Register an agent using a session token from verify_login."""
        return self._post(
            "/agents/register-session",
            {"session_token": session_token, "payload": payload},
        )

    # -------------------------------------------------------------------------
    # Revocation
    # -------------------------------------------------------------------------

    def revoke_agent(self, ail_id: str, owner_key_id: str, private_key_jwk: dict) -> dict:
        """
        Revoke an agent's credential.
        The SDK signs the revoke payload with the owner's private key automatically.
        """
        revoke_payload = {"action": "revoke", "ail_id": ail_id}
        owner_signature = sign_payload(revoke_payload, private_key_jwk)
        return self._delete(
            f"/agents/{ail_id}/revoke",
            {"owner_key_id": owner_key_id, "owner_signature": owner_signature},
        )

    # -------------------------------------------------------------------------
    # Verification
    # -------------------------------------------------------------------------

    def verify(self, token: str) -> dict:
        """Verify a credential online (calls the server)."""
        return self._post("/verify", {"token": token})

    def verify_offline(self, token: str) -> dict:
        """
        Verify a credential offline using the server's public key.
        Fetches the JWKS once per client instance.
        """
        if not hasattr(self, "_cached_public_key_jwk"):
            jwks = self.get_public_keys()
            self._cached_public_key_jwk = jwks["keys"][0]
        return verify_offline(token, self._cached_public_key_jwk)

    def get_public_keys(self) -> dict:
        """Fetch the Agent ID Card JWKS (public keys for offline verification)."""
        return self._get("/keys")

    # -------------------------------------------------------------------------
    # Reputation and achievements
    # -------------------------------------------------------------------------

    def get_reputation(self, ail_id: str) -> dict:
        return self._get(f"/reputation/{ail_id}")

    def get_reputation_history(self, ail_id: str, **params) -> dict:
        return self._get(self._with_query(f"/reputation/{ail_id}/history", params))

    def compare_agents(self, ail_id_1: str, ail_id_2: str) -> dict:
        return self._get(self._with_query(f"/reputation/{ail_id_1}/compare", {"with": ail_id_2}))

    def get_leaderboard(self, **params) -> dict:
        return self._get(self._with_query("/reputation/leaderboard", params))

    def get_badges(self, ail_id: str) -> dict:
        return self._get(f"/reputation/{ail_id}/badges")

    def get_season_report(self, ail_id: str, season: int, **params) -> dict:
        return self._get(self._with_query(f"/reputation/{ail_id}/season/{season}", params))

    def award_badge(
        self,
        source_name: str,
        agent_id: str,
        badge_id: str,
        private_key_jwk: dict,
        merkle_proof: str | None = None,
    ) -> dict:
        payload = {
            "source_name": source_name,
            "agent_id": agent_id,
            "badge_id": badge_id,
            "merkle_proof": merkle_proof,
        }
        signature = sign_payload(payload, private_key_jwk)
        return self._post("/reputation/badge", {**payload, "signature": signature})


# ---------------------------------------------------------------------------
# Standalone offline verification
# ---------------------------------------------------------------------------

def verify_offline(token: str, public_key_jwk: dict) -> dict:
    """
    Verify a credential JWT offline without calling the server.

    Args:
        token: The credential JWT string.
        public_key_jwk: The Agent ID Card public key JWK (from GET /keys).

    Returns:
        { valid, ail_id, display_name, role, owner_org, issued, expires }
        or { valid: False, reason: str }
    """
    import jwt as pyjwt
    from .crypto import public_key_from_jwk

    try:
        public_key = public_key_from_jwk(public_key_jwk)
        payload = pyjwt.decode(
            token,
            public_key,
            algorithms=["ES256"],
            options={"require": ["iss", "sub", "exp", "iat"]},
        )

        if payload.get("iss") not in {"22blabs.ai", "agentidcard.org"}:
            return {"valid": False, "reason": "invalid_issuer"}

        import datetime
        return {
            "valid": True,
            "ail_id": payload.get("ail_id"),
            "display_name": payload.get("display_name"),
            "role": payload.get("role"),
            "owner_org": payload.get("owner_org"),
            "issued": datetime.datetime.fromtimestamp(
                payload["iat"], tz=datetime.timezone.utc
            ).isoformat(),
            "expires": datetime.datetime.fromtimestamp(
                payload["exp"], tz=datetime.timezone.utc
            ).isoformat(),
        }
    except Exception as e:
        return {"valid": False, "reason": str(e)}


# ---------------------------------------------------------------------------
# Errors
# ---------------------------------------------------------------------------

class AilError(Exception):
    def __init__(self, message: str, code: str | None = None, status: int | None = None):
        super().__init__(message)
        self.code = code
        self.status = status
