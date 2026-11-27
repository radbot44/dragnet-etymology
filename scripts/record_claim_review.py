#!/usr/bin/env python3
"""
record_claim_review.py (DRAgNEt Claim-Level Evidence Architecture v1.0)
-----------------------------------------------------------------------
Deterministic CLI to record genuine 'human_reviewed', 'independently_agent_reviewed',
or 'agent_reviewed' review objects on DRAgNEt claims with exact SHA-256
material_fingerprint_at_review and evidence_fingerprints_at_review snapshots.

Invariants enforced:
  - Uses validate_claims directly for zero semantic divergence in SHA-256 digests.
  - NEVER serializes 'is_stale' to disk (staleness is computed dynamically).
  - Enforces reviewer_kind='human' -> model_version=None + real multi-word human name
    (rejecting agent/pipeline/LLM strings).
  - Enforces reviewer_kind in {'independent_agent', 'agent'} -> non-empty model_version
    (and blocks self-review on 'independent_agent' if reviewer matches claim author).
  - Validates the modified claim ledger via validate_claims before committing to disk.
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import re
import sys
from pathlib import Path
from typing import Any

SCRIPTS_DIR = Path(__file__).resolve().parent
if str(SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_DIR))

import validate_claims  # noqa: E402

STATUS_TO_KIND = {
    "human_reviewed": "human",
    "independently_agent_reviewed": "independent_agent",
    "agent_reviewed": "agent",
}
KIND_TO_STATUS = {v: k for k, v in STATUS_TO_KIND.items()}
STATUS_TIER = {
    "unreviewed": 0,
    "agent_reviewed": 1,
    "independently_agent_reviewed": 2,
    "human_reviewed": 3,
}
ORCID_RE = re.compile(r"^https://orcid\.org/\d{4}-\d{4}-\d{4}-\d{3}[\dX]$")


def _default_scopes_for_type(claim_type: str) -> list[str]:
    if claim_type == "antedating":
        return ["archival", "transcription", "baseline"]
    if claim_type in {"attestation", "source_relationship"}:
        return ["archival", "transcription"]
    if claim_type == "negative_evidence":
        return ["archival", "structural"]
    return ["archival", "linguistic_argument"]


def _parse_csv_or_list(values: list[str]) -> list[str]:
    out: list[str] = []
    for raw in values:
        for part in str(raw).split(","):
            tok = part.strip()
            if tok and tok not in out:
                out.append(tok)
    return out


def _allocate_review_id(claim_id: str, all_claim_files: list[Path]) -> str:
    m = validate_claims.CLAIM_ID_RE.match(claim_id)
    if not m:
        raise SystemExit(f"ERROR: Invalid claim ID {claim_id!r} (expected CLM-NNNN-NNN)")
    case_digits, clm_seq = m.group(1), m.group(2)
    prefix = f"REV-{case_digits}-{clm_seq}-"
    seen_ids: set[str] = set()
    max_seq = 0

    for cf in all_claim_files:
        try:
            d = json.loads(cf.read_text(encoding="utf-8"))
        except Exception:
            continue
        for clm in d.get("claims", []):
            for rev in clm.get("reviews") or []:
                if isinstance(rev, dict) and isinstance(rev.get("review_id"), str):
                    rid = rev["review_id"]
                    seen_ids.add(rid)
                    if rid.startswith(prefix):
                        tail = rid[len(prefix) :]
                        if tail.isdigit():
                            max_seq = max(max_seq, int(tail))

    nxt = max_seq + 1
    while True:
        candidate = f"{prefix}{nxt:02d}" if nxt < 100 else f"{prefix}{nxt:03d}"
        if candidate not in seen_ids:
            return candidate
        nxt += 1


def _compute_effective_review_status(
    reviews: list[dict[str, Any]],
    current_content_fp: str,
    current_ev_fps: dict[str, str],
) -> str:
    ev_json = validate_claims.canonical_json(current_ev_fps)
    upholding_kinds: set[str] = set()
    for rev in reviews:
        if not isinstance(rev, dict):
            continue
        mfp = str(rev.get("material_fingerprint_at_review") or "")
        efp = rev.get("evidence_fingerprints_at_review")
        if not isinstance(efp, dict):
            continue
        is_stale = mfp != current_content_fp or validate_claims.canonical_json(efp) != ev_json
        if not is_stale and rev.get("recommendation") == "uphold":
            rk = rev.get("reviewer_kind")
            if isinstance(rk, str):
                upholding_kinds.add(rk)

    if "human" in upholding_kinds:
        return "human_reviewed"
    if "independent_agent" in upholding_kinds:
        return "independently_agent_reviewed"
    if "agent" in upholding_kinds:
        return "agent_reviewed"
    return "unreviewed"


def _resolve_target_claim_file(
    claims_dir: Path,
    claims_arg: str,
    slug_arg: str,
    claim_id: str,
) -> Path:
    if claims_arg:
        p = Path(claims_arg).resolve()
        if not p.exists():
            raise SystemExit(f"ERROR: Claim ledger file not found: {p}")
        return p
    if slug_arg:
        p = (claims_dir / f"{slug_arg.strip()}.json").resolve()
        if not p.exists():
            raise SystemExit(f"ERROR: Claim ledger file not found: {p}")
        return p
    for cf in sorted(claims_dir.glob("*.json")):
        d = json.loads(cf.read_text(encoding="utf-8"))
        for clm in d.get("claims", []):
            if isinstance(clm, dict) and clm.get("id") == claim_id:
                return cf.resolve()
    raise SystemExit(f"ERROR: Claim ID '{claim_id}' not found in any file under {claims_dir}")


def _verify_fingerprints_mode(
    root: Path,
    claims_dir: Path,
    ledgers_dir: Path,
    explicit_file: str,
) -> int:
    files = [explicit_file] if explicit_file else None
    res = validate_claims.validate_claims(
        root_dir=root,
        claims_dir=claims_dir,
        ledgers_dir=ledgers_dir,
        files=files,
    )
    if not res["ok"]:
        print(f"REVIEW_AND_FINGERPRINT_CHECK_FAILED ({len(res['errors'])} error(s)):", file=sys.stderr)
        for err in res["errors"]:
            print(f"  - {err}", file=sys.stderr)
        return 1
    st = res["stats"]
    print(
        f"REVIEW_FINGERPRINTS_VERIFIED ({st['claimLedgers']} claim ledger(s), {st['totalClaims']} claims, "
        f"{st['reviews']} review(s), {st['staleReviews']} historical stale review(s))."
    )
    return 0


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(
        description="Record a cryptographically fingerprinted claim review in public/claims/<slug>.json."
    )
    ap.add_argument("--root", type=Path, default=validate_claims.DEFAULT_ROOT, help="Repository root directory")
    ap.add_argument("--claims-dir", type=Path, default=None, help="Override public/claims directory")
    ap.add_argument("--ledgers-dir", type=Path, default=None, help="Override public/ledgers directory")
    ap.add_argument("--claims", default="", help="Path to public/claims/<slug>.json")
    ap.add_argument("--slug", default="", help="Case slug (resolves public/claims/<slug>.json)")
    ap.add_argument("--id", default="", help="Claim ID, e.g. CLM-1100-001")
    ap.add_argument(
        "--status",
        "--level",
        dest="status",
        default="",
        choices=["human_reviewed", "independently_agent_reviewed", "agent_reviewed"],
        help="Target review tier (maps to reviewer_kind: human | independent_agent | agent)",
    )
    ap.add_argument(
        "--reviewer-kind",
        default="",
        choices=sorted(validate_claims.VALID_REVIEWER_KINDS),
        help="Explicit reviewer_kind ('human', 'independent_agent', or 'agent')",
    )
    ap.add_argument("--reviewer", "--reviewer-id", dest="reviewer", default="", help="Full human name (and optional ORCID) or distinct agent auditor ID")
    ap.add_argument("--orcid", default="", help="Optional human reviewer ORCID URL (https://orcid.org/0000-0000-0000-0000)")
    ap.add_argument("--model-version", "--model", dest="model_version", default="", help="Model identifier (required for agent/independent_agent; forbidden on human reviews)")
    ap.add_argument("--date", default=dt.date.today().isoformat(), help="Review date YYYY-MM-DD")
    ap.add_argument(
        "--scopes",
        "--review-scopes",
        dest="scopes",
        action="append",
        default=[],
        help="Comma-separated or repeatable scopes: structural, transcription, archival, baseline, linguistic_argument",
    )
    ap.add_argument(
        "--inspected-refs",
        "--inspected-evidence-refs",
        dest="inspected_refs",
        action="append",
        default=[],
        help="Comma-separated or repeatable CERT-*/CLM-* IDs inspected (defaults to all refs in claim.evidence)",
    )
    ap.add_argument("--findings", "--notes", dest="findings", default="", help="Substantive findings from reviewing the claim and evidence")
    ap.add_argument("--objection", "--objections", dest="objections", action="append", default=[], help="Optional objection string (repeatable)")
    ap.add_argument(
        "--recommendation",
        default="uphold",
        choices=sorted(validate_claims.VALID_RECOMMENDATIONS),
        help="Review recommendation (default: uphold)",
    )
    ap.add_argument("--review-id", default="", help="Optional explicit review_id matching REV-NNNN-NNN-NN")
    ap.add_argument("--expected-fingerprint", default="", help="Optional 64-char SHA-256 content_fingerprint TOCTOU guard")
    ap.add_argument("--print-fingerprint", action="store_true", help="Print live content & evidence fingerprints for --id without mutating")
    ap.add_argument("--verify-fingerprints", action="store_true", help="Verify all claim and review fingerprints without mutating")
    args = ap.parse_args(argv)

    root = Path(args.root).resolve()
    pub_dir = root / "public"
    claims_dir = Path(args.claims_dir).resolve() if args.claims_dir else pub_dir / "claims"
    ledgers_dir = Path(args.ledgers_dir).resolve() if args.ledgers_dir else pub_dir / "ledgers"

    if args.verify_fingerprints:
        return _verify_fingerprints_mode(root, claims_dir, ledgers_dir, args.claims)

    claim_id = args.id.strip()
    if not claim_id:
        raise SystemExit("ERROR: --id CLM-NNNN-NNN is required (or pass --verify-fingerprints).")
    if not validate_claims.CLAIM_ID_RE.match(claim_id):
        raise SystemExit(f"ERROR: Invalid claim ID '{claim_id}' (expected CLM-NNNN-NNN).")

    target_path = _resolve_target_claim_file(claims_dir, args.claims, args.slug, claim_id)
    content_fps, ev_fps = validate_claims.compute_all_fingerprints(
        root_dir=root,
        claims_dir=claims_dir,
        ledgers_dir=ledgers_dir,
        public_dir=pub_dir,
    )

    # If target_path is outside claims_dir, ensure its claims are computed too
    data = json.loads(target_path.read_text(encoding="utf-8"))
    target_claim: dict[str, Any] | None = None
    for clm in data.get("claims", []):
        if isinstance(clm, dict) and clm.get("id") == claim_id:
            target_claim = clm
            break
    if target_claim is None:
        raise SystemExit(f"ERROR: Claim '{claim_id}' not found in {target_path}")

    if claim_id not in content_fps:
        # Compute with target_path explicitly merged
        citation_by_id: dict[str, dict[str, Any]] = {}
        if ledgers_dir.exists():
            for lf in sorted(ledgers_dir.glob("*.json")):
                ld = json.loads(lf.read_text(encoding="utf-8"))
                for c in ld.get("citations", []):
                    if isinstance(c, dict) and isinstance(c.get("id"), str):
                        citation_by_id[c["id"]] = c
        claim_by_id: dict[str, dict[str, Any]] = {}
        if claims_dir.exists():
            for cf in sorted(claims_dir.glob("*.json")):
                cd = json.loads(cf.read_text(encoding="utf-8"))
                for oc in cd.get("claims", []):
                    if isinstance(oc, dict) and isinstance(oc.get("id"), str):
                        claim_by_id[oc["id"]] = oc
        for oc in data.get("claims", []):
            if isinstance(oc, dict) and isinstance(oc.get("id"), str):
                claim_by_id[oc["id"]] = oc
        fp_ctx = validate_claims.FingerprintContext(citation_by_id, claim_by_id, pub_dir)
        live_content_fp = validate_claims.compute_claim_content_fingerprint(target_claim, fp_ctx)
        live_ev_fps = validate_claims.compute_claim_evidence_fingerprints(target_claim, fp_ctx)
    else:
        live_content_fp = content_fps[claim_id]
        live_ev_fps = ev_fps[claim_id]

    if args.print_fingerprint:
        print(
            json.dumps(
                {
                    "claim_id": claim_id,
                    "claim_revision": target_claim.get("revision"),
                    "content_fingerprint": live_content_fp,
                    "evidence_fingerprints": live_ev_fps,
                },
                indent=2,
            )
        )
        return 0

    stored_fp = str(target_claim.get("content_fingerprint") or "")
    if stored_fp != live_content_fp:
        raise SystemExit(
            f"ERROR: Stored content_fingerprint on {claim_id} ({stored_fp[:12]}...) does not match live computed "
            f"digest ({live_content_fp[:12]}...). Run 'python3 scripts/validate_claims.py --stamp-fingerprints {target_path}' before reviewing."
        )

    if args.expected_fingerprint:
        exp_fp = args.expected_fingerprint.strip().lower()
        if exp_fp != live_content_fp:
            raise SystemExit(
                f"ERROR: Expected fingerprint mismatch on {claim_id} (expected {exp_fp}, live is {live_content_fp}). Aborting review."
            )

    # Resolve reviewer_kind & target status
    if args.status and args.reviewer_kind:
        if STATUS_TO_KIND[args.status] != args.reviewer_kind:
            raise SystemExit(
                f"ERROR: Conflicting --status '{args.status}' and --reviewer-kind '{args.reviewer_kind}'."
            )
        reviewer_kind = args.reviewer_kind
    elif args.status:
        reviewer_kind = STATUS_TO_KIND[args.status]
    elif args.reviewer_kind:
        reviewer_kind = args.reviewer_kind
    else:
        raise SystemExit("ERROR: Pass --status {human_reviewed,independently_agent_reviewed,agent_reviewed} (or --reviewer-kind).")

    reviewer_id = args.reviewer.strip()
    if not reviewer_id:
        raise SystemExit("ERROR: --reviewer is required.")
    if args.orcid.strip():
        orcid = args.orcid.strip()
        if not ORCID_RE.match(orcid):
            raise SystemExit(f"ERROR: Invalid --orcid '{orcid}' (expected https://orcid.org/0000-0000-0000-0000).")
        if orcid not in reviewer_id:
            reviewer_id = f"{reviewer_id} ({orcid})"

    if validate_claims.find_workspace_or_drive_leak(reviewer_id):
        raise SystemExit("ERROR: --reviewer contains a forbidden workspace or Drive identifier.")

    model_version: str | None
    if reviewer_kind == "human":
        if args.model_version.strip():
            raise SystemExit("ERROR: --model-version must NOT be set on a human review (model_version must be null).")
        if validate_claims.NON_HUMAN_REVIEWER_RE.search(reviewer_id) or not validate_claims.HUMAN_NAME_RE.search(reviewer_id):
            raise SystemExit(
                f"ERROR: human_reviewed requires a named human person (First Last) in --reviewer, got '{reviewer_id}'."
            )
        model_version = None
    else:
        model_version = args.model_version.strip()
        if not model_version:
            raise SystemExit(f"ERROR: --model-version is required when reviewer_kind='{reviewer_kind}'.")
        if validate_claims.find_workspace_or_drive_leak(model_version):
            raise SystemExit("ERROR: --model-version contains a forbidden workspace or Drive identifier.")
        if reviewer_kind == "independent_agent":
            rev_hist = target_claim.get("revision_history") or []
            last_author = str(rev_hist[-1].get("author") or "").strip() if rev_hist and isinstance(rev_hist[-1], dict) else ""
            if last_author and reviewer_id.lower() == last_author.lower():
                raise SystemExit(
                    f"ERROR: independent_agent reviewer '{reviewer_id}' must be independent of claim author '{last_author}'."
                )

    review_date = args.date.strip()
    if not validate_claims.is_valid_iso_calendar_date(review_date):
        raise SystemExit(f"ERROR: --date '{review_date}' must be a valid ISO calendar date YYYY-MM-DD.")

    findings = args.findings.strip()
    if not findings:
        raise SystemExit("ERROR: --findings (or --notes) must be a non-empty summary of what was verified.")
    if validate_claims.find_workspace_or_drive_leak(findings):
        raise SystemExit("ERROR: --findings contains a forbidden workspace or Drive identifier.")

    objections = [o.strip() for o in args.objections if o.strip()]
    for obj_txt in objections:
        if validate_claims.find_workspace_or_drive_leak(obj_txt):
            raise SystemExit("ERROR: --objection contains a forbidden workspace or Drive identifier.")

    scopes = _parse_csv_or_list(args.scopes)
    if not scopes:
        scopes = _default_scopes_for_type(str(target_claim.get("type") or ""))
    invalid_scopes = [s for s in scopes if s not in validate_claims.VALID_REVIEW_SCOPES]
    if invalid_scopes:
        raise SystemExit(
            f"ERROR: Invalid review scope(s) {invalid_scopes}; valid choices: {sorted(validate_claims.VALID_REVIEW_SCOPES)}"
        )

    claim_ev_refs: list[str] = []
    for edge in target_claim.get("evidence") or []:
        if isinstance(edge, dict) and isinstance(edge.get("ref"), str):
            r = edge["ref"].strip()
            if r and r not in claim_ev_refs:
                claim_ev_refs.append(r)

    inspected_refs = _parse_csv_or_list(args.inspected_refs)
    if not inspected_refs:
        inspected_refs = list(claim_ev_refs)
    else:
        unknown_refs = [r for r in inspected_refs if r not in claim_ev_refs]
        if unknown_refs:
            raise SystemExit(
                f"ERROR: --inspected-refs {unknown_refs} do not appear in {claim_id}.evidence ({claim_ev_refs})."
            )
    if claim_ev_refs and not inspected_refs:
        raise SystemExit(f"ERROR: {claim_id} has linked evidence; inspected_evidence_refs cannot be empty.")

    all_claim_files = sorted(claims_dir.glob("*.json")) if claims_dir.exists() else []
    if target_path not in [p.resolve() for p in all_claim_files]:
        all_claim_files.append(target_path)

    if args.review_id.strip():
        review_id = args.review_id.strip()
        if not validate_claims.REVIEW_ID_RE.match(review_id):
            raise SystemExit(f"ERROR: --review-id '{review_id}' must match REV-NNNN-NNN-NN.")
    else:
        review_id = _allocate_review_id(claim_id, all_claim_files)

    # Strictly construct review object WITHOUT 'is_stale'
    review_record: dict[str, Any] = {
        "review_id": review_id,
        "claim_id": claim_id,
        "claim_revision": int(target_claim.get("revision") or 1),
        "reviewer_id": reviewer_id,
        "reviewer_kind": reviewer_kind,
        "model_version": model_version,
        "review_date": review_date,
        "review_scopes": scopes,
        "inspected_evidence_refs": inspected_refs,
        "findings": findings,
        "objections": objections,
        "material_fingerprint_at_review": live_content_fp,
        "evidence_fingerprints_at_review": dict(sorted(live_ev_fps.items())),
        "recommendation": args.recommendation,
    }

    original_bytes = target_path.read_bytes()
    try:
        reviews_list = list(target_claim.get("reviews") or [])
        reviews_list.append(review_record)
        target_claim["reviews"] = reviews_list
        target_claim["review_status"] = _compute_effective_review_status(
            reviews_list,
            live_content_fp,
            live_ev_fps,
        )
        data["updated_at"] = review_date

        target_path.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")

        val_res = validate_claims.validate_claims(
            root_dir=root,
            claims_dir=claims_dir,
            ledgers_dir=ledgers_dir,
            files=[target_path],
        )
        if not val_res["ok"]:
            target_path.write_bytes(original_bytes)
            print("ERROR: Recorded review failed schema/graph validation; rolled back file:", file=sys.stderr)
            for err in val_res["errors"]:
                print(f"  - {err}", file=sys.stderr)
            return 1
    except Exception:
        target_path.write_bytes(original_bytes)
        raise

    print(
        f"[OK] Recorded {review_id} ({reviewer_kind}, recommendation={args.recommendation}) by '{reviewer_id}' "
        f"on {claim_id} -> review_status='{target_claim['review_status']}' "
        f"(fingerprint={live_content_fp[:12]}...)"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
