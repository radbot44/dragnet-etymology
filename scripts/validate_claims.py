#!/usr/bin/env python3
"""
validate_claims.py (DRAgNEt Claim-Level Evidence Architecture v1.0)
-------------------------------------------------------------------
Zero-dependency Python 3 stdlib validator & deterministic fingerprint stamper.
Implements identical structural, graph, chronological, provenance,
fingerprinting, and sanitization rules to scripts/validate-claims.mjs.
"""
from __future__ import annotations

import argparse
import calendar
import datetime as dt
import hashlib
import json
import re
import sys
import unicodedata
from pathlib import Path
from typing import Any

DEFAULT_ROOT = Path(__file__).resolve().parent.parent

DOCUMENTARY_TYPES = {
    "attestation",
    "antedating",
    "negative_evidence",
    "source_relationship",
}

INTERPRETIVE_TYPES = {
    "semantic",
    "historical_context",
    "transmission",
    "derivation",
    "phonological",
    "rebuttal",
}

VALID_CLAIM_TYPES = DOCUMENTARY_TYPES | INTERPRETIVE_TYPES
VALID_ASSESSMENTS = {
    "unassessed",
    "supported",
    "partially_supported",
    "inconclusive",
    "contradicted",
}
UNRESOLVED_ASSESSMENTS = {
    "unassessed",
    "partially_supported",
    "inconclusive",
}
VALID_REVIEW_STATUSES = {
    "unreviewed",
    "agent_reviewed",
    "independently_agent_reviewed",
    "human_reviewed",
}
VALID_LIFECYCLE_STATUSES = {"active", "superseded", "withdrawn"}
VALID_PRECISIONS = {"day", "month", "year", "circa"}
VALID_RELATIONSHIPS = {
    "supports",
    "contradicts",
    "weakens",
    "qualifies",
    "contextualizes",
    "depends_on",
}
INFERENTIAL_RELATIONSHIPS = {"depends_on", "supports"}
VALID_DIRECTNESS = {"direct", "indirect", "contextual"}
VALID_COMPARISON_KINDS = {
    "earlier_same_sense",
    "earlier_spelling",
    "earlier_derivative_or_inflected",
    "proper_name_precursor",
    "earliest_in_search_scope",
    "earliest_reported_by_authority",
}
STRICT_ADVANCING_KINDS = {
    "earlier_same_sense",
    "earlier_spelling",
    "earlier_derivative_or_inflected",
    "proper_name_precursor",
}
VALID_INSPECTION_MODES = {
    "directly_inspected",
    "inherited_from_existing_research",
}
VALID_REVIEWER_KINDS = {"agent", "independent_agent", "human"}
VALID_REVIEW_SCOPES = {
    "structural",
    "transcription",
    "archival",
    "baseline",
    "linguistic_argument",
}
VALID_RECOMMENDATIONS = {
    "uphold",
    "revise",
    "downgrade",
    "contradict",
    "withdraw",
    "needs_human_review",
}

ALLOWED_LEDGER_KEYS = {
    "schema_version",
    "claim_ledger_id",
    "case_slug",
    "case_number",
    "target_id",
    "headword",
    "updated_at",
    "summary_note",
    "claims",
}

ALLOWED_CLAIM_KEYS = {
    "id",
    "slug",
    "case_slug",
    "headword",
    "target_lexeme",
    "case_section",
    "short_label",
    "statement",
    "rationale",
    "type",
    "assessment",
    "review_status",
    "is_principal",
    "sort_order",
    "lifecycle_status",
    "revision",
    "supersedes",
    "superseded_by",
    "evidence_boundary",
    "limitations",
    "resolution_criteria",
    "evidence",
    "antedating_baseline",
    "negative_evidence_bounds",
    "content_fingerprint",
    "revision_history",
    "reviews",
    "external_recognition",
}

ALLOWED_BOUNDARY_KEYS = {
    "establishes",
    "does_not_establish",
    "remaining_uncertainty",
}

ALLOWED_EVIDENCE_KEYS = {
    "ref",
    "relationship",
    "directness",
    "reason",
    "witness_note",
}

ALLOWED_ANTEDATING_KEYS = {
    "authority",
    "entry_and_sense",
    "edition_or_revision",
    "baseline_date",
    "baseline_date_precision",
    "source_url_or_ref",
    "checked_date",
    "comparison_kind",
    "advancing_citation_ref",
    "attested_date",
    "attested_date_precision",
    "computed_advance_display",
    "inspection_mode",
}

ALLOWED_NEGATIVE_KEYS = {
    "corpus_identity",
    "search_date",
    "search_period",
    "query_terms",
    "search_method",
    "corpus_coverage",
    "known_limitations",
    "qualifying_results_count",
}

ALLOWED_REVISION_KEYS = {
    "revision",
    "date",
    "author",
    "summary",
    "content_fingerprint",
}

ALLOWED_REVIEW_KEYS = {
    "review_id",
    "claim_id",
    "claim_revision",
    "reviewer_id",
    "reviewer_kind",
    "model_version",
    "review_date",
    "review_scopes",
    "inspected_evidence_refs",
    "findings",
    "objections",
    "material_fingerprint_at_review",
    "evidence_fingerprints_at_review",
    "recommendation",
}

ALLOWED_EXTERNAL_REC_KEYS = {
    "recognizer",
    "publication",
    "date",
    "url_or_ref",
    "exact_scope",
}

SLUG_RE = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")
CASE_NUMBER_RE = re.compile(r"^Case (\d{3,4})$")
TARGET_ID_RE = re.compile(r"^TGT-\d{3,4}$")
CLAIM_ID_RE = re.compile(r"^CLM-(\d{3,4})-(\d{3})$")
CLAIM_SLUG_RE = re.compile(r"^clm-\d{3,4}-\d{3}$")
CERT_ID_RE = re.compile(r"^CERT-\d{3,4}-\d{3}[A-Za-z]?$")
REVIEW_ID_RE = re.compile(r"^REV-\d{3,4}-\d{3}-\d{2,3}$")
SHA256_RE = re.compile(r"^[0-9a-f]{64}$")
PARTIAL_ISO_DATE_RE = re.compile(r"^\d{4}(?:-\d{2}(?:-\d{2})?)?$")

FORBIDDEN_SCORE_KEY_RE = re.compile(
    r"(?:confidence|probability|likelihood|certainty_score|bayesian|posterior|prior_score|slpl_score|jw_score)",
    re.IGNORECASE,
)
WORKSPACE_LEAK_RE = re.compile(
    "|".join(
        [
            r"drive[.]google[.]com",
            r"docs[.]google[.]com",
            r"googledrive[:][/][/]",
            r"workspace[_]drive[_]folder[_]id",
            r"evidence[_]scans[_]folder[_]id",
            r"scan[_]evidence[_]drive[_]id",
            r"\bDrive\s+ID\b",
            r"[/]working[_]dir[/]",
            r"[/]home[/]spark[/]",
            r"\bwt[-]agent-\d+\b",
            r"\bc_[0-9a-f]{12,}\b",
        ]
    ),
    re.IGNORECASE,
)
RAW_GDRIVE_ID_RE = re.compile(
    r"(?<![A-Za-z0-9_/-])(?:1[A-Za-z0-9_-]{27,49}|0B[A-Za-z0-9_-]{26,48})(?![A-Za-z0-9_/-])"
)


def find_workspace_or_drive_leak(text: Any) -> str | None:
    s = "" if text is None else str(text)
    m = WORKSPACE_LEAK_RE.search(s)
    if m:
        return m.group(0)
    for gm in RAW_GDRIVE_ID_RE.finditer(s):
        tok = gm.group(0)
        if re.search(r"[A-Z]", tok) and re.search(r"[a-z]", tok) and re.search(r"\d", tok):
            return tok
    return None
DECIMAL_YEAR_RE = re.compile(r"(?:-?\b\d+\.\d+\s*(?:yrs?|years?)\b)", re.IGNORECASE)
RAW_SCORE_RE = re.compile(
    r"\b(?:SLPL|JW|jaro[_ -]?winkler|skeleton_similarity|confidence(?:_score)?)\s*(?:=|:)\s*\d\.\d{2,4}\b",
    re.IGNORECASE,
)
PCT_CONFIDENCE_RE = re.compile(
    r"\b\d{1,3}(?:\.\d+)?%\s*(?:confidence|certain|probability|likely)\b",
    re.IGNORECASE,
)
NON_HUMAN_REVIEWER_RE = re.compile(
    r"\b(?:agent|bot|claude|gpt|gemini|llm|openai|anthropic|dragnet|pipeline|automated|system)\b",
    re.IGNORECASE,
)
HUMAN_NAME_RE = re.compile(r"[A-Za-z]{2,}\s+[A-Za-z]{2,}")

WHITESPACE_COLLAPSE_RE = re.compile(
    r"[\t\n\v\f\r \u00a0\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]+"
)


def is_strict_int(val: Any) -> bool:
    return isinstance(val, int) and not isinstance(val, bool)


def is_non_empty_str(val: Any) -> bool:
    return isinstance(val, str) and len(val.strip()) > 0


def normalize_text(value: Any) -> str:
    raw = "" if value is None else str(value)
    nfc = unicodedata.normalize("NFC", raw)
    return WHITESPACE_COLLAPSE_RE.sub(" ", nfc).strip()


def canonical_json(value: Any) -> str:
    if value is None:
        return "null"
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, int):
        return str(value)
    if isinstance(value, str):
        return json.dumps(value, ensure_ascii=False)
    if isinstance(value, list):
        return "[" + ",".join(canonical_json(item) for item in value) + "]"
    if isinstance(value, dict):
        parts = [f"{json.dumps(k, ensure_ascii=False)}:{canonical_json(value[k])}" for k in sorted(value.keys())]
        return "{" + ",".join(parts) + "}"
    raise TypeError(f"Unsupported value in canonical_json: {type(value)!r}")


