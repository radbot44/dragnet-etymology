#!/usr/bin/env python3
"""
ingest_monograph_ledger.py (DRAgNEt v3)
---------------------------------------
Converts an internal research JSON ledger into a workspace-sanitized v3 public ledger
(public/ledgers/<slug>.json) with orthogonal record_type and 4-level verification_level
fields and zero hardcoded counts.
"""
from __future__ import annotations
import argparse
import datetime as dt
import json
import re
from pathlib import Path
from typing import Any

DRIVE_URL_RE = re.compile(r"https?://(?:drive|docs)\.google\.com/\S+")


def sanitize_text(s: Any) -> str:
    if not s:
        return ""
    out = DRIVE_URL_RE.sub("[archived scan]", str(s)).replace("evidence_scans/", "")
    return " ".join(out.split())


def extract_raw_certs(payload: Any) -> list[dict[str, Any]]:
    if isinstance(payload, list):
        return [c for c in payload if isinstance(c, dict) and "certificate_id" in c]
    merged, seen = [], set()
    for k, v in (payload or {}).items():
        if k.startswith("audit_of_"):
            continue
        if isinstance(v, list) and v and isinstance(v[0], dict) and "certificate_id" in v[0]:
            for cert in v:
                cid = str(cert.get("certificate_id", ""))
                if cid and cid not in seen:
                    seen.add(cid)
                    merged.append(cert)
    return merged


def main() -> int:
    ap = argparse.ArgumentParser(description="Ingest an archival JSON ledger into DRAgNEt v3 format.")
    ap.add_argument("--ledger", required=True, help="Path to source JSON ledger")
    ap.add_argument("--slug", required=True, help="Case & ledger slug, e.g. moolah")
    ap.add_argument("--site-root", default=".", help="Root of DRAgNEt repository")
    args = ap.parse_args()

    src = Path(args.ledger).resolve()
    root = Path(args.site_root).resolve()
    raw_payload = json.loads(src.read_text(encoding="utf-8"))
    raw_certs = extract_raw_certs(raw_payload)
    if not raw_certs:
        raise SystemExit(f"No certificate records found in {src}")

    headword = (raw_payload.get("headword") if isinstance(raw_payload, dict) else None) or raw_certs[0].get("headword") or args.slug
    target_id = (raw_payload.get("target_id") if isinstance(raw_payload, dict) else None) or raw_certs[0].get("target_id") or "TGT-000"
    case_num = f"Case {src.name.split('_')[0]}"

    citations = []
    for c in raw_certs:
        cid = c["certificate_id"]
        ep = c.get("epistemic_status", "")
        dt_str = str(c.get("discovery_type") or "")
        if ep == "PRIMARY-SCAN-VERIFIED":
            rtype, sub = "attestation", "primary_attestation"
        elif ep == "PHONOLOGICAL-HYPOTHESIS":
            rtype, sub = "hypothesis", "supporting_pathway"
        elif "negative_corpus" in dt_str or "prosopograph" in dt_str:
            rtype, sub = "contextual_evidence", "corpus_or_prosopographical_control"
        else:
            rtype, sub = "rejected_lead", "ocr_or_misdate"

        yr_m = re.search(r"(\d{4})", str(c.get("masthead_year") or c.get("attested_year") or ""))
        pub_yr = int(yr_m.group(1)) if yr_m else None
        date_disp = str(c.get("attested_date_exact") or pub_yr or "Undated")

        citations.append({
            "id": cid,
            "slug": cid.lower(),
            "case_slug": args.slug,
            "headword": headword,
            "attested_form": c.get("attested_spelling") or headword,
            "record_type": rtype,
            "record_subtype": sub,
            "verification_level": "agent_verified" if c.get("scan_inspected") else "discovered",
            "verified_by_agent": "DRAgNEt Archival Pipeline" if c.get("scan_inspected") else None,
            "human_verified_by": None,
            "human_verified_date": None,
            "external_recognition": None,
            "publication_year": pub_yr,
            "date_display": date_disp,
            "sort_date": date_disp[:10],
            "short_gloss": f"{rtype.replace('_', ' ').title()}: {c.get('attested_spelling') or headword}",
            "source_publication": sanitize_text(c.get("source_publication") or "Archival Source"),
            "source_archive": sanitize_text(c.get("source_archive") or "Digital Archive"),
            "source_url": c.get("source_url") or "https://archive.org/",
            "page_and_column": sanitize_text(c.get("page_and_column") or ""),
            "verbatim_quote": sanitize_text(c.get("verbatim_quote") or ""),
            "masthead_date_verified": bool(c.get("masthead_date_verified")),
            "catalog_year": c.get("catalog_year"),
            "masthead_year": c.get("masthead_year"),
            "linguistic_note": sanitize_text(c.get("donor_language_hypothesis")),
            "analysis_notes": sanitize_text(c.get("auditor_notes")),
            "scan": {
                "hosted_path": None,
                "rights_status": "external_archive_link" if (pub_yr and pub_yr <= 1930) else "post_1930_external_archive_link",
                "rights_note": "Inspect directly via host archive URL (or optimize pre-1931 scan into public/scans/).",
            },
        })

    out_ledger = root / "public/ledgers" / f"{args.slug}.json"
    out_ledger.parent.mkdir(parents=True, exist_ok=True)
    out_ledger.write_text(json.dumps({
        "schema_version": "3.0",
        "ledger_id": args.slug,
        "case_number": case_num,
        "target_id": target_id,
        "headword": headword,
        "publication_status": "working_paper",
        "publication_status_note": "Open working paper; verify journal prior-dissemination rules before overlapping submission.",
        "updated_at": dt.date.today().isoformat(),
        "prior_art_baselines": {},
        "citations": citations,
    }, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"[OK] Wrote sanitized v3 ledger -> {out_ledger} ({len(citations)} records)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
