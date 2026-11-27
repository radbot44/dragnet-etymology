"""
Zero-dependency Python QA helpers, revision-continuity auditor, and isolated
repository sandbox builder for Agent 10.
"""
from __future__ import annotations

import hashlib
import json
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path
from typing import Any, Sequence

REPO_ROOT = Path(__file__).resolve().parents[2]
if str(REPO_ROOT / "scripts") not in sys.path:
    sys.path.insert(0, str(REPO_ROOT / "scripts"))

import validate_claims as vc  # noqa: E402

BASELINE_COUNTS = {
    "cases": 18,
    "ledgers": 18,
    "citations": 1215,
    "attestations": 599,
    "hypotheses": 183,
    "contextual_evidence": 166,
    "rejected_leads": 267,
    "hosted_scans": 1066,
    "static_html_pages": 1240,
    "open_question_targets": 160,
}

EXPECTED_CASE_SLUGS = (
    "ballyhoo",
    "gimmick",
    "grifter",
    "hobo",
    "hokum",
    "hoodlum",
    "jalopy",
    "jamboree",
    "jinx",
    "malarkey",
    "moolah",
    "phoney",
    "shenanigans",
    "shill-shillaber",
    "skedaddle",
    "skulduggery",
    "whole-shebang",
    "yegg",
)


def build_synthetic_leak_tokens() -> dict[str, str]:
    """Assemble forbidden workspace/cloud tokens at runtime without literal strings in source."""
    g_host = ".".join(("drive", "google", "com"))
    d_host = ".".join(("docs", "google", "com"))
    g_scheme = "".join(("googledrive", "://"))
    wk_prefix = "/" + "_".join(("working", "dir")) + "/synthetic_qa_probe/file.json"
    hex_session = "c_" + "9f8e7d6c5b4a3210"
    raw_drive_id = "1" + "QaSyntheticDriveIdToken9876543210AbCd"
    return {
        "cloud_drive_url": f"https://{g_host}/file/d/1SyntheticQaToken999/view",
        "cloud_docs_url": f"https://{d_host}/document/d/1SyntheticQaDoc999/edit",
        "cloud_scheme_uri": f"{g_scheme}synthetic_folder_999/scan.png",
        "sandbox_path": wk_prefix,
        "session_hex_id": hex_session,
        "raw_drive_id": raw_drive_id,
    }


def get_forbidden_disk_substrings() -> tuple[str, ...]:
    synth = build_synthetic_leak_tokens()
    return (
        ".".join(("drive", "google", "com")),
        ".".join(("docs", "google", "com")),
        "".join(("googledrive", "://")),
        "/" + "_".join(("working", "dir")) + "/",
        "/" + "/".join(("home", "spark")) + "/",
        synth["session_hex_id"],
        synth["raw_drive_id"],
    )


def hydrate_fixture_placeholders(raw_text: str) -> str:
    tokens = build_synthetic_leak_tokens()
    return (
        raw_text.replace("__QA_SYNTHETIC_CLOUD_DRIVE_URL__", tokens["cloud_drive_url"])
        .replace("__QA_SYNTHETIC_CLOUD_DOCS_URL__", tokens["cloud_docs_url"])
        .replace("__QA_SYNTHETIC_CLOUD_SCHEME_URI__", tokens["cloud_scheme_uri"])
        .replace("__QA_SYNTHETIC_SANDBOX_PATH__", tokens["sandbox_path"])
        .replace("__QA_SYNTHETIC_SESSION_HEX_ID__", tokens["session_hex_id"])
        .replace("__QA_SYNTHETIC_RAW_DRIVE_ID__", tokens["raw_drive_id"])
    )