def sha256_hex(data: str | bytes) -> str:
    if isinstance(data, str):
        data = data.encode("utf-8")
    return hashlib.sha256(data).hexdigest()


def days_in_gregorian_month(year: int, month: int) -> int:
    if month < 1 or month > 12:
        return 0
    return calendar.monthrange(year, month)[1]


def is_valid_iso_calendar_date(date_str: Any) -> bool:
    if not isinstance(date_str, str):
        return False
    m = re.match(r"^(\d{4})-(\d{2})-(\d{2})$", date_str)
    if not m:
        return False
    year, month, day = int(m.group(1)), int(m.group(2)), int(m.group(3))
    if year < 1000 or year > 2999 or month < 1 or month > 12:
        return False
    return 1 <= day <= days_in_gregorian_month(year, month)


def parse_historical_date_by_precision(raw_date: Any, precision: Any) -> dict[str, Any] | None:
    if not isinstance(raw_date, str) or not isinstance(precision, str):
        return None
    trimmed = normalize_text(raw_date)
    if precision == "day":
        if not is_valid_iso_calendar_date(trimmed):
            return None
        y, m, d = (int(x) for x in trimmed.split("-"))
        return {"raw": trimmed, "precision": "day", "year": y, "month": m, "day": d}
    if precision == "month":
        m = re.match(r"^(\d{4})-(\d{2})$", trimmed)
        if not m:
            return None
        year, month = int(m.group(1)), int(m.group(2))
        if year < 1000 or year > 2999 or month < 1 or month > 12:
            return None
        return {"raw": trimmed, "precision": "month", "year": year, "month": month}
    if precision == "year":
        m = re.match(r"^(\d{4})$", trimmed)
        if not m:
            return None
        year = int(m.group(1))
        if year < 1000 or year > 2999:
            return None
        return {"raw": trimmed, "precision": "year", "year": year}
    if precision == "circa":
        m = re.match(r"^(?:c\.\s*)?(\d{4})(?:[–-](\d{4}))?$", trimmed)
        if not m:
            return None
        year = int(m.group(1))
        end_year = int(m.group(2)) if m.group(2) else None
        if year < 1000 or year > 2999:
            return None
        if end_year is not None and (end_year < year or end_year > 2999):
            return None
        return {"raw": trimmed, "precision": "circa", "year": year, "end_year": end_year}
    return None


PRECISION_RANK = {"circa": 0, "year": 1, "month": 2, "day": 3}


def _format_units(parts: list[str]) -> str:
    if not parts:
        return "0 days"
    if len(parts) == 1:
        return parts[0]
    if len(parts) == 2:
        return f"{parts[0]} and {parts[1]}"
    return f"{', '.join(parts[:-1])}, and {parts[-1]}"


def compute_chronological_advance(
    attested_date: str,
    attested_precision: str,
    baseline_date: str,
    baseline_precision: str,
) -> dict[str, Any]:
    rank = min(PRECISION_RANK.get(attested_precision, -1), PRECISION_RANK.get(baseline_precision, -1))
    effective_precision = (
        "day" if rank == 3 else "month" if rank == 2 else "year" if rank == 1 else "circa"
    )

    att = parse_historical_date_by_precision(attested_date, attested_precision)
    base = parse_historical_date_by_precision(baseline_date, baseline_precision)
    if not att or not base:
        return {
            "comparable": False,
            "effective_precision": effective_precision,
            "is_strictly_earlier": None,
            "is_same_at_precision": None,
            "canonical_display": "Invalid date format for declared precision",
        }

    if effective_precision == "circa":
        att_ref = att.get("end_year") or att["year"]
        approx_diff = base["year"] - att_ref
        unit = "year" if approx_diff == 1 else "years"
        return {
            "comparable": False,
            "effective_precision": "circa",
            "is_strictly_earlier": True if approx_diff > 0 else None,
            "is_same_at_precision": approx_diff == 0,
            "canonical_display": (
                f"circa comparison (approximately {approx_diff} {unit}; {att['raw']} vs. {base['raw']})"
                if approx_diff > 0
                else f"circa comparison ({att['raw']} vs. {base['raw']})"
            ),
        }

    if effective_precision == "year":
        years = base["year"] - att["year"]
        if years == 0:
            return {
                "comparable": True,
                "effective_precision": "year",
                "is_strictly_earlier": False,
                "is_same_at_precision": True,
                "years": 0,
                "canonical_display": "0 calendar years (same calendar year)",
            }
        abs_y = abs(years)
        label = f"{abs_y} calendar {'year' if abs_y == 1 else 'years'}"
        return {
            "comparable": True,
            "effective_precision": "year",
            "is_strictly_earlier": years > 0,
            "is_same_at_precision": False,
            "years": years,
            "canonical_display": label if years > 0 else f"postdates baseline by {label}",
        }

    if effective_precision == "month":
        att_m = att["year"] * 12 + (att["month"] - 1)
        base_m = base["year"] * 12 + (base["month"] - 1)
        total_months = base_m - att_m
        if total_months == 0:
            return {
                "comparable": True,
                "effective_precision": "month",
                "is_strictly_earlier": False,
                "is_same_at_precision": True,
                "years": 0,
                "months": 0,
                "total_months": 0,
                "canonical_display": "0 months (same calendar month)",
            }
        abs_m = abs(total_months)
        years, months = divmod(abs_m, 12)
        parts: list[str] = []
        if years > 0:
            parts.append(f"{years} {'year' if years == 1 else 'years'}")
        if months > 0:
            parts.append(f"{months} {'month' if months == 1 else 'months'}")
        span = _format_units(parts)
        return {
            "comparable": True,
            "effective_precision": "month",
            "is_strictly_earlier": total_months > 0,
            "is_same_at_precision": False,
            "years": years if total_months > 0 else -years,
            "months": months if total_months > 0 else -months,
            "total_months": total_months,
            "canonical_display": span if total_months > 0 else f"postdates baseline by {span}",
        }

    d_att = dt.date(att["year"], att["month"], att["day"])
    d_base = dt.date(base["year"], base["month"], base["day"])
    total_days = (d_base - d_att).days
    if total_days == 0:
        return {
            "comparable": True,
            "effective_precision": "day",
            "is_strictly_earlier": False,
            "is_same_at_precision": True,
            "years": 0,
            "months": 0,
            "days": 0,
            "total_days": 0,
            "canonical_display": "0 days (matches baseline date)",
        }

    forward = total_days > 0
    start = att if forward else base
    end = base if forward else att

    years = end["year"] - start["year"]
    months = end["month"] - start["month"]
    days = end["day"] - start["day"]

    if days < 0:
        prev_month = 12 if end["month"] == 1 else end["month"] - 1
        prev_year = end["year"] - 1 if end["month"] == 1 else end["year"]
        days += days_in_gregorian_month(prev_year, prev_month)
        months -= 1
    if months < 0:
        months += 12
        years -= 1

    parts = []
    if years > 0:
        parts.append(f"{years} {'year' if years == 1 else 'years'}")
    if months > 0:
        parts.append(f"{months} {'month' if months == 1 else 'months'}")
    if days > 0:
        parts.append(f"{days} {'day' if days == 1 else 'days'}")
    span = _format_units(parts)

    return {
        "comparable": True,
        "effective_precision": "day",
        "is_strictly_earlier": forward,
        "is_same_at_precision": False,
        "years": years if forward else -years,
        "months": months if forward else -months,
        "days": days if forward else -days,
        "total_days": total_days,
        "canonical_display": span if forward else f"postdates baseline by {span}",
    }


def compute_citation_material_fingerprint(
    citation: dict[str, Any],
    public_dir: Path,
    scan_hash_cache: dict[Path, str] | None = None,
) -> str:
    if scan_hash_cache is None:
        scan_hash_cache = {}
    scan = citation.get("scan") or {}
    hosted_raw = scan.get("hosted_path")
    hosted_path = normalize_text(hosted_raw) if hosted_raw else None
    rights_raw = scan.get("rights_status")
    rights_status = normalize_text(rights_raw) if rights_raw else None

    file_sha256: str | None = None
    if hosted_path:
        disk_path = (public_dir / hosted_path.lstrip("/")).resolve()
        if disk_path in scan_hash_cache:
            file_sha256 = scan_hash_cache[disk_path]
        elif not disk_path.exists():
            file_sha256 = f"missing:{hosted_path}"
        else:
            file_sha256 = sha256_hex(disk_path.read_bytes())
            scan_hash_cache[disk_path] = file_sha256

    cat_yr = citation.get("catalog_year")
    mast_yr = citation.get("masthead_year")
    payload = {
        "schema": "dragnet-citation-material-v1",
        "id": normalize_text(citation.get("id", "")),
        "case_slug": normalize_text(citation.get("case_slug", "")),
        "attested_form": normalize_text(citation.get("attested_form", "")),
        "record_type": normalize_text(citation.get("record_type", "")),
        "publication_year": citation.get("publication_year"),
        "date_display": normalize_text(citation.get("date_display", "")),
        "sort_date": normalize_text(citation.get("sort_date", "")),
        "source_publication": normalize_text(citation.get("source_publication", "")),
        "source_url": normalize_text(citation.get("source_url", "")),
        "page_and_column": normalize_text(citation.get("page_and_column", "")),
        "verbatim_quote": normalize_text(citation.get("verbatim_quote", "")),
        "masthead_date_verified": bool(citation.get("masthead_date_verified")),
        "catalog_year": None if cat_yr is None else normalize_text(cat_yr),
        "masthead_year": None if mast_yr is None else normalize_text(mast_yr),
        "scan": {
            "hosted_path": hosted_path,
            "rights_status": rights_status,
            "file_sha256": file_sha256,
        },
    }
    return sha256_hex(canonical_json(payload))


