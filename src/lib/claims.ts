import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { CaseLedger, CitationRecord } from './ledgers';

export type ClaimType =
  | 'attestation'
  | 'antedating'
  | 'semantic'
  | 'historical_context'
  | 'transmission'
  | 'derivation'
  | 'phonological'
  | 'negative_evidence'
  | 'rebuttal'
  | 'source_relationship';

export type ClaimEpistemicKind = 'documentary' | 'interpretive';

export type ClaimAssessment =
  | 'unassessed'
  | 'supported'
  | 'partially_supported'
  | 'inconclusive'
  | 'contradicted';

export type ClaimReviewStatus =
  | 'unreviewed'
  | 'agent_reviewed'
  | 'independently_agent_reviewed'
  | 'human_reviewed';

export type LifecycleStatus = 'active' | 'superseded' | 'withdrawn';

export type DatePrecision = 'day' | 'month' | 'year' | 'circa';

export type EvidenceRelationship =
  | 'supports'
  | 'contradicts'
  | 'weakens'
  | 'qualifies'
  | 'contextualizes'
  | 'depends_on';

export type EvidenceDirectness = 'direct' | 'indirect' | 'contextual';

export type ComparisonKind =
  | 'earlier_same_sense'
  | 'earlier_spelling'
  | 'earlier_derivative_or_inflected'
  | 'proper_name_precursor'
  | 'earliest_in_search_scope'
  | 'earliest_reported_by_authority';

export type BaselineInspectionMode = 'directly_inspected' | 'inherited_from_existing_research';

export type ReviewerKind = 'agent' | 'independent_agent' | 'human';

export type ReviewScope =
  | 'structural'
  | 'transcription'
  | 'archival'
  | 'baseline'
  | 'linguistic_argument';

export type ReviewRecommendation =
  | 'uphold'
  | 'revise'
  | 'downgrade'
  | 'contradict'
  | 'withdraw'
  | 'needs_human_review';

export interface EvidenceBoundary {
  establishes: string;
  does_not_establish: string;
  remaining_uncertainty: string;
}

export interface EvidenceLink {
  ref: string;
  relationship: EvidenceRelationship;
  directness: EvidenceDirectness;
  reason: string;
  witness_note?: string | null;
}

export interface AntedatingBaseline {
  authority: string;
  entry_and_sense: string;
  edition_or_revision: string;
  baseline_date: string;
  baseline_date_precision: DatePrecision;
  source_url_or_ref: string;
  checked_date: string;
  comparison_kind: ComparisonKind;
  advancing_citation_ref: string;
  attested_date: string;
  attested_date_precision: DatePrecision;
  computed_advance_display: string;
  inspection_mode: BaselineInspectionMode;
}

export interface NegativeEvidenceBounds {
  corpus_identity: string;
  search_date: string;
  search_period: string;
  query_terms: string[];
  search_method: string;
  corpus_coverage: string | null;
  known_limitations: string[];
  qualifying_results_count: number | null;
}

export interface ClaimRevisionEntry {
  revision: number;
  date: string;
  author: string;
  summary: string;
  content_fingerprint: string;
}

export interface ClaimReviewRecord {
  review_id: string;
  claim_id: string;
  claim_revision: number;
  reviewer_id: string;
  reviewer_kind: ReviewerKind;
  model_version: string | null;
  review_date: string;
  review_scopes: ReviewScope[];
  inspected_evidence_refs: string[];
  findings: string;
  objections: string[];
  material_fingerprint_at_review: string;
  evidence_fingerprints_at_review: Record<string, string>;
  recommendation: ReviewRecommendation;
}

export interface HydratedClaimReview extends ClaimReviewRecord {
  is_stale: boolean;
  stale_reasons: string[];
}

export interface ExternalRecognitionRecord {
  recognizer: string;
  publication: string;
  date: string;
  url_or_ref: string;
  exact_scope: string;
}

export interface ClaimRecord {
  id: string;
  slug: string;
  case_slug: string;
  headword: string;
  target_lexeme?: string | null;
  case_section?: string | null;
  short_label: string;
  statement: string;
  rationale: string;
  type: ClaimType;
  assessment: ClaimAssessment;
  review_status: ClaimReviewStatus;
  is_principal: boolean;
  sort_order?: number | null;
  lifecycle_status: LifecycleStatus;
  revision: number;
  supersedes: string[];
  superseded_by: string | null;
  evidence_boundary: EvidenceBoundary;
  limitations: string[];
  resolution_criteria: string[];
  evidence: EvidenceLink[];
  antedating_baseline?: AntedatingBaseline | null;
  negative_evidence_bounds?: NegativeEvidenceBounds | null;
  content_fingerprint: string;
  revision_history: ClaimRevisionEntry[];
  reviews: ClaimReviewRecord[];
  external_recognition: ExternalRecognitionRecord[];
}

export interface HydratedClaimRecord extends Omit<ClaimRecord, 'reviews'> {
  epistemic_kind: ClaimEpistemicKind;
  computed_intrinsic_fingerprint: string;
  computed_content_fingerprint: string;
  evidence_fingerprints: Record<string, string>;
  fingerprint_matches_stored: boolean;
  reviews: HydratedClaimReview[];
  has_stale_reviews: boolean;
  non_stale_reviews_count: number;
  upstream_claim_ids: string[];
  downstream_claim_ids: string[];
  cross_ref_claim_ids: string[];
  referenced_citation_ids: string[];
}

export interface ClaimLedger {
  schema_version: '1.0';
  claim_ledger_id: string;
  case_slug: string;
  case_number: string;
  target_id: string;
  headword: string;
  updated_at: string;
  summary_note?: string | null;
  claims: ClaimRecord[];
}

export interface ClaimTypeMetadata {
  type: ClaimType;
  label: string;
  shortLabel: string;
  category: ClaimEpistemicKind;
  description: string;
  requiresAntedatingBaseline: boolean;
  requiresNegativeEvidenceBounds: boolean;
}

export const DOCUMENTARY_CLAIM_TYPES: readonly ClaimType[] = [
  'attestation',
  'antedating',
  'negative_evidence',
  'source_relationship',
] as const;

export const INTERPRETIVE_CLAIM_TYPES: readonly ClaimType[] = [
  'semantic',
  'historical_context',
  'transmission',
  'derivation',
  'phonological',
  'rebuttal',
] as const;

export const INFERENTIAL_RELATIONSHIPS: readonly EvidenceRelationship[] = [
  'depends_on',
  'supports',
] as const;

