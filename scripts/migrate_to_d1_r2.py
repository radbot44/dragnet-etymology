#!/usr/bin/env python3
"""One-Shot DRAgNEt Migration Script: Repo + Optional Queue JSON -> Cloudflare D1 & R2.

Drop into: scripts/migrate_to_d1_r2.py inside radbot44/dragnet-etymology

What it does:
  1. Reads `public/data/open-questions.json` and all `public/ledgers/*.json` in the repo
     (plus optional `--queue-json` if importing `08_daily_dragnet_queue.json`).
  2. Computes consonant skeletons and dirty-OCR regexes via `research-system/ocr_phonetic_harness.py`.
  3. Writes deterministic, idempotent SQL to `worker/migrations/0002_seed_existing_corpus.sql`
     (seeding `pipeline_meta`, all 160 `targets`, and all existing published `citations`).
  4. Scans `public/scans/**/*.webp`, computes SHA-256 + byte sizes, updates
     `public/data/r2-scan-manifest.json`, and generates `worker/migrations/upload_r2_scans.sh`.
  5. With `--verify-sqlite`, executes `worker/schema.sql` + the generated seed SQL against
     an in-memory Python `sqlite3` database to prove zero syntax or constraint errors.
  6. With `--execute`, runs `npx wrangler d1 execute` (`--remote`) and uploads all WebP scans
     to the `dragnet-scans` R2 bucket so `public/scans/` can be removed from Git cleanly.

Usage:
  python3 scripts/migrate_to_d1_r2.py --verify-sqlite
  python3 scripts/migrate_to_d1_r2.py --execute --d1-name dragnet-db --r2-bucket dragnet-scans
"""

from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
import re
import shlex
import sqlite3
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

REPO_ROOT = Path(__file__).resolve().parent.parent

# Canonical Wave 9 & Embargo overrides (so migration is 100% accurate even without Drive files)
DEFAULT_STAGE_B_READY: Dict[str, Tuple[int, str]] = {
    "TGT-106": (2500, "jamboree"),
    "TGT-002": (2600, "skedaddle"),
    "TGT-014": (2700, "malarkey"),
    "TGT-107": (2800, "jinx"),
    "TGT-161": (2900, "newport-news"),
}
DEFAULT_EMBARGOED: Dict[str, str] = {
    "TGT-019": "shindy",  # Notes and Queries NQ-2026-320 embargo
}
TIER_A_SEEDED = {"TGT-029"}
TIER_B_SEEDED = {
    "TGT-004", "TGT-005", "TGT-008", "TGT-020", "TGT-022",
    "TGT-024", "TGT-025", "TGT-026", "TGT-032", "TGT-034",
}
WAVE1_3_HYPOTHESIS = {"TGT-003", "TGT-007", "TGT-010", "TGT-013", "TGT-018", "TGT-037"}
WAVE1_3_OPEN = {"TGT-006", "TGT-009", "TGT-012", "TGT-016", "TGT-017", "TGT-021", "TGT-023"}


