"""
Pragmatic zero-dependency Python QA suite for DRAgNEt Claim Architecture (Agent 10).
Covers all 26 invalid fixtures, positive controls, stale-review matrix, date precision,
isolated ingestion/embargo/release SHA-256 checks, and Phase E integration gates.
"""
from __future__ import annotations

import copy
import json
import subprocess
import sys
import tempfile
import unittest
import zipfile
from pathlib import Path

from tests.helpers.sandbox_repo import (
    BASELINE_COUNTS,
    REPO_ROOT,
    IsolatedRepoSandbox,
    build_synthetic_leak_tokens,
    get_forbidden_disk_substrings,
    probe_integration_state,
    sha256_digest,
    vc,
    verify_ledger_revision_continuity,
)


class TestDragnetClaimsQaSuite(unittest.TestCase):
    def test_01_live_validators_and_ocr_harness_pass(self) -> None:
        sub_res = subprocess.run(
            [sys.executable, str(REPO_ROOT / "scripts" / "validate_submission.py")],
            cwd=str(REPO_ROOT),
            capture_output=True,
            text=True,
        )
        self.assertEqual(sub_res.returncode, 0, msg=sub_res.stderr)

        ocr_res = subprocess.run(
            [sys.executable, str(REPO_ROOT / "research-system" / "ocr_phonetic_harness.py"), "--self-test"],
            cwd=str(REPO_ROOT),
            capture_output=True,
            text=True,
        )
        self.assertEqual(ocr_res.returncode, 0, msg=ocr_res.stderr)

        claim_res = vc.validate_claims(root_dir=REPO_ROOT)
        self.assertTrue(claim_res["ok"], msg=str(claim_res["errors"]))
        self.assertGreaterEqual(claim_res["stats"]["claimLedgers"], 4)
        self.assertEqual(claim_res["stats"]["staleReviews"], 0)

    def test_02_all_invalid_fixtures_rejected_by_validate_claims_py(self) -> None:
        inv_dir = REPO_ROOT / "tests" / "fixtures" / "invalid"
        files = sorted(inv_dir.glob("*.json"))
        self.assertEqual(len(files), 26)

        for fpath in files:
            raw_meta = json.loads(fpath.read_text(encoding="utf-8"))["_qa_meta"]
            with IsolatedRepoSandbox(
                case_slugs=("hoodlum", "gimmick", "ballyhoo", "jalopy", "shill-shillaber"),
                copy_existing_claims=bool(raw_meta.get("copy_pilot_claims")),
            ) as sb:
                target_name = raw_meta.get("target_filename", "hoodlum.json")
                sb.write_fixture_json(f"public/claims/{target_name}", fpath)
                res = sb.validate_sandbox_claims()
                self.assertFalse(res["ok"], f"{fpath.name} unexpectedly passed")
                for sub in raw_meta.get("expected_error_substrings", []):
                    self.assertTrue(
                        any(sub in err for err in res["errors"]),
                        f"{fpath.name} missing expected error {sub!r}; got {res['errors']}",
                    )
                if raw_meta.get("stamp_before_validate") and not fpath.name.startswith("02"):
                    self.assertFalse(
                        any("content_fingerprint mismatch" in err for err in res["errors"]),
                        f"{fpath.name} failed on fingerprint mismatch instead of domain rule: {res['errors']}",
                    )

    def test_03_valid_controls_and_stale_review_matrix(self) -> None:
        val_dir = REPO_ROOT / "tests" / "fixtures" / "valid_controls"
        for fpath in sorted(val_dir.glob("*.json")):
            raw_meta = json.loads(fpath.read_text(encoding="utf-8"))["_qa_meta"]
            with IsolatedRepoSandbox(
                case_slugs=("hoodlum", "gimmick", "ballyhoo"),
                copy_existing_claims=bool(raw_meta.get("copy_pilot_claims")),
            ) as sb:
                target_name = raw_meta.get("target_filename", "hoodlum.json")
                sb.write_fixture_json(f"public/claims/{target_name}", fpath)
                res = sb.validate_sandbox_claims()
                self.assertTrue(res["ok"], f"{fpath.name} failed: {res['errors']}")

        # Domain 9 stale-review & sort_order invariance in Python
        with IsolatedRepoSandbox(
            case_slugs=("ballyhoo",),
            copy_existing_claims=True,
            symlink_scans=False,
            copy_scan_slugs=("ballyhoo",),
        ) as sb:
            cpath = sb.root / "public" / "claims" / "ballyhoo.json"
            lpath = sb.root / "public" / "ledgers" / "ballyhoo.json"
            cit_ledger = json.loads(lpath.read_text(encoding="utf-8"))
            hosted_cit = next(c for c in cit_ledger["citations"] if (c.get("scan") or {}).get("hosted_path"))

            cdata = json.loads(cpath.read_text(encoding="utf-8"))
            c8 = next(c for c in cdata["claims"] if c["id"] == "CLM-1800-008")
            if not any(e["ref"] == hosted_cit["id"] for e in c8["evidence"]):
                c8["evidence"].append(
                    {
                        "ref": hosted_cit["id"],
                        "relationship": "contextualizes",
                        "directness": "contextual",
                        "reason": "Hosted scan witness for Python staleness check.",
                        "witness_note": None,
                    }
                )
            cpath.write_text(json.dumps(cdata, indent=2) + "\n", encoding="utf-8")
            sb.stamp_sandbox_claims([cpath])

            cfps, efps = vc.compute_all_fingerprints(root_dir=sb.root)
            cdata = json.loads(cpath.read_text(encoding="utf-8"))
            c8 = next(c for c in cdata["claims"] if c["id"] == "CLM-1800-008")
            c8["review_status"] = "human_reviewed"
            c8["reviews"] = [
                {
                    "review_id": "REV-1800-008-01",
                    "claim_id": "CLM-1800-008",
                    "claim_revision": c8["revision"],
                    "reviewer_id": "Joshua Callahan",
                    "reviewer_kind": "human",
                    "model_version": None,
                    "review_date": "2026-11-26",
                    "review_scopes": ["transcription", "archival"],
                    "inspected_evidence_refs": [e["ref"] for e in c8["evidence"]],
                    "findings": "Verified primary scan and premise chain.",
                    "objections": [],
                    "material_fingerprint_at_review": cfps["CLM-1800-008"],
                    "evidence_fingerprints_at_review": efps["CLM-1800-008"],
                    "recommendation": "uphold",
                }
            ]
            clean_claims_txt = json.dumps(cdata, indent=2) + "\n"
            clean_led_txt = lpath.read_text(encoding="utf-8")
            scan_file = sb.root / "public" / hosted_cit["scan"]["hosted_path"].lstrip("/")
            clean_scan_bytes = scan_file.read_bytes()

            # sort_order change stays valid and non-stale
            d_sort = copy.deepcopy(cdata)
            next(c for c in d_sort["claims"] if c["id"] == "CLM-1800-008")["sort_order"] = 777
            cpath.write_text(json.dumps(d_sort, indent=2) + "\n", encoding="utf-8")
            res_sort = sb.validate_sandbox_claims()
            self.assertTrue(res_sort["ok"], msg=str(res_sort["errors"]))
            self.assertEqual(res_sort["stats"]["staleReviews"], 0)

            # Scan byte edit invalidates active human_reviewed while preserving reviews[]
            cpath.write_text(clean_claims_txt, encoding="utf-8")
            scan_file.write_bytes(clean_scan_bytes + b"TAMPER")
            sb.stamp_sandbox_claims([cpath])
            res_scan = sb.validate_sandbox_claims()
            self.assertFalse(res_scan["ok"])
            self.assertEqual(res_scan["stats"]["staleReviews"], 1)

            # 2-hop upstream depends_on edit invalidates active review
            scan_file.write_bytes(clean_scan_bytes)
            lpath.write_text(clean_led_txt, encoding="utf-8")
            d_up = json.loads(clean_claims_txt)
            next(c for c in d_up["claims"] if c["id"] == "CLM-1800-006")["statement"] += " [Edited premise]"
            cpath.write_text(json.dumps(d_up, indent=2) + "\n", encoding="utf-8")
            sb.stamp_sandbox_claims([cpath])
            res_up = sb.validate_sandbox_claims()
            self.assertFalse(res_up["ok"])
            self.assertEqual(res_up["stats"]["staleReviews"], 1)

    def test_04_date_precision_continuity_and_leak_safeguards(self) -> None:
        yr_adv = vc.compute_chronological_advance("1866-12-14", "day", "1872", "year")
        self.assertEqual(yr_adv["effective_precision"], "year")
        self.assertEqual(yr_adv["canonical_display"], "6 calendar years")

        mo_adv = vc.compute_chronological_advance("1866-12-14", "day", "1877-08", "month")
        self.assertEqual(mo_adv["effective_precision"], "month")
        self.assertNotIn("day", mo_adv["canonical_display"])

        for sample in build_synthetic_leak_tokens().values():
            self.assertIsNotNone(vc.find_workspace_or_drive_leak(f"Note: {sample}"))

        prev = json.loads((REPO_ROOT / "public" / "claims" / "ballyhoo.json").read_text(encoding="utf-8"))
        bad = copy.deepcopy(prev)
        bad["claims"].pop()
        ok_cont, errs_cont = verify_ledger_revision_continuity(prev, bad)
        self.assertFalse(ok_cont)
        self.assertTrue(any("deleted" in e for e in errs_cont))

        forbidden = get_forbidden_disk_substrings()
        for p in (REPO_ROOT / "tests").rglob("*"):
            if p.is_file() and "__pycache__" not in p.parts:
                txt = p.read_text(encoding="utf-8", errors="ignore")
                for bad_tok in forbidden:
                    self.assertNotIn(bad_tok, txt, f"Forbidden literal token in {p}")

    def test_05_isolated_ingestion_embargo_and_release_packaging(self) -> None:
        with IsolatedRepoSandbox(case_slugs=("hoodlum",), copy_existing_claims=False) as sb:
            emb = sb.run_py(
                "scripts/add_case.py",
                ["--site-root", str(sb.root), "--slug", "shindig", "--target-id", "TGT-019", "--status", "under_review"],
            )
            self.assertEqual(emb.returncode, 0, msg=emb.stderr)
            self.assertFalse((sb.root / "public" / "ledgers" / "shindig.json").exists())
            self.assertFalse((sb.root / "public" / "claims" / "shindig.json").exists())

            cit_inv = REPO_ROOT / "tests" / "fixtures" / "citation_invalid" / "19_post_1930_uncleared_scan_citation_ledger.json"
            sb.write_fixture_json("public/ledgers/hoodlum.json", cit_inv)
            bad_sub = sb.run_py("scripts/validate_submission.py")
            self.assertNotEqual(bad_sub.returncode, 0)
            self.assertIn("1948", bad_sub.stderr)

        with tempfile.TemporaryDirectory(prefix="dragnet_rel_qa_") as out_tmp:
            out_dir = Path(out_tmp)
            pkg = subprocess.run(
                [sys.executable, str(REPO_ROOT / "scripts" / "package_release_assets.py"), "--tag", "v3.4.0-qa", "--out-dir", str(out_dir)],
                cwd=str(REPO_ROOT),
                capture_output=True,
                text=True,
            )
            self.assertEqual(pkg.returncode, 0, msg=pkg.stderr)
            sums = (out_dir / "SHA256SUMS.txt").read_text(encoding="utf-8").strip().splitlines()
            self.assertGreaterEqual(len(sums), 20)
            for line in sums:
                digest, rel = line.split("  ", 1)
                target = (out_dir / rel) if (out_dir / rel).exists() else ((out_dir / Path(rel).name) if (out_dir / Path(rel).name).exists() else (REPO_ROOT / "public" / rel))
                if not target.exists():
                    target = REPO_ROOT / rel
                self.assertEqual(sha256_digest(target), digest)

    def test_06_phase_e_full_18_cases_and_claim_review_cli_gate(self) -> None:
        state = probe_integration_state(REPO_ROOT)
        if not (state["has_all_18_claim_ledgers"] and state["has_claim_review_cli"] and state["has_claim_aware_packager"]):
            self.skipTest(
                f"Pending Phase E full merge (claims={state['claim_file_count']}/18, review_cli={state['has_claim_review_cli']}, packager={state['has_claim_aware_packager']})"
            )

        all_res = vc.validate_claims(root_dir=REPO_ROOT, require_all_cases=True)
        self.assertTrue(all_res["ok"], msg=str(all_res["errors"]))
        self.assertEqual(all_res["stats"]["claimLedgers"], BASELINE_COUNTS["cases"])

        with tempfile.TemporaryDirectory(prefix="dragnet_rel_e_") as out_tmp:
            out_dir = Path(out_tmp)
            subprocess.run(
                [sys.executable, str(REPO_ROOT / "scripts" / "package_release_assets.py"), "--tag", "v3.4.0-e", "--out-dir", str(out_dir)],
                cwd=str(REPO_ROOT),
                check=True,
                capture_output=True,
                text=True,
            )
            zpath = next(out_dir.glob("*.zip"))
            with zipfile.ZipFile(zpath, "r") as zf:
                names = zf.namelist()
                self.assertTrue(any("claims/ballyhoo.json" in n for n in names), "Release ZIP missing claims/*.json")


if __name__ == "__main__":
    unittest.main()
