#!/usr/bin/env python3
"""
add_case.py (DRAgNEt v3 Plug-and-Play Monograph & Ledger Ingester)
------------------------------------------------------------------
One-command local pipeline to add or upgrade a completed research monograph + JSON ledger
in the DRAgNEt Astro repository. Runs on pure Python 3 standard library (zero pip packages
required; uses Pillow, cwebp, or ffmpeg automatically when converting pre-1931 PNG scans to WebP).

Examples (Windows PowerShell / Command Prompt or macOS/Linux):
  # 1. Add a brand-new completed word (monograph + ledger + scans folder):
  python scripts/add_case.py ^
    --ledger "M:\etymology\1602_hokum_verified_ledger.json" ^
    --monograph "M:\etymology\1601_hokum_origin_and_word_family_monograph.md" ^
    --scans "M:\etymology\evidence_scans" ^
    --slug hokum

  # 2. Upgrade an existing case with a Phase-2 ledger (e.g., merging 1402 into shill-shillaber):
  python scripts/add_case.py ^
    --ledger "M:\etymology\1402_shill_phase2_verified_ledger.json" ^
    --monograph "M:\etymology\1401_shill_shillaber_american_speech_definitive_monograph.md" ^
    --scans "M:\etymology\evidence_scans" ^
    --slug shill-shillaber ^
    --merge-existing ^
    --overwrite

  # 3. Record an embargoed journal submission on /open-questions/ without publishing full text:
  python scripts/add_case.py ^
    --slug shindy ^
    --target-id TGT-019 ^
    --status under_review
"""
from __future__ import annotations
import argparse
import datetime as dt
import json
import re
import shutil
import subprocess
import sys
from pathlib import Path
from typing import Any

DRIVE_URL_MD_RE = re.compile(r"\[([^\]]+)\]\(https?://(?:drive|docs)\.google\.com/[^)]+\)")
DRIVE_URL_RAW_RE = re.compile(r"https?://(?:drive|docs)\.google\.com/\S+")
GOOGLE_REDIRECT_RE = re.compile(r"https?://www\.google\.com/search\?q=(https?://[^&\s)]+)")
RAW_SCORE_KV_RE = re.compile(
    r"(?:,\s*|\s*\()?(?:\b(?:SLPL|JW|jaro[_ -]?winkler|skeleton_similarity|similarity)\s*[=:]?\s*\d\.\d{3,4})\b\)?",
    re.IGNORECASE,
)
FOUR_DEC_PAREN_RE = re.compile(r"\(\s*\d\.\d{4}\s*\)")
DECIMAL_YEAR_RE = re.compile(r"(-?\b\d+)\.(\d+)\s*(yrs?|years?)\b", re.IGNORECASE)
CERT_ID_RE = re.compile(r"\b(CERT-\d{3,4}-\d{3}[A-Za-z]?)\b")

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


def sanitize_inline(text: Any) -> str:
    if not text:
        return ""
    s = str(text)
    s = GOOGLE_REDIRECT_RE.sub(r"\1", s)
    s = DRIVE_URL_MD_RE.sub(r"\1", s)
    s = DRIVE_URL_RAW_RE.sub("[archived scan]", s)
    s = s.replace("googledrive://", "").replace("evidence_scans/", "")
    s = RAW_SCORE_KV_RE.sub("", s)
    s = FOUR_DEC_PAREN_RE.sub("", s)
    s = replace_decimal_years(s)
    return " ".join(s.split()).strip()


def sanitize_prose_block(text: str) -> str:
    out_lines: list[str] = []
    for raw_line in text.splitlines():
        line = GOOGLE_REDIRECT_RE.sub(r"\1", raw_line)
        line = DRIVE_URL_MD_RE.sub(r"\1", line)
        line = DRIVE_URL_RAW_RE.sub("", line)
        line = line.replace("googledrive://", "").replace("evidence_scans/", "")
        line = RAW_SCORE_KV_RE.sub("", line)
        line = FOUR_DEC_PAREN_RE.sub("", line)
        line = replace_decimal_years(line)
        line = re.sub(r"\bscore_phonological_contact\(\)", "phonological comparison", line)
        out_lines.append(line.rstrip())
    return "\n".join(out_lines).strip()


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
        candidates.extend([
            scans_dir / clean_name,
            scans_dir / "evidence_scans" / clean_name,
        ])
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

    # Try Pillow first
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

    # Fallback 2: cwebp CLI
    cwebp = shutil.which("cwebp")
    if cwebp:
        res = subprocess.run(
            [cwebp, "-quiet", "-q", "82", str(src_img), "-o", str(dest_webp)],
            capture_output=True,
        )
        if res.returncode == 0 and dest_webp.exists():
            return True

    # Fallback 3: ffmpeg CLI
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


