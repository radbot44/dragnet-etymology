#!/usr/bin/env python3
"""
add_case.py (DRAgNEt v3 Plug-and-Play Monograph, Citation Ledger & Claim Ledger Ingester)
-----------------------------------------------------------------------------------------
One-command local pipeline to add or upgrade a completed research monograph, v3.0 JSON
citation ledger, and v1.0 JSON claim ledger in the DRAgNEt Astro repository. Runs on pure
Python 3 standard library (zero pip packages required; uses Pillow, cwebp, or ffmpeg
automatically when converting pre-1931 PNG scans to WebP).

Examples:
  # 1. Add a completed word (monograph + citation ledger + claim ledger + scans folder):
  python3 scripts/add_case.py \
    --ledger /path/to/1602_hokum_verified_ledger.json \
    --claims /path/to/1603_hokum_claims.json \
    --monograph /path/to/1601_hokum_monograph.md \
    --scans /path/to/evidence_scans \
    --slug hokum

  # 2. Ingest or merge ONLY a claim ledger for an existing published case:
  python3 scripts/add_case.py \
    --slug hokum \
    --claims /path/to/hokum_claims.json \
    --claims-only \
    --merge-existing

  # 3. Record an embargoed journal submission on /open-questions/ without publishing full text:
  python3 scripts/add_case.py \
    --slug shindig \
    --target-id TGT-019 \
    --status under_review

  # 4. Reconcile public/data/open-questions.json against all published Case Files:
  python3 scripts/add_case.py --sync-open-questions
"""
from __future__ import annotations

import argparse
import copy
import datetime as dt
import json
import re
import shutil
import subprocess
import sys
from pathlib import Path
from typing import Any

SCRIPTS_DIR = Path(__file__).resolve().parent
if str(SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_DIR))

import validate_claims  # noqa: E402

DRIVE_URL_MD_RE = re.compile(r"\[([^\]]+)\]\(https?://(?:drive|docs)[.]google[.]com/[^)]+\)", re.IGNORECASE)
DRIVE_URL_RAW_RE = re.compile(r"https?://(?:drive|docs)[.]google[.]com/\S+", re.IGNORECASE)
GDRIVE_SCHEME_RE = re.compile(r"googledrive[:][/][/]\S*", re.IGNORECASE)
GOOGLE_REDIRECT_RE = re.compile(r"https?://www[.]google[.]com/search[?]q=(https?://[^&\s)]+)", re.IGNORECASE)
PRIVATE_PATH_RE = re.compile(
    "|".join(
        [
            r"sandbox[:][/][/][/]\S*",
            r"[/]working[_]dir[/]\S*",
            r"[/]home[/]spark[/]\S*",
            r"\bwt[-]agent-\d+\b",
            r"\bc_[0-9a-f]{12,}\b",
            r"\bDrive\s+ID\s*(?:[:=]\s*[A-Za-z0-9_-]+)?",
        ]
    ),
    re.IGNORECASE,
)
FORBIDDEN_INTERNAL_KEY_RE = re.compile(
    "|".join(
        [
            r"^workspace[_]drive[_]folder[_]id$",
            r"^evidence[_]scans[_]folder[_]id$",
            r"^scan[_]evidence[_]drive[_]id$",
            r"^is[_]stale$",
        ]
    ),
    re.IGNORECASE,
)
RAW_SCORE_KV_RE = re.compile(
    r"(?:,\s*|\s*\()?(?:\b(?:SLPL|JW|jaro[_ -]?winkler|skeleton_similarity|similarity|confidence(?:_score)?)\s*[=:]?\s*\d\.\d{2,4})\b\)?",
    re.IGNORECASE,
)
FOUR_DEC_PAREN_RE = re.compile(r"\(\s*\d\.\d{4}\s*\)")
DECIMAL_YEAR_RE = re.compile(r"(-?\b\d+)\.(\d+)\s*(yrs?|years?)\b", re.IGNORECASE)
CERT_ID_RE = re.compile(r"\b(CERT-\d{3,4}-\d{3}[A-Za-z]?)\b")
MAX_SCAN_BYTES = 5 * 1024 * 1024

PUBLICATION_STATUS_DEFAULTS = {
    "working_paper": "Open working paper; verify target journal preprint/prior-dissemination policies before overlapping submission.",
    "manuscript_in_preparation": "Working research dossier overlapping with an article manuscript in preparation; consult target journal originality policies before submission.",
    "under_review": "Manuscript currently under external peer review; full case dossier embargoed pending editorial decision.",
    "published_article": "Companion archival ledger and primary-source dossier for a published peer-reviewed article.",
    "dictionary_submitted": "Open archival dossier; primary antedating and citation evidence submitted to historical dictionary editors.",
}

MONTH_ABBR = ["", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]


def replace_decimal_years(text: str) -> str:
    def _repl(m: re.Match[str]) -> str:
        whole = int(m.group(1))
        frac = float("0." + m.group(2))
        months = round(frac * 12)
        sign = "-" if str(m.group(1)).startswith("-") else ""
        abs_w = abs(whole)
        unit = "yr" if abs_w == 1 else "yrs"
        if months <= 0:
            return f"{sign}{abs_w} {unit}"
        if months >= 12:
            return f"{sign}{abs_w + 1} yrs"
        m_unit = "mo" if months == 1 else "mos"
        return f"{sign}{abs_w} {unit}, {months} {m_unit}"

    return DECIMAL_YEAR_RE.sub(_repl, text)


def _strip_raw_gdrive_ids(text: str) -> str:
    def _repl(m: re.Match[str]) -> str:
        tok = m.group(0)
        if re.search(r"[A-Z]", tok) and re.search(r"[a-z]", tok) and re.search(r"\d", tok):
            return ""
        return tok

    return validate_claims.RAW_GDRIVE_ID_RE.sub(_repl, text)


def sanitize_inline(text: Any, *, raw_drive_replacement: str = "[archived scan]") -> str:
    if not text:
        return ""
    s = str(text)
    s = GOOGLE_REDIRECT_RE.sub(r"\1", s)
    s = DRIVE_URL_MD_RE.sub(r"\1", s)
    s = DRIVE_URL_RAW_RE.sub(raw_drive_replacement, s)
    s = GDRIVE_SCHEME_RE.sub("", s)
    s = PRIVATE_PATH_RE.sub("", s)
    s = _strip_raw_gdrive_ids(s)
    s = s.replace("evidence_scans/", "")
    s = RAW_SCORE_KV_RE.sub("", s)
    s = validate_claims.PCT_CONFIDENCE_RE.sub("", s)
    s = FOUR_DEC_PAREN_RE.sub("", s)
    s = replace_decimal_years(s)
    return " ".join(s.split()).strip()


def sanitize_prose_block(text: str) -> str:
    out_lines: list[str] = []
    for raw_line in text.splitlines():
        line = GOOGLE_REDIRECT_RE.sub(r"\1", raw_line)
        line = DRIVE_URL_MD_RE.sub(r"\1", line)
        line = DRIVE_URL_RAW_RE.sub("", line)
        line = GDRIVE_SCHEME_RE.sub("", line)
        line = PRIVATE_PATH_RE.sub("", line)
        line = _strip_raw_gdrive_ids(line)
        line = line.replace("evidence_scans/", "")
        line = RAW_SCORE_KV_RE.sub("", line)
        line = validate_claims.PCT_CONFIDENCE_RE.sub("", line)
        line = FOUR_DEC_PAREN_RE.sub("", line)
        line = replace_decimal_years(line)
        line = re.sub(r"\bscore_phonological_contact\(\)", "phonological comparison", line)
        out_lines.append(line.rstrip())
    return "\n".join(out_lines).strip()


def sanitize_claim_node(node: Any, parent_key: str = "") -> Any:
    if node is None or isinstance(node, (bool, int, float)):
        return node
    if isinstance(node, str):
        if parent_key in {"id", "slug", "case_slug", "target_id", "case_number", "ref", "advancing_citation_ref"}:
            return node.strip()
        if parent_key in {"content_fingerprint", "material_fingerprint_at_review"} or parent_key.startswith("CERT-") or parent_key.startswith("CLM-"):
            return node.strip().lower()
        return sanitize_inline(node, raw_drive_replacement="")
    if isinstance(node, list):
        cleaned_list = [sanitize_claim_node(item, parent_key) for item in node]
        if parent_key in {"limitations", "resolution_criteria", "objections", "query_terms", "known_limitations"}:
            return [x for x in cleaned_list if isinstance(x, str) and x.strip()]
        return cleaned_list
    if isinstance(node, dict):
        out: dict[str, Any] = {}
        for k, v in node.items():
            if FORBIDDEN_INTERNAL_KEY_RE.match(k):
                continue
            if parent_key != "evidence_fingerprints_at_review" and validate_claims.FORBIDDEN_SCORE_KEY_RE.search(k):
                continue
            child_parent = k if parent_key != "evidence_fingerprints_at_review" else parent_key
            out[k] = sanitize_claim_node(v, child_parent)
        return out
    return node


