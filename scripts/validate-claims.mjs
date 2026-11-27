#!/usr/bin/env node
/**
 * validate-claims.mjs (DRAgNEt Claim-Level Evidence Architecture v1.0)
 * --------------------------------------------------------------------
 * Zero-dependency Node.js validator & deterministic fingerprint stamper.
 * Implements identical structural, graph, chronological, provenance,
 * fingerprinting, and sanitization rules to scripts/validate_claims.py.
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_ROOT = path.resolve(__dirname, '..');

export const DOCUMENTARY_TYPES = new Set([
  'attestation',
  'antedating',
  'negative_evidence',
  'source_relationship',
]);

export const INTERPRETIVE_TYPES = new Set([
  'semantic',
  'historical_context',
  'transmission',
  'derivation',
  'phonological',
  'rebuttal',
]);

export const VALID_CLAIM_TYPES = new Set([...DOCUMENTARY_TYPES, ...INTERPRETIVE_TYPES]);
export const VALID_ASSESSMENTS = new Set([
  'unassessed',
  'supported',
  'partially_supported',
  'inconclusive',
  'contradicted',
]);
export const UNRESOLVED_ASSESSMENTS = new Set([
  'unassessed',
  'partially_supported',
  'inconclusive',
]);
export const VALID_REVIEW_STATUSES = new Set([
  'unreviewed',
  'agent_reviewed',
  'independently_agent_reviewed',
  'human_reviewed',
]);
export const VALID_LIFECYCLE_STATUSES = new Set(['active', 'superseded', 'withdrawn']);
export const VALID_PRECISIONS = new Set(['day', 'month', 'year', 'circa']);
export const VALID_RELATIONSHIPS = new Set([
  'supports',
  'contradicts',
  'weakens',
  'qualifies',
  'contextualizes',
  'depends_on',
]);
export const INFERENTIAL_RELATIONSHIPS = new Set(['depends_on', 'supports']);
export const VALID_DIRECTNESS = new Set(['direct', 'indirect', 'contextual']);
export const VALID_COMPARISON_KINDS = new Set([
  'earlier_same_sense',
  'earlier_spelling',
  'earlier_derivative_or_inflected',
  'proper_name_precursor',
  'earliest_in_search_scope',
  'earliest_reported_by_authority',
]);
export const STRICT_ADVANCING_KINDS = new Set([
  'earlier_same_sense',
  'earlier_spelling',
  'earlier_derivative_or_inflected',
  'proper_name_precursor',
]);
export const VALID_INSPECTION_MODES = new Set([
  'directly_inspected',
  'inherited_from_existing_research',
]);
export const VALID_REVIEWER_KINDS = new Set(['agent', 'independent_agent', 'human']);
export const VALID_REVIEW_SCOPES = new Set([
  'structural',
  'transcription',
  'archival',
  'baseline',
  'linguistic_argument',
]);
export const VALID_RECOMMENDATIONS = new Set([
  'uphold',
  'revise',
  'downgrade',
  'contradict',
  'withdraw',
  'needs_human_review',
]);

const ALLOWED_LEDGER_KEYS = new Set([
  'schema_version',
  'claim_ledger_id',
  'case_slug',
  'case_number',
  'target_id',
  'headword',
  'updated_at',
  'summary_note',
  'claims',
]);

const ALLOWED_CLAIM_KEYS = new Set([
  'id',
  'slug',
  'case_slug',
  'headword',
  'target_lexeme',
  'case_section',
  'short_label',
  'statement',
  'rationale',
  'type',
  'assessment',
  'review_status',
  'is_principal',
  'sort_order',
  'lifecycle_status',
  'revision',
  'supersedes',
  'superseded_by',
  'evidence_boundary',
  'limitations',
  'resolution_criteria',
  'evidence',
  'antedating_baseline',
  'negative_evidence_bounds',
  'content_fingerprint',
  'revision_history',
  'reviews',
  'external_recognition',
]);

const ALLOWED_BOUNDARY_KEYS = new Set([
  'establishes',
  'does_not_establish',
  'remaining_uncertainty',
]);

const ALLOWED_EVIDENCE_KEYS = new Set([
  'ref',
  'relationship',
  'directness',
  'reason',
  'witness_note',
]);

const ALLOWED_ANTEDATING_KEYS = new Set([
  'authority',
  'entry_and_sense',
  'edition_or_revision',
  'baseline_date',
  'baseline_date_precision',
  'source_url_or_ref',
  'checked_date',
  'comparison_kind',
  'advancing_citation_ref',
  'attested_date',
  'attested_date_precision',
  'computed_advance_display',
  'inspection_mode',
]);

const ALLOWED_NEGATIVE_KEYS = new Set([
  'corpus_identity',
  'search_date',
  'search_period',
  'query_terms',
  'search_method',
  'corpus_coverage',
  'known_limitations',
  'qualifying_results_count',
]);

const ALLOWED_REVISION_KEYS = new Set([
  'revision',
  'date',
  'author',
  'summary',
  'content_fingerprint',
]);

const ALLOWED_REVIEW_KEYS = new Set([
  'review_id',
  'claim_id',
  'claim_revision',
  'reviewer_id',
  'reviewer_kind',
  'model_version',
  'review_date',
  'review_scopes',
  'inspected_evidence_refs',
  'findings',
  'objections',
  'material_fingerprint_at_review',
  'evidence_fingerprints_at_review',
  'recommendation',
]);

const ALLOWED_EXTERNAL_REC_KEYS = new Set([
  'recognizer',
  'publication',
  'date',
  'url_or_ref',
  'exact_scope',
]);

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const CASE_NUMBER_RE = /^Case (\d{3,4})$/;
const TARGET_ID_RE = /^TGT-\d{3,4}$/;
const CLAIM_ID_RE = /^CLM-(\d{3,4})-(\d{3})$/;
const CLAIM_SLUG_RE = /^clm-\d{3,4}-\d{3}$/;
const CERT_ID_RE = /^CERT-\d{3,4}-\d{3}[A-Za-z]?$/;
const REVIEW_ID_RE = /^REV-\d{3,4}-\d{3}-\d{2,3}$/;
const SHA256_RE = /^[0-9a-f]{64}$/;
const PARTIAL_ISO_DATE_RE = /^\d{4}(?:-\d{2}(?:-\d{2})?)?$/;

const FORBIDDEN_SCORE_KEY_RE =
  /(?:confidence|probability|likelihood|certainty_score|bayesian|posterior|prior_score|slpl_score|jw_score)/i;
const WORKSPACE_LEAK_RE = new RegExp(
  [
    'drive[.]google[.]com',
    'docs[.]google[.]com',
    'googledrive[:][/][/]',
    'workspace[_]drive[_]folder[_]id',
    'evidence[_]scans[_]folder[_]id',
    'scan[_]evidence[_]drive[_]id',
    '\\bDrive\\s+ID\\b',
    '[/]working[_]dir[/]',
    '[/]home[/]spark[/]',
    '\\bwt-agent-\\d+\\b',
    '\\bc_[0-9a-f]{12,}\\b',
  ].join('|'),
  'i'
);
const RAW_GDRIVE_ID_RE =
  /(?<![A-Za-z0-9_/-])(?:1[A-Za-z0-9_-]{27,49}|0B[A-Za-z0-9_-]{26,48})(?![A-Za-z0-9_/-])/g;

export function findWorkspaceOrDriveLeak(text) {
  const m = String(text ?? '').match(WORKSPACE_LEAK_RE);
  if (m) return m[0];
  for (const gm of String(text ?? '').matchAll(RAW_GDRIVE_ID_RE)) {
    const tok = gm[0];
    if (/[A-Z]/.test(tok) && /[a-z]/.test(tok) && /\d/.test(tok)) {
      return tok;
    }
  }
  return null;
}

function walkCheckedTextFiles(dirPath) {
  const out = [];
  if (!fs.existsSync(dirPath)) return out;
  for (const entry of fs.readdirSync(dirPath, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue;
    const full = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      out.push(...walkCheckedTextFiles(full));
    } else if (['.json', '.md', '.ts', '.mjs'].includes(path.extname(entry.name).toLowerCase())) {
      out.push(full);
    }
  }
  return out;
}
const DECIMAL_YEAR_RE = /(?:-?\b\d+\.\d+\s*(?:yrs?|years?)\b)/i;
const RAW_SCORE_RE =
  /\b(?:SLPL|JW|jaro[_ -]?winkler|skeleton_similarity|confidence(?:_score)?)\s*(?:=|:)\s*\d\.\d{2,4}\b/i;
const PCT_CONFIDENCE_RE = /\b\d{1,3}(?:\.\d+)?%\s*(?:confidence|certain|probability|likely)\b/i;
const NON_HUMAN_REVIEWER_RE =
  /\b(?:agent|bot|claude|gpt|gemini|llm|openai|anthropic|dragnet|pipeline|automated|system)\b/i;

const WHITESPACE_COLLAPSE_RE = /[\t\n\v\f\r \u00a0\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]+/g;

export function normalizeText(value) {
  return String(value ?? '').normalize('NFC').replace(WHITESPACE_COLLAPSE_RE, ' ').trim();
}

export function compareCodePoints(a, b) {
  if (a === b) return 0;
  const pa = Array.from(a);
  const pb = Array.from(b);
  const len = Math.min(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const ca = pa[i].codePointAt(0);
    const cb = pb[i].codePointAt(0);
    if (ca !== cb) return ca - cb;
  }
  return pa.length - pb.length;
}

export function canonicalJson(value) {
  if (value === null || value === undefined) return 'null';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error(`Non-finite number in canonicalJson: ${value}`);
    return String(value);
  }
  if (typeof value === 'string') return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item)).join(',')}]`;
  }
  if (typeof value === 'object') {
    const keys = Object.keys(value).sort(compareCodePoints);
    return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(value[k])}`).join(',')}}`;
  }
  throw new Error(`Unsupported value type in canonicalJson: ${typeof value}`);
}

export function sha256Hex(input) {
  return crypto.createHash('sha256').update(input).digest('hex');
}

export function daysInGregorianMonth(year, month) {
  if (month < 1 || month > 12) return 0;
  if (month === 2) {
    const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
    return leap ? 29 : 28;
  }
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

export function isValidIsoCalendarDate(dateStr) {
  if (typeof dateStr !== 'string') return false;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr);
  if (!m) return false;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (year < 1000 || year > 2999 || month < 1 || month > 12) return false;
  const maxDay = daysInGregorianMonth(year, month);
  return day >= 1 && day <= maxDay;
}

export function parseHistoricalDateByPrecision(rawDate, precision) {
  if (typeof rawDate !== 'string') return null;
  const trimmed = normalizeText(rawDate);
  if (precision === 'day') {
    if (!isValidIsoCalendarDate(trimmed)) return null;
    const [y, m, d] = trimmed.split('-').map(Number);
    return { raw: trimmed, precision, year: y, month: m, day: d };
  }
  if (precision === 'month') {
    const m = /^(\d{4})-(\d{2})$/.exec(trimmed);
    if (!m) return null;
    const year = Number(m[1]);
    const month = Number(m[2]);
    if (year < 1000 || year > 2999 || month < 1 || month > 12) return null;
    return { raw: trimmed, precision, year, month };
  }
  if (precision === 'year') {
    const m = /^(\d{4})$/.exec(trimmed);
    if (!m) return null;
    const year = Number(m[1]);
    if (year < 1000 || year > 2999) return null;
    return { raw: trimmed, precision, year };
  }
  if (precision === 'circa') {
    const m = /^(?:c\.\s*)?(\d{4})(?:[–-](\d{4}))?$/.exec(trimmed);
    if (!m) return null;
    const year = Number(m[1]);
    const endYear = m[2] ? Number(m[2]) : undefined;
    if (year < 1000 || year > 2999) return null;
    if (endYear !== undefined && (endYear < year || endYear > 2999)) return null;
    return { raw: trimmed, precision, year, endYear };
  }
  return null;
}

const PRECISION_RANK = { circa: 0, year: 1, month: 2, day: 3 };

function formatUnits(parts) {
  if (parts.length === 0) return '0 days';
  if (parts.length === 1) return parts[0];
  if (parts.length === 2) return `${parts[0]} and ${parts[1]}`;
  return `${parts.slice(0, -1).join(', ')}, and ${parts[parts.length - 1]}`;
}

export function computeChronologicalAdvance(
  attestedDate,
  attestedPrecision,
  baselineDate,
  baselinePrecision
) {
  const rank = Math.min(
    PRECISION_RANK[attestedPrecision] ?? -1,
    PRECISION_RANK[baselinePrecision] ?? -1
  );
  const effectivePrecision =
    rank === 3 ? 'day' : rank === 2 ? 'month' : rank === 1 ? 'year' : 'circa';

  const att = parseHistoricalDateByPrecision(attestedDate, attestedPrecision);
  const base = parseHistoricalDateByPrecision(baselineDate, baselinePrecision);
  if (!att || !base) {
    return {
      comparable: false,
      effectivePrecision,
      isStrictlyEarlier: null,
      isSameAtPrecision: null,
      canonicalDisplay: 'Invalid date format for declared precision',
    };
  }

  if (effectivePrecision === 'circa') {
    const approxDiff = base.year - (att.endYear ?? att.year);
    return {
      comparable: false,
      effectivePrecision: 'circa',
      isStrictlyEarlier: approxDiff > 0 ? true : null,
      isSameAtPrecision: approxDiff === 0,
      canonicalDisplay:
        approxDiff > 0
          ? `circa comparison (approximately ${approxDiff} ${approxDiff === 1 ? 'year' : 'years'}; ${att.raw} vs. ${base.raw})`
          : `circa comparison (${att.raw} vs. ${base.raw})`,
    };
  }

  if (effectivePrecision === 'year') {
    const years = base.year - att.year;
    if (years === 0) {
      return {
        comparable: true,
        effectivePrecision: 'year',
        isStrictlyEarlier: false,
        isSameAtPrecision: true,
        years: 0,
        canonicalDisplay: '0 calendar years (same calendar year)',
      };
    }
    const absY = Math.abs(years);
    const label = `${absY} calendar ${absY === 1 ? 'year' : 'years'}`;
    return {
      comparable: true,
      effectivePrecision: 'year',
      isStrictlyEarlier: years > 0,
      isSameAtPrecision: false,
      years,
      canonicalDisplay: years > 0 ? label : `postdates baseline by ${label}`,
    };
  }

  if (effectivePrecision === 'month') {
    const attMonths = att.year * 12 + (att.month - 1);
    const baseMonths = base.year * 12 + (base.month - 1);
    const totalMonths = baseMonths - attMonths;
    if (totalMonths === 0) {
      return {
        comparable: true,
        effectivePrecision: 'month',
        isStrictlyEarlier: false,
        isSameAtPrecision: true,
        years: 0,
        months: 0,
        totalMonths: 0,
        canonicalDisplay: '0 months (same calendar month)',
      };
    }
    const absM = Math.abs(totalMonths);
    const years = Math.floor(absM / 12);
    const months = absM % 12;
    const parts = [];
    if (years > 0) parts.push(`${years} ${years === 1 ? 'year' : 'years'}`);
    if (months > 0) parts.push(`${months} ${months === 1 ? 'month' : 'months'}`);
    const span = formatUnits(parts);
    return {
      comparable: true,
      effectivePrecision: 'month',
      isStrictlyEarlier: totalMonths > 0,
      isSameAtPrecision: false,
      years: totalMonths > 0 ? years : -years,
      months: totalMonths > 0 ? months : -months,
      totalMonths,
      canonicalDisplay: totalMonths > 0 ? span : `postdates baseline by ${span}`,
    };
  }

  const utcAtt = Date.UTC(att.year, att.month - 1, att.day);
  const utcBase = Date.UTC(base.year, base.month - 1, base.day);
  const totalDays = Math.round((utcBase - utcAtt) / 86_400_000);
  if (totalDays === 0) {
    return {
      comparable: true,
      effectivePrecision: 'day',
      isStrictlyEarlier: false,
      isSameAtPrecision: true,
      years: 0,
      months: 0,
      days: 0,
      totalDays: 0,
      canonicalDisplay: '0 days (matches baseline date)',
    };
  }

  const forward = totalDays > 0;
  const start = forward ? att : base;
  const end = forward ? base : att;

  let years = end.year - start.year;
  let months = end.month - start.month;
  let days = end.day - start.day;

  if (days < 0) {
    const prevMonth = end.month === 1 ? 12 : end.month - 1;
    const prevYear = end.month === 1 ? end.year - 1 : end.year;
    days += daysInGregorianMonth(prevYear, prevMonth);
    months -= 1;
  }
  if (months < 0) {
    months += 12;
    years -= 1;
  }

  const parts = [];
  if (years > 0) parts.push(`${years} ${years === 1 ? 'year' : 'years'}`);
  if (months > 0) parts.push(`${months} ${months === 1 ? 'month' : 'months'}`);
  if (days > 0) parts.push(`${days} ${days === 1 ? 'day' : 'days'}`);
  const span = formatUnits(parts);

  return {
    comparable: true,
    effectivePrecision: 'day',
    isStrictlyEarlier: forward,
    isSameAtPrecision: false,
    years: forward ? years : -years,
    months: forward ? months : -months,
    days: forward ? days : -days,
    totalDays,
    canonicalDisplay: forward ? span : `postdates baseline by ${span}`,
  };
}

export function computeCitationMaterialFingerprint(citation, publicDir, scanHashCache = new Map()) {
  const hostedPath = citation?.scan?.hosted_path
    ? normalizeText(String(citation.scan.hosted_path))
    : null;
  const rightsStatus = citation?.scan?.rights_status
    ? normalizeText(String(citation.scan.rights_status))
    : null;

  let fileSha256 = null;
  if (hostedPath) {
    const diskPath = path.resolve(publicDir, hostedPath.replace(/^\/+/, ''));
    if (scanHashCache.has(diskPath)) {
      fileSha256 = scanHashCache.get(diskPath);
    } else if (!fs.existsSync(diskPath)) {
      fileSha256 = `missing:${hostedPath}`;
    } else {
      fileSha256 = sha256Hex(fs.readFileSync(diskPath));
      scanHashCache.set(diskPath, fileSha256);
    }
  }

  const payload = {
    schema: 'dragnet-citation-material-v1',
    id: normalizeText(String(citation.id ?? '')),
    case_slug: normalizeText(String(citation.case_slug ?? '')),
    attested_form: normalizeText(String(citation.attested_form ?? '')),
    record_type: normalizeText(String(citation.record_type ?? '')),
    publication_year: citation.publication_year ?? null,
    date_display: normalizeText(String(citation.date_display ?? '')),
    sort_date: normalizeText(String(citation.sort_date ?? '')),
    source_publication: normalizeText(String(citation.source_publication ?? '')),
    source_url: normalizeText(String(citation.source_url ?? '')),
    page_and_column: normalizeText(String(citation.page_and_column ?? '')),
    verbatim_quote: normalizeText(String(citation.verbatim_quote ?? '')),
    masthead_date_verified: Boolean(citation.masthead_date_verified),
    catalog_year: citation.catalog_year == null ? null : normalizeText(String(citation.catalog_year)),
    masthead_year:
      citation.masthead_year == null ? null : normalizeText(String(citation.masthead_year)),
    scan: {
      hosted_path: hostedPath,
      rights_status: rightsStatus,
      file_sha256: fileSha256,
    },
  };

  return sha256Hex(canonicalJson(payload));
}

export function computeIntrinsicClaimFingerprint(claim) {
  const normalizedEvidence = Array.isArray(claim.evidence)
    ? claim.evidence
        .filter((e) => e && typeof e === 'object')
        .map((e) => ({
          ref: normalizeText(String(e.ref ?? '')),
          relationship: normalizeText(String(e.relationship ?? '')),
          directness: normalizeText(String(e.directness ?? '')),
          reason: normalizeText(String(e.reason ?? '')),
          witness_note: e.witness_note == null ? null : normalizeText(String(e.witness_note)),
        }))
        .sort(
          (a, b) => compareCodePoints(a.ref, b.ref) || compareCodePoints(a.relationship, b.relationship)
        )
    : [];

  const ab =
    claim.antedating_baseline && typeof claim.antedating_baseline === 'object'
      ? claim.antedating_baseline
      : null;
  const normalizedAntedating = ab
    ? {
        authority: normalizeText(String(ab.authority ?? '')),
        entry_and_sense: normalizeText(String(ab.entry_and_sense ?? '')),
        edition_or_revision: normalizeText(String(ab.edition_or_revision ?? '')),
        baseline_date: normalizeText(String(ab.baseline_date ?? '')),
        baseline_date_precision: normalizeText(String(ab.baseline_date_precision ?? '')),
        source_url_or_ref: normalizeText(String(ab.source_url_or_ref ?? '')),
        checked_date: normalizeText(String(ab.checked_date ?? '')),
        comparison_kind: normalizeText(String(ab.comparison_kind ?? '')),
        advancing_citation_ref: normalizeText(String(ab.advancing_citation_ref ?? '')),
        attested_date: normalizeText(String(ab.attested_date ?? '')),
        attested_date_precision: normalizeText(String(ab.attested_date_precision ?? '')),
        computed_advance_display: normalizeText(String(ab.computed_advance_display ?? '')),
        inspection_mode: normalizeText(String(ab.inspection_mode ?? '')),
      }
    : null;

  const neb =
    claim.negative_evidence_bounds && typeof claim.negative_evidence_bounds === 'object'
      ? claim.negative_evidence_bounds
      : null;
  const normalizedNegativeBounds = neb
    ? {
        corpus_identity: normalizeText(String(neb.corpus_identity ?? '')),
        search_date: normalizeText(String(neb.search_date ?? '')),
        search_period: normalizeText(String(neb.search_period ?? '')),
        query_terms: Array.isArray(neb.query_terms)
          ? neb.query_terms.map((q) => normalizeText(String(q))).sort(compareCodePoints)
          : [],
        search_method: normalizeText(String(neb.search_method ?? '')),
        corpus_coverage:
          neb.corpus_coverage == null ? null : normalizeText(String(neb.corpus_coverage)),
        known_limitations: Array.isArray(neb.known_limitations)
          ? neb.known_limitations.map((k) => normalizeText(String(k))).sort(compareCodePoints)
          : [],
        qualifying_results_count:
          typeof neb.qualifying_results_count === 'number' ? neb.qualifying_results_count : null,
      }
    : null;

  const eb =
    claim.evidence_boundary && typeof claim.evidence_boundary === 'object'
      ? claim.evidence_boundary
      : {};

  const payload = {
    schema: 'dragnet-claim-intrinsic-v1',
    id: normalizeText(String(claim.id ?? '')),
    case_slug: normalizeText(String(claim.case_slug ?? '')),
    headword: normalizeText(String(claim.headword ?? '')),
    target_lexeme: claim.target_lexeme == null ? null : normalizeText(String(claim.target_lexeme)),
    type: normalizeText(String(claim.type ?? '')),
    assessment: normalizeText(String(claim.assessment ?? '')),
    statement: normalizeText(String(claim.statement ?? '')),
    rationale: normalizeText(String(claim.rationale ?? '')),
    lifecycle_status: normalizeText(String(claim.lifecycle_status ?? '')),
    supersedes: Array.isArray(claim.supersedes)
      ? claim.supersedes.map((s) => normalizeText(String(s))).sort(compareCodePoints)
      : [],
    superseded_by: claim.superseded_by == null ? null : normalizeText(String(claim.superseded_by)),
    evidence_boundary: {
      establishes: normalizeText(String(eb.establishes ?? '')),
      does_not_establish: normalizeText(String(eb.does_not_establish ?? '')),
      remaining_uncertainty: normalizeText(String(eb.remaining_uncertainty ?? '')),
    },
    limitations: Array.isArray(claim.limitations)
      ? claim.limitations.map((s) => normalizeText(String(s))).sort(compareCodePoints)
      : [],
    resolution_criteria: Array.isArray(claim.resolution_criteria)
      ? claim.resolution_criteria.map((s) => normalizeText(String(s))).sort(compareCodePoints)
      : [],
    evidence: normalizedEvidence,
    antedating_baseline: normalizedAntedating,
    negative_evidence_bounds: normalizedNegativeBounds,
  };

  return sha256Hex(canonicalJson(payload));
}

export function computeClaimEvidenceFingerprints(claim, ctx, visiting = new Set()) {
  const byRef = new Map();
  for (const edge of Array.isArray(claim.evidence) ? claim.evidence : []) {
    if (!edge || typeof edge !== 'object') continue;
    const ref = normalizeText(String(edge.ref ?? ''));
    const list = byRef.get(ref) ?? [];
    list.push(String(edge.relationship ?? ''));
    byRef.set(ref, list);
  }

  const sortedRefs = Array.from(byRef.keys()).sort(compareCodePoints);
  const out = {};
  const nextVisiting = new Set(visiting);
  nextVisiting.add(String(claim.id ?? ''));

  for (const ref of sortedRefs) {
    if (ref.startsWith('CERT-')) {
      if (ctx.citationFpCache.has(ref)) {
        out[ref] = ctx.citationFpCache.get(ref);
      } else if (ctx.citationById.has(ref)) {
        const fp = computeCitationMaterialFingerprint(
          ctx.citationById.get(ref),
          ctx.publicDir,
          ctx.scanHashCache
        );
        ctx.citationFpCache.set(ref, fp);
        out[ref] = fp;
      } else {
        out[ref] = `unresolved:${ref}`;
      }
    } else if (ref.startsWith('CLM-')) {
      const target = ctx.claimById.get(ref);
      if (!target) {
        out[ref] = `unresolved:${ref}`;
      } else {
        const rels = byRef.get(ref) ?? [];
        const hasInferential = rels.some((r) => INFERENTIAL_RELATIONSHIPS.has(r));
        if (hasInferential && ref !== claim.id && !nextVisiting.has(ref)) {
          out[ref] = computeClaimContentFingerprint(target, ctx, nextVisiting);
        } else {
          if (!ctx.intrinsicFpCache.has(ref)) {
            ctx.intrinsicFpCache.set(ref, computeIntrinsicClaimFingerprint(target));
          }
          out[ref] = ctx.intrinsicFpCache.get(ref);
        }
      }
    } else {
      out[ref] = `invalid:${ref}`;
    }
  }
  return out;
}

export function computeClaimContentFingerprint(claim, ctx, visiting = new Set()) {
  const cid = String(claim.id ?? '');
  if (visiting.size === 0 && cid && ctx.contentFpCache.has(cid)) {
    return ctx.contentFpCache.get(cid);
  }
  if (cid && !ctx.intrinsicFpCache.has(cid)) {
    ctx.intrinsicFpCache.set(cid, computeIntrinsicClaimFingerprint(claim));
  }
  const intrinsicFp = cid
    ? ctx.intrinsicFpCache.get(cid)
    : computeIntrinsicClaimFingerprint(claim);
  const evidenceFps = computeClaimEvidenceFingerprints(claim, ctx, visiting);
  const payload = {
    schema: 'dragnet-claim-content-v1',
    intrinsic_fingerprint: intrinsicFp,
    evidence_fingerprints: evidenceFps,
  };
  const digest = sha256Hex(canonicalJson(payload));
  if (visiting.size === 0 && cid) {
    ctx.contentFpCache.set(cid, digest);
  }
  return digest;
}

export function detectInferentialCycles(claims) {
  const claimMap = new Map();
  for (const c of claims) {
    if (c && typeof c.id === 'string') claimMap.set(c.id, c);
  }
  const state = new Map();
  const stack = [];
  const cycles = [];
  const seenSigs = new Set();

  function dfs(id) {
    state.set(id, 1);
    stack.push(id);
    const node = claimMap.get(id);
    if (node && Array.isArray(node.evidence)) {
      const targets = node.evidence
        .filter(
          (e) =>
            e &&
            typeof e.ref === 'string' &&
            e.ref.startsWith('CLM-') &&
            INFERENTIAL_RELATIONSHIPS.has(e.relationship)
        )
        .map((e) => e.ref)
        .sort(compareCodePoints);

      for (const targetId of targets) {
        if (!claimMap.has(targetId)) continue;
        const st = state.get(targetId) ?? 0;
        if (st === 1) {
          const idx = stack.indexOf(targetId);
          const cycleNodes = stack.slice(idx);
          let minIdx = 0;
          for (let i = 1; i < cycleNodes.length; i++) {
            if (compareCodePoints(cycleNodes[i], cycleNodes[minIdx]) < 0) minIdx = i;
          }
          const rotated = [...cycleNodes.slice(minIdx), ...cycleNodes.slice(0, minIdx)];
          const sig = rotated.join('->');
          if (!seenSigs.has(sig)) {
            seenSigs.add(sig);
            cycles.push([...rotated, rotated[0]]);
          }
        } else if (st === 0) {
          dfs(targetId);
        }
      }
    }
    stack.pop();
    state.set(id, 2);
  }

  for (const id of Array.from(claimMap.keys()).sort(compareCodePoints)) {
    if ((state.get(id) ?? 0) === 0) dfs(id);
  }
  return cycles;
}

function detectSupersessionCycles(claims) {
  const byId = new Map();
  for (const c of claims) {
    if (c && typeof c.id === 'string') byId.set(c.id, c);
  }
  const cycles = [];
  const seen = new Set();

  for (const id of Array.from(byId.keys()).sort(compareCodePoints)) {
    const visited = [];
    let cur = id;
    while (cur && byId.has(cur)) {
      if (visited.includes(cur)) {
        const idx = visited.indexOf(cur);
        const loop = [...visited.slice(idx), cur];
        const sig = loop.slice(0, -1).sort(compareCodePoints).join('->');
        if (!seen.has(sig)) {
          seen.add(sig);
          cycles.push(loop);
        }
        break;
      }
      visited.push(cur);
      const next = byId.get(cur).superseded_by;
      cur = typeof next === 'string' ? next : null;
    }
  }
  return cycles;
}

function checkUnknownKeys(obj, allowedSet, contextLabel, errors) {
  for (const k of Object.keys(obj)) {
    if (!allowedSet.has(k)) {
      errors.push(`${contextLabel}: Disallowed or unknown property '${k}'`);
    }
  }
}

function scanTreeForForbiddenKeysAndLeaks(node, pathLabel, fileLabel, errors, parentKey = '') {
  if (node === null || node === undefined) return;
  if (typeof node === 'string') {
    const leak = findWorkspaceOrDriveLeak(node);
    if (leak) {
      errors.push(`${fileLabel} (${pathLabel}): Workspace/private leak '${leak}'`);
    }
    if (DECIMAL_YEAR_RE.test(node)) {
      const m = node.match(DECIMAL_YEAR_RE);
      errors.push(`${fileLabel} (${pathLabel}): Uses decimal years ('${m[0]}'); use calendar years, months, and days`);
    }
    if (RAW_SCORE_RE.test(node)) {
      const m = node.match(RAW_SCORE_RE);
      errors.push(`${fileLabel} (${pathLabel}): Contains raw numerical harness/confidence score ('${m[0]}')`);
    }
    if (PCT_CONFIDENCE_RE.test(node)) {
      const m = node.match(PCT_CONFIDENCE_RE);
      errors.push(`${fileLabel} (${pathLabel}): Contains numerical percentage confidence ('${m[0]}')`);
    }
    return;
  }
  if (Array.isArray(node)) {
    node.forEach((item, idx) =>
      scanTreeForForbiddenKeysAndLeaks(item, `${pathLabel}[${idx}]`, fileLabel, errors, parentKey)
    );
    return;
  }
  if (typeof node === 'object') {
    for (const [k, v] of Object.entries(node)) {
      if (parentKey !== 'evidence_fingerprints_at_review' && FORBIDDEN_SCORE_KEY_RE.test(k)) {
        errors.push(`${fileLabel} (${pathLabel}.${k}): Numerical confidence/probability key '${k}' is forbidden`);
      }
      if (k === 'is_stale') {
        errors.push(`${fileLabel} (${pathLabel}.is_stale): 'is_stale' must not be serialized on disk; it is computed dynamically`);
      }
      scanTreeForForbiddenKeysAndLeaks(v, `${pathLabel}.${k}`, fileLabel, errors, k);
    }
  }
}

function isNonEmptyString(v) {
  return typeof v === 'string' && v.trim().length > 0;
}

export function stampClaimLedgerFingerprints(targetPaths, options = {}) {
  const rootDir = path.resolve(options.rootDir ?? DEFAULT_ROOT);
  const publicDir = path.resolve(options.publicDir ?? path.join(rootDir, 'public'));
  const ledgersDir = path.resolve(options.ledgersDir ?? path.join(publicDir, 'ledgers'));
  const claimsDir = path.resolve(options.claimsDir ?? path.join(publicDir, 'claims'));

  const citationById = new Map();
  if (fs.existsSync(ledgersDir)) {
    for (const f of fs.readdirSync(ledgersDir).filter((n) => n.endsWith('.json')).sort()) {
      const d = JSON.parse(fs.readFileSync(path.join(ledgersDir, f), 'utf-8'));
      for (const c of d.citations ?? []) citationById.set(c.id, c);
    }
  }

  const filesToLoad = new Map();
  if (fs.existsSync(claimsDir)) {
    for (const f of fs.readdirSync(claimsDir).filter((n) => n.endsWith('.json')).sort()) {
      const full = path.resolve(claimsDir, f);
      filesToLoad.set(full, JSON.parse(fs.readFileSync(full, 'utf-8')));
    }
  }

  const resolvedTargets = [];
  for (const tp of targetPaths) {
    const abs = path.resolve(tp);
    if (fs.existsSync(abs) && fs.statSync(abs).isDirectory()) {
      for (const f of fs.readdirSync(abs).filter((n) => n.endsWith('.json')).sort()) {
        const fp = path.resolve(abs, f);
        if (!filesToLoad.has(fp)) filesToLoad.set(fp, JSON.parse(fs.readFileSync(fp, 'utf-8')));
        resolvedTargets.push(fp);
      }
    } else {
      if (!filesToLoad.has(abs)) filesToLoad.set(abs, JSON.parse(fs.readFileSync(abs, 'utf-8')));
      resolvedTargets.push(abs);
    }
  }

  const claimById = new Map();
  for (const data of filesToLoad.values()) {
    for (const c of data.claims ?? []) {
      if (c && typeof c.id === 'string') claimById.set(c.id, c);
    }
  }

  const ctx = {
    citationById,
    claimById,
    publicDir,
    scanHashCache: new Map(),
    citationFpCache: new Map(),
    intrinsicFpCache: new Map(),
    contentFpCache: new Map(),
  };

  let stampedClaims = 0;
  for (const fp of resolvedTargets) {
    const data = filesToLoad.get(fp);
    for (const c of data.claims ?? []) {
      const digest = computeClaimContentFingerprint(c, ctx);
      c.content_fingerprint = digest;
      if (Array.isArray(c.revision_history) && c.revision_history.length > 0) {
        const matchingEntry = c.revision_history.find((r) => r.revision === c.revision);
        if (matchingEntry) {
          matchingEntry.content_fingerprint = digest;
        } else {
          c.revision_history[c.revision_history.length - 1].content_fingerprint = digest;
        }
      }
      stampedClaims += 1;
    }
    fs.writeFileSync(fp, JSON.stringify(data, null, 2) + '\n', 'utf-8');
  }

  return { filesStamped: resolvedTargets.length, claimsStamped: stampedClaims };
}

export function validateClaims(options = {}) {
  const rootDir = path.resolve(options.rootDir ?? DEFAULT_ROOT);
  const publicDir = path.resolve(options.publicDir ?? path.join(rootDir, 'public'));
  const ledgersDir = path.resolve(options.ledgersDir ?? path.join(publicDir, 'ledgers'));
  const casesDir = path.resolve(options.casesDir ?? path.join(rootDir, 'src', 'content', 'cases'));
  const claimsDir = path.resolve(options.claimsDir ?? path.join(publicDir, 'claims'));
  const openQPath = path.resolve(options.openQuestionsPath ?? path.join(publicDir, 'data', 'open-questions.json'));
  const allowEmpty = Boolean(options.allowEmpty);
  const requireAllCases = Boolean(options.requireAllCases);
  const explicitFiles = Array.isArray(options.files)
    ? options.files.map((f) => path.resolve(f))
    : [];

  const errors = [];
  const warnings = [];

  // 1. Check schemas/, docs/, and src/lib/claims.ts for workspace/Drive/session leaks (never public/ledgers/)
  const sanitizeFiles = [
    ...walkCheckedTextFiles(path.join(rootDir, 'schemas')),
    ...walkCheckedTextFiles(path.join(rootDir, 'docs')),
    path.join(rootDir, 'src', 'lib', 'claims.ts'),
  ];
  for (const p of sanitizeFiles) {
    if (fs.existsSync(p)) {
      const txt = fs.readFileSync(p, 'utf-8');
      const leak = findWorkspaceOrDriveLeak(txt);
      if (leak) errors.push(`Workspace/private leak '${leak}' in ${path.relative(rootDir, p)}`);
    }
  }

  // 2. Load embargoed under_review targets from open-questions.json
  const embargoedTargetIds = new Set();
  const embargoedSlugs = new Set();
  if (fs.existsSync(openQPath)) {
    try {
      const oq = JSON.parse(fs.readFileSync(openQPath, 'utf-8'));
      for (const t of oq.targets ?? []) {
        if (t.status === 'under_review' && !t.case_slug) {
          if (t.target_id) embargoedTargetIds.add(t.target_id);
          if (t.headword) embargoedSlugs.add(String(t.headword).toLowerCase().trim());
        }
      }
    } catch (err) {
      errors.push(`open-questions.json: Invalid JSON (${err.message})`);
    }
  }

  // 3. Load citation ledgers (v3.0)
  const citationLedgersBySlug = new Map();
  const citationById = new Map();
  if (fs.existsSync(ledgersDir)) {
    for (const f of fs.readdirSync(ledgersDir).filter((n) => n.endsWith('.json')).sort()) {
      try {
        const d = JSON.parse(fs.readFileSync(path.join(ledgersDir, f), 'utf-8'));
        const slug = path.basename(f, '.json');
        citationLedgersBySlug.set(slug, d);
        for (const c of d.citations ?? []) {
          if (c && typeof c.id === 'string') citationById.set(c.id, c);
        }
      } catch (err) {
        errors.push(`public/ledgers/${f}: Invalid JSON (${err.message})`);
      }
    }
  }

  const publishedCaseSlugs = fs.existsSync(casesDir)
    ? fs
        .readdirSync(casesDir)
        .filter((f) => f.endsWith('.md'))
        .map((f) => path.basename(f, '.md'))
        .sort()
    : [];

  // 4. Discover claim ledger files
  const allClaimFilesMap = new Map();
  if (fs.existsSync(claimsDir)) {
    for (const f of fs.readdirSync(claimsDir).filter((n) => n.endsWith('.json')).sort()) {
      allClaimFilesMap.set(path.resolve(claimsDir, f), f);
    }
  }
  for (const ef of explicitFiles) {
    if (!fs.existsSync(ef)) {
      errors.push(`Specified claim file does not exist: ${ef}`);
    } else {
      allClaimFilesMap.set(ef, path.basename(ef));
    }
  }

  const targetFileSet =
    explicitFiles.length > 0 ? new Set(explicitFiles) : new Set(allClaimFilesMap.keys());

  if (allClaimFilesMap.size === 0) {
    if (!allowEmpty) {
      errors.push(
        `No claim ledgers found in ${path.relative(rootDir, claimsDir) || claimsDir} (pass --allow-empty before extraction)`
      );
    }
    return {
      ok: errors.length === 0,
      errors,
      warnings,
      stats: {
        claimLedgers: 0,
        publishedCases: publishedCaseSlugs.length,
        totalClaims: 0,
        activeClaims: 0,
        reviews: 0,
        staleReviews: 0,
      },
    };
  }

  const parsedLedgers = [];
  const claimById = new Map();
  const claimSourceFile = new Map();
  const claimSlugSeen = new Map();
  const reviewIdSeen = new Map();

  for (const [fullPath, fileName] of Array.from(allClaimFilesMap.entries()).sort((a, b) =>
    compareCodePoints(a[0], b[0])
  )) {
    const isTarget = targetFileSet.has(fullPath);
    let data;
    try {
      data = JSON.parse(fs.readFileSync(fullPath, 'utf-8'));
    } catch (err) {
      errors.push(`${fileName}: Invalid JSON (${err.message})`);
      continue;
    }

    parsedLedgers.push({ fullPath, fileName, data, isTarget });

    if (Array.isArray(data?.claims)) {
      for (const clm of data.claims) {
        if (!clm || typeof clm !== 'object') continue;
        const cid = String(clm.id ?? '');
        if (cid) {
          if (claimById.has(cid)) {
            errors.push(
              `${fileName}: Duplicate global claim ID '${cid}' (already defined in ${claimSourceFile.get(cid)})`
            );
          } else {
            claimById.set(cid, clm);
            claimSourceFile.set(cid, fileName);
          }
        }
        const cslug = String(clm.slug ?? '');
        if (cslug) {
          if (claimSlugSeen.has(cslug)) {
            errors.push(
              `${fileName}: Duplicate global claim slug '${cslug}' (already defined in ${claimSlugSeen.get(cslug)})`
            );
          } else {
            claimSlugSeen.set(cslug, fileName);
          }
        }
      }
    }
  }

  if (requireAllCases) {
    const loadedSlugs = new Set(parsedLedgers.map((l) => path.basename(l.fileName, '.json')));
    for (const cSlug of publishedCaseSlugs) {
      if (!loadedSlugs.has(cSlug)) {
        errors.push(`Missing required claim ledger public/claims/${cSlug}.json for published case '${cSlug}'`);
      }
    }
  }

  const fpCtx = {
    citationById,
    claimById,
    publicDir,
    scanHashCache: new Map(),
    citationFpCache: new Map(),
    intrinsicFpCache: new Map(),
    contentFpCache: new Map(),
  };

  let totalClaims = 0;
  let activeClaims = 0;
  let totalReviews = 0;
  let staleReviews = 0;

  for (const { fileName, data, isTarget } of parsedLedgers) {
    if (!isTarget) continue;

    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      errors.push(`${fileName}: Root JSON value must be an object`);
      continue;
    }

    checkUnknownKeys(data, ALLOWED_LEDGER_KEYS, fileName, errors);
    scanTreeForForbiddenKeysAndLeaks(data, '$', fileName, errors);

    const expectedStem = path.basename(fileName, '.json');
    if (data.schema_version !== '1.0') {
      errors.push(`${fileName}: Expected schema_version '1.0', got '${data.schema_version}'`);
    }
    if (!isNonEmptyString(data.claim_ledger_id) || !SLUG_RE.test(data.claim_ledger_id)) {
      errors.push(`${fileName}: Invalid claim_ledger_id '${data.claim_ledger_id}'`);
    } else if (data.claim_ledger_id !== expectedStem) {
      errors.push(
        `${fileName}: claim_ledger_id '${data.claim_ledger_id}' must match filename stem '${expectedStem}'`
      );
    }
    if (!isNonEmptyString(data.case_slug) || data.case_slug !== data.claim_ledger_id) {
      errors.push(
        `${fileName}: case_slug '${data.case_slug}' must equal claim_ledger_id '${data.claim_ledger_id}'`
      );
    }

    const caseMatch = CASE_NUMBER_RE.exec(String(data.case_number ?? ''));
    if (!caseMatch) {
      errors.push(`${fileName}: case_number '${data.case_number}' must match 'Case NNNN'`);
    }
    const expectedCaseDigits = caseMatch ? caseMatch[1] : null;

    if (!TARGET_ID_RE.test(String(data.target_id ?? ''))) {
      errors.push(`${fileName}: target_id '${data.target_id}' must match 'TGT-NNN'`);
    }
    if (embargoedTargetIds.has(data.target_id) || embargoedSlugs.has(String(data.case_slug).toLowerCase())) {
      errors.push(
        `${fileName}: Target '${data.target_id}' / '${data.case_slug}' is marked 'under_review' (embargoed) in open-questions.json`
      );
    }

    if (!isNonEmptyString(data.headword)) {
      errors.push(`${fileName}: Missing non-empty headword`);
    }
    if (!isValidIsoCalendarDate(data.updated_at)) {
      errors.push(`${fileName}: updated_at '${data.updated_at}' must be a valid YYYY-MM-DD calendar date`);
    }
    if (data.summary_note !== undefined && data.summary_note !== null && typeof data.summary_note !== 'string') {
      errors.push(`${fileName}: summary_note must be string or null`);
    }

    const citLedger = citationLedgersBySlug.get(data.case_slug);
    if (!citLedger) {
      errors.push(`${fileName}: No matching citation ledger public/ledgers/${data.case_slug}.json`);
    } else {
      if (data.case_number !== citLedger.case_number) {
        errors.push(
          `${fileName}: case_number '${data.case_number}' does not match citation ledger '${citLedger.case_number}'`
        );
      }
      if (data.target_id !== citLedger.target_id) {
        errors.push(
          `${fileName}: target_id '${data.target_id}' does not match citation ledger '${citLedger.target_id}'`
        );
      }
      if (data.headword !== citLedger.headword) {
        errors.push(
          `${fileName}: headword '${data.headword}' does not match citation ledger '${citLedger.headword}'`
        );
      }
    }

    if (!Array.isArray(data.claims) || data.claims.length === 0) {
      errors.push(`${fileName}: 'claims' must be a non-empty array`);
      continue;
    }

    let hasActivePrincipal = false;

    for (let idx = 0; idx < data.claims.length; idx++) {
      const clm = data.claims[idx];
      if (!clm || typeof clm !== 'object' || Array.isArray(clm)) {
        errors.push(`${fileName} [claims[${idx}]]: Claim record must be an object`);
        continue;
      }

      totalClaims += 1;
      const cid = String(clm.id ?? `claims[${idx}]`);
      const label = `${fileName} [${cid}]`;
      checkUnknownKeys(clm, ALLOWED_CLAIM_KEYS, label, errors);

      const idMatch = CLAIM_ID_RE.exec(String(clm.id ?? ''));
      let claimSeqNum = null;
      if (!idMatch) {
        errors.push(`${label}: id '${clm.id}' must match 'CLM-<case_digits>-<NNN>'`);
      } else {
        const [, idCaseDigits, idSeq] = idMatch;
        claimSeqNum = Number(idSeq);
        if (claimSeqNum < 1) {
          errors.push(`${label}: Claim sequence number must be >= 001, got '${idSeq}'`);
        }
        if (expectedCaseDigits && idCaseDigits !== expectedCaseDigits) {
          errors.push(
            `${label}: Claim namespace 'CLM-${idCaseDigits}-' must match ledger case_number '${data.case_number}' ('CLM-${expectedCaseDigits}-')`
          );
        }
      }

      if (!CLAIM_SLUG_RE.test(String(clm.slug ?? '')) || clm.slug !== String(clm.id ?? '').toLowerCase()) {
        errors.push(`${label}: slug '${clm.slug}' must equal lowercase id '${String(clm.id ?? '').toLowerCase()}'`);
      }
      if (clm.case_slug !== data.case_slug) {
        errors.push(`${label}: case_slug '${clm.case_slug}' must equal ledger case_slug '${data.case_slug}'`);
      }
      if (clm.headword !== data.headword) {
        errors.push(`${label}: headword '${clm.headword}' must equal ledger headword '${data.headword}'`);
      }
      if (clm.target_lexeme !== undefined && clm.target_lexeme !== null && !isNonEmptyString(clm.target_lexeme)) {
        errors.push(`${label}: target_lexeme must be a non-empty string or null`);
      }
      if (clm.case_section !== undefined && clm.case_section !== null && !isNonEmptyString(clm.case_section)) {
        errors.push(`${label}: case_section must be a non-empty string or null`);
      }
      if (!isNonEmptyString(clm.short_label) || clm.short_label.length > 160) {
        errors.push(`${label}: short_label must be 1..160 characters`);
      }
      if (!isNonEmptyString(clm.statement)) {
        errors.push(`${label}: statement must be a non-empty string`);
      }
      if (!isNonEmptyString(clm.rationale)) {
        errors.push(`${label}: rationale must be a non-empty string`);
      }

      if (!VALID_CLAIM_TYPES.has(clm.type)) {
        errors.push(`${label}: Invalid type '${clm.type}'`);
      }
      if (!VALID_ASSESSMENTS.has(clm.assessment)) {
        errors.push(`${label}: Invalid assessment '${clm.assessment}'`);
      }
      if (!VALID_REVIEW_STATUSES.has(clm.review_status)) {
        errors.push(`${label}: Invalid review_status '${clm.review_status}'`);
      }
      if (typeof clm.is_principal !== 'boolean') {
        errors.push(`${label}: is_principal must be boolean`);
      }
      if (
        clm.sort_order !== undefined &&
        clm.sort_order !== null &&
        (!Number.isInteger(clm.sort_order) || clm.sort_order < 0)
      ) {
        errors.push(`${label}: sort_order must be an integer >= 0 or null`);
      }

      if (!VALID_LIFECYCLE_STATUSES.has(clm.lifecycle_status)) {
        errors.push(`${label}: Invalid lifecycle_status '${clm.lifecycle_status}'`);
      } else if (clm.lifecycle_status === 'active') {
        activeClaims += 1;
        if (clm.is_principal === true) hasActivePrincipal = true;
        if (clm.superseded_by !== null) {
          errors.push(`${label}: active claim must have superseded_by === null`);
        }
      } else if (clm.lifecycle_status === 'superseded') {
        if (clm.is_principal === true) {
          errors.push(`${label}: superseded claim cannot have is_principal === true`);
        }
        if (!CLAIM_ID_RE.test(String(clm.superseded_by ?? '')) || clm.superseded_by === clm.id) {
          errors.push(`${label}: superseded claim requires a valid distinct CLM-* superseded_by`);
        } else if (claimById.has(clm.superseded_by)) {
          const newer = claimById.get(clm.superseded_by);
          if (!Array.isArray(newer.supersedes) || !newer.supersedes.includes(clm.id)) {
            errors.push(
              `${label}: superseded_by '${clm.superseded_by}' does not list '${clm.id}' in its supersedes[]`
            );
          }
          const newerMatch = CLAIM_ID_RE.exec(String(newer.id));
          if (idMatch && newerMatch && idMatch[1] === newerMatch[1]) {
            if (Number(newerMatch[2]) <= Number(idMatch[2])) {
              errors.push(
                `${label}: superseding same-case claim '${newer.id}' must have a monotonically higher sequence number than '${clm.id}'`
              );
            }
          }
        } else {
          errors.push(`${label}: superseded_by '${clm.superseded_by}' does not resolve to an existing claim`);
        }
      } else if (clm.lifecycle_status === 'withdrawn') {
        if (clm.is_principal === true) {
          errors.push(`${label}: withdrawn claim cannot have is_principal === true`);
        }
        if (clm.superseded_by !== null) {
          errors.push(`${label}: withdrawn claim must have superseded_by === null (use 'superseded' if replaced)`);
        }
      }

      if (!Number.isInteger(clm.revision) || clm.revision < 1) {
        errors.push(`${label}: revision must be an integer >= 1`);
      }

      if (!Array.isArray(clm.supersedes)) {
        errors.push(`${label}: supersedes must be an array`);
      } else {
        const seenSup = new Set();
        for (const sId of clm.supersedes) {
          if (!CLAIM_ID_RE.test(String(sId)) || sId === clm.id) {
            errors.push(`${label}: Invalid supersedes entry '${sId}'`);
          } else if (seenSup.has(sId)) {
            errors.push(`${label}: Duplicate entry '${sId}' in supersedes`);
          } else {
            seenSup.add(sId);
            if (!claimById.has(sId)) {
              errors.push(`${label}: supersedes target '${sId}' does not resolve to an existing claim`);
            } else {
              const oldClm = claimById.get(sId);
              if (oldClm.lifecycle_status !== 'superseded' || oldClm.superseded_by !== clm.id) {
                errors.push(
                  `${label}: supersedes '${sId}', so '${sId}' must have lifecycle_status='superseded' and superseded_by='${clm.id}'`
                );
              }
            }
          }
        }
      }

      // Evidence boundary
      if (!clm.evidence_boundary || typeof clm.evidence_boundary !== 'object' || Array.isArray(clm.evidence_boundary)) {
        errors.push(`${label}: Missing evidence_boundary object`);
      } else {
        checkUnknownKeys(clm.evidence_boundary, ALLOWED_BOUNDARY_KEYS, `${label}.evidence_boundary`, errors);
        for (const bk of ALLOWED_BOUNDARY_KEYS) {
          if (!isNonEmptyString(clm.evidence_boundary[bk])) {
            errors.push(`${label}: evidence_boundary.${bk} must be a non-empty string`);
          }
        }
      }

      if (!Array.isArray(clm.limitations) || clm.limitations.some((x) => !isNonEmptyString(x))) {
        errors.push(`${label}: limitations must be an array of non-empty strings`);
      }
      if (!Array.isArray(clm.resolution_criteria) || clm.resolution_criteria.some((x) => !isNonEmptyString(x))) {
        errors.push(`${label}: resolution_criteria must be an array of non-empty strings`);
      } else if (
        INTERPRETIVE_TYPES.has(clm.type) &&
        UNRESOLVED_ASSESSMENTS.has(clm.assessment) &&
        clm.resolution_criteria.length === 0
      ) {
        errors.push(
          `${label}: Unresolved interpretive claim (${clm.type}, ${clm.assessment}) requires at least 1 resolution_criteria entry`
        );
      }

      // Evidence edges
      const claimEvidenceRefs = new Set();
      if (!Array.isArray(clm.evidence)) {
        errors.push(`${label}: evidence must be an array`);
      } else {
        if (clm.type !== 'negative_evidence' && clm.assessment !== 'unassessed' && clm.evidence.length === 0) {
          errors.push(`${label}: Assessed ${clm.type} claim must link at least 1 evidence item`);
        }
        const seenPairs = new Set();
        for (let eIdx = 0; eIdx < clm.evidence.length; eIdx++) {
          const edge = clm.evidence[eIdx];
          const eLabel = `${label}.evidence[${eIdx}]`;
          if (!edge || typeof edge !== 'object' || Array.isArray(edge)) {
            errors.push(`${eLabel}: Evidence entry must be an object`);
            continue;
          }
          checkUnknownKeys(edge, ALLOWED_EVIDENCE_KEYS, eLabel, errors);

          const ref = String(edge.ref ?? '');
          const rel = String(edge.relationship ?? '');
          if (ref === clm.id) {
            errors.push(`${eLabel}: Self-referential evidence ref '${ref}' is forbidden`);
          } else if (CERT_ID_RE.test(ref)) {
            if (!citationById.has(ref)) {
              errors.push(`${eLabel}: Unresolved citation ref '${ref}' (not found in public/ledgers/*.json)`);
            }
          } else if (CLAIM_ID_RE.test(ref)) {
            if (!claimById.has(ref)) {
              errors.push(`${eLabel}: Unresolved claim ref '${ref}' (not found in loaded claim ledgers)`);
            } else {
              const targetClaim = claimById.get(ref);
              if (
                clm.assessment === 'supported' &&
                rel === 'depends_on' &&
                (targetClaim.assessment === 'contradicted' || targetClaim.lifecycle_status === 'withdrawn')
              ) {
                errors.push(
                  `${eLabel}: Supported claim cannot depend_on '${ref}' (${targetClaim.lifecycle_status}, ${targetClaim.assessment})`
                );
              }
            }
          } else {
            errors.push(`${eLabel}: Invalid ref '${ref}' (expected CERT-... or CLM-...)`);
          }

          if (!VALID_RELATIONSHIPS.has(rel)) {
            errors.push(`${eLabel}: Invalid relationship '${rel}'`);
          }
          if (!VALID_DIRECTNESS.has(edge.directness)) {
            errors.push(`${eLabel}: Invalid directness '${edge.directness}'`);
          }
          if (!isNonEmptyString(edge.reason)) {
            errors.push(`${eLabel}: reason must be a non-empty string`);
          }
          if (edge.witness_note !== undefined && edge.witness_note !== null && !isNonEmptyString(edge.witness_note)) {
            errors.push(`${eLabel}: witness_note must be a non-empty string or null`);
          }

          const pairKey = `${ref}::${rel}`;
          if (seenPairs.has(pairKey)) {
            errors.push(`${eLabel}: Duplicate (ref, relationship) pair ('${ref}', '${rel}') on ${clm.id}`);
          }
          seenPairs.add(pairKey);
          claimEvidenceRefs.add(ref);
        }
      }

      // Antedating baseline
      if (clm.type === 'antedating' && !clm.antedating_baseline) {
        errors.push(`${label}: Claim of type 'antedating' requires antedating_baseline`);
      }
      if (clm.antedating_baseline !== undefined && clm.antedating_baseline !== null) {
        const ab = clm.antedating_baseline;
        const abLabel = `${label}.antedating_baseline`;
        if (typeof ab !== 'object' || Array.isArray(ab)) {
          errors.push(`${abLabel}: Must be an object or null`);
        } else {
          checkUnknownKeys(ab, ALLOWED_ANTEDATING_KEYS, abLabel, errors);
          for (const strKey of [
            'authority',
            'entry_and_sense',
            'edition_or_revision',
            'source_url_or_ref',
            'computed_advance_display',
          ]) {
            if (!isNonEmptyString(ab[strKey])) {
              errors.push(`${abLabel}: '${strKey}' must be a non-empty string`);
            }
          }
          if (!isValidIsoCalendarDate(ab.checked_date)) {
            errors.push(`${abLabel}: checked_date '${ab.checked_date}' must be YYYY-MM-DD`);
          }
          if (!VALID_COMPARISON_KINDS.has(ab.comparison_kind)) {
            errors.push(`${abLabel}: Invalid comparison_kind '${ab.comparison_kind}'`);
          }
          if (!VALID_INSPECTION_MODES.has(ab.inspection_mode)) {
            errors.push(`${abLabel}: Invalid inspection_mode '${ab.inspection_mode}'`);
          }
          if (!CERT_ID_RE.test(String(ab.advancing_citation_ref ?? ''))) {
            errors.push(`${abLabel}: advancing_citation_ref '${ab.advancing_citation_ref}' must be a CERT-* ID`);
          } else {
            if (!citationById.has(ab.advancing_citation_ref)) {
              errors.push(`${abLabel}: advancing_citation_ref '${ab.advancing_citation_ref}' does not exist in ledgers`);
            }
            if (!claimEvidenceRefs.has(ab.advancing_citation_ref)) {
              errors.push(
                `${abLabel}: advancing_citation_ref '${ab.advancing_citation_ref}' must also appear in claim.evidence`
              );
            }
          }

          if (!VALID_PRECISIONS.has(ab.baseline_date_precision)) {
            errors.push(`${abLabel}: Invalid baseline_date_precision '${ab.baseline_date_precision}'`);
          }
          if (!VALID_PRECISIONS.has(ab.attested_date_precision)) {
            errors.push(`${abLabel}: Invalid attested_date_precision '${ab.attested_date_precision}'`);
          }

          const parsedBase = parseHistoricalDateByPrecision(ab.baseline_date, ab.baseline_date_precision);
          if (!parsedBase) {
            errors.push(
              `${abLabel}: baseline_date '${ab.baseline_date}' does not match precision '${ab.baseline_date_precision}'`
            );
          }
          const parsedAtt = parseHistoricalDateByPrecision(ab.attested_date, ab.attested_date_precision);
          if (!parsedAtt) {
            errors.push(
              `${abLabel}: attested_date '${ab.attested_date}' does not match precision '${ab.attested_date_precision}'`
            );
          }

          if (parsedBase && parsedAtt && isNonEmptyString(ab.computed_advance_display)) {
            const adv = computeChronologicalAdvance(
              ab.attested_date,
              ab.attested_date_precision,
              ab.baseline_date,
              ab.baseline_date_precision
            );
            if (
              (adv.effectivePrecision === 'year' || adv.effectivePrecision === 'circa') &&
              /\b(?:months?|days?)\b/i.test(ab.computed_advance_display)
            ) {
              errors.push(
                `${abLabel}: computed_advance_display '${ab.computed_advance_display}' invents month/day precision when effective precision is '${adv.effectivePrecision}'`
              );
            }
            if (adv.effectivePrecision === 'month' && /\bdays?\b/i.test(ab.computed_advance_display)) {
              errors.push(
                `${abLabel}: computed_advance_display '${ab.computed_advance_display}' invents day precision when effective precision is 'month'`
              );
            }
            if (
              STRICT_ADVANCING_KINDS.has(ab.comparison_kind) &&
              adv.comparable &&
              adv.isStrictlyEarlier !== true
            ) {
              errors.push(
                `${abLabel}: comparison_kind '${ab.comparison_kind}' requires attested_date (${ab.attested_date}) to precede baseline_date (${ab.baseline_date}) at '${adv.effectivePrecision}' precision`
              );
            }
          }
        }
      }

      // Negative evidence bounds
      if (clm.type === 'negative_evidence' && !clm.negative_evidence_bounds) {
        errors.push(`${label}: Claim of type 'negative_evidence' requires negative_evidence_bounds`);
      }
      if (clm.negative_evidence_bounds !== undefined && clm.negative_evidence_bounds !== null) {
        const neb = clm.negative_evidence_bounds;
        const nebLabel = `${label}.negative_evidence_bounds`;
        if (typeof neb !== 'object' || Array.isArray(neb)) {
          errors.push(`${nebLabel}: Must be an object or null`);
        } else {
          checkUnknownKeys(neb, ALLOWED_NEGATIVE_KEYS, nebLabel, errors);
          if (!isNonEmptyString(neb.corpus_identity)) {
            errors.push(`${nebLabel}: corpus_identity must be a non-empty string`);
          }
          if (!isValidIsoCalendarDate(neb.search_date)) {
            errors.push(`${nebLabel}: search_date '${neb.search_date}' must be YYYY-MM-DD`);
          }
          if (!isNonEmptyString(neb.search_period)) {
            errors.push(`${nebLabel}: search_period must be a non-empty string`);
          }
          if (
            !Array.isArray(neb.query_terms) ||
            neb.query_terms.length === 0 ||
            neb.query_terms.some((q) => !isNonEmptyString(q))
          ) {
            errors.push(`${nebLabel}: query_terms must be a non-empty array of strings`);
          }
          if (!isNonEmptyString(neb.search_method)) {
            errors.push(`${nebLabel}: search_method must be a non-empty string`);
          }
          if (neb.corpus_coverage !== null && !isNonEmptyString(neb.corpus_coverage)) {
            errors.push(`${nebLabel}: corpus_coverage must be a non-empty string or null`);
          }
          if (
            !Array.isArray(neb.known_limitations) ||
            neb.known_limitations.length === 0 ||
            neb.known_limitations.some((k) => !isNonEmptyString(k))
          ) {
            errors.push(`${nebLabel}: known_limitations must be a non-empty array of strings`);
          }
          if (
            neb.qualifying_results_count !== null &&
            (!Number.isInteger(neb.qualifying_results_count) || neb.qualifying_results_count < 0)
          ) {
            errors.push(`${nebLabel}: qualifying_results_count must be an integer >= 0 or null`);
          }
        }
      }

      // Deterministic content_fingerprint & revision_history
      const expectedEvidenceFps = computeClaimEvidenceFingerprints(clm, fpCtx);
      const expectedContentFp = computeClaimContentFingerprint(clm, fpCtx);
      if (!SHA256_RE.test(String(clm.content_fingerprint ?? ''))) {
        errors.push(`${label}: content_fingerprint must be a 64-char lowercase SHA-256 hex string`);
      } else if (clm.content_fingerprint !== expectedContentFp) {
        errors.push(
          `${label}: content_fingerprint mismatch (stored ${clm.content_fingerprint.slice(0, 12)}…, expected ${expectedContentFp.slice(0, 12)}…)`
        );
      }

      if (!Array.isArray(clm.revision_history) || clm.revision_history.length === 0) {
        errors.push(`${label}: revision_history must be a non-empty array`);
      } else {
        let idxRev = 1;
        for (const revEntry of clm.revision_history) {
          const rLabel = `${label}.revision_history[${idxRev - 1}]`;
          if (!revEntry || typeof revEntry !== 'object' || Array.isArray(revEntry)) {
            errors.push(`${rLabel}: Must be an object`);
            idxRev += 1;
            continue;
          }
          checkUnknownKeys(revEntry, ALLOWED_REVISION_KEYS, rLabel, errors);
          if (revEntry.revision !== idxRev) {
            errors.push(`${rLabel}: Expected sequential revision ${idxRev}, got ${revEntry.revision}`);
          }
          if (!isValidIsoCalendarDate(revEntry.date)) {
            errors.push(`${rLabel}: date '${revEntry.date}' must be YYYY-MM-DD`);
          }
          if (!isNonEmptyString(revEntry.author)) {
            errors.push(`${rLabel}: author must be a non-empty string`);
          }
          if (!isNonEmptyString(revEntry.summary)) {
            errors.push(`${rLabel}: summary must be a non-empty string`);
          }
          if (!SHA256_RE.test(String(revEntry.content_fingerprint ?? ''))) {
            errors.push(`${rLabel}: content_fingerprint must be 64-char lowercase SHA-256 hex`);
          } else if (revEntry.revision === clm.revision && revEntry.content_fingerprint !== expectedContentFp) {
            errors.push(
              `${rLabel}: Current revision ${clm.revision} content_fingerprint in revision_history does not match computed fingerprint`
            );
          }
          idxRev += 1;
        }
        if (Number.isInteger(clm.revision) && clm.revision_history.length !== clm.revision) {
          errors.push(
            `${label}: revision is ${clm.revision} but revision_history has ${clm.revision_history.length} entries`
          );
        }
      }

      // Reviews & dynamic staleness
      const nonStaleUpholdingKinds = new Set();
      if (!Array.isArray(clm.reviews)) {
        errors.push(`${label}: reviews must be an array`);
      } else {
        for (let rIdx = 0; rIdx < clm.reviews.length; rIdx++) {
          const rev = clm.reviews[rIdx];
          totalReviews += 1;
          const rLabel = `${label}.reviews[${rIdx}]`;
          if (!rev || typeof rev !== 'object' || Array.isArray(rev)) {
            errors.push(`${rLabel}: Review record must be an object`);
            continue;
          }
          checkUnknownKeys(rev, ALLOWED_REVIEW_KEYS, rLabel, errors);

          const rid = String(rev.review_id ?? '');
          if (!REVIEW_ID_RE.test(rid)) {
            errors.push(`${rLabel}: review_id '${rid}' must match 'REV-<digits>-<NNN>-<NN>'`);
          } else if (reviewIdSeen.has(rid)) {
            errors.push(`${rLabel}: Duplicate review_id '${rid}' (already in ${reviewIdSeen.get(rid)})`);
          } else {
            reviewIdSeen.set(rid, fileName);
          }

          if (rev.claim_id !== clm.id) {
            errors.push(`${rLabel}: claim_id '${rev.claim_id}' must equal '${clm.id}'`);
          }
          if (!Number.isInteger(rev.claim_revision) || rev.claim_revision < 1 || rev.claim_revision > clm.revision) {
            errors.push(`${rLabel}: claim_revision '${rev.claim_revision}' must be in 1..${clm.revision}`);
          }
          if (!VALID_REVIEWER_KINDS.has(rev.reviewer_kind)) {
            errors.push(`${rLabel}: Invalid reviewer_kind '${rev.reviewer_kind}'`);
          }
          if (!isNonEmptyString(rev.reviewer_id)) {
            errors.push(`${rLabel}: reviewer_id must be a non-empty string`);
          } else if (rev.reviewer_kind === 'human') {
            if (NON_HUMAN_REVIEWER_RE.test(rev.reviewer_id) || !/[A-Za-z]{2,}\s+[A-Za-z]{2,}/.test(rev.reviewer_id)) {
              errors.push(
                `${rLabel}: human review requires a named human person in reviewer_id, got '${rev.reviewer_id}'`
              );
            }
            if (rev.model_version !== null) {
              errors.push(`${rLabel}: human review must set model_version to null`);
            }
          } else if (!isNonEmptyString(rev.model_version)) {
            errors.push(`${rLabel}: ${rev.reviewer_kind} review requires a non-empty model_version`);
          }

          if (!isValidIsoCalendarDate(rev.review_date)) {
            errors.push(`${rLabel}: review_date '${rev.review_date}' must be YYYY-MM-DD`);
          }
          if (
            !Array.isArray(rev.review_scopes) ||
            rev.review_scopes.length === 0 ||
            new Set(rev.review_scopes).size !== rev.review_scopes.length ||
            rev.review_scopes.some((s) => !VALID_REVIEW_SCOPES.has(s))
          ) {
            errors.push(`${rLabel}: review_scopes must be a non-empty unique array of valid scopes`);
          }
          if (
            !Array.isArray(rev.inspected_evidence_refs) ||
            new Set(rev.inspected_evidence_refs).size !== rev.inspected_evidence_refs.length ||
            rev.inspected_evidence_refs.some((r) => !CERT_ID_RE.test(String(r)) && !CLAIM_ID_RE.test(String(r)))
          ) {
            errors.push(`${rLabel}: inspected_evidence_refs must be a unique array of CERT-*/CLM-* IDs`);
          }
          if (!isNonEmptyString(rev.findings)) {
            errors.push(`${rLabel}: findings must be a non-empty string`);
          }
          if (!Array.isArray(rev.objections) || rev.objections.some((o) => !isNonEmptyString(o))) {
            errors.push(`${rLabel}: objections must be an array of non-empty strings`);
          }
          if (!SHA256_RE.test(String(rev.material_fingerprint_at_review ?? ''))) {
            errors.push(`${rLabel}: material_fingerprint_at_review must be 64-char lowercase SHA-256 hex`);
          }
          if (
            !rev.evidence_fingerprints_at_review ||
            typeof rev.evidence_fingerprints_at_review !== 'object' ||
            Array.isArray(rev.evidence_fingerprints_at_review)
          ) {
            errors.push(`${rLabel}: evidence_fingerprints_at_review must be an object map`);
          } else {
            for (const [ek, ev] of Object.entries(rev.evidence_fingerprints_at_review)) {
              if (!CERT_ID_RE.test(ek) && !CLAIM_ID_RE.test(ek)) {
                errors.push(`${rLabel}: Invalid ref key '${ek}' in evidence_fingerprints_at_review`);
              }
              if (!SHA256_RE.test(String(ev))) {
                errors.push(`${rLabel}: Invalid SHA-256 digest for '${ek}' in evidence_fingerprints_at_review`);
              }
            }
          }
          if (!VALID_RECOMMENDATIONS.has(rev.recommendation)) {
            errors.push(`${rLabel}: Invalid recommendation '${rev.recommendation}'`);
          }

          const evMapJson =
            rev.evidence_fingerprints_at_review && typeof rev.evidence_fingerprints_at_review === 'object'
              ? canonicalJson(rev.evidence_fingerprints_at_review)
              : '';
          const isStale =
            rev.material_fingerprint_at_review !== expectedContentFp ||
            evMapJson !== canonicalJson(expectedEvidenceFps);

          if (isStale) {
            staleReviews += 1;
          } else {
            if (claimEvidenceRefs.size > 0 && Array.isArray(rev.inspected_evidence_refs)) {
              if (rev.inspected_evidence_refs.length === 0) {
                errors.push(`${rLabel}: Current non-stale review must list at least 1 inspected_evidence_refs item`);
              }
              for (const iref of rev.inspected_evidence_refs) {
                if (!claimEvidenceRefs.has(iref)) {
                  errors.push(
                    `${rLabel}: inspected_evidence_refs '${iref}' is not present in ${clm.id}.evidence`
                  );
                }
              }
            }
            if (rev.recommendation === 'uphold') {
              nonStaleUpholdingKinds.add(rev.reviewer_kind);
            }
          }
        }
      }

      if (clm.review_status === 'human_reviewed' && !nonStaleUpholdingKinds.has('human')) {
        errors.push(
          `${label}: review_status 'human_reviewed' requires a non-stale upholding review with reviewer_kind='human'`
        );
      } else if (
        clm.review_status === 'independently_agent_reviewed' &&
        !nonStaleUpholdingKinds.has('independent_agent') &&
        !nonStaleUpholdingKinds.has('human')
      ) {
        errors.push(
          `${label}: review_status 'independently_agent_reviewed' requires a non-stale upholding review by 'independent_agent' or 'human'`
        );
      } else if (
        clm.review_status === 'agent_reviewed' &&
        !nonStaleUpholdingKinds.has('agent') &&
        !nonStaleUpholdingKinds.has('independent_agent') &&
        !nonStaleUpholdingKinds.has('human')
      ) {
        errors.push(
          `${label}: review_status 'agent_reviewed' requires a non-stale upholding review matching the current material fingerprint`
        );
      }

      // External recognition
      if (!Array.isArray(clm.external_recognition)) {
        errors.push(`${label}: external_recognition must be an array`);
      } else {
        for (let xIdx = 0; xIdx < clm.external_recognition.length; xIdx++) {
          const xr = clm.external_recognition[xIdx];
          const xLabel = `${label}.external_recognition[${xIdx}]`;
          if (!xr || typeof xr !== 'object' || Array.isArray(xr)) {
            errors.push(`${xLabel}: Must be an object`);
            continue;
          }
          checkUnknownKeys(xr, ALLOWED_EXTERNAL_REC_KEYS, xLabel, errors);
          for (const fKey of ['recognizer', 'publication', 'url_or_ref', 'exact_scope']) {
            if (!isNonEmptyString(xr[fKey])) {
              errors.push(`${xLabel}: '${fKey}' must be a non-empty string`);
            }
          }
          if (!PARTIAL_ISO_DATE_RE.test(String(xr.date ?? ''))) {
            errors.push(`${xLabel}: date '${xr.date}' must match YYYY, YYYY-MM, or YYYY-MM-DD`);
          }
        }
      }
    }

    if (!hasActivePrincipal) {
      errors.push(`${fileName}: Must contain at least one active claim with is_principal === true`);
    }
  }

  // Global DAG & supersession cycle checks across all loaded claims
  const allClaimsList = Array.from(claimById.values());
  const infCycles = detectInferentialCycles(allClaimsList);
  for (const cyc of infCycles) {
    errors.push(`Inferential claim dependency cycle detected: ${cyc.join(' -> ')}`);
  }

  const supCycles = detectSupersessionCycles(allClaimsList);
  for (const cyc of supCycles) {
    errors.push(`Claim supersession cycle detected: ${cyc.join(' -> ')}`);
  }

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    stats: {
      claimLedgers: parsedLedgers.filter((l) => l.isTarget).length,
      totalLoadedLedgers: parsedLedgers.length,
      publishedCases: publishedCaseSlugs.length,
      totalClaims,
      activeClaims,
      reviews: totalReviews,
      staleReviews,
    },
  };
}

function parseCliArgs(argv) {
  const opts = {
    files: [],
    stampPaths: [],
    allowEmpty: false,
    requireAllCases: false,
    json: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--root') opts.rootDir = argv[++i];
    else if (a === '--claims-dir') opts.claimsDir = argv[++i];
    else if (a === '--ledgers-dir') opts.ledgersDir = argv[++i];
    else if (a === '--cases-dir') opts.casesDir = argv[++i];
    else if (a === '--file') opts.files.push(argv[++i]);
    else if (a === '--stamp-fingerprints') opts.stampPaths.push(argv[++i]);
    else if (a === '--allow-empty') opts.allowEmpty = true;
    else if (a === '--require-all-cases') opts.requireAllCases = true;
    else if (a === '--json') opts.json = true;
    else if (a === '--help' || a === '-h') opts.help = true;
    else throw new Error(`Unknown CLI argument: ${a}`);
  }
  return opts;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  let cli;
  try {
    cli = parseCliArgs(process.argv.slice(2));
  } catch (err) {
    console.error(err.message);
    process.exit(2);
  }

  if (cli.help) {
    console.log(
      'Usage: node scripts/validate-claims.mjs [--root DIR] [--claims-dir DIR] [--ledgers-dir DIR] [--cases-dir DIR] [--file PATH] [--stamp-fingerprints PATH] [--allow-empty] [--require-all-cases] [--json]'
    );
    process.exit(0);
  }

  if (cli.stampPaths.length > 0) {
    const stamped = stampClaimLedgerFingerprints(cli.stampPaths, cli);
    if (!cli.json) {
      console.log(
        `STAMPED_CLAIM_FINGERPRINTS (${stamped.claimsStamped} claims across ${stamped.filesStamped} file(s)).`
      );
    }
    process.exit(0);
  }

  const res = validateClaims(cli);
  if (cli.json) {
    console.log(JSON.stringify(res, null, 2));
    process.exit(res.ok ? 0 : 1);
  }

  if (!res.ok) {
    console.error(`CLAIM_VALIDATION_FAILED with ${res.errors.length} error(s):`);
    for (const e of res.errors) console.error(`  - ${e}`);
    process.exit(1);
  }

  console.log(
    `CLAIM_SCHEMA_AND_GRAPH_CHECKS_PASSED (${res.stats.claimLedgers}/${res.stats.publishedCases} case claim ledgers, ${res.stats.totalClaims} claims [${res.stats.activeClaims} active], ${res.stats.reviews} reviews [${res.stats.staleReviews} stale]).`
  );
}
