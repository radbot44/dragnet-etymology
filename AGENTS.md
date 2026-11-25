# AGENTS.md — DRAgNEt v3 Repository Runbook for AI & Human Collaborators

This repository powers **DRAgNEt** (**Deep Research Agent Network for Etymology**) at [https://dragnet.tch.one](https://dragnet.tch.one) (`https://github.com/radbot44/dragnet-etymology`). Every AI agent or contributor modifying Case Files, JSON ledgers, scans, or scripts in this repository must follow these rules.

## 1. Plain-English User Commands & How to Execute Them

- **"Ingest `{word}`" / "Add finished monograph `{word}`"**:
  Run the zero-dependency Python 3 ingester `scripts/add_case.py` pointing at the completed JSON ledger, optional monograph export (`.md` or `.txt`), and optional scans directory:
  ```bash
  python scripts/add_case.py \
    --ledger /path/to/NNN2_word_verified_ledger.json \
    --monograph /path/to/NNN1_word_monograph.md \
    --scans /path/to/evidence_scans \
    --slug word
  ```
  For a Phase-2 upgrade to an already-published case (for example merging a Phase-2 ledger into `shill-shillaber`), pass `--merge-existing --overwrite`. When batching multiple words for a single release, pass `--no-bump` on all after the first word so `package.json` increments once.
- **"Mark `{word}` under review / embargoed"**:
  Never publish full manuscript prose or ledgers for an investigation currently under restrictive journal peer review unless the user explicitly passes `--allow-preprint`. Instead, record its status on `/open-questions/`:
  ```bash
  python scripts/add_case.py --slug shindy --target-id TGT-019 --status under_review
  ```
- **"Record human verification on `{CERT_ID}`"**:
  Never set `verification_level` to `human_verified` unless a named human reviewer personally inspected the original scan and transcription:
  ```bash
  python scripts/record_human_verification.py \
    --ledger public/ledgers/gimmick.json \
    --id CERT-900-102 \
    --verifier "Joshua Callahan"
  ```

## 2. Non-Negotiable Schema & Editorial Guardrails (`v3.0`)

Both `scripts/validate-site.mjs` (hooked directly into `astro.config.mjs` during every `npx astro build` and Cloudflare Workers Build) and `scripts/validate_submission.py` block the build if any of the following rules are violated:

1. **Zero Private Workspace Leaks:** Never commit `drive.google.com`, `docs.google.com`, `googledrive://`, or internal workspace folder/file IDs anywhere in `src/`, `public/`, or `research-system/`.
2. **Single Source of Truth for Counts:** Never hardcode citation counts in Markdown frontmatter; `src/lib/ledgers.ts` computes all statistics dynamically at build time from `public/ledgers/*.json`.
3. **Orthogonal Record Type vs. 4-Level Verification:**
   - `record_type`: `attestation` | `contextual_evidence` | `hypothesis` | `rejected_lead`
   - `verification_level`: `discovered` | `agent_verified` | `human_verified` (requires `human_verified_by` and `human_verified_date`) | `externally_recognized` (requires `external_recognition`)
4. **Pre-1931 U.S. Public-Domain Scan Boundary:** Only works with `publication_year <= 1930` may host WebP page images in `public/scans/{slug}/` (`<= 5 MB` per file) unless `scan.rights_cleared` is explicitly `true`. Post-1930 works (`publication_year > 1930`) must set `scan.hosted_path` to `null` and link externally via `source_url`.
5. **Historical-Lexicography Register:**
   - Express antedatings in natural `years, months, and days` (never decimal years such as `-30.9 yrs`).
   - Omit raw 4-decimal phonological/string-similarity scores (`SLPL = 1.0000`, `0.7500`) from Case File Markdown prose and YAML frontmatter.
   - Separate what printed primary sources establish chronologically from proposed linguistic/contact hypotheses, and never label scholarly etymological proposals as "falsified myths" when evidence merely weakens them.
   - Format `authorCitation` as `'Last, First'` (`'Callahan, Joshua'`) for Highwire Press / Google Scholar / BibTeX indexing.
6. **Bidirectional Citation Cross-Referencing:** Every `CERT-XXXX-YYY` identifier mentioned in `src/content/cases/{slug}.md` (frontmatter or body) must exist in `public/ledgers/{slug}.json`.

## 3. Automated Deployment & Releases

- **Cloudflare Workers Static Assets (`https://dragnet.tch.one`):** Connected via Cloudflare Workers Builds (`wrangler.jsonc` serving `./dist`). Pushing to `main` automatically runs `astro build` (including `validate-site.mjs`) and deploys globally.
- **Automated GitHub Releases (`.github/workflows/release.yml`):** Any push to `main` touching `public/ledgers/**`, `src/content/cases/**`, or `package.json` automatically runs the test/validation suite, packages `dragnet-ledgers-vX.Y.Z.zip` + `SHA256SUMS.txt` + live ledger release notes via `scripts/package_release_assets.py`, and publishes a versioned GitHub Release.