def yaml_str(val: Any) -> str:
    s = sanitize_inline(val)
    escaped = s.replace("'", "''")
    return f"'{escaped}'"


def format_human_date(raw_date: Any, fallback_year: Any = None) -> tuple[str, str]:
    s = str(raw_date or "").strip()
    m = re.match(r"^(\d{4})-(\d{2})-(\d{2})", s)
    if m:
        y, mo, dy = int(m.group(1)), int(m.group(2)), int(m.group(3))
        if 1 <= mo <= 12:
            return f"{dy} {MONTH_ABBR[mo]} {y}", f"{y:04d}-{mo:02d}-{dy:02d}"
    m_ym = re.match(r"^(\d{4})-(\d{2})$", s)
    if m_ym:
        y, mo = int(m_ym.group(1)), int(m_ym.group(2))
        if 1 <= mo <= 12:
            return f"{MONTH_ABBR[mo]} {y}", f"{y:04d}-{mo:02d}-01"
    yr_m = re.search(r"(\d{4})", s or str(fallback_year or ""))
    if yr_m:
        y = int(yr_m.group(1))
        return (s if s and len(s) <= 22 else str(y)), f"{y:04d}-01-01"
    return (s or "Undated"), "9999-99-99"


def slugify(text: str) -> str:
    s = re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")
    return s or "case"


def normalize_headword_key(text: str) -> str:
    primary = str(text or "").lower().split("/")[0].strip()
    return re.sub(r"[^a-z0-9]+", "", primary)


def extract_raw_certs(payload: Any) -> list[dict[str, Any]]:
    if isinstance(payload, list):
        return [c for c in payload if isinstance(c, dict) and ("certificate_id" in c or "id" in c)]
    if not isinstance(payload, dict):
        raise ValueError("Ledger JSON must be a JSON object or array.")
    if isinstance(payload.get("citations"), list) and payload.get("schema_version") == "3.0":
        return payload["citations"]
    if isinstance(payload.get("certificates"), list):
        return [c for c in payload["certificates"] if isinstance(c, dict) and "certificate_id" in c]

    merged: list[dict[str, Any]] = []
    seen: set[str] = set()
    for k, v in payload.items():
        if k.startswith("audit_of_") or "genealogy" in k or "matrix" in k or "scorecard" in k:
            continue
        if isinstance(v, list) and v and isinstance(v[0], dict) and "certificate_id" in v[0]:
            for cert in v:
                cid = str(cert.get("certificate_id", ""))
                if cid and cid not in seen:
                    seen.add(cid)
                    merged.append(cert)
    return merged


def find_scan_source(scans_dir: Path | None, cid: str, raw_filename: str) -> Path | None:
    if not scans_dir or not scans_dir.exists():
        return None
    candidates: list[Path] = []
    if raw_filename:
        clean_name = Path(str(raw_filename).replace("evidence_scans/", "")).name
        candidates.extend(
            [
                scans_dir / clean_name,
                scans_dir / "evidence_scans" / clean_name,
            ]
        )
    for folder in (scans_dir, scans_dir / "evidence_scans"):
        if folder.exists():
            candidates.extend(sorted(folder.glob(f"{cid}.*")))
            candidates.extend(sorted(folder.glob(f"{cid}_*.*")))
    for p in candidates:
        if p.is_file() and p.suffix.lower() in {".png", ".webp", ".jpg", ".jpeg"}:
            return p
    return None


def convert_to_webp(src_img: Path, dest_webp: Path) -> bool:
    dest_webp.parent.mkdir(parents=True, exist_ok=True)
    if src_img.suffix.lower() == ".webp":
        shutil.copy2(src_img, dest_webp)
        return True

    try:
        from PIL import Image  # type: ignore

        with Image.open(src_img) as im:
            if im.width > 1800:
                ratio = 1800.0 / im.width
                im = im.resize((1800, int(im.height * ratio)), Image.Resampling.LANCZOS)
            im.save(dest_webp, format="WEBP", quality=82, method=4)
        return dest_webp.exists() and dest_webp.stat().st_size > 0
    except Exception:
        pass

    cwebp = shutil.which("cwebp")
    if cwebp:
        res = subprocess.run(
            [cwebp, "-quiet", "-q", "82", str(src_img), "-o", str(dest_webp)],
            capture_output=True,
        )
        if res.returncode == 0 and dest_webp.exists():
            return True

    ffmpeg = shutil.which("ffmpeg")
    if ffmpeg:
        res = subprocess.run(
            [
                ffmpeg,
                "-y",
                "-loglevel",
                "error",
                "-i",
                str(src_img),
                "-vf",
                "scale='min(1800,iw)':-1",
                "-quality",
                "82",
                str(dest_webp),
            ],
            capture_output=True,
        )
        if res.returncode == 0 and dest_webp.exists():
            return True

    return False


def _sanitize_source_url(raw_url: Any) -> str:
    src_url = str(raw_url or "https://archive.org/").strip()
    src_url = GOOGLE_REDIRECT_RE.sub(r"\1", src_url)
    if validate_claims.find_workspace_or_drive_leak(src_url) or not src_url.startswith("https://"):
        if src_url.startswith("http://") and not validate_claims.find_workspace_or_drive_leak(src_url):
            src_url = "https://" + src_url[len("http://") :]
        else:
            src_url = "https://archive.org/"
    return src_url


def _enforce_v3_citation_sanitization_and_rights(
    c: dict[str, Any],
    slug: str,
    scans_dir: Path | None,
    public_dir: Path,
) -> dict[str, Any]:
    rec: dict[str, Any] = {}
    for k, v in c.items():
        if FORBIDDEN_INTERNAL_KEY_RE.match(k):
            continue
        rec[k] = copy.deepcopy(v)

    cid = str(rec.get("id") or "").strip()
    rec["id"] = cid
    rec["slug"] = cid.lower()
    rec["case_slug"] = slug
    rec["source_url"] = _sanitize_source_url(rec.get("source_url"))

    for str_field in (
        "headword",
        "attested_form",
        "short_gloss",
        "source_publication",
        "source_archive",
        "page_and_column",
        "verbatim_quote",
        "linguistic_note",
        "analysis_notes",
    ):
        if str_field in rec and rec[str_field] is not None:
            rec[str_field] = sanitize_inline(rec[str_field], raw_drive_replacement="")

    for opt_field in ("verified_by_agent", "human_verified_by", "external_recognition"):
        if isinstance(rec.get(opt_field), str):
            rec[opt_field] = sanitize_inline(rec[opt_field], raw_drive_replacement="")

    pub_yr = rec.get("publication_year")
    scan = dict(rec.get("scan") or {})
    hosted = scan.get("hosted_path")
    rights_cleared = scan.get("rights_cleared") is True

    if isinstance(pub_yr, int) and pub_yr > 1930 and not rights_cleared:
        if hosted:
            print(
                f"[RIGHTS GUARD] Stripped hosted_path '{hosted}' on {cid}: publication_year={pub_yr} (> 1930) without rights_cleared=true."
            )
        scan["hosted_path"] = None
        scan["rights_status"] = "post_1930_external_archive_link"
        scan["rights_note"] = (
            f"Published {pub_yr} (> 1930): full-page image not redistributed; bibliographic metadata, "
            "short quotation, and external archive link provided."
        )
    elif isinstance(pub_yr, int) and pub_yr <= 1930:
        if not hosted and scans_dir is not None:
            src_scan = find_scan_source(scans_dir, cid, "")
            if src_scan is not None:
                dest_rel = f"scans/{slug}/{cid}.webp"
                dest_abs = public_dir / dest_rel
                if convert_to_webp(src_scan, dest_abs) and dest_abs.stat().st_size <= MAX_SCAN_BYTES:
                    hosted = f"/{dest_rel}"
                    scan["hosted_path"] = hosted
                    scan["rights_status"] = "us_public_domain_pre_1931"
                    scan["rights_note"] = (
                        f"Published {pub_yr} (<= 1930): public domain in the United States; WebP proof scan hosted directly."
                    )
        if hosted:
            disk_path = public_dir / str(hosted).lstrip("/")
            if not disk_path.exists() and scans_dir is not None:
                src_scan = find_scan_source(scans_dir, cid, Path(str(hosted)).name)
                if src_scan is not None:
                    convert_to_webp(src_scan, disk_path)
            if not disk_path.exists() or disk_path.stat().st_size > MAX_SCAN_BYTES:
                print(
                    f"[RIGHTS GUARD] Clearing missing or oversized (>5 MB) hosted_path '{hosted}' on {cid}."
                )
                scan["hosted_path"] = None
                scan["rights_status"] = "external_archive_link"
                scan["rights_note"] = f"Published {pub_yr} (<= 1930): inspect original scan via host archive URL."

    if isinstance(scan.get("rights_note"), str):
        scan["rights_note"] = sanitize_inline(scan["rights_note"], raw_drive_replacement="")
    rec["scan"] = scan
    return rec


