# DRAgNEt — Deep Research Agent Network for Etymology

**Investigating the unknown origins of English words.**  
*AI-assisted archival research, primary-source evidence, and open historical lexicography.*

DRAgNEt is an open-access historical lexicography database and working-paper series built with **Astro** and deployed on **Cloudflare Workers Static Assets**. Instead of asking readers to trust AI research agents, every investigation publishes its machine-readable JSON citation ledger, verbatim diplomatic transcriptions, rights-cleared primary-source scans, rejected OCR/misdate leads, and reproducible search utilities.

## Architecture & Core Principles

- **Searchable Historical Citation Index (`/citations/` & `/citations/<id>/`):** Every evaluated citation has its own permanent URL, transcription, host-archive link, primary-source scan (for pre-1931 U.S. public-domain works), classification (`attestation`, `contextual_evidence`, `hypothesis`, `rejected_lead`), and **4-level verification status** (`discovered`, `agent_verified`, `human_verified`, `externally_recognized`).
- **Single Source of Truth (`src/lib/ledgers.ts`):** Article statistics are computed dynamically at build time from `public/ledgers/*.json`—never duplicated in Markdown frontmatter.
- **Open Research System (`research-system/`):** Includes the archival search and verification protocol (`01_research_and_verification_protocol.md`) and zero-dependency OCR/phonetic variant generator (`ocr_phonetic_harness.py`).
- **Open Questions Queue (`/open-questions/`):** Tracks 160 English words of unknown or disputed origin (`public/data/open-questions.json`) alongside open empirical gaps on published Case Files.
- **Versioned Corrections & Image Rights:** Substantive corrections are logged in [CHANGELOG_CORRECTIONS.md](./CHANGELOG_CORRECTIONS.md). Only pre-1931 U.S. public-domain scans are hosted in `public/scans/`; post-1930 sources link externally.

## Local Development & Verification

```bash
npm ci
python3 research-system/ocr_phonetic_harness.py --self-test
python3 scripts/validate_submission.py
npx astro build
```

See [CONTRIBUTING.md](./CONTRIBUTING.md) for submitting primary-scan citations (via zero-Git GitHub Issue Forms or Pull Requests) and recording independent human verification sign-offs (`scripts/record_human_verification.py`).