def compute_intrinsic_claim_fingerprint(claim: dict[str, Any]) -> str:
    raw_ev = claim.get("evidence")
    normalized_evidence: list[dict[str, Any]] = []
    if isinstance(raw_ev, list):
        for e in raw_ev:
            if isinstance(e, dict):
                wn = e.get("witness_note")
                normalized_evidence.append(
                    {
                        "ref": normalize_text(e.get("ref", "")),
                        "relationship": normalize_text(e.get("relationship", "")),
                        "directness": normalize_text(e.get("directness", "")),
                        "reason": normalize_text(e.get("reason", "")),
                        "witness_note": None if wn is None else normalize_text(wn),
                    }
                )
        normalized_evidence.sort(key=lambda item: (item["ref"], item["relationship"]))

    ab = claim.get("antedating_baseline")
    normalized_antedating = (
        {
            "authority": normalize_text(ab.get("authority", "")),
            "entry_and_sense": normalize_text(ab.get("entry_and_sense", "")),
            "edition_or_revision": normalize_text(ab.get("edition_or_revision", "")),
            "baseline_date": normalize_text(ab.get("baseline_date", "")),
            "baseline_date_precision": normalize_text(ab.get("baseline_date_precision", "")),
            "source_url_or_ref": normalize_text(ab.get("source_url_or_ref", "")),
            "checked_date": normalize_text(ab.get("checked_date", "")),
            "comparison_kind": normalize_text(ab.get("comparison_kind", "")),
            "advancing_citation_ref": normalize_text(ab.get("advancing_citation_ref", "")),
            "attested_date": normalize_text(ab.get("attested_date", "")),
            "attested_date_precision": normalize_text(ab.get("attested_date_precision", "")),
            "computed_advance_display": normalize_text(ab.get("computed_advance_display", "")),
            "inspection_mode": normalize_text(ab.get("inspection_mode", "")),
        }
        if isinstance(ab, dict)
        else None
    )

    neb = claim.get("negative_evidence_bounds")
    if isinstance(neb, dict):
        q_terms = neb.get("query_terms")
        k_lims = neb.get("known_limitations")
        cov = neb.get("corpus_coverage")
        qrc = neb.get("qualifying_results_count")
        normalized_negative = {
            "corpus_identity": normalize_text(neb.get("corpus_identity", "")),
            "search_date": normalize_text(neb.get("search_date", "")),
            "search_period": normalize_text(neb.get("search_period", "")),
            "query_terms": sorted(normalize_text(q) for q in q_terms) if isinstance(q_terms, list) else [],
            "search_method": normalize_text(neb.get("search_method", "")),
            "corpus_coverage": None if cov is None else normalize_text(cov),
            "known_limitations": sorted(normalize_text(k) for k in k_lims) if isinstance(k_lims, list) else [],
            "qualifying_results_count": qrc if is_strict_int(qrc) else None,
        }
    else:
        normalized_negative = None

    eb = claim.get("evidence_boundary") if isinstance(claim.get("evidence_boundary"), dict) else {}
    t_lex = claim.get("target_lexeme")
    sup_by = claim.get("superseded_by")
    supersedes = claim.get("supersedes")
    lims = claim.get("limitations")
    res_crit = claim.get("resolution_criteria")

    payload = {
        "schema": "dragnet-claim-intrinsic-v1",
        "id": normalize_text(claim.get("id", "")),
        "case_slug": normalize_text(claim.get("case_slug", "")),
        "headword": normalize_text(claim.get("headword", "")),
        "target_lexeme": None if t_lex is None else normalize_text(t_lex),
        "type": normalize_text(claim.get("type", "")),
        "assessment": normalize_text(claim.get("assessment", "")),
        "statement": normalize_text(claim.get("statement", "")),
        "rationale": normalize_text(claim.get("rationale", "")),
        "lifecycle_status": normalize_text(claim.get("lifecycle_status", "")),
        "supersedes": sorted(normalize_text(s) for s in supersedes) if isinstance(supersedes, list) else [],
        "superseded_by": None if sup_by is None else normalize_text(sup_by),
        "evidence_boundary": {
            "establishes": normalize_text(eb.get("establishes", "")),
            "does_not_establish": normalize_text(eb.get("does_not_establish", "")),
            "remaining_uncertainty": normalize_text(eb.get("remaining_uncertainty", "")),
        },
        "limitations": sorted(normalize_text(s) for s in lims) if isinstance(lims, list) else [],
        "resolution_criteria": sorted(normalize_text(s) for s in res_crit) if isinstance(res_crit, list) else [],
        "evidence": normalized_evidence,
        "antedating_baseline": normalized_antedating,
        "negative_evidence_bounds": normalized_negative,
    }
    return sha256_hex(canonical_json(payload))


class FingerprintContext:
    def __init__(
        self,
        citation_by_id: dict[str, dict[str, Any]],
        claim_by_id: dict[str, dict[str, Any]],
        public_dir: Path,
    ) -> None:
        self.citation_by_id = citation_by_id
        self.claim_by_id = claim_by_id
        self.public_dir = public_dir
        self.scan_hash_cache: dict[Path, str] = {}
        self.citation_fp_cache: dict[str, str] = {}
        self.intrinsic_fp_cache: dict[str, str] = {}
        self.content_fp_cache: dict[str, str] = {}


def compute_claim_evidence_fingerprints(
    claim: dict[str, Any],
    ctx: FingerprintContext,
    visiting: set[str] | None = None,
) -> dict[str, str]:
    if visiting is None:
        visiting = set()
    by_ref: dict[str, list[str]] = {}
    raw_ev = claim.get("evidence")
    if isinstance(raw_ev, list):
        for edge in raw_ev:
            if isinstance(edge, dict):
                ref = normalize_text(edge.get("ref", ""))
                by_ref.setdefault(ref, []).append(str(edge.get("relationship", "")))

    out: dict[str, str] = {}
    next_visiting = set(visiting)
    cid = str(claim.get("id", ""))
    next_visiting.add(cid)

    for ref in sorted(by_ref.keys()):
        if ref.startswith("CERT-"):
            if ref in ctx.citation_fp_cache:
                out[ref] = ctx.citation_fp_cache[ref]
            elif ref in ctx.citation_by_id:
                fp = compute_citation_material_fingerprint(
                    ctx.citation_by_id[ref], ctx.public_dir, ctx.scan_hash_cache
                )
                ctx.citation_fp_cache[ref] = fp
                out[ref] = fp
            else:
                out[ref] = f"unresolved:{ref}"
        elif ref.startswith("CLM-"):
            target = ctx.claim_by_id.get(ref)
            if target is None:
                out[ref] = f"unresolved:{ref}"
            else:
                rels = by_ref[ref]
                has_inferential = any(r in INFERENTIAL_RELATIONSHIPS for r in rels)
                if has_inferential and ref != cid and ref not in next_visiting:
                    out[ref] = compute_claim_content_fingerprint(target, ctx, next_visiting)
                else:
                    if ref not in ctx.intrinsic_fp_cache:
                        ctx.intrinsic_fp_cache[ref] = compute_intrinsic_claim_fingerprint(target)
                    out[ref] = ctx.intrinsic_fp_cache[ref]
        else:
            out[ref] = f"invalid:{ref}"
    return out


def compute_claim_content_fingerprint(
    claim: dict[str, Any],
    ctx: FingerprintContext,
    visiting: set[str] | None = None,
) -> str:
    if visiting is None:
        visiting = set()
    cid = str(claim.get("id", ""))
    if not visiting and cid and cid in ctx.content_fp_cache:
        return ctx.content_fp_cache[cid]

    if cid and cid not in ctx.intrinsic_fp_cache:
        ctx.intrinsic_fp_cache[cid] = compute_intrinsic_claim_fingerprint(claim)
    intrinsic_fp = (
        ctx.intrinsic_fp_cache[cid] if cid else compute_intrinsic_claim_fingerprint(claim)
    )
    evidence_fps = compute_claim_evidence_fingerprints(claim, ctx, visiting)
    payload = {
        "schema": "dragnet-claim-content-v1",
        "intrinsic_fingerprint": intrinsic_fp,
        "evidence_fingerprints": evidence_fps,
    }
    digest = sha256_hex(canonical_json(payload))
    if not visiting and cid:
        ctx.content_fp_cache[cid] = digest
    return digest


def detect_inferential_cycles(claims: list[dict[str, Any]]) -> list[list[str]]:
    claim_map = {c["id"]: c for c in claims if isinstance(c, dict) and isinstance(c.get("id"), str)}
    state: dict[str, int] = {}
    stack: list[str] = []
    cycles: list[list[str]] = []
    seen_sigs: set[str] = set()

    def dfs(cid: str) -> None:
        state[cid] = 1
        stack.append(cid)
        node = claim_map.get(cid)
        if node and isinstance(node.get("evidence"), list):
            targets = sorted(
                e["ref"]
                for e in node["evidence"]
                if isinstance(e, dict)
                and isinstance(e.get("ref"), str)
                and e["ref"].startswith("CLM-")
                and e.get("relationship") in INFERENTIAL_RELATIONSHIPS
            )
            for tid in targets:
                if tid not in claim_map:
                    continue
                st = state.get(tid, 0)
                if st == 1:
                    idx = stack.index(tid)
                    cycle_nodes = stack[idx:]
                    min_idx = min(range(len(cycle_nodes)), key=lambda i: cycle_nodes[i])
                    rotated = cycle_nodes[min_idx:] + cycle_nodes[:min_idx]
                    sig = "->".join(rotated)
                    if sig not in seen_sigs:
                        seen_sigs.add(sig)
                        cycles.append([*rotated, rotated[0]])
                elif st == 0:
                    dfs(tid)
        stack.pop()
        state[cid] = 2

    for cid in sorted(claim_map.keys()):
        if state.get(cid, 0) == 0:
            dfs(cid)
    return cycles


