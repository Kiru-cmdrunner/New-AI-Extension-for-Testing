# Dropdown why-line dead path — definition metadata gap (found MS-U1 round 2)

> **STATUS: RESOLVED 2026-08-26 by 7.4-B2.** `src/definitions/dropdown.ts`
> buildResult now writes `metadata.selectionConfirmed = true` on the
> containment-proven completion path (see the S2b gate in
> `src/generation/ir-bridge.ts` — INPUT-triggered Dropdowns emit two CLICK
> IR steps instead of a non-replayable SELECT). Real-Chrome E2E evidence:
> `.drytis/notes/evidence/phase-7-4-b2-e2e-2026-08-26/` (Flow D metadata dump
> shows `selectionConfirmed: true`). The rest of this note is the original
> finding, preserved for history.

Found during MS-U1 real-Chrome testing (2026-08-22). Renderer-only milestone could
not fix it; recorded for the definitions backlog.

## Finding
`src/definitions/dropdown.ts` buildResult (lines ~255-285) NEVER writes
`selectionConfirmed: true` into metadata:
- Confirmed path: copies `selectedValue`, `noOpSelection`, `targetName` only.
- Parked path (S3' unproven): writes `provisionalSelection: <pending.name>` and
  `selectionConfirmed: false`.

Consequence: the MS-U1 side panel why-line variants
`why: provisional: X → final: Y` and `why: selection confirmed`
(buildWhyBlock in src/sidepanel/understanding-badge.ts) are structurally
unproducible from real recordings — no flow can ever produce them. Renderer
honestly renders nothing (null path).

Verified flows (real Chrome, round 2):
- native <select> keyboard selection (Enter→ArrowDown×2→Enter): metadata =
  {selectedValue, noOpSelection:false, captureOrigin, targetName} — no keys.
- containment-proven ARIA combobox (aria-haspopup=listbox + role=option click):
  Dropdown completed, metadata = same shape — no keys.
- typeahead option click now captures as Unclassified (containment rule) — no
  Dropdown card at all.

## Fix direction (engine-side, needs owner gate)
Confirmed dropdown completion should write `selectionConfirmed: true` (and keep
`provisionalSelection` when a pending option click preceded confirmation). Then
the renderer why-line lights up with zero panel changes. Unit pins in
tests/sidepanel/understanding-badge.test.ts already cover the renderer logic
against synthetic metadata.

Related observation (same run, engine-side, out of MS-U1 scope): the typeahead
option click regressed from Dropdown (earlier runs) to Unclassified — containment
proof change; worth a look in the definitions backlog.
