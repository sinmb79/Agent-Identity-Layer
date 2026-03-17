"""
AilClient — communicates with a 22B Labs AIL Issuance Server.

Usage:
    from ail_sdk import AilClient

    client = AilClient(server_url="http://127.0.0.1:3317")

    owner = client.register_owner(email="boss@example.com", org="my_org")
    client.verify_email(owner_key_id=owner["owner_key_id"], otp=owner["_dev_otp"])
    agent = client.register_agent(
        owner_key_id=owner["owner_key_id"],
        private_key_jwk=owner["private_key_jwk"],
        payload={
            "display_name": "MyAgent",
            "role": "assistant",
            "scope": { "network": "none", "secrets": "none",
                       "write_access": False,
                       "approval_policy": { "irreversible_actions": "human_required",
                                            "external_posting": "human_required",
                                            "destructive_file_ops": "human_required" } },
        },
    )
    result = client.verify(agent["credential"]["token"])
"""

import requests
from .crypto import sign_payload


class AilClient:
    def __init__(self, server_url: str = "http://127.0.0.1:3317"):
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

    # -------------------------------------------------------------------------
    # Owner registration
    # -------------------------------------------------------------------------

    def register_owner(self, email: str, org: str | None = None) -> dict:
        """
        Register a new owner and receive their EC P-256 keypair.
        Store private_key_jwk securely — the server does not keep it.
        """
        return self._post("/owners/register", {"email": email, "org": org})

    def verify_email(self, owner_key_id: str, otp: str) -> dict:
        """Confirm email ownership with the OTP received after registration."""
        return self._post("/owners/verify-email", {"owner_key_id": owner_key_id, "otp": otp})

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

        Args:
            owner_key_id:    The owner's key ID (from register_owner response).
            private_key_jwk: The owner's private key JWK (from register_owner response).
            payload:         { display_name, role, provider?, model?, scope }

        Returns:
            { ail_id, credential, signal_glyph, behavior_fingerprint }
        """
        owner_signature = sign_payload(payload, private_key_jwk)
        return self._post(
            "/agents/register",
            {"owner_key_id": owner_key_id, "payload": payload, "owner_signature": owner_signature},
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
        """Fetch the 22B Labs JWKS (public keys for offline verification)."""
        return self._get("/keys")


# ---------------------------------------------------------------------------
# Standalone offline verification
# ---------------------------------------------------------------------------

def verify_offline(token: str, public_key_jwk: dict) -> dict:
    """
    Verify a credential JWT offline without calling the server.

    Args:
        token:          The credential JWT string.
        public_key_jwk: The 22B Labs public key JWK (from GET /keys).

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

        if payload.get("iss") != "22blabs.ai":
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
