"""
ail-sdk — Python SDK for 22B Labs Agent Identity Layer.

Quick start:
    from ail_sdk import AilClient

    client = AilClient(server_url="http://127.0.0.1:3317")

    # 1. Register owner
    owner = client.register_owner(email="you@example.com", org="your_org")

    # 2. Verify email
    client.verify_email(owner_key_id=owner["owner_key_id"], otp=owner["_dev_otp"])

    # 3. Register agent
    agent = client.register_agent(
        owner_key_id=owner["owner_key_id"],
        private_key_jwk=owner["private_key_jwk"],
        payload={
            "display_name": "MyAgent",
            "role": "assistant",
            "scope": {
                "network": "none",
                "secrets": "none",
                "write_access": False,
                "approval_policy": {
                    "irreversible_actions": "human_required",
                    "external_posting": "human_required",
                    "destructive_file_ops": "human_required",
                },
            },
        },
    )

    # 4. Verify credential
    result = client.verify(agent["credential"]["token"])
    print(result["valid"], result["ail_id"])
"""

from .client import AilClient, AilError, verify_offline
from .crypto import (
    generate_owner_keypair,
    sign_payload,
    verify_owner_signature,
    canonical_json,
    compute_behavior_fingerprint,
    compute_glyph_seed,
)
from .envelope import build_envelope

__all__ = [
    "AilClient",
    "AilError",
    "verify_offline",
    "generate_owner_keypair",
    "sign_payload",
    "verify_owner_signature",
    "canonical_json",
    "compute_behavior_fingerprint",
    "compute_glyph_seed",
    "build_envelope",
]