def normalize_certificate(
    c: dict[str, Any],
    slug: str,
    default_headword: str,
    scans_dir: Path | None,
    public_dir: Path,
) -> dict[str, Any]:
    if "record_type" in c and "verification_level" in c and "id" in c:
        return _enforce_v3_citation_sanitization_and_rights(c, slug, scans_dir, public_dir)

    cid = str(c["certificate_id"]).strip()
    ep = str(c.get("epistemic_status") or "").strip()
    dt_str = str(c.get("discovery_type") or "").strip().lower()

    if ep == "PRIMARY-SCAN-VERIFIED":
        if "negative_corpus" in dt_str or "prosopograph" in dt_str:
            rtype, sub = "contextual_evidence", "corpus_or_prosopographical_control"
        else:
            rtype, sub = "attestation", "primary_attestation"
    elif ep == "BASELINE-LITERATURE":
        rtype, sub = "attestation", "prior_art_baseline"
    elif ep == "CORPUS-TEXT-CANDIDATE":
        rtype, sub = "attestation", "corpus_candidate"
    elif ep == "PHONOLOGICAL-HYPOTHESIS":
        rtype, sub = "hypothesis", "supporting_pathway"
    else:
        if "negative_corpus" in dt_str:
            rtype, sub = "contextual_evidence", "negative_corpus_sweep"
        else:
            rtype, sub = "rejected_lead", (dt_str or "ocr_or_misdate")

    yr_source = c.get("masthead_year") or c.get("attested_year") or c.get("donor_original_source_year")
    yr_m = re.search(r"(\d{4})", str(yr_source or ""))
    pub_yr = int(yr_m.group(1)) if yr_m else None

    raw_date = c.get("attested_date_exact") or c.get("attested_date") or pub_yr
    date_disp, sort_date = format_human_date(raw_date, pub_yr)
    src_url = _sanitize_source_url(c.get("source_url"))

    attested_form = sanitize_inline(c.get("attested_spelling") or c.get("headword") or default_headword)
    pub_title = sanitize_inline(c.get("source_publication") or "Archival Source")
    notes_clean = sanitize_inline(c.get("auditor_notes") or c.get("rejection_reason") or "")
    short_gloss = (
        f"{attested_form} in {pub_title}"
        if rtype == "attestation"
        else f"{rtype.replace('_', ' ').title()}: {attested_form}"
    )[:140]

    hosted_path: str | None = None
    if pub_yr is not None and pub_yr <= 1930:
        rights_status = "us_public_domain_pre_1931"
        src_scan = find_scan_source(
            scans_dir,
            cid,
            str(c.get("scan_evidence_filename") or c.get("proof_plate_filename") or ""),
        )
        if src_scan is not None:
            dest_rel = f"scans/{slug}/{cid}.webp"
            dest_abs = public_dir / dest_rel
            if convert_to_webp(src_scan, dest_abs) and dest_abs.stat().st_size <= MAX_SCAN_BYTES:
                hosted_path = f"/{dest_rel}"
                rights_note = f"Published {pub_yr} (<= 1930): public domain in the United States; WebP proof scan hosted directly."
            else:
                rights_status = "external_archive_link"
                rights_note = f"Published {pub_yr} (<= 1930): inspect original scan via host archive URL."
        else:
            rights_status = "external_archive_link"
            rights_note = f"Published {pub_yr} (<= 1930): inspect original scan via host archive URL."
    else:
        rights_status = "post_1930_external_archive_link"
        yr_label = str(pub_yr) if pub_yr else "undated/modern"
        rights_note = (
            f"Published {yr_label} (> 1930): full-page image not redistributed; bibliographic metadata, "
            "short quotation, and external archive link provided."
        )

    return {
        "id": cid,
        "slug": cid.lower(),
        "case_slug": slug,
        "headword": sanitize_inline(c.get("headword") or default_headword),
        "attested_form": attested_form,
        "record_type": rtype,
        "record_subtype": sub,
        "verification_level": "agent_verified" if c.get("scan_inspected") else "discovered",
        "verified_by_agent": "DRAgNEt Archival Pipeline" if c.get("scan_inspected") else None,
        "human_verified_by": None,
        "human_verified_date": None,
        "external_recognition": None,
        "publication_year": pub_yr,
        "date_display": date_disp,
        "sort_date": sort_date,
        "short_gloss": short_gloss,
        "source_publication": pub_title,
        "source_archive": sanitize_inline(c.get("source_archive") or "Digital Archive"),
        "source_url": src_url,
        "page_and_column": sanitize_inline(c.get("page_and_column") or ""),
        "verbatim_quote": sanitize_inline(c.get("verbatim_quote") or ""),
        "masthead_date_verified": bool(c.get("masthead_date_verified")),
        "catalog_year": c.get("catalog_year"),
        "masthead_year": c.get("masthead_year") or pub_yr,
        "linguistic_note": sanitize_inline(c.get("donor_language_hypothesis") or ""),
        "analysis_notes": notes_clean,
        "scan": {
            "hosted_path": hosted_path,
            "rights_status": rights_status,
            "rights_note": rights_note,
        },
    }


def _preserve_existing_citation_verification(
    existing: dict[str, Any],
    incoming: dict[str, Any],
    public_dir: Path,
) -> dict[str, Any]:
    old_lvl = existing.get("verification_level")
    if old_lvl not in {"human_verified", "externally_recognized"}:
        return incoming
    if incoming.get("verification_level") in {"human_verified", "externally_recognized"}:
        return incoming
    old_fp = validate_claims.compute_citation_material_fingerprint(existing, public_dir)
    new_fp = validate_claims.compute_citation_material_fingerprint(incoming, public_dir)
    if old_fp == new_fp:
        incoming["verification_level"] = old_lvl
        incoming["human_verified_by"] = existing.get("human_verified_by")
        incoming["human_verified_date"] = existing.get("human_verified_date")
        incoming["external_recognition"] = existing.get("external_recognition")
    return incoming


def parse_monograph_body(monograph_path: Path | None, valid_cert_ids: set[str], headword: str) -> tuple[str, list[str], str]:
    if not monograph_path or not monograph_path.exists():
        default_body = f"""## 1. Prior Scholarship and Lexicographical Baseline

Summarize the existing treatment of *{headword}* in the *Oxford English Dictionary*, *Green's Dictionary of Slang*, *Historical Dictionary of American Slang*, and specialist scholarship here.

## 2. Primary-Source Attestations and Chronology

Present the verified primary-source citations in chronological order, separating direct occupational or vernacular usage from later secondary commentary.

## 3. Evaluating Origin Hypotheses and Rejected Leads

Assess the competing linguistic derivations alongside any archival misdates, OCR ghosts, or homographs excluded in the JSON ledger.
"""
        return default_body, [], ""

    raw_txt = monograph_path.read_text(encoding="utf-8", errors="ignore")
    cutoff_patterns = [
        r"(?m)^#{0,3}\s*(?:Section\s*)?[67]\.\s+(?:Ready-to-Paste|Oxford English Dictionary|OED\s+Antedating|Submission-Ready)",
        r"(?m)^#{1,3}\s*(?:Box\s+1\s*[:—-]|Submission-Ready\s+(?:Short\s+Note|Article|Manuscript))",
    ]
    for pat in cutoff_patterns:
        m = re.search(pat, raw_txt, re.IGNORECASE)
        if m:
            raw_txt = raw_txt[: m.start()].rstrip()

    cleaned = sanitize_prose_block(raw_txt)

    def _filter_cert(m: re.Match[str]) -> str:
        cid = m.group(1)
        return cid if cid in valid_cert_ids else ""

    cleaned = CERT_ID_RE.sub(_filter_cert, cleaned)

    out_lines: list[str] = []
    facts: list[str] = []
    prior_summary = ""

    for line in cleaned.splitlines():
        stripped = line.strip()
        if re.match(r"^[1-5]\.\s+[A-Z][A-Za-z0-9 ,&'()/:—–-]{8,95}$", stripped) and not stripped.endswith("."):
            out_lines.append(f"\n## {stripped}\n")
            continue
        out_lines.append(line)
        if not prior_summary and len(stripped) > 90 and ("OED" in stripped or "Oxford English Dictionary" in stripped or "Green" in stripped):
            prior_summary = sanitize_inline(stripped)[:420]
        if len(facts) < 4 and len(stripped) > 70 and any(cid in stripped for cid in valid_cert_ids):
            facts.append(sanitize_inline(stripped.lstrip("*-0123456789. "))[:320])

    body = "\n".join(out_lines).strip() + "\n"
    return body, facts, prior_summary


