# Contributing to DRAgNEt (Deep Research Agent Network for Etymology)

Welcome! **DRAgNEt** is an open historical-lexicography repository publishing primary-scan word histories, pre-1931 WebP proof scans, falsified OCR-ghost logs, machine-validated JSON citation ledgers (`schema 3.0`), and structured claim-level evidence graphs (`schema 1.0`).

Whether you are a historical lexicographer, archivist, dialect researcher, or developer running archival search scripts, there are **three ways to contribute**—and you **do not** need to know Git or Astro for quick citation submissions.

---

## Path 1: Zero-Git Submission via GitHub Issue Forms (2 Minutes)

If you discovered an earlier newspaper/periodical scan, spotted a bound-volume misdate or OCR ghost, or want to add prior scholarship or challenge a claim:

1. Go to the **Issues** tab on GitHub and click **New Issue**.
2. Choose **Primary-Scan Antedating or Citation** (or **Report an OCR Ghost / Prior-Art Addition**).
3. Paste the direct archive URL (`https://...`), drag and drop 1–2 PNG/JPG screenshots showing both the **printed page masthead/running date** and the **zoomed target word in ink**, paste the diplomatic quote, and list how your name (and optional ORCID) should appear.
4. Maintainers will verify the scan, mint a `CERT-*` citation record (and update affected `CLM-*` claims), and publish the update or co-authored Case File with full `citation_author` and BibTeX credit to you.

---

## Path 2: Submitting a Case File, Citation Ledger & Claim Ledger via Pull Request

If you want to author a complete DRAgNEt Case File or contribute structured `v1.0` claims for an existing dossier:

### 1. Fork & Install Locally
Astro 5 requires **Node.js `>= 18.20.8`** (Node.js 22 LTS recommended) and **Python `>= 3.10`**:
```bash
git clone https://github.com/YOUR_USERNAME/dragnet-etymology.git
cd dragnet-etymology
npm ci
npm run dev
```

### 2. Scaffold or Ingest Your Case & Claim Ledgers
- **Option A (One-command ingestion via `scripts/add_case.py`):**
  Place pre-1931 (`publication_year <= 1930`) source images in a local scans folder and run:
  ```bash
  python3 scripts/add_case.py \
    --ledger /path/to/your_verified_ledger.json \
    --claims /path/to/your_claims.json \
    --monograph /path/to/your_monograph.md \
    --scans /path/to/evidence_scans \
    --slug <your-slug> \
    --site-root .
  ```
  *(Note: `scripts/ingest_monograph_ledger.py` is also supported as a compatibility wrapper and accepts `--scans` / `--scans-dir`, `--claims`, and `--claims-only`.)*
- **Option B (Author or update only `public/claims/<your-slug>.json`):**
  Follow [`docs/claim-architecture.md`](./docs/claim-architecture.md) and [`schemas/claim-ledger.schema.json`](./schemas/claim-ledger.schema.json) to decompose the dossier's arguments into documentary claims (`attestation`, `antedating`, `negative_evidence`, `source_relationship`) and interpretive claims (`semantic`, `historical_context`, `transmission`, `derivation`, `phonological`, `rebuttal`), then ingest or stamp fingerprints:
  ```bash
  python3 scripts/add_case.py --slug <your-slug> --claims /path/to/your_claims.json --claims-only --merge-existing
  # Or stamp in-place edits directly:
  python3 scripts/validate_claims.py --stamp-fingerprints public/claims/<your-slug>.json
  ```
- Set `author: "Your Name"`, `authorCitation: "Last, First"` (required by Google Scholar Highwire Press meta tags), and optional `authorOrcid: "https://orcid.org/..."` (plus `coAuthors` if co-authored).

### 3. Follow the DRAgNEt Editorial & Epistemic Standards
1. **Trap A (Masthead Dates Only):** Verify dates from the printed issue masthead, running header, or edition colophon—never catalog metadata on bound volumes or undated stereotype reprints.
2. **Trap B (Physical Ink & Pre-1931 Rights Boundary):** Transcribe diplomatically from zoomed page ink, ruling out broken-type OCR ghosts (`skill` -> `shill`, `GREENBACKS` -> `GIMMICKS`). Host WebP page scans in `public/scans/<your-slug>/` (`<= 5 MB`) only for works with `publication_year <= 1930` (unless `scan.rights_cleared` is explicitly `true`).
3. **Explicit Epistemic Boundaries (`evidence_boundary` & `resolution_criteria`):** Separate documentary print facts (`establishedFacts` and documentary `CLM-*` claims) from interpretive reconstructions (`originHypothesis` and interpretive `CLM-*` claims). State `establishes`, `does_not_establish`, and `remaining_uncertainty` on every claim, and provide concrete `resolution_criteria` on every unresolved interpretive claim.
4. **Precision Honesty & Zero Synthetic Confidence Scores:** Express chronological advances only at the effective precision shared by the attested witness and baseline (`day`, `month`, `year`, or `circa`)—never decimal years (`-30.9 yrs`), and never numerical confidence percentages or raw 4-decimal string-similarity floats in prose or claim JSON.
5. **Generous Prior-Art Credit:** Open by crediting what prior lexicographers (*OED*, *Green's Dictionary of Slang*, *HDAS*, *Etymonline*, *American Speech*, *Comments on Etymology*, *Notes and Queries*, ADS-L researchers) already established, setting `inspection_mode: "directly_inspected"` vs. `"inherited_from_existing_research"` honestly on `antedating_baseline`.
6. **Downstream Reuse Snippets (`reuseKit`):** Provide a `WP:PRIMARY`-safe Wikipedia primary-source `<ref>`, a Wiktionary `WT:CFI` quote block, an ADS-L plain-text summary, and an OED slip summary.

### 4. Validate & Open Your Pull Request
```bash
python3 scripts/validate_submission.py
python3 scripts/validate_claims.py
node scripts/validate-claims.mjs
npx astro build
```
Open a Pull Request against `main`. GitHub Actions will automatically validate citation and claim schemas, inferential DAG acyclicity, image rights, workspace sanitization, Astro static build, and release packaging.

---

## Path 3: Independent Scan Verification & Claim Review Sign-Off

Newly ingested claims always enter at `review_status: "unreviewed"`. After a named human reviewer inspects primary scans or evaluates a claim's evidence boundary and baseline comparison, sign-offs are recorded deterministically:

```bash
# Promote a citation scan record (CERT-*) to human_verified:
python3 scripts/record_human_verification.py \
  --ledger public/ledgers/<slug>.json \
  --id CERT-XXXX-YYY \
  --verifier "First Last"

# Record a SHA-256-fingerprinted human claim review (CLM-*):
python3 scripts/record_claim_review.py \
  --slug <slug> \
  --id CLM-XXXX-YYY \
  --status human_reviewed \
  --reviewer "First Last" \
  --orcid "https://orcid.org/0000-0000-0000-0000" \
  --findings "Inspected primary scan and verified baseline date precision and evidence_boundary."
```

Any subsequent edit to a claim's material fields or cited `CERT-*` witnesses changes its SHA-256 fingerprint and automatically flags older reviews as stale until re-reviewed.

---

## Licensing & Authorship

- **Research Content, Citation Ledgers, Claim Ledgers & Pre-1931 Scan Compilations (`src/content/`, `public/`, `docs/`, `schemas/`):** Licensed under [Creative Commons Attribution 4.0 International (CC BY 4.0)](https://creativecommons.org/licenses/by/4.0/). Authors retain copyright and receive full named attribution.
- **Site Code & Tooling (`src/` Astro components, `scripts/`):** Licensed under the [MIT License](./LICENSE).
