# DRAgNEt Claim-Level Evidence Architecture (`v1.0`)

This specification defines the **DRAgNEt Claim Ledger (`schema_version: "1.0"`)**, the directed inferential evidence graph, precision-bounded chronological comparison rules, deterministic material fingerprinting, dynamic review-staleness tracking, and extraction methodology used across DRAgNEt Case Files.

---

## 1. Architectural Separation: Witnesses (`CERT-*`) vs. Propositions (`CLM-*`)

DRAgNEt separates primary-source archival witnesses from the philological propositions argued from those witnesses:

1. **Citation Ledgers (`public/ledgers/<case_slug>.json`, `schema_version: "3.0"`)** store immutable bibliographic records, diplomatic transcriptions, masthead audits, and pre-1931 WebP page scans (`CERT-<digits>-<NNN>`).
2. **Claim Ledgers (`public/claims/<case_slug>.json`, `schema_version: "1.0"`)** store structured, falsifiable propositions (`CLM-<case_number_digits>-<NNN>`) linked to `CERT-*` witnesses and upstream `CLM-*` premises via typed, directed `evidence` edges.
3. **Dynamic Derivation (`src/lib/claims.ts`)**: Citation-to-claim backlinks, case-level and corpus-wide claim counts, graph topological order, and review staleness (`is_stale`) are **never** hardcoded in Markdown frontmatter or static JSON; they are computed dynamically at build and validation time.

---

## 2. Ledger Wrapper & Permanent Claim Identity

Each published Case File (`src/content/cases/<case_slug>.md`) has a corresponding claim ledger at `public/claims/<case_slug>.json` validated against `schemas/claim-ledger.schema.json`.

### 2.1 Top-Level Wrapper (`ClaimLedger`)

| Field | Type | Constraint |
|---|---|---|
| `schema_version` | `"1.0"` | Exact string `"1.0"`. |
| `claim_ledger_id` | `string` | Matches filename stem `<case_slug>` (`^[a-z0-9]+(?:-[a-z0-9]+)*$`). |
| `case_slug` | `string` | Matches `claim_ledger_id` and `public/ledgers/<case_slug>.json` (`ledger_id`). |
| `case_number` | `string` | Matches `public/ledgers/<case_slug>.json` (e.g., `"Case 1800"`). |
| `target_id` | `string` | Matches `public/ledgers/<case_slug>.json` (e.g., `"TGT-033"`). |
| `headword` | `string` | Matches `public/ledgers/<case_slug>.json` (e.g., `"ballyhoo / ballahoo"`). |
| `updated_at` | `string` | Valid ISO calendar date `YYYY-MM-DD`. |
| `summary_note` | `string \| null` | Optional concise scope note for the case's claim set. |
| `claims` | `ClaimRecord[]` | Non-empty array of claim records (`minItems: 1`). |

### 2.2 Permanent Monotonic Claim IDs & Lifecycle

- **`id` (`^CLM-\d{3,4}-\d{3}$`)**: Scoped strictly to the numeric digits of `case_number` (for `"Case 1800"`, every claim in `public/claims/ballyhoo.json` uses prefix `CLM-1800-`, e.g., `CLM-1800-001`, `CLM-1800-002`, …, with sequence `001`–`999`).
- **`slug` (`^clm-\d{3,4}-\d{3}$`)**: Must equal `id.toLowerCase()` (resolving to `/claims/clm-1800-001/`).
- **Monotonicity & Stability**: Claim IDs are permanent identifiers allocated monotonically per case namespace. They are **never** derived from array index or wording, and are **never** reused or renumbered if claims are reordered, superseded, or withdrawn.
- **Presentation Ordering (`sort_order` & `is_principal`)**:
  - `is_principal` (`boolean`): Marks headline claims surfaced in Case File executive summaries. Every ledger must contain at least one `active` claim with `is_principal: true`. Claims with `lifecycle_status !== "active"` must set `is_principal: false`.
  - `sort_order` (`integer >= 0 | null`, optional): Controls display ordering without affecting `id` or `content_fingerprint`.
