"""Fill `.env` with generated secrets, for a machine that has no operator.

`run.ps1 setup` / `run.sh setup` do this interactively. CI needs the same file
without a person present, and it needs the admin password to be one the browser
suite can sign in with -- so the value lives here rather than being invented in
two places that can drift apart.

Not for anything but CI: the admin password below is a known constant.
"""

from __future__ import annotations

import base64
import os
import re
import secrets
import shutil
import sys
from pathlib import Path

#: The password the smoke and browser suites sign in with.
CI_ADMIN_PASSWORD = "SmokeTestPass123!"


def main() -> int:
    root = Path(__file__).resolve().parent.parent
    target = root / ".env"
    if not target.exists():
        shutil.copyfile(root / ".env.example", target)

    text = target.read_text(encoding="utf-8")

    # Fernet needs 32 raw bytes, urlsafe-base64 encoded (SRS 12.2).
    key = base64.urlsafe_b64encode(os.urandom(32)).decode()
    replacements = [
        (r"SECRET_ENCRYPTION_KEY=.*", f"SECRET_ENCRYPTION_KEY={key}"),
        (r"JWT_SECRET=.*", f"JWT_SECRET={secrets.token_urlsafe(36)}"),
        (r"ENGINE_INTERNAL_TOKEN=.*", f"ENGINE_INTERNAL_TOKEN={secrets.token_urlsafe(24)}"),
        (r"BOOTSTRAP_ADMIN_PASSWORD=.*", f"BOOTSTRAP_ADMIN_PASSWORD={CI_ADMIN_PASSWORD}"),
    ]
    for pattern, value in replacements:
        text, count = re.subn(pattern, value, text, count=1)
        if count == 0:
            print(f"no line matching {pattern} in .env.example", file=sys.stderr)
            return 1

    target.write_text(text, encoding="utf-8")
    print(f"wrote {target}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
