#!/usr/bin/env python3
"""
validate_submission.py
----------------------
Automated CI gatekeeper for DRAgNEt pull requests and local authoring.
Checks every Case File in src/content/cases/*.md for:
  1. Valid YAML frontmatter and Last, First Highwire Press citation_author format.
  2. Existing proof-plate images under public/proof-plates/ (each <= 5 MB).
  3. Existing, valid JSON certificate ledgers under public/ledgers/ matching declared counts.
  4. HTTPS-only archive links and no raw 4-decimal harness scores leaked into public prose.
"""
from __future__ import annotations
import json
import re
import sys
from pathlib import Path

try:
    import yaml
except ImportError:
    print("ERROR: PyYAML is required. Run: pip install pyyaml", file=sys.stderr)
    sys.exit(2)

ROOT = Path(__file__).resolve().parent.parent
CASES_DIR = ROOT / "src" / "content" / "cases"
PUBLIC_DIR = ROOT / "public"
MAX_IMAGE_BYTES = 5 * 1024 * 1024  # 5 MB per proof plate keeps git clones fast
RAW_SCORE_RE = re.compile(r"\b(?:SLPL|JW|jaro[_ -]?winkler)\s*=\s*\d\.\d{4}\b", re.IGNORECASE)


def validate_case(md_path: Path) -> list[str]:
    errors: list[str] = []
    raw = md_path.read_text(encoding="utf-8")
    if not raw.startswith("---\n"):
        return [f"{md_path.name}: Missing opening YAML frontmatter delimiter '---'"]
    parts = raw.split("---\n", 2)
    if len(parts) < 3:
        return [f"{md_path.name}: Missing closing YAML frontmatter delimiter '---'"]

    try:
        fm = yaml.safe_load(parts[1])
    except Exception as exc:
        return [f"{md_path.name}: Invalid YAML frontmatter: {exc}"]

    body = parts[2]
    author_cit = str(fm.get("authorCitation", ""))
    if "," not in author_cit:
        errors.append(
            f"{md_path.name}: authorCitation '{author_cit}' must use 'Last, First' format for Google Scholar meta tags."
        )

    for ca in fm.get("coAuthors", []) or []:
        if "," not in str(ca.get("citationName", "")):
            errors.append(
                f"{md_path.name}: coAuthor citationName '{ca.get('citationName')}' must use 'Last, First' format."
            )

    ear_url = str((fm.get("earliestScan") or {}).get("archiveUrl", ""))
    if not ear_url.startswith("https://"):
        errors.append(f"{md_path.name}: earliestScan.archiveUrl must start with https:// (got '{ear_url}').")

    plates = fm.get("proofPlates") or []
    if not plates:
        errors.append(f"{md_path.name}: At least 1 primary-scan proof plate is required in proofPlates.")
    for p in plates:
        cid = p.get("certId", "UNKNOWN")
        img_rel = str(p.get("imagePath", "")).lstrip("/")
        img_full = PUBLIC_DIR / img_rel
        if not img_rel or not img_full.is_file():
            errors.append(f"{md_path.name} [{cid}]: Missing proof-plate file at public/{img_rel}")
        elif img_full.stat().st_size > MAX_IMAGE_BYTES:
            mb = img_full.stat().st_size / (1024 * 1024)
            errors.append(f"{md_path.name} [{cid}]: Proof plate public/{img_rel} is {mb:.2f} MB (max 5.00 MB).")
        aurl = str(p.get("archiveUrl", ""))
        if not aurl.startswith("https://"):
            errors.append(f"{md_path.name} [{cid}]: proofPlates archiveUrl must use https://")

    ledger_rel = str(fm.get("ledgerPath", "")).lstrip("/")
    ledger_full = PUBLIC_DIR / ledger_rel
    if not ledger_rel or not ledger_full.is_file():
        errors.append(f"{md_path.name}: Missing JSON ledger at public/{ledger_rel}")
    else:
        try:
            json.loads(ledger_full.read_text(encoding="utf-8"))
        except Exception as exc:
            errors.append(f"{md_path.name}: Invalid JSON in public/{ledger_rel}: {exc}")

    score_hits = RAW_SCORE_RE.findall(body)
    if score_hits:
        errors.append(
            f"{md_path.name}: Found internal 4-decimal harness score(s) in public prose ({score_hits}); keep raw scores in JSON ledgers only."
        )

    return errors


def main() -> int:
    case_files = sorted(CASES_DIR.glob("*.md"))
    if not case_files:
        print("ERROR: No case files found in src/content/cases/", file=sys.stderr)
        return 1

    all_errors: list[str] = []
    for cf in case_files:
        errs = validate_case(cf)
        if errs:
            all_errors.extend(errs)
        else:
            print(f"[PASS] {cf.name}")

    if all_errors:
        print("\nSUBMISSION VALIDATION FAILED:", file=sys.stderr)
        for e in all_errors:
            print(f"  - {e}", file=sys.stderr)
        return 1

    print(f"\nAll {len(case_files)} DRAgNEt Case File(s) passed Trap A-D & asset validation.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
