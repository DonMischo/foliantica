import os
import base64
from pathlib import Path
from cryptography.fernet import Fernet

_KEY_ENV  = "FOLIANTICA_SECRET_KEY"
# Always stored locally — never in the cloud-synced dataDir.
_KEY_DIR  = Path.home() / ".foliantica"
_KEY_FILE = _KEY_DIR / ".secret_key"


def _load_or_create_key() -> bytes:
    # 1. Environment variable (Docker / CI override)
    env_key = os.environ.get(_KEY_ENV)
    if env_key:
        return base64.urlsafe_b64decode(env_key)

    # 2. Canonical local location
    if _KEY_FILE.exists():
        return _KEY_FILE.read_bytes().strip()

    # 3. Migration: old key lived in CWD (= dataDir, possibly Google Drive).
    #    Copy it to the local location then remove it from the cloud folder.
    legacy = Path(".secret_key")
    if legacy.exists():
        key = legacy.read_bytes().strip()
        _KEY_DIR.mkdir(parents=True, exist_ok=True)
        _KEY_FILE.write_bytes(key)
        try:
            legacy.unlink()   # remove from cloud-synced folder
        except OSError:
            pass              # best-effort; non-fatal
        return key

    # 4. First run: generate and save to local-only location
    key = Fernet.generate_key()
    _KEY_DIR.mkdir(parents=True, exist_ok=True)
    _KEY_FILE.write_bytes(key)
    return key


_fernet = Fernet(_load_or_create_key())


def encrypt(plaintext: str) -> str:
    return _fernet.encrypt(plaintext.encode()).decode()


def decrypt(ciphertext: str) -> str | None:
    """Decrypt a Fernet token.  Returns None if the token was encrypted with a
    different key (e.g. database loaded from another machine) rather than raising,
    so callers treat it as 'no key configured' instead of a 500 error."""
    try:
        return _fernet.decrypt(ciphertext.encode()).decode()
    except Exception:
        return None
