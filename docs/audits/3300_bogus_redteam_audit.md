# Case 3300 Blind Pass 2 Adversarial Red-Team Audit Report: `bogus` (`TGT-004`, `RUN-3300-bogus`)

- **Target & Run**: `bogus` (`TGT-004`, `RUN-3300-bogus`, Block `3300`)
- **Proposer Agent**: `gemini-proposer-3300` (4 non-overlapping discovery shards `3300-A`..`3300-D`)
- **Single-Reviewer Red-Team Lock Holder**: `gemini-redteam-3300` (4 blind Red-Team batches `RT1`..`RT4`, `<= 18` records/batch, executing `get_target_brief(blind_audit=true)` prior to unblinded comparison)
- **Final Ledger Breakdown**: **70** `agent_verified` records (`31` `attestation`, `20` `contextual_evidence`, `6` `hypothesis`, `13` `rejected_lead`), **67** pre-1931 R2 WebP proof scans (**20** rebuilt during Red-Team audit to eliminate edge clipping or secondary-edition title panels), **3** post-1930 external-link records (`CERT-3300-201`, `309`, `412`), **10** SHA-256 claims (`9` principal).

## Major Blind Red-Team Interventions & Trap A–D Catches

1. **Trap C Reclassification of `CERT-3300-104` (`1825-02-19`, *The Microscope*, New Albany, IN)**:
   - Blind 3918x6256 microfilm paleography confirmed authentic `B-o-g-u-s` lead type in both roman and italic fonts (`Enter Bogus, as Sharp as a razor`), passing Trap B, but reclassified the record from `attestation` to `contextual_evidence` (`record_subtype: "onomastic_precursor"`) because `Bogus` functions solely as a capitalized stage sobriquet for KY Attorney General Solomon P. Sharp alongside `Mungril` and `Tipstaff Payall`.
2. **Trap A Imprint, Edition, and Folio Corrections Across Shards A–D**:
   - **`CERT-3300-106`** (July 14, 1827 *Gospel Advocate*): Corrected imprint city from `Buffalo, NY` to **`Auburn, NY`** and printed folio from `p. 222` to **`p. 224`**, rebuilding unclipped WebP.
   - **`CERT-3300-114`** (1839 C. M. Kirkland *A New Home* 1st ed.): Corrected `ch. XXXI, p. 203` to printed **`ch. XXXII, p. 212`** (`leaf n212`), rebuilding WebP.
   - **`CERT-3300-206`** (1798 Stephen Burroughs *Memoirs*): Documented printed misnumbered header **`[ 115 ]`** for `p. 105` on `leaf n112` and restored diplomatic medial long-s (`ſtate`, `Maſſachuſetts`, `paſſing`, `ſuch`).
   - **`CERT-3300-211`** (June 15, 1837 *Plainfield Union*): Identified printed col. 5 exchange credit **`From the Ohio Observer. / THE BOGUS BOX.`**, anchoring the swindle to Hudson, Portage County, OH three weeks before `CERT-3300-110`.
   - **`CERT-3300-212`** (June 1842 U.S. Mint *Manual* p. 169): Caught later-edition text contamination (`in the middle and western states, however`), restoring 1842 1st-edition ink (`but in the Southern and Western States`) and rebuilding unclipped WebP.
   - **`CERT-3300-218`** (1872 Burnham *Secret Service Memoirs*): Corrected single-page `'p. viii'` attribution to printed Glossary **`pp. vi–viii`** (`leaves n20–n22`) and rebuilt unclipped WebP.
   - **`CERT-3300-311`, `313`, `314`, `317`**: Rebuilt 4 Shard C WebP plates to replace undated Preface/half-title crops with true dated title pages (`1785` Grose `leaf n0`, `1811` *Lexicon Balatronicum* C. Chappel title, `1867` Lowell *Biglow Papers* `leaf n9` + unclipped `Bogus`/`bagasse` text crop) and calibrated OED `bogus, n.2`'s undated Bartlett reference on `314`.
   - **`CERT-3300-402`, `403`, `404`, `406`, `408`, `410`, `411`, `413`, `414`, `415`, `416`, `417`**: Corrected *Hodges' Journal* (Jan. 2, 1860) from hallucinated `p. 52` to printed **`p. 2, col. 2`**, *Musical Courier* (Sept. 4, 1889) from `p. 216` to **`p. 215`**, *New-York Times* (Feb. 26, 1893 `bogosity`) from `p. 17` (`leaf n16`) to **`p. 18, col. 2` (`leaf n17`)**, *Historical Magazine* (July 1857) signatory from `'MANHATTAN'` to **`'R. T. (1)'`**, swapped UC's 1859 *New American Cyclopaedia* reprint for NYPL's true **`1858`** printing (`newamericancycl03riplgoog`) on `415`, and rebuilt 8 Shard D WebP plates.