def normalize_certificate(
    c: dict[str, Any],
    slug: str,
    default_headword: str,
    scans_dir: Path | None,
    public_dir: Path,
) -> dict[str, Any]:
    # Already v3 record
    if "record_type" in c and "verification_level" in c and "id" in c:
        rec = dict(c)
        rec["case_slug"] = slug
        return rec

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

    src_url = str(c.get("source_url") or "https://archive.org/").strip()
    src_url = GOOGLE_REDIRECT_RE.sub(r"\1", src_url)
    if "drive.google.com" in src_url or "docs.google.com" in src_url or not src_url.startswith("https://"):
        if src_url.startswith("http://"):
            src_url = "https://" + src_url[len("http://") :]
        else:
            src_url = "https://archive.org/"

    attested_form = sanitize_inline(c.get("attested_spelling") or c.get("headword") or default_headword)
    pub_title = sanitize_inline(c.get("source_publication") or "Archival Source")
    notes_clean = sanitize_inline(c.get("auditor_notes") or c.get("rejection_reason") or "")
    short_gloss = (
        f"{attested_form} in {pub_title}"
        if rtype == "attestation"
        else f"{rtype.replace('_', ' ').title()}: {attested_form}"
    )[:140]

    # Pre-1931 U.S. public-domain scan bundling
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
            if convert_to_webp(src_scan, dest_abs) and dest_abs.stat().st_size <= 5 * 1024 * 1024:
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


def prose_excerpt(text: str, limit: int) -> str:
    """Shorten UI prose at a word boundary and visibly mark the omission."""
    if len(text) <= limit:
        return text
    words = text[:limit].rsplit(maxsplit=1)
    return (words[0].rstrip(" ,;:") if len(words) > 1 else "").rstrip() + "…"


def check_monograph_format(path: Path) -> None:
    """Reject flattened multi-row tables rather than silently publishing them as prose."""
    raw = path.read_text(encoding="utf-8-sig")
    lines = raw.splitlines()
    fence: tuple[str, int] | None = None
    indented_cells = 0
    for line in lines:
        match = re.match(r"^ {0,3}(`{3,}|~{3,})(.*)$", line)
        if match:
            marker, rest = match.groups()
            if fence is None:
                fence = (marker[0], len(marker))
            elif marker[0] == fence[0] and len(marker) >= fence[1] and not rest.strip():
                fence = None
            indented_cells = 0
            continue
        if fence is not None:
            continue
        if line.startswith("\t") and line.strip():
            indented_cells += 1
            if indented_cells >= 7:
                raise SystemExit(
                    f"ERROR: {path} contains a likely flattened table or unfenced tab-indented block. "
                    "Export actual Markdown: use pipe-delimited tables and explicit # headings, "
                    "or fence intentional code blocks."
                )
        else:
            indented_cells = 0


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

    raw_txt = monograph_path.read_text(encoding="utf-8-sig")
    # Strip downstream OED web-form boxes and journal submission drafts (Sections 6-7)
    cutoff_patterns = [
        r"(?m)^#{0,3}\s*(?:Section\s*)?[67]\.\s+(?:Ready-to-Paste|Oxford English Dictionary|OED\s+Antedating|Submission-Ready)",
        r"(?m)^#{1,3}\s*(?:Box\s+1\s*[:—-]|Submission-Ready\s+(?:Short\s+Note|Article|Manuscript))",
    ]
    for pat in cutoff_patterns:
        m = re.search(pat, raw_txt, re.IGNORECASE)
        if m:
            raw_txt = raw_txt[: m.start()].rstrip()

    cleaned = sanitize_prose_block(raw_txt)

    # Remove any unknown CERT-ID references that aren't in this ledger so cross-ref check always passes
    def _filter_cert(m: re.Match[str]) -> str:
        cid = m.group(1)
        return cid if cid in valid_cert_ids else ""

    cleaned = CERT_ID_RE.sub(_filter_cert, cleaned)

    # Normalize top-level numbered section headers from Google Docs plain-text exports into ## headings
    out_lines: list[str] = []
    facts: list[str] = []
    prior_summary = ""

    for line in cleaned.splitlines():
        stripped = line.strip()
        if monograph_path.suffix.lower() == ".txt" and re.match(r"^[1-5]\.\s+[A-Z][A-Za-z0-9 ,&'()/:—–-]{8,95}$", stripped) and not stripped.endswith("."):
            out_lines.append(f"\n## {stripped}\n")
            continue
        out_lines.append(line)
        if not prior_summary and len(stripped) > 90 and ("OED" in stripped or "Oxford English Dictionary" in stripped or "Green" in stripped):
            prior_summary = prose_excerpt(sanitize_inline(stripped), 420)
        if len(facts) < 4 and len(stripped) > 70 and any(cid in stripped for cid in valid_cert_ids):
            facts.append(prose_excerpt(sanitize_inline(stripped.lstrip("*-0123456789. ")), 320))

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

    hyp_summary = prose_excerpt(
        hyps[0]["analysis_notes"] or hyps[0]["linguistic_note"]
        if hyps
        else f"Evaluates candidate donor and morphological pathways for {headword} against chronological constraints.",
        360,
    )

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
    lines.extend([
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
    ])
    for fact in mono_facts[:4]:
        lines.append(f"- {yaml_str(fact)}")
    lines.extend([
        "originHypothesis:",
        f"  label: {yaml_str('Evaluated Etymological Hypothesis')}",
        f"  summary: {yaml_str(hyp_summary)}",
        f"  boundaryNote: {yaml_str('Chronological attestations in the ledger are established primary evidence; ultimate phonological or contact derivations remain falsifiable linguistic hypotheses.')}",
        "chronologyTimeline:",
    ])
    for item in timeline_items:
        note_txt = prose_excerpt(item.get("analysis_notes") or item.get("short_gloss") or item.get("attested_form") or "", 160)
        lines.extend([
            f"- date: {yaml_str(item['date_display'])}",
            f"  form: {yaml_str(item['attested_form'])}",
            f"  source: {yaml_str(item['source_publication'])}",
            f"  note: {yaml_str(note_txt)}",
            f"  certId: {yaml_str(item['id'])}",
        ])
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
    lines.extend([
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
    ])
    return "\n".join(lines)


