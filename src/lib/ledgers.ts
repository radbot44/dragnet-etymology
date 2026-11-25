import fs from 'node:fs';
import path from 'node:path';

export type RecordType = 'attestation' | 'contextual_evidence' | 'hypothesis' | 'rejected_lead';
export type VerificationLevel = 'discovered' | 'agent_verified' | 'human_verified' | 'externally_recognized';

export interface CitationRecord {
  id: string;
  slug: string;
  case_slug: string;
  headword: string;
  attested_form: string;
  record_type: RecordType;
  record_subtype: string | null;
  verification_level: VerificationLevel;
  verified_by_agent: string | null;
  human_verified_by: string | null;
  human_verified_date: string | null;
  external_recognition: string | null;
  publication_year: number | null;
  date_display: string;
  sort_date: string;
  short_gloss: string;
  source_publication: string;
  source_archive: string;
  source_url: string;
  page_and_column: string;
  verbatim_quote: string;
  masthead_date_verified: boolean;
  catalog_year: number | string | null;
  masthead_year: number | string | null;
  linguistic_note: string;
  analysis_notes: string;
  scan: {
    hosted_path: string | null;
    rights_status: string;
    rights_note: string;
  };
}

export interface CaseLedger {
  schema_version: string;
  ledger_id: string;
  case_number: string;
  target_id: string;
  headword: string;
  publication_status: string;
  publication_status_note: string;
  updated_at: string;
  prior_art_baselines: Record<string, any>;
  orthoepic_dictionary_survey_1828_1901?: any[];
  corpus_search_summary?: Record<string, any>;
  citations: CitationRecord[];
}

export interface LedgerStats {
  totalEvaluated: number;
  attestations: number;
  contextualControls: number;
  hypotheses: number;
  rejectedLeads: number;
  hostedScans: number;
  discovered: number;
  agentVerified: number;
  humanVerified: number;
  externallyRecognized: number;
}

const LEDGERS_DIR = path.resolve(process.cwd(), 'public/ledgers');
const OPEN_Q_PATH = path.resolve(process.cwd(), 'public/data/open-questions.json');

let _cache: CaseLedger[] | null = null;

export function getAllLedgers(): CaseLedger[] {
  if (_cache) return _cache;
  const files = fs.readdirSync(LEDGERS_DIR).filter((f) => f.endsWith('.json')).sort();
  _cache = files.map((file) => {
    const raw = fs.readFileSync(path.join(LEDGERS_DIR, file), 'utf-8');
    return JSON.parse(raw) as CaseLedger;
  });
  return _cache;
}

export function getLedgerBySlug(slug: string): CaseLedger {
  const found = getAllLedgers().find((l) => l.ledger_id === slug);
  if (!found) {
    throw new Error(`Missing JSON ledger for case '${slug}' in public/ledgers/${slug}.json`);
  }
  return found;
}

export function computeLedgerStats(citations: CitationRecord[]): LedgerStats {
  return {
    totalEvaluated: citations.length,
    attestations: citations.filter((c) => c.record_type === 'attestation').length,
    contextualControls: citations.filter((c) => c.record_type === 'contextual_evidence').length,
    hypotheses: citations.filter((c) => c.record_type === 'hypothesis').length,
    rejectedLeads: citations.filter((c) => c.record_type === 'rejected_lead').length,
    hostedScans: citations.filter((c) => Boolean(c.scan?.hosted_path)).length,
    discovered: citations.filter((c) => c.verification_level === 'discovered').length,
    agentVerified: citations.filter((c) => c.verification_level === 'agent_verified').length,
    humanVerified: citations.filter((c) => c.verification_level === 'human_verified').length,
    externallyRecognized: citations.filter((c) => c.verification_level === 'externally_recognized').length,
  };
}

export function getAllCitations(): CitationRecord[] {
  return getAllLedgers()
    .flatMap((l) => l.citations)
    .sort((a, b) => a.sort_date.localeCompare(b.sort_date) || a.id.localeCompare(b.id));
}

export function getOpenQuestionsData(): {
  total_targets: number;
  updated_at: string;
  targets: {
    target_id: string;
    headword: string;
    category: string;
    baseline_year: number;
    baseline_summary: string;
    open_question: string;
    status: string;
    case_slug?: string | null;
  }[];
} {
  return JSON.parse(fs.readFileSync(OPEN_Q_PATH, 'utf-8'));
}

export const VERIFICATION_LABELS: Record<VerificationLevel, string> = {
  discovered: 'Discovered',
  agent_verified: 'Agent-verified',
  human_verified: 'Human-verified',
  externally_recognized: 'Externally recognized',
};

export const RECORD_TYPE_LABELS: Record<RecordType, string> = {
  attestation: 'Attestation',
  contextual_evidence: 'Contextual control',
  hypothesis: 'Hypothesis',
  rejected_lead: 'Rejected lead',
};