def build_case_markdown(
    *,
    slug: str,
    headword: str,
    target_id: str,
    case_num: str,
    pub_status: str,
    pub_status_note: str,
    baseline_year: int,
    citations: list[dict[str, Any]],
    monograph_path: Path | None,
) -> str:
    valid_ids = {c["id"] for c in citations}
    body_md, mono_facts, mono_prior = parse_monograph_body(monograph_path, valid_ids, headword)

    attestations = sorted(
        [c for c in citations if c["record_type"] == "attestation"],
        key=lambda x: (x.get("publication_year") or 9999, x.get("sort_date") or "9999"),
    )
    primary_atts = [c for c in attestations if c.get("record_subtype") == "primary_attestation"] or attestations
    earliest_new = primary_atts[0] if primary_atts else citations[0]

    baselines = [c for c in attestations if c.get("record_subtype") == "prior_art_baseline"]
    earliest_known = baselines[0] if baselines else earliest_new

    hyps = [c for c in citations if c["record_type"] == "hypothesis"]
    rejs = [c for c in citations if c["record_type"] == "rejected_lead"]
    hosted_scans = [
        c for c in citations if (c.get("scan") or {}).get("hosted_path") and c["record_type"] in ("attestation", "hypothesis")
    ] or [c for c in citations if (c.get("scan") or {}).get("hosted_path")]

    related_forms: list[str] = []
    for c in primary_atts[:12]:
        f = c.get("attested_form") or ""
        if f and f.lower() not in {x.lower() for x in related_forms} and len(f) <= 32:
            related_forms.append(f)
    if not related_forms:
        related_forms = [headword]

    new_yr = int(earliest_new.get("publication_year") or baseline_year)
    yr_diff = baseline_year - new_yr
    antedating_summary = (
        f"{yr_diff} yrs earlier than {baseline_year} baseline"
        if yr_diff > 0
        else f"Earliest verified scan: {earliest_new['date_display']}"
    )

    prior_art_summary = mono_prior or (
        f"Reference baseline for {headword} stands at {baseline_year}; this dossier evaluates "
        f"{len(citations)} primary attestations, contextual controls, hypotheses, and rejected leads."
    )

    if not mono_facts:
        for c in primary_atts[:3]:
            mono_facts.append(
                f"Primary scan inspection of {c['source_publication']} ({c['date_display']}, {c['id']}) "
                f"documents '{c['attested_form']}'."
            )
    if not mono_facts:
        mono_facts = [f"Evaluated {len(citations)} archival records for {headword}."]

    hyp_summary = (
        hyps[0]["analysis_notes"] or hyps[0]["linguistic_note"]
        if hyps
        else f"Evaluates candidate donor and morphological pathways for {headword} against chronological constraints."
    )[:360]

    timeline_items = primary_atts[:6] if primary_atts else citations[:4]
    featured_ids = [c["id"] for c in hosted_scans[:8]]
    rejected_ids = [c["id"] for c in rejs[:8]]

    today = dt.date.today().isoformat()
    ear_quote = (earliest_new.get("verbatim_quote") or "")[:200]
    ear_pub = earliest_new["source_publication"]
    ear_date = earliest_new["date_display"]
    ear_url = earliest_new["source_url"]
    ear_page = earliest_new.get("page_and_column", "")
    wp_ref = f"<ref>{{{{cite news |work={ear_pub} |date={ear_date} |url={ear_url} |quote={ear_quote}}}}}</ref>"
    wikt_q = f"* {new_yr}, {ear_pub} ({ear_date}): {ear_quote}"
    adsl_q = f"Early attestation of {headword} ({ear_date}, {ear_pub}): {ear_url}"
    oed_q = f"Headword: {headword} | Date: {ear_date} | Source: {ear_pub} ({ear_page}) | URL: {ear_url}"

    lines: list[str] = [
        "---",
        f"title: {yaml_str(f'Early History and Primary-Source Evidence for {headword.title()}')}",
        f"subtitle: {yaml_str(f'Archival chronology, primary-source scans, and evaluated etymological leads for {headword} ({case_num}).')}",
        f"headword: {yaml_str(headword)}",
        "relatedForms:",
    ]
    for rf in related_forms[:8]:
        lines.append(f"- {yaml_str(rf)}")
    lines.extend(
        [
            f"targetId: {yaml_str(target_id)}",
            f"caseNumber: {yaml_str(case_num)}",
            f"ledgerSlug: {yaml_str(slug)}",
            f"publicationStatus: {yaml_str(pub_status)}",
            f"publicationStatusNote: {yaml_str(pub_status_note)}",
            f"pubDate: {yaml_str(today)}",
            "author: 'Joshua Callahan'",
            "authorCitation: 'Callahan, Joshua'",
            "keywords:",
            "- 'etymology'",
            f"- {yaml_str(headword)}",
            "- 'historical lexicography'",
            "- 'antedating'",
            f"priorArtSummary: {yaml_str(prior_art_summary)}",
            "earliestKnownAttestation:",
            f"  form: {yaml_str(earliest_known.get('attested_form') or headword)}",
            f"  dateDisplay: {yaml_str(earliest_known.get('date_display') or str(baseline_year))}",
            f"  year: {int(earliest_known.get('publication_year') or baseline_year)}",
            f"  source: {yaml_str(earliest_known.get('source_publication') or 'Reference Dictionary Baseline')}",
            f"  citedIn: {yaml_str('Prior lexicographical literature / baseline audit')}",
            f"  url: {yaml_str(earliest_known.get('source_url') or 'https://www.oed.com/')}",
            f"  certId: {yaml_str(earliest_known['id'])}",
            "earliestNewDiscovery:",
            f"  form: {yaml_str(earliest_new.get('attested_form') or headword)}",
            f"  dateDisplay: {yaml_str(earliest_new.get('date_display') or str(new_yr))}",
            f"  year: {new_yr}",
            f"  source: {yaml_str(earliest_new.get('source_publication') or 'Primary Periodical Scan')}",
            f"  location: {yaml_str(earliest_new.get('source_archive') or 'Archival Collection')}",
            f"  antedatingSummary: {yaml_str(antedating_summary)}",
            f"  archiveUrl: {yaml_str(earliest_new.get('source_url') or 'https://archive.org/')}",
            f"  certId: {yaml_str(earliest_new['id'])}",
            "establishedFacts:",
        ]
    )
    for fact in mono_facts[:4]:
        lines.append(f"- {yaml_str(fact)}")
    lines.extend(
        [
            "originHypothesis:",
            f"  label: {yaml_str('Evaluated Etymological Hypothesis')}",
            f"  summary: {yaml_str(hyp_summary)}",
            f"  boundaryNote: {yaml_str('Chronological attestations in the ledger are established primary evidence; ultimate phonological or contact derivations remain falsifiable linguistic hypotheses.')}",
            "chronologyTimeline:",
        ]
    )
    for item in timeline_items:
        note_txt = (item.get("analysis_notes") or item.get("short_gloss") or item.get("attested_form") or "")[:160]
        lines.extend(
            [
                f"- date: {yaml_str(item['date_display'])}",
                f"  form: {yaml_str(item['attested_form'])}",
                f"  source: {yaml_str(item['source_publication'])}",
                f"  note: {yaml_str(note_txt)}",
                f"  certId: {yaml_str(item['id'])}",
            ]
        )
    if featured_ids:
        lines.append("featuredScanIds:")
        for fid in featured_ids:
            lines.append(f"- {yaml_str(fid)}")
    else:
        lines.append("featuredScanIds: []")
    if rejected_ids:
        lines.append("rejectedLeadIds:")
        for rid in rejected_ids:
            lines.append(f"- {yaml_str(rid)}")
    else:
        lines.append("rejectedLeadIds: []")
    lines.extend(
        [
            "openQuestions:",
            f"- {yaml_str(f'Locate additional pre-{new_yr} regional newspaper or trade-press attestations of {headword} in undigitized microfilm.')}",
            "reuseKit:",
            f"  wikipediaPrimaryRef: {yaml_str(wp_ref)}",
            f"  wikipediaGuidance: {yaml_str('Cite the historical print scan directly for dated usage under WP:PRIMARY; cite peer-reviewed lexicographical scholarship for origin interpretations.')}",
            f"  wiktionaryQuote: {yaml_str(wikt_q)}",
            f"  adsLDispatch: {yaml_str(adsl_q)}",
            f"  oedSlipSummary: {yaml_str(oed_q)}",
            "---",
            "",
            body_md.rstrip(),
            "",
        ]
    )
    return "\n".join(lines)