export const NON_INFERENTIAL_RELATIONSHIPS: readonly EvidenceRelationship[] = [
  'contradicts',
  'weakens',
  'qualifies',
  'contextualizes',
] as const;

export const UNRESOLVED_ASSESSMENTS: readonly ClaimAssessment[] = [
  'unassessed',
  'partially_supported',
  'inconclusive',
] as const;

export const CLAIM_TYPE_METADATA: Record<ClaimType, ClaimTypeMetadata> = {
  attestation: {
    type: 'attestation',
    label: 'Attestation',
    shortLabel: 'Attestation',
    category: 'documentary',
    description: 'Establishes primary-source occurrence, orthographic form, date, and print/manuscript context.',
    requiresAntedatingBaseline: false,
    requiresNegativeEvidenceBounds: false,
  },
  antedating: {
    type: 'antedating',
    label: 'Antedating',
    shortLabel: 'Antedating',
    category: 'documentary',
    description: 'Establishes chronological priority or baseline calibration relative to a lexicographical authority.',
    requiresAntedatingBaseline: true,
    requiresNegativeEvidenceBounds: false,
  },
  negative_evidence: {
    type: 'negative_evidence',
    label: 'Bounded negative evidence',
    shortLabel: 'Negative evidence',
    category: 'documentary',
    description: 'Establishes bounded absence or exact token count within a defined corpus, period, and query manifest.',
    requiresAntedatingBaseline: false,
    requiresNegativeEvidenceBounds: true,
  },
  source_relationship: {
    type: 'source_relationship',
    label: 'Source relationship',
    shortLabel: 'Source relation',
    category: 'documentary',
    description: 'Establishes bibliographic dependence (reprint chains, stereotype editions, ghostwords, masthead corrections).',
    requiresAntedatingBaseline: false,
    requiresNegativeEvidenceBounds: false,
  },
  semantic: {
    type: 'semantic',
    label: 'Semantic analysis',
    shortLabel: 'Semantic',
    category: 'interpretive',
    description: 'Analyzes sense boundaries, semantic shift, polysemy, or semantic-hinge bridging.',
    requiresAntedatingBaseline: false,
    requiresNegativeEvidenceBounds: false,
  },
  historical_context: {
    type: 'historical_context',
    label: 'Historical context',
    shortLabel: 'Historical context',
    category: 'interpretive',
    description: 'Evaluates institutional, occupational, or socio-historical milieu bearing on lexical emergence.',
    requiresAntedatingBaseline: false,
    requiresNegativeEvidenceBounds: false,
  },
  transmission: {
    type: 'transmission',
    label: 'Transmission pathway',
    shortLabel: 'Transmission',
    category: 'interpretive',
    description: 'Proposes geographic, occupational, register, or language-contact pathways of transmission.',
    requiresAntedatingBaseline: false,
    requiresNegativeEvidenceBounds: false,
  },
  derivation: {
    type: 'derivation',
    label: 'Derivational origin',
    shortLabel: 'Derivation',
    category: 'interpretive',
    description: 'Proposes morphological formation, compounding, clipping, eponym, or donor-language etymon.',
    requiresAntedatingBaseline: false,
    requiresNegativeEvidenceBounds: false,
  },
  phonological: {
    type: 'phonological',
    label: 'Phonological argument',
    shortLabel: 'Phonology',
    category: 'interpretive',
    description: 'Evaluates sound correspondence, phonetic adaptation, orthoepic testimony, or prosodic structure.',
    requiresAntedatingBaseline: false,
    requiresNegativeEvidenceBounds: false,
  },
  rebuttal: {
    type: 'rebuttal',
    label: 'Hypothesis rebuttal / critique',
    shortLabel: 'Rebuttal',
    category: 'interpretive',
    description: 'Refutes or qualifies a prior etymological or chronological proposal on documentary or linguistic grounds.',
    requiresAntedatingBaseline: false,
    requiresNegativeEvidenceBounds: false,
  },
};

export const CLAIM_TYPE_LABELS: Record<ClaimType, string> = Object.fromEntries(
  Object.entries(CLAIM_TYPE_METADATA).map(([k, v]) => [k, v.label])
) as Record<ClaimType, string>;

export const CLAIM_ASSESSMENT_LABELS: Record<ClaimAssessment, string> = {
  unassessed: 'Unassessed',
  supported: 'Supported',
  partially_supported: 'Partially supported',
  inconclusive: 'Inconclusive',
  contradicted: 'Contradicted',
};

export const CLAIM_REVIEW_STATUS_LABELS: Record<ClaimReviewStatus, string> = {
  unreviewed: 'Unreviewed',
  agent_reviewed: 'Agent-reviewed',
  independently_agent_reviewed: 'Independently agent-reviewed',
  human_reviewed: 'Human-reviewed',
};

export const LIFECYCLE_STATUS_LABELS: Record<LifecycleStatus, string> = {
  active: 'Active',
  superseded: 'Superseded',
  withdrawn: 'Withdrawn',
};

export const EVIDENCE_RELATIONSHIP_LABELS: Record<EvidenceRelationship, string> = {
  supports: 'Supports',
  contradicts: 'Contradicts',
  weakens: 'Weakens',
  qualifies: 'Qualifies',
  contextualizes: 'Contextualizes',
  depends_on: 'Depends on',
};

export const COMPARISON_KIND_LABELS: Record<ComparisonKind, string> = {
  earlier_same_sense: 'Earlier witness (same sense)',
  earlier_spelling: 'Earlier orthographic variant',
  earlier_derivative_or_inflected: 'Earlier derivative or inflected form',
  proper_name_precursor: 'Earlier proper-name precursor',
  earliest_in_search_scope: 'Earliest witness within search scope',
  earliest_reported_by_authority: 'Earliest witness reported by authority',
};

export function isDocumentaryClaimType(type: ClaimType): boolean {
  return CLAIM_TYPE_METADATA[type]?.category === 'documentary';
}

export function isInterpretiveClaimType(type: ClaimType): boolean {
  return CLAIM_TYPE_METADATA[type]?.category === 'interpretive';
}

export function getClaimEpistemicKind(type: ClaimType): ClaimEpistemicKind {
  return CLAIM_TYPE_METADATA[type]?.category ?? 'interpretive';
}

export function isInferentialRelationship(rel: EvidenceRelationship): boolean {
  return rel === 'depends_on' || rel === 'supports';
}