def _detect_supersession_cycles(claims: list[dict[str, Any]]) -> list[list[str]]:
    by_id = {c["id"]: c for c in claims if isinstance(c, dict) and isinstance(c.get("id"), str)}
    cycles: list[list[str]] = []
    seen: set[str] = set()

    for cid in sorted(by_id.keys()):
        visited: list[str] = []
        cur: str | None = cid
        while cur and cur in by_id:
            if cur in visited:
                idx = visited.index(cur)
                loop = [*visited[idx:], cur]
                sig = "->".join(sorted(loop[:-1]))
                if sig not in seen:
                    seen.add(sig)
                    cycles.append(loop)
                break
            visited.append(cur)
            nxt = by_id[cur].get("superseded_by")
            cur = nxt if isinstance(nxt, str) else None
    return cycles


def _check_unknown_keys(obj: dict[str, Any], allowed: set[str], label: str, errors: list[str]) -> None:
    for k in obj.keys():
        if k not in allowed:
            errors.append(f"{label}: Disallowed or unknown property '{k}'")


def _scan_tree_for_forbidden_keys_and_leaks(
    node: Any,
    path_label: str,
    file_label: str,
    errors: list[str],
    parent_key: str = "",
) -> None:
    if node is None:
        return
    if isinstance(node, str):
        leak = find_workspace_or_drive_leak(node)
        if leak:
            errors.append(f"{file_label} ({path_label}): Workspace/private leak '{leak}'")
        m_dec = DECIMAL_YEAR_RE.search(node)
        if m_dec:
            errors.append(
                f"{file_label} ({path_label}): Uses decimal years ('{m_dec.group(0)}'); use calendar years, months, and days"
            )
        m_raw = RAW_SCORE_RE.search(node)
        if m_raw:
            errors.append(
                f"{file_label} ({path_label}): Contains raw numerical harness/confidence score ('{m_raw.group(0)}')"
            )
        m_pct = PCT_CONFIDENCE_RE.search(node)
        if m_pct:
            errors.append(
                f"{file_label} ({path_label}): Contains numerical percentage confidence ('{m_pct.group(0)}')"
            )
        return
    if isinstance(node, list):
        for idx, item in enumerate(node):
            _scan_tree_for_forbidden_keys_and_leaks(
                item, f"{path_label}[{idx}]", file_label, errors, parent_key
            )
        return
    if isinstance(node, dict):
        for k, v in node.items():
            if parent_key != "evidence_fingerprints_at_review" and FORBIDDEN_SCORE_KEY_RE.search(k):
                errors.append(
                    f"{file_label} ({path_label}.{k}): Numerical confidence/probability key '{k}' is forbidden"
                )
            if k == "is_stale":
                errors.append(
                    f"{file_label} ({path_label}.is_stale): 'is_stale' must not be serialized on disk; it is computed dynamically"
                )
            _scan_tree_for_forbidden_keys_and_leaks(v, f"{path_label}.{k}", file_label, errors, k)


def compute_all_fingerprints(
    root_dir: Path = DEFAULT_ROOT,
    claims_dir: Path | None = None,
    ledgers_dir: Path | None = None,
    public_dir: Path | None = None,
) -> tuple[dict[str, str], dict[str, dict[str, str]]]:
    root = Path(root_dir).resolve()
    pub = Path(public_dir).resolve() if public_dir else root / "public"
    ldir = Path(ledgers_dir).resolve() if ledgers_dir else pub / "ledgers"
    cdir = Path(claims_dir).resolve() if claims_dir else pub / "claims"

    citation_by_id: dict[str, dict[str, Any]] = {}
    if ldir.exists():
        for lf in sorted(ldir.glob("*.json")):
            d = json.loads(lf.read_text(encoding="utf-8"))
            for c in d.get("citations", []):
                if isinstance(c, dict) and isinstance(c.get("id"), str):
                    citation_by_id[c["id"]] = c

    claim_by_id: dict[str, dict[str, Any]] = {}
    if cdir.exists():
        for cf in sorted(cdir.glob("*.json")):
            d = json.loads(cf.read_text(encoding="utf-8"))
            for clm in d.get("claims", []):
                if isinstance(clm, dict) and isinstance(clm.get("id"), str):
                    claim_by_id[clm["id"]] = clm

    ctx = FingerprintContext(citation_by_id, claim_by_id, pub)
    content_fps: dict[str, str] = {}
    evidence_fps: dict[str, dict[str, str]] = {}
    for cid, clm in sorted(claim_by_id.items()):
        evidence_fps[cid] = compute_claim_evidence_fingerprints(clm, ctx)
        content_fps[cid] = compute_claim_content_fingerprint(clm, ctx)
    return content_fps, evidence_fps


def stamp_claim_ledger_fingerprints(
    target_paths: list[str | Path],
    root_dir: Path = DEFAULT_ROOT,
    claims_dir: Path | None = None,
    ledgers_dir: Path | None = None,
    public_dir: Path | None = None,
) -> dict[str, int]:
    root = Path(root_dir).resolve()
    pub = Path(public_dir).resolve() if public_dir else root / "public"
    ldir = Path(ledgers_dir).resolve() if ledgers_dir else pub / "ledgers"
    cdir = Path(claims_dir).resolve() if claims_dir else pub / "claims"

    citation_by_id: dict[str, dict[str, Any]] = {}
    if ldir.exists():
        for lf in sorted(ldir.glob("*.json")):
            d = json.loads(lf.read_text(encoding="utf-8"))
            for c in d.get("citations", []):
                if isinstance(c, dict) and isinstance(c.get("id"), str):
                    citation_by_id[c["id"]] = c

    files_to_load: dict[Path, dict[str, Any]] = {}
    if cdir.exists():
        for cf in sorted(cdir.glob("*.json")):
            rp = cf.resolve()
            files_to_load[rp] = json.loads(rp.read_text(encoding="utf-8"))

    resolved_targets: list[Path] = []
    for tp in target_paths:
        ap = Path(tp).resolve()
        if ap.is_dir():
            for cf in sorted(ap.glob("*.json")):
                rp = cf.resolve()
                if rp not in files_to_load:
                    files_to_load[rp] = json.loads(rp.read_text(encoding="utf-8"))
                resolved_targets.append(rp)
        else:
            if ap not in files_to_load:
                files_to_load[ap] = json.loads(ap.read_text(encoding="utf-8"))
            resolved_targets.append(ap)

    claim_by_id: dict[str, dict[str, Any]] = {}
    for data in files_to_load.values():
        for clm in data.get("claims", []):
            if isinstance(clm, dict) and isinstance(clm.get("id"), str):
                claim_by_id[clm["id"]] = clm

    ctx = FingerprintContext(citation_by_id, claim_by_id, pub)
    stamped_claims = 0
    for fp in resolved_targets:
        data = files_to_load[fp]
        for clm in data.get("claims", []):
            digest = compute_claim_content_fingerprint(clm, ctx)
            clm["content_fingerprint"] = digest
            rev_hist = clm.get("revision_history")
            if isinstance(rev_hist, list) and rev_hist:
                matched = False
                for entry in rev_hist:
                    if isinstance(entry, dict) and entry.get("revision") == clm.get("revision"):
                        entry["content_fingerprint"] = digest
                        matched = True
                if not matched and isinstance(rev_hist[-1], dict):
                    rev_hist[-1]["content_fingerprint"] = digest
            stamped_claims += 1
        fp.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")

    return {"filesStamped": len(resolved_targets), "claimsStamped": stamped_claims}


