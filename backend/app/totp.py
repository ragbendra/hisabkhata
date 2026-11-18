"""Authenticator-app codes (RFC 6238: 6 digits, 30 seconds, SHA-1). Small enough to keep without a dependency."""

import base64
import hashlib
import hmac
import secrets
import struct
import time
from urllib.parse import quote


def new_secret() -> str:
    return base64.b32encode(secrets.token_bytes(20)).decode().rstrip("=")


def _code(secret: str, counter: int) -> str:
    key = base64.b32decode(secret + "=" * (-len(secret) % 8))
    mac = hmac.new(key, struct.pack(">Q", counter), hashlib.sha1).digest()
    o = mac[-1] & 0x0F
    n = (struct.unpack(">I", mac[o : o + 4])[0] & 0x7FFFFFFF) % 1_000_000
    return f"{n:06d}"


def verify(secret: str, code: str, at: float | None = None, window: int = 1) -> bool:
    code = (code or "").strip().replace(" ", "")
    if len(code) != 6 or not code.isdigit():
        return False
    step = int((at if at is not None else time.time()) // 30)
    return any(hmac.compare_digest(_code(secret, step + d), code) for d in range(-window, window + 1))


def uri(secret: str, email: str) -> str:
    return f"otpauth://totp/Hisab%20Admin:{quote(email)}?secret={secret}&issuer=Hisab%20Admin"
