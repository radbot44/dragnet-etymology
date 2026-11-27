#!/usr/bin/env python3
"""
validate_submission.py (DRAgNEt v3 + Claim Architecture v1.0 — Zero-Dependency Stdlib Ready)
--------------------------------------------------------------------------------------------
Automated structural, cross-reference, rights-boundary, claim-graph, and sanitization validator.
Uses PyYAML when installed and falls back cleanly to pure Python 3 stdlib on machines
without PyYAML (such as fresh Windows Python installations).

What this script ACTUALLY verifies:
  1. Workspace Sanitization: Zero Google Drive/Docs links or internal workspace IDs in src/, public/, or research-system/.
  2. Ledger Schema & Verification Rules: Every record in public/ledgers/*.json has valid record_type and verification_level;
     records marked 'human_verified' MUST name human_verified_by and human_verified_date; records marked 'externally_recognized'
     MUST include external_recognition.
  3. Evidence & Image-Rights Gate: Every attestation/hypothesis has an https:// source_url; every hosted_path exists on disk
     (<= 5 MB); works with publication_year > 1930 may NOT bundle scans in public/scans/ unless rights_cleared is true.
  4. Bidirectional Cross-Referencing: Every citation ID referenced in a Case File's YAML frontmatter OR Markdown prose
     exists in that Case File's JSON ledger, and published cases stay synced in public/data/open-questions.json.
  5. Editorial Lint: Author citations use 'Last, First' format; prose and frontmatter contain no raw 4-decimal harness
     scores or artificial decimal-year antedating strings (e.g., '-30.9 yrs').
  6. Claim-Level Evidence Architecture (v1.0): Validates public/claims/*.json schemas, acyclic inferential DAG,
     chronological precision bounds, SHA-256 content/evidence fingerprints, and dynamic review staleness.

What this script DOES NOT verify (requires human philological review):
  - Historical accuracy of diplomatic transcriptions against page ink, semantic interpretation, or completeness of prior art.
"""
from __future__ import annotations
import json
import re
import sys
from pathlib import Path
from typing import Any

SCRIPTS_DIR = Path(__file__).resolve().parent
if str(SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_DIR))

import validate_claims  # noqa: E402

try:
    import yaml  # type: ignore
except ImportError:
    yaml = None

ROOT = SCRIPTS_DIR.parent
CASES_DIR = ROOT / "src" / "content" / "cases"
LEDGERS_DIR = ROOT / "public" / "ledgers"
CLAIMS_DIR = ROOT / "public" / "claims"
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
CERT_ID_RE = re.compile(r"\bCERT-\d{3,4}-\d{3}[A-Za-z]?\b")


def extract_frontmatter_fallback(fm_text: str) -> dict[str, Any]:
    out: dict[str, Any] = {}
    for line in fm_text.splitlines():
        m = re.match(r"^([A-Za-z0-9_]+):\s*(.*)$", line)
        if m:
            key, val = m.group(1), m.group(2).strip()
            if (val.startswith("'") and val.endswith("'")) or (val.startswith('"') and val.endswith('"')):
                val = val[1:-1].replace("''", "'")
            out[key] = val
    return out


def check_workspace_leaks(root_dir: Path = ROOT) -> list[str]:
    errors: list[str] = []
    for folder in (root_dir / "src", root_dir / "public", root_dir / "research-system"):
        if not folder.exists():
            continue
        for p in folder.rglob("*"):
            if "__pycache__" in p.parts:
                continue
            if p.is_file() and p.suffix.lower() in {".json", ".md", ".astro", ".ts", ".js", ".mjs", ".py"}:
                txt = p.read_text(encoding="utf-8", errors="ignore")
                m = WORKSPACE_LEAK_RE.search(txt)
                if m:
                    errors.append(f"Workspace identifier/URL leak '{m.group(0)}' found in {p.relative_to(root_dir)}")
    return errors