def _match_open_question_row(
    targets: list[dict[str, Any]],
    target_id: str,
    headword: str,
    slug: str,
) -> dict[str, Any] | None:
    clean_tid = str(target_id or "").strip()
    if clean_tid and clean_tid != "TGT-000" and validate_claims.TARGET_ID_RE.match(clean_tid):
        for row in targets:
            if row.get("target_id") == clean_tid:
                return row
    if slug:
        for row in targets:
            if row.get("case_slug") == slug:
                return row
    hw_key = normalize_headword_key(headword or slug)
    if hw_key:
        for row in targets:
            if normalize_headword_key(str(row.get("headword") or "")) == hw_key:
                return row
    return None


def is_target_embargoed(root: Path, target_id: str, headword: str, slug: str) -> tuple[bool, str]:
    oq_path = root / "public" / "data" / "open-questions.json"
    if oq_path.exists():
        data = json.loads(oq_path.read_text(encoding="utf-8"))
        row = _match_open_question_row(data.get("targets", []), target_id, headword, slug)
        if row and row.get("status") == "under_review" and not row.get("case_slug"):
            return True, f"Target {row.get('target_id')} ({row.get('headword')}) is marked 'under_review' in open-questions.json"
    if slug:
        led_path = root / "public" / "ledgers" / f"{slug}.json"
        if led_path.exists():
            ld = json.loads(led_path.read_text(encoding="utf-8"))
            if ld.get("publication_status") == "under_review":
                return True, f"Existing ledger public/ledgers/{slug}.json has publication_status='under_review'"
    return False, ""


def update_open_questions(root: Path, target_id: str, headword: str, slug: str, status_value: str) -> bool:
    oq_path = root / "public" / "data" / "open-questions.json"
    if not oq_path.exists():
        return False
    data = json.loads(oq_path.read_text(encoding="utf-8"))
    row = _match_open_question_row(data.get("targets", []), target_id, headword, slug)
    if row is None:
        return False
    desired_slug = slug if status_value == "published_case" else None
    if row.get("status") == status_value and row.get("case_slug") == desired_slug:
        return False
    row["status"] = status_value
    row["case_slug"] = desired_slug
    data["updated_at"] = dt.date.today().isoformat()
    oq_path.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    return True


def reconcile_published_cases_in_open_questions(root: Path, *, allow_preprint: bool = False) -> list[str]:
    """Ensure every published public case in src/content/cases/*.md + public/ledgers/*.json
    is marked 'published_case' with matching case_slug in open-questions.json, while leaving
    under_review targets without public cases (e.g., TGT-019 shindig) and unpublished targets untouched."""
    oq_path = root / "public" / "data" / "open-questions.json"
    cases_dir = root / "src" / "content" / "cases"
    ledgers_dir = root / "public" / "ledgers"
    if not oq_path.exists() or not cases_dir.exists() or not ledgers_dir.exists():
        return []

    data = json.loads(oq_path.read_text(encoding="utf-8"))
    targets = data.get("targets", [])
    synced_labels: list[str] = []

    for case_md in sorted(cases_dir.glob("*.md")):
        cslug = case_md.stem
        ledger_file = ledgers_dir / f"{cslug}.json"
        if not ledger_file.exists():
            continue
        ld = json.loads(ledger_file.read_text(encoding="utf-8"))
        if ld.get("publication_status") == "under_review" and not allow_preprint:
            continue
        tid = str(ld.get("target_id") or "")
        hw = str(ld.get("headword") or cslug)
        row = _match_open_question_row(targets, tid, hw, cslug)
        if row is None:
            continue
        if row.get("status") == "under_review" and not allow_preprint:
            continue
        if row.get("status") != "published_case" or row.get("case_slug") != cslug:
            row["status"] = "published_case"
            row["case_slug"] = cslug
            synced_labels.append(f"{row.get('target_id')} ({cslug})")

    if synced_labels:
        data["updated_at"] = dt.date.today().isoformat()
        oq_path.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    return synced_labels


def _has_non_stale_upholding_review(
    review_status: str,
    reviews: list[dict[str, Any]],
    expected_content_fp: str,
    expected_ev_fps: dict[str, str],
) -> bool:
    if review_status == "unreviewed":
        return True
    expected_ev_json = validate_claims.canonical_json(expected_ev_fps)
    upholding_kinds: set[str] = set()
    for rev in reviews:
        if not isinstance(rev, dict):
            continue
        mfp = str(rev.get("material_fingerprint_at_review") or "")
        efp_map = rev.get("evidence_fingerprints_at_review")
        if not isinstance(efp_map, dict):
            continue
        is_stale = mfp != expected_content_fp or validate_claims.canonical_json(efp_map) != expected_ev_json
        if not is_stale and rev.get("recommendation") == "uphold":
            rkind = rev.get("reviewer_kind")
            if isinstance(rkind, str):
                upholding_kinds.add(rkind)

    if review_status == "human_reviewed":
        return "human" in upholding_kinds
    if review_status == "independently_agent_reviewed":
        return bool({"independent_agent", "human"} & upholding_kinds)
    if review_status == "agent_reviewed":
        return bool({"agent", "independent_agent", "human"} & upholding_kinds)
    return False


def _extract_raw_claims(payload: Any) -> tuple[list[dict[str, Any]], str | None]:
    if isinstance(payload, list):
        return [c for c in payload if isinstance(c, dict)], None
    if isinstance(payload, dict) and isinstance(payload.get("claims"), list):
        snote = payload.get("summary_note")
        clean_snote = sanitize_inline(snote, raw_drive_replacement="") if isinstance(snote, str) else None
        return [c for c in payload["claims"] if isinstance(c, dict)], clean_snote
    raise ValueError("Claims JSON must be a ClaimLedger object containing 'claims' or a JSON array of claim objects.")


