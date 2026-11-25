# Contributing to DRAgNEt (Deep Research Agent Network for Etymology)

Welcome! **DRAgNEt** is an open historical-lexicography repository publishing primary-scan word histories, composite ink proof plates, falsified OCR-ghost logs, and machine-validated JSON ledgers.

Whether you are a historical lexicographer, archivist, dialect researcher, or developer running archival search scripts, there are **two ways to submit**—and you **do not** need to know Git or Astro to contribute.

---

## Path 1: Zero-Git Submission via GitHub Issue Forms (2 Minutes)

If you discovered an earlier newspaper/periodical scan, spotted a bound-volume misdate or OCR ghost, or want to add prior scholarship:

1. Go to the **Issues** tab on GitHub and click **New Issue**.
2. Choose **Primary-Scan Antedating or Citation** (or **Report an OCR Ghost / Prior-Art Addition**).
3. Paste the direct archive URL (`https://...`), drag and drop 1–2 PNG/JPG screenshots showing both the **printed page masthead/running date** and the **zoomed target word in ink**, paste the diplomatic quote, and list how your name (and optional ORCID) should appear.
4. Maintainers will verify the scan, mint a certificate ID in the JSON ledger, and publish the update or co-authored Case File with full `citation_author` and BibTeX credit to you.

---

## Path 2: Submitting a Full Case File via Pull Request

If you want to author a complete DRAgNEt Case File (or update an existing Markdown dossier + JSON ledger):

### 1. Fork & Install Locally
```bash
git clone https://github.com/YOUR_USERNAME/dragnet-etymology.git
cd dragnet-etymology
npm install
npm run dev
```

### 2. Add or Scaffold Your Case File
- **Option A (Copy an existing Case File):** Copy `src/content/cases/shill-shillaber.md` to `src/content/cases/<your-slug>.md`, place your composite PNG proof plates (`<= 5 MB` each) in `public/proof-plates/<your-slug>/`, and place your certificate ledger JSON in `public/ledgers/`.
- **Option B (Scaffold from a verified JSON ledger):**
  ```bash
  python3 scripts/ingest_monograph_ledger.py \
    --ledger /path/to/your_verified_ledger.json \
    --slug <your-slug> \
    --scans-dir /path/to/evidence_scans \
    --site-root .
  ```
- Set `author: "Your Name"`, `authorCitation: "Last, First"` (required by Google Scholar Highwire Press meta tags), and optional `authorOrcid: "https://orcid.org/..."` (plus `coAuthors` if co-authored).

### 3. Follow the Six DRAgNEt Editorial Standards
1. **Trap A (Masthead Dates Only):** Verify dates from the printed issue masthead, running header, or edition colophon—never catalog metadata on bound volumes or undated stereotype reprints.
2. **Trap B (Physical Ink Only):** Transcribe diplomatically from zoomed page ink, ruling out broken-type OCR ghosts (`skill` -> `shill`, `GREENBACKS` -> `GIMMICKS`).
3. **Two-Tier Epistemic Split:** Keep attested print chronology (`establishedFacts`) cleanly separated from any oral-contact or morphological reconstruction (`originHypothesis`). Avoid words like *clinches* or *definitively proves* for unattested oral steps.
4. **No Raw String-Similarity Decimals in Prose:** Keep internal phonetic/string triage scores inside the JSON ledger; write prose explanations in plain linguistic English.
5. **Generous Prior-Art Credit:** Open by crediting what prior lexicographers (*OED*, *Green's Dictionary of Slang*, *HDAS*, *Etymonline*, *American Speech*, *Comments on Etymology*, *Notes and Queries*, ADS-L researchers) already established.
6. **Downstream Reuse Snippets (`reuseKit`):** Provide a `WP:PRIMARY`-safe Wikipedia primary-source `<ref>`, a Wiktionary `WT:CFI` quote block, an ADS-L plain-text summary, and an OED slip summary.

### 4. Validate & Open Your Pull Request
```bash
python3 scripts/validate_submission.py
npx astro build
```
Open a Pull Request against `main`. GitHub Actions will automatically validate your frontmatter, image sizes, and Astro static build, and open peer review will take place directly in the PR thread. Once approved and merged, Maintainers add `reviewedBy: "DRAgNEt Editorial Scan Audit"` and `reviewUrl` linking to the transparent review record.

---

## Licensing & Authorship

- **Research Content, JSON Ledgers & Proof-Plate Compilations (`src/content/`, `public/`):** Licensed under [Creative Commons Attribution 4.0 International (CC BY 4.0)](https://creativecommons.org/licenses/by/4.0/). Authors retain copyright and receive full named attribution.
- **Site Code & Tooling (`src/` Astro components, `scripts/`):** Licensed under the [MIT License](./LICENSE).