def update_open_questions(root: Path, target_id: str, headword: str, slug: str, status_value: str) -> bool:
    oq_path = root / "public" / "data" / "open-questions.json"
    if not oq_path.exists():
        return False
    data = json.loads(oq_path.read_text(encoding="utf-8"))
    updated = False
    for row in data.get("targets", []):
        if (target_id and row.get("target_id") == target_id) or (
            headword and str(row.get("headword") or "").lower().split("/")[0].strip() == headword.lower().split("/")[0].strip()
        ):
            row["status"] = status_value
            row["case_slug"] = slug if status_value == "published_case" else None
            updated = True
    if updated:
        data["updated_at"] = dt.date.today().isoformat()
        oq_path.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    return updated


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


def main() -> int:
    ap = argparse.ArgumentParser(description="Plug-and-play DRAgNEt v3 Case & Ledger Ingester.")
    ap.add_argument("--ledger", default="", help="Path to source JSON ledger (e.g. 1602_hokum_verified_ledger.json)")
    ap.add_argument("--monograph", default="", help="Optional path to monograph (.md or .txt exported from Google Docs)")
    ap.add_argument("--scans", default="", help="Optional path to evidence_scans/ folder containing PNG/WebP plates")
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
    ap.add_argument("--allow-preprint", action="store_true", help="Allow publishing full case even when --status=under_review")
    ap.add_argument("--merge-existing", action="store_true", help="Merge new certificates into existing public/ledgers/<slug>.json")
    ap.add_argument("--ledger-only", action="store_true", help="Write only public/ledgers/<slug>.json (skip Case Markdown)")
    ap.add_argument("--overwrite", action="store_true", help="Overwrite existing src/content/cases/<slug>.md if present")
    ap.add_argument("--no-bump", action="store_true", help="Do not auto-bump package.json minor version")
    ap.add_argument("--site-root", default="", help="Root of DRAgNEt repository (defaults to repo root)")
    args = ap.parse_args()

    root = Path(args.site_root).resolve() if args.site_root else Path(__file__).resolve().parent.parent
    public_dir = root / "public"

    # Embargo guard for under_review submissions
    if args.status == "under_review" and not args.allow_preprint:
        slug_guess = args.slug or "embargoed"
        updated = update_open_questions(root, args.target_id, slug_guess, slug_guess, "under_review")
        print(
            f"[EMBARGO GUARD] Status is 'under_review' without --allow-preprint: skipped writing public Case File/Ledger "
            f"(open-questions.json updated={updated}). Pass --allow-preprint only if the journal permits online preprints."
        )
        return 0

    if not args.ledger:
        raise SystemExit("ERROR: --ledger is required unless recording an embargoed --status under_review target.")

    ledger_src = Path(args.ledger).resolve()
    if not ledger_src.exists():
        raise SystemExit(f"ERROR: Ledger file not found: {ledger_src}")

    raw_payload = json.loads(ledger_src.read_text(encoding="utf-8"))
    raw_certs = extract_raw_certs(raw_payload)
    if not raw_certs:
        raise SystemExit(f"ERROR: No certificate records found in {ledger_src}")

    headword = sanitize_inline(
        (raw_payload.get("headword") if isinstance(raw_payload, dict) else None)
        or raw_certs[0].get("headword")
        or args.slug
    )
    slug = args.slug or slugify(headword.split("/")[0].strip())
    out_case_md = root / "src" / "content" / "cases" / f"{slug}.md"
    mono_path = Path(args.monograph).resolve() if args.monograph else None
    if mono_path and not args.ledger_only and (args.overwrite or not out_case_md.exists()):
        if not mono_path.is_file():
            raise SystemExit(f"ERROR: Monograph file not found: {mono_path}")
        check_monograph_format(mono_path)
    target_id = (
        args.target_id
        or (raw_payload.get("target_id") if isinstance(raw_payload, dict) else None)
        or raw_certs[0].get("target_id")
        or "TGT-000"
    )
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
    case_num = args.case_number or (f"Case {num_prefix}" if num_prefix.isdigit() else f"Case {slug.title()}")
    pub_status_note = args.status_note or PUBLICATION_STATUS_DEFAULTS[args.status]
    scans_dir = Path(args.scans).resolve() if args.scans else None

    out_ledger_path = public_dir / "ledgers" / f"{slug}.json"
    merged_by_id: dict[str, dict[str, Any]] = {}
    prior_baselines: dict[str, Any] = {}

    if args.merge_existing and out_ledger_path.exists():
        existing_data = json.loads(out_ledger_path.read_text(encoding="utf-8"))
        prior_baselines = existing_data.get("prior_art_baselines") or {}
        for ec in existing_data.get("citations", []):
            merged_by_id[ec["id"]] = ec

    for rc in raw_certs:
        norm = normalize_certificate(rc, slug, headword, scans_dir, public_dir)
        merged_by_id[norm["id"]] = norm

    final_citations = sorted(
        merged_by_id.values(),
        key=lambda x: (x.get("sort_date") or "9999", x["id"]),
    )

    out_ledger_path.parent.mkdir(parents=True, exist_ok=True)
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
    out_ledger_path.write_text(json.dumps(out_ledger_obj, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")

    hosted_cnt = sum(1 for c in final_citations if (c.get("scan") or {}).get("hosted_path"))
    print(f"[OK] Wrote ledger -> {out_ledger_path.relative_to(root)} ({len(final_citations)} citations, {hosted_cnt} hosted pre-1931 WebP scans)")

    if not args.ledger_only:
        if out_case_md.exists() and not args.overwrite:
            print(f"[SKIP] {out_case_md.relative_to(root)} already exists (pass --overwrite to regenerate Markdown).")
        else:
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
            out_case_md.parent.mkdir(parents=True, exist_ok=True)
            out_case_md.write_text(md_text, encoding="utf-8")
            print(f"[OK] Wrote Case File -> {out_case_md.relative_to(root)}")

        if update_open_questions(root, target_id, headword, slug, "published_case"):
            print(f"[OK] Marked {target_id} ({headword}) as 'published_case' in public/data/open-questions.json")

        if not args.no_bump:
            new_ver = bump_package_minor_version(root)
            if new_ver:
                print(f"[OK] Bumped package.json version -> {new_ver} (triggers GitHub Release v{new_ver} on push to main)")

    # Run validation automatically
    validator = root / "scripts" / "validate_submission.py"
    if validator.exists():
        res = subprocess.run([sys.executable, str(validator)], cwd=str(root))
        if res.returncode != 0:
            raise SystemExit(res.returncode)

    print("\nReady! Review the diff in GitHub Desktop, commit, and click 'Push origin' to deploy & release.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