export function requiresResolutionCriteria(type: ClaimType, assessment: ClaimAssessment): boolean {
  return isInterpretiveClaimType(type) && (UNRESOLVED_ASSESSMENTS as readonly string[]).includes(assessment);
}

// ---------------------------------------------------------------------------
// Canonicalization & Deterministic SHA-256 Fingerprinting
// ---------------------------------------------------------------------------

const WHITESPACE_COLLAPSE_RE = /[\t\n\v\f\r \u00a0\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]+/g;

export function normalizeText(value: string): string {
  return value.normalize('NFC').replace(WHITESPACE_COLLAPSE_RE, ' ').trim();
}

export function compareCodePoints(a: string, b: string): number {
  if (a === b) return 0;
  const pa = Array.from(a);
  const pb = Array.from(b);
  const len = Math.min(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const ca = pa[i].codePointAt(0)!;
    const cb = pb[i].codePointAt(0)!;
    if (ca !== cb) return ca - cb;
  }
  return pa.length - pb.length;
}

export function canonicalJson(value: unknown): string {
  if (value === null || value === undefined) return 'null';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new Error(`Non-finite number in canonicalJson: ${value}`);
    }
    return String(value);
  }
  if (typeof value === 'string') return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item)).join(',')}]`;
  }
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record).sort(compareCodePoints);
    const pairs = keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(record[k])}`);
    return `{${pairs.join(',')}}`;
  }
  throw new Error(`Unsupported value type in canonicalJson: ${typeof value}`);
}

export function sha256Hex(input: string | Uint8Array): string {
  return crypto.createHash('sha256').update(input).digest('hex');
}

const _scanHashCache = new Map<string, string>();

export function computeScanFileSha256(hostedPath: string, publicDir: string): string {
  const rel = normalizeText(hostedPath).replace(/^\/+/, '');
  const fullPath = path.resolve(publicDir, rel);
  const cached = _scanHashCache.get(fullPath);
  if (cached) return cached;
  if (!fs.existsSync(fullPath)) {
    return `missing:${normalizeText(hostedPath)}`;
  }
  const digest = sha256Hex(fs.readFileSync(fullPath));
  _scanHashCache.set(fullPath, digest);
  return digest;
}

export function computeCitationMaterialFingerprint(
  citation: CitationRecord,
  publicDir = path.resolve(process.cwd(), 'public')
): string {
  const hostedPath = citation.scan?.hosted_path ? normalizeText(String(citation.scan.hosted_path)) : null;
  const rightsStatus = citation.scan?.rights_status ? normalizeText(String(citation.scan.rights_status)) : null;
  const fileSha256 = hostedPath ? computeScanFileSha256(hostedPath, publicDir) : null;

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
    masthead_year: citation.masthead_year == null ? null : normalizeText(String(citation.masthead_year)),
    scan: {
      hosted_path: hostedPath,
      rights_status: rightsStatus,
      file_sha256: fileSha256,
    },
  };

  return sha256Hex(canonicalJson(payload));
}

export function computeIntrinsicClaimFingerprint(claim: ClaimRecord): string {
  const normalizedEvidence = (claim.evidence ?? [])
    .map((e) => ({
      ref: normalizeText(String(e.ref ?? '')),
      relationship: normalizeText(String(e.relationship ?? '')),
      directness: normalizeText(String(e.directness ?? '')),
      reason: normalizeText(String(e.reason ?? '')),
      witness_note: e.witness_note == null ? null : normalizeText(String(e.witness_note)),
    }))
    .sort((a, b) => compareCodePoints(a.ref, b.ref) || compareCodePoints(a.relationship, b.relationship));

  const ab = claim.antedating_baseline ?? null;
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

  const neb = claim.negative_evidence_bounds ?? null;
  const normalizedNegativeBounds = neb
    ? {
        corpus_identity: normalizeText(String(neb.corpus_identity ?? '')),
        search_date: normalizeText(String(neb.search_date ?? '')),
        search_period: normalizeText(String(neb.search_period ?? '')),
        query_terms: (neb.query_terms ?? []).map((q) => normalizeText(String(q))).sort(compareCodePoints),
        search_method: normalizeText(String(neb.search_method ?? '')),
        corpus_coverage: neb.corpus_coverage == null ? null : normalizeText(String(neb.corpus_coverage)),
        known_limitations: (neb.known_limitations ?? []).map((k) => normalizeText(String(k))).sort(compareCodePoints),
        qualifying_results_count: neb.qualifying_results_count ?? null,
      }
    : null;

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
    supersedes: (claim.supersedes ?? []).map((s) => normalizeText(String(s))).sort(compareCodePoints),
    superseded_by: claim.superseded_by == null ? null : normalizeText(String(claim.superseded_by)),
    evidence_boundary: {
      establishes: normalizeText(String(claim.evidence_boundary?.establishes ?? '')),
      does_not_establish: normalizeText(String(claim.evidence_boundary?.does_not_establish ?? '')),
      remaining_uncertainty: normalizeText(String(claim.evidence_boundary?.remaining_uncertainty ?? '')),
    },
    limitations: (claim.limitations ?? []).map((s) => normalizeText(String(s))).sort(compareCodePoints),
    resolution_criteria: (claim.resolution_criteria ?? [])
      .map((s) => normalizeText(String(s)))
      .sort(compareCodePoints),
    evidence: normalizedEvidence,
    antedating_baseline: normalizedAntedating,
    negative_evidence_bounds: normalizedNegativeBounds,
  };

  return sha256Hex(canonicalJson(payload));
}

export interface FingerprintContext {
  citationById: Map<string, CitationRecord>;
  claimById: Map<string, ClaimRecord>;
  publicDir?: string;
  citationFingerprintCache?: Map<string, string>;
  intrinsicFingerprintCache?: Map<string, string>;
  contentFingerprintCache?: Map<string, string>;
}

function getCachedIntrinsic(claim: ClaimRecord, ctx: FingerprintContext): string {
  const cache = ctx.intrinsicFingerprintCache;
  if (cache?.has(claim.id)) return cache.get(claim.id)!;
  const fp = computeIntrinsicClaimFingerprint(claim);
  cache?.set(claim.id, fp);
  return fp;
}

function getCachedCitationFp(certId: string, ctx: FingerprintContext): string {
  const cache = ctx.citationFingerprintCache;
  if (cache?.has(certId)) return cache.get(certId)!;
  const cit = ctx.citationById.get(certId);
  if (!cit) return `unresolved:${certId}`;
  const fp = computeCitationMaterialFingerprint(cit, ctx.publicDir);
  cache?.set(certId, fp);
  return fp;
}