def sha256_digest(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as fh:
        for chunk in iter(lambda: fh.read(65536), b""):
            h.update(chunk)
    return h.hexdigest()


def probe_integration_state(root_dir: Path = REPO_ROOT) -> dict[str, Any]:
    claims_dir = root_dir / "public" / "claims"
    claim_files = sorted(f.name for f in claims_dir.glob("*.json")) if claims_dir.exists() else []
    packager_txt = (root_dir / "scripts" / "package_release_assets.py").read_text(encoding="utf-8")
    add_case_txt = (root_dir / "scripts" / "add_case.py").read_text(encoding="utf-8")
    site_val_txt = (root_dir / "scripts" / "validate_submission.py").read_text(encoding="utf-8")

    return {
        "claim_files": claim_files,
        "claim_file_count": len(claim_files),
        "has_all_18_claim_ledgers": len(claim_files) == BASELINE_COUNTS["cases"],
        "has_claim_review_cli": (root_dir / "scripts" / "record_claim_review.py").is_file(),
        "has_claim_aware_packager": ("public/claims" in packager_txt or '"claims"' in packager_txt or "'claims'" in packager_txt),
        "has_claim_aware_ingester": ("validate_claims" in add_case_txt or '"claims"' in add_case_txt),
        "has_submission_gate_wired": ("validate_claims" in site_val_txt),
    }


def verify_ledger_revision_continuity(prev_ledger: dict[str, Any], next_ledger: dict[str, Any]) -> tuple[bool, list[str]]:
    errors: list[str] = []
    doc_types = {"attestation", "antedating", "negative_evidence", "source_relationship"}
    next_by_id = {c["id"]: c for c in next_ledger.get("claims", []) if isinstance(c, dict) and "id" in c}

    for prev in prev_ledger.get("claims", []):
        cid = prev["id"]
        nxt = next_by_id.get(cid)
        if nxt is None:
            errors.append(f"Permanent claim ID '{cid}' was deleted instead of marked superseded or withdrawn")
            continue

        prev_hist = prev.get("revision_history", [])
        next_hist = nxt.get("revision_history", [])
        if len(next_hist) < len(prev_hist):
            errors.append(f"{cid}: revision_history truncated ({len(prev_hist)} -> {len(next_hist)})")
        else:
            for idx, ph in enumerate(prev_hist):
                nh = next_hist[idx]
                if ph.get("revision") != nh.get("revision") or ph.get("content_fingerprint") != nh.get("content_fingerprint"):
                    errors.append(f"{cid}: historical revision_history[{idx}] mutated or overwritten")

        prev_revs = prev.get("reviews", [])
        next_revs = nxt.get("reviews", [])
        if len(next_revs) < len(prev_revs):
            errors.append(f"{cid}: historical reviews[] truncated ({len(prev_revs)} -> {len(next_revs)})")
        else:
            for idx, pr in enumerate(prev_revs):
                nr = next_revs[idx]
                if pr.get("review_id") != nr.get("review_id") or pr.get("material_fingerprint_at_review") != nr.get("material_fingerprint_at_review"):
                    errors.append(f"{cid}: historical reviews[{idx}] ('{pr.get('review_id')}') was overwritten or altered")

        if nxt.get("lifecycle_status") == "active":
            prev_doc = prev.get("type") in doc_types
            next_doc = nxt.get("type") in doc_types
            prev_refs = {e.get("ref") for e in prev.get("evidence", []) if isinstance(e, dict)}
            next_refs = {e.get("ref") for e in nxt.get("evidence", []) if isinstance(e, dict)}
            if prev_doc != next_doc and prev_refs and not (prev_refs & next_refs):
                errors.append(
                    f"{cid}: Active claim ID recycled across epistemic boundary ({prev.get('type')} -> {nxt.get('type')}) with zero shared evidence"
                )

    return len(errors) == 0, errors


class IsolatedRepoSandbox:
    """Context manager creating an isolated temporary DRAgNEt repository tree."""

    def __init__(
        self,
        case_slugs: Sequence[str] = ("hoodlum", "gimmick", "ballyhoo"),
        copy_existing_claims: bool = False,
        symlink_scans: bool = True,
        copy_scan_slugs: Sequence[str] = (),
        copy_scripts: bool = True,
    ) -> None:
        self.case_slugs = tuple(case_slugs)
        self.copy_existing_claims = copy_existing_claims
        self.symlink_scans = symlink_scans
        self.copy_scan_slugs = tuple(copy_scan_slugs)
        self.copy_scripts = copy_scripts
        self._tmp: tempfile.TemporaryDirectory[str] | None = None
        self.root: Path = Path()

    def __enter__(self) -> "IsolatedRepoSandbox":
        self._tmp = tempfile.TemporaryDirectory(prefix="dragnet_py_qa_")
        self.root = Path(self._tmp.name).resolve()

        (self.root / "src" / "content" / "cases").mkdir(parents=True, exist_ok=True)
        (self.root / "public" / "ledgers").mkdir(parents=True, exist_ok=True)
        (self.root / "public" / "claims").mkdir(parents=True, exist_ok=True)
        (self.root / "public" / "data").mkdir(parents=True, exist_ok=True)
        (self.root / "research-system").mkdir(parents=True, exist_ok=True)

        for slug in self.case_slugs:
            src_case = REPO_ROOT / "src" / "content" / "cases" / f"{slug}.md"
            src_led = REPO_ROOT / "public" / "ledgers" / f"{slug}.json"
            src_clm = REPO_ROOT / "public" / "claims" / f"{slug}.json"
            if src_case.exists():
                shutil.copy2(src_case, self.root / "src" / "content" / "cases" / f"{slug}.md")
            if src_led.exists():
                shutil.copy2(src_led, self.root / "public" / "ledgers" / f"{slug}.json")
            if self.copy_existing_claims and src_clm.exists():
                shutil.copy2(src_clm, self.root / "public" / "claims" / f"{slug}.json")

        open_q = REPO_ROOT / "public" / "data" / "open-questions.json"
        if open_q.exists():
            shutil.copy2(open_q, self.root / "public" / "data" / "open-questions.json")

        for meta in ("package.json", "CITATION.cff", "LICENSE", "CHANGELOG_CORRECTIONS.md", "astro.config.mjs"):
            src_meta = REPO_ROOT / meta
            if src_meta.exists():
                shutil.copy2(src_meta, self.root / meta)

        if self.copy_scan_slugs:
            (self.root / "public" / "scans").mkdir(parents=True, exist_ok=True)
            for s_slug in self.copy_scan_slugs:
                s_src = REPO_ROOT / "public" / "scans" / s_slug
                if s_src.exists():
                    shutil.copytree(s_src, self.root / "public" / "scans" / s_slug)
        elif self.symlink_scans and (REPO_ROOT / "public" / "scans").exists():
            os.symlink(REPO_ROOT / "public" / "scans", self.root / "public" / "scans", target_is_directory=True)
        else:
            (self.root / "public" / "scans").mkdir(parents=True, exist_ok=True)

        for sym_dir in ("schemas", "docs"):
            if (REPO_ROOT / sym_dir).exists():
                os.symlink(REPO_ROOT / sym_dir, self.root / sym_dir, target_is_directory=True)

        if self.copy_scripts:
            scripts_dst = self.root / "scripts"
            scripts_dst.mkdir(parents=True, exist_ok=True)
            for p in (REPO_ROOT / "scripts").iterdir():
                if p.is_file():
                    shutil.copy2(p, scripts_dst / p.name)

        return self

    def write_fixture_json(
        self,
        rel_target: str,
        fixture_path: Path,
        auto_stamp: bool = False,
    ) -> tuple[Path, dict[str, Any]]:
        hydrated = hydrate_fixture_placeholders(fixture_path.read_text(encoding="utf-8"))
        data: dict[str, Any] = json.loads(hydrated)
        meta: dict[str, Any] = data.pop("_qa_meta", {})
        dest = self.root / rel_target
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")

        if auto_stamp or meta.get("stamp_before_validate") is True:
            vc.stamp_claim_ledger_fingerprints(
                [dest],
                root_dir=self.root,
                claims_dir=self.root / "public" / "claims",
                ledgers_dir=self.root / "public" / "ledgers",
                public_dir=self.root / "public",
            )
        return dest, meta

    def validate_sandbox_claims(self, **kwargs: Any) -> dict[str, Any]:
        return vc.validate_claims(
            root_dir=self.root,
            claims_dir=self.root / "public" / "claims",
            ledgers_dir=self.root / "public" / "ledgers",
            cases_dir=self.root / "src" / "content" / "cases",
            public_dir=self.root / "public",
            open_questions_path=self.root / "public" / "data" / "open-questions.json",
            **kwargs,
        )

    def stamp_sandbox_claims(self, targets: Sequence[Path] | None = None) -> dict[str, int]:
        t_list = list(targets) if targets is not None else [self.root / "public" / "claims"]
        return vc.stamp_claim_ledger_fingerprints(
            t_list,
            root_dir=self.root,
            claims_dir=self.root / "public" / "claims",
            ledgers_dir=self.root / "public" / "ledgers",
            public_dir=self.root / "public",
        )

    def run_py(self, rel_script: str, args: Sequence[str] = ()) -> subprocess.CompletedProcess[str]:
        script_path = (self.root / rel_script) if (self.root / rel_script).exists() else (REPO_ROOT / rel_script)
        env = dict(os.environ, PYTHONDONTWRITEBYTECODE="1")
        return subprocess.run(
            [sys.executable, str(script_path), *args],
            cwd=str(self.root),
            capture_output=True,
            text=True,
            env=env,
        )

    def __exit__(self, exc_type: Any, exc_val: Any, exc_tb: Any) -> None:
        if self._tmp is not None:
            self._tmp.cleanup()
