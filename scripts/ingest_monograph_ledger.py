#!/usr/bin/env python3
"""
07_dragnet_monograph_to_blog_scaffolder.py
------------------------------------------
Deterministic bridge between the Autonomous Historical Etymology Lab's Monograph/Ledger
deliverables (NNN1_*_monograph.md + NNN2_*_verified_ledger.json + evidence_scans/)
and the DRAgNEt (Deep Research Agent Network for Etymology) Astro + Cloudflare blog.

Usage:
  python3 scripts/ingest_monograph_ledger.py \
    --ledger /path/to/1302_moolah_verified_ledger.json \
    --slug moolah \
    --scans-dir /path/to/evidence_scans \
    --site-root .
"""
from __future__ import annotations
import argparse
import datetime as dt
import json
import shutil
from pathlib import Path
from typing import Any


def extract_certificates(payload: Any) -> list[dict[str, Any]]:
    if isinstance(payload, list):
        return [c for c in payload if isinstance(c, dict) and "certificate_id" in c]
    if not isinstance(payload, dict):
        raise ValueError("Ledger JSON must be a dict or list of certificates.")
    merged: list[dict[str, Any]] = []
    seen: set[str] = set()
    for key, val in payload.items():
        if key.startswith("audit_of_"):
            continue
        if isinstance(val, list) and val and isinstance(val[0], dict) and "certificate_id" in val[0]:
            for cert in val:
                cid = str(cert.get("certificate_id", ""))
                if cid and cid not in seen:
                    seen.add(cid)
                    merged.append(cert)
    return merged


def yaml_escape(text: str) -> str:
    clean = " ".join(str(text or "").split())
    return json.dumps(clean, ensure_ascii=False)[1:-1]