- **Lifecycle (`lifecycle_status`, `revision`, `supersedes`, `superseded_by`)**:
  - `active`: Current standing claim (`superseded_by` **must** be `null`).
  - `superseded`: Replaced by a newer claim ID (`superseded_by` **must** be a valid `CLM-*` ID; if in the same case, the superseding claim must carry a strictly greater numeric `<NNN>` sequence and list the old ID in `supersedes`).
  - `withdrawn`: Retracted without replacement (`superseded_by` **must** be `null`, `is_principal` **must** be `false`).
  - `revision`: Integer `>= 1`. `revision_history` must record sequential revisions `1 .. revision`, with the latest entry's `content_fingerprint` matching `claim.content_fingerprint`.

---

## 3. Orthogonal Epistemic Dimensions (Zero Numerical Scores)

Numerical confidence scores, probabilities, Bayesian posteriors, decimal-year spans (e.g., `-30.9 yrs`), and raw string-similarity floats (`SLPL = 0.7500`) are **strictly prohibited** in both JSON keys and prose fields. Every claim is classified along three orthogonal qualitative dimensions:

### 3.1 `type` — Documentary vs. Interpretive Classification

Helper metadata in `src/lib/claims.ts` (`CLAIM_TYPE_METADATA`, `isDocumentaryClaimType`, `isInterpretiveClaimType`) partitions the 10 claim types into two epistemic classes:

| `type` | Epistemic Class | Scope & Requirements |
|---|---|---|
| `attestation` | `documentary` | Establishes occurrence, form, date, and print/manuscript context of primary witness(es). |
| `antedating` | `documentary` | Establishes chronological priority (or baseline comparison) relative to a lexicographical authority. **Requires `antedating_baseline`.** |
| `negative_evidence` | `documentary` | Establishes bounded absence or exact token count across a defined corpus sweep. **Requires `negative_evidence_bounds`.** |
| `source_relationship` | `documentary` | Establishes bibliographic dependence between witnesses (reprint chains, stereotype plates, edition dates, ghostwords). |
| `semantic` | `interpretive` | Analyzes sense definition, polysemy, register boundary, or semantic-hinge bridging. |
| `historical_context` | `interpretive` | Establishes socio-historical, institutional, or occupational context bearing on lexical emergence. |
| `transmission` | `interpretive` | Proposes geographic, social, occupational, or language-contact pathways of transmission. |
| `derivation` | `interpretive` | Proposes morphological formation, compounding, clipping, eponymic origin, or donor-language etymon. |
| `phonological` | `interpretive` | Evaluates sound correspondence, phonetic adaptation, orthoepic evidence, or prosodic structure. |
| `rebuttal` | `interpretive` | Refutes (`contradicted`) or weakens (`inconclusive` / `partially_supported`) a prior etymological or chronological proposal. |

### 3.2 `assessment` — Qualitative Evidentiary Standing

- `unassessed`: Recorded proposition awaiting evidentiary evaluation.
- `supported`: Directly established within its stated `evidence_boundary` by verified primary evidence and sound philological argument.
- `partially_supported`: Essential components are attested, but key bridging steps remain indirect or incomplete.
- `inconclusive`: Plausible or open hypothesis lacking decisive confirming or refuting primary evidence.
- `contradicted`: Decisively refuted on chronological, bibliographic, morphological, phonological, or semantic grounds. (Reserve `contradicted` for claims refuted by specific primary counter-evidence; do not label serious scholarly proposals "falsified myths" when evidence merely weakens them.)

### 3.3 `review_status` — Verification Provenance

- `unreviewed` *(mandatory default for newly extracted claims)*
- `agent_reviewed` *(requires >= 1 non-stale upholding review of `reviewer_kind` in `agent | independent_agent | human`)*
- `independently_agent_reviewed` *(requires >= 1 non-stale upholding review of `reviewer_kind` in `independent_agent | human`)*
- `human_reviewed` *(strictly requires >= 1 non-stale upholding review with `reviewer_kind: "human"`, named human `reviewer_id`, `model_version: null`, and ISO `review_date`)*