def load_harness(repo_root: Path):
    harness_path = repo_root / "research-system" / "ocr_phonetic_harness.py"
    if not harness_path.exists():
        return None
    spec = importlib.util.spec_from_file_location("ocr_phonetic_harness", harness_path)
    if not spec or not spec.loader:
        return None
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def slugify(headword: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", headword.lower().strip()).strip("-")


def sql_lit(val: Any) -> str:
    if val is None:
        return "NULL"
    if isinstance(val, bool):
        return "1" if val else "0"
    if isinstance(val, (int, float)):
        return str(val)
    text = str(val).replace("'", "''")
    return f"'{text}'"


def now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def build_migration(
    repo_root: Path,
    queue_json_path: Optional[Path] = None,
) -> Tuple[str, Dict[str, Dict[str, Any]], List[Tuple[Path, str]]]:
    open_q_path = repo_root / "public" / "data" / "open-questions.json"
    if not open_q_path.exists():
        raise FileNotFoundError(f"Missing {open_q_path}")

    open_q = json.loads(open_q_path.read_text(encoding="utf-8"))
    raw_targets: List[Dict[str, Any]] = open_q["targets"]

    if not any(str(t.get("target_id")) == "TGT-161" for t in raw_targets):
        raw_targets = list(raw_targets) + [{
            "target_id": "TGT-161",
            "headword": "Newport News",
            "category": "toponym_and_place_name",
            "baseline_year": 1619,
            "baseline_summary": "11 Nov. 1619 Virginia Company records ('Newportes Newes', Kingsbury III:227)",
            "open_question": "Christopher Newport possessive vs. Newce/Ness folk hypotheses",
            "status": "under_investigation",
            "case_slug": "newport-news",
        }]

    harness = load_harness(repo_root)

    # Load all published ledgers in public/ledgers/*.json
    ledgers_dir = repo_root / "public" / "ledgers"
    ledgers_by_target: Dict[str, Dict[str, Any]] = {}
    all_ledgers: List[Dict[str, Any]] = []
    for lf in sorted(ledgers_dir.glob("*.json")):
        ldata = json.loads(lf.read_text(encoding="utf-8"))
        all_ledgers.append(ldata)
        if ldata.get("target_id"):
            ledgers_by_target[str(ldata["target_id"])] = ldata

    # Optional enrichment from 08_daily_dragnet_queue.json if supplied
    queue_overrides: Dict[str, Dict[str, Any]] = {}
    next_open_block = 3000
    if queue_json_path and queue_json_path.exists():
        qdoc = json.loads(queue_json_path.read_text(encoding="utf-8"))
        next_open_block = int(qdoc.get("next_open_block", 3000))
        for item in qdoc.get("queue", []):
            queue_overrides[item["target_id"]] = item

    ts = now_iso()
    target_records: List[Dict[str, Any]] = []

    for t in raw_targets:
        tid = str(t["target_id"])
        hw = str(t["headword"])
        q_item = queue_overrides.get(tid)
        pub_ledger = ledgers_by_target.get(tid)

        if pub_ledger or t.get("status") == "published_case":
            status = "LIVE_ON_DRAGNET"
            slug = str((pub_ledger or {}).get("ledger_id") or t.get("case_slug") or slugify(hw))
            case_num_str = str((pub_ledger or {}).get("case_number", ""))
            m_blk = re.search(r"(\d{3,4})", case_num_str)
            assigned_block = int(m_blk.group(1)) if m_blk else None
            band = "PUBLISHED"
            sort_tuple = (90, int(tid.split("-")[1]))
        elif tid in DEFAULT_STAGE_B_READY:
            assigned_block, slug = DEFAULT_STAGE_B_READY[tid]
            status = "STAGE_B_PACK_READY"
            band = "STAGE_B_PACK_READY"
            sort_tuple = (88, int(tid.split("-")[1]))
        elif tid in DEFAULT_EMBARGOED or t.get("status") == "under_review":
            assigned_block = None
            slug = DEFAULT_EMBARGOED.get(tid, slugify(hw))
            status = "EMBARGOED_UNDER_REVIEW"
            band = "EMBARGOED"
            sort_tuple = (89, int(tid.split("-")[1]))
        else:
            assigned_block = None
            status = "QUEUED"
            slug = str(q_item["slug"]) if q_item else slugify(hw)
            if q_item:
                band = str(q_item["priority_band"])
                sort_tuple = (0, int(q_item["queue_rank"]))
            elif tid in TIER_A_SEEDED:
                band = "BAND_1_TIER_A_SEEDED"
                sort_tuple = (1, int(tid.split("-")[1]))
            elif tid in TIER_B_SEEDED:
                band = "BAND_2_TIER_B_SEEDED"
                sort_tuple = (2, int(tid.split("-")[1]))
            elif tid in WAVE1_3_HYPOTHESIS:
                band = "BAND_3_WAVE1_3_HYPOTHESIS"
                sort_tuple = (3, int(tid.split("-")[1]))
            elif tid in WAVE1_3_OPEN:
                band = "BAND_4_WAVE1_3_OPEN"
                sort_tuple = (4, int(tid.split("-")[1]))
            else:
                band = "BAND_5_BACKLOG"
                sort_tuple = (5, int(tid.split("-")[1]))

        skel = harness.consonant_skeleton(hw) if harness else ""
        ocr_rx = harness.compile_dirty_ocr_regex(hw).pattern if harness else ""
        variants = (
            sorted(set(harness.generate_ocr_variants(hw, cap=25) + harness.generate_phonetic_variants(hw, cap=25)))
            if harness
            else [hw.lower()]
        )

        target_records.append(
            {
                "_sort": sort_tuple,
                "target_id": tid,
                "priority_band": band,
                "headword": hw,
                "slug": slug,
                "category": str(t.get("category", "vernacular_slang")),
                "etymology_status": str((q_item or {}).get("etymology_status") or "origin_unknown"),
                "baseline_year": int(t.get("baseline_year", 1900)),
                "baseline_region": str((q_item or {}).get("baseline_region") or ""),
                "baseline_summary": str(t.get("baseline_summary", "")),
                "open_question": str(t.get("open_question", "")),
                "prior_audit_context": str((q_item or {}).get("prior_audit_context") or ""),
                "consonant_skeleton": skel,
                "dirty_ocr_regex": ocr_rx,
                "search_variants_json": json.dumps(variants, ensure_ascii=False),
                "status": status,
                "assigned_block": assigned_block,
            }
        )

    target_records.sort(key=lambda r: r["_sort"])

    # Scan public/scans/**/*.webp and build manifest
    scans_dir = repo_root / "public" / "scans"
    manifest_path = repo_root / "public" / "data" / "r2-scan-manifest.json"
    manifest: Dict[str, Dict[str, Any]] = {}
    if manifest_path.exists():
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))

    r2_uploads: List[Tuple[Path, str]] = []
    if scans_dir.exists():
        for webp in sorted(scans_dir.rglob("*.webp")):
            rel = "/" + webp.relative_to(repo_root / "public").as_posix()
            r2_key = rel.lstrip("/")
            raw_bytes = webp.read_bytes()
            digest = hashlib.sha256(raw_bytes).hexdigest()
            manifest[rel] = {"bytes": len(raw_bytes), "sha256": digest}
            r2_uploads.append((webp, r2_key))

    sql_lines: List[str] = [
        "-- Auto-generated by scripts/migrate_to_d1_r2.py",
        f"-- Generated at: {ts}",
        "",
        f"INSERT OR REPLACE INTO pipeline_meta (key, value, updated_at) VALUES ('next_open_block', {sql_lit(str(next_open_block))}, {sql_lit(ts)});",
        "",
    ]

    queued_rank = 0
    non_queued_rank = 1000
    for rec in target_records:
        if rec["status"] == "QUEUED":
            queued_rank += 1
            rank = queued_rank
        else:
            non_queued_rank += 1
            rank = non_queued_rank

        sql_lines.append(
            "INSERT OR REPLACE INTO targets ("
            "target_id, queue_rank, priority_band, headword, slug, category, etymology_status, "
            "baseline_year, baseline_region, baseline_summary, open_question, prior_audit_context, "
            "consonant_skeleton, dirty_ocr_regex, search_variants_json, status, assigned_block, updated_at"
            ") VALUES ("
            f"{sql_lit(rec['target_id'])}, {rank}, {sql_lit(rec['priority_band'])}, "
            f"{sql_lit(rec['headword'])}, {sql_lit(rec['slug'])}, {sql_lit(rec['category'])}, "
            f"{sql_lit(rec['etymology_status'])}, {rec['baseline_year']}, {sql_lit(rec['baseline_region'])}, "
            f"{sql_lit(rec['baseline_summary'])}, {sql_lit(rec['open_question'])}, {sql_lit(rec['prior_audit_context'])}, "
            f"{sql_lit(rec['consonant_skeleton'])}, {sql_lit(rec['dirty_ocr_regex'])}, "
            f"{sql_lit(rec['search_variants_json'])}, {sql_lit(rec['status'])}, "
            f"{sql_lit(rec['assigned_block'])}, {sql_lit(ts)}"
            ");"
        )

    sql_lines.append("")
    for ldata in all_ledgers:
        tid = str(ldata["target_id"])
        case_slug = str(ldata["ledger_id"])
        for c in ldata.get("citations", []):
            hosted = (c.get("scan") or {}).get("hosted_path")
            m_info = manifest.get(hosted) if hosted else None
            scan_bytes = m_info["bytes"] if m_info else None
            scan_sha = m_info["sha256"] if m_info else None
            sql_lines.append(
                "INSERT OR REPLACE INTO citations ("
                "id, target_id, case_slug, run_id, headword, attested_form, record_type, record_subtype, "
                "verification_level, publication_year, sort_date, source_url, masthead_date_verified, "
                "scan_hosted_path, scan_bytes, scan_sha256, record_json, updated_at"
                ") VALUES ("
                f"{sql_lit(c['id'])}, {sql_lit(tid)}, {sql_lit(case_slug)}, NULL, "
                f"{sql_lit(c.get('headword', ''))}, {sql_lit(c.get('attested_form', ''))}, "
                f"{sql_lit(c['record_type'])}, {sql_lit(c.get('record_subtype'))}, "
                f"{sql_lit(c['verification_level'])}, {sql_lit(c.get('publication_year'))}, "
                f"{sql_lit(c.get('sort_date', '9999-99-99'))}, {sql_lit(c.get('source_url', ''))}, "
                f"{sql_lit(bool(c.get('masthead_date_verified')))}, {sql_lit(hosted)}, "
                f"{sql_lit(scan_bytes)}, {sql_lit(scan_sha)}, "
                f"{sql_lit(json.dumps(c, ensure_ascii=False))}, {sql_lit(ts)}"
                ");"
            )

    return "\n".join(sql_lines) + "\n", manifest, r2_uploads