def main() -> int:
    ap = argparse.ArgumentParser(description="Scaffold a DRAgNEt Astro Case File from a verified Etymology Lab JSON ledger.")
    ap.add_argument("--ledger", required=True, help="Path to NNN2_*_verified_ledger.json")
    ap.add_argument("--slug", required=True, help="URL slug for src/content/cases/<slug>.md")
    ap.add_argument("--scans-dir", default="", help="Optional path to evidence_scans/ directory to copy referenced PNG plates")
    ap.add_argument("--site-root", default=".", help="Root of the DRAgNEt Astro repository")
    ap.add_argument("--case-number", default="", help="Display label such as 'Case 1300'")
    ap.add_argument("--overwrite", action="store_true", help="Overwrite existing markdown file if present")
    args = ap.parse_args()

    ledger_path = Path(args.ledger).resolve()
    site_root = Path(args.site_root).resolve()
    payload = json.loads(ledger_path.read_text(encoding="utf-8"))
    certs = extract_certificates(payload)
    if not certs:
        raise SystemExit(f"No certificates found in {ledger_path}")

    verified = [c for c in certs if c.get("epistemic_status") == "PRIMARY-SCAN-VERIFIED"]
    hypotheses = [c for c in certs if c.get("epistemic_status") == "PHONOLOGICAL-HYPOTHESIS"]
    falsified = [c for c in certs if c.get("epistemic_status") == "FALSIFIED-MYTH"]

    verified_sorted = sorted(verified, key=lambda c: (c.get("attested_year") or 9999, str(c.get("attested_date_exact") or "")))
    earliest = verified_sorted[0] if verified_sorted else certs[0]

    headword = (
        (payload.get("headword") if isinstance(payload, dict) else None)
        or earliest.get("headword")
        or args.slug
    )
    target_id = (
        (payload.get("target_id") if isinstance(payload, dict) else None)
        or earliest.get("target_id")
        or "TGT-000"
    )
    baseline_year = (
        (payload.get("target_board_baseline_year") if isinstance(payload, dict) else None)
        or (payload.get("baseline_year") if isinstance(payload, dict) else None)
        or earliest.get("baseline_year")
        or 1900
    )
    case_number = args.case_number or f"Case {ledger_path.name.split('_')[0]}"
    today = dt.date.today().isoformat()

    # Copy ledger into public/ledgers/
    dest_ledger_dir = site_root / "public/ledgers"
    dest_ledger_dir.mkdir(parents=True, exist_ok=True)
    shutil.copy2(ledger_path, dest_ledger_dir / ledger_path.name)

    # Copy top proof plates if scans-dir provided
    dest_plates_dir = site_root / "public/proof-plates" / args.slug
    dest_plates_dir.mkdir(parents=True, exist_ok=True)
    scans_dir = Path(args.scans_dir).resolve() if args.scans_dir else None

    plate_entries: list[str] = []
    for c in verified_sorted[:4]:
        cid = c.get("certificate_id", "CERT-000")
        scan_fn = c.get("scan_evidence_filename") or ""
        if scans_dir and scan_fn and (scans_dir / scan_fn).exists():
            shutil.copy2(scans_dir / scan_fn, dest_plates_dir / scan_fn)
            img_web_path = f"/proof-plates/{args.slug}/{scan_fn}"
        else:
            img_web_path = f"/proof-plates/{args.slug}/{scan_fn or (cid + '.png')}"
        plate_entries.append(
            f"""  - certId: "{yaml_escape(cid)}"
    title: "{yaml_escape(c.get('source_publication', 'Archival Source'))}"
    date: "{yaml_escape(c.get('attested_date_exact') or c.get('attested_year'))}, {yaml_escape(c.get('page_and_column', ''))}"
    imagePath: "{yaml_escape(img_web_path)}"
    archiveUrl: "{yaml_escape(c.get('source_url') or 'https://archive.org/')}"
    caption: "{yaml_escape((c.get('auditor_notes') or '')[:180])}"
    diplomaticQuote: "{yaml_escape((c.get('verbatim_quote') or '')[:280])}" """.rstrip()
        )

    myth_entries: list[str] = []
    for m in falsified[:6]:
        cid = m.get("certificate_id", "CERT-000")
        url_line = f'\n    sourceUrl: "{yaml_escape(m["source_url"])}"' if str(m.get("source_url", "")).startswith("http") else ""
        myth_entries.append(
            f"""  - certId: "{yaml_escape(cid)}"
    claim: "{yaml_escape(m.get('attested_spelling') or m.get('source_publication') or cid)}"
    trapType: "Falsified / Archival Trap"
    inkReality: "{yaml_escape((m.get('auditor_notes') or '')[:220])}"{url_line}"""
        )

    ear_date = str(earliest.get("attested_date_exact") or earliest.get("attested_year") or "")
    ear_pub = str(earliest.get("source_publication") or "Historical Periodical")
    ear_url = str(earliest.get("source_url") or "https://archive.org/")
    ear_quote = yaml_escape((earliest.get("verbatim_quote") or "")[:240])
    years_saved = earliest.get("years_antedated")
    delta_label = f"-{years_saved} yrs vs. baseline" if years_saved else f"Earliest scan: {ear_date}"

    out_md = site_root / "src/content/cases" / f"{args.slug}.md"
    if out_md.exists() and not args.overwrite:
        raise SystemExit(f"Refusing to overwrite existing {out_md} without --overwrite")

    out_md.parent.mkdir(parents=True, exist_ok=True)
    md_content = f"""---
title: "Archival Origins and Early Chronology of {yaml_escape(headword.title())}"
subtitle: "Primary-scan dossier distilled from {yaml_escape(ledger_path.name)} ({len(verified)} verified scans, {len(falsified)} falsified myths and OCR ghosts)."
headword: "{yaml_escape(headword)}"
relatedForms: ["{yaml_escape(headword)}"]
targetId: "{yaml_escape(target_id)}"
caseNumber: "{yaml_escape(case_number)}"
pubDate: "{today}"
author: "Joshua Callahan"
authorCitation: "Callahan, Joshua"
keywords: ["etymology", "{yaml_escape(headword)}", "antedating", "historical lexicography"]
oedBaseline:
  form: "{yaml_escape(headword)}"
  year: {int(baseline_year)}
  source: "Reference Baseline ({int(baseline_year)})"
  url: "https://www.oed.com/"
earliestScan:
  form: "{yaml_escape(earliest.get('attested_spelling') or headword)}"
  date: "{yaml_escape(ear_date)}"
  year: {int(earliest.get('attested_year') or baseline_year)}
  source: "{yaml_escape(ear_pub)}"
  location: "Primary Archival Scan"
  archiveUrl: "{yaml_escape(ear_url)}"
  certId: "{yaml_escape(earliest.get('certificate_id', 'CERT-001'))}"
netDeltaLabel: "{yaml_escape(delta_label)}"
certificateCounts:
  total: {len(certs)}
  verified: {len(verified)}
  hypotheses: {len(hypotheses)}
  falsified: {len(falsified)}
establishedFacts:
  - "Earliest verified scan in this ledger: {yaml_escape(ear_date)} in {yaml_escape(ear_pub)} ({yaml_escape(earliest.get('certificate_id', ''))})."
  - "All {len(verified)} PRIMARY-SCAN-VERIFIED citations passed physical-ink and printed-masthead inspection."
originHypothesis:
  badge: "Calibrated Hypothesis"
  summary: "Summarize the top-ranked PHONOLOGICAL-HYPOTHESIS pathway from the monograph here without raw 4-decimal harness scores."
  boundaryNote: "Separate attested chronological print history from any unattested oral transmission or morphological step."
proofPlates:
{chr(10).join(plate_entries)}
falsifiedMyths:
{chr(10).join(myth_entries)}
ledgerPath: "/ledgers/{ledger_path.name}"
reuseKit:
  wikipediaPrimaryRef: "<ref>{{{{cite news |work={yaml_escape(ear_pub)} |date={yaml_escape(ear_date)} |url={yaml_escape(ear_url)} |quote={ear_quote}}}}}</ref>"
  wikipediaGuidance: "Cite the historical print scan directly for straightforward dated usage under WP:PRIMARY; reserve interpretive origin claims for peer-reviewed or edited secondary venues (Comments on Etymology, Notes and Queries, OED, Green's)."
  wiktionaryQuote: "* '''{int(earliest.get('attested_year') or baseline_year)}''' [{ear_url} {yaml_escape(ear_pub)}] ({yaml_escape(ear_date)}):\\n*: {ear_quote}"
  adsLDispatch: "Subject: Antedating / archival dossier on '{yaml_escape(headword)}' ({yaml_escape(ear_date)}, {yaml_escape(ear_pub)})\\n\\nEarliest verified scan: {yaml_escape(ear_date)} in {yaml_escape(ear_pub)} ({yaml_escape(ear_url)}). Full proof plates and {len(falsified)} falsified leads at DRAgNEt {yaml_escape(case_number)}."
  oedSlipSummary: "Headword: {yaml_escape(headword)} | Date: {yaml_escape(ear_date)} | Source: {yaml_escape(ear_pub)} ({yaml_escape(earliest.get('page_and_column', ''))}) | Scan: {yaml_escape(ear_url)}"
---

## 1. Prior Scholarship & Baseline Calibration

Distill Section 1 of the monograph here in approachable, non-prosecutorial prose, explicitly crediting prior lexicographers (*OED*, *Green's Dictionary of Slang*, *HDAS*, *Etymonline*, *American Speech*, *Comments on Etymology*).

## 2. What the Primary Scans Establish

Present the chronological chain of `PRIMARY-SCAN-VERIFIED` discoveries with verbatim blockquotes and direct links to the host archive pages.

## 3. Evaluating the Origin Hypothesis

Present the phonological, occupational, or language-contact reconstruction with clear epistemic guardrails, omitting internal 4-decimal string-similarity scores.
"""
    out_md.write_text(md_content, encoding="utf-8")
    print(f"[OK] Scaffolded {out_md}")
    print(f"[OK] Copied ledger -> {dest_ledger_dir / ledger_path.name} ({len(certs)} certs: {len(verified)} verified, {len(hypotheses)} hypotheses, {len(falsified)} falsified)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
