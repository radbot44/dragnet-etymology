/**
 * DRAgNEt Unified Cloudflare Worker Hub (worker/index.ts)
 * =======================================================
 * Single-repo, zero-extra-dependency Worker deployed alongside Astro Static Assets:
 *   1. Stateless MCP Streamable HTTP server at `/mcp` (Claude, Cursor, MCP clients)
 *   2. Matching REST + OpenAPI 3.1 API at `/api/v1/*` (ChatGPT Actions, Gemini, CLI)
 *   3. Edge-cached R2 + Static Assets proof-scan router at `/scans/*`
 *   4. Deterministic phonological scorer & DRAgNEt v3 schema / Trap A-D validator
 *   5. Automated GitHub Pull Request publisher (replaces manual .zip shuttles)
 *
 * Required Worker Secrets (`npx wrangler secret put <NAME>`):
 *   - DRAGNET_API_KEY : Shared Bearer token for AI clients (/mcp and mutating /api/v1/*)
 *   - GITHUB_PAT      : Fine-grained GitHub token on radbot44/dragnet-etymology
 *                       (Contents: Read & write, Pull requests: Read & write)
 */

export interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
  first<T = Record<string, unknown>>(colName?: string): Promise<T | null>;
  run<T = Record<string, unknown>>(): Promise<{ success: boolean; results?: T[]; meta: Record<string, unknown> }>;
  all<T = Record<string, unknown>>(): Promise<{ success: boolean; results: T[]; meta: Record<string, unknown> }>;
}

export interface D1Database {
  prepare(query: string): D1PreparedStatement;
  batch<T = unknown>(statements: D1PreparedStatement[]): Promise<Array<{ results?: T[]; success: boolean }>>;
}

export interface R2ObjectBody {
  body: ReadableStream;
  size: number;
  etag: string;
  httpEtag: string;
  httpMetadata?: { contentType?: string; cacheControl?: string };
  customMetadata?: Record<string, string>;
  arrayBuffer(): Promise<ArrayBuffer>;
}

export interface R2Bucket {
  head(key: string): Promise<{ size: number; etag: string; customMetadata?: Record<string, string> } | null>;
  get(key: string): Promise<R2ObjectBody | null>;
  put(
    key: string,
    value: ArrayBuffer | Uint8Array | ReadableStream | string,
    options?: {
      httpMetadata?: { contentType?: string; cacheControl?: string };
      customMetadata?: Record<string, string>;
    }
  ): Promise<{ key: string; size: number; etag: string }>;
}

export interface Fetcher {
  fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
}

export interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
}

export interface Env {
  DB: D1Database;
  SCANS: R2Bucket;
  ASSETS: Fetcher;
  DRAGNET_API_KEY?: string;
  GITHUB_PAT?: string;
  GITHUB_REPO?: string;
  GITHUB_BASE_BRANCH?: string;
  SITE_ORIGIN?: string;
}

type RecordType = 'attestation' | 'contextual_evidence' | 'hypothesis' | 'rejected_lead';
type VerificationLevel = 'discovered' | 'agent_verified' | 'human_verified' | 'externally_recognized';

export interface CitationInput {
  id: string;
  slug?: string;
  case_slug: string;
  headword: string;
  attested_form: string;
  record_type: RecordType;
  record_subtype?: string | null;
  verification_level: VerificationLevel;
  verified_by_agent?: string | null;
  human_verified_by?: string | null;
  human_verified_date?: string | null;
  external_recognition?: string | null;
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
  catalog_year?: number | string | null;
  masthead_year?: number | string | null;
  linguistic_note?: string;
  analysis_notes?: string;
  scan?: {
    hosted_path: string | null;
    rights_status: string;
    rights_note: string;
    rights_cleared?: boolean;
  };
}

// ============================================================================
// 1. Constants, Epistemic Constitution & Validation Regexes
// ============================================================================

const VALID_RECORD_TYPES = new Set<string>(['attestation', 'contextual_evidence', 'hypothesis', 'rejected_lead']);
const VALID_VER_LEVELS = new Set<string>(['discovered', 'agent_verified', 'human_verified', 'externally_recognized']);
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

const WORKSPACE_LEAK_RE =
  /(?:drive\.google\.com|docs\.google\.com|googledrive:\/\/|workspace_drive_folder_id|evidence_scans_folder_id|scan_evidence_drive_id|zenodo)/i;
const RAW_SCORE_RE = /\b(?:SLPL|JW|jaro[_ -]?winkler|skeleton_similarity)\s*=\s*\d\.\d{3,4}\b/i;
const DECIMAL_YEAR_RE = /(?:-?\b\d+\.\d+\s*(?:yrs?|years?)\b)/i;
const CERT_ID_RE = /\bCERT-\d{3,4}-\d{3}[A-Za-z]?\b/g;

const SUPPORTED_MCP_VERSIONS = [
  '2026-07-28',
  '2025-11-25',
  '2025-06-18',
  '2025-03-26',
  '2024-11-05',
];

const DRAGNET_CONSTITUTION = [
  'DRAgNEt Historical Lexicography Hub: Check queue via get_pipeline_status, inspect targets via get_target_brief, search citations via search_corpus, and score phonetics/OCR via score_phonetics_and_variants. Pass 1 Proposer (role="proposer") claims targets and logs candidates at verification_level="discovered"; Pass 2 Red-Team (role="redteam") audits physical scans/mastheads (Traps A-D), promotes survivors to "agent_verified", uploads pre-1931 WebP plates, and opens GitHub PRs.',
  'Rules:',
  '1. Proposer != Judge: Pass 1 submits strictly at verification_level="discovered". Only Pass 2 promotes to "agent_verified" after primary-scan + masthead inspection.',
  '2. Trap A (Serial/Stereotype Misdating): Verify masthead_year on the physical masthead, running header, or copyright leaf rather than catalog metadata alone.',
  '3. Trap B (Dirty-OCR Ghosts): Verify physical ink letter-by-letter on the page scan.',
  '4. Trap C & D (Homographs & Modern Apparatus): Separate proper names/surnames and reject modern preface/editorial hits.',
  '5. Pre-1931 Scan Rights Gate: Only works with publication_year <= 1930 (or explicit rights_cleared=true) may set scan.hosted_path. Post-1930 works must set scan.hosted_path=null and link externally via https:// source_url.',
  '6. Editorial Cleanliness: Express antedatings in natural years, months, and days (never decimal years), omit raw 4-decimal harness scores from Case File prose, and include zero cloud-drive or Zenodo references.',
].join('\n');

// ============================================================================
// 2. Phonological Contact Scorer & OCR Variant Generator (Port of 03_harness)
// ============================================================================

const OCR_SUBS: ReadonlyArray<[string, string]> = [
  ['m', 'rn'], ['m', 'nn'], ['rn', 'm'],
  ['h', 'li'], ['h', 'b'], ['d', 'cl'], ['cl', 'd'],
  ['w', 'vv'], ['e', 'c'], ['c', 'e'],
  ['i', 'l'], ['l', 'i'], ['t', 'l'],
  ['u', 'n'], ['n', 'u'], ['s', 'f'], ['ss', 'fs'],
  ['g', 'q'], ['o', 'a'],
];

const PHONETIC_SUBS: ReadonlyArray<[string, string]> = [
  ['ph', 'f'], ['f', 'ph'], ['sh', 'sch'], ['sh', 's'],
  ['ck', 'k'], ['c', 'k'], ['dg', 'g'], ['j', 'g'], ['g', 'j'],
  ['oo', 'o'], ['o', 'oo'], ['oo', 'ou'], ['oo', 'u'], ['ee', 'ea'], ['ee', 'e'],
  ['ey', 'y'], ['ey', 'ie'], ['y', 'ie'], ['y', 'ey'], ['ie', 'y'],
  ['in', 'ing'], ['ing', 'in'], ['wh', 'w'], ['z', 's'], ['s', 'z'],
  ['ll', 'l'], ['l', 'll'], ['dd', 'd'], ['mm', 'm'],
  ['nn', 'n'], ['gg', 'g'], ['bb', 'b'], ['pp', 'p'], ['tt', 't'],
];

const ARTICULATORY_CLASS: Record<string, string> = {
  p: 'P', b: 'P', f: 'P', v: 'P',
  t: 'T', d: 'T',
  s: 'S', z: 'S', c: 'S', j: 'S',
  k: 'K', g: 'K', q: 'K', x: 'K', h: 'K',
  m: 'N', n: 'N',
  l: 'L', r: 'L',
  w: 'W', y: 'W',
};

function applySinglePassSubs(word: string, rules: ReadonlyArray<[string, string]>): Set<string> {
  const out = new Set<string>();
  const lower = word.toLowerCase();
  for (const [src, dst] of rules) {
    let start = 0;
    while (true) {
      const idx = lower.indexOf(src, start);
      if (idx === -1) break;
      const candidate = lower.slice(0, idx) + dst + lower.slice(idx + src.length);
      if (candidate.length >= 3) out.add(candidate);
      start = idx + 1;
    }
  }
  return out;
}

export function generateOcrVariants(word: string, cap = 80): string[] {
  const base = word.toLowerCase().trim();
  const visited = new Set<string>([base]);
  for (const v of applySinglePassSubs(base, OCR_SUBS)) {
    visited.add(v);
    if (visited.size >= cap) break;
  }
  return Array.from(visited).sort().slice(0, cap);
}

export function generatePhoneticVariants(word: string, cap = 80): string[] {
  const base = word.toLowerCase().trim();
  const variants = new Set<string>([base]);
  for (const v of applySinglePassSubs(base, PHONETIC_SUBS)) variants.add(v);
  const vowels = ['a', 'e', 'i', 'o', 'u'];
  for (let i = 1; i < base.length - 1; i++) {
    const ch = base[i];
    if (vowels.includes(ch)) {
      for (const v of vowels) {
        if (v !== ch) variants.add(base.slice(0, i) + v + base.slice(i + 1));
      }
    }
  }
  if (base.endsWith('s') && base.length > 4) variants.add(base.slice(0, -1));
  else variants.add(`${base}s`);
  if (base.endsWith('e') && base.length > 4) {
    variants.add(`${base.slice(0, -1)}ing`);
    variants.add(`${base}d`);
  }
  return Array.from(variants).sort().slice(0, cap);
}