def validate_ledger(ledger_path: Path, public_dir: Path = PUBLIC_DIR) -> tuple[set[str], int, list[str]]:
    errors: list[str] = []
    hosted_count = 0
    try:
        data = json.loads(ledger_path.read_text(encoding="utf-8"))
    except Exception as exc:
        return set(), 0, [f"{ledger_path.name}: Invalid JSON: {exc}"]

    if data.get("schema_version") != "3.0":
        errors.append(f"{ledger_path.name}: Expected schema_version '3.0', got {data.get('schema_version')!r}")

    citations = data.get("citations")
    if not isinstance(citations, list) or not citations:
        return set(), 0, [f"{ledger_path.name}: Missing or empty 'citations' array"]

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

        if vl == "human_verified" and (not c.get("human_verified_by") or not c.get("human_verified_date")):
            errors.append(f"{ledger_path.name} [{cid}]: 'human_verified' requires human_verified_by and human_verified_date")

        if vl == "externally_recognized" and not c.get("external_recognition"):
            errors.append(f"{ledger_path.name} [{cid}]: 'externally_recognized' requires external_recognition")

        src_url = str(c.get("source_url") or "")
        if rt in {"attestation", "hypothesis"} and not src_url.startswith("https://"):
            errors.append(f"{ledger_path.name} [{cid}]: {rt} requires an https:// source_url (got {src_url!r})")

        scan = c.get("scan") or {}
        hosted = scan.get("hosted_path")
        pub_yr = c.get("publication_year")
        if hosted:
            disk_path = public_dir / str(hosted).lstrip("/")
            r2_manifest_path = public_dir / "data" / "r2-scan-manifest.json"
            r2_entry = None
            if not disk_path.exists() and r2_manifest_path.exists():
                try:
                    r2_entry = (json.loads(r2_manifest_path.read_text(encoding="utf-8")) or {}).get(str(hosted))
                except Exception:
                    r2_entry = None
            if disk_path.exists():
                hosted_count += 1
                sz = disk_path.stat().st_size
                if sz > MAX_IMAGE_BYTES:
                    errors.append(f"{ledger_path.name} [{cid}]: Scan {hosted} exceeds 5 MB ({sz} bytes)")
            elif isinstance(r2_entry, dict) and isinstance(r2_entry.get("bytes"), int):
                hosted_count += 1
                sz = int(r2_entry["bytes"])
                if sz > MAX_IMAGE_BYTES:
                    errors.append(f"{ledger_path.name} [{cid}]: R2-hosted scan {hosted} exceeds 5 MB ({sz} bytes)")
            else:
                errors.append(f"{ledger_path.name} [{cid}]: Missing hosted scan file {hosted} (not in public/scans/ or r2-scan-manifest.json)")
            if isinstance(pub_yr, int) and pub_yr > 1930 and not scan.get("rights_cleared"):
                errors.append(
                    f"{ledger_path.name} [{cid}]: Work published in {pub_yr} (> 1930) may not bundle hosted scan {hosted} without explicit rights_cleared=true"
                )

    return seen_ids, hosted_count, errors


