#!/usr/bin/env python3
"""
package_release_assets.py (DRAgNEt v3 + Claim-Level Evidence Architecture v1.0)
-------------------------------------------------------------------------------
Builds versioned release artifacts from the validated repository for automated GitHub Releases:
  - release_dist/dragnet-ledgers-<tag>.zip  (ledgers/*.json + claims/*.json + schemas/*.json +
                                             docs/claim-architecture.md + provenance/review-provenance.json +
                                             data/open-questions.json + CITATION.cff + LICENSE + CHANGELOG_CORRECTIONS.md)
  - release_dist/review-provenance.json     (cryptographic SHA-256 claim & citation review provenance summary)
  - release_dist/SHA256SUMS.txt             (cryptographic SHA-256 digests of every release archive, ledger, claim file, schema & doc)
  - release_dist/RELEASE_NOTES.md           (markdown release notes with live citation & claim counts)
"""
from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import json
import sys
import zipfile
from pathlib import Path
from typing import Any

SCRIPTS_DIR = Path(__file__).resolve().parent
if str(SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_DIR))

import validate_claims  # noqa: E402

DEFAULT_ROOT = SCRIPTS_DIR.parent


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as fh:
        for chunk in iter(lambda: fh.read(65536), b""):
            h.update(chunk)
    return h.hexdigest()


def extract_site_url(root: Path) -> str:
    astro_cfg = root / "astro.config.mjs"
    if astro_cfg.exists():
        txt = astro_cfg.read_text(encoding="utf-8", errors="ignore")
        for marker in ("'https://", '"https://'):
            idx = txt.find(marker)
            if idx != -1:
                q = txt[idx]
                end = txt.find(q, idx + 1)
                if end != -1:
                    return txt[idx + 1 : end].rstrip("/")
    return "https://dragnet.tch.one"


def _read_package_version(root: Path) -> str:
    pkg_path = root / "package.json"
    if pkg_path.exists():
        try:
            pkg = json.loads(pkg_path.read_text(encoding="utf-8"))
            if pkg.get("version"):
                return str(pkg["version"])
        except Exception:
            pass
    return "3.3.0"


