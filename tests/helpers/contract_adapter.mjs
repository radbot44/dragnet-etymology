/**
 * Zero-dependency contract discovery, baseline route manifest, revision-continuity
 * verifier, and dynamic runtime leak-token builder for Agent 10 QA.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(__dirname, '..', '..');

export const BASELINE_COUNTS = Object.freeze({
  cases: 18,
  ledgers: 18,
  citations: 1215,
  attestations: 599,
  hypotheses: 183,
  contextualEvidence: 166,
  rejectedLeads: 267,
  hostedScans: 1066,
  staticHtmlPages: 1240,
  openQuestionTargets: 160,
});

export const EXPECTED_CASE_SLUGS = Object.freeze([
  'ballyhoo',
  'gimmick',
  'grifter',
  'hobo',
  'hokum',
  'hoodlum',
  'jalopy',
  'jamboree',
  'jinx',
  'malarkey',
  'moolah',
  'phoney',
  'shenanigans',
  'shill-shillaber',
  'skedaddle',
  'skulduggery',
  'whole-shebang',
  'yegg',
]);

/**
 * Construct synthetic workspace/cloud-drive leak strings dynamically at runtime
 * so zero literal forbidden tokens ever appear in committed repository files.
 */
export function buildSyntheticLeakTokens() {
  const gHost = ['drive', 'google', 'com'].join('.');
  const dHost = ['docs', 'google', 'com'].join('.');
  const gScheme = ['googledrive', '://'].join('');
  const wkPrefix = '/' + ['working', 'dir'].join('_') + '/synthetic_qa_probe/file.json';
  const hexSession = 'c_' + '9f8e7d6c5b4a3210';
  const rawDriveId = '1' + 'QaSyntheticDriveIdToken9876543210AbCd';
  return {
    cloudDriveUrl: `https://${gHost}/file/d/1SyntheticQaToken999/view`,
    cloudDocsUrl: `https://${dHost}/document/d/1SyntheticQaDoc999/edit`,
    cloudSchemeUri: `${gScheme}synthetic_folder_999/scan.png`,
    sandboxPath: wkPrefix,
    sessionHexId: hexSession,
    rawDriveId,
  };
}

export function getForbiddenDiskSubstrings() {
  const synth = buildSyntheticLeakTokens();
  return [
    ['drive', 'google', 'com'].join('.'),
    ['docs', 'google', 'com'].join('.'),
    ['googledrive', '://'].join(''),
    '/' + ['working', 'dir'].join('_') + '/',
    '/' + ['home', 'spark'].join('/') + '/',
    synth.sessionHexId,
    synth.rawDriveId,
  ];
}

export function hydrateFixturePlaceholders(rawJsonText) {
  const tokens = buildSyntheticLeakTokens();
  return rawJsonText
    .replaceAll('__QA_SYNTHETIC_CLOUD_DRIVE_URL__', tokens.cloudDriveUrl)
    .replaceAll('__QA_SYNTHETIC_CLOUD_DOCS_URL__', tokens.cloudDocsUrl)
    .replaceAll('__QA_SYNTHETIC_CLOUD_SCHEME_URI__', tokens.cloudSchemeUri)
    .replaceAll('__QA_SYNTHETIC_SANDBOX_PATH__', tokens.sandboxPath)
    .replaceAll('__QA_SYNTHETIC_SESSION_HEX_ID__', tokens.sessionHexId)
    .replaceAll('__QA_SYNTHETIC_RAW_DRIVE_ID__', tokens.rawDriveId);
}

/**
 * Compute the exact 1,240 baseline static HTML relative paths under dist/
 * (7 top-level static pages + 18 case pages + 1,215 citation pages) plus
 * 18 .bib endpoints, rss.xml, and sitemap.xml.
 */
export function collectExpectedBaselineRoutes(rootDir = REPO_ROOT) {
  const topHtml = [
    'index.html',
    '404.html',
    'about/index.html',
    'citations/index.html',
    'open-questions/index.html',
    'protocols/index.html',
    'submit/index.html',
  ];
  const caseHtml = EXPECTED_CASE_SLUGS.map((s) => `cases/${s}/index.html`);
  const caseBib = EXPECTED_CASE_SLUGS.map((s) => `cases/${s}.bib`);

  const ledgersDir = path.join(rootDir, 'public', 'ledgers');
  const citationSlugs = [];
  for (const lf of fs.readdirSync(ledgersDir).filter((f) => f.endsWith('.json')).sort()) {
    const data = JSON.parse(fs.readFileSync(path.join(ledgersDir, lf), 'utf-8'));
    for (const c of data.citations || []) {
      citationSlugs.push(c.slug);
    }
  }
  citationSlugs.sort();
  const citationHtml = citationSlugs.map((s) => `citations/${s}/index.html`);

  return {
    htmlRoutes: [...topHtml, ...caseHtml, ...citationHtml],
    bibRoutes: caseBib,
    xmlRoutes: ['rss.xml', 'sitemap.xml'],
    citationSlugs,
  };
}

/**
 * Inspect which integration workstreams are currently merged into rootDir.
 */
