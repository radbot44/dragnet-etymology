#!/usr/bin/env python3
"""
ingest_monograph_ledger.py (DRAgNEt v3 Compatibility Wrapper)
-------------------------------------------------------------
Delegates to scripts/add_case.py (--ledger-only by default unless --monograph,
--claims-only, --sync-open-questions, or claims-without-ledger is supplied).
Supports all add_case.py flags including --claims, --claims-only, --scans-dir,
--merge-existing, and --sync-open-questions.
"""
from __future__ import annotations

import subprocess
import sys
from pathlib import Path


def _has_flag_with_value(argv: list[str], flag: str) -> bool:
    for idx, arg in enumerate(argv):
        if arg == flag and idx + 1 < len(argv) and argv[idx + 1].strip():
            return True
        if arg.startswith(f"{flag}=") and arg.split("=", 1)[1].strip():
            return True
    return False


def main(argv: list[str] | None = None) -> int:
    add_case = Path(__file__).resolve().parent / "add_case.py"
    raw_args = list(sys.argv[1:] if argv is None else argv)

    has_ledger = _has_flag_with_value(raw_args, "--ledger")
    has_claims = _has_flag_with_value(raw_args, "--claims")
    has_monograph = _has_flag_with_value(raw_args, "--monograph")
    has_ledger_only = "--ledger-only" in raw_args
    has_claims_only = "--claims-only" in raw_args
    has_sync_only = "--sync-open-questions" in raw_args and not has_ledger and not has_claims
    is_embargo_only = (
        not has_ledger
        and not has_claims
        and ("under_review" in raw_args or any(a == "--status=under_review" for a in raw_args))
    )

    if has_sync_only or is_embargo_only:
        pass
    elif has_claims_only or (has_claims and not has_ledger and not has_monograph):
        if "--claims-only" not in raw_args:
            raw_args.append("--claims-only")
        if "--no-bump" not in raw_args:
            raw_args.append("--no-bump")
    elif not has_monograph and not has_ledger_only:
        raw_args.append("--ledger-only")
        if "--no-bump" not in raw_args:
            raw_args.append("--no-bump")

    return subprocess.call([sys.executable, str(add_case), *raw_args])


if __name__ == "__main__":
    raise SystemExit(main())