export function computeClaimEvidenceFingerprints(
  claim: ClaimRecord,
  ctx: FingerprintContext,
  visiting: Set<string> = new Set()
): Record<string, string> {
  const byRef = new Map<string, EvidenceRelationship[]>();
  for (const edge of claim.evidence ?? []) {
    const ref = normalizeText(String(edge.ref ?? ''));
    const list = byRef.get(ref) ?? [];
    list.push(edge.relationship);
    byRef.set(ref, list);
  }

  const sortedRefs = Array.from(byRef.keys()).sort(compareCodePoints);
  const out: Record<string, string> = {};
  const nextVisiting = new Set(visiting);
  nextVisiting.add(claim.id);

  for (const ref of sortedRefs) {
    if (ref.startsWith('CERT-')) {
      out[ref] = getCachedCitationFp(ref, ctx);
    } else if (ref.startsWith('CLM-')) {
      const target = ctx.claimById.get(ref);
      if (!target) {
        out[ref] = `unresolved:${ref}`;
      } else {
        const rels = byRef.get(ref) ?? [];
        const hasInferential = rels.some((r) => isInferentialRelationship(r));
        if (hasInferential && ref !== claim.id && !nextVisiting.has(ref)) {
          out[ref] = computeClaimContentFingerprint(target, ctx, nextVisiting);
        } else {
          out[ref] = getCachedIntrinsic(target, ctx);
        }
      }
    } else {
      out[ref] = `invalid:${ref}`;
    }
  }

  return out;
}

export function computeClaimContentFingerprint(
  claim: ClaimRecord,
  ctx: FingerprintContext,
  visiting: Set<string> = new Set()
): string {
  if (visiting.size === 0 && ctx.contentFingerprintCache?.has(claim.id)) {
    return ctx.contentFingerprintCache.get(claim.id)!;
  }
  const intrinsicFp = getCachedIntrinsic(claim, ctx);
  const evidenceFps = computeClaimEvidenceFingerprints(claim, ctx, visiting);
  const payload = {
    schema: 'dragnet-claim-content-v1',
    intrinsic_fingerprint: intrinsicFp,
    evidence_fingerprints: evidenceFps,
  };
  const digest = sha256Hex(canonicalJson(payload));
  if (visiting.size === 0) {
    ctx.contentFingerprintCache?.set(claim.id, digest);
  }
  return digest;
}

export function computeReviewStaleness(
  review: ClaimReviewRecord,
  currentContentFingerprint: string,
  currentEvidenceFingerprints: Record<string, string>
): { is_stale: boolean; stale_reasons: string[] } {
  const reasons: string[] = [];
  if (review.material_fingerprint_at_review !== currentContentFingerprint) {
    reasons.push(
      `Claim content fingerprint changed since ${review.review_id} (${review.material_fingerprint_at_review.slice(0, 12)}… -> ${currentContentFingerprint.slice(0, 12)}…).`
    );
  }

  const recordedEv = review.evidence_fingerprints_at_review ?? {};
  const allRefs = new Set([...Object.keys(recordedEv), ...Object.keys(currentEvidenceFingerprints)]);
  for (const ref of Array.from(allRefs).sort(compareCodePoints)) {
    if (!(ref in recordedEv)) {
      reasons.push(`Evidence link '${ref}' was added after ${review.review_id}.`);
    } else if (!(ref in currentEvidenceFingerprints)) {
      reasons.push(`Evidence link '${ref}' was removed after ${review.review_id}.`);
    } else if (recordedEv[ref] !== currentEvidenceFingerprints[ref]) {
      reasons.push(`Referenced evidence '${ref}' changed after ${review.review_id}.`);
    }
  }

  return {
    is_stale: reasons.length > 0,
    stale_reasons: reasons,
  };
}

// ---------------------------------------------------------------------------
// Date-Precision Chronological Advance Calculator
// ---------------------------------------------------------------------------

export interface ParsedHistoricalDate {
  raw: string;
  precision: DatePrecision;
  year: number;
  endYear?: number;
  month?: number;
  day?: number;
}

export interface ChronologicalAdvanceResult {
  comparable: boolean;
  effectivePrecision: DatePrecision;
  isStrictlyEarlier: boolean | null;
  isSameAtPrecision: boolean | null;
  years?: number;
  months?: number;
  days?: number;
  totalDays?: number;
  totalMonths?: number;
  canonicalDisplay: string;
  reason?: string;
}

const PRECISION_RANK: Record<DatePrecision, number> = {
  circa: 0,
  year: 1,
  month: 2,
  day: 3,
};

export function daysInGregorianMonth(year: number, month1To12: number): number {
  if (month1To12 < 1 || month1To12 > 12) return 0;
  if (month1To12 === 2) {
    const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
    return leap ? 29 : 28;
  }
  return [4, 6, 9, 11].includes(month1To12) ? 30 : 31;
}

export function isValidIsoCalendarDate(dateStr: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr);
  if (!m) return false;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (year < 1000 || year > 2999 || month < 1 || month > 12) return false;
  const maxDay = daysInGregorianMonth(year, month);
  return day >= 1 && day <= maxDay;
}