def validate_case_file(
    md_path: Path,
    ledger_map: dict[str, set[str]],
    open_targets_by_id: dict[str, dict[str, Any]] | None = None,
) -> list[str]:
    errors: list[str] = []
    raw = md_path.read_text(encoding="utf-8")
    if not raw.startswith("---"):
        return [f"{md_path.name}: Missing YAML frontmatter"]
    parts = raw.split("---", 2)
    if len(parts) < 3:
        return [f"{md_path.name}: Unclosed YAML frontmatter"]

    if yaml is not None:
        try:
            fm = yaml.safe_load(parts[1]) or {}
        except Exception as exc:
            return [f"{md_path.name}: Invalid YAML frontmatter: {exc}"]
    else:
        fm = extract_frontmatter_fallback(parts[1])

    body = parts[2]
    ledger_slug = str(fm.get("ledgerSlug") or "")
    if ledger_slug not in ledger_map:
        errors.append(f"{md_path.name}: ledgerSlug {ledger_slug!r} has no matching public/ledgers/{ledger_slug}.json")
        return errors

    target_id = str(fm.get("targetId") or "")
    if open_targets_by_id is not None and target_id in open_targets_by_id:
        tgt = open_targets_by_id[target_id]
        if tgt.get("status") != "published_case" or tgt.get("case_slug") != md_path.stem:
            errors.append(
                f"{md_path.name}: open-questions.json target '{target_id}' must have status='published_case' and case_slug={md_path.stem!r} "
                f"(got status={tgt.get('status')!r}, case_slug={tgt.get('case_slug')!r})"
            )

    valid_ids = ledger_map[ledger_slug]
    author_cit = str(fm.get("authorCitation") or "")
    if "," not in author_cit:
        errors.append(f"{md_path.name}: authorCitation {author_cit!r} must use 'Last, First' format")

    full_text = parts[1] + "\n" + body
    if RAW_SCORE_RE.search(full_text):
        errors.append(f"{md_path.name}: Contains raw 4-decimal harness score; remove uncalibrated string scores from public prose")
    if DECIMAL_YEAR_RE.search(full_text):
        m = DECIMAL_YEAR_RE.search(full_text)
        errors.append(f"{md_path.name}: Uses decimal years ({m.group(0)!r}); express antedatings in years, months, and days")

    referenced_ids = set(CERT_ID_RE.findall(full_text))
    for ref_id in sorted(referenced_ids):
        if ref_id not in valid_ids:
            errors.append(f"{md_path.name}: References citation '{ref_id}' which does not exist in {ledger_slug}.json")

    return errors


def main() -> int:
    all_errors: list[str] = []
    all_errors.extend(check_workspace_leaks(ROOT))

    ledger_map: dict[str, set[str]] = {}
    ledger_files = sorted(LEDGERS_DIR.glob("*.json"))
    if not ledger_files:
        all_errors.append("No JSON ledgers found in public/ledgers/")

    total_hosted = 0
    for lf in ledger_files:
        ids, h_cnt, errs = validate_ledger(lf, PUBLIC_DIR)
        ledger_map[lf.stem] = ids
        total_hosted += h_cnt
        all_errors.extend(errs)

    open_targets_by_id: dict[str, dict[str, Any]] | None = None
    open_q_path = PUBLIC_DIR / "data" / "open-questions.json"
    if open_q_path.exists():
        try:
            oq_data = json.loads(open_q_path.read_text(encoding="utf-8"))
            if isinstance(oq_data.get("targets"), list):
                open_targets_by_id = {str(t.get("id") or ""): t for t in oq_data["targets"] if isinstance(t, dict)}
        except Exception as exc:
            all_errors.append(f"open-questions.json: Invalid JSON: {exc}")

    case_files = sorted(CASES_DIR.glob("*.md"))
    if not case_files:
        all_errors.append("No Case File Markdown files found in src/content/cases/")
    for cf in case_files:
        all_errors.extend(validate_case_file(cf, ledger_map, open_targets_by_id))

    claim_files = sorted(CLAIMS_DIR.glob("*.json")) if CLAIMS_DIR.exists() else []
    allow_empty_claims = len(case_files) < 18 and len(claim_files) == 0
    claim_res = validate_claims.validate_claims(
        root_dir=ROOT,
        allow_empty=allow_empty_claims,
        require_all_cases=(len(case_files) >= 18),
    )
    if not claim_res["ok"]:
        for ce in claim_res["errors"]:
            all_errors.append(f"[claims] {ce}")

    if all_errors:
        print(f"VALIDATION FAILED with {len(all_errors)} error(s):", file=sys.stderr)
        for e in all_errors:
            print(f"  - {e}", file=sys.stderr)
        return 1

    total_cits = sum(len(v) for v in ledger_map.values())
    claim_stats = claim_res.get("stats", {})
    print(
        f"STRUCTURAL_AND_SCHEMA_CHECKS_PASSED ({len(case_files)} case files, {total_cits} ledger citations, "
        f"{claim_stats.get('totalClaims', 0)} claims across {claim_stats.get('claimLedgers', 0)} claim ledgers, "
        f"{total_hosted} pre-1931 scans verified; diplomatic transcription accuracy still requires human philological inspection)."
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())