def patch_validate_site_for_r2(repo_root: Path) -> bool:
    """Non-destructively add r2-scan-manifest.json fallback to scripts/validate-site.mjs."""
    val_path = repo_root / "scripts" / "validate-site.mjs"
    if not val_path.exists():
        return False
    txt = val_path.read_text(encoding="utf-8")
    if "r2-scan-manifest.json" in txt:
        return False
    anchor = "  const publicDir = path.join(rootDir, 'public');"
    old_block = """        const diskPath = path.join(publicDir, String(hosted).replace(/^\\/+/, ''));
        if (!fs.existsSync(diskPath)) {
          errors.push(`${lf} [${cid}]: Missing hosted scan file '${hosted}'`);
        } else {
          const sz = fs.statSync(diskPath).size;
          if (sz > MAX_IMAGE_BYTES) {
            errors.push(`${lf} [${cid}]: Hosted scan '${hosted}' exceeds 5 MB (${sz} bytes)`);
          }
          totalHostedScans += 1;
        }"""
    new_anchor = anchor + """
  const r2ManifestPath = path.join(publicDir, 'data', 'r2-scan-manifest.json');
  const r2Manifest = fs.existsSync(r2ManifestPath)
    ? JSON.parse(fs.readFileSync(r2ManifestPath, 'utf-8'))
    : {};"""
    new_block = """        const diskPath = path.join(publicDir, String(hosted).replace(/^\\/+/, ''));
        const r2Entry = r2Manifest[hosted];
        if (fs.existsSync(diskPath)) {
          const sz = fs.statSync(diskPath).size;
          if (sz > MAX_IMAGE_BYTES) {
            errors.push(`${lf} [${cid}]: Hosted scan '${hosted}' exceeds 5 MB (${sz} bytes)`);
          }
          totalHostedScans += 1;
        } else if (r2Entry && typeof r2Entry.bytes === 'number') {
          if (r2Entry.bytes > MAX_IMAGE_BYTES) {
            errors.push(`${lf} [${cid}]: R2-hosted scan '${hosted}' exceeds 5 MB (${r2Entry.bytes} bytes)`);
          }
          totalHostedScans += 1;
        } else {
          errors.push(`${lf} [${cid}]: Missing hosted scan file '${hosted}' (not in public/scans/ or r2-scan-manifest.json)`);
        }"""
    if anchor in txt and old_block in txt:
        txt = txt.replace(anchor, new_anchor, 1).replace(old_block, new_block, 1)
        val_path.write_text(txt, encoding="utf-8")
        return True
    return False