def ingest_claims_ledger(
    *,
    claims_src: Path,
    slug: str,
    root: Path,
    merge_existing: bool,
    allow_preprint: bool,
) -> Path:
    public_dir = root / "public"
    ledgers_dir = public_dir / "ledgers"
    claims_dir = public_dir / "claims"
    cit_ledger_path = ledgers_dir / f"{slug}.json"

    if not cit_ledger_path.exists():
        raise SystemExit(
            f"ERROR: Cannot ingest claims for '{slug}': matching citation ledger public/ledgers/{slug}.json does not exist."
        )

    cit_ledger = json.loads(cit_ledger_path.read_text(encoding="utf-8"))
    if cit_ledger.get("publication_status") == "under_review" and not allow_preprint:
        raise SystemExit(
            f"[EMBARGO BLOCKED] Citation ledger for '{slug}' has publication_status='under_review'. Pass --allow-preprint if online preprint claims are authorized."
        )

    case_num = str(cit_ledger["case_number"])
    target_id = str(cit_ledger["target_id"])
    headword = str(cit_ledger["headword"])
    cm = validate_claims.CASE_NUMBER_RE.match(case_num)
    if not cm:
        raise SystemExit(f"ERROR: Invalid case_number {case_num!r} in {cit_ledger_path.name}")
    case_digits = cm.group(1)

    embargoed, emb_reason = is_target_embargoed(root, target_id, headword, slug)
    if embargoed and not allow_preprint:
        raise SystemExit(f"[EMBARGO BLOCKED] {emb_reason}. Pass --allow-preprint to publish preprint claims.")

    raw_payload = json.loads(claims_src.read_text(encoding="utf-8"))
    if isinstance(raw_payload, dict) and raw_payload.get("publication_status") == "under_review" and not allow_preprint:
        raise SystemExit(
            f"[EMBARGO BLOCKED] Incoming claims payload for '{slug}' specifies publication_status='under_review' without --allow-preprint."
        )

    raw_claims, incoming_summary_note = _extract_raw_claims(raw_payload)
    if not raw_claims:
        raise SystemExit(f"ERROR: No claim records found in {claims_src}")

    out_claims_path = claims_dir / f"{slug}.json"
    existing_by_id: dict[str, dict[str, Any]] = {}
    existing_order: list[str] = []
    existing_by_sig: dict[tuple[str, str], str] = {}
    existing_summary_note: str | None = None
    max_seq = 0

    if merge_existing and out_claims_path.exists():
        existing_ledger = json.loads(out_claims_path.read_text(encoding="utf-8"))
        if isinstance(existing_ledger.get("summary_note"), str):
            existing_summary_note = existing_ledger["summary_note"]
        for ec in existing_ledger.get("claims", []):
            if not isinstance(ec, dict) or not ec.get("id"):
                continue
            ec_clean = sanitize_claim_node(copy.deepcopy(ec))
            ec_id = str(ec_clean["id"])
            existing_by_id[ec_id] = ec_clean
            existing_order.append(ec_id)
            sig = (
                str(ec_clean.get("type") or ""),
                validate_claims.normalize_text(ec_clean.get("statement") or "").lower(),
            )
            if sig[1] and sig not in existing_by_sig:
                existing_by_sig[sig] = ec_id
            m_id = validate_claims.CLAIM_ID_RE.match(ec_id)
            if m_id and m_id.group(1) == case_digits:
                max_seq = max(max_seq, int(m_id.group(2)))

    # First scan incoming explicit IDs so auto-minted IDs never collide
    for rc in raw_claims:
        explicit_id = str(rc.get("id") or "").strip()
        m_id = validate_claims.CLAIM_ID_RE.match(explicit_id)
        if m_id and m_id.group(1) == case_digits:
            max_seq = max(max_seq, int(m_id.group(2)))

    today = dt.date.today().isoformat()
    merged_by_id: dict[str, dict[str, Any]] = copy.deepcopy(existing_by_id)
    claim_order: list[str] = list(existing_order)
    incoming_meta_by_id: dict[str, tuple[str | None, str | None]] = {}

    for rc in raw_claims:
        raw_had_id = bool(str(rc.get("id") or "").strip())
        raw_status = rc.get("review_status")
        raw_reviews = rc.get("reviews")
        clm = sanitize_claim_node(copy.deepcopy(rc))

        cid = str(clm.get("id") or "").strip()
        if not cid:
            sig = (
                str(clm.get("type") or ""),
                validate_claims.normalize_text(clm.get("statement") or "").lower(),
            )
            if merge_existing and sig in existing_by_sig:
                cid = existing_by_sig[sig]
            else:
                max_seq += 1
                cid = f"CLM-{case_digits}-{max_seq:03d}"

        clm["id"] = cid
        clm["slug"] = cid.lower()
        clm["case_slug"] = slug
        clm["headword"] = headword
        clm.setdefault("is_principal", False)
        clm.setdefault("lifecycle_status", "active")
        clm.setdefault("supersedes", [])
        clm.setdefault("superseded_by", None)
        clm.setdefault("limitations", [])
        clm.setdefault("resolution_criteria", [])
        clm.setdefault("evidence", [])
        clm.setdefault("antedating_baseline", None)
        clm.setdefault("negative_evidence_bounds", None)
        clm.setdefault("external_recognition", [])

        # Capture incoming revision author/summary if provided for revision_history bumps
        inc_author: str | None = None
        inc_summary: str | None = None
        if isinstance(clm.get("revision_history"), list) and clm["revision_history"]:
            last_rh = clm["revision_history"][-1]
            if isinstance(last_rh, dict):
                inc_author = last_rh.get("author") if isinstance(last_rh.get("author"), str) else None
                inc_summary = last_rh.get("summary") if isinstance(last_rh.get("summary"), str) else None
        incoming_meta_by_id[cid] = (inc_author, inc_summary)

        if merge_existing and cid in existing_by_id:
            old_clm = existing_by_id[cid]
            # Preserve supersedes union
            merged_sup: list[str] = []
            for s_id in [*(old_clm.get("supersedes") or []), *(clm.get("supersedes") or [])]:
                if isinstance(s_id, str) and s_id not in merged_sup:
                    merged_sup.append(s_id)
            clm["supersedes"] = merged_sup

            # Preserve superseded_by if old claim was already superseded and incoming omitted it
            if (
                old_clm.get("lifecycle_status") == "superseded"
                and old_clm.get("superseded_by")
                and rc.get("superseded_by") is None
                and rc.get("lifecycle_status") in (None, "superseded")
            ):
                clm["lifecycle_status"] = "superseded"
                clm["superseded_by"] = old_clm["superseded_by"]
                clm["is_principal"] = False

            # Preserve historical reviews[] from existing claim; ignore unverified incoming reviews
            clm["reviews"] = sanitize_claim_node(copy.deepcopy(old_clm.get("reviews") or []))
            if raw_status not in (None, "unreviewed", old_clm.get("review_status")):
                print(
                    f"[GUARDRAIL] {cid}: ignored incoming review_status={raw_status!r} on ingest; preserving or downgrading existing status based on material fingerprint."
                )
        else:
            # Brand-new claim (or full non-merge ingest): NEVER auto-promote review_status
            if raw_status not in (None, "unreviewed") or (isinstance(raw_reviews, list) and len(raw_reviews) > 0):
                label_hint = cid if raw_had_id else f"{cid} (minted)"
                print(
                    f"[GUARDRAIL] {label_hint}: refused auto-promotion to review_status={raw_status!r} on ingest; forcing 'unreviewed'."
                )
            clm["review_status"] = "unreviewed"
            clm["reviews"] = []

            rev_num = clm.get("revision")
            if not isinstance(rev_num, int) or isinstance(rev_num, bool) or rev_num < 1:
                rev_num = 1
            clm["revision"] = rev_num
            rev_hist = clm.get("revision_history")
            if not isinstance(rev_hist, list) or len(rev_hist) != rev_num:
                clm["revision_history"] = [
                    {
                        "revision": idx,
                        "date": today,
                        "author": inc_author or "DRAgNEt Claim Ingestion Pipeline",
                        "summary": inc_summary or f"Initial v1.0 claim ingestion for {case_num} ({slug}).",
                        "content_fingerprint": "0" * 64,
                    }
                    for idx in range(1, rev_num + 1)
                ]

        merged_by_id[cid] = clm
        if cid not in claim_order:
            claim_order.append(cid)

    # Reconcile bidirectional supersession links inside merged_by_id
    for cid in claim_order:
        c_obj = merged_by_id[cid]
        for sup_target in c_obj.get("supersedes") or []:
            if sup_target in merged_by_id:
                old_target = merged_by_id[sup_target]
                if old_target.get("lifecycle_status") != "superseded" or old_target.get("superseded_by") != cid:
                    old_target["lifecycle_status"] = "superseded"
                    old_target["superseded_by"] = cid
                    old_target["is_principal"] = False

    # Build cross-corpus FingerprintContext to evaluate material changes & staleness
    citation_by_id: dict[str, dict[str, Any]] = {}
    for lf in sorted(ledgers_dir.glob("*.json")):
        ld = json.loads(lf.read_text(encoding="utf-8"))
        for cit in ld.get("citations", []):
            if isinstance(cit, dict) and isinstance(cit.get("id"), str):
                citation_by_id[cit["id"]] = cit

    all_claims_by_id: dict[str, dict[str, Any]] = {}
    if claims_dir.exists():
        for cf in sorted(claims_dir.glob("*.json")):
            if cf.resolve() == out_claims_path.resolve():
                continue
            cd = json.loads(cf.read_text(encoding="utf-8"))
            for oc in cd.get("claims", []):
                if isinstance(oc, dict) and isinstance(oc.get("id"), str):
                    all_claims_by_id[oc["id"]] = oc
    for cid, c_obj in merged_by_id.items():
        all_claims_by_id[cid] = c_obj

    fp_ctx = validate_claims.FingerprintContext(citation_by_id, all_claims_by_id, public_dir)

    final_claims: list[dict[str, Any]] = []
    for cid in claim_order:
        clm = merged_by_id[cid]
        new_content_fp = validate_claims.compute_claim_content_fingerprint(clm, fp_ctx)
        new_ev_fps = validate_claims.compute_claim_evidence_fingerprints(clm, fp_ctx)

        if merge_existing and cid in existing_by_id:
            old_clm = existing_by_id[cid]
            old_fp = str(old_clm.get("content_fingerprint") or "")
            old_rev = int(old_clm.get("revision") or 1)
            old_rev_hist = copy.deepcopy(old_clm.get("revision_history") or [])
            old_status = str(old_clm.get("review_status") or "unreviewed")

            if new_content_fp != old_fp:
                inc_author, inc_summary = incoming_meta_by_id.get(cid, (None, None))
                new_rev = old_rev + 1
                clm["revision"] = new_rev
                clm["revision_history"] = [
                    *old_rev_hist,
                    {
                        "revision": new_rev,
                        "date": today,
                        "author": inc_author or "DRAgNEt Claim Ingestion Pipeline",
                        "summary": inc_summary or "Updated claim content or linked evidence via --merge-existing.",
                        "content_fingerprint": new_content_fp,
                    },
                ]
                if old_status != "unreviewed":
                    print(
                        f"[STALE REVIEW DOWNGRADED] {cid}: fingerprint changed ({old_fp[:12]}... -> {new_content_fp[:12]}...); "
                        f"preserved {len(clm.get('reviews') or [])} historical review(s) and downgraded '{old_status}' -> 'unreviewed'."
                    )
                clm["review_status"] = "unreviewed"
            else:
                clm["revision"] = old_rev
                clm["revision_history"] = old_rev_hist
                if _has_non_stale_upholding_review(old_status, clm.get("reviews") or [], new_content_fp, new_ev_fps):
                    clm["review_status"] = old_status
                else:
                    if old_status != "unreviewed":
                        print(
                            f"[STALE REVIEW DOWNGRADED] {cid}: no non-stale upholding review matches current evidence fingerprints; downgraded '{old_status}' -> 'unreviewed'."
                        )
                    clm["review_status"] = "unreviewed"

        clm["content_fingerprint"] = new_content_fp
        if isinstance(clm.get("revision_history"), list) and clm["revision_history"]:
            clm["revision_history"][-1]["content_fingerprint"] = new_content_fp

        final_claims.append(clm)

    out_obj: dict[str, Any] = {
        "schema_version": "1.0",
        "claim_ledger_id": slug,
        "case_slug": slug,
        "case_number": case_num,
        "target_id": target_id,
        "headword": headword,
        "updated_at": today,
    }
    summary_note = incoming_summary_note if incoming_summary_note is not None else existing_summary_note
    if summary_note is not None:
        out_obj["summary_note"] = summary_note
    out_obj["claims"] = final_claims

    serialized_preview = json.dumps(out_obj, indent=2, ensure_ascii=False)
    leak = validate_claims.find_workspace_or_drive_leak(serialized_preview)
    if leak:
        raise SystemExit(f"ERROR: Workspace/private leak '{leak}' remained after sanitization in {slug} claims.")

    out_claims_path.parent.mkdir(parents=True, exist_ok=True)
    out_claims_path.write_text(serialized_preview + "\n", encoding="utf-8")

    validate_claims.stamp_claim_ledger_fingerprints([out_claims_path], root_dir=root)
    val_res = validate_claims.validate_claims(root_dir=root, files=[out_claims_path])
    if not val_res["ok"]:
        print(f"CLAIM_VALIDATION_FAILED for {out_claims_path.relative_to(root)}:", file=sys.stderr)
        for err in val_res["errors"]:
            print(f"  - {err}", file=sys.stderr)
        raise SystemExit(1)

    print(
        f"[OK] Wrote claim ledger -> {out_claims_path.relative_to(root)} "
        f"({len(final_claims)} claims stamped & schema-validated)"
    )
    return out_claims_path