export function compileDirtyOcrRegexPattern(word: string): string {
  const charClasses: Record<string, string> = {
    a: '[aou]', b: '[bh]', c: '[ce]', d: '(?:d|cl)', e: '[eco]',
    f: '[fsſ]', g: '[gq]', h: '(?:h|li|b)', i: '[il1!]', l: '[li1t]',
    m: '(?:m|rn|nn)', n: '[nu]', o: '[oa0]', r: '[r]', s: '[sfſz]',
    t: '[tl]', u: '[un]', w: '(?:w|vv)', y: '[yv]', z: '[zs]',
  };
  const clean = word.toLowerCase().trim();
  const joiner = '(?:-\\s*\\n\\s*|\\s*-?\\s*)?';

  // Handle common English -y / -ey / -ie / -ies word-final alternations (e.g. doozy/doozie/doozey/doozies)
  let stem = clean;
  let terminalPattern = '';
  if (clean.length >= 4 && (clean.endsWith('ey') || clean.endsWith('ie'))) {
    stem = clean.slice(0, -2);
    terminalPattern = '(?:[eco]?[yv]|[il1!][eco]s?)';
  } else if (clean.length >= 3 && clean.endsWith('y') && !/[aeiou]y$/.test(clean)) {
    stem = clean.slice(0, -1);
    terminalPattern = '(?:[eco]?[yv]|[il1!][eco]s?)';
  }

  const pieces: string[] = [];
  for (let i = 0; i < stem.length; i++) {
    const ch = stem[i];
    if (ch === ' ') {
      pieces.push('\\s+');
    } else if (ch === '-') {
      pieces.push('[-\\s]*');
    } else if ((ch === 'o' || ch === 'e') && stem[i + 1] === ch) {
      // Allow doubled oo/ee to match single o/e (e.g. doozy -> dozy, shebang -> sheebang)
      const cls = charClasses[ch];
      pieces.push(`${cls}(?:${joiner}${cls})?`);
      i += 1;
    } else {
      pieces.push(charClasses[ch] ?? ch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    }
  }
  if (terminalPattern) {
    pieces.push(terminalPattern);
  }
  return `\\b${pieces.join(joiner)}(?:e?s)?\\b`;
}

export function compileOrthographicVariantRegex(word: string): string {
  const all = new Set<string>([
    word.toLowerCase().trim(),
    ...generatePhoneticVariants(word, 60),
    ...generateOcrVariants(word, 30),
  ]);
  // Explicitly include -y / -ie / -ey / -ies family across both original stem and oo<->o / ee<->e stems (e.g. doozy -> dozy/dozie/dozey)
  const clean = word.toLowerCase().trim();
  const yStem = clean.endsWith('ey') || clean.endsWith('ie')
    ? clean.slice(0, -2)
    : clean.endsWith('y')
    ? clean.slice(0, -1)
    : null;
  if (yStem && yStem.length >= 2) {
    const candidateStems = new Set<string>([yStem]);
    if (yStem.includes('oo')) candidateStems.add(yStem.replace(/oo/g, 'o'));
    if (yStem.includes('ee')) candidateStems.add(yStem.replace(/ee/g, 'e'));
    for (const st of candidateStems) {
      if (st.length >= 2) {
        for (const suf of ['y', 'ie', 'ey', 'ies', 'eys', 'ys']) {
          all.add(`${st}${suf}`);
        }
      }
    }
  }
  const escaped = Array.from(all)
    .filter(Boolean)
    .sort((a, b) => b.length - a.length || a.localeCompare(b))
    .map((v) => v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+'));
  return `\\b(?:${escaped.join('|')})\\b`;
}

export function extractSenseMilestoneYears(baselineYear: number, baselineSummary: string): {
  earliest_baseline_year: number;
  latest_sense_baseline_year: number;
  sense_milestone_years: number[];
} {
  const found = new Set<number>([baselineYear]);
  const matches = baselineSummary.match(/\b(1[5-9]\d{2}|20[0-2]\d)\b/g) || [];
  for (const m of matches) {
    const yr = Number(m);
    // Keep historical attestation/sense years (>= baselineYear and <= 1985, excluding modern citation parentheses > 1995 unless baseline itself is late)
    if (yr >= baselineYear && (yr <= 1985 || yr <= baselineYear + 40)) {
      found.add(yr);
    }
  }
  const sorted = Array.from(found).sort((a, b) => a - b);
  return {
    earliest_baseline_year: sorted[0],
    latest_sense_baseline_year: sorted[sorted.length - 1],
    sense_milestone_years: sorted,
  };
}

export function consonantSkeleton(form: string): string {
  let s = form.toLowerCase().trim();
  const digraphs: ReadonlyArray<[string, string]> = [
    ['tch', 's'], ['sch', 's'], ['sh', 's'], ['ch', 's'],
    ['ph', 'f'], ['th', 't'], ['gh', 'k'], ['ck', 'k'],
    ['ng', 'n'], ['qu', 'k'], ['wh', 'w'],
  ];
  for (const [dg, repl] of digraphs) {
    s = s.split(dg).join(repl);
  }
  const classes: string[] = [];
  for (const ch of s) {
    const cls = ARTICULATORY_CLASS[ch];
    if (cls && classes[classes.length - 1] !== cls) classes.push(cls);
  }
  return classes.join('');
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const curr = [i];
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr.push(Math.min(curr[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost));
    }
    prev = curr;
  }
  return prev[b.length];
}

export function scorePhonologicalContact(
  englishHeadword: string,
  donorForm: string,
  donorAttestedYear?: number | null,
  englishBaselineYear?: number | null
) {
  const skelEn = consonantSkeleton(englishHeadword);
  const skelDo = consonantSkeleton(donorForm);
  const dist = levenshtein(skelEn, skelDo);
  const maxLen = Math.max(skelEn.length, skelDo.length, 1);
  const similarity = Number((1 - dist / maxLen).toFixed(4));
  const chronologyPlausible =
    donorAttestedYear != null && englishBaselineYear != null
      ? donorAttestedYear <= englishBaselineYear
      : true;
  return {
    english_headword: englishHeadword,
    donor_form: donorForm,
    english_skeleton: skelEn,
    donor_skeleton: skelDo,
    skeleton_edit_distance: dist,
    skeleton_similarity: similarity,
    chronology_plausible: chronologyPlausible,
    candidate_viable: chronologyPlausible && similarity >= 0.6,
  };
}

// ============================================================================
// 3. Deterministic Helpers (Auth, Crypto, Validation, GitHub REST API)
// ============================================================================

function nowIso(): string {
  return new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
}

function corsHeaders(): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type, Accept, Mcp-Session-Id, MCP-Protocol-Version',
    'Access-Control-Expose-Headers': 'WWW-Authenticate, Mcp-Session-Id',
    'Access-Control-Max-Age': '86400',
  };
}

function jsonResponse(data: unknown, status = 200, extraHeaders: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      ...corsHeaders(),
      ...extraHeaders,
    },
  });
}

function timingSafeEqualString(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const ua = enc.encode(a);
  const ub = enc.encode(b);
  if (ua.byteLength !== ub.byteLength) return false;
  let diff = 0;
  for (let i = 0; i < ua.byteLength; i++) diff |= ua[i] ^ ub[i];
  return diff === 0;
}

function resolveCanonicalOrigin(url: URL, env: Env): string {
  return (env.SITE_ORIGIN || `${url.protocol}//${url.host}`).replace(/\/+$/, '');
}

