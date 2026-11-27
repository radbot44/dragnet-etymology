# DRAgNEt Archival Research & Verification Protocol

This document describes the end-to-end research, citation verification, and claim-level evidence workflow used to produce **DRAgNEt** Case Files, schema `3.0` JSON citation ledgers, and schema `1.0` JSON claim ledgers, separating automated search and extraction steps from independent philological review.

## 1. Candidate Discovery & OCR-Variant Generation

Historical newspaper and trade-serial OCR (18th–early 20th century) systematically corrupts letterforms (`m` <-> `rn`/`nn`, `h` <-> `li`/`b`, `k` <-> `h`, `D` <-> `G`/`J`). Before running date-bounded queries on Chronicling America, Internet Archive, HathiTrust, and specialized digital collections, `research-system/ocr_phonetic_harness.py` generates:
- **Dirty-OCR & column-wrap search patterns** (catching e.g. `2 Gininiicks` for `2 Gimmicks` on Vol. 4, p. 62 of the 1897 West End Street Railway inventory).
- **Pre-standardization spelling variants** (e.g., `shillaber`, `shilliber`, `shilliver`, `shilaber`).
- **Negative-corpus control sweeps** across domain-relevant trade serials and catalogs (recording character/volume counts and predominant competing terms such as `feke`/`fake` or `Come-Along`).

## 2. Four Archival Failure Checks on Every Candidate

Every candidate citation must be inspected on the original page image (never accepted from an OCR snippet alone):

1. **Printed Masthead & Edition Check:** Multi-year bound periodicals and undated trade catalogs frequently carry the serial's founding year in library metadata (for instance, a November 1947 *Collier's* page indexed under `1905`, or an October 1970 *Patent Gazette* indexed under `1872`). Dates are recorded strictly from the printed issue masthead, running header/footer, or edition colophon, logging both `catalog_year` and `masthead_year`.
2. **Original Ink Check:** Zoomed page ink is compared letter-by-letter against adjacent type on the same page to filter out broken-type OCR ghosts (`skill` -> `shill`, `GREENBACKS` -> `GIMMICKS`, `trimmed` -> `gimmed`).
3. **Proper-Name & Homograph Check:** Surnames (`Mrs. Dimmick`, `Dimmick Pipe Co.`, `Chas. Shill`, `J. G. Gimmick`) and unrelated homographs (such as Scots `ferrick` 'mock sun') are separated from lexical attestations.
4. **Prior-Scholarship & Scope Check:** Before describing any attestation or argument as new, current entries in *OED*, *Green's Dictionary of Slang*, *HDAS*, *Etymonline*, *American Speech*, *Comments on Etymology*, *Notes and Queries*, and ADS-L archives are checked and credited. Corpus absence is treated only as supporting context, never proof of geographic origin.

## 3. Orthogonal Citation Record Types and Four Verification Levels (`public/ledgers/*.json`)

Every JSON record in `public/ledgers/*.json` (`schema_version: "3.0"`) separates **Record Type** (`attestation`, `contextual_evidence`, `hypothesis`, `rejected_lead`) from **Verification Level**:

| Level | Value | Meaning |
| :--- | :--- | :--- |
| 1 | `discovered` | Candidate citation located in search or secondary literature; scan not yet inspected. |
| 2 | `agent_verified` | AI research agent inspected the page scan, masthead date, and diplomatic transcription. |
| 3 | `human_verified` | Named human reviewer (`human_verified_by`, `human_verified_date`) independently inspected the scan and transcription. |
| 4 | `externally_recognized` | Citation or finding already published in or accepted by an edited dictionary, peer-reviewed journal, or independent specialist. |

To promote an `agent_verified` citation record after independent human inspection, run:
```bash
python3 scripts/record_human_verification.py --ledger public/ledgers/shill-shillaber.json --id CERT-1200-101 --verifier "Your Name"
```

## 4. Claim-Level Evidence Architecture & Review Provenance (`public/claims/*.json`)

Verifying that an archival page prints a specific string on a given date (`CERT-*`) is distinct from evaluating the philological propositions argued from those witnesses (`CLM-*`). Each Case File therefore pairs its citation ledger with a structured claim ledger in `public/claims/<slug>.json` (`schema_version: "1.0"`, specified in [`docs/claim-architecture.md`](../docs/claim-architecture.md) and validated by `schemas/claim-ledger.schema.json`):

1. **Documentary vs. Interpretive Propositions:**
   - **Documentary claims** (`attestation`, `antedating`, `negative_evidence`, `source_relationship`) establish primary print occurrences, precision-bounded chronological comparisons (`antedating_baseline`), bounded corpus sweeps (`negative_evidence_bounds`), and reprint/edition relationships.
   - **Interpretive claims** (`semantic`, `historical_context`, `transmission`, `derivation`, `phonological`, `rebuttal`) evaluate sense bridges, social pathways, morphological or contact derivations, and competing hypotheses.
   - Every claim declares an explicit `evidence_boundary` (`establishes`, `does_not_establish`, `remaining_uncertainty`), qualitative `assessment` (`unassessed`, `supported`, `partially_supported`, `inconclusive`, `contradicted`—never synthetic numerical confidence scores), and concrete `resolution_criteria` whenever an interpretive claim remains unresolved.
2. **Directed Acyclic Evidence Graph & Non-Inheritance:**
   - Claims link to `CERT-*` witnesses and upstream `CLM-*` premises via typed `evidence` edges (`supports`, `depends_on`, `contradicts`, `weakens`, `qualifies`, `contextualizes`). Inferential `CLM-*` edges (`depends_on`, `supports`) form a strict DAG, and parent interpretive hypotheses never auto-inherit `supported` from documentary premises.
3. **Strict Non-Auto-Promotion & SHA-256 Fingerprint Staleness:**
   - Newly ingested claims (`scripts/add_case.py --claims ...`) **always** enter at `review_status: "unreviewed"`.
   - Independent reviews are recorded exclusively via `scripts/record_claim_review.py` across four review tiers (`unreviewed`, `agent_reviewed`, `independently_agent_reviewed`, `human_reviewed`), snapshotting the exact SHA-256 `material_fingerprint_at_review` (`content_fingerprint`) and `evidence_fingerprints_at_review` map (which transitively cover cited `CERT-*` diplomatic quotes, dates, and hosted WebP scan hashes).
   - `is_stale` is never stored statically on disk; validators and UI loaders recompute staleness dynamically and `--merge-existing` automatically downgrades `review_status` to `"unreviewed"` while preserving historical `reviews[]` whenever material content or upstream evidence changes.

```bash
python3 scripts/record_claim_review.py \
  --slug shill-shillaber \
  --id CLM-1400-001 \
  --status human_reviewed \
  --reviewer "Your Name" \
  --findings "Inspected 24 January 1883 Chicago Inter Ocean scan and verified 49-day advance against Green's 14 March 1883 baseline."
```
