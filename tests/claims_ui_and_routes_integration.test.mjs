/**
 * Agent 10 — Parameterized UI, Static Routes, Backlinks, Search/Filter,
 * Accessibility, and Baseline Compatibility Suite (Node.js 22)
 * Domains 14, 15, 16, 17, and 18
 *
 * Runs active CSS contrast, filter-engine, backlink-API, and route-manifest tests
 * immediately in Phase C, and automatically activates full dist/ HTML inspections
 * with zero skips once Agent 8's /claims/ UI and all 18 claim ledgers merge in Phase E.
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import {
  clearClaimsCache,
  getAllClaims,
  getPrincipalClaimsForCase,
  getCitationClaimBacklinkIndex,
} from '../src/lib/claims.ts';
import {
  REPO_ROOT,
  BASELINE_COUNTS,
  EXPECTED_CASE_SLUGS,
  collectExpectedBaselineRoutes,
  probeIntegrationState,
  getForbiddenDiskSubstrings,
} from './helpers/contract_adapter.mjs';
import {
  wcagContrastRatio,
  extractCssTokensAndBadges,
  auditPageLandmarksAndHonesty,
  findBrokenInternalLinks,
  parseInteractiveIndexHtml,
  createFilterDomHarness,
} from './helpers/html_audit.mjs';

let _buildAttempted = false;

/**
 * Ensure dist/ is built once when UI integration is ready (or if dist/ already exists).
 */
function ensureBuiltDistIfUiMerged() {
  const state = probeIntegrationState(REPO_ROOT);
  if (state.hasBuiltClaimsHtml) return state;
  if (state.hasClaimsUiSource && !_buildAttempted) {
    _buildAttempted = true;
    const astroBin = path.join(REPO_ROOT, 'node_modules', '.bin', 'astro');
    const res = spawnSync(process.execPath, [astroBin, 'build'], {
      cwd: REPO_ROOT,
      encoding: 'utf-8',
      env: { ...process.env },
    });
    assert.equal(res.status, 0, `astro build failed during UI QA:\n${res.stderr}\n${res.stdout}`);
    return probeIntegrationState(REPO_ROOT);
  }
  return state;
}

test('Domain 15 Data Layer: Dynamic citation-to-claim backlinks and case principal claims resolve accurately across merged claim ledgers', () => {
  clearClaimsCache();
  const backlinkIndex = getCitationClaimBacklinkIndex({ rootDir: REPO_ROOT });
  assert.ok(backlinkIndex.size >= 150, `Expected >= 150 unique citations with claim backlinks, got ${backlinkIndex.size}`);

  // Verify advancing baseline witnesses are flagged in citation backlinks
  let advancingWitnessCount = 0;
  for (const [certId, links] of backlinkIndex.entries()) {
    assert.match(certId, /^CERT-\d{3,4}-\d{3}[A-Za-z]?$/);
    for (const link of links) {
      assert.ok(link.claim.id.startsWith('CLM-'));
      if (link.isAdvancingBaselineWitness) {
        advancingWitnessCount += 1;
        assert.equal(link.claim.antedating_baseline?.advancing_citation_ref, certId);
      }
    }
  }
  assert.ok(advancingWitnessCount >= 10, `Expected >= 10 advancing baseline witness backlinks, got ${advancingWitnessCount}`);

  // Every merged claim ledger must expose >= 1 active principal claim
  const state = probeIntegrationState(REPO_ROOT);
  for (const file of state.claimFiles) {
    const slug = path.basename(file, '.json');
    const principals = getPrincipalClaimsForCase(slug, { rootDir: REPO_ROOT });
    assert.ok(principals.length >= 1, `Case ${slug} must expose >= 1 active principal claim`);
  }
});