def resync_existing_claim_ledgers_after_citation_change(root: Path, skip_slug: str = "") -> None:
    """When a citation ledger is updated, re-evaluate existing claim ledgers so any claim whose
    upstream CERT-* material fingerprint changed gets its revision bumped, stale review_status
    downgraded to 'unreviewed' (preserving reviews[]), and content_fingerprint re-stamped."""
    claims_dir = root / "public" / "claims"
    if not claims_dir.exists():
        return
    claim_files = sorted(claims_dir.glob("*.json"))
    if not claim_files:
        return

    content_fps, ev_fps = validate_claims.compute_all_fingerprints(root_dir=root)
    today = dt.date.today().isoformat()
    touched_files: list[Path] = []

    for cf in claim_files:
        if skip_slug and cf.stem == skip_slug:
            continue
        data = json.loads(cf.read_text(encoding="utf-8"))
        modified = False
        for clm in data.get("claims", []):
            cid = str(clm.get("id") or "")
            if not cid or cid not in content_fps:
                continue
            new_fp = content_fps[cid]
            new_ev = ev_fps.get(cid, {})
            old_fp = str(clm.get("content_fingerprint") or "")
            old_status = str(clm.get("review_status") or "unreviewed")
            if new_fp != old_fp:
                old_rev = int(clm.get("revision") or 1)
                clm["revision"] = old_rev + 1
                rev_hist = list(clm.get("revision_history") or [])
                rev_hist.append(
                    {
                        "revision": old_rev + 1,
                        "date": today,
                        "author": "DRAgNEt Ingestion Pipeline",
                        "summary": "Re-stamped claim fingerprint following upstream citation ledger update.",
                        "content_fingerprint": new_fp,
                    }
                )
                clm["revision_history"] = rev_hist
                clm["content_fingerprint"] = new_fp
                if old_status != "unreviewed":
                    print(
                        f"[STALE REVIEW DOWNGRADED] {cid} ({cf.name}): upstream evidence changed; preserved historical reviews[] and reset '{old_status}' -> 'unreviewed'."
                    )
                    clm["review_status"] = "unreviewed"
                modified = True
            elif old_status != "unreviewed" and not _has_non_stale_upholding_review(
                old_status, clm.get("reviews") or [], new_fp, new_ev
            ):
                clm["review_status"] = "unreviewed"
                modified = True

        if modified:
            data["updated_at"] = today
            cf.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
            touched_files.append(cf)

    if touched_files:
        validate_claims.stamp_claim_ledger_fingerprints(touched_files, root_dir=root)