function base64UrlEncodeBytes(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlEncodeText(text: string): string {
  return base64UrlEncodeBytes(new TextEncoder().encode(text));
}

function base64UrlDecodeText(b64u: string): string {
  const padLen = (4 - (b64u.length % 4)) % 4;
  const b64 = b64u.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat(padLen);
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

async function importOAuthHmacKey(secret: string): Promise<CryptoKey> {
  const keyData = new TextEncoder().encode(`dragnet-mcp-oauth-v1:${secret}`);
  return crypto.subtle.importKey('raw', keyData, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}

async function signOAuthJwt(payload: Record<string, unknown>, secret: string): Promise<string> {
  const headerB64 = base64UrlEncodeText(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const payloadB64 = base64UrlEncodeText(JSON.stringify(payload));
  const signingInput = `${headerB64}.${payloadB64}`;
  const key = await importOAuthHmacKey(secret);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(signingInput));
  return `${signingInput}.${base64UrlEncodeBytes(new Uint8Array(sig))}`;
}

async function verifyOAuthJwt(token: string, secret: string): Promise<Record<string, any> | null> {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  try {
    const key = await importOAuthHmacKey(secret);
    const signingInput = `${parts[0]}.${parts[1]}`;
    const padLen = (4 - (parts[2].length % 4)) % 4;
    const sigBin = atob(parts[2].replace(/-/g, '+').replace(/_/g, '/') + '='.repeat(padLen));
    const sigBytes = new Uint8Array(sigBin.length);
    for (let i = 0; i < sigBin.length; i++) sigBytes[i] = sigBin.charCodeAt(i);
    const valid = await crypto.subtle.verify('HMAC', key, sigBytes, new TextEncoder().encode(signingInput));
    if (!valid) return null;
    const payload = JSON.parse(base64UrlDecodeText(parts[1])) as Record<string, any>;
    const nowSec = Math.floor(Date.now() / 1000);
    if (typeof payload.exp !== 'number' || payload.exp <= nowSec) return null;
    return payload;
  } catch {
    return null;
  }
}

async function pkceChallengeS256(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return base64UrlEncodeBytes(new Uint8Array(digest));
}

function isAllowedOAuthRedirectUri(rawUri: string): boolean {
  try {
    const u = new URL(rawUri);
    if (u.protocol === 'https:') {
      if (u.hostname === 'chatgpt.com' || u.hostname.endsWith('.chatgpt.com')) return true;
      if (u.hostname === 'openai.com' || u.hostname.endsWith('.openai.com')) return true;
      if (u.hostname === 'claude.ai' || u.hostname === 'claude.com') return true;
    }
    if (u.protocol === 'http:' && (u.hostname === '127.0.0.1' || u.hostname === 'localhost')) {
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function buildWwwAuthenticateHeader(origin: string): string {
  return `Bearer resource_metadata="${origin}/.well-known/oauth-protected-resource", scope="dragnet:read dragnet:write offline_access"`;
}

async function checkBearerAuth(request: Request, env: Env, url?: URL): Promise<Response | null> {
  const configured = (env.DRAGNET_API_KEY || '').trim();
  if (!configured) {
    return jsonResponse(
      { error: 'Server misconfigured: DRAGNET_API_KEY secret is not set on this Worker.' },
      500
    );
  }
  const reqUrl = url || new URL(request.url);
  const origin = resolveCanonicalOrigin(reqUrl, env);

  // 1. Optional capability path `/mcp/<DRAGNET_API_KEY>` for clients using "No authentication"
  if (reqUrl.pathname.startsWith('/mcp/')) {
    const seg = decodeURIComponent(reqUrl.pathname.slice('/mcp/'.length)).replace(/\/+$/, '');
    if (seg && timingSafeEqualString(seg, configured)) {
      return null;
    }
  }

  // 2. Authorization: Bearer <DRAGNET_API_KEY | signed_oauth_access_token>
  const header = request.headers.get('Authorization') || '';
  const m = header.match(/^Bearer\s+(.+)$/i);
  if (m) {
    const token = m[1].trim();
    if (timingSafeEqualString(token, configured)) {
      return null;
    }
    const jwt = await verifyOAuthJwt(token, configured);
    if (jwt && jwt.token_use === 'access' && jwt.iss === origin) {
      return null;
    }
  }

  return jsonResponse({ error: 'Unauthorized: valid Bearer token or OAuth 2.1 authorization required.' }, 401, {
    'WWW-Authenticate': buildWwwAuthenticateHeader(origin),
  });
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const ab = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  const digest = await crypto.subtle.digest('SHA-256', ab);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function decodeBase64Bytes(b64: string): Uint8Array {
  const cleaned = b64.replace(/^data:[^;]+;base64,/, '').replace(/\s+/g, '');
  const bin = atob(cleaned);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function encodeBase64Utf8(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let bin = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}

function isWebpMagic(bytes: Uint8Array): boolean {
  if (bytes.byteLength < 12) return false;
  return (
    bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 && // RIFF
    bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50   // WEBP
  );
}

async function validateCitationForUpsert(
  raw: CitationInput,
  role: 'proposer' | 'redteam' | 'human',
  env: Env
): Promise<{ normalized: CitationInput; scanBytes: number | null; scanSha256: string | null; errors: string[] }> {
  const errors: string[] = [];
  const c: CitationInput = {
    ...raw,
    slug: raw.slug || raw.case_slug,
    record_subtype: raw.record_subtype ?? null,
    verified_by_agent: raw.verified_by_agent ?? null,
    human_verified_by: raw.human_verified_by ?? null,
    human_verified_date: raw.human_verified_date ?? null,
    external_recognition: raw.external_recognition ?? null,
    catalog_year: raw.catalog_year ?? null,
    masthead_year: raw.masthead_year ?? null,
    linguistic_note: raw.linguistic_note ?? '',
    analysis_notes: raw.analysis_notes ?? '',
    // Enforce Proposer != Judge automatically on Pass 1 submissions
    verification_level: role === 'proposer' ? 'discovered' : raw.verification_level,
  };

  if (!c.id || !/^CERT-\d{3,4}-\d{3}[A-Za-z]?$/.test(c.id)) {
    errors.push(`Invalid citation id '${c.id}' (expected CERT-XXXX-YYY).`);
  }
  if (!c.case_slug) errors.push(`${c.id}: Missing case_slug.`);
  if (!c.headword) errors.push(`${c.id}: Missing headword.`);
  if (!c.attested_form) errors.push(`${c.id}: Missing attested_form.`);
  if (!c.sort_date) errors.push(`${c.id}: Missing sort_date (YYYY-MM-DD).`);
  if (!VALID_RECORD_TYPES.has(c.record_type)) {
    errors.push(`${c.id}: Invalid record_type '${c.record_type}'.`);
  }
  if (!VALID_VER_LEVELS.has(c.verification_level)) {
    errors.push(`${c.id}: Invalid verification_level '${c.verification_level}'.`);
  }
  if (c.verification_level === 'human_verified' && (!c.human_verified_by || !c.human_verified_date)) {
    errors.push(`${c.id}: human_verified requires human_verified_by and human_verified_date.`);
  }
  if (c.verification_level === 'externally_recognized' && !c.external_recognition) {
    errors.push(`${c.id}: externally_recognized requires external_recognition.`);
  }
  if (
    (c.record_type === 'attestation' || c.record_type === 'hypothesis') &&
    !String(c.source_url || '').startsWith('https://')
  ) {
    errors.push(`${c.id}: ${c.record_type} requires an https:// source_url.`);
  }
  if (c.record_type === 'attestation' && c.verification_level !== 'discovered') {
    if (!c.masthead_date_verified) {
      errors.push(`${c.id}: Promoted attestation requires masthead_date_verified=true (Trap A gate).`);
    }
    if ((c.verbatim_quote || '').trim().length < 40) {
      errors.push(`${c.id}: Promoted attestation requires verbatim_quote >= 40 characters.`);
    }
  }

  const serialized = JSON.stringify(c);
  const leak = serialized.match(WORKSPACE_LEAK_RE);
  if (leak) {
    errors.push(`${c.id}: Disallowed workspace/Zenodo reference '${leak[0]}' inside citation JSON.`);
  }

  let scanBytes: number | null = null;
  let scanSha256: string | null = null;
  const hosted = c.scan?.hosted_path ?? null;

  if (hosted) {
    if (!hosted.startsWith(`/scans/${c.case_slug}/`) || !hosted.endsWith('.webp')) {
      errors.push(`${c.id}: scan.hosted_path must match '/scans/${c.case_slug}/${c.id}.webp'.`);
    }
    if (typeof c.publication_year === 'number' && c.publication_year > 1930 && c.scan?.rights_cleared !== true) {
      errors.push(
        `${c.id}: Post-1930 work (${c.publication_year}) cannot set scan.hosted_path unless rights_cleared=true.`
      );
    }
    const r2Key = hosted.replace(/^\/+/, '');
    const head = await env.SCANS.head(r2Key);
    if (!head) {
      errors.push(`${c.id}: Scan '${hosted}' not found in R2 bucket; upload via upload_proof_scan first.`);
    } else {
      if (head.size > MAX_IMAGE_BYTES) {
        errors.push(`${c.id}: Scan '${hosted}' exceeds 5 MB (${head.size} bytes).`);
      }
      scanBytes = head.size;
      scanSha256 = head.customMetadata?.sha256 ?? null;
    }
  } else {
    c.scan = c.scan ?? {
      hosted_path: null,
      rights_status:
        typeof c.publication_year === 'number' && c.publication_year > 1930
          ? 'external_link_post_1930'
          : 'no_scan_attached',
      rights_note: 'Linked externally via source_url.',
    };
  }

  return { normalized: c, scanBytes, scanSha256, errors };
}

function validateCaseMarkdown(rawMd: string, expectedSlug: string, knownCertIds: Set<string>): string[] {
  const errors: string[] = [];
  if (!rawMd.startsWith('---')) {
    errors.push('Case Markdown must start with YAML frontmatter (---).');
    return errors;
  }
  const endIdx = rawMd.indexOf('\n---', 3);
  if (endIdx === -1) {
    errors.push('Unclosed YAML frontmatter block in Case Markdown.');
    return errors;
  }
  const fm = rawMd.slice(4, endIdx);
  const slugMatch = fm.match(/^ledgerSlug:\s*['"]?([^'"\n]+)['"]?$/m);
  if (!slugMatch || slugMatch[1].trim() !== expectedSlug) {
    errors.push(`Frontmatter ledgerSlug must equal '${expectedSlug}'.`);
  }
  const authorMatch = fm.match(/^authorCitation:\s*['"]?([^'"\n]+)['"]?$/m);
  if (!authorMatch || !authorMatch[1].includes(',')) {
    errors.push("Frontmatter authorCitation must use 'Last, First' format (e.g. 'Callahan, Joshua').");
  }
  const leak = rawMd.match(WORKSPACE_LEAK_RE);
  if (leak) errors.push(`Disallowed workspace/Zenodo token '${leak[0]}' in Case Markdown.`);
  if (RAW_SCORE_RE.test(rawMd)) {
    errors.push('Case Markdown contains raw 4-decimal harness score; strip uncalibrated string scores.');
  }
  const decYr = rawMd.match(DECIMAL_YEAR_RE);
  if (decYr) {
    errors.push(`Case Markdown uses decimal years ('${decYr[0]}'); use natural years, months, and days.`);
  }
  const refs = new Set(rawMd.match(CERT_ID_RE) || []);
  for (const ref of refs) {
    if (!knownCertIds.has(ref)) {
      errors.push(`Case Markdown references '${ref}' which does not exist in D1 citations for '${expectedSlug}'.`);
    }
  }
  return errors;
}

// ============================================================================
// 4. Core Business Operations (Shared by BOTH /mcp and /api/v1/*)
// ============================================================================

async function opGetPipelineStatus(env: Env, queueLimit = 10) {
  const countsRes = await env.DB.prepare(
    'SELECT status, COUNT(*) as count FROM targets GROUP BY status'
  ).all<{ status: string; count: number }>();
  const metaRow = await env.DB.prepare(
    "SELECT value FROM pipeline_meta WHERE key = 'next_open_block'"
  ).first<{ value: string }>();
  const activeRun = await env.DB.prepare(
    `SELECT run_id, block_number, target_id, slug, headword, status, proposer_agent, redteam_agent, pr_url, started_at, updated_at
     FROM runs
     WHERE status IN ('CLAIMING_DISCOVERY', 'AWAITING_AUDIT', 'AUDITING_REDTEAM')
     ORDER BY updated_at DESC LIMIT 1`
  ).first();
  const nextQueued = await env.DB.prepare(
    `SELECT queue_rank, priority_band, target_id, headword, slug, category, etymology_status, baseline_year
     FROM targets
     WHERE status = 'QUEUED'
     ORDER BY queue_rank ASC LIMIT ?`
  )
    .bind(Math.min(Math.max(queueLimit, 1), 50))
    .all();

  const statusCounts: Record<string, number> = {};
  let totalTargets = 0;
  for (const r of countsRes.results) {
    statusCounts[r.status] = r.count;
    totalTargets += Number(r.count || 0);
  }

  return {
    total_targets: totalTargets,
    next_open_block: Number(metaRow?.value || 3000),
    status_counts: statusCounts,
    active_run: activeRun ?? null,
    up_next_queue: nextQueued.results,
  };
}

async function opGetTargetBrief(env: Env, slugOrId: string) {
  const clean = slugOrId.trim();
  const target = await env.DB.prepare(
    `SELECT * FROM targets WHERE target_id = ? OR slug = ? LIMIT 1`
  )
    .bind(clean.toUpperCase(), clean.toLowerCase())
    .first<Record<string, unknown>>();
  if (!target) throw new Error(`Target '${slugOrId}' not found in D1 targets table.`);

  const headword = String(target.headword);
  const baselineYear = Number(target.baseline_year);
  const existingCites = await env.DB.prepare(
    `SELECT id, attested_form, record_type, verification_level, publication_year, sort_date, json_extract(record_json, '$.short_gloss') AS short_gloss, json_extract(record_json, '$.source_publication') AS source_publication, source_url
     FROM citations WHERE target_id = ? ORDER BY sort_date ASC, id ASC`
  )
    .bind(target.target_id)
    .all();
  const latestRun = await env.DB.prepare(
    `SELECT run_id, block_number, status, dossier_markdown, audit_report_markdown, notes, pr_url, updated_at
     FROM runs WHERE target_id = ? ORDER BY block_number DESC LIMIT 1`
  )
    .bind(target.target_id)
    .first();

  const baselineSummary = String(target.baseline_summary || '');
  const priorAuditContext = String(target.prior_audit_context || '');
  const milestones = extractSenseMilestoneYears(baselineYear, baselineSummary);
  const preBaselineEndYear = Math.max(1650, milestones.earliest_baseline_year - 1);
  const hasSecondarySenseWindow = milestones.latest_sense_baseline_year > milestones.earliest_baseline_year;

  const chronAmUrl =
    `https://www.loc.gov/collections/chronicling-america/?ops=~&qs=${encodeURIComponent(headword)}` +
    `&dates=1770/${preBaselineEndYear}&fo=json&c=25`;
  const iaQuery = `("${headword}") AND mediatype:(texts) AND date:[1650-01-01 TO ${preBaselineEndYear}-12-31]`;

  const secondarySenseWindow = hasSecondarySenseWindow
    ? {
        window_years: `${milestones.earliest_baseline_year}..${milestones.latest_sense_baseline_year}`,
        note: 'Covers sense/part-of-speech milestones after earliest_baseline_year (e.g. nominal vs. adjectival or figurative shifts noted in baseline_summary).',
        chronicling_america_sense_window_url:
          `https://www.loc.gov/collections/chronicling-america/?ops=~&qs=${encodeURIComponent(headword)}` +
          `&dates=${milestones.earliest_baseline_year}/${milestones.latest_sense_baseline_year}&fo=json&c=25`,
        internet_archive_sense_window_query:
          `("${headword}") AND mediatype:(texts) AND date:[${milestones.earliest_baseline_year}-01-01 TO ${milestones.latest_sense_baseline_year}-12-31]`,
      }
    : null;

  return {
    target,
    baseline_windows: {
      earliest_baseline_year: milestones.earliest_baseline_year,
      latest_sense_baseline_year: milestones.latest_sense_baseline_year,
      sense_milestone_years: milestones.sense_milestone_years,
      pre_baseline_cutoff_year: preBaselineEndYear,
      secondary_sense_window: secondarySenseWindow,
    },
    phonetics_and_ocr: {
      consonant_skeleton: consonantSkeleton(headword),
      dirty_ocr_regex: compileDirtyOcrRegexPattern(headword),
      phonetic_orthographic_regex: compileOrthographicVariantRegex(headword),
      ocr_variants: generateOcrVariants(headword, 40),
      phonetic_variants: generatePhoneticVariants(headword, 40),
      chronicling_america_pre_cutoff_url: chronAmUrl,
      internet_archive_pre_cutoff_query: iaQuery,
      secondary_sense_queries: secondarySenseWindow,
    },
    prior_art_gate: {
      has_prior_audit_context: priorAuditContext.trim().length > 0,
      prior_audit_context: priorAuditContext || null,
      mandatory_step_0_checklist: [
        'Audit OED Online, Green\'s Dictionary of Slang, Lighter (HDAS), DARE, and Etymonline for sense-by-sense and POS-by-POS baseline dates before claiming any antedating.',
        'Search ADS-L archives, Wordorigins.org (Dave Wilton), Language Log, World Wide Words (Michael Quinion), Barry Popik, and Comments on Etymology (Gerald Cohen) to credit prior independent discoveries.',
        'Cross-check target.prior_audit_context and existing_citations so previously killed OCR/masthead mirages (Traps A-D) are not resurrected.',
      ],
    },
    existing_citations: existingCites.results,
    latest_run: latestRun ?? null,
    operating_constitution: DRAGNET_CONSTITUTION,
  };
}

async function opClaimNextTarget(
  env: Env,
  opts: { target_id?: string; agent_name?: string; force?: boolean }
) {
  const active = await env.DB.prepare(
    `SELECT run_id, block_number, target_id, headword, status, updated_at
     FROM runs
     WHERE status IN ('CLAIMING_DISCOVERY', 'AWAITING_AUDIT', 'AUDITING_REDTEAM')
     ORDER BY updated_at DESC LIMIT 1`
  ).first<Record<string, unknown>>();

  if (active && !opts.force) {
    const ageHours = (Date.now() - Date.parse(String(active.updated_at))) / 3_600_000;
    if (active.status === 'AWAITING_AUDIT' || active.status === 'AUDITING_REDTEAM' || ageHours < 18) {
      throw new Error(
        `Active run '${active.run_id}' (${active.headword}) is currently '${active.status}'. ` +
          `Complete Pass 2 Red-Team audit first or pass force=true to override.`
      );
    }
    // Stale CLAIMING_DISCOVERY lock (>18h old): auto-reset to QUEUED
    await env.DB.batch([
      env.DB.prepare(`UPDATE runs SET status = 'ABORTED_OR_STALLED', updated_at = ? WHERE run_id = ?`).bind(
        nowIso(),
        active.run_id
      ),
      env.DB.prepare(`UPDATE targets SET status = 'QUEUED', updated_at = ? WHERE target_id = ?`).bind(
        nowIso(),
        active.target_id
      ),
    ]);
  }

  const target = opts.target_id
    ? await env.DB.prepare(`SELECT * FROM targets WHERE target_id = ? LIMIT 1`)
        .bind(opts.target_id.toUpperCase())
        .first<Record<string, unknown>>()
    : await env.DB.prepare(`SELECT * FROM targets WHERE status = 'QUEUED' ORDER BY queue_rank ASC LIMIT 1`).first<
        Record<string, unknown>
      >();

  if (!target) throw new Error('No eligible QUEUED target found.');
  if (['LIVE_ON_DRAGNET', 'STAGE_B_PACK_READY', 'EMBARGOED_UNDER_REVIEW'].includes(String(target.status)) && !opts.force) {
    throw new Error(`Target ${target.target_id} (${target.headword}) has status '${target.status}' and cannot be claimed.`);
  }

  const meta = await env.DB.prepare("SELECT value FROM pipeline_meta WHERE key = 'next_open_block'").first<{
    value: string;
  }>();
  const blockNumber = Number(meta?.value || 3000);
  const nextBlock = blockNumber + 100;
  const slug = String(target.slug);
  const runId = `RUN-${blockNumber}-${slug}`;
  const ts = nowIso();

  await env.DB.batch([
    env.DB.prepare("UPDATE pipeline_meta SET value = ?, updated_at = ? WHERE key = 'next_open_block'").bind(
      String(nextBlock),
      ts
    ),
    env.DB.prepare(
      `UPDATE targets SET status = 'CLAIMING_DISCOVERY', assigned_block = ?, updated_at = ? WHERE target_id = ?`
    ).bind(blockNumber, ts, target.target_id),
    env.DB.prepare(
      `INSERT INTO runs (run_id, block_number, target_id, slug, headword, status, proposer_agent, started_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'CLAIMING_DISCOVERY', ?, ?, ?)`
    ).bind(runId, blockNumber, target.target_id, slug, target.headword, opts.agent_name || 'mcp-proposer', ts, ts),
  ]);

  const brief = await opGetTargetBrief(env, String(target.target_id));
  return {
    claimed_run: {
      run_id: runId,
      block_number: blockNumber,
      certificate_id_prefix: `CERT-${blockNumber}-`,
      target_id: target.target_id,
      headword: target.headword,
      slug,
      status: 'CLAIMING_DISCOVERY',
    },
    brief,
  };
}

async function opUploadProofScan(
  env: Env,
  params: {
    case_slug: string;
    cert_id: string;
    publication_year: number;
    rights_cleared?: boolean;
    image_base64?: string;
    fetch_from_url?: string;
  }
) {
  if (!/^CERT-\d{3,4}-\d{3}[A-Za-z]?$/.test(params.cert_id)) {
    throw new Error(`Invalid cert_id '${params.cert_id}' (expected CERT-XXXX-YYY).`);
  }
  if (!/^[a-z0-9-]+$/.test(params.case_slug)) {
    throw new Error(`Invalid case_slug '${params.case_slug}'.`);
  }
  if (params.publication_year > 1930 && params.rights_cleared !== true) {
    throw new Error(
      `Pre-1931 Scan Rights Gate: publication_year ${params.publication_year} > 1930 may not be hosted without rights_cleared=true.`
    );
  }

  let bytes: Uint8Array;
  if (params.image_base64) {
    bytes = decodeBase64Bytes(params.image_base64);
  } else if (params.fetch_from_url) {
    if (!params.fetch_from_url.startsWith('https://')) {
      throw new Error('fetch_from_url must use https://.');
    }
    const resp = await fetch(params.fetch_from_url, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (compatible; Google-Agent; +https://developers.google.com/crawling/docs/crawlers-fetchers/google-agent)',
      },
    });
    if (!resp.ok) throw new Error(`Failed to fetch image from URL (HTTP ${resp.status}).`);
    bytes = new Uint8Array(await resp.arrayBuffer());
  } else {
    throw new Error('Provide either image_base64 (WebP bytes) or fetch_from_url.');
  }

  if (!isWebpMagic(bytes)) {
    throw new Error(
      'Uploaded scan must be encoded in WebP format (RIFF....WEBP header). Convert PNG/JPEG crops to WebP before uploading.'
    );
  }
  if (bytes.byteLength > MAX_IMAGE_BYTES) {
    throw new Error(`WebP scan exceeds 5 MB limit (${bytes.byteLength} bytes).`);
  }

  const digest = await sha256Hex(bytes);
  const r2Key = `scans/${params.case_slug}/${params.cert_id}.webp`;
  await env.SCANS.put(r2Key, bytes, {
    httpMetadata: {
      contentType: 'image/webp',
      cacheControl: 'public, max-age=31536000, immutable',
    },
    customMetadata: {
      sha256: digest,
      publication_year: String(params.publication_year),
      cert_id: params.cert_id,
    },
  });

  const hostedPath = `/${r2Key}`;
  return {
    hosted_path: hostedPath,
    r2_key: r2Key,
    bytes: bytes.byteLength,
    sha256: digest,
    scan_object: {
      hosted_path: hostedPath,
      rights_status: params.publication_year <= 1930 ? 'us_public_domain_pre_1931' : 'rights_cleared',
      rights_note:
        params.publication_year <= 1930
          ? `Published ${params.publication_year} (on or before Dec. 31, 1930); in the United States public domain. WebP proof scan hosted in R2.`
          : `Rights explicitly cleared for ${params.publication_year} scan.`,
    },
  };
}

async function opUpsertCitations(
  env: Env,
  params: {
    target_id: string;
    run_id?: string;
    role: 'proposer' | 'redteam' | 'human';
    citations: CitationInput[];
  }
) {
  if (!Array.isArray(params.citations) || params.citations.length === 0) {
    throw new Error('citations array must contain at least one CitationRecord.');
  }
  const target = await env.DB.prepare('SELECT target_id, slug FROM targets WHERE target_id = ? LIMIT 1')
    .bind(params.target_id.toUpperCase())
    .first<{ target_id: string; slug: string }>();
  if (!target) throw new Error(`Unknown target_id '${params.target_id}'.`);

  const allErrors: string[] = [];
  const stmts: D1PreparedStatement[] = [];
  const ts = nowIso();

  for (const raw of params.citations) {
    const { normalized, scanBytes, scanSha256, errors } = await validateCitationForUpsert(raw, params.role, env);
    if (errors.length) {
      allErrors.push(...errors);
      continue;
    }
    stmts.push(
      env.DB.prepare(
        `INSERT INTO citations (
          id, target_id, case_slug, run_id, headword, attested_form,
          record_type, record_subtype, verification_level, publication_year,
          sort_date, source_url, masthead_date_verified, scan_hosted_path,
          scan_bytes, scan_sha256, record_json, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          run_id = excluded.run_id,
          attested_form = excluded.attested_form,
          record_type = excluded.record_type,
          record_subtype = excluded.record_subtype,
          verification_level = excluded.verification_level,
          publication_year = excluded.publication_year,
          sort_date = excluded.sort_date,
          source_url = excluded.source_url,
          masthead_date_verified = excluded.masthead_date_verified,
          scan_hosted_path = excluded.scan_hosted_path,
          scan_bytes = COALESCE(excluded.scan_bytes, citations.scan_bytes),
          scan_sha256 = COALESCE(excluded.scan_sha256, citations.scan_sha256),
          record_json = excluded.record_json,
          updated_at = excluded.updated_at`
      ).bind(
        normalized.id,
        target.target_id,
        normalized.case_slug,
        params.run_id ?? null,
        normalized.headword,
        normalized.attested_form,
        normalized.record_type,
        normalized.record_subtype ?? null,
        normalized.verification_level,
        normalized.publication_year,
        normalized.sort_date,
        normalized.source_url,
        normalized.masthead_date_verified ? 1 : 0,
        normalized.scan?.hosted_path ?? null,
        scanBytes,
        scanSha256,
        JSON.stringify(normalized),
        ts
      )
    );
  }

  if (allErrors.length > 0) {
    throw new Error(`Citation validation failed (${allErrors.length} error(s)):\n- ${allErrors.join('\n- ')}`);
  }

  await env.DB.batch(stmts);
  return {
    upserted_count: stmts.length,
    target_id: target.target_id,
    enforced_role: params.role,
  };
}

async function opSaveRunArtifactsAndAdvance(
  env: Env,
  params: {
    run_id: string;
    next_status:
      | 'CLAIMING_DISCOVERY'
      | 'AWAITING_AUDIT'
      | 'AUDITING_REDTEAM'
      | 'STAGE_B_PACK_READY'
      | 'NEEDS_PHASE_2';
    agent_name?: string;
    dossier_markdown?: string;
    monograph_markdown?: string;
    audit_report_markdown?: string;
    case_markdown?: string;
    oed_slips_markdown?: string;
    claims_json?: Record<string, unknown> | string;
    prior_art_baselines?: Record<string, unknown>;
    corpus_search_summary?: Record<string, unknown>;
    best_verified_year?: number;
    notes?: string;
  }
) {
  const run = await env.DB.prepare('SELECT * FROM runs WHERE run_id = ? LIMIT 1')
    .bind(params.run_id)
    .first<Record<string, unknown>>();
  if (!run) throw new Error(`Run '${params.run_id}' not found.`);

  const slug = String(run.slug);
  const targetId = String(run.target_id);

  if (params.case_markdown || params.next_status === 'STAGE_B_PACK_READY') {
    const md = params.case_markdown || String(run.case_markdown || '');
    if (!md) {
      throw new Error('Advancing to STAGE_B_PACK_READY requires case_markdown (src/content/cases/{slug}.md).');
    }
    const citeRows = await env.DB.prepare('SELECT id FROM citations WHERE case_slug = ?')
      .bind(slug)
      .all<{ id: string }>();
    const knownIds = new Set(citeRows.results.map((r) => r.id));
    if (knownIds.size === 0) {
      throw new Error(`Cannot mark STAGE_B_PACK_READY: zero citations stored for case_slug '${slug}'.`);
    }
    const mdErrs = validateCaseMarkdown(md, slug, knownIds);
    if (mdErrs.length > 0) {
      throw new Error(`Case Markdown failed DRAgNEt v3 lint:\n- ${mdErrs.join('\n- ')}`);
    }
  }

  const ts = nowIso();
  await env.DB.batch([
    env.DB.prepare(
      `UPDATE runs SET
        status = ?,
        redteam_agent = COALESCE(?, redteam_agent),
        dossier_markdown = COALESCE(?, dossier_markdown),
        monograph_markdown = COALESCE(?, monograph_markdown),
        audit_report_markdown = COALESCE(?, audit_report_markdown),
        case_markdown = COALESCE(?, case_markdown),
        oed_slips_markdown = COALESCE(?, oed_slips_markdown),
        claims_json = COALESCE(?, claims_json),
        prior_art_baselines_json = COALESCE(?, prior_art_baselines_json),
        corpus_search_summary_json = COALESCE(?, corpus_search_summary_json),
        notes = COALESCE(?, notes),
        updated_at = ?
      WHERE run_id = ?`
    ).bind(
      params.next_status,
      params.next_status === 'AUDITING_REDTEAM' || params.next_status === 'STAGE_B_PACK_READY'
        ? params.agent_name ?? null
        : null,
      params.dossier_markdown ?? null,
      params.monograph_markdown ?? null,
      params.audit_report_markdown ?? null,
      params.case_markdown ?? null,
      params.oed_slips_markdown ?? null,
      params.claims_json ? (typeof params.claims_json === 'string' ? params.claims_json : JSON.stringify(params.claims_json, null, 2)) : null,
      params.prior_art_baselines ? JSON.stringify(params.prior_art_baselines) : null,
      params.corpus_search_summary ? JSON.stringify(params.corpus_search_summary) : null,
      params.notes ?? null,
      ts,
      params.run_id
    ),
    env.DB.prepare(
      `UPDATE targets SET
        status = ?,
        best_verified_year = COALESCE(?, best_verified_year),
        years_antedated = CASE
          WHEN ? IS NOT NULL AND baseline_year > ? THEN baseline_year - ?
          ELSE years_antedated
        END,
        updated_at = ?
      WHERE target_id = ?`
    ).bind(
      params.next_status,
      params.best_verified_year ?? null,
      params.best_verified_year ?? null,
      params.best_verified_year ?? null,
      params.best_verified_year ?? null,
      ts,
      targetId
    ),
  ]);

  return {
    run_id: params.run_id,
    target_id: targetId,
    slug,
    status: params.next_status,
    updated_at: ts,
  };
}

async function githubApi(env: Env, endpoint: string, init: RequestInit = {}) {
  const token = (env.GITHUB_PAT || '').trim();
  if (!token) throw new Error('GITHUB_PAT secret is not configured on this Worker.');
  const repo = env.GITHUB_REPO || 'radbot44/dragnet-etymology';
  const url = `https://api.github.com/repos/${repo}${endpoint}`;
  const resp = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'DRAgNEt-Cloudflare-Worker/3.4',
      ...(init.headers || {}),
    },
  });
  const text = await resp.text();
  const data = text ? JSON.parse(text) : {};
  if (!resp.ok) {
    throw new Error(`GitHub API ${endpoint} failed (HTTP ${resp.status}): ${data.message || text}`);
  }
  return data;
}

async function opOpenCasePullRequest(env: Env, params: { run_id: string; pr_title?: string; draft?: boolean }) {
  const run = await env.DB.prepare('SELECT * FROM runs WHERE run_id = ? LIMIT 1')
    .bind(params.run_id)
    .first<Record<string, unknown>>();
  if (!run) throw new Error(`Run '${params.run_id}' not found.`);

  const target = await env.DB.prepare('SELECT * FROM targets WHERE target_id = ? LIMIT 1')
    .bind(run.target_id)
    .first<Record<string, unknown>>();
  if (!target) throw new Error(`Target '${run.target_id}' not found.`);
  if (target.status === 'EMBARGOED_UNDER_REVIEW') {
    throw new Error(`Target ${target.target_id} (${target.headword}) is EMBARGOED_UNDER_REVIEW; refusing public PR.`);
  }

  const slug = String(run.slug);
  const blockNum = Number(run.block_number);
  const caseMd = String(run.case_markdown || '');
  if (!caseMd) throw new Error(`Run '${params.run_id}' has no case_markdown; call save_run_artifacts_and_advance first.`);

  const citeRows = await env.DB.prepare(
    `SELECT id, scan_hosted_path, scan_bytes, scan_sha256, record_json
     FROM citations WHERE case_slug = ? ORDER BY sort_date ASC, id ASC`
  )
    .bind(slug)
    .all<{
      id: string;
      scan_hosted_path: string | null;
      scan_bytes: number | null;
      scan_sha256: string | null;
      record_json: string;
    }>();

  if (citeRows.results.length === 0) {
    throw new Error(`No citations found in D1 for case_slug '${slug}'.`);
  }

  const knownIds = new Set(citeRows.results.map((r) => r.id));
  const lintErrors = validateCaseMarkdown(caseMd, slug, knownIds);
  if (lintErrors.length > 0) {
    throw new Error(`Pre-PR validation failed:\n- ${lintErrors.join('\n- ')}`);
  }

  const ledgerPayload = {
    schema_version: '3.0',
    ledger_id: slug,
    case_number: `Case ${blockNum}`,
    target_id: String(run.target_id),
    headword: String(run.headword),
    publication_status: 'working_paper',
    publication_status_note:
      'Open working paper; primary-source citations and composite proof scans verified through DRAgNEt two-pass Proposer and Red-Team audit.',
    updated_at: nowIso().slice(0, 10),
    prior_art_baselines: JSON.parse(String(run.prior_art_baselines_json || '{}')),
    corpus_search_summary: JSON.parse(String(run.corpus_search_summary_json || '{}')),
    citations: citeRows.results.map((r) => JSON.parse(r.record_json)),
  };

  const baseBranch = env.GITHUB_BASE_BRANCH || 'main';
  const baseRef = await githubApi(env, `/git/ref/heads/${baseBranch}`);
  const baseCommitSha: string = baseRef.object.sha;
  const baseCommit = await githubApi(env, `/git/commits/${baseCommitSha}`);
  const baseTreeSha: string = baseCommit.tree.sha;

  // Fetch current open-questions.json & r2-scan-manifest.json from base branch to merge cleanly
  async function readRepoJson(filePath: string, fallback: unknown) {
    try {
      const f = await githubApi(env, `/contents/${filePath}?ref=${baseBranch}`);
      const bytes = decodeBase64Bytes(String(f.content || ''));
      return JSON.parse(new TextDecoder().decode(bytes));
    } catch {
      return fallback;
    }
  }

  const openQuestions = await readRepoJson('public/data/open-questions.json', {
    schema_version: '3.0',
    updated_at: nowIso().slice(0, 10),
    total_targets: 160,
    targets: [],
  });
  if (Array.isArray(openQuestions.targets)) {
    openQuestions.updated_at = nowIso().slice(0, 10);
    for (const t of openQuestions.targets) {
      if (t.target_id === run.target_id) {
        t.status = 'published_case';
        t.case_slug = slug;
      }
    }
  }

  const r2Manifest: Record<string, { bytes: number; sha256: string | null }> = await readRepoJson(
    'public/data/r2-scan-manifest.json',
    {}
  );
  for (const row of citeRows.results) {
    if (row.scan_hosted_path && row.scan_bytes) {
      r2Manifest[row.scan_hosted_path] = {
        bytes: row.scan_bytes,
        sha256: row.scan_sha256 ?? null,
      };
    }
  }

  const filesToCommit: Array<{ path: string; content: string }> = [
    { path: `public/ledgers/${slug}.json`, content: `${JSON.stringify(ledgerPayload, null, 2)}\n` },
    { path: `src/content/cases/${slug}.md`, content: caseMd.endsWith('\n') ? caseMd : `${caseMd}\n` },
    { path: 'public/data/open-questions.json', content: `${JSON.stringify(openQuestions, null, 2)}\n` },
    { path: 'public/data/r2-scan-manifest.json', content: `${JSON.stringify(r2Manifest, null, 2)}\n` },
  ];

  if (run.monograph_markdown) {
    filesToCommit.push({
      path: `docs/monographs/${blockNum}_${slug}_monograph.md`,
      content: String(run.monograph_markdown),
    });
  }
  if (run.audit_report_markdown) {
    filesToCommit.push({
      path: `docs/audits/${blockNum}_${slug}_redteam_audit.md`,
      content: String(run.audit_report_markdown),
    });
  }
  if (run.oed_slips_markdown) {
    filesToCommit.push({
      path: `docs/oed-slips/${slug}.md`,
      content: String(run.oed_slips_markdown),
    });
  }
  if (run.claims_json) {
    const rawClaims = String(run.claims_json);
    filesToCommit.push({
      path: `public/claims/${slug}.json`,
      content: rawClaims.endsWith('\n') ? rawClaims : `${rawClaims}\n`,
    });
  }

  const treeEntries = [];
  for (const f of filesToCommit) {
    const blob = await githubApi(env, '/git/blobs', {
      method: 'POST',
      body: JSON.stringify({ content: encodeBase64Utf8(f.content), encoding: 'base64' }),
    });
    treeEntries.push({
      path: f.path,
      mode: '100644',
      type: 'blob',
      sha: blob.sha,
    });
  }

  const newTree = await githubApi(env, '/git/trees', {
    method: 'POST',
    body: JSON.stringify({ base_tree: baseTreeSha, tree: treeEntries }),
  });

  const commitTitle =
    params.pr_title || `Case ${blockNum} (${run.target_id}): Add ${run.headword} Case File & v3 ledger`;
  const newCommit = await githubApi(env, '/git/commits', {
    method: 'POST',
    body: JSON.stringify({
      message: commitTitle,
      tree: newTree.sha,
      parents: [baseCommitSha],
    }),
  });

  const branchName = `case/${blockNum}-${slug}`;
  try {
    await githubApi(env, '/git/refs', {
      method: 'POST',
      body: JSON.stringify({ ref: `refs/heads/${branchName}`, sha: newCommit.sha }),
    });
  } catch {
    await githubApi(env, `/git/refs/heads/${branchName}`, {
      method: 'PATCH',
      body: JSON.stringify({ sha: newCommit.sha, force: true }),
    });
  }

  const prBody = [
    `## Case ${blockNum}: \`${run.headword}\` (\`${run.target_id}\`)`,
    '',
    `- **Evaluated citations in v3 ledger**: ${citeRows.results.length}`,
    `- **R2-hosted pre-1931 WebP proof scans**: ${citeRows.results.filter((r) => r.scan_hosted_path).length}`,
    `- **Run ID**: \`${params.run_id}\``,
    '',
    'Automated CI (`validate-site.mjs`) will verify schema v3 integrity, bidirectional `CERT-...` references, pre-1931 scan rights, and R2 manifest hashes before merge.',
  ].join('\n');

  const pr = await githubApi(env, '/pulls', {
    method: 'POST',
    body: JSON.stringify({
      title: commitTitle,
      head: branchName,
      base: baseBranch,
      body: prBody,
      draft: params.draft ?? true,
    }),
  });

  const ts = nowIso();
  await env.DB.batch([
    env.DB.prepare(`UPDATE runs SET status = 'PR_OPENED', pr_url = ?, pr_number = ?, updated_at = ? WHERE run_id = ?`).bind(
      pr.html_url,
      pr.number,
      ts,
      params.run_id
    ),
    env.DB.prepare(`UPDATE targets SET status = 'PR_OPENED', latest_pr_url = ?, updated_at = ? WHERE target_id = ?`).bind(
      pr.html_url,
      ts,
      run.target_id
    ),
  ]);

  return {
    pr_url: pr.html_url,
    pr_number: pr.number,
    branch: branchName,
    committed_files: filesToCommit.map((f) => f.path),
  };
}

async function opSearchCorpus(
  env: Env,
  params: { query?: string; case_slug?: string; record_type?: string; verification_level?: string; limit?: number }
) {
  const clauses: string[] = ['1 = 1'];
  const binds: unknown[] = [];
  if (params.case_slug) {
    clauses.push('case_slug = ?');
    binds.push(params.case_slug.toLowerCase());
  }
  if (params.record_type) {
    clauses.push('record_type = ?');
    binds.push(params.record_type);
  }
  if (params.verification_level) {
    clauses.push('verification_level = ?');
    binds.push(params.verification_level);
  }
  if (params.query) {
    clauses.push('(headword LIKE ? OR attested_form LIKE ? OR record_json LIKE ?)');
    const pat = `%${params.query}%`;
    binds.push(pat, pat, pat);
  }
  const limit = Math.min(Math.max(Number(params.limit || 25), 1), 100);
  binds.push(limit);

  const sql = `SELECT id, target_id, case_slug, headword, attested_form, record_type, verification_level, publication_year, sort_date, source_url, scan_hosted_path
               FROM citations WHERE ${clauses.join(' AND ')} ORDER BY sort_date ASC, id ASC LIMIT ?`;
  const res = await env.DB.prepare(sql).bind(...binds).all();
  return { count: res.results.length, results: res.results };
}

// ============================================================================
// 5. MCP Tool Definitions & Stateless JSON-RPC 2.0 Handler (/mcp)
// ============================================================================

const READ_ONLY_ANNOTATIONS = { readOnlyHint: true, destructiveHint: false, openWorldHint: false };
const WRITE_ANNOTATIONS = { readOnlyHint: false, destructiveHint: false, openWorldHint: true };
const READ_SECURITY_META = { securitySchemes: [{ type: 'oauth2', scopes: ['dragnet:read'] }] };
const WRITE_SECURITY_META = { securitySchemes: [{ type: 'oauth2', scopes: ['dragnet:write'] }] };

const MCP_TOOLS = [
  {
    name: 'get_profile',
    description:
      "Return the authenticated DRAgNEt coordinator profile represented by this connection's credentials.",
    inputSchema: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
    outputSchema: {
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      type: 'object',
      properties: {
        id: { type: 'string', minLength: 1, pattern: '\\S' },
        name: { type: 'string' },
        nickname: { type: 'string' },
      },
      required: ['id'],
      additionalProperties: false,
    },
    annotations: READ_ONLY_ANNOTATIONS,
    securitySchemes: [{ type: 'oauth2', scopes: ['dragnet:read'] }],
    _meta: { 'openai/profile': true, ...READ_SECURITY_META },
  },
  {
    name: 'get_pipeline_status',
    annotations: READ_ONLY_ANNOTATIONS,
    _meta: READ_SECURITY_META,
    description:
      'Return total_targets, DRAgNEt queue counts across all tracked targets, any active Proposer/Red-Team run lock, next_open_block, and top queued headwords.',
    inputSchema: {
      type: 'object',
      properties: {
        queue_limit: { type: 'integer', description: 'Number of upcoming queued targets to list (default 10).' },
      },
    },
  },
  {
    name: 'get_target_brief',
    annotations: READ_ONLY_ANNOTATIONS,
    _meta: READ_SECURITY_META,
    description:
      'Fetch complete target brief, consonant skeleton, dirty-OCR regex, pre-cutoff Chronicling America & Internet Archive search queries, existing citations/dead ends, and DRAgNEt Trap A-D rules.',
    inputSchema: {
      type: 'object',
      required: ['slug_or_id'],
      properties: {
        slug_or_id: { type: 'string', description: "Target ID (e.g. 'TGT-029') or slug (e.g. 'doozy')." },
      },
    },
  },
  {
    name: 'claim_next_target',
    annotations: WRITE_ANNOTATIONS,
    _meta: WRITE_SECURITY_META,
    description:
      'Atomically claim the next QUEUED target (or specified target_id) for Pass 1 Proposer discovery, allocate its 100-slot block number, and return its full brief.',
    inputSchema: {
      type: 'object',
      properties: {
        target_id: { type: 'string', description: 'Optional specific target_id to claim instead of queue head.' },
        agent_name: { type: 'string', description: 'Identifier of the calling AI model/agent.' },
        force: { type: 'boolean', description: 'Override active run lock only when explicitly instructed.' },
      },
    },
  },
  {
    name: 'score_phonetics_and_variants',
    annotations: READ_ONLY_ANNOTATIONS,
    _meta: READ_SECURITY_META,
    description:
      'Run deterministic DRAgNEt articulatory consonant-skeleton contact scoring, OCR variant expansion, phonetic variant expansion, and column-wrap regex generation.',
    inputSchema: {
      type: 'object',
      required: ['english_headword'],
      properties: {
        english_headword: { type: 'string' },
        donor_form: { type: 'string', description: 'Optional candidate donor word to score against english_headword.' },
        donor_attested_year: { type: 'integer' },
        english_baseline_year: { type: 'integer' },
      },
    },
  },
  {
    name: 'upload_proof_scan',
    annotations: WRITE_ANNOTATIONS,
    _meta: WRITE_SECURITY_META,
    description:
      'Upload a pre-1931 composite WebP proof scan (full page + masthead + zoomed ink crop, <= 5 MB) to Cloudflare R2 and return its canonical hosted_path and SHA-256.',
    inputSchema: {
      type: 'object',
      required: ['case_slug', 'cert_id', 'publication_year'],
      properties: {
        case_slug: { type: 'string' },
        cert_id: { type: 'string', description: 'Citation ID, e.g. CERT-2900-101.' },
        publication_year: { type: 'integer' },
        rights_cleared: { type: 'boolean' },
        image_base64: { type: 'string', description: 'Base64-encoded WebP image bytes.' },
        fetch_from_url: { type: 'string', description: 'HTTPS URL of a WebP image to fetch directly.' },
      },
    },
  },
  {
    name: 'upsert_citations',
    annotations: WRITE_ANNOTATIONS,
    _meta: WRITE_SECURITY_META,
    description:
      'Validate and upsert schema v3.0 CitationRecord entries into D1. Pass 1 (role="proposer") records are clamped to verification_level="discovered"; Pass 2 (role="redteam") promotes verified survivors to "agent_verified" or reclassifies myths as "rejected_lead".',
    inputSchema: {
      type: 'object',
      required: ['target_id', 'role', 'citations'],
      properties: {
        target_id: { type: 'string' },
        run_id: { type: 'string' },
        role: { type: 'string', enum: ['proposer', 'redteam', 'human'] },
        citations: { type: 'array', items: { type: 'object' } },
      },
    },
  },
  {
    name: 'save_run_artifacts_and_advance',
    annotations: WRITE_ANNOTATIONS,
    _meta: WRITE_SECURITY_META,
    description:
      'Store Markdown artifacts (dossier, monograph, red-team audit report, Case File Markdown, OED slips) and advance run status (CLAIMING_DISCOVERY -> AWAITING_AUDIT -> AUDITING_REDTEAM -> STAGE_B_PACK_READY or NEEDS_PHASE_2).',
    inputSchema: {
      type: 'object',
      required: ['run_id', 'next_status'],
      properties: {
        run_id: { type: 'string' },
        next_status: {
          type: 'string',
          enum: ['CLAIMING_DISCOVERY', 'AWAITING_AUDIT', 'AUDITING_REDTEAM', 'STAGE_B_PACK_READY', 'NEEDS_PHASE_2'],
        },
        agent_name: { type: 'string' },
        dossier_markdown: { type: 'string' },
        monograph_markdown: { type: 'string' },
        audit_report_markdown: { type: 'string' },
        case_markdown: { type: 'string' },
        oed_slips_markdown: { type: 'string' },
        prior_art_baselines: { type: 'object' },
        corpus_search_summary: { type: 'object' },
        best_verified_year: { type: 'integer' },
        notes: { type: 'string' },
      },
    },
  },
  {
    name: 'open_case_pull_request',
    annotations: WRITE_ANNOTATIONS,
    _meta: WRITE_SECURITY_META,
    description:
      'Assemble public/ledgers/{slug}.json, src/content/cases/{slug}.md, open-questions.json, and r2-scan-manifest.json from D1 and open an automated GitHub Pull Request on dragnet-etymology.',
    inputSchema: {
      type: 'object',
      required: ['run_id'],
      properties: {
        run_id: { type: 'string' },
        pr_title: { type: 'string' },
        draft: { type: 'boolean', description: 'Open as a GitHub Draft PR (default true so coordinator controls merge).' },
      },
    },
  },
  {
    name: 'search_corpus',
    annotations: READ_ONLY_ANNOTATIONS,
    _meta: READ_SECURITY_META,
    description: 'Search across all stored D1 citations by keyword, case_slug, record_type, or verification_level.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string' },
        case_slug: { type: 'string' },
        record_type: { type: 'string' },
        verification_level: { type: 'string' },
        limit: { type: 'integer' },
      },
    },
  },
];

const COORDINATOR_PROFILE = {
  id: 'prf_dragnet_coordinator_01',
  name: 'Joshua Callahan',
  nickname: 'DRAgNEt Coordinator (@radbot44)',
};

async function dispatchToolCall(name: string, args: Record<string, any>, env: Env): Promise<unknown> {
  switch (name) {
    case 'get_profile':
      return COORDINATOR_PROFILE;
    case 'get_pipeline_status':
      return opGetPipelineStatus(env, Number(args.queue_limit || 10));
    case 'get_target_brief':
      return opGetTargetBrief(env, String(args.slug_or_id || ''));
    case 'claim_next_target':
      return opClaimNextTarget(env, args);
    case 'score_phonetics_and_variants': {
      const hw = String(args.english_headword || '');
      if (!hw) throw new Error('english_headword is required.');
      return {
        english_headword: hw,
        consonant_skeleton: consonantSkeleton(hw),
        dirty_ocr_regex: compileDirtyOcrRegexPattern(hw),
        phonetic_orthographic_regex: compileOrthographicVariantRegex(hw),
        ocr_variants: generateOcrVariants(hw, 50),
        phonetic_variants: generatePhoneticVariants(hw, 50),
        donor_comparison: args.donor_form
          ? scorePhonologicalContact(
              hw,
              String(args.donor_form),
              args.donor_attested_year ?? null,
              args.english_baseline_year ?? null
            )
          : null,
      };
    }
    case 'upload_proof_scan':
      return opUploadProofScan(env, args as any);
    case 'upsert_citations':
      return opUpsertCitations(env, args as any);
    case 'save_run_artifacts_and_advance':
      return opSaveRunArtifactsAndAdvance(env, args as any);
    case 'open_case_pull_request':
      return opOpenCasePullRequest(env, args as any);
    case 'search_corpus':
      return opSearchCorpus(env, args);
    default:
      throw new Error(`Unknown DRAgNEt tool '${name}'.`);
  }
}

async function handleSingleJsonRpc(msg: Record<string, any>, env: Env): Promise<Record<string, unknown> | null> {
  const id = msg.id;
  const isNotification = id === undefined || id === null;
  const method = String(msg.method || '');
  const params = (msg.params || {}) as Record<string, any>;

  if (isNotification) return null;

  try {
    if (method === 'initialize') {
      const requested = String(params.protocolVersion || '');
      const negotiated = SUPPORTED_MCP_VERSIONS.includes(requested) ? requested : '2025-11-25';
      return {
        jsonrpc: '2.0',
        id,
        result: {
          protocolVersion: negotiated,
          capabilities: {
            tools: {},
            resources: {},
            prompts: {},
          },
          serverInfo: {
            name: 'dragnet-etymology-hub',
            version: '3.4.0',
          },
          instructions: DRAGNET_CONSTITUTION,
        },
      };
    }
    if (method === 'ping') {
      return { jsonrpc: '2.0', id, result: {} };
    }
    if (method === 'tools/list') {
      return { jsonrpc: '2.0', id, result: { tools: MCP_TOOLS } };
    }
    if (method === 'tools/call') {
      const toolName = String(params.name || '');
      const toolArgs = (params.arguments || {}) as Record<string, any>;
      try {
        const out = await dispatchToolCall(toolName, toolArgs, env);
        return {
          jsonrpc: '2.0',
          id,
          result: {
            content: [{ type: 'text', text: JSON.stringify(out, null, 2) }],
            ...(toolName === 'get_profile' ? { structuredContent: out } : {}),
            isError: false,
          },
        };
      } catch (toolErr: any) {
        return {
          jsonrpc: '2.0',
          id,
          result: {
            content: [{ type: 'text', text: `ERROR: ${toolErr?.message || String(toolErr)}` }],
            isError: true,
          },
        };
      }
    }
    if (method === 'resources/list') {
      return {
        jsonrpc: '2.0',
        id,
        result: {
          resources: [
            {
              uri: 'dragnet://constitution/agents',
              name: 'DRAgNEt Verification Constitution (Traps A-D & v3 Schema)',
              mimeType: 'text/plain',
            },
            {
              uri: 'dragnet://pipeline/status',
              name: 'Live DRAgNEt Queue & Active Run Status',
              mimeType: 'application/json',
            },
          ],
        },
      };
    }
    if (method === 'resources/read') {
      const uri = String(params.uri || '');
      if (uri === 'dragnet://constitution/agents') {
        return {
          jsonrpc: '2.0',
          id,
          result: { contents: [{ uri, mimeType: 'text/plain', text: DRAGNET_CONSTITUTION }] },
        };
      }
      if (uri === 'dragnet://pipeline/status') {
        const st = await opGetPipelineStatus(env, 15);
        return {
          jsonrpc: '2.0',
          id,
          result: { contents: [{ uri, mimeType: 'application/json', text: JSON.stringify(st, null, 2) }] },
        };
      }
      throw new Error(`Unknown resource URI '${uri}'.`);
    }
    if (method === 'prompts/list') {
      return {
        jsonrpc: '2.0',
        id,
        result: {
          prompts: [
            {
              name: 'proposer_pass1',
              description: 'Claim the next queued DRAgNEt word and execute Pass 1 Proposer archival discovery.',
            },
            {
              name: 'redteam_pass2',
              description: 'Execute Pass 2 Adversarial Red-Team scan audit on the active AWAITING_AUDIT run and open a GitHub PR.',
            },
          ],
        },
      };
    }
    if (method === 'prompts/get') {
      const pName = String(params.name || '');
      const text =
        pName === 'proposer_pass1'
          ? 'Call claim_next_target, calibrate modern scholarly baselines first, sweep newspapers/serials/cant/hinges, upload composite pre-1931 WebP proof plates via upload_proof_scan, upsert candidates via upsert_citations with role="proposer", and advance status to AWAITING_AUDIT with dossier_markdown.'
          : 'Call get_pipeline_status to inspect the active AWAITING_AUDIT run, advance to AUDITING_REDTEAM, verify every candidate scan and masthead against Traps A-D, update records via upsert_citations with role="redteam", save Case File Markdown via save_run_artifacts_and_advance (STAGE_B_PACK_READY), and call open_case_pull_request.';
      return {
        jsonrpc: '2.0',
        id,
        result: {
          description: pName,
          messages: [{ role: 'user', content: { type: 'text', text } }],
        },
      };
    }

    return {
      jsonrpc: '2.0',
      id,
      error: { code: -32601, message: `Method not found: ${method}` },
    };
  } catch (err: any) {
    return {
      jsonrpc: '2.0',
      id,
      error: { code: -32603, message: err?.message || String(err) },
    };
  }
}

async function handleMcpRequest(request: Request, url: URL, env: Env): Promise<Response> {
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders() });
  }
  const authErr = await checkBearerAuth(request, env, url);
  if (authErr) return authErr;

  if (request.method !== 'POST') {
    return jsonResponse(
      { error: 'Stateless Streamable HTTP MCP endpoint accepts POST JSON-RPC 2.0 requests.' },
      405,
      { Allow: 'POST, OPTIONS' }
    );
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return jsonResponse({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }, 400);
  }

  if (Array.isArray(payload)) {
    const responses = (await Promise.all(payload.map((item) => handleSingleJsonRpc(item, env)))).filter(Boolean);
    if (responses.length === 0) return new Response(null, { status: 202, headers: corsHeaders() });
    return jsonResponse(responses, 200);
  }

  if (payload && typeof payload === 'object') {
    const res = await handleSingleJsonRpc(payload as Record<string, any>, env);
    if (!res) return new Response(null, { status: 202, headers: corsHeaders() });
    return jsonResponse(res, 200);
  }

  return jsonResponse({ jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Invalid Request' } }, 400);
}

// ============================================================================
// 6. OpenAPI 3.1 Spec & REST Router (/api/v1/*) for ChatGPT Actions & Gemini
// ============================================================================

function buildOpenApiSpec(origin: string) {
  const citationItemSchema = {
    type: 'object',
    required: [
      'id',
      'case_slug',
      'headword',
      'attested_form',
      'record_type',
      'verification_level',
      'date_display',
      'sort_date',
      'short_gloss',
      'source_publication',
      'source_archive',
      'source_url',
      'page_and_column',
      'verbatim_quote',
      'masthead_date_verified',
    ],
    properties: {
      id: { type: 'string', description: 'Citation ID (e.g. CERT-2900-101)' },
      slug: { type: 'string' },
      case_slug: { type: 'string' },
      headword: { type: 'string' },
      attested_form: { type: 'string' },
      record_type: { type: 'string', enum: ['attestation', 'contextual_evidence', 'hypothesis', 'rejected_lead'] },
      record_subtype: { type: 'string', nullable: true },
      verification_level: {
        type: 'string',
        enum: ['discovered', 'agent_verified', 'human_verified', 'externally_recognized'],
      },
      verified_by_agent: { type: 'string', nullable: true },
      human_verified_by: { type: 'string', nullable: true },
      human_verified_date: { type: 'string', nullable: true },
      external_recognition: { type: 'string', nullable: true },
      publication_year: { type: 'integer', nullable: true },
      date_display: { type: 'string' },
      sort_date: { type: 'string', description: 'YYYY-MM-DD sort key' },
      short_gloss: { type: 'string' },
      source_publication: { type: 'string' },
      source_archive: { type: 'string' },
      source_url: { type: 'string' },
      page_and_column: { type: 'string' },
      verbatim_quote: { type: 'string' },
      masthead_date_verified: { type: 'boolean' },
      catalog_year: { type: 'integer', nullable: true },
      masthead_year: { type: 'integer', nullable: true },
      linguistic_note: { type: 'string' },
      analysis_notes: { type: 'string' },
      scan: {
        type: 'object',
        properties: {
          hosted_path: { type: 'string', nullable: true },
          rights_status: { type: 'string' },
          rights_note: { type: 'string' },
          rights_cleared: { type: 'boolean' },
        },
      },
    },
  };

  return {
    openapi: '3.1.0',
    info: {
      title: 'DRAgNEt Historical Lexicography Hub API',
      version: '3.4.0',
      description:
        'Unified REST interface mirroring the DRAgNEt MCP server for ChatGPT Custom GPT Actions, Gemini scheduled tasks, and CLI scripts.',
    },
    servers: [{ url: `${origin}/api/v1` }],
    components: {
      securitySchemes: {
        bearerAuth: { type: 'http', scheme: 'bearer' },
      },
      schemas: {
        CitationRecord: citationItemSchema,
      },
    },
    security: [{ bearerAuth: [] }],
    paths: {
      '/status': {
        get: {
          operationId: 'getPipelineStatus',
          summary: 'Get queue counts, active run lock, next_open_block, and upcoming queued targets.',
          'x-openai-isConsequential': false,
          security: [],
          parameters: [{ name: 'limit', in: 'query', schema: { type: 'integer', default: 10 } }],
          responses: { '200': { description: 'Pipeline status JSON' } },
        },
      },
      '/targets/{slugOrId}': {
        get: {
          operationId: 'getTargetBrief',
          summary: 'Fetch target metadata, phonetic skeleton, OCR regex, pre-cutoff archive queries, and Trap A-D rules.',
          'x-openai-isConsequential': false,
          parameters: [{ name: 'slugOrId', in: 'path', required: true, schema: { type: 'string' } }],
          responses: { '200': { description: 'Complete target brief' } },
        },
      },
      '/runs/claim': {
        post: {
          operationId: 'claimNextTarget',
          summary: 'Atomically claim the next QUEUED word for Pass 1 Proposer discovery.',
          'x-openai-isConsequential': false,
          requestBody: {
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    target_id: { type: 'string' },
                    agent_name: { type: 'string' },
                    force: { type: 'boolean' },
                  },
                },
              },
            },
          },
          responses: { '200': { description: 'Claimed run and target brief' } },
        },
      },
      '/phonetics/score': {
        post: {
          operationId: 'scorePhoneticsAndVariants',
          summary: 'Score consonant-skeleton phonological contact and generate OCR/phonetic search variants.',
          'x-openai-isConsequential': false,
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['english_headword'],
                  properties: {
                    english_headword: { type: 'string' },
                    donor_form: { type: 'string' },
                    donor_attested_year: { type: 'integer' },
                    english_baseline_year: { type: 'integer' },
                  },
                },
              },
            },
          },
          responses: { '200': { description: 'Phonological contact score and variants' } },
        },
      },
      '/scans/upload': {
        post: {
          operationId: 'uploadProofScan',
          summary: 'Upload a pre-1931 WebP composite proof plate to Cloudflare R2.',
          'x-openai-isConsequential': false,
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['case_slug', 'cert_id', 'publication_year'],
                  properties: {
                    case_slug: { type: 'string' },
                    cert_id: { type: 'string' },
                    publication_year: { type: 'integer' },
                    rights_cleared: { type: 'boolean' },
                    image_base64: { type: 'string' },
                    fetch_from_url: { type: 'string' },
                  },
                },
              },
            },
          },
          responses: { '200': { description: 'Uploaded R2 scan metadata' } },
        },
      },
      '/citations/upsert': {
        post: {
          operationId: 'upsertCitations',
          summary: 'Validate and upsert v3.0 CitationRecords into D1 (proposer clamped to discovered; redteam promotes verified).',
          'x-openai-isConsequential': false,
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['target_id', 'role', 'citations'],
                  properties: {
                    target_id: { type: 'string' },
                    run_id: { type: 'string' },
                    role: { type: 'string', enum: ['proposer', 'redteam', 'human'] },
                    citations: {
                      type: 'array',
                      items: { $ref: '#/components/schemas/CitationRecord' },
                    },
                  },
                },
              },
            },
          },
          responses: { '200': { description: 'Upsert confirmation' } },
        },
      },
      '/runs/advance': {
        post: {
          operationId: 'saveRunArtifactsAndAdvance',
          summary: 'Save Markdown deliverables and transition run state (AWAITING_AUDIT, STAGE_B_PACK_READY, NEEDS_PHASE_2).',
          'x-openai-isConsequential': false,
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['run_id', 'next_status'],
                  properties: {
                    run_id: { type: 'string' },
                    next_status: {
                      type: 'string',
                      enum: ['CLAIMING_DISCOVERY', 'AWAITING_AUDIT', 'AUDITING_REDTEAM', 'STAGE_B_PACK_READY', 'NEEDS_PHASE_2'],
                    },
                    agent_name: { type: 'string' },
                    dossier_markdown: { type: 'string' },
                    monograph_markdown: { type: 'string' },
                    audit_report_markdown: { type: 'string' },
                    case_markdown: { type: 'string' },
                    oed_slips_markdown: { type: 'string' },
                    prior_art_baselines: {
                      type: 'object',
                      properties: { summary: { type: 'string' } },
                      additionalProperties: true,
                    },
                    corpus_search_summary: {
                      type: 'object',
                      properties: { summary: { type: 'string' } },
                      additionalProperties: true,
                    },
                    best_verified_year: { type: 'integer' },
                    notes: { type: 'string' },
                  },
                },
              },
            },
          },
          responses: { '200': { description: 'Updated run state' } },
        },
      },
      '/runs/open-pr': {
        post: {
          operationId: 'openCasePullRequest',
          summary: 'Open an automated GitHub Pull Request on dragnet-etymology with the verified Case File and v3 JSON ledger.',
          'x-openai-isConsequential': true,
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['run_id'],
                  properties: {
                    run_id: { type: 'string' },
                    pr_title: { type: 'string' },
                  },
                },
              },
            },
          },
          responses: { '200': { description: 'Created GitHub Pull Request details' } },
        },
      },
      '/search': {
        get: {
          operationId: 'searchCorpus',
          summary: 'Search stored citations in D1.',
          'x-openai-isConsequential': false,
          parameters: [
            { name: 'query', in: 'query', schema: { type: 'string' } },
            { name: 'case_slug', in: 'query', schema: { type: 'string' } },
            { name: 'record_type', in: 'query', schema: { type: 'string' } },
            { name: 'verification_level', in: 'query', schema: { type: 'string' } },
            { name: 'limit', in: 'query', schema: { type: 'integer', default: 25 } },
          ],
          responses: { '200': { description: 'Matching citations' } },
        },
      },
    },
  };
}

