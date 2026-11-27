# AGENTS.md — DRAgNEt Repository Runbook for AI & Human Collaborators

This repository powers **DRAgNEt** (**Deep Research Agent Network for Etymology**) at [https://dragnet.tch.one](https://dragnet.tch.one) (`https://github.com/radbot44/dragnet-etymology`). Every AI agent or contributor modifying Case Files, JSON citation ledgers (`v3.0`), JSON claim ledgers (`v1.0`), scans, or scripts in this repository must follow these rules.

## 1. Plain-English User Commands & How to Execute Them

- **"Ingest `{word}`" / "Add finished monograph `{word}`"**:
  Run the zero-dependency Python 3 ingester `scripts/add_case.py` pointing at the completed JSON citation ledger, optional JSON claim ledger, optional monograph export (`.md` or `.txt`), and optional scans directory:
  ```bash
  python3 scripts/add_case.py \
    --ledger /path/to/NNN2_word_verified_ledger.json \
    --claims /path/to/NNN3_word_claims.json \
    --monograph /path/to/NNN1_word_monograph.md \
    --scans /path/to/evidence_scans \
    --slug word
  ```
  For a Phase-2 upgrade to an already-published case, pass `--merge-existing --overwrite`. When batching multiple words for a single release, pass `--no-bump` on all after the first word so `package.json` increments once.
- **"Add or update claims for `{word}`"**:
  Ingest or merge a `v1.0` claim ledger without rewriting the Markdown Case File or citation ledger:
  ```bash
  python3 scripts/add_case.py \
    --slug word \
    --claims /path/to/word_claims.json \
    --claims-only \
    --merge-existing
  ```
- **"Mark `{word}` under review / embargoed"**:
  Never publish full manuscript prose, citation ledgers, or claim ledgers for an investigation currently under restrictive journal peer review unless the user explicitly passes `--allow-preprint`. Instead, record its embargo status on `/open-questions/`:
  ```bash
  python3 scripts/add_case.py --slug shindig --target-id TGT-019 --status under_review
  ```
- **"Sync `/open-questions/` published cases"**:
  Reconcile `public/data/open-questions.json` against all published non-embargoed Case Files on disk without touching `under_review` or unpublished targets:
  ```bash
  python3 scripts/add_case.py --sync-open-questions
  ```
- **"Record human verification on `{CERT_ID}`"**:
  Never set citation `verification_level` to `human_verified` unless a named human reviewer personally inspected the original scan and transcription:
  ```bash
  python3 scripts/record_human_verification.py \
    --ledger public/ledgers/gimmick.json \
    --id CERT-900-102 \
    --verifier "Joshua Callahan"
  ```
- **"Record claim review on `{CLM_ID}`"**:
  Never self-promote claims to `agent_reviewed`, `independently_agent_reviewed`, or `human_reviewed` during ingestion. Record structured reviews exclusively via `scripts/record_claim_review.py`, which snapshots exact SHA-256 `material_fingerprint_at_review` and `evidence_fingerprints_at_review` digests:
  ```bash
  # Named human philological review (enforces model_version: null):
  python3 scripts/record_claim_review.py \
    --slug gimmick \
    --id CLM-1100-001 \
    --status human_reviewed \
    --reviewer "Joshua Callahan" \
    --findings "Verified 1893 Electrical Review reprint attribution against OED3 Bangor Daily News baseline."

  # Independent audit-agent review (requires distinct auditor ID and --model-version):
  python3 scripts/record_claim_review.py \
    --slug gimmick \
    --id CLM-1100-001 \
    --status independently_agent_reviewed \
    --reviewer "DRAgNEt Scholarly Audit Pass" \
    --model-version "gemini-3-pro" \
    --findings "Cross-checked supporting CERT-900-101 diplomatic quote and evidence_boundary scope."
  ```

## 2. Non-Negotiable Schema & Editorial Guardrails (`Citation v3.0` & `Claim v1.0`)

`scripts/validate-site.mjs`, `scripts/validate_submission.py`, `scripts/validate-claims.mjs`, and `scripts/validate_claims.py` block builds and releases if any of the following rules are violated:

1. **Zero Private Workspace Leaks:** Never commit private cloud-drive URLs or URI schemes, raw cloud folder/file IDs, internal container workspace paths, or session identifiers anywhere in the repository.
2. **Single Source of Truth for Dynamic Counts & Staleness:** Never hardcode citation or claim counts in Markdown frontmatter or docs (`src/lib/ledgers.ts` and `src/lib/claims.ts` compute all counts, citation-to-claim backlinks, and topological order dynamically at build time), and **never** serialize `is_stale` to disk in `public/claims/*.json` (staleness is computed dynamically from SHA-256 fingerprints).
3. **Orthogonal Citation Record Type vs. 4-Level Verification (`public/ledgers/*.json`):**
   - `record_type`: `attestation` | `contextual_evidence` | `hypothesis` | `rejected_lead`
   - `verification_level`: `discovered` | `agent_verified` | `human_verified` (requires `human_verified_by` and `human_verified_date`) | `externally_recognized` (requires `external_recognition`)
4. **Claim-Level Evidence Graph, Non-Auto-Promotion & Permanent IDs (`public/claims/*.json`):**
   - Every claim ledger validates against `schemas/claim-ledger.schema.json` (`docs/claim-architecture.md`) with permanent monotonic `CLM-<case_digits>-<NNN>` IDs matching the case's `case_number`.
   - Newly ingested claims **always** enter at `review_status: "unreviewed"` with `reviews: []`. `--merge-existing` preserves permanent `CLM-*` IDs, `supersedes`/`superseded_by` links, and append-only historical `reviews[]`, while automatically downgrading `review_status` back to `"unreviewed"` whenever a claim's `content_fingerprint` or upstream evidence digest changes.
   - Inferential `CLM-*` edges (`depends_on`, `supports`) must form an acyclic DAG; parent interpretive claims never auto-inherit `assessment: "supported"` from documentary child claims, and unresolved interpretive claims (`unassessed`, `partially_supported`, `inconclusive`) must specify non-empty `resolution_criteria`.
5. **Pre-1931 U.S. Public-Domain Scan Boundary:** Only works with `publication_year <= 1930` may host WebP page images in `public/scans/{slug}/` (`<= 5 MB` per file) unless `scan.rights_cleared` is explicitly `true`. Post-1930 works (`publication_year > 1930`) must set `scan.hosted_path` to `null` and link externally via `source_url`.
6. **Historical-Lexicography Register & Precision Honesty:**
   - Express chronological advances in natural `years`, `months`, and `days` bounded strictly by `min(attested_date_precision, baseline_date_precision)` (never decimal years, and never month/day figures when either endpoint has year or circa precision).
   - Omit numerical confidence scores, probabilities, Bayesian posteriors, and raw 4-decimal harness floats (`SLPL`, `JW`) from both JSON claim fields and Markdown prose.
   - Separate what printed primary sources establish chronologically from proposed linguistic/contact hypotheses, and reserve `contradicted` for claims refuted by specific primary counter-evidence rather than merely weakened scholarly proposals.
   - Format `authorCitation` as `'Last, First'` (`'Callahan, Joshua'`) for Highwire Press / Google Scholar / BibTeX indexing.
7. **Bidirectional Cross-Referencing & Open-Questions Parity:** Every `CERT-*` identifier referenced in `src/content/cases/{slug}.md` or `public/claims/{slug}.json` must exist in `public/ledgers/*.json`, and every published non-embargoed case must carry `status: "published_case"` and matching `case_slug` in `public/data/open-questions.json`.

## 3. Automated Deployment & Releases

- **Node.js Runtime:** Astro 5 requires Node.js `>= 18.20.8` (use Node.js 22 LTS locally and in CI).
- **Cloudflare Workers Static Assets (`https://dragnet.tch.one`):** Connected via Cloudflare Workers Builds (`wrangler.jsonc` serving `./dist`). Pushing to `main` automatically runs `astro build` and deploys globally.
- **Automated GitHub Releases (`.github/workflows/release.yml`):** Any push to `main` touching `public/ledgers/**`, `public/claims/**`, `schemas/**`, `src/content/cases/**`, or `package.json` runs the full Python and Node.js validation suites, packages `dragnet-ledgers-vX.Y.Z.zip` (`ledgers/*.json`, `claims/*.json`, `schemas/claim-ledger.schema.json`, `docs/claim-architecture.md`, `provenance/review-provenance.json`, `data/open-questions.json`, `CITATION.cff`) + `review-provenance.json` + `SHA256SUMS.txt` + live release notes via `scripts/package_release_assets.py`, and publishes a versioned GitHub Release.