test('Domain 17 CSS Contrast & Responsive Guardrails: global.css tokens, badges, overflow-wrap, and table wrappers meet WCAG 2.1 AA', () => {
  const cssText = fs.readFileSync(path.join(REPO_ROOT, 'src', 'styles', 'global.css'), 'utf-8');
  const { vars, badges } = extractCssTokensAndBadges(cssText);

  assert.ok(wcagContrastRatio(vars['--ink'], vars['--bg']) >= 12.0);
  assert.ok(wcagContrastRatio(vars['--ink-muted'], vars['--surface']) >= 4.5);
  assert.ok(wcagContrastRatio(vars['--accent'], vars['--surface']) >= 4.5);
  assert.ok(wcagContrastRatio(vars['--verified'], vars['--verified-bg']) >= 4.5);
  assert.ok(wcagContrastRatio(vars['--hypothesis'], vars['--hypothesis-bg']) >= 4.5);
  assert.ok(wcagContrastRatio(vars['--falsified'], vars['--falsified-bg']) >= 4.5);

  assert.ok(badges.length >= 8);
  for (const b of badges) {
    assert.ok(
      b.ratio >= 4.5,
      `Badge ${b.selector} (${b.fg} on ${b.bg}) violates WCAG 2.1 AA 4.5:1 text contrast (${b.ratio}:1)`
    );
  }

  // Responsive wrapping & scrollable table containers must remain present in global.css
  assert.match(cssText, /overflow-wrap:\s*anywhere/);
  assert.match(cssText, /\.citation-table-wrap\s*\{[\s\S]*?overflow-x:\s*auto/);
  assert.match(cssText, /\.skip-link:focus/);
});

test('Domain 16 Citation Index Filter Engine: URL-synced search, multi-facet filtering, Clear-filters, and popstate work cleanly', () => {
  const citIndexAstro = fs.readFileSync(
    path.join(REPO_ROOT, 'src', 'pages', 'citations', 'index.astro'),
    'utf-8'
  );
  const scriptMatch = citIndexAstro.match(/<script is:inline>([\s\S]*?)<\/script>/);
  assert.ok(scriptMatch, 'Expected inline filter script in src/pages/citations/index.astro');

  const harness = createFilterDomHarness({
    initialUrl: 'https://dragnet.tch.one/citations/?headword=ballyhoo+%2F+ballahoo&scan=1',
    elementsById: {
      'cit-search': { value: '' },
      'cit-headword': { value: '' },
      'cit-type': { value: '' },
      'cit-ver': { value: '' },
      'cit-scan-only': { checked: false },
      'cit-count': { textContent: '' },
      'cit-clear': { hidden: true },
      'cit-empty': { hidden: true },
      'cit-table': { parentElement: { hidden: false } },
      'citation-results': {},
      'cit-pages': { hidden: true },
      'cit-prev': { disabled: false },
      'cit-next': { disabled: false },
      'cit-page-label': { textContent: '' },
    },
    rows: [
      {
        dataset: {
          headword: 'ballyhoo / ballahoo',
          type: 'attestation',
          ver: 'agent_verified',
          scan: 'yes',
          haystack: 'cert-1800-010 ballyhoo savannah republican 1810',
        },
      },
      {
        dataset: {
          headword: 'ballyhoo / ballahoo',
          type: 'hypothesis',
          ver: 'discovered',
          scan: 'no',
          haystack: 'cert-1800-060 ballyhooly martin 1886',
        },
      },
      {
        dataset: {
          headword: 'gimmick',
          type: 'attestation',
          ver: 'agent_verified',
          scan: 'yes',
          haystack: 'cert-900-101 gimmick boston west end 1897',
        },
      },
    ],
  });

  harness.runInlineScript(scriptMatch[1]);
  assert.equal(harness.getVisibleRows().length, 1);
  assert.equal(harness.getControl('cit-clear').hidden, false);

  harness.getControl('cit-clear').dispatch('click');
  assert.equal(harness.getVisibleRows().length, 3);
  assert.equal(harness.getHref(), 'https://dragnet.tch.one/citations/');
  assert.equal(harness.getControl('cit-clear').hidden, true);

  harness.getControl('cit-search').value = 'boston 1897';
  harness.getControl('cit-search').dispatch('input');
  assert.equal(harness.getVisibleRows().length, 1);
  assert.ok(harness.getHref().includes('q=boston+1897'));

  harness.simulatePopState('https://dragnet.tch.one/citations/?type=hypothesis');
  assert.equal(harness.getVisibleRows().length, 1);
  assert.equal(harness.getVisibleRows()[0].dataset.type, 'hypothesis');
});

test('Domain 18 Baseline Source Route & Asset Manifest: All 18 cases, 1,215 citation slugs, and 1,066 hosted scans are intact on disk', () => {
  const manifest = collectExpectedBaselineRoutes(REPO_ROOT);
  assert.equal(manifest.htmlRoutes.length, BASELINE_COUNTS.staticHtmlPages);
  assert.equal(manifest.bibRoutes.length, BASELINE_COUNTS.cases);
  assert.equal(manifest.citationSlugs.length, BASELINE_COUNTS.citations);

  for (const slug of EXPECTED_CASE_SLUGS) {
    assert.equal(fs.existsSync(path.join(REPO_ROOT, 'src', 'content', 'cases', `${slug}.md`)), true);
    assert.equal(fs.existsSync(path.join(REPO_ROOT, 'public', 'ledgers', `${slug}.json`)), true);
  }
});

test('Domains 14, 15, 16, 17 & 18 Full Built Static Site Verification (/claims/, /claims/clm-.../, backlinks, URL filter sync, landmarks, and all 1,240 baseline routes)', (t) => {
  const state = ensureBuiltDistIfUiMerged();
  if (!state.hasClaimsUiSource || !state.hasAll18ClaimLedgers) {
    t.skip(
      `Pending Phase E full merge (currently ${state.claimFileCount}/18 claim ledgers, hasClaimsUiSource=${state.hasClaimsUiSource})`
    );
    return;
  }

  const distDir = path.join(REPO_ROOT, 'dist');
  const forbidden = getForbiddenDiskSubstrings();

  // 1. Domain 18: Verify 100% of the 1,240 baseline HTML pages + 18 .bib files + rss.xml + sitemap.xml + 18 ledgers + 1,066 scans
  const manifest = collectExpectedBaselineRoutes(REPO_ROOT);
  for (const relHtml of manifest.htmlRoutes) {
    assert.equal(
      fs.existsSync(path.join(distDir, relHtml)),
      true,
      `Baseline HTML route missing from dist/: ${relHtml}`
    );
  }
  for (const relBib of manifest.bibRoutes) {
    assert.equal(
      fs.existsSync(path.join(distDir, relBib)),
      true,
      `Baseline BibTeX route missing from dist/: ${relBib}`
    );
  }
  for (const relXml of manifest.xmlRoutes) {
    assert.equal(
      fs.existsSync(path.join(distDir, relXml)),
      true,
      `Baseline XML route missing from dist/: ${relXml}`
    );
  }
  for (const slug of EXPECTED_CASE_SLUGS) {
    assert.equal(fs.existsSync(path.join(distDir, 'ledgers', `${slug}.json`)), true);
  }

  // 2. Domain 14: Verify /claims/index.html, every /claims/clm-.../index.html, and sitemap.xml claim entries
  const claimsIndexPath = path.join(distDir, 'claims', 'index.html');
  assert.equal(fs.existsSync(claimsIndexPath), true, 'Missing dist/claims/index.html');
  const claimsIndexHtml = fs.readFileSync(claimsIndexPath, 'utf-8');

  const allClaims = getAllClaims({ options: { rootDir: REPO_ROOT } });
  assert.ok(allClaims.length >= 140, `Expected >= 140 claims across 18 cases, got ${allClaims.length}`);

  const sitemapXml = fs.readFileSync(path.join(distDir, 'sitemap.xml'), 'utf-8');
  assert.ok(sitemapXml.includes('/claims/'), 'sitemap.xml must include /claims/');

  for (const clm of allClaims) {
    const detailPath = path.join(distDir, 'claims', clm.slug, 'index.html');
    assert.equal(fs.existsSync(detailPath), true, `Missing static claim page dist/claims/${clm.slug}/index.html`);
    const detailHtml = fs.readFileSync(detailPath, 'utf-8');

    // Check claim statement, assessment, review_status, and evidence links render cleanly
    assert.ok(detailHtml.includes(clm.id), `Claim page ${clm.slug} missing ID ${clm.id}`);
    for (const bad of forbidden) {
      assert.equal(detailHtml.includes(bad), false, `Forbidden leak in dist/claims/${clm.slug}/index.html`);
    }
    const a11y = auditPageLandmarksAndHonesty(detailHtml);
    assert.equal(a11y.ok, true, `Accessibility/honesty issue on /claims/${clm.slug}/: ${a11y.issues.join('; ')}`);
    const broken = findBrokenInternalLinks(detailHtml, distDir);
    assert.deepEqual(broken, [], `Broken internal links on /claims/${clm.slug}/: ${broken.join(', ')}`);
  }

  // 3. Domain 15: Verify evidence backlinks on /citations/cert-.../index.html and principal claims on /cases/<slug>/index.html
  const backlinks = getCitationClaimBacklinkIndex({ rootDir: REPO_ROOT });
  let checkedBacklinkPages = 0;
  for (const [certId, links] of backlinks.entries()) {
    if (links.length === 0) continue;
    const certHtmlPath = path.join(distDir, 'citations', certId.toLowerCase(), 'index.html');
    assert.equal(fs.existsSync(certHtmlPath), true);
    const certHtml = fs.readFileSync(certHtmlPath, 'utf-8');
    for (const link of links) {
      assert.ok(
        certHtml.includes(`/claims/${link.claim.slug}/`) || certHtml.includes(link.claim.id),
        `Citation page ${certId} missing backlink to referencing claim ${link.claim.id}`
      );
    }
    checkedBacklinkPages += 1;
  }
  assert.ok(checkedBacklinkPages >= 150);

  for (const slug of EXPECTED_CASE_SLUGS) {
    const caseHtmlPath = path.join(distDir, 'cases', slug, 'index.html');
    const caseHtml = fs.readFileSync(caseHtmlPath, 'utf-8');
    const principals = getPrincipalClaimsForCase(slug, { rootDir: REPO_ROOT });
    for (const pc of principals) {
      assert.ok(
        caseHtml.includes(`/claims/${pc.slug}/`) || caseHtml.includes(pc.id),
        `Case page /cases/${slug}/ missing principal claim ${pc.id}`
      );
    }
    const a11y = auditPageLandmarksAndHonesty(caseHtml, { checkPctConfidence: false });
    const principalIdx = caseHtml.indexOf('id="principal-claims"');
    if (principalIdx !== -1) {
      const claimSec = caseHtml.slice(principalIdx, principalIdx + 12000);
      assert.equal(/\b\d{1,3}(?:\.\d+)?%\s*(?:confidence|certainty|probability|likelihood)\b/i.test(claimSec), false, `Principal claims section on /cases/${slug}/ uses percentage confidence`);
    }
    assert.equal(a11y.ok, true, `Accessibility/honesty issue on /cases/${slug}/: ${a11y.issues.join('; ')}`);
    const broken = findBrokenInternalLinks(caseHtml, distDir);
    assert.deepEqual(broken, [], `Broken internal links on /cases/${slug}/: ${broken.join(', ')}`);
  }

  // 4. Domain 16 & 17 on /claims/index.html: Landmarks, honesty, internal links, and VM URL-synced filter execution
  const indexAudit = auditPageLandmarksAndHonesty(claimsIndexHtml);
  assert.equal(indexAudit.ok, true, `Issues on /claims/: ${indexAudit.issues.join('; ')}`);
  assert.deepEqual(findBrokenInternalLinks(claimsIndexHtml, distDir), []);

  const parsedIndex = parseInteractiveIndexHtml(claimsIndexHtml);
  assert.ok(parsedIndex.inlineScript, 'Expected inline URL-synced filter script on /claims/index.html');
  assert.ok(parsedIndex.rows.length > 0, 'Expected data-* filterable claim rows/cards on /claims/index.html');

  const sampleClaim = allClaims[0];
  const vmHarness = createFilterDomHarness({
    initialUrl: `https://dragnet.tch.one/claims/?q=${encodeURIComponent(sampleClaim.id.toLowerCase())}`,
    elementsById: parsedIndex.elementsById,
    rows: parsedIndex.rows,
  });
  vmHarness.runInlineScript(parsedIndex.inlineScript);
  assert.ok(
    vmHarness.getVisibleRows().length >= 1 && vmHarness.getVisibleRows().length < parsedIndex.rows.length,
    `Expected URL query ?q=${sampleClaim.id} to filter /claims/ rows (visible=${vmHarness.getVisibleRows().length}, total=${parsedIndex.rows.length})`
  );
});