async function handleRestApi(request: Request, url: URL, env: Env): Promise<Response> {
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders() });
  }
  const sub = url.pathname.replace(/^\/api\/v1\/?/, '');
  const origin = env.SITE_ORIGIN || `${url.protocol}//${url.host}`;

  try {
    if (request.method === 'GET' && (sub === 'health' || sub === '')) {
      return jsonResponse({ ok: true, service: 'dragnet-etymology-hub', version: '3.4.0' });
    }
    if (request.method === 'GET' && sub === 'openapi.json') {
      return jsonResponse(buildOpenApiSpec(origin));
    }
    if (request.method === 'GET' && sub === 'status') {
      const limit = Number(url.searchParams.get('limit') || 10);
      return jsonResponse(await opGetPipelineStatus(env, limit));
    }

    // All remaining /api/v1/* endpoints require Bearer authentication
    const authErr = await checkBearerAuth(request, env, url);
    if (authErr) return authErr;

    if (request.method === 'GET' && sub.startsWith('targets/')) {
      const slugOrId = decodeURIComponent(sub.slice('targets/'.length));
      return jsonResponse(await opGetTargetBrief(env, slugOrId));
    }
    if (request.method === 'GET' && sub === 'search') {
      return jsonResponse(
        await opSearchCorpus(env, {
          query: url.searchParams.get('query') || undefined,
          case_slug: url.searchParams.get('case_slug') || undefined,
          record_type: url.searchParams.get('record_type') || undefined,
          verification_level: url.searchParams.get('verification_level') || undefined,
          limit: Number(url.searchParams.get('limit') || 25),
        })
      );
    }
    if (request.method === 'POST') {
      const body = (await request.json().catch(() => ({}))) as Record<string, any>;
      if (sub === 'runs/claim') return jsonResponse(await opClaimNextTarget(env, body));
      if (sub === 'phonetics/score') return jsonResponse(await dispatchToolCall('score_phonetics_and_variants', body, env));
      if (sub === 'scans/upload') return jsonResponse(await opUploadProofScan(env, body as any));
      if (sub === 'citations/upsert') return jsonResponse(await opUpsertCitations(env, body as any));
      if (sub === 'runs/advance') return jsonResponse(await opSaveRunArtifactsAndAdvance(env, body as any));
      if (sub === 'runs/open-pr') return jsonResponse(await opOpenCasePullRequest(env, body as any));
    }

    return jsonResponse({ error: `Unknown endpoint: ${request.method} ${url.pathname}` }, 404);
  } catch (err: any) {
    return jsonResponse({ error: err?.message || String(err) }, 400);
  }
}

