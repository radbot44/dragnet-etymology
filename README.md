# DRAgNEt — Deep Research Agent Network for Etymology

**Investigating the unknown origins of English words.**  
*AI-assisted archival research, primary-source evidence, and open historical lexicography.*

Live site: [https://dragnet.tch.one](https://dragnet.tch.one)

DRAgNEt is an open-access historical lexicography database and working-paper series built with **Astro** and deployed on **Cloudflare Workers Static Assets**. Instead of asking readers to trust AI research agents, every investigation separates its evidence into two machine-validated layers:
1. **Primary-Source Citation Ledgers (`public/ledgers/*.json`, schema `3.0`):** Verbatim diplomatic transcriptions, printed masthead audits, rights-cleared pre-1931 WebP scans, and rejected OCR/misdate leads (`CERT-*`).
2. **Claim-Level Evidence Graphs (`public/claims/*.json`, schema `1.0`):** Atomic documentary and interpretive propositions (`CLM-*`, validated against [`schemas/claim-ledger.schema.json`](./schemas/claim-ledger.schema.json) and specified in [`docs/claim-architecture.md`](./docs/claim-architecture.md)) linked via directed `evidence` edges, precision-bounded antedating baselines, negative-evidence denominators, and SHA-256-fingerprinted review provenance.

## One-Command Monograph, Citation & Claim Ingestion

Add or upgrade a completed monograph, citation ledger, claim ledger, and pre-1931 archival scans with zero external Python packages required:

```bash
# 1. Add a completed word (monograph + citation ledger + claim ledger + <=1930 scans):
python3 scripts/add_case.py \
  --ledger /path/to/1602_hokum_verified_ledger.json \
  --claims /path/to/1603_hokum_claims.json \
  --monograph /path/to/1601_hokum_origin_and_word_family_monograph.md \
  --scans /path/to/evidence_scans \
  --slug hokum

# 2. Ingest or merge ONLY a v1.0 claim ledger for an existing published case
#    (preserves CLM-* IDs and historical reviews[], downgrading stale reviews on material edits):
python3 scripts/add_case.py \
  --slug shill-shillaber \
  --claims /path/to/1403_shill_claims.json \
  --claims-only \
  --merge-existing

# 3. Record an embargoed journal submission on /open-questions/ without publishing full text:
python3 scripts/add_case.py --slug shindig --target-id TGT-019 --status under_review

# 4. Record independent human scan verification (CERT-*) or claim review (CLM-*):
python3 scripts/record_human_verification.py \
  --ledger public/ledgers/gimmick.json \
  --id CERT-900-102 \
  --verifier "Joshua Callahan"

python3 scripts/record_claim_review.py \
  --slug gimmick \
  --id CLM-1100-001 \
  --status human_reviewed \
  --reviewer "Joshua Callahan" \
  --findings "Verified March 11, 1893 Electrical Review p. 36 reprint credit against OED3 Feb. 24, 1893 Bangor Daily News baseline."
```

## Automated Deployment & GitHub Releases

1. **Cloudflare Workers Builds (`npx astro build`):** `astro.config.mjs` runs build-time validation automatically before generating static pages, enforcing citation schema `3.0`, claim schema `1.0`, bidirectional cross-references, inferential DAG acyclicity, pre-1931 scan rights, and workspace sanitization on every push to `main`.
2. **Automatic GitHub Releases (`.github/workflows/release.yml`):** Whenever `public/ledgers/**`, `public/claims/**`, `schemas/**`, `src/content/cases/**`, or `package.json` changes on `main`, GitHub Actions runs the Python and Node.js validation suites, packages `dragnet-ledgers-vX.Y.Z.zip` (`ledgers/*.json`, `claims/*.json`, `schemas/claim-ledger.schema.json`, `docs/claim-architecture.md`, `provenance/review-provenance.json`, `data/open-questions.json`, and `CITATION.cff`) alongside standalone `review-provenance.json`, `SHA256SUMS.txt`, and live release notes via `scripts/package_release_assets.py`, and publishes a versioned GitHub Release.

## Local Development & Verification

Astro 5 requires **Node.js `>= 18.20.8`** (Node.js 22 LTS recommended) and **Python `>= 3.10`**:

```bash
npm ci
python3 research-system/ocr_phonetic_harness.py --self-test
python3 scripts/validate_submission.py
python3 scripts/validate_claims.py
node scripts/validate-claims.mjs
npm run validate
npx astro build
```

See [CONTRIBUTING.md](./CONTRIBUTING.md) and [docs/claim-architecture.md](./docs/claim-architecture.md) for authoring Case Files, schema `3.0` citation ledgers, schema `1.0` claim ledgers, and independent review records.