---

## 4. Explicit Evidence Boundaries & Resolution Criteria

Every `ClaimRecord` carries:

```json
"evidence_boundary": {
  "establishes": "Exact proposition demonstrated by the linked witnesses.",
  "does_not_establish": "Broader etymological, oral-currency, or causal inferences NOT proved by this evidence.",
  "remaining_uncertainty": "Specific open paleographic, bibliographic, or linguistic uncertainties."
},
"limitations": [
  "Explicit archival, OCR, register, or edition caveats."
],
"resolution_criteria": [
  "Concrete primary-source discovery or linguistic proof needed to resolve or overturn the claim."
]
```

- **Mandatory `resolution_criteria` Rule**: Whenever `type` is **interpretive** (`semantic`, `historical_context`, `transmission`, `derivation`, `phonological`, `rebuttal`) AND `assessment` is **unresolved** (`unassessed`, `partially_supported`, `inconclusive`), `resolution_criteria` **must** contain at least one concrete criterion (`minItems: 1`).

---

## 5. Evidence Graph, Inferential DAG, and Non-Inheritance

Each claim links to primary witnesses (`CERT-*`) and/or other claims (`CLM-*`) in `evidence: EvidenceLink[]`:

```json
{
  "ref": "CERT-1800-010",
  "relationship": "supports",
  "directness": "direct",
  "reason": "Provides the 16 June 1810 Savannah Republican witness (printing a May 15, 1810 Kingston, Jamaica dispatch) for generic nautical 'ballahou'.",
  "witness_note": "Masthead and column ink verified directly on hosted pre-1931 scan."
}
```

### 5.1 Graph Invariants

1. **Cross-Case Support**: `ref` may target any `CERT-*` in `public/ledgers/*.json` or any `CLM-*` in `public/claims/*.json` (intra-case or cross-case).
2. **No Self-Loops & No Duplicate Pairs**: `edge.ref !== claim.id`, and duplicate `(ref, relationship)` pairs on the same claim are rejected.
3. **Evidence Presence**: Every claim with `assessment !== "unassessed"` and `type !== "negative_evidence"` must contain at least one `evidence` link (`evidence.length >= 1`). (`negative_evidence` claims are grounded by `negative_evidence_bounds` and may additionally link contextual `CERT-*` / `CLM-*` edges.)
4. **Inferential DAG vs. Non-Inferential Cross-References**:
   - When `edge.ref` is a `CLM-*` ID and `edge.relationship` is **`depends_on`** or **`supports`**, the edge is **inferential** (`claim` draws premise support from `edge.ref`). Across the entire multi-case claim graph, inferential `CLM-*` edges **must form a strict Directed Acyclic Graph (DAG)** — cycles of length `>= 1` are rejected by both Node.js and Python validators.
   - When `edge.relationship` is **`contradicts`**, **`weakens`**, **`qualifies`**, or **`contextualizes`**, the edge is a **non-inferential cross-reference** (permitting symmetric comparisons such as rival hypotheses qualifying or contradicting each other without violating DAG acyclicity).
5. **Zero Auto-Inheritance of `supported`**:
   - Parent interpretive hypotheses **never** automatically inherit `assessment: "supported"` from documentary child claims (`attestation`, `antedating`, `negative_evidence`, `source_relationship`). A parent hypothesis may depend on three `supported` chronological claims and still rightly carry `assessment: "partially_supported"` or `"inconclusive"` because the donor-to-target transmission bridge remains unattested.
   - Conversely, a claim with `assessment: "supported"` **may not** have a `depends_on` edge pointing to a `contradicted` or `withdrawn` claim.

---

## 6. Precision-Bounded Antedating Baselines (`antedating_baseline`)

Required when `type === "antedating"` (optional/`null` otherwise):

- **Date Format by Precision**:
  - `day`: `YYYY-MM-DD` (valid Gregorian calendar date, e.g., `"1893-02-24"`)
  - `month`: `YYYY-MM` (valid year and month `01`–`12`, e.g., `"1929-05"`)
  - `year`: `YYYY` (4-digit year, e.g., `"1815"`)
  - `circa`: `c. YYYY` or `c. YYYY-YYYY` (e.g., `"c. 1853"`, `"c. 1877"`)
