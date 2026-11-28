# Case 3200 Blind Adversarial Red-Team Audit Report: snollygoster (TGT-034)

- **Run ID**: `RUN-3200-snollygoster` (Block 3200)
- **Proposer Agent**: `gemini-proposer-3200` (4 non-overlapping discovery shards, 59 candidate citations)
- **Red-Team Lock Holder**: `gemini-redteam-3200` (3 blind-first adversarial audit shards: RT-1 `CERT-3200-101..205`, RT-2 `CERT-3200-206..309`, RT-3 `CERT-3200-310..414`)
- **Final Ledger Breakdown**: 59 validated Schema v3.0 citations (`25` attestations, `13` contextual_evidence, `12` hypotheses, `9` rejected_lead; `58` `agent_verified`, `1` `externally_recognized`) and `55` R2-hosted pre-1931 composite WebP proof scans (`12` rebuilt and upgraded during Red-Team visual audit).

## 1. Blind-First Audit Protocol & Major Red-Team Catches

All three Red-Team shards queried `get_target_brief(slug_or_id="snollygoster", blind_audit=true)` first, visually inspecting every pre-1931 R2 WebP plate and original archive masthead/imprint before reading Pass 1 prose conclusions:

1. **Trap A Serial Fascicle & Edition Imprint Calibrations**:
   - **`CERT-3200-307` (*Dialect Notes* Vol. I, Part VII, p. 331)**: Calibrated `publication_year` and `masthead_year` from collective bound-volume `1896` back to original fascicle **`1894`** (`this year (1894)` on p. 309; Sept. 1, 1894 notice on p. 344), restored author Francis Bazley Lee (`"Jerseyisms"`), and uploaded a corrective composite WebP.
   - **`CERT-3200-310` (Wright, *English Dialect Dictionary* Vol. V)**: Caught that leaf `n6` on the cited Internet Archive volume (`englishdialectdi05wrig`) carries the `1905` Henry Frowde title imprint (`[1st issue 1904; cat. 1898]`), patched `publication_year`/`masthead_year` to `1905`, and uploaded a corrective WebP.
   - **Newspaper Masthead Volume/Issue & Broadsheet Column Fixes**: Patched `CERT-3200-103` (*Port Tobacco Times* `p. 4, col. 1`), `CERT-3200-104` (*Burlington Free Press* `Vol. XIX, No. 23, p. 1, col. 1`), `CERT-3200-105` (*Scientific American* `p. 1, col. 4`), `CERT-3200-107` (*Southern Journal* `Vol. VI, No. 28, p. 1, col. 5`), `CERT-3200-109` (*Mississippi Democrat* `Vol. II, No. 42, p. 2, col. 2`), `CERT-3200-110` (*Georgia Telegraph* `p. 1, col. 4`), `CERT-3200-111` (*Hillsdale Whig Standard* `p. 4, col. 1`), `CERT-3200-113` (*Tri-Weekly Times* `Vol. I, No. 5`), `CERT-3200-203` (*Pennsylvania Daily Telegraph* `p. 2, col. 4`), `CERT-3200-204` (Emmett *Black Brigade* engraved `Plate 5560`), `CERT-3200-207` (*Huntingdon Journal* `Vol. 48, No. 9`), `CERT-3200-208` (*Morning Appeal* `Vol. 11, No. 17`), `CERT-3200-216` (*Evening Star* `p. A-1, col. 7`), `CERT-3200-302` (Grose 1787 `sig. E4v` & `*K3r`), `CERT-3200-401` (*Forest and Stream* unnumbered front page `[p. 703], col. 3`), `CERT-3200-409` (Lambert 1924 `p. 137, col. 2`), `CERT-3200-412` (*Utahnian* `[p. 3], col. 2`), and `CERT-3200-413` (WPA *Maryland Guide* p. 7 permalink leaf `n38`).
2. **Trap B Scan-Crop & Diplomatic Paleography Fixes**:
   - **`CERT-3200-303` (Carr 1828 *Dialect of Craven*)**: Replaced Pass 1's mis-cropped R2 WebP (which boxed `GAUMLESS / GAUP` four lines above `GAUSTERING`) with a verified crop centered on `GAUSTERING, Imperious, boasting.`
   - **`CERT-3200-403` (*Judge*, Feb. 15, 1890)**: Caught Pass 1's raw OCR title `'An Indianianoil'` and false `'Buffalo Express'` credit (from an unrelated squib below), patching to exact printed ink `'AN INDIANA HYMN.'` credited `'—Chicago Mail.'`
   - **`CERT-3200-410` & `CERT-3200-411` (Meyer 1880 & Kluge 1899 German Fraktur)**: Fixed Fraktur long-s `Schnipsel` (misread as `Schnipfel`) in Meyer 1880 and replaced paraphrased gloss text in Kluge 1899 `schniegeln` with exact diplomatic Fraktur transcription; stripped editorial `[0x ...]` counts from `attested_form` across `CERT-3200-406`..`411`.
