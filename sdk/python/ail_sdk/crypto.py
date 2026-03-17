"""
Crypto utilities for the AIL Python SDK.
Uses the `cryptography` library for EC P-256 key operations.
"""

import base64
import hashlib
import json
import os

from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.hazmat.primitives.asymmetric.utils import (
    decode_dss_signature,
    encode_dss_signature,
)
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric.ec import (
    EllipticCurvePublicNumbers,
    SECP256R1,
)


# ---------------------------------------------------------------------------
# Canonical JSON
# ---------------------------------------------------------------------------

def canonical_json(obj: dict) -> str:
    """Recursively sort object keys and serialize to JSON."""
    return json.dumps(obj, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


# ---------------------------------------------------------------------------
# SHA-256
# ---------------------------------------------------------------------------

def sha256hex(data: str | bytes) -> str:
    if isinstance(data, str):
        data = data.encode("utf-8")
    return hashlib.sha256(data).hexdigest()


# ---------------------------------------------------------------------------
# JWK helpers
# ---------------------------------------------------------------------------

def _b64url_to_int(b64: str) -> int:
    padded = b64 + "=" * (-len(b64) % 4)
    return int.from_bytes(base64.urlsafe_b64decode(padded), "big")


def _int_to_b64url(n: int, length: int = 32) -> str:
    return base64.urlsafe_b64encode(n.to_bytes(length, "big")).rstrip(b"=").decode()


def public_key_from_jwk(jwk: dict):
    """Load an EC P-256 public key from a JWK dict."""
    x = _b64url_to_int(jwk["x"])
    y = _b64url_to_int(jwk["y"])
    pub_numbers = EllipticCurvePublicNumbers(x, y, SECP256R1())
    return pub_numbers.public_key()


def private_key_from_jwk(jwk: dict):
    """Load an EC P-256 private key from a JWK dict."""
    pub = public_key_from_jwk(jwk)
    d = _b64url_to_int(jwk["d"])
    priv_numbers = ec.EllipticCurvePrivateNumbers(d, pub.public_numbers())
    return priv_numbers.private_key()


def public_key_to_jwk(public_key) -> dict:
    """Export EC P-256 public key to JWK dict."""
    pub_numbers = public_key.public_key().public_numbers()
    return {
        "kty": "EC",
        "crv": "P-256",
        "x": _int_to_b64url(pub_numbers.x),
        "y": _int_to_b64url(pub_numbers.y),
        "key_ops": ["verify"],
        "ext": True,
    }


def private_key_to_jwk(private_key) -> dict:
    """Export EC P-256 private key to JWK dict (includes public key fields)."""
    priv_numbers = private_key.private_numbers()
    pub_numbers = priv_numbers.public_numbers
    return {
        "kty": "EC",
        "crv": "P-256",
        "x": _int_to_b64url(pub_numbers.x),
        "y": _int_to_b64url(pub_numbers.y),
        "d": _int_to_b64url(priv_numbers.private_value),
        "key_ops": ["sign"],
        "ext": True,
    }


# ---------------------------------------------------------------------------
# Keypair generation
# ---------------------------------------------------------------------------

def generate_owner_keypair() -> dict:
    """
    Generate an EC P-256 keypair for owner registration.

    Returns:
        { "public_key_jwk": {...}, "private_key_jwk": {...} }

    The private key must be stored securely by the caller.
    """
    private_key = ec.generate_private_key(SECP256R1())
    return {
        "public_key_jwk": public_key_to_jwk(private_key),
        "private_key_jwk": private_key_to_jwk(private_key),
    }


# ---------------------------------------------------------------------------
# Signing
# ---------------------------------------------------------------------------

def sign_payload(payload: dict, private_key_jwk: dict) -> str:
    """
    Sign a registration or revoke payload with the owner's private key.

    Signature format: IEEE P1363 (raw r || s, 64 bytes), base64url encoded.
    This matches the format expected by the AIL issuance server.

    Returns:
        base64url-encoded signature string
    """
    private_key = private_key_from_jwk(private_key_jwk)
    data = canonical_json(payload).encode("utf-8")

    # `cryptography` returns DER format; convert to P1363 (raw r || s)
    der_sig = private_key.sign(data, ec.ECDSA(hashes.SHA256()))
    r, s = decode_dss_signature(der_sig)
    raw_sig = r.to_bytes(32, "big") + s.to_bytes(32, "big")

    return base64.urlsafe_b64encode(raw_sig).rstrip(b"=").decode()


# ---------------------------------------------------------------------------
# Verification
# ---------------------------------------------------------------------------

def verify_owner_signature(payload: dict, signature_b64url: str, public_key_jwk: dict) -> bool:
    """Verify an owner's ECDSA/SHA-256 signature over canonical JSON of payload."""
    try:
        public_key = public_key_from_jwk(public_key_jwk)
        data = canonical_json(payload).encode("utf-8")

        padded = signature_b64url + "=" * (-len(signature_b64url) % 4)
        raw_sig = base64.urlsafe_b64decode(padded)
        r = int.from_bytes(raw_sig[:32], "big")
        s = int.from_bytes(raw_sig[32:], "big")
        der_sig = encode_dss_signature(r, s)

        public_key.verify(der_sig, data, ec.ECDSA(hashes.SHA256()))
        return True
    except Exception:
        return False


# ---------------------------------------------------------------------------
# Behavior fingerprint and glyph seed (mirrors server logic)
# ---------------------------------------------------------------------------

def compute_behavior_fingerprint(role: str, provider: str | None, scope: dict) -> dict:
    inputs = {
        "network": scope.get("network"),
        "provider": provider,
        "role": role,
        "secrets": scope.get("secrets"),
        "write_access": scope.get("write_access"),
    }
    h = sha256hex(canonical_json(inputs))
    return {
        "hash": f"sha256:{h}",
        "algorithm": "sha256",
        "inputs": ["role", "scope.network", "scope.secrets", "scope.write_access", "provider"],
    }


def compute_glyph_seed(ail_id: str, display_name: str, owner_key_id: str) -> dict:
    return {
        "seed": f"{ail_id}:{display_name}:{owner_key_id}",
        "algorithm": "sha256-visual-v1",
        "version": "glyph.v1",
    }
