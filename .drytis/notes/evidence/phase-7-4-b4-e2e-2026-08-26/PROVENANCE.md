# 7.4-B4 E2E Provenance — Unclassified Output Policy (D2 DROP)

Date: 2026-08-26 (~03:30 UTC)
Spec: `.drytis/specs/phase-7-4-b4-unclassified-output-policy.md`
Harness: `.drytis/notes/evidence/phase-7-4-b3-e2e-2026-08-25/harness-74b3.mjs`
(real Chrome 148 via CDP, fixtures on 127.0.0.1:8244, extension loaded
unpacked from /workspace/dist)
Run output: `b4-full/` (this directory)

## Build under test

- ZIP v10.9.0 — 40 files, 304,895 B
- md5 `fabec45419834c511d65300b7c6a91eb`
- Four-way identical: root, download/, serve-download-root/download/,
  serve/download/ — plus the live preview download URL (HTTP 200).

## X3 truth — what changed in shipped bytes

The B4 source diff (adapter dead-path removal + bridge comments) is
tree-shaken from the shipped bundle as predicted, EXCEPT one comment line
that IS bundled (ir-bridge's `// fallback` → the D2 annotation — comments
survive minification in this esbuild config only where they attach to
kept statements in non-minified regions).

Semantic bundle diff vs the B3 closure build:
`diff` of `assets/service-worker-inline.js` (both archived here as
`sw-bundle-PRE-b4.js` md5 d4a67bda7bdb84edc02d43bf574e0be8 and
`sw-bundle-POST-b4.js` md5 7a831a56a10273f886d91572133c8427) =
**exactly one line**: the comment. No behavioral byte changed.

ZIP md5 changed (b702ac44… → fabec454…) solely from the rebuild mtime +
that comment.

## Results — 14 PASS / 0 FAIL

Identical composition to the B3 closure run (16 cards; Repeat Me folded
members=[click,click,mousedown]; one paired BODY card; census
unclassifiedTotal 14 = 10 gate-rejected + 1 body-structural + 3
evidence-consequential; 0 dedup-resurrected; C3 dismissal hasEv:true
flag:true; E1 zero console errors).

## R1 — IR plan byte-identity legs

1. **Census flow** (same flow, same harness, B3-closure vs B4):
   `execution_ir_plan` from `censusflow-storage.json` is **IDENTICAL
   after volatile-id normalization** (per-run page tokens in evt ids,
   uuid elementIds, tc-hashes). Steps: [click, click]. Zero
   Unclassified-sourced steps.
2. **Combobox flow**: the B4 run's b2flow plan (fill/click/fill/fill/click)
   matches the B2-milestone plan for the same sub-flows; literal input
   text differs because the b3 harness types 'hotels' where the b2 harness
   typed 'query', and the b2 harness additionally exercised the status
   combobox + datalist flows the b3 regression flow does not include.
   These are harness-flow differences, not code differences.
   NOTE (reviewer round-2): the B3 CLOSURE run's own `b3-ir-plan.json` is
   an anomalous dump — it captured the STALE census-flow plan
   ([click,click], startUrl census-validation.html) because the dump
   fired before the combobox-flow plan regenerate landed, and that run's
   b2flow cards carry 6 stray mouseenter Hovers absent from all six other
   B3-family runs. Do not read the closure dump's plan as the combobox
   baseline; the majority baseline (final3 + 5 other runs) matches B4
   exactly.
3. Zero `select` steps anywhere (B2 parity held through B4).

## Verdict

B4 changed no IR-plan output for any recorded flow; the Unclassified DROP
policy is now the single documented policy across adapter (dead path),
bridge (live path), both test surfaces, and the engineering handover.