- **Effective Precision & Anti-Fabrication Rules**:
  Let precision rank be `circa (0) < year (1) < month (2) < day (3)`, and `effective_precision = min(attested_date_precision, baseline_date_precision)`:
  - **Never** express chronological spans in decimal years (e.g., `"4.6 years"`, `"-30.9 yrs"`).
  - If `effective_precision === "day"`, compute exact calendar `years, months, and days` (or exact `days` for short intra-year spans, e.g., `"49 days"` or `"1 month and 18 days"`).
  - If `effective_precision === "month"`, express advance in `years` and `months` only — **never** mention `day` or `days` in `computed_advance_display`.
  - If `effective_precision === "year"`, express advance in calendar `years` only (e.g., `"5 calendar years (16 June 1810 vs. 1815)"`) — **never** mention `month(s)` or `day(s)` as a computed advance, and never invent `YYYY-01-01` or `YYYY-12-31` for year-only dictionary baselines.
  - If `effective_precision === "circa"`, exact chronological subtraction is undefined; state approximate framing (`"circa comparison..."` / `"approximately N years"`) without `month(s)` or `day(s)`.
- **Comparison Kinds**:
  - Strict antedating kinds (`earlier_same_sense`, `earlier_spelling`, `earlier_derivative_or_inflected`, `proper_name_precursor`) require `attested_date` to precede `baseline_date` strictly at `effective_precision` (when `effective_precision !== "circa"`).
  - `earliest_in_search_scope` and `earliest_reported_by_authority` document scope-earliest or baseline-confirming witnesses without claiming strict pre-baseline priority when dates match.
- **Citation Integrity**: `advancing_citation_ref` must exist in `public/ledgers/*.json` and must appear in `claim.evidence`.

---

## 7. Bounded Negative Evidence (`negative_evidence_bounds`)

Required when `type === "negative_evidence"` (optional/`null` otherwise):

- `corpus_identity`: Named collection, archive, or bibliographic set swept.
- `search_date`: `YYYY-MM-DD` date of sweep execution or audit verification.
- `search_period`: Chronological span covered (e.g., `"1893-1894"`).
- `query_terms`: Non-empty list of exact literal forms, variant spellings, or regexes queried.
- `search_method`: Explicit search procedure (OCR full-text regex, manual page inspection, catalog/glossary audit).
- `corpus_coverage`: Quantified denominator (volumes, issues, pages, characters) when documented, else `null`.
- `known_limitations`: Non-empty list of OCR, register, or survival caveats bounding what absence in the corpus can establish.
- `qualifying_results_count`: Non-negative integer (e.g., `0`) or `null`.

---

## 8. Deterministic Fingerprinting & Dynamic Review Staleness

To detect silent drift whenever a claim, an upstream premise, a citation transcription, or a primary-source WebP scan changes after review, DRAgNEt computes three composable SHA-256 digests (`^[0-9a-f]{64}$`):

### 8.1 Canonicalization Rules (Identical in TypeScript, Node.js, and Python)

1. **Text Normalization (`normalizeText`)**: Convert string to Unicode `NFC`, collapse any contiguous sequence of whitespace (`[\t\n\v\f\r \u00a0\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]+`) to a single ASCII space `' '`, and strip leading/trailing space.
2. **Code-Point Sorting (`compareCodePoints`)**: Sort string arrays (`limitations`, `resolution_criteria`, `supersedes`, `query_terms`, `known_limitations`) and `evidence` records (by `(ref, relationship)`) in Unicode code-point order.
3. **Canonical JSON (`canonicalJson`)**: Serialize objects with lexicographically sorted ASCII keys, compact separators (`","` and `":"`), raw UTF-8 characters (`ensure_ascii=False`), and hash UTF-8 bytes with SHA-256 lowercase hex.

### 8.2 Three-Layer Hash Hierarchy