// ============================================================================
// 7. Edge-Cached Proof-Scan Handler (/scans/* -> R2 first, Static Assets fallback)
// ============================================================================

async function handleScanRequest(request: Request, url: URL, env: Env, ctx: ExecutionContext): Promise<Response> {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return new Response('Method Not Allowed', { status: 405 });
  }
  const cache = (caches as unknown as { default?: Cache }).default;
  const cacheKey = new Request(url.toString(), { method: 'GET' });
  if (cache && request.method === 'GET') {
    const hit = await cache.match(cacheKey);
    if (hit) return hit;
  }

  const r2Key = url.pathname.replace(/^\/+/, '');
  const obj = await env.SCANS.get(r2Key);
  if (obj) {
    const headers = new Headers({
      'Content-Type': obj.httpMetadata?.contentType || 'image/webp',
      'Cache-Control': 'public, max-age=31536000, immutable',
      ETag: obj.httpEtag,
    });
    const resp = new Response(request.method === 'HEAD' ? null : obj.body, { status: 200, headers });
    if (cache && request.method === 'GET') {
      ctx.waitUntil(cache.put(cacheKey, resp.clone()));
    }
    return resp;
  }

  // Fallback to bundled static assets during incremental migration
  return env.ASSETS.fetch(request);
}


// ============================================================================
// 5B. Stateless OAuth 2.1 + PKCE + DCR Discovery & Consent Flow (ChatGPT & Claude MCP)
// ============================================================================