def build_review_provenance_summary(
    *,
    root: Path,
    tag: str,
    generated_date: str,
    ledger_files: list[Path],
    claim_files: list[Path],
) -> tuple[dict[str, Any], dict[str, dict[str, int]]]:
    pub_dir = root / "public"
    ledgers_dir = pub_dir / "ledgers"
    claims_dir = pub_dir / "claims"

    content_fps, ev_fps = validate_claims.compute_all_fingerprints(
        root_dir=root,
        claims_dir=claims_dir,
        ledgers_dir=ledgers_dir,
        public_dir=pub_dir,
    )

    cit_by_type = {k: 0 for k in sorted(validate_claims.DOCUMENTARY_TYPES | {"contextual_evidence", "hypothesis", "rejected_lead"}) if k in {"attestation", "contextual_evidence", "hypothesis", "rejected_lead"}}
    cit_by_ver = {"discovered": 0, "agent_verified": 0, "human_verified": 0, "externally_recognized": 0}
    total_citations = 0
    total_hosted_scans = 0

    claim_files_by_slug = {cf.stem: cf for cf in claim_files}
    claim_data_by_slug: dict[str, dict[str, Any]] = {
        cf.stem: json.loads(cf.read_text(encoding="utf-8")) for cf in claim_files
    }

    clm_by_type = {k: 0 for k in sorted(validate_claims.VALID_CLAIM_TYPES)}
    clm_by_assessment = {k: 0 for k in sorted(validate_claims.VALID_ASSESSMENTS)}
    clm_by_review_status = {
        "unreviewed": 0,
        "agent_reviewed": 0,
        "independently_agent_reviewed": 0,
        "human_reviewed": 0,
    }
    total_claims = 0
    active_claims = 0
    principal_active_claims = 0
    superseded_claims = 0
    withdrawn_claims = 0
    documentary_claims = 0
    interpretive_claims = 0
    total_reviews = 0
    non_stale_reviews = 0
    stale_reviews = 0
    total_external_rec = 0

    case_summaries: list[dict[str, Any]] = []
    claim_provenance_entries: list[dict[str, Any]] = []
    per_case_claim_counts: dict[str, dict[str, int]] = {}

    for lf in ledger_files:
        ldata = json.loads(lf.read_text(encoding="utf-8"))
        slug = str(ldata.get("ledger_id") or lf.stem)
        cits = ldata.get("citations") or []
        total_citations += len(cits)
        case_hosted = 0
        for c in cits:
            rt = str(c.get("record_type") or "")
            if rt in cit_by_type:
                cit_by_type[rt] += 1
            vl = str(c.get("verification_level") or "")
            if vl in cit_by_ver:
                cit_by_ver[vl] += 1
            if (c.get("scan") or {}).get("hosted_path"):
                case_hosted += 1
                total_hosted_scans += 1

        cf_path = claim_files_by_slug.get(slug)
        cdata = claim_data_by_slug.get(slug)
        case_clm_status = {
            "unreviewed": 0,
            "agent_reviewed": 0,
            "independently_agent_reviewed": 0,
            "human_reviewed": 0,
        }
        case_total_claims = 0
        case_reviewed_claims = 0

        if cdata is not None:
            for clm in cdata.get("claims", []):
                cid = str(clm.get("id") or "")
                ctype = str(clm.get("type") or "")
                cassess = str(clm.get("assessment") or "")
                crev = str(clm.get("review_status") or "unreviewed")
                lstat = str(clm.get("lifecycle_status") or "active")

                total_claims += 1
                case_total_claims += 1
                if ctype in clm_by_type:
                    clm_by_type[ctype] += 1
                if ctype in validate_claims.DOCUMENTARY_TYPES:
                    documentary_claims += 1
                elif ctype in validate_claims.INTERPRETIVE_TYPES:
                    interpretive_claims += 1
                if cassess in clm_by_assessment:
                    clm_by_assessment[cassess] += 1
                if crev in clm_by_review_status:
                    clm_by_review_status[crev] += 1
                    case_clm_status[crev] += 1
                if crev != "unreviewed":
                    case_reviewed_claims += 1

                if lstat == "active":
                    active_claims += 1
                    if clm.get("is_principal") is True:
                        principal_active_claims += 1
                elif lstat == "superseded":
                    superseded_claims += 1
                elif lstat == "withdrawn":
                    withdrawn_claims += 1

                total_external_rec += len(clm.get("external_recognition") or [])

                live_fp = content_fps.get(cid, str(clm.get("content_fingerprint") or ""))
                live_ev_map = ev_fps.get(cid, {})
                live_ev_json = validate_claims.canonical_json(live_ev_map)

                rev_summaries: list[dict[str, Any]] = []
                for rev in clm.get("reviews") or []:
                    if not isinstance(rev, dict):
                        continue
                    total_reviews += 1
                    mfp = str(rev.get("material_fingerprint_at_review") or "")
                    efp_map = rev.get("evidence_fingerprints_at_review")
                    efp_json = validate_claims.canonical_json(efp_map) if isinstance(efp_map, dict) else ""
                    stale_flag = mfp != live_fp or efp_json != live_ev_json
                    if stale_flag:
                        stale_reviews += 1
                    else:
                        non_stale_reviews += 1
                    rev_summaries.append(
                        {
                            "review_id": rev.get("review_id"),
                            "reviewer_id": rev.get("reviewer_id"),
                            "reviewer_kind": rev.get("reviewer_kind"),
                            "model_version": rev.get("model_version"),
                            "review_date": rev.get("review_date"),
                            "recommendation": rev.get("recommendation"),
                            "material_fingerprint_at_review": mfp,
                            "is_stale": stale_flag,
                        }
                    )

                claim_provenance_entries.append(
                    {
                        "id": cid,
                        "case_slug": slug,
                        "type": ctype,
                        "assessment": cassess,
                        "lifecycle_status": lstat,
                        "review_status": crev,
                        "revision": clm.get("revision"),
                        "content_fingerprint": live_fp,
                        "reviews": rev_summaries,
                    }
                )

        per_case_claim_counts[slug] = {
            "total": case_total_claims,
            "reviewed": case_reviewed_claims,
            "human_reviewed": case_clm_status["human_reviewed"],
        }
        case_summaries.append(
            {
                "case_slug": slug,
                "case_number": ldata.get("case_number"),
                "target_id": ldata.get("target_id"),
                "headword": ldata.get("headword"),
                "ledger_sha256": sha256_file(lf),
                "claim_ledger_sha256": sha256_file(cf_path) if cf_path is not None else None,
                "citation_count": len(cits),
                "hosted_scan_count": case_hosted,
                "claim_count": case_total_claims,
                "claim_review_status_counts": case_clm_status,
            }
        )

    provenance = {
        "schema_version": "1.0",
        "release_tag": tag,
        "package_version": _read_package_version(root),
        "generated_date": generated_date,
        "citation_schema_version": "3.0",
        "claim_schema_version": "1.0",
        "citation_corpus": {
            "ledger_count": len(ledger_files),
            "total_citations": total_citations,
            "by_record_type": cit_by_type,
            "by_verification_level": cit_by_ver,
            "hosted_pre_1931_scans": total_hosted_scans,
        },
        "claim_corpus": {
            "claim_ledger_count": len(claim_files),
            "published_case_count": len(ledger_files),
            "total_claims": total_claims,
            "active_claims": active_claims,
            "principal_active_claims": principal_active_claims,
            "superseded_claims": superseded_claims,
            "withdrawn_claims": withdrawn_claims,
            "documentary_claims": documentary_claims,
            "interpretive_claims": interpretive_claims,
            "by_type": clm_by_type,
            "by_assessment": clm_by_assessment,
            "by_review_status": clm_by_review_status,
            "total_reviews": total_reviews,
            "non_stale_reviews": non_stale_reviews,
            "stale_reviews": stale_reviews,
            "external_recognitions": total_external_rec,
        },
        "cases": case_summaries,
        "claims": sorted(claim_provenance_entries, key=lambda item: item["id"]),
    }
    return provenance, per_case_claim_counts


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(
        description="Package DRAgNEt JSON citation ledgers, claim ledgers, schemas, review provenance, checksums, and release notes."
    )
    ap.add_argument("--tag", required=True, help="Release tag, e.g. v3.3.0")
    ap.add_argument("--out-dir", default="release_dist", help="Output directory for release artifacts")
    ap.add_argument("--root", type=Path, default=DEFAULT_ROOT, help="Repository root directory")
    args = ap.parse_args(argv)

    root = Path(args.root).resolve()
    tag = args.tag if args.tag.startswith("v") else f"v{args.tag}"
    out_dir_raw = Path(args.out_dir)
    out_dir = out_dir_raw.resolve() if out_dir_raw.is_absolute() else (root / out_dir_raw).resolve()
    out_dir.mkdir(parents=True, exist_ok=True)

    ledgers_dir = root / "public" / "ledgers"
    ledger_files = sorted(ledgers_dir.glob("*.json"))
    if not ledger_files:
        raise SystemExit("No JSON ledgers found in public/ledgers/")

    claims_dir = root / "public" / "claims"
    claim_files = sorted(claims_dir.glob("*.json")) if claims_dir.exists() else []
    if claim_files:
        val_res = validate_claims.validate_claims(root_dir=root)
        if not val_res["ok"]:
            print(f"ERROR: Claim validation failed before packaging ({len(val_res['errors'])} error(s)):", file=sys.stderr)
            for err in val_res["errors"]:
                print(f"  - {err}", file=sys.stderr)
            return 1

    schemas_dir = root / "schemas"
    schema_files = sorted(schemas_dir.glob("*.json")) if schemas_dir.exists() else []
    claim_arch_doc = root / "docs" / "claim-architecture.md"
    open_q = root / "public" / "data" / "open-questions.json"

    today = dt.date.today().isoformat()
    provenance_obj, per_case_claims = build_review_provenance_summary(
        root=root,
        tag=tag,
        generated_date=today,
        ledger_files=ledger_files,
        claim_files=claim_files,
    )
    provenance_path = out_dir / "review-provenance.json"
    provenance_json = json.dumps(provenance_obj, indent=2, ensure_ascii=False) + "\n"
    leak = validate_claims.find_workspace_or_drive_leak(provenance_json)
    if leak:
        raise SystemExit(f"ERROR: Workspace/private leak '{leak}' detected in review-provenance.json")
    provenance_path.write_text(provenance_json, encoding="utf-8")

    zip_name = f"dragnet-ledgers-{tag}.zip"
    zip_path = out_dir / zip_name

    # Preserve exact backward-compatible ledgers/*.json and data/open-questions.json paths
    include_files: list[tuple[Path, str]] = []
    for lf in ledger_files:
        include_files.append((lf, f"ledgers/{lf.name}"))
    for cf in claim_files:
        include_files.append((cf, f"claims/{cf.name}"))
    for sf in schema_files:
        include_files.append((sf, f"schemas/{sf.name}"))
    if claim_arch_doc.exists():
        include_files.append((claim_arch_doc, "docs/claim-architecture.md"))
    include_files.append((provenance_path, "provenance/review-provenance.json"))
    if open_q.exists():
        include_files.append((open_q, "data/open-questions.json"))
    for meta_name in ("CITATION.cff", "LICENSE", "CHANGELOG_CORRECTIONS.md"):
        mp = root / meta_name
        if mp.exists():
            include_files.append((mp, meta_name))

    with zipfile.ZipFile(zip_path, "w", compression=zipfile.ZIP_DEFLATED) as zf:
        for src_path, arc_name in include_files:
            zf.write(src_path, arcname=f"dragnet-ledgers-{tag}/{arc_name}")

    checksum_lines: list[str] = [
        f"{sha256_file(zip_path)}  {zip_name}",
        f"{sha256_file(provenance_path)}  review-provenance.json",
    ]
    for lf in ledger_files:
        checksum_lines.append(f"{sha256_file(lf)}  ledgers/{lf.name}")
    for cf in claim_files:
        checksum_lines.append(f"{sha256_file(cf)}  claims/{cf.name}")
    for sf in schema_files:
        checksum_lines.append(f"{sha256_file(sf)}  schemas/{sf.name}")
    if claim_arch_doc.exists():
        checksum_lines.append(f"{sha256_file(claim_arch_doc)}  docs/claim-architecture.md")
    checksum_lines.append(f"{sha256_file(provenance_path)}  provenance/review-provenance.json")
    if open_q.exists():
        checksum_lines.append(f"{sha256_file(open_q)}  data/open-questions.json")

    sums_path = out_dir / "SHA256SUMS.txt"
    sums_path.write_text("\n".join(checksum_lines) + "\n", encoding="utf-8")

    site_url = extract_site_url(root)
    rows: list[str] = []
    tot_eval = tot_att = tot_ctx = tot_hyp = tot_rej = tot_human = tot_scans = 0

    for lf in ledger_files:
        data = json.loads(lf.read_text(encoding="utf-8"))
        slug = str(data.get("ledger_id") or lf.stem)
        hw = data.get("headword") or slug
        case_num = data.get("case_number") or ""
        cits = data.get("citations") or []
        n_eval = len(cits)
        n_att = sum(1 for c in cits if c.get("record_type") == "attestation")
        n_ctx = sum(1 for c in cits if c.get("record_type") == "contextual_evidence")
        n_hyp = sum(1 for c in cits if c.get("record_type") == "hypothesis")
        n_rej = sum(1 for c in cits if c.get("record_type") == "rejected_lead")
        n_hum = sum(1 for c in cits if c.get("verification_level") == "human_verified")
        n_scn = sum(1 for c in cits if (c.get("scan") or {}).get("hosted_path"))

        tot_eval += n_eval
        tot_att += n_att
        tot_ctx += n_ctx
        tot_hyp += n_hyp
        tot_rej += n_rej
        tot_human += n_hum
        tot_scans += n_scn

        clm_info = per_case_claims.get(slug, {"total": 0, "reviewed": 0})
        clm_cell = str(clm_info["total"]) if slug in {cf.stem for cf in claim_files} else "—"
        rev_cell = str(clm_info["reviewed"]) if slug in {cf.stem for cf in claim_files} else "—"

        rows.append(
            f"| [`{hw}`]({site_url}/cases/{slug}/) ({case_num}) | {n_eval} | {n_att} | {n_ctx} | {n_hyp} | {n_rej} | {n_hum} | {n_scn} | {clm_cell} | {rev_cell} |"
        )

    cc = provenance_obj["claim_corpus"]
    clm_rev = cc["by_review_status"]

    notes_md = f"""## DRAgNEt Dataset & Case Archive — `{tag}` ({today})

Open-access historical lexicography dataset release from **DRAgNEt** (*Deep Research Agent Network for Etymology*): [{site_url}]({site_url})

### Corpus Summary
- **Published Case Files**: `{len(ledger_files)}`
- **Evaluated Citation Records (`schema 3.0`)**: `{tot_eval}` (`{tot_att}` primary attestations, `{tot_ctx}` contextual controls, `{tot_hyp}` linguistic hypotheses, `{tot_rej}` rejected leads & archival traps)
- **Human-Verified Citations**: `{tot_human}`
- **Bundled Pre-1931 Public-Domain Scans**: `{tot_scans}`
- **Structured Claim Ledgers (`schema 1.0`)**: `{cc['claim_ledger_count']}` / `{len(ledger_files)}` cases (`{cc['total_claims']}` total claims: `{cc['active_claims']}` active [`{cc['principal_active_claims']}` principal], `{cc['documentary_claims']}` documentary, `{cc['interpretive_claims']}` interpretive)
- **Claim Review Provenance**: `{clm_rev['human_reviewed']}` `human_reviewed`, `{clm_rev['independently_agent_reviewed']}` `independently_agent_reviewed`, `{clm_rev['agent_reviewed']}` `agent_reviewed`, `{clm_rev['unreviewed']}` `unreviewed` (`{cc['non_stale_reviews']}` active fingerprinted review record(s), `{cc['stale_reviews']}` historical stale review record(s))

### Included Case & Claim Ledgers

| Headword & Case | Evaluated | Attestations | Contextual | Hypotheses | Rejected Leads | Human-Verified | Hosted Scans | Claims | Reviewed Claims |
| :--- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
{chr(10).join(rows)}

### Provenance & Two-Layer Verification Model
- **AI-Authored, Human-Coordinated Archive**: Case Files, schema `3.0` citation ledgers, and schema `1.0` claim ledgers are researched and structured by **DRAgNEt** (*Deep Research Agent Network for Etymology*), coordinated by Joshua Callahan (`CITATION.cff`).
- **Citation Verification Ladder (`ledgers/*.json`)**: Every archival witness is tagged as `discovered`, `agent_verified`, `human_verified`, or `externally_recognized`, with pre-1931 U.S. public-domain WebP proof scans hosted directly where permitted.
- **Claim-Level Evidence Graph & SHA-256 Review Provenance (`claims/*.json`)**: Atomic documentary and interpretive claims link via directed `evidence` edges to `CERT-*` witnesses and upstream `CLM-*` premises without synthetic numerical confidence scores. Newly ingested claims default to `unreviewed`; promoted reviews (`agent_reviewed`, `independently_agent_reviewed`, `human_reviewed`) record exact SHA-256 `material_fingerprint_at_review` and `evidence_fingerprints_at_review` digests so any subsequent edit automatically flags prior reviews as stale.

### Attached Machine-Readable Assets
- **`{zip_name}`** — Standalone CC BY 4.0 archive preserving backward-compatible `ledgers/*.json` and `data/open-questions.json` paths alongside `claims/*.json`, `schemas/claim-ledger.schema.json`, `docs/claim-architecture.md`, `provenance/review-provenance.json`, `CHANGELOG_CORRECTIONS.md`, and `CITATION.cff`.
- **`review-provenance.json`** — Cryptographic SHA-256 fingerprint and review-status manifest across all packaged citation and claim ledgers.
- **`SHA256SUMS.txt`** — Cryptographic SHA-256 digests for reproducible citation, claim, and schema verification.
"""
    notes_path = out_dir / "RELEASE_NOTES.md"
    notes_path.write_text(notes_md, encoding="utf-8")

    print(
        f"[OK] Packaged {zip_path.name} ({len(ledger_files)} citation ledgers [{tot_eval} citations], "
        f"{len(claim_files)} claim ledgers [{cc['total_claims']} claims])"
    )
    print(f"[OK] Wrote {provenance_path.name}, {sums_path.name}, and {notes_path.name}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