1. **Citation Material Fingerprint (`dragnet-citation-material-v1`)**:
   Hashes normalized `id`, `case_slug`, `attested_form`, `record_type`, `publication_year`, `date_display`, `sort_date`, `source_publication`, `source_url`, `page_and_column`, `verbatim_quote`, `masthead_date_verified`, `catalog_year`, `masthead_year`, and `scan: { hosted_path, rights_status, file_sha256 }` (where `file_sha256` is the SHA-256 hex digest of the hosted WebP scan file in `public/` when `hosted_path` is non-null).
2. **Intrinsic Claim Fingerprint (`dragnet-claim-intrinsic-v1`)**:
   Hashes normalized `id`, `case_slug`, `headword`, `target_lexeme`, `type`, `assessment`, `statement`, `rationale`, `lifecycle_status`, `supersedes`, `superseded_by`, `evidence_boundary`, `limitations`, `resolution_criteria`, `evidence`, `antedating_baseline`, and `negative_evidence_bounds`.
   - **Excluded presentational & audit fields**: `sort_order`, `short_label`, `case_section`, `is_principal`, `review_status`, `reviews`, `revision`, `revision_history`, `external_recognition`, and `content_fingerprint`. Recording a review, adding external dictionary recognition, or adjusting `sort_order` **never** invalidates existing fingerprints.
3. **Composite Claim Content Fingerprint (`dragnet-claim-content-v1`)**:
   - Builds `evidence_fingerprints: Record<string, string>` over all unique `ref` targets in `claim.evidence`:
     - `CERT-*` -> `CitationMaterialFingerprint(citation)`
     - `CLM-*` with an inferential relationship (`depends_on` or `supports`) -> `CompositeClaimContentFingerprint(targetClaim)` (propagating upstream evidentiary changes transitively through the DAG)
     - `CLM-*` with only non-inferential relationships (`contradicts`, `weakens`, `qualifies`, `contextualizes`) -> `IntrinsicClaimFingerprint(targetClaim)` (preventing mutual recursion across symmetric cross-references)
   - Hashes `{ schema: "dragnet-claim-content-v1", intrinsic_fingerprint, evidence_fingerprints }` to produce `claim.content_fingerprint`.

### 8.3 Dynamic `is_stale` Computation & Review Provenance

`is_stale` is **never** stored on disk in `public/claims/*.json`. At load and validation time, a `ClaimReviewRecord` is marked `is_stale = true` if and only if:
- `review.material_fingerprint_at_review !== claim.content_fingerprint`, **or**
- `review.evidence_fingerprints_at_review` does not match the claim's current `evidence_fingerprints` map key-for-key and digest-for-digest.

If `claim.review_status !== "unreviewed"` and no **non-stale** review satisfies the required `reviewer_kind` and `recommendation === "uphold"`, validation fails with an explicit stale/missing-review error until the claim is re-reviewed or reset to `"unreviewed"`.

---

## 9. Extraction & Authoring Guidelines

1. **Decompose Multi-Part Theses into Atomic Propositions**: Split composite case arguments into distinct documentary claims (`attestation`, `antedating`, `negative_evidence`, `source_relationship`) and downstream interpretive claims (`semantic`, `historical_context`, `transmission`, `derivation`, `phonological`, `rebuttal`) connected via `depends_on` or `supports`.
2. **Ground Strictly in Existing Verified Records**: Every `CERT-*` referenced must already exist in `public/ledgers/*.json`. Never invent citations, exact month/day dates from year-only records, corpus search denominators, human reviews, or external dictionary recognitions.
3. **Stamp & Validate Deterministically**:
   - Stamp canonical SHA-256 `content_fingerprint` digests after authoring or editing a claim ledger:
     ```bash
     python3 scripts/validate_claims.py --stamp-fingerprints public/claims/<slug>.json
     ```
   - Run both validators to verify schema, graph, date-precision, fingerprint, review-provenance, and sanitization compliance:
     ```bash
     node scripts/validate-claims.mjs --file public/claims/<slug>.json
     python3 scripts/validate_claims.py --file public/claims/<slug>.json
     ```
