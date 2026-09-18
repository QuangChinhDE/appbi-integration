"""Assert that a command FAILS, and fail if it succeeds.

Several of this repository's gates are only meaningful inverted: the whole
point of `.env.production.example` is that the doctor refuses it, and the whole
point of the licence gate is that a commercial release cannot pass while the
review is open. CI already expresses these as `if <cmd>; then exit 1; fi`,
which is correct in bash and unavailable to a cross-platform runner.

    python scripts/refuse.py <command> [args...]

Exit 0 when the command exits non-zero. Exit 1 when it succeeds -- and say so
loudly, because a gate that has quietly started passing is the failure mode
that matters.
"""

from __future__ import annotations

import subprocess
import sys


def main() -> int:
    if len(sys.argv) < 2:
        print("usage: refuse.py <command> [args...]", file=sys.stderr)
        return 2

    command = sys.argv[1:]
    completed = subprocess.run(command, capture_output=True, text=True,
                               encoding="utf-8", errors="replace")

    if completed.returncode != 0:
        print(f"correctly refused (exit {completed.returncode}): {' '.join(command)}")
        return 0

    print(f"ERROR: this command was expected to FAIL and it passed:\n"
          f"  {' '.join(command)}\n"
          f"A gate that no longer refuses is a gate that is switched off.",
          file=sys.stderr)
    if completed.stdout:
        print(completed.stdout[-2000:], file=sys.stderr)
    return 1


if __name__ == "__main__":
    sys.exit(main())
