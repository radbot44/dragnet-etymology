#!/usr/bin/env python3
"""Reference Variant Generator, Phonological Contact Scorer & Certificate Verifier.

Module: 03_ocr_phonetic_harness.py
Project: DRAgNEt (Deep Research Agent Network for Etymology)
Zero-dependency Python 3 library used by Task Agents 100-800.

Capabilities:
1. 18th/19th-century newsprint OCR confusion expansion & line-wrap regex builder.
2. Vernacular / dialectal phonetic spelling variant expansion (pre-standardization).
3. Articulatory consonant-skeleton similarity scorer for dialect/cant/creole matching.
4. Pre-cutoff archival query parameter builders (Chronicling America & Internet Archive).
5. Strict deterministic validator (`verify_certificate`) enforcing `01_AGENTS.md` gates.

Run self-tests:
    python 03_ocr_phonetic_harness.py --self-test
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Sequence, Set, Tuple
from urllib.parse import urlencode

# ============================================================================
# 1. Historical Newsprint OCR Confusion & Vernacular Spelling Tables
# ============================================================================

# Common broken-lead-type & 18th/19th-c. OCR confusions (bidirectional / asymmetric)
OCR_SUBS: Tuple[Tuple[str, str], ...] = (
    ("m", "rn"),
    ("m", "nn"),
    ("rn", "m"),
    ("h", "li"),
    ("h", "b"),
    ("d", "cl"),
    ("cl", "d"),
    ("w", "vv"),
    ("e", "c"),
    ("c", "e"),
    ("i", "l"),
    ("l", "i"),
    ("t", "l"),
    ("u", "n"),
    ("n", "u"),
    ("s", "f"),   # 18th-century long-s (ſ) misread as 'f'
    ("ss", "fs"), # double long-s ligature misread as 'fs'
    ("g", "q"),
    ("o", "a"),
)

# Pre-standardization vernacular & regional phonetic spelling alternations
PHONETIC_SUBS: Tuple[Tuple[str, str], ...] = (
    ("ph", "f"),
    ("f", "ph"),
    ("sh", "sch"),
    ("sh", "s"),
    ("ck", "k"),
    ("c", "k"),
    ("dg", "g"),
    ("j", "g"),
    ("g", "j"),
    ("oo", "ou"),
    ("oo", "u"),
    ("ee", "ea"),
    ("ey", "y"),
    ("ey", "ie"),
    ("y", "ie"),
    ("y", "ey"),
    ("ie", "y"),
    ("in", "ing"),
    ("ing", "in"),
    ("wh", "w"),
    ("z", "s"),
    ("s", "z"),
    ("ll", "l"),
    ("l", "ll"),
    ("dd", "d"),
    ("mm", "m"),
    ("nn", "n"),
    ("gg", "g"),
    ("bb", "b"),
    ("pp", "p"),
    ("tt", "t"),
)

UNSTRESSED_VOWELS = ("a", "e", "i", "o", "u")

VALID_STATUSES: Set[str] = {
    "PRIMARY-SCAN-VERIFIED",
    "CORPUS-TEXT-CANDIDATE",
    "PHONOLOGICAL-HYPOTHESIS",
    "FALSIFIED-MYTH",
    "BASELINE-LITERATURE",
}

REQUIRED_CERT_FIELDS: Tuple[str, ...] = (
    "certificate_id",
    "target_id",
    "headword",
    "epistemic_status",
    "discovery_type",
    "baseline_year",
    "attested_year",
    "attested_spelling",
    "source_publication",
    "source_archive",
    "source_url",
    "verbatim_quote",
    "semantic_sense_match",
    "proper_noun_or_homograph_ruled_out",
    "scan_inspected",
    "masthead_date_verified",
    "ocr_ghost_ruled_out",
    "auditor_notes",
)


# ============================================================================
# 2. OCR & Phonetic Variant Generators
# ============================================================================

def _apply_single_pass_subs(word: str, rules: Sequence[Tuple[str, str]]) -> Set[str]:
    out: Set[str] = set()
    lower = word.lower()
    for src, dst in rules:
        start = 0
        while True:
            idx = lower.find(src, start)
            if idx == -1:
                break
            candidate = lower[:idx] + dst + lower[idx + len(src):]
            if len(candidate) >= 3:
                out.add(candidate)
            start = idx + 1
    return out


def generate_ocr_variants(word: str, max_edits: int = 1, cap: int = 120) -> List[str]:
    """Generate deterministic historical newsprint OCR corruptions of `word`."""
    frontier: Set[str] = {word.lower().strip()}
    visited: Set[str] = set(frontier)
    for _ in range(max_edits):
        nxt: Set[str] = set()
        for item in frontier:
            nxt.update(_apply_single_pass_subs(item, OCR_SUBS))
        nxt -= visited
        visited.update(nxt)
        frontier = nxt
        if len(visited) >= cap:
            break
    return sorted(visited)[:cap]


def generate_phonetic_variants(word: str, cap: int = 120) -> List[str]:
    """Generate plausible 18th/19th-century vernacular phonetic spellings."""
    base = word.lower().strip()
    variants: Set[str] = {base}
    variants.update(_apply_single_pass_subs(base, PHONETIC_SUBS))

    # Internal unstressed schwa vowel substitutions (exclude initial/final char)
    for i in range(1, len(base) - 1):
        ch = base[i]
        if ch in UNSTRESSED_VOWELS:
            for v in UNSTRESSED_VOWELS:
                if v != ch:
                    variants.add(base[:i] + v + base[i + 1:])

    # Singular/plural/participial stem toggles for nouns & verbs
    if base.endswith("s") and len(base) > 4:
        variants.add(base[:-1])
    else:
        variants.add(base + "s")
    if base.endswith("e") and len(base) > 4:
        variants.add(base[:-1] + "ing")
        variants.add(base + "d")

    return sorted(variants)[:cap]


def compile_dirty_ocr_regex(word: str) -> re.Pattern[str]:
    """Compile a regex tolerant of OCR character confusions and column-wrap hyphens."""
    char_classes: Dict[str, str] = {
        "a": "[aou]",
        "b": "[bh]",
        "c": "[ce]",
        "d": "(?:d|cl)",
        "e": "[eco]",
        "f": "[fsſ]",
        "g": "[gq]",
        "h": "(?:h|li|b)",
        "i": "[il1!]",
        "l": "[li1t]",
        "m": "(?:m|rn|nn)",
        "n": "[nu]",
        "o": "[oa0]",
        "r": "[r]",
        "s": "[sfſz]",
        "t": "[tl]",
        "u": "[un]",
        "w": "(?:w|vv)",
        "y": "[yv]",
        "z": "[zs]",
    }
    pieces: List[str] = []
    clean = word.lower().strip()
    for ch in clean:
        if ch == " ":
            pieces.append(r"\s+")
        elif ch == "-":
            pieces.append(r"[-\s]*")
        else:
            pieces.append(char_classes.get(ch, re.escape(ch)))
    # Allow optional column-break hyphen + newline/spaces between internal characters
    joiner = r"(?:-\s*\n\s*|\s*-?\s*)?"
    pattern = r"\b" + joiner.join(pieces) + r"s?\b"
    return re.compile(pattern, re.IGNORECASE)


# ============================================================================
# 3. Articulatory Consonant-Skeleton Scorer (Dialect / Cant / Creole Matrix)
# ============================================================================

# Maps consonants into coarse articulatory place/manner classes for cross-language screening:
# P = labial stop/fricative, T = coronal stop, S = sibilant/affricate,
# K = velar/glottal, N = nasal, L = liquid/rhotic, W = glide
ARTICULATORY_CLASS: Dict[str, str] = {
    "p": "P", "b": "P", "f": "P", "v": "P",
    "t": "T", "d": "T",
    "s": "S", "z": "S", "c": "S", "j": "S",
    "k": "K", "g": "K", "q": "K", "x": "K", "h": "K",
    "m": "N", "n": "N",
    "l": "L", "r": "L",
    "w": "W", "y": "W",
}


def consonant_skeleton(form: str) -> str:
    """Reduce an orthographic form to normalized articulatory consonant classes."""
    s = form.lower().strip()
    # Normalize common digraphs before single-character mapping
    for dg, repl in (
        ("sh", "s"), ("sch", "s"), ("ch", "s"), ("tch", "s"),
        ("ph", "f"), ("th", "t"), ("gh", "k"), ("ck", "k"),
        ("ng", "n"), ("qu", "k"), ("wh", "w"),
    ):
        s = s.replace(dg, repl)
    classes: List[str] = []
    for ch in s:
        cls = ARTICULATORY_CLASS.get(ch)
        if cls and (not classes or classes[-1] != cls):
            classes.append(cls)
    return "".join(classes)


def _levenshtein(a: str, b: str) -> int:
    if a == b:
        return 0
    if not a:
        return len(b)
    if not b:
        return len(a)
    prev = list(range(len(b) + 1))
    for i, ca in enumerate(a, start=1):
        curr = [i]
        for j, cb in enumerate(b, start=1):
            cost = 0 if ca == cb else 1
            curr.append(min(curr[-1] + 1, prev[j] + 1, prev[j - 1] + cost))
        prev = curr
    return prev[-1]


def score_phonological_contact(
    english_headword: str,
    donor_form: str,
    donor_attested_year: Optional[int] = None,
    english_baseline_year: Optional[int] = None,
) -> Dict[str, Any]:
    """Score articulatory & chronological plausibility between an English target and donor form."""
    skel_en = consonant_skeleton(english_headword)
    skel_do = consonant_skeleton(donor_form)
    dist = _levenshtein(skel_en, skel_do)
    max_len = max(len(skel_en), len(skel_do), 1)
    skeleton_similarity = round(1.0 - (dist / max_len), 4)

    chronology_ok = True
    if donor_attested_year is not None and english_baseline_year is not None:
        chronology_ok = donor_attested_year <= english_baseline_year

    return {
        "english_headword": english_headword,
        "donor_form": donor_form,
        "english_skeleton": skel_en,
        "donor_skeleton": skel_do,
        "skeleton_edit_distance": dist,
        "skeleton_similarity": skeleton_similarity,
        "chronology_plausible": chronology_ok,
        "candidate_viable": chronology_ok and skeleton_similarity >= 0.60,
    }


# ============================================================================
# 4. Pre-Cutoff Open Archive Query Constructors
# ============================================================================

def build_chronicling_america_search_url(
    term: str,
    baseline_year: int,
    start_year: int = 1770,
    page: int = 1,
) -> str:
    """Build a Library of Congress Chronicling America search query strictly before `baseline_year`."""
    end_year = max(start_year, baseline_year - 1)
    params = urlencode({
        "proxtext": term,
        "dateFilterType": "yearRange",
        "date1": str(start_year),
        "date2": str(end_year),
        "ortext": "",
        "andtext": "",
        "phrasetext": "",
        " sequence": "",
        "format": "json",
        "page": str(page),
    })
    return f"https://chroniclingamerica.loc.gov/search/pages/results/?{params}"


def build_internet_archive_advanced_query(
    terms: Iterable[str],
    baseline_year: int,
    start_year: int = 1650,
) -> str:
    """Build an Internet Archive full-text query string bounded prior to `baseline_year`."""
    end_year = max(start_year, baseline_year - 1)
    quoted = " OR ".join(f'"{t}"' for t in terms)
    return f"({quoted}) AND mediatype:(texts) AND date:[{start_year}-01-01 TO {end_year}-12-31]"


# ============================================================================
# 5. Deterministic Certificate Verifier (`01_AGENTS.md` Enforcement)
# ============================================================================

def verify_certificate(
    cert: Dict[str, Any],
    targets_by_id: Optional[Dict[str, Dict[str, Any]]] = None,
) -> Tuple[bool, List[str]]:
    """Validate a candidate certificate against `01_AGENTS.md` epistemic gates."""
    errors: List[str] = []

    for field in REQUIRED_CERT_FIELDS:
        if field not in cert:
            errors.append(f"Missing required field: '{field}'")
    if errors:
        return False, errors

    status = cert["epistemic_status"]
    if status not in VALID_STATUSES:
        errors.append(f"Invalid epistemic_status '{status}'. Must be in {sorted(VALID_STATUSES)}.")

    baseline_year = cert["baseline_year"]
    attested_year = cert["attested_year"]
    if not isinstance(baseline_year, int) or not isinstance(attested_year, int):
        errors.append("baseline_year and attested_year must be integers.")
        return False, errors

    if targets_by_id and cert["target_id"] in targets_by_id:
        canonical_target = targets_by_id[cert["target_id"]]
        if canonical_target["headword"].lower() != str(cert["headword"]).lower():
            errors.append(
                f"Headword mismatch for {cert['target_id']}: "
                f"expected '{canonical_target['headword']}', got '{cert['headword']}'."
            )

    quote = str(cert.get("verbatim_quote", "")).strip()
    if status in {"CORPUS-TEXT-CANDIDATE", "PRIMARY-SCAN-VERIFIED"}:
        if len(quote) < 60:
            errors.append("verbatim_quote must be >= 60 chars to verify surrounding semantic context.")
        spelling = str(cert.get("attested_spelling", "")).strip().lower()
        # Normalize hyphenated line breaks when checking quote presence
        normalized_quote = re.sub(r"-\s+", "", quote.lower())
        normalized_spelling = re.sub(r"-\s*", "", spelling)
        if not spelling or normalized_spelling not in normalized_quote:
            errors.append(
                f"attested_spelling '{spelling}' does not appear verbatim inside verbatim_quote."
            )

    # Strict gate for PRIMARY-SCAN-VERIFIED
    if status == "PRIMARY-SCAN-VERIFIED":
        if cert.get("discovery_type") == "antedating" and not (attested_year < baseline_year):
            errors.append(
                f"Antedating requires attested_year ({attested_year}) < baseline_year ({baseline_year})."
            )
        if cert.get("semantic_sense_match") is not True:
            errors.append("PRIMARY-SCAN-VERIFIED requires semantic_sense_match == True.")
        if cert.get("proper_noun_or_homograph_ruled_out") is not True:
            errors.append("PRIMARY-SCAN-VERIFIED requires proper_noun_or_homograph_ruled_out == True.")
        if cert.get("scan_inspected") is not True:
            errors.append("PRIMARY-SCAN-VERIFIED requires scan_inspected == True.")
        if not str(cert.get("scan_evidence_filename") or "").strip():
            errors.append("PRIMARY-SCAN-VERIFIED requires non-empty scan_evidence_filename in evidence_scans/.")
        if cert.get("masthead_date_verified") is not True:
            errors.append(
                "PRIMARY-SCAN-VERIFIED requires masthead_date_verified == True (bound-serial misdating check)."
            )
        if cert.get("ocr_ghost_ruled_out") is not True:
            errors.append("PRIMARY-SCAN-VERIFIED requires ocr_ghost_ruled_out == True.")

    return len(errors) == 0, errors


# ============================================================================
# 6. Self-Test Suite & CLI Entry Point
# ============================================================================

def _run_self_tests() -> int:
    # 1. OCR variants catch classic broken lead type ('rn' <-> 'm', 'li' <-> 'h', long-s 'f')
    ocr_vars = generate_ocr_variants("shenanigan", max_edits=1)
    assert "slienanigan" in ocr_vars, "Expected 'h' -> 'li' OCR variant"
    rx = compile_dirty_ocr_regex("shenanigans")
    assert rx.search("full of slie-\n  nanigans and tricks"), "Regex must match dirty OCR + column wrap"

    # 2. Phonetic contact scorer aligns Irish 'fáinne' / cant 'fawney' with 'phoney'
    contact = score_phonological_contact("phoney", "fawney", 1781, 1893)
    assert contact["english_skeleton"] == "PNW" and contact["donor_skeleton"] == "PWNW"
    assert contact["candidate_viable"] is True

    # 3. Certificate verifier blocks unverified promotion to PRIMARY-SCAN-VERIFIED
    bad_cert = {
        "certificate_id": "CERT-TEST-001",
        "target_id": "TGT-001",
        "headword": "shenanigans",
        "epistemic_status": "PRIMARY-SCAN-VERIFIED",
        "discovery_type": "antedating",
        "baseline_year": 1855,
        "attested_year": 1848,
        "attested_spelling": "shenanigan",
        "source_publication": "Test Gazette",
        "source_archive": "Internet Archive",
        "source_url": "https://archive.org",
        "verbatim_quote": "This rascal tried every shenanigan known along the Sacramento wharf that autumn.",
        "semantic_sense_match": True,
        "proper_noun_or_homograph_ruled_out": True,
        "scan_inspected": True,
        "scan_evidence_filename": "evidence_scans/test_1848.png",
        "masthead_date_verified": False,  # Must trigger serial-misdating rejection!
        "ocr_ghost_ruled_out": True,
        "auditor_notes": "Synthetic self-test.",
    }
    ok, errs = verify_certificate(bad_cert)
    assert not ok and any("masthead_date_verified" in e for e in errs), "Must reject unverified masthead"

    # 4. Valid promotion passes cleanly
    good_cert = dict(bad_cert, masthead_date_verified=True)
    ok_good, errs_good = verify_certificate(good_cert)
    assert ok_good and not errs_good, f"Expected valid certificate, got {errs_good}"

    print("ALL_SELF_TESTS_PASSED (OCR regex, phonetic skeleton, masthead anti-poisoning gate)")
    return 0


def main(argv: Optional[Sequence[str]] = None) -> int:
    parser = argparse.ArgumentParser(description="Etymology Lab OCR/Phonetic & Verification Harness")
    parser.add_argument("--self-test", action="store_true", help="Run deterministic unit self-tests")
    parser.add_argument("--variants", type=str, help="Print OCR + phonetic variants for a headword")
    parser.add_argument("--verify", type=str, help="Validate a certificates JSON file")
    parser.add_argument("--targets", type=str, default="02_target_board.json", help="Path to target board JSON")
    args = parser.parse_args(argv)

    if args.self_test:
        return _run_self_tests()

    if args.variants:
        print(json.dumps({
            "headword": args.variants,
            "ocr_variants": generate_ocr_variants(args.variants),
            "phonetic_variants": generate_phonetic_variants(args.variants),
            "dirty_ocr_regex": compile_dirty_ocr_regex(args.variants).pattern,
        }, indent=2))
        return 0

    if args.verify:
        targets_map: Dict[str, Dict[str, Any]] = {}
        tpath = Path(args.targets)
        if tpath.exists():
            tdata = json.loads(tpath.read_text(encoding="utf-8"))
            targets_map = {t["target_id"]: t for t in tdata.get("targets", [])}
        certs = json.loads(Path(args.verify).read_text(encoding="utf-8"))
        if isinstance(certs, dict):
            certs = certs.get("certificates", [certs])
        failures = 0
        for c in certs:
            ok, errs = verify_certificate(c, targets_map)
            if not ok:
                failures += 1
                print(f"[FAIL] {c.get('certificate_id')}: {errs}", file=sys.stderr)
        if failures:
            return 1
        print(f"ALL_CERTIFICATES_VALID ({len(certs)} checked)")
        return 0

    parser.print_help()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