export function parseHistoricalDateByPrecision(
  rawDate: string,
  precision: DatePrecision
): ParsedHistoricalDate | null {
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

function formatUnits(parts: string[]): string {
  if (parts.length === 0) return '0 days';
  if (parts.length === 1) return parts[0];
  if (parts.length === 2) return `${parts[0]} and ${parts[1]}`;
  return `${parts.slice(0, -1).join(', ')}, and ${parts[parts.length - 1]}`;
}

export function computeChronologicalAdvance(
  attestedDate: string,
  attestedPrecision: DatePrecision,
  baselineDate: string,
  baselinePrecision: DatePrecision
): ChronologicalAdvanceResult {
  const rank = Math.min(PRECISION_RANK[attestedPrecision], PRECISION_RANK[baselinePrecision]);
  const effectivePrecision: DatePrecision =
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
      reason: 'One or both dates do not match their declared precision.',
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
      reason: 'Circa date precision precludes exact calendar subtraction.',
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
    const attMonths = att.year * 12 + (att.month! - 1);
    const baseMonths = base.year * 12 + (base.month! - 1);
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
    const parts: string[] = [];
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

  // effectivePrecision === 'day'
  const utcAtt = Date.UTC(att.year, att.month! - 1, att.day!);
  const utcBase = Date.UTC(base.year, base.month! - 1, base.day!);
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
  let months = end.month! - start.month!;
  let days = end.day! - start.day!;

  if (days < 0) {
    const prevMonth = end.month! === 1 ? 12 : end.month! - 1;
    const prevYear = end.month! === 1 ? end.year - 1 : end.year;
    days += daysInGregorianMonth(prevYear, prevMonth);
    months -= 1;
  }
  if (months < 0) {
    months += 12;
    years -= 1;
  }

  const parts: string[] = [];
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

// ---------------------------------------------------------------------------
// Graph Traversal, Cycle Detection, Backlinks, and Statistics
// ---------------------------------------------------------------------------

export interface ClaimBacklink {
  claim: HydratedClaimRecord;
  edge: EvidenceLink;
  isAdvancingBaselineWitness: boolean;
}

export interface ClaimStats {
  totalClaims: number;
  activeClaims: number;
  supersededClaims: number;
  withdrawnClaims: number;
  principalClaims: number;
  documentaryClaims: number;
  interpretiveClaims: number;
  byType: Record<ClaimType, number>;
  byAssessment: Record<ClaimAssessment, number>;
  byReviewStatus: Record<ClaimReviewStatus, number>;
  staleReviewClaims: number;
  externallyRecognizedClaims: number;
  totalEvidenceEdges: number;
  citationEdges: number;
  inferentialClaimEdges: number;
  crossRefClaimEdges: number;
}

export interface GlobalClaimGraphStats extends ClaimStats {
  claimLedgersCount: number;
  coveredCaseSlugs: string[];
  uniqueCitationsReferenced: number;
  crossCaseEdges: number;
  hasCycles: boolean;
}

export interface ClaimSupportSummary {
  claim: HydratedClaimRecord;
  ownAssessment: ClaimAssessment;
  inheritsSupportFromChildren: false;
  directCitationEdges: { edge: EvidenceLink; citation: CitationRecord | null }[];
  inferentialPremiseClaims: { edge: EvidenceLink; premise: HydratedClaimRecord | null }[];
  nonInferentialCrossRefClaims: { edge: EvidenceLink; target: HydratedClaimRecord | null }[];
}

export interface ClaimGraphOptions {
  rootDir?: string;
  claimsDir?: string;
  ledgersDir?: string;
  publicDir?: string;
}

export interface LoadedClaimGraph {
  ledgers: ClaimLedger[];
  ledgerBySlug: Map<string, ClaimLedger>;
  claims: HydratedClaimRecord[];
  claimById: Map<string, HydratedClaimRecord>;
  claimBySlug: Map<string, HydratedClaimRecord>;
  claimsByCase: Map<string, HydratedClaimRecord[]>;
  citationById: Map<string, CitationRecord>;
  citationBacklinks: Map<string, ClaimBacklink[]>;
  cycles: string[][];
}

let _defaultGraphCache: LoadedClaimGraph | null = null;

export function clearClaimsCache(): void {
  _defaultGraphCache = null;
  _scanHashCache.clear();
}

export function detectInferentialCycles(claims: readonly Pick<ClaimRecord, 'id' | 'evidence'>[]): string[][] {
  const claimMap = new Map(claims.map((c) => [c.id, c]));
  const state = new Map<string, 0 | 1 | 2>(); // 0=unvisited, 1=visiting, 2=done
  const stack: string[] = [];
  const cycles: string[][] = [];
  const seenCycleSignatures = new Set<string>();

  function dfs(id: string): void {
    state.set(id, 1);
    stack.push(id);

    const node = claimMap.get(id);
    if (node) {
      const targets = (node.evidence ?? [])
        .filter((e) => e.ref.startsWith('CLM-') && isInferentialRelationship(e.relationship))
        .map((e) => e.ref)
        .sort(compareCodePoints);

      for (const targetId of targets) {
        if (!claimMap.has(targetId)) continue;
        const st = state.get(targetId) ?? 0;
        if (st === 1) {
          const idx = stack.indexOf(targetId);
          const cycleNodes = stack.slice(idx);
          // Canonicalize cycle rotation to avoid duplicate cycle reporting
          let minIdx = 0;
          for (let i = 1; i < cycleNodes.length; i++) {
            if (compareCodePoints(cycleNodes[i], cycleNodes[minIdx]) < 0) minIdx = i;
          }
          const rotated = [...cycleNodes.slice(minIdx), ...cycleNodes.slice(0, minIdx)];
          const sig = rotated.join('->');
          if (!seenCycleSignatures.has(sig)) {
            seenCycleSignatures.add(sig);
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
    if ((state.get(id) ?? 0) === 0) {
      dfs(id);
    }
  }

  return cycles;
}

export function topologicalSortClaims<T extends Pick<ClaimRecord, 'id' | 'evidence'>>(claims: readonly T[]): {
  ordered: T[];
  cycles: string[][];
} {
  const cycles = detectInferentialCycles(claims);
  const byId = new Map(claims.map((c) => [c.id, c]));
  const inDegree = new Map<string, number>();
  const dependents = new Map<string, string[]>();

  for (const c of claims) {
    inDegree.set(c.id, 0);
    dependents.set(c.id, []);
  }

  for (const c of claims) {
    const seenTargets = new Set<string>();
    for (const e of c.evidence ?? []) {
      if (e.ref.startsWith('CLM-') && isInferentialRelationship(e.relationship) && byId.has(e.ref)) {
        if (!seenTargets.has(e.ref)) {
          seenTargets.add(e.ref);
          inDegree.set(c.id, (inDegree.get(c.id) ?? 0) + 1);
          dependents.get(e.ref)!.push(c.id);
        }
      }
    }
  }

  const queue = Array.from(inDegree.entries())
    .filter(([, deg]) => deg === 0)
    .map(([id]) => id)
    .sort(compareCodePoints);

  const ordered: T[] = [];
  const placed = new Set<string>();

  while (queue.length > 0) {
    const id = queue.shift()!;
    placed.add(id);
    ordered.push(byId.get(id)!);
    for (const depId of (dependents.get(id) ?? []).sort(compareCodePoints)) {
      const nextDeg = (inDegree.get(depId) ?? 0) - 1;
      inDegree.set(depId, nextDeg);
      if (nextDeg === 0) {
        queue.push(depId);
        queue.sort(compareCodePoints);
      }
    }
  }

  // Append any cycle participants deterministically so no claim is dropped
  if (ordered.length < claims.length) {
    for (const id of Array.from(byId.keys()).sort(compareCodePoints)) {
      if (!placed.has(id)) {
        ordered.push(byId.get(id)!);
      }
    }
  }

  return { ordered, cycles };
}

function sortClaimsForPresentation(claims: HydratedClaimRecord[]): HydratedClaimRecord[] {
  return [...claims].sort((a, b) => {
    const sa = a.sort_order ?? Number.MAX_SAFE_INTEGER;
    const sb = b.sort_order ?? Number.MAX_SAFE_INTEGER;
    if (sa !== sb) return sa - sb;
    return compareCodePoints(a.id, b.id);
  });
}

export function loadClaimGraph(options?: ClaimGraphOptions): LoadedClaimGraph {
  const isDefault =
    !options?.rootDir && !options?.claimsDir && !options?.ledgersDir && !options?.publicDir;
  if (isDefault && _defaultGraphCache) {
    return _defaultGraphCache;
  }

  const rootDir = path.resolve(options?.rootDir ?? process.cwd());
  const publicDir = path.resolve(options?.publicDir ?? path.join(rootDir, 'public'));
  const ledgersDir = path.resolve(options?.ledgersDir ?? path.join(publicDir, 'ledgers'));
  const claimsDir = path.resolve(options?.claimsDir ?? path.join(publicDir, 'claims'));

  const citationById = new Map<string, CitationRecord>();
  if (fs.existsSync(ledgersDir)) {
    const ledgerFiles = fs
      .readdirSync(ledgersDir)
      .filter((f: string) => f.endsWith('.json'))
      .sort(compareCodePoints);
    for (const file of ledgerFiles) {
      const parsed = JSON.parse(fs.readFileSync(path.join(ledgersDir, file), 'utf-8')) as CaseLedger;
      for (const c of parsed.citations ?? []) {
        citationById.set(c.id, c);
      }
    }
  }

  const ledgers: ClaimLedger[] = [];
  const ledgerBySlug = new Map<string, ClaimLedger>();
  const rawClaimById = new Map<string, ClaimRecord>();

  if (fs.existsSync(claimsDir)) {
    const claimFiles = fs
      .readdirSync(claimsDir)
      .filter((f: string) => f.endsWith('.json'))
      .sort(compareCodePoints);
    for (const file of claimFiles) {
      const parsed = JSON.parse(fs.readFileSync(path.join(claimsDir, file), 'utf-8')) as ClaimLedger;
      ledgers.push(parsed);
      ledgerBySlug.set(parsed.case_slug, parsed);
      for (const clm of parsed.claims ?? []) {
        rawClaimById.set(clm.id, clm);
      }
    }
  }

  const fpCtx: FingerprintContext = {
    citationById,
    claimById: rawClaimById,
    publicDir,
    citationFingerprintCache: new Map(),
    intrinsicFingerprintCache: new Map(),
    contentFingerprintCache: new Map(),
  };

  // Precompute reverse edges across all claims
  const downstreamMap = new Map<string, Set<string>>();
  const crossRefMap = new Map<string, Set<string>>();
  for (const clm of rawClaimById.values()) {
    if (!downstreamMap.has(clm.id)) downstreamMap.set(clm.id, new Set());
    if (!crossRefMap.has(clm.id)) crossRefMap.set(clm.id, new Set());
  }

  for (const clm of rawClaimById.values()) {
    for (const edge of clm.evidence ?? []) {
      if (edge.ref.startsWith('CLM-')) {
        if (isInferentialRelationship(edge.relationship)) {
          if (!downstreamMap.has(edge.ref)) downstreamMap.set(edge.ref, new Set());
          downstreamMap.get(edge.ref)!.add(clm.id);
        } else {
          if (!crossRefMap.has(clm.id)) crossRefMap.set(clm.id, new Set());
          if (!crossRefMap.has(edge.ref)) crossRefMap.set(edge.ref, new Set());
          crossRefMap.get(clm.id)!.add(edge.ref);
          crossRefMap.get(edge.ref)!.add(clm.id);
        }
      }
    }
  }

  const claimById = new Map<string, HydratedClaimRecord>();
  const claimBySlug = new Map<string, HydratedClaimRecord>();
  const claimsByCase = new Map<string, HydratedClaimRecord[]>();
  const citationBacklinks = new Map<string, ClaimBacklink[]>();

  for (const ledger of ledgers) {
    const caseHydrated: HydratedClaimRecord[] = [];
    for (const raw of ledger.claims ?? []) {
      const intrinsicFp = computeIntrinsicClaimFingerprint(raw);
      const evidenceFps = computeClaimEvidenceFingerprints(raw, fpCtx);
      const contentFp = computeClaimContentFingerprint(raw, fpCtx);

      const hydratedReviews: HydratedClaimReview[] = (raw.reviews ?? []).map((rev) => {
        const staleness = computeReviewStaleness(rev, contentFp, evidenceFps);
        return {
          ...rev,
          is_stale: staleness.is_stale,
          stale_reasons: staleness.stale_reasons,
        };
      });

      const upstreamIds = Array.from(
        new Set(
          (raw.evidence ?? [])
            .filter((e) => e.ref.startsWith('CLM-') && isInferentialRelationship(e.relationship))
            .map((e) => e.ref)
        )
      ).sort(compareCodePoints);

      const downstreamIds = Array.from(downstreamMap.get(raw.id) ?? []).sort(compareCodePoints);
      const crossIds = Array.from(crossRefMap.get(raw.id) ?? []).sort(compareCodePoints);
      const certIds = Array.from(
        new Set((raw.evidence ?? []).filter((e) => e.ref.startsWith('CERT-')).map((e) => e.ref))
      ).sort(compareCodePoints);

      const hydrated: HydratedClaimRecord = {
        ...raw,
        epistemic_kind: getClaimEpistemicKind(raw.type),
        computed_intrinsic_fingerprint: intrinsicFp,
        computed_content_fingerprint: contentFp,
        evidence_fingerprints: evidenceFps,
        fingerprint_matches_stored: raw.content_fingerprint === contentFp,
        reviews: hydratedReviews,
        has_stale_reviews: hydratedReviews.some((r) => r.is_stale),
        non_stale_reviews_count: hydratedReviews.filter((r) => !r.is_stale).length,
        upstream_claim_ids: upstreamIds,
        downstream_claim_ids: downstreamIds,
        cross_ref_claim_ids: crossIds,
        referenced_citation_ids: certIds,
      };

      claimById.set(hydrated.id, hydrated);
      claimBySlug.set(hydrated.slug, hydrated);
      caseHydrated.push(hydrated);

      for (const edge of raw.evidence ?? []) {
        if (edge.ref.startsWith('CERT-')) {
          const list = citationBacklinks.get(edge.ref) ?? [];
          list.push({
            claim: hydrated,
            edge,
            isAdvancingBaselineWitness:
              raw.antedating_baseline?.advancing_citation_ref === edge.ref,
          });
          citationBacklinks.set(edge.ref, list);
        }
      }
    }
    claimsByCase.set(ledger.case_slug, sortClaimsForPresentation(caseHydrated));
  }

  for (const [certId, links] of citationBacklinks.entries()) {
    links.sort((a, b) => compareCodePoints(a.claim.id, b.claim.id));
    citationBacklinks.set(certId, links);
  }

  const allHydrated = Array.from(claimById.values()).sort((a, b) => compareCodePoints(a.id, b.id));
  const cycles = detectInferentialCycles(allHydrated);

  const graph: LoadedClaimGraph = {
    ledgers,
    ledgerBySlug,
    claims: allHydrated,
    claimById,
    claimBySlug,
    claimsByCase,
    citationById,
    citationBacklinks,
    cycles,
  };

  if (isDefault) {
    _defaultGraphCache = graph;
  }
  return graph;
}

// ---------------------------------------------------------------------------
// High-Level Convenience Accessors (Aligned with src/lib/ledgers.ts)
// ---------------------------------------------------------------------------

export function getAllClaimLedgers(options?: ClaimGraphOptions): ClaimLedger[] {
  return loadClaimGraph(options).ledgers;
}

export function hasClaimLedger(caseSlug: string, options?: ClaimGraphOptions): boolean {
  return loadClaimGraph(options).ledgerBySlug.has(caseSlug);
}

export function getClaimLedgerBySlug(caseSlug: string, options?: ClaimGraphOptions): ClaimLedger | null {
  return loadClaimGraph(options).ledgerBySlug.get(caseSlug) ?? null;
}

export function requireClaimLedgerBySlug(caseSlug: string, options?: ClaimGraphOptions): ClaimLedger {
  const found = getClaimLedgerBySlug(caseSlug, options);
  if (!found) {
    throw new Error(`Missing JSON claim ledger for case '${caseSlug}' in public/claims/${caseSlug}.json`);
  }
  return found;
}

export function getAllClaims(
  filter?: { includeNonActive?: boolean; options?: ClaimGraphOptions }
): HydratedClaimRecord[] {
  const all = loadClaimGraph(filter?.options).claims;
  if (filter?.includeNonActive === false) {
    return all.filter((c) => c.lifecycle_status === 'active');
  }
  return all;
}

export function getClaimById(id: string, options?: ClaimGraphOptions): HydratedClaimRecord | null {
  return loadClaimGraph(options).claimById.get(id) ?? null;
}

export function getClaimBySlug(slug: string, options?: ClaimGraphOptions): HydratedClaimRecord | null {
  return loadClaimGraph(options).claimBySlug.get(slug.toLowerCase()) ?? null;
}

export function getClaimsForCase(
  caseSlug: string,
  filter?: { includeNonActive?: boolean; options?: ClaimGraphOptions }
): HydratedClaimRecord[] {
  const list = loadClaimGraph(filter?.options).claimsByCase.get(caseSlug) ?? [];
  if (filter?.includeNonActive === false) {
    return list.filter((c) => c.lifecycle_status === 'active');
  }
  return list;
}

export function getPrincipalClaimsForCase(
  caseSlug: string,
  options?: ClaimGraphOptions
): HydratedClaimRecord[] {
  return getClaimsForCase(caseSlug, { includeNonActive: false, options }).filter((c) => c.is_principal);
}

export function getCitationClaimBacklinkIndex(
  options?: ClaimGraphOptions
): Map<string, ClaimBacklink[]> {
  return loadClaimGraph(options).citationBacklinks;
}

export function getClaimsForCitation(certId: string, options?: ClaimGraphOptions): ClaimBacklink[] {
  return loadClaimGraph(options).citationBacklinks.get(certId) ?? [];
}

export function getUpstreamDependencies(
  claimId: string,
  options?: ClaimGraphOptions
): HydratedClaimRecord[] {
  const g = loadClaimGraph(options);
  const claim = g.claimById.get(claimId);
  if (!claim) return [];
  return claim.upstream_claim_ids
    .map((id) => g.claimById.get(id))
    .filter((c): c is HydratedClaimRecord => Boolean(c));
}

export function getDownstreamDependents(
  claimId: string,
  options?: ClaimGraphOptions
): HydratedClaimRecord[] {
  const g = loadClaimGraph(options);
  const claim = g.claimById.get(claimId);
  if (!claim) return [];
  return claim.downstream_claim_ids
    .map((id) => g.claimById.get(id))
    .filter((c): c is HydratedClaimRecord => Boolean(c));
}

export function getCrossReferencedClaims(
  claimId: string,
  options?: ClaimGraphOptions
): HydratedClaimRecord[] {
  const g = loadClaimGraph(options);
  const claim = g.claimById.get(claimId);
  if (!claim) return [];
  return claim.cross_ref_claim_ids
    .map((id) => g.claimById.get(id))
    .filter((c): c is HydratedClaimRecord => Boolean(c));
}

export function summarizeClaimSupport(
  claimId: string,
  options?: ClaimGraphOptions
): ClaimSupportSummary | null {
  const g = loadClaimGraph(options);
  const claim = g.claimById.get(claimId);
  if (!claim) return null;

  const directCitationEdges = claim.evidence
    .filter((e) => e.ref.startsWith('CERT-'))
    .map((edge) => ({
      edge,
      citation: g.citationById.get(edge.ref) ?? null,
    }));

  const inferentialPremiseClaims = claim.evidence
    .filter((e) => e.ref.startsWith('CLM-') && isInferentialRelationship(e.relationship))
    .map((edge) => ({
      edge,
      premise: g.claimById.get(edge.ref) ?? null,
    }));

  const nonInferentialCrossRefClaims = claim.evidence
    .filter((e) => e.ref.startsWith('CLM-') && !isInferentialRelationship(e.relationship))
    .map((edge) => ({
      edge,
      target: g.claimById.get(edge.ref) ?? null,
    }));

  return {
    claim,
    ownAssessment: claim.assessment,
    inheritsSupportFromChildren: false,
    directCitationEdges,
    inferentialPremiseClaims,
    nonInferentialCrossRefClaims,
  };
}

export function computeCaseClaimStats(claims: readonly HydratedClaimRecord[]): ClaimStats {
  const byType: Record<ClaimType, number> = {
    attestation: 0,
    antedating: 0,
    semantic: 0,
    historical_context: 0,
    transmission: 0,
    derivation: 0,
    phonological: 0,
    negative_evidence: 0,
    rebuttal: 0,
    source_relationship: 0,
  };
  const byAssessment: Record<ClaimAssessment, number> = {
    unassessed: 0,
    supported: 0,
    partially_supported: 0,
    inconclusive: 0,
    contradicted: 0,
  };
  const byReviewStatus: Record<ClaimReviewStatus, number> = {
    unreviewed: 0,
    agent_reviewed: 0,
    independently_agent_reviewed: 0,
    human_reviewed: 0,
  };

  let activeClaims = 0;
  let supersededClaims = 0;
  let withdrawnClaims = 0;
  let principalClaims = 0;
  let documentaryClaims = 0;
  let interpretiveClaims = 0;
  let staleReviewClaims = 0;
  let externallyRecognizedClaims = 0;
  let totalEvidenceEdges = 0;
  let citationEdges = 0;
  let inferentialClaimEdges = 0;
  let crossRefClaimEdges = 0;

  for (const c of claims) {
    if (c.lifecycle_status === 'active') activeClaims += 1;
    else if (c.lifecycle_status === 'superseded') supersededClaims += 1;
    else if (c.lifecycle_status === 'withdrawn') withdrawnClaims += 1;

    if (c.is_principal && c.lifecycle_status === 'active') principalClaims += 1;
    if (isDocumentaryClaimType(c.type)) documentaryClaims += 1;
    else interpretiveClaims += 1;

    if (c.type in byType) byType[c.type] += 1;
    if (c.assessment in byAssessment) byAssessment[c.assessment] += 1;
    if (c.review_status in byReviewStatus) byReviewStatus[c.review_status] += 1;

    if (c.has_stale_reviews) staleReviewClaims += 1;
    if ((c.external_recognition?.length ?? 0) > 0) externallyRecognizedClaims += 1;

    for (const e of c.evidence ?? []) {
      totalEvidenceEdges += 1;
      if (e.ref.startsWith('CERT-')) citationEdges += 1;
      else if (isInferentialRelationship(e.relationship)) inferentialClaimEdges += 1;
      else crossRefClaimEdges += 1;
    }
  }

  return {
    totalClaims: claims.length,
    activeClaims,
    supersededClaims,
    withdrawnClaims,
    principalClaims,
    documentaryClaims,
    interpretiveClaims,
    byType,
    byAssessment,
    byReviewStatus,
    staleReviewClaims,
    externallyRecognizedClaims,
    totalEvidenceEdges,
    citationEdges,
    inferentialClaimEdges,
    crossRefClaimEdges,
  };
}

export function computeGlobalClaimStats(options?: ClaimGraphOptions): GlobalClaimGraphStats {
  const g = loadClaimGraph(options);
  const base = computeCaseClaimStats(g.claims);
  let crossCaseEdges = 0;

  for (const c of g.claims) {
    for (const e of c.evidence ?? []) {
      if (e.ref.startsWith('CERT-')) {
        const cit = g.citationById.get(e.ref);
        if (cit && cit.case_slug !== c.case_slug) crossCaseEdges += 1;
      } else if (e.ref.startsWith('CLM-')) {
        const target = g.claimById.get(e.ref);
        if (target && target.case_slug !== c.case_slug) crossCaseEdges += 1;
      }
    }
  }

  return {
    ...base,
    claimLedgersCount: g.ledgers.length,
    coveredCaseSlugs: g.ledgers.map((l) => l.case_slug),
    uniqueCitationsReferenced: g.citationBacklinks.size,
    crossCaseEdges,
    hasCycles: g.cycles.length > 0,
  };
}

/**
 * Defensively normalizes CitationRecord.sort_date strings (including truncated or
 * range/annotated values such as '1895 (misd', '1898-03 (m', '1915-01/19', '1901-11', or '1825')
 * into a deterministic 'YYYY-MM-DD' sort key without assuming strict 10-char ISO dates.
 */
export function normalizeCitationSortKey(
  sortDate: string | null | undefined,
  publicationYear?: number | null
): string {
  const raw = String(sortDate ?? '').trim();
  const m = /^(\d{4})(?:-(\d{2})(?:-(\d{2}))?)?/.exec(raw);
  if (m) {
    const yyyy = m[1];
    const mm = m[2] ?? '99';
    const dd = m[3] ?? '99';
    return `${yyyy}-${mm}-${dd}`;
  }
  if (typeof publicationYear === 'number' && Number.isFinite(publicationYear)) {
    return `${String(publicationYear).padStart(4, '0')}-99-99`;
  }
  return '9999-99-99';
}

export function compareCitationsChronologically(
  a: Pick<CitationRecord, 'id' | 'sort_date' | 'publication_year'>,
  b: Pick<CitationRecord, 'id' | 'sort_date' | 'publication_year'>
): number {
  const ka = normalizeCitationSortKey(a.sort_date, a.publication_year);
  const kb = normalizeCitationSortKey(b.sort_date, b.publication_year);
  return compareCodePoints(ka, kb) || compareCodePoints(a.id, b.id);
}

/**
 * Determines whether a CERT-* or CLM-* reference belongs to the same case as claimCaseSlug
 * by checking canonical case_slug membership rather than numeric ID prefix (cleanly supporting
 * wave prefixes such as CERT-900-* in gimmick and CERT-1200-* in shill-shillaber).
 */
export function isSameCaseEvidenceRef(
  claimCaseSlug: string,
  ref: string,
  options?: ClaimGraphOptions
): boolean {
  const g = loadClaimGraph(options);
  if (ref.startsWith('CERT-')) {
    const cit = g.citationById.get(ref);
    return cit ? cit.case_slug === claimCaseSlug : false;
  }
  if (ref.startsWith('CLM-')) {
    const target = g.claimById.get(ref);
    return target ? target.case_slug === claimCaseSlug : false;
  }
  return false;
}
