/**
 * Agent 10 — Independent Adversarial QA Suite (Node.js 22)
 * Domains 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, and 19
 *
 * Exercises scripts/validate-claims.mjs, scripts/validate-site.mjs, and all
 * core graph/staleness/chronology exports of src/lib/claims.ts.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import { validateSite } from '../scripts/validate-site.mjs';
import {
  validateClaims,
  computeChronologicalAdvance as valChronAdvance,
  computeClaimContentFingerprint as valContentFp,
  computeClaimEvidenceFingerprints as valEvidenceFps,
  computeCitationMaterialFingerprint as valCitFp,
  detectInferentialCycles as valDetectCycles,
  findWorkspaceOrDriveLeak,
} from '../scripts/validate-claims.mjs';
import {
  clearClaimsCache,
  loadClaimGraph,
  getAllClaims,
  getClaimsForCase,
  getPrincipalClaimsForCase,
  getCitationClaimBacklinkIndex,
  getClaimsForCitation,
  summarizeClaimSupport,
  topologicalSortClaims,
  computeGlobalClaimStats,
  computeChronologicalAdvance as libChronAdvance,
  computeReviewStaleness,
  normalizeCitationSortKey,
  isDocumentaryClaimType,
  isInterpretiveClaimType,
} from '../src/lib/claims.ts';

import {
  REPO_ROOT,
  BASELINE_COUNTS,
  EXPECTED_CASE_SLUGS,
  buildSyntheticLeakTokens,
  getForbiddenDiskSubstrings,
  verifyLedgerRevisionContinuity,
} from './helpers/contract_adapter.mjs';
import { createIsolatedRepoSandbox, runPythonScript } from './helpers/sandbox.mjs';

test('Live repository baseline & merged claim ledgers pass both validateSite and validateClaims with Node<->Python SHA-256 parity', () => {
  const siteRes = validateSite(REPO_ROOT);
  assert.equal(siteRes.ok, true, `validateSite failed: ${siteRes.errors.join('; ')}`);
  assert.equal(siteRes.stats.cases, BASELINE_COUNTS.cases);
  assert.equal(siteRes.stats.citations, BASELINE_COUNTS.citations);
  assert.equal(siteRes.stats.hostedScans, BASELINE_COUNTS.hostedScans);

  const claimRes = validateClaims({ rootDir: REPO_ROOT });
  assert.equal(claimRes.ok, true, `validateClaims failed: ${claimRes.errors.join('; ')}`);
  assert.ok(claimRes.stats.claimLedgers >= 4, `Expected >= 4 pilot claim ledgers, got ${claimRes.stats.claimLedgers}`);
  assert.ok(claimRes.stats.totalClaims >= 65, `Expected >= 65 claims, got ${claimRes.stats.totalClaims}`);
  assert.equal(claimRes.stats.staleReviews, 0);

  // Compare against Python validate_claims.py --json
  const pyRun = runPythonScript(path.join(REPO_ROOT, 'scripts', 'validate_claims.py'), ['--json']);
  assert.equal(pyRun.status, 0, `Python validate_claims.py failed: ${pyRun.stderr || pyRun.stdout}`);
  const pyJson = JSON.parse(pyRun.stdout);
  assert.equal(pyJson.ok, true);
  assert.deepEqual(pyJson.stats, claimRes.stats);

  // Verify src/lib/claims.ts loads cleanly and matches stored content_fingerprints on 100% of claims
  clearClaimsCache();
  const graph = loadClaimGraph({ rootDir: REPO_ROOT });
  assert.equal(graph.cycles.length, 0);
  assert.equal(graph.claims.length, claimRes.stats.totalClaims);
  for (const clm of graph.claims) {
    assert.equal(
      clm.fingerprint_matches_stored,
      true,
      `src/lib/claims.ts fingerprint mismatch on ${clm.id}`
    );
    // Newly extracted Phase B/D claims must default to 'unreviewed' unless backed by a non-stale review
    if (clm.reviews.length === 0) {
      assert.equal(clm.review_status, 'unreviewed', `${clm.id} has no reviews[] but status=${clm.review_status}`);
    }
  }

  const gStats = computeGlobalClaimStats({ rootDir: REPO_ROOT });
  assert.equal(gStats.hasCycles, false);
  assert.ok(gStats.principalClaims >= 4 * 3, `Expected >= 12 principal claims across >= 4 cases`);
  assert.ok(gStats.uniqueCitationsReferenced >= 150);
});

test('Zero literal forbidden workspace/cloud/session tokens exist anywhere on disk in tests/**', () => {
  const forbidden = getForbiddenDiskSubstrings();
  function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === '__pycache__' || entry.name.startsWith('.')) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else {
        const txt = fs.readFileSync(full, 'utf-8');
        for (const bad of forbidden) {
          assert.equal(
            txt.includes(bad),
            false,
            `Forbidden literal token found in ${path.relative(REPO_ROOT, full)}`
          );
        }
      }
    }
  }
  walk(path.join(REPO_ROOT, 'tests'));
});

test('Domains 1–11 & 19 Sweep: All 26 malformed ClaimLedger fixtures in tests/fixtures/invalid/ are rejected for exact target errors by validate-claims.mjs', () => {
  const invDir = path.join(REPO_ROOT, 'tests', 'fixtures', 'invalid');
  const files = fs.readdirSync(invDir).filter((f) => f.endsWith('.json')).sort();
  assert.equal(files.length, 26, `Expected 26 invalid ClaimLedger fixtures, found ${files.length}`);

  for (const fname of files) {
    const fpath = path.join(invDir, fname);
    const rawMeta = JSON.parse(fs.readFileSync(fpath, 'utf-8'))._qa_meta;
    assert.ok(rawMeta, `${fname} missing _qa_meta`);

    const sb = createIsolatedRepoSandbox({
      caseSlugs: ['hoodlum', 'gimmick', 'ballyhoo', 'jalopy', 'shill-shillaber'],
      copyExistingClaims: Boolean(rawMeta.copy_pilot_claims),
    });
    try {
      const targetName = rawMeta.target_filename || 'hoodlum.json';
      sb.writeFixtureJson(path.join('public', 'claims', targetName), fpath);
      const res = sb.validateSandboxClaims();

      assert.equal(
        res.ok,
        false,
        `Fixture ${fname} (Domain ${rawMeta.domain}) unexpectedly PASSED validation!`
      );

      for (const expectedSub of rawMeta.expected_error_substrings || []) {
        assert.ok(
          res.errors.some((e) => e.includes(expectedSub)),
          `Fixture ${fname} failed without expected diagnostic '${expectedSub}'. Actual errors:\n  - ${res.errors.join('\n  - ')}`
        );
      }

      // Prove stamped domain fixtures did NOT fail due to dummy content_fingerprint mismatch
      if (rawMeta.stamp_before_validate && !fname.startsWith('02')) {
        assert.equal(
          res.errors.some((e) => e.includes('content_fingerprint mismatch')),
          false,
          `Stamped fixture ${fname} should have valid content_fingerprint so only domain errors fire; got: ${res.errors.join('; ')}`
        );
      }
    } finally {
      sb.cleanup();
    }
  }
});

test('Positive Controls (Domains 4, 5, 9): Valid cross-case support, mutual lateral contextualizes/qualifies, and sort_order edits pass with zero errors', () => {
  const valDir = path.join(REPO_ROOT, 'tests', 'fixtures', 'valid_controls');
  const files = fs.readdirSync(valDir).filter((f) => f.endsWith('.json')).sort();
  assert.equal(files.length, 3);

  for (const fname of files) {
    const fpath = path.join(valDir, fname);
    const rawMeta = JSON.parse(fs.readFileSync(fpath, 'utf-8'))._qa_meta;
    const sb = createIsolatedRepoSandbox({
      caseSlugs: ['hoodlum', 'gimmick', 'ballyhoo'],
      copyExistingClaims: Boolean(rawMeta.copy_pilot_claims),
    });
    try {
      const targetName = rawMeta.target_filename || 'hoodlum.json';
      sb.writeFixtureJson(path.join('public', 'claims', targetName), fpath);
      const res = sb.validateSandboxClaims();
      assert.equal(
        res.ok,
        true,
        `Valid control ${fname} failed unexpectedly: ${res.errors.join('; ')}`
      );
    } finally {
      sb.cleanup();
    }
  }
});

test('Domain 5 Deep Graph Check: Cross-case inferential cycles are caught, topologicalSortClaims orders premises first, and parent hypotheses never auto-inherit supported', () => {
  // 1. Live pilot hypotheses prove non-inheritance on real case data
  const pilotHypotheses = [
    { id: 'CLM-1800-013', expectedAssessment: 'partially_supported' },
    { id: 'CLM-1100-011', expectedAssessment: 'partially_supported' },
        { id: 'CLM-1400-009', expectedAssessment: 'partially_supported' },
  ];

  for (const { id, expectedAssessment } of pilotHypotheses) {
    const summary = summarizeClaimSupport(id, { rootDir: REPO_ROOT });
    assert.ok(summary, `Expected pilot claim ${id} to exist`);
    assert.equal(isInterpretiveClaimType(summary.claim.type), true);
    assert.equal(summary.inheritsSupportFromChildren, false);
    assert.equal(summary.ownAssessment, expectedAssessment);

    // Confirm at least one upstream premise is 'supported' while parent remains un-promoted
    const supportedPremises = summary.inferentialPremiseClaims.filter(
      (p) => p.premise && p.premise.assessment === 'supported' && isDocumentaryClaimType(p.premise.type)
    );
    assert.ok(
      supportedPremises.length >= 1,
      `Expected ${id} to depend on >= 1 supported documentary claim while retaining '${expectedAssessment}'`
    );
  }

  // 2. Topological sort orders upstream premises strictly before downstream dependents
  const ballyhooClaims = getClaimsForCase('ballyhoo', { options: { rootDir: REPO_ROOT } });
  const topo = topologicalSortClaims(ballyhooClaims);
  assert.equal(topo.cycles.length, 0);
  const posById = new Map(topo.ordered.map((c, idx) => [c.id, idx]));
  for (const c of ballyhooClaims) {
    for (const upId of c.upstream_claim_ids) {
      if (posById.has(upId)) {
        assert.ok(
          posById.get(upId) < posById.get(c.id),
          `Expected upstream premise ${upId} before dependent ${c.id} in topological sort`
        );
      }
    }
  }

  // 3. Cross-case 2-node inferential cycle across ballyhoo.json <-> gimmick.json is caught
  const sb = createIsolatedRepoSandbox({
    caseSlugs: ['ballyhoo', 'gimmick'],
    copyExistingClaims: true,
  });
  try {
    const bPath = path.join(sb.tmpRoot, 'public', 'claims', 'ballyhoo.json');
    const gPath = path.join(sb.tmpRoot, 'public', 'claims', 'gimmick.json');
    const bData = JSON.parse(fs.readFileSync(bPath, 'utf-8'));
    const gData = JSON.parse(fs.readFileSync(gPath, 'utf-8'));

    bData.claims[0].evidence.push({
      ref: 'CLM-1100-001',
      relationship: 'depends_on',
      directness: 'indirect',
      reason: 'Synthetic cross-case link ballyhoo -> gimmick',
      witness_note: null,
    });
    gData.claims[0].evidence.push({
      ref: 'CLM-1800-001',
      relationship: 'supports',
      directness: 'indirect',
      reason: 'Synthetic cross-case link gimmick -> ballyhoo closing cycle',
      witness_note: null,
    });

    fs.writeFileSync(bPath, JSON.stringify(bData, null, 2) + '\n');
    fs.writeFileSync(gPath, JSON.stringify(gData, null, 2) + '\n');
    sb.stampSandboxClaims([bPath, gPath]);

    const res = sb.validateSandboxClaims();
    assert.equal(res.ok, false);
    assert.ok(
      res.errors.some((e) =>
        e.includes('Inferential claim dependency cycle detected: CLM-1100-001 -> CLM-1800-001 -> CLM-1100-001')
      ),
      `Expected cross-case cycle error, got: ${res.errors.join('; ')}`
    );
  } finally {
    sb.cleanup();
  }
});

test('Domain 9 Complete Stale-Review Matrix: Direct edit, CERT quote/date edit, WebP scan byte mutation, and 2-hop transitive depends_on edit invalidate review while preserving reviews[], whereas sort_order is invariant', () => {
  const sb = createIsolatedRepoSandbox({
    caseSlugs: ['ballyhoo'],
    copyExistingClaims: true,
    symlinkScans: false,
    copyScanSlugs: ['ballyhoo'],
  });

  try {
    const claimPath = path.join(sb.tmpRoot, 'public', 'claims', 'ballyhoo.json');
    const ledgerPath = path.join(sb.tmpRoot, 'public', 'ledgers', 'ballyhoo.json');

    // Inspect graph: CLM-1800-008 depends_on CLM-1800-007 which depends_on CLM-1800-006!
    // Find a CERT on CLM-1800-008 (or attach CERT-1800-010 which has a hosted WebP scan)
    const citLedger = JSON.parse(fs.readFileSync(ledgerPath, 'utf-8'));
    const hostedCit = citLedger.citations.find((c) => Boolean(c.scan?.hosted_path));
    assert.ok(hostedCit, 'Expected at least one hosted WebP scan in ballyhoo.json');

    const baseClaimLedger = JSON.parse(fs.readFileSync(claimPath, 'utf-8'));
    const c6 = baseClaimLedger.claims.find((c) => c.id === 'CLM-1800-006');
    const c7 = baseClaimLedger.claims.find((c) => c.id === 'CLM-1800-007');
    const c8 = baseClaimLedger.claims.find((c) => c.id === 'CLM-1800-008');
    assert.ok(c6 && c7 && c8, 'Expected 2-hop chain CLM-1800-008 -> CLM-1800-007 -> CLM-1800-006');

    if (!c8.evidence.some((e) => e.ref === hostedCit.id)) {
      c8.evidence.push({
        ref: hostedCit.id,
        relationship: 'contextualizes',
        directness: 'contextual',
        reason: 'Links hosted scan witness for Domain 9c byte-tamper test.',
        witness_note: null,
      });
    }
    fs.writeFileSync(claimPath, JSON.stringify(baseClaimLedger, null, 2) + '\n');
    sb.stampSandboxClaims([claimPath]);

    // Snapshot fingerprints via loadClaimGraph and attach a valid human review to CLM-1800-008
    const g0 = loadClaimGraph({ rootDir: sb.tmpRoot });
    const h8 = g0.claimById.get('CLM-1800-008');
    assert.ok(h8);

    const reviewedLedger = JSON.parse(fs.readFileSync(claimPath, 'utf-8'));
    const target8 = reviewedLedger.claims.find((c) => c.id === 'CLM-1800-008');
    target8.review_status = 'human_reviewed';
    target8.reviews = [
      {
        review_id: 'REV-1800-008-01',
        claim_id: 'CLM-1800-008',
        claim_revision: target8.revision,
        reviewer_id: 'Joshua Callahan',
        reviewer_kind: 'human',
        model_version: null,
        review_date: '2026-11-26',
        review_scopes: ['transcription', 'archival', 'linguistic_argument'],
        inspected_evidence_refs: target8.evidence.map((e) => e.ref),
        findings: 'Independently verified primary scan ink, masthead date, and dependency chain.',
        objections: [],
        material_fingerprint_at_review: h8.computed_content_fingerprint,
        evidence_fingerprints_at_review: h8.evidence_fingerprints,
        recommendation: 'uphold',
      },
    ];
    const cleanSnapshotJson = JSON.stringify(reviewedLedger, null, 2) + '\n';
    const cleanCitSnapshotJson = fs.readFileSync(ledgerPath, 'utf-8');
    const scanDiskPath = path.join(sb.tmpRoot, 'public', hostedCit.scan.hosted_path.replace(/^\/+/, ''));
    const cleanScanBytes = fs.readFileSync(scanDiskPath);

    const restoreCleanReviewedState = () => {
      fs.writeFileSync(claimPath, cleanSnapshotJson);
      fs.writeFileSync(ledgerPath, cleanCitSnapshotJson);
      fs.writeFileSync(scanDiskPath, cleanScanBytes);
      clearClaimsCache();
    };

    // Baseline check: valid human_reviewed state passes with 0 stale reviews
    restoreCleanReviewedState();
    const baseVal = sb.validateSandboxClaims();
    assert.equal(baseVal.ok, true, `Baseline human_reviewed failed: ${baseVal.errors.join('; ')}`);
    assert.ok(baseVal.stats.reviews >= 1);
    assert.equal(baseVal.stats.staleReviews, 0);

    // (9e) POSITIVE INVARIANCE: Changing sort_order, short_label, and case_section does NOT invalidate review!
    {
      restoreCleanReviewedState();
      const d = JSON.parse(cleanSnapshotJson);
      const t = d.claims.find((c) => c.id === 'CLM-1800-008');
      t.sort_order = 999;
      t.short_label = 'Reordered presentation label without semantic change';
      t.case_section = 'Appendix A: Reordered Display';
      fs.writeFileSync(claimPath, JSON.stringify(d, null, 2) + '\n');

      const res = sb.validateSandboxClaims();
      assert.equal(res.ok, true, `sort_order edit falsely invalidated review: ${res.errors.join('; ')}`);
      assert.equal(res.stats.staleReviews, 0);

      const g = loadClaimGraph({ rootDir: sb.tmpRoot });
      assert.equal(g.claimById.get('CLM-1800-008').reviews[0].is_stale, false);
    }

    // (9a) Direct claim statement edit invalidates human_reviewed while preserving reviews[]
    {
      restoreCleanReviewedState();
      const d = JSON.parse(cleanSnapshotJson);
      const t = d.claims.find((c) => c.id === 'CLM-1800-008');
      t.statement += ' [Post-review unverified clause added.]';
      fs.writeFileSync(claimPath, JSON.stringify(d, null, 2) + '\n');
      sb.stampSandboxClaims([claimPath]);

      const res = sb.validateSandboxClaims();
      assert.equal(res.ok, false, 'Expected mutated statement to invalidate active human_reviewed');
      assert.equal(res.stats.staleReviews, 1);
      assert.ok(res.errors.some((e) => e.includes("review_status 'human_reviewed' requires a non-stale upholding review")));

      const g = loadClaimGraph({ rootDir: sb.tmpRoot });
      const hydrated = g.claimById.get('CLM-1800-008');
      assert.equal(hydrated.reviews.length, 1, 'Historical reviews[] must be preserved');
      assert.equal(hydrated.reviews[0].is_stale, true);

      // Downgrading review_status to 'unreviewed' while keeping historical reviews[] passes cleanly!
      const afterStamp = JSON.parse(fs.readFileSync(claimPath, 'utf-8'));
      afterStamp.claims.find((c) => c.id === 'CLM-1800-008').review_status = 'unreviewed';
      fs.writeFileSync(claimPath, JSON.stringify(afterStamp, null, 2) + '\n');
      const downgradedRes = sb.validateSandboxClaims();
      assert.equal(downgradedRes.ok, true, `Downgraded stale claim should pass: ${downgradedRes.errors.join('; ')}`);
      assert.equal(downgradedRes.stats.reviews, baseVal.stats.reviews);
      assert.equal(downgradedRes.stats.staleReviews, 1);
    }

    // (9b) Underlying CERT-* verbatim_quote / date_display mutation invalidates review
    {
      restoreCleanReviewedState();
      const citData = JSON.parse(cleanCitSnapshotJson);
      const citTarget = citData.citations.find((c) => c.id === hostedCit.id);
      citTarget.verbatim_quote += ' [altered transcription]';
      citTarget.date_display = '1999';
      fs.writeFileSync(ledgerPath, JSON.stringify(citData, null, 2) + '\n');
      sb.stampSandboxClaims([claimPath]);

      const res = sb.validateSandboxClaims();
      assert.equal(res.ok, false, 'Expected CERT verbatim_quote/date edit to invalidate active review');
      assert.equal(res.stats.staleReviews, 1);
      const g = loadClaimGraph({ rootDir: sb.tmpRoot });
      assert.equal(g.claimById.get('CLM-1800-008').reviews[0].is_stale, true);
      assert.ok(
        g.claimById.get('CLM-1800-008').reviews[0].stale_reasons.some((r) => r.includes(hostedCit.id))
      );
    }

    // (9c) Hosted WebP scan byte mutation invalidates review
    {
      restoreCleanReviewedState();
      const mutatedBytes = Buffer.concat([cleanScanBytes, Buffer.from('QA_TAMPER')]);
      fs.writeFileSync(scanDiskPath, mutatedBytes);
      clearClaimsCache();
      sb.stampSandboxClaims([claimPath]);

      const res = sb.validateSandboxClaims();
      assert.equal(res.ok, false, 'Expected hosted WebP byte mutation to invalidate active review');
      assert.equal(res.stats.staleReviews, 1);
      const g = loadClaimGraph({ rootDir: sb.tmpRoot });
      assert.equal(g.claimById.get('CLM-1800-008').reviews[0].is_stale, true);
      assert.equal(g.claimById.get('CLM-1800-008').reviews.length, 1);
    }

    // (9d) 2-hop transitive depends_on mutation (editing CLM-1800-006 two hops upstream of CLM-1800-008)
    {
      restoreCleanReviewedState();
      const d = JSON.parse(cleanSnapshotJson);
      d.claims.find((c) => c.id === 'CLM-1800-006').statement += ' [Upstream 2-hop premise modified.]';
      fs.writeFileSync(claimPath, JSON.stringify(d, null, 2) + '\n');
      sb.stampSandboxClaims([claimPath]);

      const res = sb.validateSandboxClaims();
      assert.equal(res.ok, false, 'Expected 2-hop upstream depends_on edit to invalidate review on CLM-1800-008');
      assert.equal(res.stats.staleReviews, 1);
      const g = loadClaimGraph({ rootDir: sb.tmpRoot });
      assert.equal(g.claimById.get('CLM-1800-008').reviews[0].is_stale, true);
      assert.ok(
        g.claimById.get('CLM-1800-008').reviews[0].stale_reasons.some((r) => r.includes('CLM-1800-007'))
      );
    }
  } finally {
    clearClaimsCache();
    sb.cleanup();
  }
});

test('Domains 8 & 11 Revision Continuity & ID Anti-Recycling Auditor catches deleted IDs, truncated reviews[], and silent ID recycling', () => {
  const prev = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'public', 'claims', 'ballyhoo.json'), 'utf-8'));
  prev.claims[0].reviews = [
    {
      review_id: 'REV-1800-001-01',
      material_fingerprint_at_review: prev.claims[0].content_fingerprint,
    },
  ];

  // Valid append-only revision 2 passes continuity audit
  const validNext = structuredClone(prev);
  validNext.claims[0].revision = 2;
  validNext.claims[0].revision_history.push({
    revision: 2,
    date: '2026-11-26',
    author: 'QA Test',
    summary: 'Refined witness note.',
    content_fingerprint: 'b'.repeat(64),
  });
  validNext.claims[0].reviews.push({
    review_id: 'REV-1800-001-02',
    material_fingerprint_at_review: 'b'.repeat(64),
  });
  assert.equal(verifyLedgerRevisionContinuity(prev, validNext).ok, true);

  // Truncating reviews[] or recycling active documentary ID into unrelated derivation with 0 shared evidence fails
  const badNext = structuredClone(prev);
  badNext.claims[0].reviews = [];
  badNext.claims[0].type = 'derivation';
  badNext.claims[0].evidence = [
    { ref: 'CERT-1800-060', relationship: 'supports', directness: 'direct', reason: 'Unrelated', witness_note: null },
  ];
  badNext.claims.pop(); // also delete last claim ID

  const audit = verifyLedgerRevisionContinuity(prev, badNext);
  assert.equal(audit.ok, false);
  assert.ok(audit.errors.some((e) => e.includes('historical reviews[] truncated')));
  assert.ok(audit.errors.some((e) => e.includes('Active claim ID recycled across epistemic boundary')));
  assert.ok(audit.errors.some((e) => e.includes('was deleted instead of marked superseded')));
});

test('Domain 10 Chronological Precision Calculator & Sort-Key Defenses never fabricate exact days or months', () => {
  // 1. Year-only baseline vs exact-day attestation -> bounded strictly to 'year'
  const yrAdv = libChronAdvance('1866-12-14', 'day', '1872', 'year');
  assert.equal(yrAdv.effectivePrecision, 'year');
  assert.equal(yrAdv.years, 6);
  assert.equal(yrAdv.months, undefined);
  assert.equal(yrAdv.days, undefined);
  assert.equal(yrAdv.canonicalDisplay, '6 calendar years');
  assert.equal(/\b(?:month|day)s?\b/i.test(yrAdv.canonicalDisplay), false);
  assert.deepEqual(valChronAdvance('1866-12-14', 'day', '1872', 'year').canonicalDisplay, yrAdv.canonicalDisplay);

  // 2. Month-only baseline vs exact-day attestation -> bounded strictly to 'month'
  const moAdv = libChronAdvance('1866-12-14', 'day', '1877-08', 'month');
  assert.equal(moAdv.effectivePrecision, 'month');
  assert.equal(moAdv.years, 10);
  assert.equal(moAdv.months, 8);
  assert.equal(moAdv.days, undefined);
  assert.equal(moAdv.canonicalDisplay, '10 years and 8 months');
  assert.equal(/\bdays?\b/i.test(moAdv.canonicalDisplay), false);

  // 3. Leap-year vs non-leap-year day-exact subtraction
  const leap = libChronAdvance('1868-02-29', 'day', '1868-03-01', 'day');
  assert.equal(leap.totalDays, 1);
  assert.equal(leap.canonicalDisplay, '1 day');
  const nonLeap = libChronAdvance('1867-02-28', 'day', '1867-03-01', 'day');
  assert.equal(nonLeap.totalDays, 1);
  assert.equal(nonLeap.canonicalDisplay, '1 day');

  // 4. Circa dates mark comparable=false and never invent exact calendar months/days
  const circa = libChronAdvance('1866-12-14', 'day', 'c. 1875', 'circa');
  assert.equal(circa.comparable, false);
  assert.equal(circa.effectivePrecision, 'circa');
  assert.equal(/\b(?:month|day)s?\b/i.test(circa.canonicalDisplay), false);

  // 5. Defensive sort-key normalizer handles non-ISO annotations without NaN or fabrication
  assert.equal(normalizeCitationSortKey('1895 (misdated)', 1895), '1895-99-99');
  assert.equal(normalizeCitationSortKey('1901-11', 1901), '1901-11-99');
  assert.equal(normalizeCitationSortKey('1866-12-14', 1866), '1866-12-14');
});

test('Domain 19 Leak Detector & Post-1930 Scan-Rights Gate reject all 6 private-token classes and unauthorized post-1930 scans', () => {
  const synth = buildSyntheticLeakTokens();
  for (const [label, sample] of Object.entries(synth)) {
    const hit = findWorkspaceOrDriveLeak(`Embedded ${sample} inside note`);
    assert.ok(hit, `Expected findWorkspaceOrDriveLeak to catch ${label}`);
  }

  // Post-1930 scan-rights & >5MB scan size enforcement via validateSite
  const sb = createIsolatedRepoSandbox({ caseSlugs: ['hoodlum'] });
  try {
    const citInvPath = path.join(
      REPO_ROOT,
      'tests',
      'fixtures',
      'citation_invalid',
      '19_post_1930_uncleared_scan_citation_ledger.json'
    );
    sb.writeFixtureJson('public/ledgers/hoodlum.json', citInvPath);
    const res = validateSite(sb.tmpRoot);
    assert.equal(res.ok, false);
    assert.ok(res.errors.some((e) => e.includes('Post-1930 work (1948)')));
  } finally {
    sb.cleanup();
  }
});
