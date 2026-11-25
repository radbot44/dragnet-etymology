#!/usr/bin/env python3
"""
package_release_assets.py (DRAgNEt v3)
--------------------------------------
Builds versioned release artifacts from the validated repository for automated GitHub Releases
and optional Zenodo DOI archiving:
  - release_dist/dragnet-ledgers-<tag>.zip  (all sanitized JSON ledgers + open-questions.json + CITATION.cff + LICENSE)
  - release_dist/SHA256SUMS.txt             (cryptographic SHA-256 digests of every ledger and release zip)
  - release_dist/RELEASE_NOTES.md           (markdown release notes with live counts computed from JSON ledgers)
"""
from __future__ import annotations
import argparse
import datetime as dt
import hashlib
import json
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as fh:
        for chunk in iter(lambda: fh.read(65536), b""):
            h.update(chunk)
    return h.hexdigest()


def extract_site_url() -> str:
    astro_cfg = ROOT / "astro.config.mjs"
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


def main() -> int:
    ap = argparse.ArgumentParser(description="Package DRAgNEt JSON ledgers, checksums, and release notes.")
    ap.add_argument("--tag", required=True, help="Release tag, e.g. v3.1.0")
    ap.add_argument("--out-dir", default="release_dist", help="Output directory for release artifacts")
    args = ap.parse_args()

    tag = args.tag if args.tag.startswith("v") else f"v{args.tag}"
    out_dir = (ROOT / args.out_dir).resolve()
    out_dir.mkdir(parents=True, exist_ok=True)

    ledgers_dir = ROOT / "public" / "ledgers"
    ledger_files = sorted(ledgers_dir.glob("*.json"))
    if not ledger_files:
        raise SystemExit("No JSON ledgers found in public/ledgers/")

    zip_name = f"dragnet-ledgers-{tag}.zip"
    zip_path = out_dir / zip_name

    include_files: list[tuple[Path, str]] = []
    for lf in ledger_files:
        include_files.append((lf, f"ledgers/{lf.name}"))
    open_q = ROOT / "public" / "data" / "open-questions.json"
    if open_q.exists():
        include_files.append((open_q, "data/open-questions.json"))
    for meta_name in ("CITATION.cff", "LICENSE", "CHANGELOG_CORRECTIONS.md"):
        mp = ROOT / meta_name
        if mp.exists():
            include_files.append((mp, meta_name))

    with zipfile.ZipFile(zip_path, "w", compression=zipfile.ZIP_DEFLATED) as zf:
        for src_path, arc_name in include_files:
            zf.write(src_path, arcname=f"dragnet-ledgers-{tag}/{arc_name}")

    checksum_lines: list[str] = [f"{sha256_file(zip_path)}  {zip_name}"]
    for lf in ledger_files:
        checksum_lines.append(f"{sha256_file(lf)}  ledgers/{lf.name}")
    if open_q.exists():
        checksum_lines.append(f"{sha256_file(open_q)}  data/open-questions.json")

    sums_path = out_dir / "SHA256SUMS.txt"
    sums_path.write_text("\n".join(checksum_lines) + "\n", encoding="utf-8")

    # Compute exact dataset statistics from JSON ledgers
    site_url = extract_site_url()
    rows: list[str] = []
    tot_eval = tot_att = tot_hyp = tot_rej = tot_human = tot_scans = 0

    for lf in ledger_files:
        data = json.loads(lf.read_text(encoding="utf-8"))
        slug = data.get("ledger_id") or lf.stem
        hw = data.get("headword") or slug
        case_num = data.get("case_number") or ""
        cits = data.get("citations") or []
        n_eval = len(cits)
        n_att = sum(1 for c in cits if c.get("record_type") == "attestation")
        n_hyp = sum(1 for c in cits if c.get("record_type") == "hypothesis")
        n_rej = sum(1 for c in cits if c.get("record_type") == "rejected_lead")
        n_hum = sum(1 for c in cits if c.get("verification_level") == "human_verified")
        n_scn = sum(1 for c in cits if (c.get("scan") or {}).get("hosted_path"))

        tot_eval += n_eval
        tot_att += n_att
        tot_hyp += n_hyp
        tot_rej += n_rej
        tot_human += n_hum
        tot_scans += n_scn

        rows.append(
            f"| [`{hw}`]({site_url}/cases/{slug}/) ({case_num}) | {n_eval} | {n_att} | {n_hyp} | {n_rej} | {n_hum} | {n_scn} |"
        )

    today = dt.date.today().isoformat()
    notes_md = f"""## DRAgNEt Dataset & Case Archive — `{tag}` ({today})

Open-access historical lexicography dataset release from **DRAgNEt** (*Deep Research Agent Network for Etymology*): [{site_url}]({site_url})

### Corpus Summary
- **Published Case Files**: `{len(ledger_files)}`
- **Evaluated Citation Records**: `{tot_eval}` (`{tot_att}` primary attestations, `{tot_hyp}` linguistic hypotheses, `{tot_rej}` rejected leads & archival traps)
- **Human-Verified Records**: `{tot_human}`
- **Bundled Pre-1931 Public-Domain Scans**: `{tot_scans}`

### Included Case Ledgers

| Headword & Case | Evaluated | Attestations | Hypotheses | Rejected Leads | Human-Verified | Hosted Scans |
| :--- | ---: | ---: | ---: | ---: | ---: | ---: |
{chr(10).join(rows)}

### Attached Machine-Readable Assets
- **`{zip_name}`** — Standalone CC BY 4.0 archive of all schema `3.0` JSON ledgers (`ledgers/*.json`), `data/open-questions.json`, and `CITATION.cff`.
- **`SHA256SUMS.txt`** — Cryptographic SHA-256 digests for reproducible citation verification.
"""
    notes_path = out_dir / "RELEASE_NOTES.md"
    notes_path.write_text(notes_md, encoding="utf-8")

    print(f"[OK] Packaged {zip_path.name} ({len(ledger_files)} ledgers, {tot_eval} citations)")
    print(f"[OK] Wrote {sums_path.name} and {notes_path.name}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
