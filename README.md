# DRAgNEt — Deep Research Agent Network for Etymology

**Investigating the unknown origins of English words.**  
*AI-assisted archival research, primary-source evidence, and open historical lexicography.*

Live site: [https://dragnet.tch.one](https://dragnet.tch.one)

DRAgNEt is an open-access historical lexicography database and working-paper series built with **Astro** and deployed on **Cloudflare Workers Static Assets**. Instead of asking readers to trust AI research agents, every investigation publishes its machine-readable JSON citation ledger, verbatim diplomatic transcriptions, rights-cleared primary-source scans, rejected OCR/misdate leads, and reproducible search utilities.

## One-Command Plug-and-Play Monograph Ingestion

Add a newly completed monograph, JSON ledger, and pre-1931 archival scans with a single command (zero extra Python packages required):

```bash
# Add a new word (auto-sanitizes Drive links & 4-decimal scores, converts <=1930 PNGs to WebP, updates open-questions.json, and bumps version):
python scripts/add_case.py \
  --ledger "M:/etymology/1602_hokum_verified_ledger.json" \
  --monograph "M:/etymology/1601_hokum_origin_and_word_family_monograph.md" \
  --scans "M:/etymology/evidence_scans" \
  --slug hokum

# Upgrade an existing case with a Phase-2 ledger:
python scripts/add_case.py \
  --ledger "M:/etymology/1402_shill_phase2_verified_ledger.json" \
  --monograph "M:/etymology/1401_shill_shillaber_american_speech_definitive_monograph.md" \
  --scans "M:/etymology/evidence_scans" \
  --slug shill-shillaber \
  --merge-existing \
  --overwrite

# Mark an embargoed journal submission on /open-questions/ without publishing full text:
python scripts/add_case.py --slug shindy --target-id TGT-019 --status under_review
```

## Automated Deployment & GitHub Releases

1. **Cloudflare Workers Builds (`npx astro build`):** `astro.config.mjs` runs `scripts/validate-site.mjs` automatically at build start, enforcing schema `3.0`, bidirectional citation cross-references, pre-1931 scan rights, and workspace sanitization before deploying to `https://dragnet.tch.one` on every push to `main`.
2. **Automatic GitHub Releases (`.github/workflows/release.yml`):** Whenever `public/ledgers/**`, `src/content/cases/**`, or `package.json` changes on `main`, GitHub Actions validates the repository, packages `dragnet-ledgers-vX.Y.Z.zip` + `SHA256SUMS.txt` + ledger-computed release notes via `scripts/package_release_assets.py`, and publishes a versioned GitHub Release (which also auto-mints a Zenodo DOI if linked via `CITATION.cff`).

## Local Development & Verification

```bash
npm ci
python research-system/ocr_phonetic_harness.py --self-test
python scripts/validate_submission.py
npx astro build
```

See [CONTRIBUTING.md](./CONTRIBUTING.md) for submitting primary-scan citations (via zero-Git GitHub Issue Forms or Pull Requests) and recording independent human verification sign-offs (`scripts/record_human_verification.py`).
