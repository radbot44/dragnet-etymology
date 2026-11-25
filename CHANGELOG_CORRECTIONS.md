# DRAgNEt Versioned Corrections & Audit Log

All substantive factual corrections, count reconciliations, rights adjustments, and reclassified citations are logged here rather than silently overwritten.

## 2026-11-25 — v3.0 Database & Verification Overhaul

1. **Corrected Unverified Paraphrase Glosses in `gimmick` Prior-Art Notes (`Case 1100`):**
   - *Issue:* Preliminary `prior_art_calibration` metadata in `1102` contained unverified summary strings glossing *OED3*'s 24 February 1893 *Bangor Daily News* quotation as referring to pool rooms and its 26 July 1906 *Connecticut Western News* quotation as `"hand-shaking gimmick"`, contradicting `CERT-900-101` and `CERT-900-106`.
   - *Resolution:* Verified directly against *OED Online* (`gimmick, n.`) that *OED3*'s 24 February 1893 *Bangor Daily News* quotation (*"...caused the flopper to fall down on the mizzen reciprocal eccentricity gimmick"*) is indeed the exact Bucksport electric-plant engine item reprinted on 11 March 1893 in *Electrical Review* (`CERT-900-101`), and that *OED3*'s 21 August 1923 Sense 1.b witness is from the *Columbus (Nebraska) Daily Telegram*. Corrected `public/ledgers/gimmick.json` verbatim.
2. **Eliminated Duplicate Frontmatter Counts (`Case 1100` & `Case 1200`):**
   - *Issue:* `gimmick.md` previously hardcoded `20 verified / 43 falsified` in YAML frontmatter while the underlying 71-record JSON ledger contained `25` verified and `38` non-verified records.
   - *Resolution:* Removed `certificateCounts` from Markdown frontmatter altogether; Astro now computes all counts at build time directly from `public/ledgers/*.json` (`src/lib/ledgers.ts`).
3. **Separated Record Classification from 4-Level Verification Status:**
   - *Resolution:* Split legacy `FALSIFIED-MYTH` into `contextual_evidence` (27 negative-corpus and prosopographical controls), `hypothesis` (`weakened_or_unlikely_pathway` for 11 evaluated lexical/scholarly donor proposals), and `rejected_lead` (23 genuine OCR errors, misdated serials, surname homographs, and uncorroborated folk claims). Assigned honest `agent_verified` status to AI-inspected scans (`0` records claimed as `human_verified` until signed off by a named human).
4. **Separated Third-Party Image Rights & Hosted All 66 Pre-1931 Public-Domain Scans:**
   - *Resolution:* Removed locally bundled images from post-1930 publications (`1931 CIGAM` and `1933 GIMAC`, now linked externally at State Library Victoria), hosted all 66 pre-1931 U.S. public-domain scans (`30` for *shill/shillaber*, `36` for *gimmick*) in `public/scans/`, and stripped all internal Google Drive identifiers from public JSON files.
5. **Editorial Calibration on *Shillaber* & *Gimmick* Articles:**
   - *Resolution:* Reframed *shillaber* around the genuinely new 49-day antedating of Green's 14 March 1883 citation and the identification of the Chicago mock-auction context; framed the 513 Milner circus route-book search as supporting context rather than proof of origin; separated *earliest known attestation* (1893) from *earliest newly uncovered evidence* (1897 / 1914 / 1923) on *gimmick*; and replaced decimal-year figures with natural years, months, and days.