def bump_package_minor_version(root: Path) -> str | None:
    pkg_path = root / "package.json"
    if not pkg_path.exists():
        return None
    pkg = json.loads(pkg_path.read_text(encoding="utf-8"))
    cur = str(pkg.get("version") or "3.0.0").lstrip("v")
    parts = [int(x) if x.isdigit() else 0 for x in cur.split(".")]
    while len(parts) < 3:
        parts.append(0)
    parts[1] += 1
    parts[2] = 0
    new_ver = f"{parts[0]}.{parts[1]}.{parts[2]}"
    pkg["version"] = new_ver
    pkg_path.write_text(json.dumps(pkg, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    return new_ver


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="Plug-and-play DRAgNEt v3 Case, Citation Ledger & Claim Ledger Ingester.")
    ap.add_argument("--ledger", default="", help="Path to source JSON citation ledger (e.g. 1602_hokum_verified_ledger.json)")
    ap.add_argument("--claims", default="", help="Optional path to source JSON claim ledger (e.g. 1603_hokum_claims.json)")
    ap.add_argument("--monograph", default="", help="Optional path to monograph (.md or .txt)")
    ap.add_argument("--scans", "--scans-dir", dest="scans", default="", help="Optional path to evidence_scans/ folder containing PNG/WebP plates")
    ap.add_argument("--slug", default="", help="URL & ledger slug, e.g. hokum (auto-derived from headword if omitted)")
    ap.add_argument("--target-id", default="", help="Optional Target ID override, e.g. TGT-104")
    ap.add_argument("--case-number", default="", help="Optional display label override, e.g. 'Case 1600'")
    ap.add_argument(
        "--status",
        default="working_paper",
        choices=list(PUBLICATION_STATUS_DEFAULTS.keys()),
        help="Publication status badge & embargo gate",
    )
    ap.add_argument("--status-note", default="", help="Optional custom publicationStatusNote")
    ap.add_argument("--allow-preprint", action="store_true", help="Allow publishing full case/claims even when target is under_review")
    ap.add_argument("--merge-existing", action="store_true", help="Merge new records into existing public/ledgers/<slug>.json and/or public/claims/<slug>.json")
    ap.add_argument("--ledger-only", action="store_true", help="Write only public/ledgers/<slug>.json (skip Case Markdown)")
    ap.add_argument("--claims-only", action="store_true", help="Write only public/claims/<slug>.json (requires --claims and existing citation ledger)")
    ap.add_argument("--sync-open-questions", action="store_true", help="Reconcile public/data/open-questions.json against all published public cases")
    ap.add_argument("--overwrite", action="store_true", help="Overwrite existing src/content/cases/<slug>.md if present")
    ap.add_argument("--no-bump", action="store_true", help="Do not auto-bump package.json minor version")
    ap.add_argument("--site-root", default="", help="Root of DRAgNEt repository (defaults to repo root)")
    args = ap.parse_args(argv)

    root = Path(args.site_root).resolve() if args.site_root else Path(__file__).resolve().parent.parent
    public_dir = root / "public"

    # Embargo guard when --status under_review is explicitly requested without --allow-preprint
    if args.status == "under_review" and not args.allow_preprint:
        slug_guess = args.slug or "embargoed"
        updated = update_open_questions(root, args.target_id, slug_guess, slug_guess, "under_review")
        print(
            f"[EMBARGO GUARD] Status is 'under_review' without --allow-preprint: skipped writing public Case File, Ledger, and Claims "
            f"(open-questions.json updated={updated}). Pass --allow-preprint only if the journal permits online preprints."
        )
        return 0

    # Standalone --sync-open-questions mode
    if args.sync_open_questions and not args.ledger and not args.claims:
        synced = reconcile_published_cases_in_open_questions(root, allow_preprint=args.allow_preprint)
        if synced:
            print(f"[OK] Reconciled {len(synced)} published case(s) in open-questions.json: {', '.join(synced)}")
        else:
            print("[OK] open-questions.json is already synchronized with all published cases.")
        return 0

    claims_only = bool(args.claims_only or (args.claims and not args.ledger and not args.monograph))

    if claims_only:
        if not args.claims:
            raise SystemExit("ERROR: --claims-only requires --claims /path/to/claims.json")
        claims_src = Path(args.claims).resolve()
        if not claims_src.exists():
            raise SystemExit(f"ERROR: Claims file not found: {claims_src}")

        slug = args.slug.strip()
        if not slug:
            raw_cp = json.loads(claims_src.read_text(encoding="utf-8"))
            if isinstance(raw_cp, dict):
                slug = str(raw_cp.get("case_slug") or raw_cp.get("claim_ledger_id") or "").strip()
            if not slug:
                raise SystemExit("ERROR: Pass --slug <case_slug> when ingesting a bare claims array.")

        ingest_claims_ledger(
            claims_src=claims_src,
            slug=slug,
            root=root,
            merge_existing=args.merge_existing,
            allow_preprint=args.allow_preprint,
        )
        synced = reconcile_published_cases_in_open_questions(root, allow_preprint=args.allow_preprint)
        if synced:
            print(f"[OK] Synced published case(s) in open-questions.json: {', '.join(synced)}")
    else:
        if not args.ledger:
            raise SystemExit("ERROR: --ledger is required unless using --claims-only, --sync-open-questions, or --status under_review.")

        ledger_src = Path(args.ledger).resolve()
        if not ledger_src.exists():
            raise SystemExit(f"ERROR: Ledger file not found: {ledger_src}")

        raw_payload = json.loads(ledger_src.read_text(encoding="utf-8"))
        if isinstance(raw_payload, dict) and raw_payload.get("publication_status") == "under_review" and not args.allow_preprint:
            raise SystemExit(
                "[EMBARGO BLOCKED] Source ledger specifies publication_status='under_review'. Pass --allow-preprint if online preprint publication is authorized."
            )

        raw_certs = extract_raw_certs(raw_payload)
        if not raw_certs:
            raise SystemExit(f"ERROR: No certificate records found in {ledger_src}")

        headword = sanitize_inline(
            (raw_payload.get("headword") if isinstance(raw_payload, dict) else None)
            or raw_certs[0].get("headword")
            or args.slug,
            raw_drive_replacement="",
        )
        slug = args.slug or slugify(headword.split("/")[0].strip())
        target_id = (
            args.target_id
            or (raw_payload.get("target_id") if isinstance(raw_payload, dict) else None)
            or raw_certs[0].get("target_id")
            or "TGT-000"
        )

        embargoed, emb_reason = is_target_embargoed(root, target_id, headword, slug)
        if embargoed and not args.allow_preprint:
            raise SystemExit(f"[EMBARGO BLOCKED] {emb_reason}. Pass --allow-preprint to publish a public preprint dossier.")

        baseline_year = int(
            (
                (raw_payload.get("target_board_baseline_year") if isinstance(raw_payload, dict) else None)
                or (raw_payload.get("target_board_curated_baseline_year") if isinstance(raw_payload, dict) else None)
                or (raw_payload.get("baseline_year") if isinstance(raw_payload, dict) else None)
                or raw_certs[0].get("baseline_year")
                or 1900
            )
        )
        num_prefix = ledger_src.name.split("_")[0]
        case_num = args.case_number or (
            (str(raw_payload.get("case_number")) if isinstance(raw_payload, dict) and raw_payload.get("case_number") else "")
            or (f"Case {num_prefix}" if num_prefix.isdigit() else f"Case {slug.title()}")
        )
        pub_status_note = sanitize_inline(args.status_note or PUBLICATION_STATUS_DEFAULTS[args.status], raw_drive_replacement="")
        scans_dir = Path(args.scans).resolve() if args.scans else None

        out_ledger_path = public_dir / "ledgers" / f"{slug}.json"
        merged_by_id: dict[str, dict[str, Any]] = {}
        prior_baselines: dict[str, Any] = {}

        if args.merge_existing and out_ledger_path.exists():
            existing_data = json.loads(out_ledger_path.read_text(encoding="utf-8"))
            prior_baselines = sanitize_claim_node(existing_data.get("prior_art_baselines") or {})
            for ec in existing_data.get("citations", []):
                ec_norm = _enforce_v3_citation_sanitization_and_rights(ec, slug, scans_dir, public_dir)
                merged_by_id[ec_norm["id"]] = ec_norm
        elif isinstance(raw_payload, dict) and isinstance(raw_payload.get("prior_art_baselines"), dict):
            prior_baselines = sanitize_claim_node(raw_payload["prior_art_baselines"])

        for rc in raw_certs:
            norm = normalize_certificate(rc, slug, headword, scans_dir, public_dir)
            if args.merge_existing and norm["id"] in merged_by_id:
                norm = _preserve_existing_citation_verification(merged_by_id[norm["id"]], norm, public_dir)
            merged_by_id[norm["id"]] = norm

        final_citations = sorted(
            merged_by_id.values(),
            key=lambda x: (x.get("sort_date") or "9999", x["id"]),
        )

        out_ledger_obj = {
            "schema_version": "3.0",
            "ledger_id": slug,
            "case_number": case_num,
            "target_id": target_id,
            "headword": headword,
            "publication_status": args.status,
            "publication_status_note": pub_status_note,
            "updated_at": dt.date.today().isoformat(),
            "prior_art_baselines": prior_baselines,
            "citations": final_citations,
        }
        serialized_ledger = json.dumps(out_ledger_obj, indent=2, ensure_ascii=False)
        leak = validate_claims.find_workspace_or_drive_leak(serialized_ledger)
        if leak:
            raise SystemExit(f"ERROR: Workspace/private leak '{leak}' remained after sanitization in {slug} ledger.")

        out_ledger_path.parent.mkdir(parents=True, exist_ok=True)
        out_ledger_path.write_text(serialized_ledger + "\n", encoding="utf-8")

        hosted_cnt = sum(1 for c in final_citations if (c.get("scan") or {}).get("hosted_path"))
        print(
            f"[OK] Wrote ledger -> {out_ledger_path.relative_to(root)} ({len(final_citations)} citations, {hosted_cnt} hosted pre-1931 WebP scans)"
        )

        out_case_md = root / "src" / "content" / "cases" / f"{slug}.md"
        if not args.ledger_only:
            if out_case_md.exists() and not args.overwrite:
                print(f"[SKIP] {out_case_md.relative_to(root)} already exists (pass --overwrite to regenerate Markdown).")
            else:
                mono_path = Path(args.monograph).resolve() if args.monograph else None
                md_text = build_case_markdown(
                    slug=slug,
                    headword=headword,
                    target_id=target_id,
                    case_num=case_num,
                    pub_status=args.status,
                    pub_status_note=pub_status_note,
                    baseline_year=baseline_year,
                    citations=final_citations,
                    monograph_path=mono_path,
                )
                md_leak = validate_claims.find_workspace_or_drive_leak(md_text)
                if md_leak:
                    raise SystemExit(f"ERROR: Workspace/private leak '{md_leak}' remained in generated Markdown for {slug}.")
                out_case_md.parent.mkdir(parents=True, exist_ok=True)
                out_case_md.write_text(md_text, encoding="utf-8")
                print(f"[OK] Wrote Case File -> {out_case_md.relative_to(root)}")

        if args.claims:
            claims_src = Path(args.claims).resolve()
            if not claims_src.exists():
                raise SystemExit(f"ERROR: Claims file not found: {claims_src}")
            ingest_claims_ledger(
                claims_src=claims_src,
                slug=slug,
                root=root,
                merge_existing=args.merge_existing,
                allow_preprint=args.allow_preprint,
            )
            resync_existing_claim_ledgers_after_citation_change(root, skip_slug=slug)
        else:
            resync_existing_claim_ledgers_after_citation_change(root)

        # Auto-sync open-questions.json whenever a public Case File exists on disk
        if out_case_md.exists():
            if update_open_questions(root, target_id, headword, slug, "published_case"):
                print(f"[OK] Marked {target_id} ({headword}) as 'published_case' in public/data/open-questions.json")
        synced_others = reconcile_published_cases_in_open_questions(root, allow_preprint=args.allow_preprint)
        if synced_others:
            print(f"[OK] Reconciled published case(s) in open-questions.json: {', '.join(synced_others)}")

        if not args.ledger_only and not args.no_bump:
            new_ver = bump_package_minor_version(root)
            if new_ver:
                print(f"[OK] Bumped package.json version -> {new_ver} (triggers GitHub Release v{new_ver} on push to main)")

    # Run submission validator automatically
    validator = root / "scripts" / "validate_submission.py"
    if validator.exists():
        res = subprocess.run([sys.executable, str(validator)], cwd=str(root))
        if res.returncode != 0:
            raise SystemExit(res.returncode)

    # Run claim validator automatically when public/claims/*.json exist
    claims_dir = root / "public" / "claims"
    if claims_dir.exists() and any(claims_dir.glob("*.json")):
        c_res = validate_claims.validate_claims(root_dir=root)
        if not c_res["ok"]:
            print(f"CLAIM_VALIDATION_FAILED with {len(c_res['errors'])} error(s):", file=sys.stderr)
            for err in c_res["errors"]:
                print(f"  - {err}", file=sys.stderr)
            raise SystemExit(1)

    print("\nReady! Review the diff, commit, and push when ready to deploy & release.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