def validate_claims(
    root_dir: Path = DEFAULT_ROOT,
    claims_dir: Path | None = None,
    ledgers_dir: Path | None = None,
    cases_dir: Path | None = None,
    public_dir: Path | None = None,
    open_questions_path: Path | None = None,
    files: list[str | Path] | None = None,
    allow_empty: bool = False,
    require_all_cases: bool = False,
) -> dict[str, Any]:
    root = Path(root_dir).resolve()
    pub = Path(public_dir).resolve() if public_dir else root / "public"
    ldir = Path(ledgers_dir).resolve() if ledgers_dir else pub / "ledgers"
    csdir = Path(cases_dir).resolve() if cases_dir else root / "src" / "content" / "cases"
    clmdir = Path(claims_dir).resolve() if claims_dir else pub / "claims"
    oq_path = Path(open_questions_path).resolve() if open_questions_path else pub / "data" / "open-questions.json"
    explicit_files = [Path(f).resolve() for f in (files or [])]

    errors: list[str] = []
    warnings: list[str] = []

    # 1. Check schemas/, docs/, and src/lib/claims.ts for workspace/Drive/session leaks (never public/ledgers/)
    sanitize_paths: list[Path] = []
    for sub in ("schemas", "docs"):
        sub_dir = root / sub
        if sub_dir.exists():
            sanitize_paths.extend(
                sorted(
                    p
                    for p in sub_dir.rglob("*")
                    if p.is_file() and p.suffix.lower() in {".json", ".md", ".ts", ".mjs"}
                )
            )
    claims_lib = root / "src" / "lib" / "claims.ts"
    if claims_lib.exists():
        sanitize_paths.append(claims_lib)

    for p in sanitize_paths:
        txt = p.read_text(encoding="utf-8", errors="ignore")
        leak = find_workspace_or_drive_leak(txt)
        if leak:
            errors.append(f"Workspace/private leak '{leak}' in {p.relative_to(root)}")

    # 2. Load embargoed under_review targets
    embargoed_target_ids: set[str] = set()
    embargoed_slugs: set[str] = set()
    if oq_path.exists():
        try:
            oq = json.loads(oq_path.read_text(encoding="utf-8"))
            for t in oq.get("targets", []):
                if t.get("status") == "under_review" and not t.get("case_slug"):
                    if t.get("target_id"):
                        embargoed_target_ids.add(str(t["target_id"]))
                    if t.get("headword"):
                        embargoed_slugs.add(str(t["headword"]).lower().strip())
        except Exception as exc:
            errors.append(f"open-questions.json: Invalid JSON ({exc})")

    # 3. Load citation ledgers
    citation_ledgers_by_slug: dict[str, dict[str, Any]] = {}
    citation_by_id: dict[str, dict[str, Any]] = {}
    if ldir.exists():
        for lf in sorted(ldir.glob("*.json")):
            try:
                d = json.loads(lf.read_text(encoding="utf-8"))
                citation_ledgers_by_slug[lf.stem] = d
                for c in d.get("citations", []):
                    if isinstance(c, dict) and isinstance(c.get("id"), str):
                        citation_by_id[c["id"]] = c
            except Exception as exc:
                errors.append(f"public/ledgers/{lf.name}: Invalid JSON ({exc})")

    published_case_slugs = sorted(cf.stem for cf in csdir.glob("*.md")) if csdir.exists() else []

    # 4. Discover claim ledger files
    all_claim_files: dict[Path, str] = {}
    if clmdir.exists():
        for cf in sorted(clmdir.glob("*.json")):
            all_claim_files[cf.resolve()] = cf.name
    for ef in explicit_files:
        if not ef.exists():
            errors.append(f"Specified claim file does not exist: {ef}")
        else:
            all_claim_files[ef] = ef.name

    target_file_set = set(explicit_files) if explicit_files else set(all_claim_files.keys())

    if not all_claim_files:
        if not allow_empty:
            try:
                rel_c = str(clmdir.relative_to(root))
            except ValueError:
                rel_c = str(clmdir)
            errors.append(f"No claim ledgers found in {rel_c} (pass --allow-empty before extraction)")
        return {
            "ok": len(errors) == 0,
            "errors": errors,
            "warnings": warnings,
            "stats": {
                "claimLedgers": 0,
                "publishedCases": len(published_case_slugs),
                "totalClaims": 0,
                "activeClaims": 0,
                "reviews": 0,
                "staleReviews": 0,
            },
        }

    parsed_ledgers: list[tuple[Path, str, Any, bool]] = []
    claim_by_id: dict[str, dict[str, Any]] = {}
    claim_source_file: dict[str, str] = {}
    claim_slug_seen: dict[str, str] = {}
    review_id_seen: dict[str, str] = {}

    for full_path in sorted(all_claim_files.keys(), key=lambda p: str(p)):
        fname = all_claim_files[full_path]
        is_target = full_path in target_file_set
        try:
            data = json.loads(full_path.read_text(encoding="utf-8"))
        except Exception as exc:
            errors.append(f"{fname}: Invalid JSON ({exc})")
            continue

        parsed_ledgers.append((full_path, fname, data, is_target))

        if isinstance(data, dict) and isinstance(data.get("claims"), list):
            for clm in data["claims"]:
                if not isinstance(clm, dict):
                    continue
                cid = str(clm.get("id") or "")
                if cid:
                    if cid in claim_by_id:
                        errors.append(
                            f"{fname}: Duplicate global claim ID '{cid}' (already defined in {claim_source_file[cid]})"
                        )
                    else:
                        claim_by_id[cid] = clm
                        claim_source_file[cid] = fname
                cslug = str(clm.get("slug") or "")
                if cslug:
                    if cslug in claim_slug_seen:
                        errors.append(
                            f"{fname}: Duplicate global claim slug '{cslug}' (already defined in {claim_slug_seen[cslug]})"
                        )
                    else:
                        claim_slug_seen[cslug] = fname

    if require_all_cases:
        loaded_slugs = {Path(fname).stem for _, fname, _, _ in parsed_ledgers}
        for cslug in published_case_slugs:
            if cslug not in loaded_slugs:
                errors.append(
                    f"Missing required claim ledger public/claims/{cslug}.json for published case '{cslug}'"
                )

    fp_ctx = FingerprintContext(citation_by_id, claim_by_id, pub)

    total_claims = 0
    active_claims = 0
    total_reviews = 0
    stale_reviews = 0

    for _, fname, data, is_target in parsed_ledgers:
        if not is_target:
            continue
        if not isinstance(data, dict):
            errors.append(f"{fname}: Root JSON value must be an object")
            continue

        _check_unknown_keys(data, ALLOWED_LEDGER_KEYS, fname, errors)
        _scan_tree_for_forbidden_keys_and_leaks(data, "$", fname, errors)

        expected_stem = Path(fname).stem
        if data.get("schema_version") != "1.0":
            errors.append(f"{fname}: Expected schema_version '1.0', got {data.get('schema_version')!r}")

        clid = data.get("claim_ledger_id")
        if not is_non_empty_str(clid) or not SLUG_RE.match(clid):
            errors.append(f"{fname}: Invalid claim_ledger_id {clid!r}")
        elif clid != expected_stem:
            errors.append(f"{fname}: claim_ledger_id '{clid}' must match filename stem '{expected_stem}'")

        cslug = data.get("case_slug")
        if not is_non_empty_str(cslug) or cslug != clid:
            errors.append(f"{fname}: case_slug {cslug!r} must equal claim_ledger_id {clid!r}")

        cm = CASE_NUMBER_RE.match(str(data.get("case_number") or ""))
        if not cm:
            errors.append(f"{fname}: case_number {data.get('case_number')!r} must match 'Case NNNN'")
        expected_case_digits = cm.group(1) if cm else None

        tid = str(data.get("target_id") or "")
        if not TARGET_ID_RE.match(tid):
            errors.append(f"{fname}: target_id {data.get('target_id')!r} must match 'TGT-NNN'")
        if tid in embargoed_target_ids or str(cslug or "").lower() in embargoed_slugs:
            errors.append(
                f"{fname}: Target '{tid}' / '{cslug}' is marked 'under_review' (embargoed) in open-questions.json"
            )

        if not is_non_empty_str(data.get("headword")):
            errors.append(f"{fname}: Missing non-empty headword")
        if not is_valid_iso_calendar_date(data.get("updated_at")):
            errors.append(
                f"{fname}: updated_at {data.get('updated_at')!r} must be a valid YYYY-MM-DD calendar date"
            )
        if "summary_note" in data and data["summary_note"] is not None and not isinstance(data["summary_note"], str):
            errors.append(f"{fname}: summary_note must be string or null")

        cit_ledger = citation_ledgers_by_slug.get(str(cslug or ""))
        if not cit_ledger:
            errors.append(f"{fname}: No matching citation ledger public/ledgers/{cslug}.json")
        else:
            if data.get("case_number") != cit_ledger.get("case_number"):
                errors.append(
                    f"{fname}: case_number {data.get('case_number')!r} does not match citation ledger {cit_ledger.get('case_number')!r}"
                )
            if data.get("target_id") != cit_ledger.get("target_id"):
                errors.append(
                    f"{fname}: target_id {data.get('target_id')!r} does not match citation ledger {cit_ledger.get('target_id')!r}"
                )
            if data.get("headword") != cit_ledger.get("headword"):
                errors.append(
                    f"{fname}: headword {data.get('headword')!r} does not match citation ledger {cit_ledger.get('headword')!r}"
                )

        claims_arr = data.get("claims")
        if not isinstance(claims_arr, list) or not claims_arr:
            errors.append(f"{fname}: 'claims' must be a non-empty array")
            continue

        has_active_principal = False

        for idx, clm in enumerate(claims_arr):
            if not isinstance(clm, dict):
                errors.append(f"{fname} [claims[{idx}]]: Claim record must be an object")
                continue

            total_claims += 1
            cid = str(clm.get("id") or f"claims[{idx}]")
            label = f"{fname} [{cid}]"
            _check_unknown_keys(clm, ALLOWED_CLAIM_KEYS, label, errors)

            id_m = CLAIM_ID_RE.match(str(clm.get("id") or ""))
            if not id_m:
                errors.append(f"{label}: id {clm.get('id')!r} must match 'CLM-<case_digits>-<NNN>'")
            else:
                id_case_digits, id_seq = id_m.group(1), id_m.group(2)
                if int(id_seq) < 1:
                    errors.append(f"{label}: Claim sequence number must be >= 001, got '{id_seq}'")
                if expected_case_digits and id_case_digits != expected_case_digits:
                    errors.append(
                        f"{label}: Claim namespace 'CLM-{id_case_digits}-' must match ledger case_number '{data.get('case_number')}' ('CLM-{expected_case_digits}-')"
                    )

            expected_slug = str(clm.get("id") or "").lower()
            if not CLAIM_SLUG_RE.match(str(clm.get("slug") or "")) or clm.get("slug") != expected_slug:
                errors.append(f"{label}: slug {clm.get('slug')!r} must equal lowercase id '{expected_slug}'")
            if clm.get("case_slug") != cslug:
                errors.append(f"{label}: case_slug {clm.get('case_slug')!r} must equal ledger case_slug '{cslug}'")
            if clm.get("headword") != data.get("headword"):
                errors.append(
                    f"{label}: headword {clm.get('headword')!r} must equal ledger headword {data.get('headword')!r}"
                )
            if "target_lexeme" in clm and clm["target_lexeme"] is not None and not is_non_empty_str(clm["target_lexeme"]):
                errors.append(f"{label}: target_lexeme must be a non-empty string or null")
            if "case_section" in clm and clm["case_section"] is not None and not is_non_empty_str(clm["case_section"]):
                errors.append(f"{label}: case_section must be a non-empty string or null")

            slabel = clm.get("short_label")
            if not is_non_empty_str(slabel) or len(slabel) > 160:
                errors.append(f"{label}: short_label must be 1..160 characters")
            if not is_non_empty_str(clm.get("statement")):
                errors.append(f"{label}: statement must be a non-empty string")
            if not is_non_empty_str(clm.get("rationale")):
                errors.append(f"{label}: rationale must be a non-empty string")

            ctype = clm.get("type")
            if ctype not in VALID_CLAIM_TYPES:
                errors.append(f"{label}: Invalid type {ctype!r}")
            cassess = clm.get("assessment")
            if cassess not in VALID_ASSESSMENTS:
                errors.append(f"{label}: Invalid assessment {cassess!r}")
            crev_status = clm.get("review_status")
            if crev_status not in VALID_REVIEW_STATUSES:
                errors.append(f"{label}: Invalid review_status {crev_status!r}")
            if not isinstance(clm.get("is_principal"), bool):
                errors.append(f"{label}: is_principal must be boolean")
            if "sort_order" in clm and clm["sort_order"] is not None:
                if not is_strict_int(clm["sort_order"]) or clm["sort_order"] < 0:
                    errors.append(f"{label}: sort_order must be an integer >= 0 or null")

            lstatus = clm.get("lifecycle_status")
            sup_by = clm.get("superseded_by")
            if lstatus not in VALID_LIFECYCLE_STATUSES:
                errors.append(f"{label}: Invalid lifecycle_status {lstatus!r}")
            elif lstatus == "active":
                active_claims += 1
                if clm.get("is_principal") is True:
                    has_active_principal = True
                if sup_by is not None:
                    errors.append(f"{label}: active claim must have superseded_by === null")
            elif lstatus == "superseded":
                if clm.get("is_principal") is True:
                    errors.append(f"{label}: superseded claim cannot have is_principal === true")
                if not isinstance(sup_by, str) or not CLAIM_ID_RE.match(sup_by) or sup_by == clm.get("id"):
                    errors.append(f"{label}: superseded claim requires a valid distinct CLM-* superseded_by")
                elif sup_by in claim_by_id:
                    newer = claim_by_id[sup_by]
                    newer_sups = newer.get("supersedes")
                    if not isinstance(newer_sups, list) or clm.get("id") not in newer_sups:
                        errors.append(
                            f"{label}: superseded_by '{sup_by}' does not list '{clm.get('id')}' in its supersedes[]"
                        )
                    newer_m = CLAIM_ID_RE.match(str(newer.get("id") or ""))
                    if id_m and newer_m and id_m.group(1) == newer_m.group(1):
                        if int(newer_m.group(2)) <= int(id_m.group(2)):
                            errors.append(
                                f"{label}: superseding same-case claim '{newer.get('id')}' must have a monotonically higher sequence number than '{clm.get('id')}'"
                            )
                else:
                    errors.append(f"{label}: superseded_by '{sup_by}' does not resolve to an existing claim")
            elif lstatus == "withdrawn":
                if clm.get("is_principal") is True:
                    errors.append(f"{label}: withdrawn claim cannot have is_principal === true")
                if sup_by is not None:
                    errors.append(
                        f"{label}: withdrawn claim must have superseded_by === null (use 'superseded' if replaced)"
                    )

            rev_num = clm.get("revision")
            if not is_strict_int(rev_num) or rev_num < 1:
                errors.append(f"{label}: revision must be an integer >= 1")

            supersedes = clm.get("supersedes")
            if not isinstance(supersedes, list):
                errors.append(f"{label}: supersedes must be an array")
            else:
                seen_sup: set[str] = set()
                for sid in supersedes:
                    if not isinstance(sid, str) or not CLAIM_ID_RE.match(sid) or sid == clm.get("id"):
                        errors.append(f"{label}: Invalid supersedes entry {sid!r}")
                    elif sid in seen_sup:
                        errors.append(f"{label}: Duplicate entry '{sid}' in supersedes")
                    else:
                        seen_sup.add(sid)
                        if sid not in claim_by_id:
                            errors.append(f"{label}: supersedes target '{sid}' does not resolve to an existing claim")
                        else:
                            old_clm = claim_by_id[sid]
                            if old_clm.get("lifecycle_status") != "superseded" or old_clm.get("superseded_by") != clm.get("id"):
                                errors.append(
                                    f"{label}: supersedes '{sid}', so '{sid}' must have lifecycle_status='superseded' and superseded_by='{clm.get('id')}'"
                                )

            # Evidence boundary
            eb = clm.get("evidence_boundary")
            if not isinstance(eb, dict):
                errors.append(f"{label}: Missing evidence_boundary object")
            else:
                _check_unknown_keys(eb, ALLOWED_BOUNDARY_KEYS, f"{label}.evidence_boundary", errors)
                for bk in ALLOWED_BOUNDARY_KEYS:
                    if not is_non_empty_str(eb.get(bk)):
                        errors.append(f"{label}: evidence_boundary.{bk} must be a non-empty string")

            lims = clm.get("limitations")
            if not isinstance(lims, list) or any(not is_non_empty_str(x) for x in lims):
                errors.append(f"{label}: limitations must be an array of non-empty strings")

            rcrit = clm.get("resolution_criteria")
            if not isinstance(rcrit, list) or any(not is_non_empty_str(x) for x in rcrit):
                errors.append(f"{label}: resolution_criteria must be an array of non-empty strings")
            elif ctype in INTERPRETIVE_TYPES and cassess in UNRESOLVED_ASSESSMENTS and len(rcrit) == 0:
                errors.append(
                    f"{label}: Unresolved interpretive claim ({ctype}, {cassess}) requires at least 1 resolution_criteria entry"
                )

            # Evidence edges
            claim_evidence_refs: set[str] = set()
            ev_arr = clm.get("evidence")
            if not isinstance(ev_arr, list):
                errors.append(f"{label}: evidence must be an array")
            else:
                if ctype != "negative_evidence" and cassess != "unassessed" and len(ev_arr) == 0:
                    errors.append(f"{label}: Assessed {ctype} claim must link at least 1 evidence item")
                seen_pairs: set[tuple[str, str]] = set()
                for e_idx, edge in enumerate(ev_arr):
                    e_label = f"{label}.evidence[{e_idx}]"
                    if not isinstance(edge, dict):
                        errors.append(f"{e_label}: Evidence entry must be an object")
                        continue
                    _check_unknown_keys(edge, ALLOWED_EVIDENCE_KEYS, e_label, errors)

                    ref = str(edge.get("ref") or "")
                    rel = str(edge.get("relationship") or "")
                    if ref == clm.get("id"):
                        errors.append(f"{e_label}: Self-referential evidence ref '{ref}' is forbidden")
                    elif CERT_ID_RE.match(ref):
                        if ref not in citation_by_id:
                            errors.append(
                                f"{e_label}: Unresolved citation ref '{ref}' (not found in public/ledgers/*.json)"
                            )
                    elif CLAIM_ID_RE.match(ref):
                        if ref not in claim_by_id:
                            errors.append(
                                f"{e_label}: Unresolved claim ref '{ref}' (not found in loaded claim ledgers)"
                            )
                        else:
                            target_clm = claim_by_id[ref]
                            if (
                                cassess == "supported"
                                and rel == "depends_on"
                                and (
                                    target_clm.get("assessment") == "contradicted"
                                    or target_clm.get("lifecycle_status") == "withdrawn"
                                )
                            ):
                                errors.append(
                                    f"{e_label}: Supported claim cannot depend_on '{ref}' ({target_clm.get('lifecycle_status')}, {target_clm.get('assessment')})"
                                )
                    else:
                        errors.append(f"{e_label}: Invalid ref '{ref}' (expected CERT-... or CLM-...)")

                    if rel not in VALID_RELATIONSHIPS:
                        errors.append(f"{e_label}: Invalid relationship '{rel}'")
                    if edge.get("directness") not in VALID_DIRECTNESS:
                        errors.append(f"{e_label}: Invalid directness {edge.get('directness')!r}")
                    if not is_non_empty_str(edge.get("reason")):
                        errors.append(f"{e_label}: reason must be a non-empty string")
                    if "witness_note" in edge and edge["witness_note"] is not None and not is_non_empty_str(edge["witness_note"]):
                        errors.append(f"{e_label}: witness_note must be a non-empty string or null")

                    pair = (ref, rel)
                    if pair in seen_pairs:
                        errors.append(
                            f"{e_label}: Duplicate (ref, relationship) pair ('{ref}', '{rel}') on {clm.get('id')}"
                        )
                    seen_pairs.add(pair)
                    claim_evidence_refs.add(ref)

            # Antedating baseline
            ab = clm.get("antedating_baseline")
            if ctype == "antedating" and not ab:
                errors.append(f"{label}: Claim of type 'antedating' requires antedating_baseline")
            if ab is not None:
                ab_label = f"{label}.antedating_baseline"
                if not isinstance(ab, dict):
                    errors.append(f"{ab_label}: Must be an object or null")
                else:
                    _check_unknown_keys(ab, ALLOWED_ANTEDATING_KEYS, ab_label, errors)
                    for sk in (
                        "authority",
                        "entry_and_sense",
                        "edition_or_revision",
                        "source_url_or_ref",
                        "computed_advance_display",
                    ):
                        if not is_non_empty_str(ab.get(sk)):
                            errors.append(f"{ab_label}: '{sk}' must be a non-empty string")
                    if not is_valid_iso_calendar_date(ab.get("checked_date")):
                        errors.append(f"{ab_label}: checked_date {ab.get('checked_date')!r} must be YYYY-MM-DD")
                    if ab.get("comparison_kind") not in VALID_COMPARISON_KINDS:
                        errors.append(f"{ab_label}: Invalid comparison_kind {ab.get('comparison_kind')!r}")
                    if ab.get("inspection_mode") not in VALID_INSPECTION_MODES:
                        errors.append(f"{ab_label}: Invalid inspection_mode {ab.get('inspection_mode')!r}")

                    adv_ref = str(ab.get("advancing_citation_ref") or "")
                    if not CERT_ID_RE.match(adv_ref):
                        errors.append(f"{ab_label}: advancing_citation_ref '{adv_ref}' must be a CERT-* ID")
                    else:
                        if adv_ref not in citation_by_id:
                            errors.append(f"{ab_label}: advancing_citation_ref '{adv_ref}' does not exist in ledgers")
                        if adv_ref not in claim_evidence_refs:
                            errors.append(
                                f"{ab_label}: advancing_citation_ref '{adv_ref}' must also appear in claim.evidence"
                            )

                    bp = ab.get("baseline_date_precision")
                    ap_prec = ab.get("attested_date_precision")
                    if bp not in VALID_PRECISIONS:
                        errors.append(f"{ab_label}: Invalid baseline_date_precision {bp!r}")
                    if ap_prec not in VALID_PRECISIONS:
                        errors.append(f"{ab_label}: Invalid attested_date_precision {ap_prec!r}")

                    parsed_base = parse_historical_date_by_precision(ab.get("baseline_date"), bp)
                    if not parsed_base:
                        errors.append(
                            f"{ab_label}: baseline_date {ab.get('baseline_date')!r} does not match precision {bp!r}"
                        )
                    parsed_att = parse_historical_date_by_precision(ab.get("attested_date"), ap_prec)
                    if not parsed_att:
                        errors.append(
                            f"{ab_label}: attested_date {ab.get('attested_date')!r} does not match precision {ap_prec!r}"
                        )

                    cad = ab.get("computed_advance_display")
                    if parsed_base and parsed_att and is_non_empty_str(cad):
                        adv = compute_chronological_advance(
                            str(ab.get("attested_date")),
                            str(ap_prec),
                            str(ab.get("baseline_date")),
                            str(bp),
                        )
                        eff_p = adv["effective_precision"]
                        if eff_p in {"year", "circa"} and re.search(r"\b(?:months?|days?)\b", cad, re.IGNORECASE):
                            errors.append(
                                f"{ab_label}: computed_advance_display '{cad}' invents month/day precision when effective precision is '{eff_p}'"
                            )
                        if eff_p == "month" and re.search(r"\bdays?\b", cad, re.IGNORECASE):
                            errors.append(
                                f"{ab_label}: computed_advance_display '{cad}' invents day precision when effective precision is 'month'"
                            )
                        if (
                            ab.get("comparison_kind") in STRICT_ADVANCING_KINDS
                            and adv["comparable"]
                            and adv["is_strictly_earlier"] is not True
                        ):
                            errors.append(
                                f"{ab_label}: comparison_kind '{ab.get('comparison_kind')}' requires attested_date ({ab.get('attested_date')}) to precede baseline_date ({ab.get('baseline_date')}) at '{eff_p}' precision"
                            )

            # Negative evidence bounds
            neb = clm.get("negative_evidence_bounds")
            if ctype == "negative_evidence" and not neb:
                errors.append(f"{label}: Claim of type 'negative_evidence' requires negative_evidence_bounds")
            if neb is not None:
                neb_label = f"{label}.negative_evidence_bounds"
                if not isinstance(neb, dict):
                    errors.append(f"{neb_label}: Must be an object or null")
                else:
                    _check_unknown_keys(neb, ALLOWED_NEGATIVE_KEYS, neb_label, errors)
                    if not is_non_empty_str(neb.get("corpus_identity")):
                        errors.append(f"{neb_label}: corpus_identity must be a non-empty string")
                    if not is_valid_iso_calendar_date(neb.get("search_date")):
                        errors.append(f"{neb_label}: search_date {neb.get('search_date')!r} must be YYYY-MM-DD")
                    if not is_non_empty_str(neb.get("search_period")):
                        errors.append(f"{neb_label}: search_period must be a non-empty string")
                    qt = neb.get("query_terms")
                    if not isinstance(qt, list) or not qt or any(not is_non_empty_str(x) for x in qt):
                        errors.append(f"{neb_label}: query_terms must be a non-empty array of strings")
                    if not is_non_empty_str(neb.get("search_method")):
                        errors.append(f"{neb_label}: search_method must be a non-empty string")
                    if neb.get("corpus_coverage") is not None and not is_non_empty_str(neb.get("corpus_coverage")):
                        errors.append(f"{neb_label}: corpus_coverage must be a non-empty string or null")
                    kl = neb.get("known_limitations")
                    if not isinstance(kl, list) or not kl or any(not is_non_empty_str(x) for x in kl):
                        errors.append(f"{neb_label}: known_limitations must be a non-empty array of strings")
                    qrc = neb.get("qualifying_results_count")
                    if qrc is not None and (not is_strict_int(qrc) or qrc < 0):
                        errors.append(f"{neb_label}: qualifying_results_count must be an integer >= 0 or null")

            # Fingerprints & revision_history
            expected_ev_fps = compute_claim_evidence_fingerprints(clm, fp_ctx)
            expected_content_fp = compute_claim_content_fingerprint(clm, fp_ctx)
            cfp = str(clm.get("content_fingerprint") or "")
            if not SHA256_RE.match(cfp):
                errors.append(f"{label}: content_fingerprint must be a 64-char lowercase SHA-256 hex string")
            elif cfp != expected_content_fp:
                errors.append(
                    f"{label}: content_fingerprint mismatch (stored {cfp[:12]}…, expected {expected_content_fp[:12]}…)"
                )

            rev_hist = clm.get("revision_history")
            if not isinstance(rev_hist, list) or not rev_hist:
                errors.append(f"{label}: revision_history must be a non-empty array")
            else:
                for r_idx, rev_entry in enumerate(rev_hist, start=1):
                    r_label = f"{label}.revision_history[{r_idx - 1}]"
                    if not isinstance(rev_entry, dict):
                        errors.append(f"{r_label}: Must be an object")
                        continue
                    _check_unknown_keys(rev_entry, ALLOWED_REVISION_KEYS, r_label, errors)
                    if not is_strict_int(rev_entry.get("revision")) or rev_entry.get("revision") != r_idx:
                        errors.append(f"{r_label}: Expected sequential revision {r_idx}, got {rev_entry.get('revision')!r}")
                    if not is_valid_iso_calendar_date(rev_entry.get("date")):
                        errors.append(f"{r_label}: date {rev_entry.get('date')!r} must be YYYY-MM-DD")
                    if not is_non_empty_str(rev_entry.get("author")):
                        errors.append(f"{r_label}: author must be a non-empty string")
                    if not is_non_empty_str(rev_entry.get("summary")):
                        errors.append(f"{r_label}: summary must be a non-empty string")
                    rcfp = str(rev_entry.get("content_fingerprint") or "")
                    if not SHA256_RE.match(rcfp):
                        errors.append(f"{r_label}: content_fingerprint must be 64-char lowercase SHA-256 hex")
                    elif is_strict_int(rev_num) and rev_entry.get("revision") == rev_num and rcfp != expected_content_fp:
                        errors.append(
                            f"{r_label}: Current revision {rev_num} content_fingerprint in revision_history does not match computed fingerprint"
                        )
                if is_strict_int(rev_num) and len(rev_hist) != rev_num:
                    errors.append(
                        f"{label}: revision is {rev_num} but revision_history has {len(rev_hist)} entries"
                    )

            # Reviews & dynamic staleness
            non_stale_upholding_kinds: set[str] = set()
            revs = clm.get("reviews")
            if not isinstance(revs, list):
                errors.append(f"{label}: reviews must be an array")
            else:
                for r_idx, rev in enumerate(revs):
                    total_reviews += 1
                    r_label = f"{label}.reviews[{r_idx}]"
                    if not isinstance(rev, dict):
                        errors.append(f"{r_label}: Review record must be an object")
                        continue
                    _check_unknown_keys(rev, ALLOWED_REVIEW_KEYS, r_label, errors)

                    rid = str(rev.get("review_id") or "")
                    if not REVIEW_ID_RE.match(rid):
                        errors.append(f"{r_label}: review_id '{rid}' must match 'REV-<digits>-<NNN>-<NN>'")
                    elif rid in review_id_seen:
                        errors.append(f"{r_label}: Duplicate review_id '{rid}' (already in {review_id_seen[rid]})")
                    else:
                        review_id_seen[rid] = fname

                    if rev.get("claim_id") != clm.get("id"):
                        errors.append(f"{r_label}: claim_id {rev.get('claim_id')!r} must equal '{clm.get('id')}'")
                    crev = rev.get("claim_revision")
                    if not is_strict_int(crev) or crev < 1 or (is_strict_int(rev_num) and crev > rev_num):
                        errors.append(f"{r_label}: claim_revision {crev!r} must be in 1..{rev_num}")

                    rkind = rev.get("reviewer_kind")
                    if rkind not in VALID_REVIEWER_KINDS:
                        errors.append(f"{r_label}: Invalid reviewer_kind {rkind!r}")
                    reviewer_id = rev.get("reviewer_id")
                    if not is_non_empty_str(reviewer_id):
                        errors.append(f"{r_label}: reviewer_id must be a non-empty string")
                    elif rkind == "human":
                        if NON_HUMAN_REVIEWER_RE.search(reviewer_id) or not HUMAN_NAME_RE.search(reviewer_id):
                            errors.append(
                                f"{r_label}: human review requires a named human person in reviewer_id, got '{reviewer_id}'"
                            )
                        if rev.get("model_version") is not None:
                            errors.append(f"{r_label}: human review must set model_version to null")
                    elif not is_non_empty_str(rev.get("model_version")):
                        errors.append(f"{r_label}: {rkind} review requires a non-empty model_version")

                    if not is_valid_iso_calendar_date(rev.get("review_date")):
                        errors.append(f"{r_label}: review_date {rev.get('review_date')!r} must be YYYY-MM-DD")

                    scopes = rev.get("review_scopes")
                    if (
                        not isinstance(scopes, list)
                        or not scopes
                        or any(not isinstance(s, str) or s not in VALID_REVIEW_SCOPES for s in scopes)
                        or len(set(scopes)) != len(scopes)
                    ):
                        errors.append(f"{r_label}: review_scopes must be a non-empty unique array of valid scopes")

                    irefs = rev.get("inspected_evidence_refs")
                    if (
                        not isinstance(irefs, list)
                        or any(not isinstance(r, str) or (not CERT_ID_RE.match(r) and not CLAIM_ID_RE.match(r)) for r in irefs)
                        or len(set(irefs)) != len(irefs)
                    ):
                        errors.append(
                            f"{r_label}: inspected_evidence_refs must be a unique array of CERT-*/CLM-* IDs"
                        )

                    if not is_non_empty_str(rev.get("findings")):
                        errors.append(f"{r_label}: findings must be a non-empty string")
                    objs = rev.get("objections")
                    if not isinstance(objs, list) or any(not is_non_empty_str(o) for o in objs):
                        errors.append(f"{r_label}: objections must be an array of non-empty strings")

                    mfp = str(rev.get("material_fingerprint_at_review") or "")
                    if not SHA256_RE.match(mfp):
                        errors.append(f"{r_label}: material_fingerprint_at_review must be 64-char lowercase SHA-256 hex")

                    efp_map = rev.get("evidence_fingerprints_at_review")
                    if not isinstance(efp_map, dict):
                        errors.append(f"{r_label}: evidence_fingerprints_at_review must be an object map")
                    else:
                        for ek, ev in efp_map.items():
                            if not CERT_ID_RE.match(str(ek)) and not CLAIM_ID_RE.match(str(ek)):
                                errors.append(
                                    f"{r_label}: Invalid ref key '{ek}' in evidence_fingerprints_at_review"
                                )
                            if not SHA256_RE.match(str(ev)):
                                errors.append(
                                    f"{r_label}: Invalid SHA-256 digest for '{ek}' in evidence_fingerprints_at_review"
                                )

                    if rev.get("recommendation") not in VALID_RECOMMENDATIONS:
                        errors.append(f"{r_label}: Invalid recommendation {rev.get('recommendation')!r}")

                    ev_map_json = canonical_json(efp_map) if isinstance(efp_map, dict) else ""
                    is_stale = mfp != expected_content_fp or ev_map_json != canonical_json(expected_ev_fps)
                    if is_stale:
                        stale_reviews += 1
                    else:
                        if claim_evidence_refs and isinstance(irefs, list):
                            if len(irefs) == 0:
                                errors.append(
                                    f"{r_label}: Current non-stale review must list at least 1 inspected_evidence_refs item"
                                )
                            for iref in irefs:
                                if iref not in claim_evidence_refs:
                                    errors.append(
                                        f"{r_label}: inspected_evidence_refs '{iref}' is not present in {clm.get('id')}.evidence"
                                    )
                        if rev.get("recommendation") == "uphold" and isinstance(rkind, str):
                            non_stale_upholding_kinds.add(rkind)

            if crev_status == "human_reviewed" and "human" not in non_stale_upholding_kinds:
                errors.append(
                    f"{label}: review_status 'human_reviewed' requires a non-stale upholding review with reviewer_kind='human'"
                )
            elif (
                crev_status == "independently_agent_reviewed"
                and "independent_agent" not in non_stale_upholding_kinds
                and "human" not in non_stale_upholding_kinds
            ):
                errors.append(
                    f"{label}: review_status 'independently_agent_reviewed' requires a non-stale upholding review by 'independent_agent' or 'human'"
                )
            elif (
                crev_status == "agent_reviewed"
                and not ({"agent", "independent_agent", "human"} & non_stale_upholding_kinds)
            ):
                errors.append(
                    f"{label}: review_status 'agent_reviewed' requires a non-stale upholding review matching the current material fingerprint"
                )

            # External recognition
            ext_arr = clm.get("external_recognition")
            if not isinstance(ext_arr, list):
                errors.append(f"{label}: external_recognition must be an array")
            else:
                for x_idx, xr in enumerate(ext_arr):
                    x_label = f"{label}.external_recognition[{x_idx}]"
                    if not isinstance(xr, dict):
                        errors.append(f"{x_label}: Must be an object")
                        continue
                    _check_unknown_keys(xr, ALLOWED_EXTERNAL_REC_KEYS, x_label, errors)
                    for fk in ("recognizer", "publication", "url_or_ref", "exact_scope"):
                        if not is_non_empty_str(xr.get(fk)):
                            errors.append(f"{x_label}: '{fk}' must be a non-empty string")
                    if not PARTIAL_ISO_DATE_RE.match(str(xr.get("date") or "")):
                        errors.append(f"{x_label}: date {xr.get('date')!r} must match YYYY, YYYY-MM, or YYYY-MM-DD")

        if not has_active_principal:
            errors.append(f"{fname}: Must contain at least one active claim with is_principal === true")

    all_claims_list = list(claim_by_id.values())
    for cyc in detect_inferential_cycles(all_claims_list):
        errors.append(f"Inferential claim dependency cycle detected: {' -> '.join(cyc)}")
    for cyc in _detect_supersession_cycles(all_claims_list):
        errors.append(f"Claim supersession cycle detected: {' -> '.join(cyc)}")

    return {
        "ok": len(errors) == 0,
        "errors": errors,
        "warnings": warnings,
        "stats": {
            "claimLedgers": sum(1 for _, _, _, is_t in parsed_ledgers if is_t),
            "totalLoadedLedgers": len(parsed_ledgers),
            "publishedCases": len(published_case_slugs),
            "totalClaims": total_claims,
            "activeClaims": active_claims,
            "reviews": total_reviews,
            "staleReviews": stale_reviews,
        },
    }


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(
        description="Validate DRAgNEt v1.0 Claim Ledgers and inferential evidence graphs."
    )
    ap.add_argument("--root", type=Path, default=DEFAULT_ROOT, help="Repository root directory")
    ap.add_argument("--claims-dir", type=Path, default=None, help="Override public/claims directory")
    ap.add_argument("--ledgers-dir", type=Path, default=None, help="Override public/ledgers directory")
    ap.add_argument("--cases-dir", type=Path, default=None, help="Override src/content/cases directory")
    ap.add_argument("--file", action="append", default=[], help="Validate specific claim JSON file(s)")
    ap.add_argument(
        "--stamp-fingerprints",
        action="append",
        default=[],
        help="Compute and stamp deterministic SHA-256 content_fingerprint on file(s) or directory",
    )
    ap.add_argument("--allow-empty", action="store_true", help="Pass when 0 claim ledgers exist")
    ap.add_argument(
        "--require-all-cases",
        action="store_true",
        help="Require every published case in src/content/cases/*.md to have a claim ledger",
    )
    ap.add_argument("--json", action="store_true", help="Emit validation result as JSON")
    args = ap.parse_args(argv)

    if args.stamp_fingerprints:
        stamped = stamp_claim_ledger_fingerprints(
            args.stamp_fingerprints,
            root_dir=args.root,
            claims_dir=args.claims_dir,
            ledgers_dir=args.ledgers_dir,
        )
        if not args.json:
            print(
                f"STAMPED_CLAIM_FINGERPRINTS ({stamped['claimsStamped']} claims across {stamped['filesStamped']} file(s))."
            )
        return 0

    res = validate_claims(
        root_dir=args.root,
        claims_dir=args.claims_dir,
        ledgers_dir=args.ledgers_dir,
        cases_dir=args.cases_dir,
        files=args.file,
        allow_empty=args.allow_empty,
        require_all_cases=args.require_all_cases,
    )

    if args.json:
        print(json.dumps(res, indent=2))
        return 0 if res["ok"] else 1

    if not res["ok"]:
        print(f"CLAIM_VALIDATION_FAILED with {len(res['errors'])} error(s):", file=sys.stderr)
        for err in res["errors"]:
            print(f"  - {err}", file=sys.stderr)
        return 1

    st = res["stats"]
    print(
        f"CLAIM_SCHEMA_AND_GRAPH_CHECKS_PASSED ({st['claimLedgers']}/{st['publishedCases']} case claim ledgers, "
        f"{st['totalClaims']} claims [{st['activeClaims']} active], {st['reviews']} reviews [{st['staleReviews']} stale])."
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