def verify_in_memory_sqlite(schema_sql: str, seed_sql: str) -> Dict[str, Any]:
    conn = sqlite3.connect(":memory:")
    conn.executescript(schema_sql)
    conn.executescript(seed_sql)
    cur = conn.cursor()
    total_targets = cur.execute("SELECT COUNT(*) FROM targets").fetchone()[0]
    by_status = dict(cur.execute("SELECT status, COUNT(*) FROM targets GROUP BY status").fetchall())
    total_cites = cur.execute("SELECT COUNT(*) FROM citations").fetchone()[0]
    top3 = cur.execute(
        "SELECT queue_rank, target_id, headword FROM targets WHERE status = 'QUEUED' ORDER BY queue_rank ASC LIMIT 3"
    ).fetchall()
    conn.close()
    return {
        "total_targets": total_targets,
        "targets_by_status": by_status,
        "seeded_citations": total_cites,
        "top_queued": top3,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="Migrate DRAgNEt repo corpus into Cloudflare D1 & R2")
    parser.add_argument("--repo-root", type=Path, default=REPO_ROOT, help="Path to dragnet-etymology root")
    parser.add_argument("--queue-json", type=Path, default=None, help="Optional path to 08_daily_dragnet_queue.json")
    parser.add_argument("--verify-sqlite", action="store_true", help="Test schema + seed SQL in local sqlite3")
    parser.add_argument("--execute", action="store_true", help="Push schema + seed SQL to remote D1 and WebPs to R2")
    parser.add_argument("--d1-name", type=str, default="dragnet-db", help="Cloudflare D1 database name")
    parser.add_argument("--r2-bucket", type=str, default="dragnet-scans", help="Cloudflare R2 bucket name")
    args = parser.parse_args()

    repo_root = args.repo_root.resolve()
    schema_path = repo_root / "worker" / "schema.sql"
    if not schema_path.exists():
        raise FileNotFoundError(f"Missing {schema_path}; copy worker/schema.sql into repo first.")

    seed_sql, manifest, r2_uploads = build_migration(repo_root, args.queue_json)

    mig_dir = repo_root / "worker" / "migrations"
    mig_dir.mkdir(parents=True, exist_ok=True)
    seed_path = mig_dir / "0002_seed_existing_corpus.sql"
    seed_path.write_text(seed_sql, encoding="utf-8")

    manifest_path = repo_root / "public" / "data" / "r2-scan-manifest.json"
    manifest_path.write_text(json.dumps(manifest, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    if patch_validate_site_for_r2(repo_root):
        print("[OK] Patched scripts/validate-site.mjs in-place with r2-scan-manifest.json support")

    upload_sh = mig_dir / "upload_r2_scans.sh"
    sh_lines = ["#!/usr/bin/env bash", "set -euo pipefail", f'BUCKET="{args.r2_bucket}"']
    for local_file, r2_key in r2_uploads:
        rel_local = local_file.relative_to(repo_root).as_posix()
        sh_lines.append(
            f'npx wrangler r2 object put "${{BUCKET}}/{r2_key}" '
            f'--file={shlex.quote(rel_local)} --content-type="image/webp" '
            f'--cache-control="public, max-age=31536000, immutable" --remote'
        )
    upload_sh.write_text("\n".join(sh_lines) + "\n", encoding="utf-8")
    upload_sh.chmod(0o755)

    print(f"[OK] Wrote D1 seed SQL: {seed_path} ({len(seed_sql):,} bytes)")
    print(f"[OK] Wrote R2 manifest: {manifest_path} ({len(manifest):,} WebP entries)")
    print(f"[OK] Wrote R2 uploader: {upload_sh} ({len(r2_uploads):,} upload commands)")

    if args.verify_sqlite:
        stats = verify_in_memory_sqlite(schema_path.read_text(encoding="utf-8"), seed_sql)
        print(f"[SQLITE VERIFIED] {json.dumps(stats, indent=2)}")

    if args.execute:
        subprocess.run(
            ["npx", "wrangler", "d1", "execute", args.d1_name, "--remote", f"--file={schema_path}"],
            cwd=repo_root,
            check=True,
        )
        subprocess.run(
            ["npx", "wrangler", "d1", "execute", args.d1_name, "--remote", f"--file={seed_path}"],
            cwd=repo_root,
            check=True,
        )
        subprocess.run(["bash", str(upload_sh)], cwd=repo_root, check=True)
        print("[DONE] Remote D1 schema, corpus seed, and R2 WebP scans uploaded.")
        print("       Once verified live, you can `git rm -r public/scans` so Git stays pure text!")

    return 0


if __name__ == "__main__":
    sys.exit(main())
