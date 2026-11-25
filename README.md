# DRAgNEt — Deep Research Agent Network for Etymology

Open-access historical lexicography, composite primary-scan proof plates, Trap A–D OCR-ghost falsifications, and machine-validated JSON discovery ledgers—built with **Astro** and deployed on **Cloudflare Workers Static Assets**.

## Live Features & Scholarly Indexing

- **Scan-Verified Case Files (`src/content/cases/*.md`):** Strictly separates *Established in Primary Ink* (`PRIMARY-SCAN-VERIFIED`) from *Proposed Origin Mechanism* (`PHONOLOGICAL-HYPOTHESIS`), paired with zoomable proof plates and a Trap A–D falsified-leads table.
- **Multi-Author Scholarly Metadata:** Emits Highwire Press `<meta name="citation_*">` tags for Google Scholar & Zotero, Schema.org `ScholarlyArticle` JSON-LD, per-case `.bib` downloads (`/cases/<slug>.bib`), `/sitemap.xml`, and a full-text CC BY 4.0 RSS 2.0 feed (`/rss.xml`) ready for Rogue Scholar Crossref DOI indexing.
- **1-Click Downstream Reuse Drawer:** Pre-formats `WP:PRIMARY`-compliant Wikipedia primary `<ref>` citations, Wiktionary `WT:CFI` quotes, ADS-L dispatches, and OED submission slips.
- **Two-Lane Community Submissions:**
  1. **No Git required:** Submit a scan or correction via [GitHub Issue Forms](./.github/ISSUE_TEMPLATE/).
  2. **Pull Requests:** Add a Case File + proof plates and let GitHub Actions run `scripts/validate_submission.py` + `astro build` automatically. See [CONTRIBUTING.md](./CONTRIBUTING.md).

## Quick Start & Deployment (GitHub -> Cloudflare Workers Static Assets)

1. **Replace two placeholders before pushing to GitHub:**
   - Update `site` in `astro.config.mjs` with your final domain or `https://<project>.workers.dev`.
   - Update `SITE_GITHUB_URL` in `src/consts.ts` ( plus `@YOUR_GITHUB_USERNAME` in `.github/CODEOWNERS` and `CITATION.cff`) with your GitHub username/repo.
2. **Local development & validation:**
   ```bash
   npm install
   npm run validate
   npm run build
   npm run preview
   ```
3. **Connect GitHub to Cloudflare Workers Static Assets:**
   - In the Cloudflare dashboard, open **Compute (Workers & Pages) -> Create -> Import a repository** and select your GitHub repo.
   - Set **Build command** to `npx astro build` and **Deploy command** to the default Workers deploy step (`wrangler.jsonc` already configures `assets.directory = "./dist"` and `not_found_handling = "404-page"`).
   - Enable **Preview URLs** on Pull Requests so every contributor PR gets a live preview link for visual proof-plate inspection before merge.
4. **Optional Automatic Release DOIs (Zenodo):**
   - Enable your repository in Zenodo's GitHub integration (`https://zenodo.org/account/settings/github/`). Every tagged GitHub Release (`v1.0.0`, `v1.1.0`) will automatically archive a permanent snapshot and mint a Zenodo DOI using `CITATION.cff`.

## License

Dual-licensed: **CC BY 4.0** for all Case Files, JSON ledgers, and proof-plate compilations; **MIT** for Astro components and Python scripts. See [LICENSE](./LICENSE).
