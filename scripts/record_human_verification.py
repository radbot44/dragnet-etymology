#!/usr/bin/env python3
"""Promote a ledger citation record to 'human_verified' after independent human inspection of the scan."""
from __future__ import annotations

import argparse
import datetime as dt
import json
import sys
from pathlib import Path

SCRIPTS_DIR = Path(__file__).resolve().parent
if str(SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_DIR))

import validate_claims  # noqa: E402


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="Record independent human verification on a DRAgNEt citation record.")
    ap.add_argument("--ledger", required=True, help="Path to public/ledgers/<slug>.json")
    ap.add_argument("--id", required=True, help="Citation ID, e.g. CERT-1200-101")
    ap.add_argument("--verifier", required=True, help="Full name (and optional ORCID) of human reviewer")
    ap.add_argument("--date", default=dt.date.today().isoformat(), help="ISO date YYYY-MM-DD")
    args = ap.parse_args(argv)

    cid = args.id.strip()
    if cid.startswith("CLM-"):
        raise SystemExit(
            f"ERROR: '{cid}' is a claim ID. Use 'python3 scripts/record_claim_review.py --id {cid} --status human_reviewed ...' to record a claim review."
        )

    verifier = args.verifier.strip()
    if not verifier or validate_claims.NON_HUMAN_REVIEWER_RE.search(verifier) or not validate_claims.HUMAN_NAME_RE.search(verifier):
        raise SystemExit(
            f"ERROR: --verifier must name a human reviewer (First Last), got {verifier!r}."
        )
    if validate_claims.find_workspace_or_drive_leak(verifier):
        raise SystemExit("ERROR: --verifier contains a forbidden workspace or Drive identifier.")

    ver_date = args.date.strip()
    if not validate_claims.is_valid_iso_calendar_date(ver_date):
        raise SystemExit(f"ERROR: --date {ver_date!r} must be a valid ISO calendar date YYYY-MM-DD.")

    p = Path(args.ledger)
    if not p.exists():
        raise SystemExit(f"Ledger file not found: {p}")

    data = json.loads(p.read_text(encoding="utf-8"))
    matched = False
    for c in data.get("citations", []):
        if c.get("id") == cid:
            if c.get("verification_level") != "externally_recognized":
                c["verification_level"] = "human_verified"
            c["human_verified_by"] = verifier
            c["human_verified_date"] = ver_date
            matched = True
            break
    if not matched:
        raise SystemExit(f"Citation ID {cid} not found in {p}")

    p.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"[OK] Recorded human verification by '{verifier}' ({ver_date}) on {cid} in {p.name}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
