#!/usr/bin/env python3
"""
ingest_monograph_ledger.py (DRAgNEt v3 Compatibility Wrapper)
-------------------------------------------------------------
Delegates to scripts/add_case.py (--ledger-only by default unless --monograph is supplied).
For full one-command ingestion of a monograph + ledger + scans, prefer:
  python scripts/add_case.py --ledger ... --monograph ... --scans ... --slug ...
"""
from __future__ import annotations
import subprocess
import sys
from pathlib import Path


def main() -> int:
    add_case = Path(__file__).resolve().parent / "add_case.py"
    argv = sys.argv[1:]
    if "--monograph" not in argv and "--ledger-only" not in argv:
        argv = [*argv, "--ledger-only", "--no-bump"]
    return subprocess.call([sys.executable, str(add_case), *argv])


if __name__ == "__main__":
    raise SystemExit(main())
