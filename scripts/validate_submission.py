#!/usr/bin/env python3
"""
validate_submission.py (DRAgNEt v3)
-----------------------------------
Automated structural, cross-reference, rights-boundary, and sanitization validator.

What this script ACTUALLY verifies:
  1. Workspace Sanitization: Zero Google Drive/Docs links or internal workspace IDs in src/, public/, or research-system/.
  2. Ledger Schema & Verification Rules: Every record in public/ledgers/*.json has valid record_type and verification_level;
     records marked 'human_verified' MUST name human_verified_by and human_verified_date; records marked 'externally_recognized'
     MUST include external_recognition.
  3. Evidence & Image-Rights Gate: Every attestation/hypothesis has an https:// source_url; every hosted_path exists on disk
     (<= 5 MB); works with publication_year > 1930 may NOT bundle scans in public/scans/ unless explicitly cleared.
  4. Bidirectional Cross-Referencing: Every citation ID referenced in a Case File's YAML frontmatter OR Markdown prose
     exists in that Case File's JSON ledger.
  5. Editorial Lint: Author citations use 'Last, First' format; prose and frontmatter contain no raw 4-decimal harness
     scores or artificial decimal-year antedating strings (e.g., '-30.9 yrs').

What this script DOES NOT verify (requires human philological review):
  - Historical accuracy of diplomatic transcriptions against page ink, semantic interpretation, or completeness of prior art.
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
LEDGERS_DIR = ROOT / "public" / "ledgers"
PUBLIC_DIR = ROOT / "public"

VALID_RECORD_TYPES = {"attestation", "contextual_evidence", "hypothesis", "rejected_lead"}
VALID_VER_LEVELS = {"discovered", "agent_verified", "human_verified", "externally_recognized"}
MAX_IMAGE_BYTES = 5 * 1024 * 1024

WORKSPACE_LEAK_RE = re.compile(
    r"(?:drive\.google\.com|docs\.google\.com|googledrive://|workspace_drive_folder_id|evidence_scans_folder_id|scan_evidence_drive_id)",
    re.IGNORECASE,
)
RAW_SCORE_RE = re.compile(r"\b(?:SLPL|JW|jaro[_ -]?winkler|skeleton_similarity)\s*=\s*\d\.\d{3,4}\b", re.IGNORECASE)
DECIMAL_YEAR_RE = re.compile(r"(?:-?\b\d+\.\d+\s*(?:yrs?|years?)\b)", re.IGNORECASE)
CERT_ID_RE = re.compile(r"\bCERT-\d{3,4}-\d{3}\b")


def check_workspace_leaks() -> list[str]:
    errors: list[str] = []
    for folder in (ROOT / "src", ROOT / "public", ROOT / "research-system"):
        if not folder.exists():
            continue
        for p in folder.rglob("*"):
            if p.is_file() and p.suffix.lower() in {".json", ".md", ".astro", ".ts", ".js", ".py"}:
                txt = p.read_text(encoding="utf-8", errors="ignore")
                m = WORKSPACE_LEAK_RE.search(txt)
                if m:
                    errors.append(f"Workspace identifier/URL leak '{m.group(0)}' found in {p.relative_to(ROOT)}")
    return errors


def validate_ledger(ledger_path: Path) -> tuple[set[str], list[str]]:
    errors: list[str] = []
    try:
        data = json.loads(ledger_path.read_text(encoding="utf-8"))
    except Exception as exc:
        return set(), [f"{ledger_path.name}: Invalid JSON: {exc}"]

    if data.get("schema_version") != "3.0":
        errors.append(f"{ledger_path.name}: Expected schema_version '3.0', got {data.get('schema_version')!r}")

    citations = data.get("citations")
    if not isinstance(citations, list) or not citations:
        return set(), [f"{ledger_path.name}: Missing or empty 'citations' array"]

    seen_ids: set[str] = set()
    for c in citations:
        cid = str(c.get("id") or "")
        if not cid:
            errors.append(f"{ledger_path.name}: Citation record missing 'id'")
            continue
        if cid in seen_ids:
            errors.append(f"{ledger_path.name}: Duplicate citation id '{cid}'")
        seen_ids.add(cid)

        rt = c.get("record_type")
        if rt not in VALID_RECORD_TYPES:
            errors.append(f"{ledger_path.name} [{cid}]: Invalid record_type {rt!r}")

        vl = c.get("verification_level")
        if vl not in VALID_VER_LEVELS:
            errors.append(f"{ledger_path.name} [{cid}]: Invalid verification_level {vl!r}")

        if vl == "human_verified":
            if not c.get("human_verified_by") or not c.get("human_verified_date"):
                errors.append(
                    f"{ledger_path.name} [{cid}]: verification_level 'human_verified' requires non-empty human_verified_by and human_verified_date"
                )
        if vl == "externally_recognized" and not c.get("external_recognition"):
            errors.append(
                f"{ledger_path.name} [{cid}]: verification_level 'externally_recognized' requires external_recognition note"
            )

        surl = str(c.get("source_url") or "")
        if not surl.startswith("https://"):
            errors.append(f"{ledger_path.name} [{cid}]: source_url must use https:// (got {surl!r})")

        scan = c.get("scan") or {}
        hosted = scan.get("hosted_path")
        pub_yr = c.get("publication_year")
        if hosted:
            full_img = PUBLIC_DIR / str(hosted).lstrip("/")
            if not full_img.is_file():
                errors.append(f"{ledger_path.name} [{cid}]: Missing hosted scan file at public/{str(hosted).lstrip('/')}")
            elif full_img.stat().st_size > MAX_IMAGE_BYTES:
                errors.append(f"{ledger_path.name} [{cid}]: Hosted scan exceeds 5 MB limit")
            if isinstance(pub_yr, int) and pub_yr > 1930 and scan.get("rights_status") != "explicit_permission_or_cc":
                errors.append(
                    f"{ledger_path.name} [{cid}]: Post-1930 work (publication_year={pub_yr}) cannot host scan locally without explicit rights clearance"
                )

    return seen_ids, errors


def validate_case(md_path: Path, ledgers_map: dict[str, set[str]]) -> list[str]:
    errors: list[str] = []
    raw = md_path.read_text(encoding="utf-8")
    if not raw.startswith("---\n"):
        return [f"{md_path.name}: Missing YAML frontmatter"]
    parts = raw.split("---\n", 2)
    if len(parts) < 3:
        return [f"{md_path.name}: Unclosed YAML frontmatter"]

    try:
        fm = yaml.safe_load(parts[1])
    except Exception as exc:
        return [f"{md_path.name}: Invalid YAML: {exc}"]

    body = parts[2]
    if "certificateCounts" in fm:
        errors.append(f"{md_path.name}: Duplicate 'certificateCounts' in frontmatter is prohibited; counts derive from JSON ledger")

    if "," not in str(fm.get("authorCitation", "")):
        errors.append(f"{md_path.name}: authorCitation must use 'Last, First' format")

    lslug = str(fm.get("ledgerSlug") or "")
    if lslug not in ledgers_map:
        errors.append(f"{md_path.name}: ledgerSlug '{lslug}' has no matching public/ledgers/{lslug}.json")
        return errors

    valid_ids = ledgers_map[lslug]

    # Collect every citation ID referenced in frontmatter and prose and cross-reference against ledger!
    referenced_ids: set[str] = set()
    end_cid = (fm.get("earliestNewDiscovery") or {}).get("certId")
    if end_cid:
        referenced_ids.add(str(end_cid))
    eka_cid = (fm.get("earliestKnownAttestation") or {}).get("certId")
    if eka_cid:
        referenced_ids.add(str(eka_cid))
    for cid in fm.get("featuredScanIds") or []:
        referenced_ids.add(str(cid))
    for cid in fm.get("rejectedLeadIds") or []:
        referenced_ids.add(str(cid))
    for item in fm.get("chronologyTimeline") or []:
        if item.get("certId"):
            referenced_ids.add(str(item["certId"]))
    for cid in CERT_ID_RE.findall(body):
        referenced_ids.add(cid)

    missing = sorted(referenced_ids - valid_ids)
    if missing:
        errors.append(f"{md_path.name}: References citation ID(s) absent from {lslug}.json: {missing}")

    if RAW_SCORE_RE.search(raw):
        errors.append(f"{md_path.name}: Contains raw 4-decimal harness score; keep internal triage scores out of articles")
    dec_yr = DECIMAL_YEAR_RE.findall(raw)
    if dec_yr:
        errors.append(f"{md_path.name}: Uses decimal-year phrasing {dec_yr}; express spans in natural years, months, and days")

    return errors


def main() -> int:
    errors = check_workspace_leaks()

    ledger_files = sorted(LEDGERS_DIR.glob("*.json"))
    if not ledger_files:
        print("ERROR: No JSON ledgers found in public/ledgers/", file=sys.stderr)
        return 1

    ledgers_map: dict[str, set[str]] = {}
    total_records = 0
    for lf in ledger_files:
        ids, l_errs = validate_ledger(lf)
        errors.extend(l_errs)
        ledgers_map[lf.stem] = ids
        total_records += len(ids)
        if not l_errs:
            print(f"[LEDGER OK] {lf.name} ({len(ids)} schema-validated records)")

    case_files = sorted(CASES_DIR.glob("*.md"))
    for cf in case_files:
        c_errs = validate_case(cf, ledgers_map)
        errors.extend(c_errs)
        if not c_errs:
            print(f"[CASE OK]   {cf.name} (all citation IDs cross-referenced)")

    if errors:
        print("\nVALIDATION FAILED:", file=sys.stderr)
        for e in errors:
            print(f"  - {e}", file=sys.stderr)
        return 1

    print(
        f"\n[STRUCTURAL CHECKS PASSED] {len(case_files)} Case Files and {total_records} ledger citations passed "
        "schema, cross-reference, pre-1931 image-rights, and workspace-sanitization checks.\n"
        "NOTE: Automated checks do NOT establish transcription accuracy or historical interpretation; "
        "records remain 'agent_verified' until independently signed off by a named human reviewer."
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