const SUPPORTED_OAUTH_SCOPES = ['dragnet:read', 'dragnet:write', 'offline_access'];

function buildProtectedResourceMetadata(origin: string) {
  return {
    resource: `${origin}/mcp`,
    authorization_servers: [origin],
    scopes_supported: SUPPORTED_OAUTH_SCOPES,
    bearer_methods_supported: ['header'],
    resource_documentation: `${origin}/protocols/`,
  };
}

function buildAuthServerMetadata(origin: string) {
  return {
    issuer: origin,
    authorization_response_iss_parameter_supported: true,
    authorization_endpoint: `${origin}/oauth/authorize`,
    token_endpoint: `${origin}/oauth/token`,
    registration_endpoint: `${origin}/oauth/register`,
    client_id_metadata_document_supported: true,
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    token_endpoint_auth_methods_supported: ['none', 'client_secret_post', 'client_secret_basic'],
    code_challenge_methods_supported: ['S256'],
    scopes_supported: SUPPORTED_OAUTH_SCOPES,
  };
}

function renderAuthorizePage(params: {
  clientId: string;
  redirectUri: string;
  scope: string;
  state: string;
  codeChallenge: string;
  codeChallengeMethod: string;
  resource: string;
  errorMsg?: string;
}): Response {
  const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Authorize DRAgNEt MCP</title>
  <style>
    body { font-family: system-ui, -apple-system, sans-serif; background: #f6f4ef; color: #1c1917; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; padding: 1rem; }
    .card { background: #fff; border: 1px solid #d6d3cd; border-radius: 10px; max-width: 420px; width: 100%; padding: 1.5rem; box-shadow: 0 6px 20px rgba(0,0,0,0.06); }
    .kicker { font-family: ui-monospace, monospace; font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.06em; color: #7c2d12; font-weight: 700; }
    h1 { font-size: 1.25rem; margin: 0.35rem 0 0.6rem; }
    p { font-size: 0.9rem; color: #57534e; line-height: 1.45; margin: 0 0 1rem; word-break: break-word; }
    .meta { background: #faf8f5; border: 1px solid #e7e5e4; border-radius: 6px; padding: 0.65rem 0.75rem; font-family: ui-monospace, monospace; font-size: 0.78rem; margin-bottom: 1rem; color: #44403c; }
    label { display: block; font-size: 0.85rem; font-weight: 600; margin-bottom: 0.35rem; }
    input[type="password"] { width: 100%; box-sizing: border-box; padding: 0.6rem 0.75rem; border: 1px solid #a8a29e; border-radius: 6px; font-size: 0.95rem; margin-bottom: 1rem; }
    .err { background: #fef2f2; border: 1px solid #fecaca; color: #991b1b; padding: 0.6rem 0.75rem; border-radius: 6px; font-size: 0.85rem; margin-bottom: 1rem; }
    .actions { display: flex; gap: 0.6rem; }
    button { flex: 1; padding: 0.65rem 0.9rem; border-radius: 6px; font-size: 0.9rem; font-weight: 600; cursor: pointer; border: 1px solid transparent; }
    .btn-primary { background: #7c2d12; color: #fff; }
    .btn-secondary { background: #f5f5f4; color: #44403c; border-color: #d6d3cd; }
  </style>
</head>
<body>
  <div class="card">
    <div class="kicker">DRAgNEt · MCP OAuth 2.1</div>
    <h1>Authorize MCP Client</h1>
    <p>Enter your <code>DRAGNET_API_KEY</code> once to issue a scoped OAuth 2.1 session for this MCP connector.</p>
    <div class="meta">
      <div><strong>Client:</strong> ${escapeHtml(params.clientId)}</div>
      <div><strong>Callback:</strong> ${escapeHtml(new URL(params.redirectUri).host)}</div>
      <div><strong>Scopes:</strong> ${escapeHtml(params.scope || 'dragnet:read dragnet:write offline_access')}</div>
    </div>
    ${params.errorMsg ? `<div class="err">${escapeHtml(params.errorMsg)}</div>` : ''}
    <form method="POST" action="/oauth/authorize">
      <input type="hidden" name="client_id" value="${escapeHtml(params.clientId)}" />
      <input type="hidden" name="redirect_uri" value="${escapeHtml(params.redirectUri)}" />
      <input type="hidden" name="scope" value="${escapeHtml(params.scope)}" />
      <input type="hidden" name="state" value="${escapeHtml(params.state)}" />
      <input type="hidden" name="code_challenge" value="${escapeHtml(params.codeChallenge)}" />
      <input type="hidden" name="code_challenge_method" value="${escapeHtml(params.codeChallengeMethod)}" />
      <input type="hidden" name="resource" value="${escapeHtml(params.resource)}" />
      <label for="api_key">Coordinator API Key</label>
      <input id="api_key" name="api_key" type="password" required autofocus autocomplete="current-password" />
      <div class="actions">
        <button type="submit" name="decision" value="deny" class="btn-secondary" formnovalidate>Cancel</button>
        <button type="submit" name="decision" value="allow" class="btn-primary">Authorize</button>
      </div>
    </form>
  </div>
</body>
</html>`;
  return new Response(html, {
    status: params.errorMsg ? 401 : 200,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
      'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'",
    },
  });
}

async function handleOAuthAndDiscovery(request: Request, url: URL, env: Env): Promise<Response> {
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders() });
  }
  const origin = resolveCanonicalOrigin(url, env);
  const configured = (env.DRAGNET_API_KEY || '').trim();

  if (request.method === 'GET' && url.pathname.startsWith('/.well-known/oauth-protected-resource')) {
    return jsonResponse(buildProtectedResourceMetadata(origin), 200, { 'Cache-Control': 'no-store' });
  }
  if (
    request.method === 'GET' &&
    (url.pathname.startsWith('/.well-known/oauth-authorization-server') ||
      url.pathname.startsWith('/.well-known/openid-configuration'))
  ) {
    return jsonResponse(buildAuthServerMetadata(origin), 200, { 'Cache-Control': 'no-store' });
  }

  // RFC 7591 Dynamic Client Registration (DCR)
  if (request.method === 'POST' && url.pathname === '/oauth/register') {
    const body = (await request.json().catch(() => ({}))) as Record<string, any>;
    const redirectUris = Array.isArray(body.redirect_uris) ? body.redirect_uris.map(String) : [];
    if (redirectUris.length === 0 || !redirectUris.every(isAllowedOAuthRedirectUri)) {
      return jsonResponse(
        { error: 'invalid_redirect_uri', error_description: 'Redirect URI must be an approved ChatGPT, Claude, or localhost callback.' },
        400
      );
    }
    const rand = new Uint8Array(12);
    crypto.getRandomValues(rand);
    const clientId = `dragnet_client_${base64UrlEncodeBytes(rand)}`;
    const requestedMethod = String(body.token_endpoint_auth_method || 'none');
    const authMethod = ['none', 'client_secret_post', 'client_secret_basic'].includes(requestedMethod)
      ? requestedMethod
      : 'none';
    const resp: Record<string, unknown> = {
      client_id: clientId,
      client_id_issued_at: Math.floor(Date.now() / 1000),
      client_name: String(body.client_name || 'MCP Client'),
      redirect_uris: redirectUris,
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: authMethod,
    };
    if (authMethod !== 'none' && configured) {
      resp.client_secret = await signOAuthJwt({ token_use: 'client_secret', client_id: clientId, exp: Math.floor(Date.now() / 1000) + 315360000 }, configured);
      resp.client_secret_expires_at = 0;
    }
    return jsonResponse(resp, 201, { 'Cache-Control': 'no-store' });
  }

  // OAuth 2.1 Authorization Endpoint (GET renders consent card, POST validates DRAGNET_API_KEY & issues PKCE code)
  if (url.pathname === '/oauth/authorize') {
    if (!configured) {
      return jsonResponse({ error: 'server_error', error_description: 'DRAGNET_API_KEY secret is not configured.' }, 500);
    }
    if (request.method === 'GET') {
      const clientId = url.searchParams.get('client_id') || '';
      const redirectUri = url.searchParams.get('redirect_uri') || '';
      const responseType = url.searchParams.get('response_type') || 'code';
      const scope = url.searchParams.get('scope') || SUPPORTED_OAUTH_SCOPES.join(' ');
      const state = url.searchParams.get('state') || '';
      const codeChallenge = url.searchParams.get('code_challenge') || '';
      const codeChallengeMethod = url.searchParams.get('code_challenge_method') || 'S256';
      const resource = url.searchParams.get('resource') || `${origin}/mcp`;

      if (!clientId || !redirectUri || !isAllowedOAuthRedirectUri(redirectUri)) {
        return jsonResponse({ error: 'invalid_request', error_description: 'Missing client_id or unapproved redirect_uri.' }, 400);
      }
      if (responseType !== 'code' || !codeChallenge || codeChallengeMethod !== 'S256') {
        const cb = new URL(redirectUri);
        cb.searchParams.set('error', 'invalid_request');
        cb.searchParams.set('error_description', 'PKCE S256 and response_type=code are required.');
        if (state) cb.searchParams.set('state', state);
        cb.searchParams.set('iss', origin);
        return Response.redirect(cb.toString(), 302);
      }
      return renderAuthorizePage({
        clientId,
        redirectUri,
        scope,
        state,
        codeChallenge,
        codeChallengeMethod,
        resource,
      });
    }

    if (request.method === 'POST') {
      const form = await request.formData();
      const clientId = String(form.get('client_id') || '');
      const redirectUri = String(form.get('redirect_uri') || '');
      const scope = String(form.get('scope') || SUPPORTED_OAUTH_SCOPES.join(' '));
      const state = String(form.get('state') || '');
      const codeChallenge = String(form.get('code_challenge') || '');
      const codeChallengeMethod = String(form.get('code_challenge_method') || 'S256');
      const resource = String(form.get('resource') || `${origin}/mcp`);
      const decision = String(form.get('decision') || '');
      const apiKey = String(form.get('api_key') || '').trim();

      if (!clientId || !redirectUri || !isAllowedOAuthRedirectUri(redirectUri)) {
        return jsonResponse({ error: 'invalid_request', error_description: 'Invalid redirect_uri or client_id.' }, 400);
      }
      if (decision !== 'allow') {
        const cb = new URL(redirectUri);
        cb.searchParams.set('error', 'access_denied');
        cb.searchParams.set('error_description', 'User cancelled authorization.');
        if (state) cb.searchParams.set('state', state);
        cb.searchParams.set('iss', origin);
        return Response.redirect(cb.toString(), 302);
      }
      if (!apiKey || !timingSafeEqualString(apiKey, configured)) {
        return renderAuthorizePage({
          clientId,
          redirectUri,
          scope,
          state,
          codeChallenge,
          codeChallengeMethod,
          resource,
          errorMsg: 'Invalid DRAGNET_API_KEY. Check your Worker secret and try again.',
        });
      }

      const nowSec = Math.floor(Date.now() / 1000);
      const code = await signOAuthJwt(
        {
          token_use: 'auth_code',
          iss: origin,
          client_id: clientId,
          redirect_uri: redirectUri,
          code_challenge: codeChallenge,
          code_challenge_method: 'S256',
          scope,
          resource,
          iat: nowSec,
          exp: nowSec + 300,
        },
        configured
      );
      const cb = new URL(redirectUri);
      cb.searchParams.set('code', code);
      if (state) cb.searchParams.set('state', state);
      cb.searchParams.set('iss', origin);
      return Response.redirect(cb.toString(), 302);
    }
  }

  // OAuth 2.1 Token Endpoint (authorization_code + PKCE S256 & refresh_token)
  if (request.method === 'POST' && url.pathname === '/oauth/token') {
    if (!configured) {
      return jsonResponse({ error: 'server_error', error_description: 'DRAGNET_API_KEY secret is not configured.' }, 500);
    }
    const ct = (request.headers.get('Content-Type') || '').toLowerCase();
    let params: Record<string, string> = {};
    if (ct.includes('application/json')) {
      const jb = (await request.json().catch(() => ({}))) as Record<string, any>;
      for (const [k, v] of Object.entries(jb)) if (v != null) params[k] = String(v);
    } else {
      const text = await request.text();
      new URLSearchParams(text).forEach((v, k) => { params[k] = v; });
    }

    const grantType = params.grant_type || '';
    const nowSec = Math.floor(Date.now() / 1000);

    if (grantType === 'authorization_code') {
      const code = params.code || '';
      const verifier = params.code_verifier || '';
      const clientId = params.client_id || '';
      const redirectUri = params.redirect_uri || '';

      const claims = await verifyOAuthJwt(code, configured);
      if (!claims || claims.token_use !== 'auth_code' || claims.iss !== origin) {
        return jsonResponse({ error: 'invalid_grant', error_description: 'Authorization code is invalid or expired.' }, 400, { 'Cache-Control': 'no-store' });
      }
      if (clientId && claims.client_id !== clientId) {
        return jsonResponse({ error: 'invalid_grant', error_description: 'client_id mismatch.' }, 400, { 'Cache-Control': 'no-store' });
      }
      if (redirectUri && claims.redirect_uri !== redirectUri) {
        return jsonResponse({ error: 'invalid_grant', error_description: 'redirect_uri mismatch.' }, 400, { 'Cache-Control': 'no-store' });
      }
      if (!verifier) {
        return jsonResponse({ error: 'invalid_request', error_description: 'Missing PKCE code_verifier.' }, 400, { 'Cache-Control': 'no-store' });
      }
      const computedChallenge = await pkceChallengeS256(verifier);
      if (!timingSafeEqualString(computedChallenge, String(claims.code_challenge || ''))) {
        return jsonResponse({ error: 'invalid_grant', error_description: 'PKCE S256 verification failed.' }, 400, { 'Cache-Control': 'no-store' });
      }

      const aud = params.resource || claims.resource || `${origin}/mcp`;
      const scope = String(claims.scope || SUPPORTED_OAUTH_SCOPES.join(' '));
      const accessToken = await signOAuthJwt(
        {
          token_use: 'access',
          iss: origin,
          aud,
          sub: COORDINATOR_PROFILE.id,
          client_id: claims.client_id,
          scope,
          iat: nowSec,
          exp: nowSec + 43200,
        },
        configured
      );
      const refreshToken = await signOAuthJwt(
        {
          token_use: 'refresh',
          iss: origin,
          aud,
          sub: COORDINATOR_PROFILE.id,
          client_id: claims.client_id,
          scope,
          iat: nowSec,
          exp: nowSec + 7776000,
        },
        configured
      );
      return jsonResponse(
        {
          access_token: accessToken,
          token_type: 'Bearer',
          expires_in: 43200,
          refresh_token: refreshToken,
          scope,
        },
        200,
        { 'Cache-Control': 'no-store' }
      );
    }

    if (grantType === 'refresh_token') {
      const rt = params.refresh_token || '';
      const claims = await verifyOAuthJwt(rt, configured);
      if (!claims || claims.token_use !== 'refresh' || claims.iss !== origin) {
        return jsonResponse({ error: 'invalid_grant', error_description: 'Refresh token is invalid or expired.' }, 400, { 'Cache-Control': 'no-store' });
      }
      const aud = params.resource || claims.aud || `${origin}/mcp`;
      const scope = String(claims.scope || SUPPORTED_OAUTH_SCOPES.join(' '));
      const accessToken = await signOAuthJwt(
        {
          token_use: 'access',
          iss: origin,
          aud,
          sub: COORDINATOR_PROFILE.id,
          client_id: claims.client_id,
          scope,
          iat: nowSec,
          exp: nowSec + 43200,
        },
        configured
      );
      const nextRefresh = await signOAuthJwt(
        {
          token_use: 'refresh',
          iss: origin,
          aud,
          sub: COORDINATOR_PROFILE.id,
          client_id: claims.client_id,
          scope,
          iat: nowSec,
          exp: nowSec + 7776000,
        },
        configured
      );
      return jsonResponse(
        {
          access_token: accessToken,
          token_type: 'Bearer',
          expires_in: 43200,
          refresh_token: nextRefresh,
          scope,
        },
        200,
        { 'Cache-Control': 'no-store' }
      );
    }

    return jsonResponse({ error: 'unsupported_grant_type', error_description: `Unsupported grant_type '${grantType}'.` }, 400, { 'Cache-Control': 'no-store' });
  }

  return jsonResponse({ error: 'Not Found' }, 404);
}

// ============================================================================
// 8. Worker Entrypoint
// ============================================================================

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/.well-known/') || url.pathname.startsWith('/oauth/')) {
      return handleOAuthAndDiscovery(request, url, env);
    }
    if (url.pathname === '/mcp' || url.pathname.startsWith('/mcp/')) {
      return handleMcpRequest(request, url, env);
    }
    if (url.pathname.startsWith('/api/v1')) {
      return handleRestApi(request, url, env);
    }
    if (url.pathname.startsWith('/scans/')) {
      return handleScanRequest(request, url, env, ctx);
    }
    return env.ASSETS.fetch(request);
  },
};