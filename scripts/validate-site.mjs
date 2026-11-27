#!/usr/bin/env node
/**
 * validate-site.mjs (DRAgNEt v3 + Claim Architecture v1.0)
 * --------------------------------------------------------
 * Zero-dependency Node.js validator executed automatically before/during `astro build`
 * (including inside Cloudflare Workers Builds, GitHub Actions, and local `npm run build`).
 *
 * Enforces:
 *   1. Workspace Sanitization: Zero Google Drive/Docs links or internal IDs in src/, public/, research-system/.
 *   2. Ledger Schema v3.0: Valid record_type & 4-level verification_level, non-duplicate IDs,
 *      mandatory human_verified_by/date on 'human_verified', external_recognition on 'externally_recognized'.
 *   3. Evidence & Image-Rights Gate: HTTPS source_url on attestations/hypotheses; hosted_path exists (<= 5 MB);
 *      works with publication_year > 1930 cannot bundle scans in public/scans/ unless rights_cleared === true.
 *   4. Bidirectional Cross-Referencing: Every CERT-... ID in a Case File's frontmatter or body exists in its ledger,
 *      and every published Case File is synchronized with public/data/open-questions.json when present.
 *   5. Editorial Lint: 'Last, First' authorCitation; zero raw 4-decimal harness scores or decimal-year strings.
 *   6. Claim-Level Architecture v1.0: Delegates to validateClaims() across public/claims/*.json.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateClaims } from './validate-claims.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const VALID_RECORD_TYPES = new Set(['attestation', 'contextual_evidence', 'hypothesis', 'rejected_lead']);
const VALID_VER_LEVELS = new Set(['discovered', 'agent_verified', 'human_verified', 'externally_recognized']);
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

const WORKSPACE_LEAK_RE =
  /(?:drive\.google\.com|docs\.google\.com|googledrive:\/\/|workspace_drive_folder_id|evidence_scans_folder_id|scan_evidence_drive_id)/i;
const RAW_SCORE_RE = /\b(?:SLPL|JW|jaro[_ -]?winkler|skeleton_similarity)\s*=\s*\d\.\d{3,4}\b/i;
const DECIMAL_YEAR_RE = /(?:-?\b\d+\.\d+\s*(?:yrs?|years?)\b)/i;
const CERT_ID_RE = /\bCERT-\d{3,4}-\d{3}[A-Za-z]?\b/g;

function walkFiles(dir, exts) {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.') || entry.name === 'node_modules' || entry.name === '__pycache__') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...walkFiles(full, exts));
    } else if (exts.has(path.extname(entry.name).toLowerCase())) {
      out.push(full);
    }
  }
  return out;
}

function extractFrontmatterField(fmText, key) {
  const re = new RegExp(`^${key}:\\s*(.+)$`, 'm');
  const m = fmText.match(re);
  if (!m) return '';
  return m[1].trim().replace(/^['"]|['"]$/g, '');
}

export function validateSite(rootDir = ROOT) {
  const errors = [];
  const casesDir = path.join(rootDir, 'src', 'content', 'cases');
  const ledgersDir = path.join(rootDir, 'public', 'ledgers');
  const claimsDir = path.join(rootDir, 'public', 'claims');
  const publicDir = path.join(rootDir, 'public');
  const r2ManifestPath = path.join(publicDir, 'data', 'r2-scan-manifest.json');
  const r2Manifest = fs.existsSync(r2ManifestPath)
    ? JSON.parse(fs.readFileSync(r2ManifestPath, 'utf-8'))
    : {};

  // 1. Check workspace leaks
  const checkExts = new Set(['.json', '.md', '.astro', '.ts', '.js', '.mjs', '.py']);
  for (const sub of ['src', 'public', 'research-system']) {
    for (const f of walkFiles(path.join(rootDir, sub), checkExts)) {
      const txt = fs.readFileSync(f, 'utf-8');
      const m = txt.match(WORKSPACE_LEAK_RE);
      if (m) {
        errors.push(`Workspace identifier/URL leak '${m[0]}' in ${path.relative(rootDir, f)}`);
      }
    }
  }

  // 2. Validate ledgers
  const ledgerMap = new Map();
  const ledgerFiles = fs.existsSync(ledgersDir)
    ? fs.readdirSync(ledgersDir).filter((f) => f.endsWith('.json')).sort()
    : [];
  if (ledgerFiles.length === 0) {
    errors.push('No JSON ledgers found in public/ledgers/');
  }

  let totalCitations = 0;
  let totalHostedScans = 0;

  for (const lf of ledgerFiles) {
    const lp = path.join(ledgersDir, lf);
    let data;
    try {
      data = JSON.parse(fs.readFileSync(lp, 'utf-8'));
    } catch (err) {
      errors.push(`${lf}: Invalid JSON (${err.message})`);
      continue;
    }

    if (data.schema_version !== '3.0') {
      errors.push(`${lf}: Expected schema_version '3.0', got '${data.schema_version}'`);
    }
    if (!Array.isArray(data.citations) || data.citations.length === 0) {
      errors.push(`${lf}: Missing or empty 'citations' array`);
      continue;
    }

    const seenIds = new Set();
    for (const c of data.citations) {
      const cid = String(c.id || '');
      if (!cid) {
        errors.push(`${lf}: Citation record missing 'id'`);
        continue;
      }
      if (seenIds.has(cid)) {
        errors.push(`${lf}: Duplicate citation id '${cid}'`);
      }
      seenIds.add(cid);

      if (!VALID_RECORD_TYPES.has(c.record_type)) {
        errors.push(`${lf} [${cid}]: Invalid record_type '${c.record_type}'`);
      }
      if (!VALID_VER_LEVELS.has(c.verification_level)) {
        errors.push(`${lf} [${cid}]: Invalid verification_level '${c.verification_level}'`);
      }
      if (c.verification_level === 'human_verified' && (!c.human_verified_by || !c.human_verified_date)) {
        errors.push(`${lf} [${cid}]: 'human_verified' requires human_verified_by and human_verified_date`);
      }
      if (c.verification_level === 'externally_recognized' && !c.external_recognition) {
        errors.push(`${lf} [${cid}]: 'externally_recognized' requires external_recognition`);
      }
      if (
        (c.record_type === 'attestation' || c.record_type === 'hypothesis') &&
        !String(c.source_url || '').startsWith('https://')
      ) {
        errors.push(`${lf} [${cid}]: ${c.record_type} requires an https:// source_url`);
      }

      const hosted = c.scan && c.scan.hosted_path;
      const pubYr = c.publication_year;
      if (hosted) {
        const diskPath = path.join(publicDir, String(hosted).replace(/^\/+/, ''));
        const r2Entry = r2Manifest[hosted];
        if (fs.existsSync(diskPath)) {
          const sz = fs.statSync(diskPath).size;
          if (sz > MAX_IMAGE_BYTES) {
            errors.push(`${lf} [${cid}]: Hosted scan '${hosted}' exceeds 5 MB (${sz} bytes)`);
          }
          totalHostedScans += 1;
        } else if (r2Entry && typeof r2Entry.bytes === 'number') {
          if (r2Entry.bytes > MAX_IMAGE_BYTES) {
            errors.push(`${lf} [${cid}]: R2-hosted scan '${hosted}' exceeds 5 MB (${r2Entry.bytes} bytes)`);
          }
          totalHostedScans += 1;
        } else {
          errors.push(`${lf} [${cid}]: Missing hosted scan file '${hosted}' (not in public/scans/ or r2-scan-manifest.json)`);
        }
        if (typeof pubYr === 'number' && pubYr > 1930 && c.scan.rights_cleared !== true) {
          errors.push(
            `${lf} [${cid}]: Post-1930 work (${pubYr}) may not bundle hosted scan '${hosted}' without rights_cleared=true`
          );
        }
      }
    }

    ledgerMap.set(path.basename(lf, '.json'), seenIds);
    totalCitations += seenIds.size;
  }

  // 3. Validate Case Files & bidirectional cross-references
  const caseFiles = fs.existsSync(casesDir)
    ? fs.readdirSync(casesDir).filter((f) => f.endsWith('.md')).sort()
    : [];
  if (caseFiles.length === 0) {
    errors.push('No Case File Markdown files found in src/content/cases/');
  }

  const openQuestionsPath = path.join(publicDir, 'data', 'open-questions.json');
  let openTargetsById = null;
  if (fs.existsSync(openQuestionsPath)) {
    try {
      const oqData = JSON.parse(fs.readFileSync(openQuestionsPath, 'utf-8'));
      if (Array.isArray(oqData.targets)) {
        openTargetsById = new Map(oqData.targets.map((t) => [String(t.id || ''), t]));
      }
    } catch (err) {
      errors.push(`open-questions.json: Invalid JSON (${err.message})`);
    }
  }

  for (const cf of caseFiles) {
    const cp = path.join(casesDir, cf);
    const caseSlug = path.basename(cf, '.md');
    const raw = fs.readFileSync(cp, 'utf-8');
    if (!raw.startsWith('---')) {
      errors.push(`${cf}: Missing YAML frontmatter block`);
      continue;
    }
    const endIdx = raw.indexOf('\n---', 3);
    if (endIdx === -1) {
      errors.push(`${cf}: Unclosed YAML frontmatter block`);
      continue;
    }
    const fmText = raw.slice(4, endIdx);
    const ledgerSlug = extractFrontmatterField(fmText, 'ledgerSlug');
    if (!ledgerMap.has(ledgerSlug)) {
      errors.push(`${cf}: ledgerSlug '${ledgerSlug}' has no matching public/ledgers/${ledgerSlug}.json`);
      continue;
    }

    const targetId = extractFrontmatterField(fmText, 'targetId');
    if (openTargetsById && targetId && openTargetsById.has(targetId)) {
      const tgt = openTargetsById.get(targetId);
      if (tgt.status !== 'published_case' || tgt.case_slug !== caseSlug) {
        errors.push(
          `${cf}: open-questions.json target '${targetId}' must have status='published_case' and case_slug='${caseSlug}' (got status='${tgt.status}', case_slug='${tgt.case_slug}')`
        );
      }
    }

    const authorCite = extractFrontmatterField(fmText, 'authorCitation');
    if (!authorCite.includes(',')) {
      errors.push(`${cf}: authorCitation '${authorCite}' must use 'Last, First' format`);
    }

    if (RAW_SCORE_RE.test(raw)) {
      errors.push(`${cf}: Contains raw 4-decimal harness score; remove uncalibrated string scores from public prose`);
    }
    if (DECIMAL_YEAR_RE.test(raw)) {
      const m = raw.match(DECIMAL_YEAR_RE);
      errors.push(`${cf}: Uses decimal years ('${m[0]}'); express antedatings in years, months, and days`);
    }

    const validIds = ledgerMap.get(ledgerSlug);
    const mentioned = new Set(raw.match(CERT_ID_RE) || []);
    for (const refId of [...mentioned].sort()) {
      if (!validIds.has(refId)) {
        errors.push(`${cf}: References citation '${refId}' which is absent from ${ledgerSlug}.json`);
      }
    }
  }

  // 4. Validate v1.0 Claim Ledgers
  const claimFiles = fs.existsSync(claimsDir)
    ? fs.readdirSync(claimsDir).filter((f) => f.endsWith('.json')).sort()
    : [];
  const allowEmptyClaims = caseFiles.length < 18 && claimFiles.length === 0;
  const claimRes = validateClaims({
    rootDir,
    allowEmpty: allowEmptyClaims,
    requireAllCases: caseFiles.length >= 18,
  });
  if (!claimRes.ok) {
    for (const ce of claimRes.errors) {
      errors.push(`[claims] ${ce}`);
    }
  }

  return {
    ok: errors.length === 0,
    errors,
    stats: {
      cases: caseFiles.length,
      ledgers: ledgerFiles.length,
      citations: totalCitations,
      hostedScans: totalHostedScans,
      claimLedgers: claimRes.stats?.claimLedgers ?? 0,
      claims: claimRes.stats?.totalClaims ?? 0,
    },
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const res = validateSite(ROOT);
  if (!res.ok) {
    console.error(`VALIDATION FAILED with ${res.errors.length} error(s):`);
    for (const e of res.errors) console.error(`  - ${e}`);
    process.exit(1);
  }
  console.log(
    `STRUCTURAL_AND_SCHEMA_CHECKS_PASSED (${res.stats.cases} case files, ${res.stats.citations} ledger citations, ${res.stats.claims} claims across ${res.stats.claimLedgers} claim ledgers, ${res.stats.hostedScans} pre-1931 scans verified; diplomatic transcription accuracy still requires human philological inspection).`
  );
}
