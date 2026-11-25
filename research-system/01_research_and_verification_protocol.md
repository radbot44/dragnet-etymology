# DRAgNEt Archival Research & Verification Protocol

This document describes the end-to-end research and verification workflow used to produce **DRAgNEt** Case Files and JSON citation ledgers, separating automated search/triage steps from human philological verification.

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

## 3. Orthogonal Record Types and Four Verification Levels

Every JSON record in `public/ledgers/*.json` separates **Record Type** (`attestation`, `contextual_evidence`, `hypothesis`, `rejected_lead`) from **Verification Level**:

| Level | Value | Meaning |
| :--- | :--- | :--- |
| 1 | `discovered` | Candidate citation located in search or secondary literature; scan not yet inspected. |
| 2 | `agent_verified` | AI research agent inspected the page scan, masthead date, and diplomatic transcription. |
| 3 | `human_verified` | Named human reviewer (`human_verified_by`, `human_verified_date`) independently inspected the scan and transcription. |
| 4 | `externally_recognized` | Citation or finding already published in or accepted by an edited dictionary, peer-reviewed journal, or independent specialist. |

To promote an `agent_verified` record after independent human inspection, run:
```bash
python3 scripts/record_human_verification.py --ledger public/ledgers/shill-shillaber.json --id CERT-1200-101 --verifier "Your Name"
```
