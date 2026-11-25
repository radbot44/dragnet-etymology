#!/usr/bin/env python3
"""Promote a ledger citation record to 'human_verified' after independent human inspection of the scan."""
from __future__ import annotations
import argparse
import datetime as dt
import json
from pathlib import Path


def main() -> int:
    ap = argparse.ArgumentParser(description="Record independent human verification on a DRAgNEt citation record.")
    ap.add_argument("--ledger", required=True, help="Path to public/ledgers/<slug>.json")
    ap.add_argument("--id", required=True, help="Citation ID, e.g. CERT-1200-101")
    ap.add_argument("--verifier", required=True, help="Full name (and optional ORCID) of human reviewer")
    ap.add_argument("--date", default=dt.date.today().isoformat(), help="ISO date YYYY-MM-DD")
    args = ap.parse_args()

    p = Path(args.ledger)
    data = json.loads(p.read_text(encoding="utf-8"))
    matched = False
    for c in data.get("citations", []):
        if c.get("id") == args.id:
            if c.get("verification_level") != "externally_recognized":
                c["verification_level"] = "human_verified"
            c["human_verified_by"] = args.verifier
            c["human_verified_date"] = args.date
            matched = True
            break
    if not matched:
        raise SystemExit(f"Citation ID {args.id} not found in {p}")

    p.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"[OK] Recorded human verification by '{args.verifier}' ({args.date}) on {args.id} in {p.name}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