export function probeIntegrationState(rootDir = REPO_ROOT) {
  const schemaPath = path.join(rootDir, 'schemas', 'claim-ledger.schema.json');
  const claimsDir = path.join(rootDir, 'public', 'claims');
  const nodeClaimVal = path.join(rootDir, 'scripts', 'validate-claims.mjs');
  const pyClaimVal = path.join(rootDir, 'scripts', 'validate_claims.py');
  const claimsLibPath = path.join(rootDir, 'src', 'lib', 'claims.ts');
  const claimReviewCli = path.join(rootDir, 'scripts', 'record_claim_review.py');
  const claimsIndexAstro = path.join(rootDir, 'src', 'pages', 'claims', 'index.astro');
  const claimDetailAstro = path.join(rootDir, 'src', 'pages', 'claims', '[id].astro');
  const distDir = path.join(rootDir, 'dist');
  const distClaimsIndex = path.join(distDir, 'claims', 'index.html');

  const claimFiles = fs.existsSync(claimsDir)
    ? fs.readdirSync(claimsDir).filter((f) => f.endsWith('.json')).sort()
    : [];

  const packagerPath = path.join(rootDir, 'scripts', 'package_release_assets.py');
  const packagerText = fs.existsSync(packagerPath) ? fs.readFileSync(packagerPath, 'utf-8') : '';
  const hasClaimAwarePackager = packagerText.includes('public/claims') || packagerText.includes('"claims"');

  const addCasePath = path.join(rootDir, 'scripts', 'add_case.py');
  const addCaseText = fs.existsSync(addCasePath) ? fs.readFileSync(addCasePath, 'utf-8') : '';
  const hasClaimAwareIngester = addCaseText.includes('validate_claims') || addCaseText.includes('claims');

  const siteValPath = path.join(rootDir, 'scripts', 'validate-site.mjs');
  const siteValText = fs.existsSync(siteValPath) ? fs.readFileSync(siteValPath, 'utf-8') : '';
  const hasSiteGateWired = siteValText.includes('validate-claims') || siteValText.includes('validateClaims');

  return {
    hasSchema: fs.existsSync(schemaPath),
    hasClaimsLib: fs.existsSync(claimsLibPath),
    hasNodeValidator: fs.existsSync(nodeClaimVal),
    hasPyValidator: fs.existsSync(pyClaimVal),
    claimFiles,
    claimFileCount: claimFiles.length,
    hasClaimLedgers: claimFiles.length > 0,
    hasAll18ClaimLedgers: claimFiles.length === BASELINE_COUNTS.cases,
    hasClaimReviewCli: fs.existsSync(claimReviewCli),
    hasClaimAwarePackager,
    hasClaimAwareIngester,
    hasSiteGateWired,
    hasClaimsUiSource: fs.existsSync(claimsIndexAstro) && fs.existsSync(claimDetailAstro),
    hasBuiltDist: fs.existsSync(path.join(distDir, 'index.html')),
    hasBuiltClaimsHtml: fs.existsSync(distClaimsIndex),
  };
}

/**
 * Independent QA continuity & anti-recycling check across two revisions of a ClaimLedger
 * (Domains 8 & 11):
 *   1. Existing CLM-* IDs are never deleted on revision/merge.
 *   2. Historical revision_history[] and reviews[] entries are strictly append-only.
 *   3. An active CLM-* ID cannot be silently recycled to an unrelated claim (flipping
 *      documentary <-> interpretive kind while replacing 100% of its evidence refs)
 *      instead of marking the old ID 'superseded' and minting a monotonic successor.
 */
export function verifyLedgerRevisionContinuity(prevLedger, nextLedger) {
  const errors = [];
  const docSet = new Set(['attestation', 'antedating', 'negative_evidence', 'source_relationship']);
  const nextById = new Map((nextLedger.claims || []).map((c) => [c.id, c]));

  for (const prev of prevLedger.claims || []) {
    const next = nextById.get(prev.id);
    if (!next) {
      errors.push(`Permanent claim ID '${prev.id}' was deleted instead of marked superseded or withdrawn`);
      continue;
    }

    // Check append-only revision_history[]
    const prevHist = prev.revision_history || [];
    const nextHist = next.revision_history || [];
    if (nextHist.length < prevHist.length) {
      errors.push(`${prev.id}: revision_history truncated (${prevHist.length} -> ${nextHist.length})`);
    } else {
      for (let i = 0; i < prevHist.length; i++) {
        if (
          prevHist[i].revision !== nextHist[i].revision ||
          prevHist[i].content_fingerprint !== nextHist[i].content_fingerprint
        ) {
          errors.push(`${prev.id}: historical revision_history[${i}] mutated or overwritten`);
        }
      }
    }

    // Check append-only reviews[]
    const prevRevs = prev.reviews || [];
    const nextRevs = next.reviews || [];
    if (nextRevs.length < prevRevs.length) {
      errors.push(`${prev.id}: historical reviews[] truncated (${prevRevs.length} -> ${nextRevs.length})`);
    } else {
      for (let i = 0; i < prevRevs.length; i++) {
        if (
          prevRevs[i].review_id !== nextRevs[i].review_id ||
          prevRevs[i].material_fingerprint_at_review !== nextRevs[i].material_fingerprint_at_review
        ) {
          errors.push(`${prev.id}: historical reviews[${i}] ('${prevRevs[i].review_id}') was overwritten or altered`);
        }
      }
    }

    // Detect silent ID recycling to an unrelated claim while remaining 'active'
    if (next.lifecycle_status === 'active') {
      const prevDoc = docSet.has(prev.type);
      const nextDoc = docSet.has(next.type);
      const prevRefs = new Set((prev.evidence || []).map((e) => e.ref));
      const nextRefs = new Set((next.evidence || []).map((e) => e.ref));
      const overlap = [...prevRefs].filter((r) => nextRefs.has(r)).length;
      if (prevDoc !== nextDoc && prevRefs.size > 0 && overlap === 0) {
        errors.push(
          `${prev.id}: Active claim ID recycled across epistemic boundary (${prev.type} -> ${next.type}) with zero shared evidence; supersede ${prev.id} and mint a new monotonic ID`
        );
      }
    }
  }

  return { ok: errors.length === 0, errors };
}
