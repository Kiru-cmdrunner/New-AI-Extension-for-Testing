# Spec — Structural (no-timing) fixes for AdaniOne custom-control capture

Supersedes the S1/S3 timing proposals in `.drytis/notes/rca-adanione-custom-controls-2026-08-20.md`.
No elapsed-time constants, no trigger-recency windows, no settle delays. All rules are
event-sequence facts (browser `captureSeq` ordering) or DOM-state facts (attributes/ancestry).

## S2 — icon-class naming tier (display-only)
- `src/definitions/patterns.ts`: extend `bestName()` with an optional `iconClassName` param and a
  new `iconNameFromClasses()` helper. Derive human names (`icon-plus` → "plus icon") from the same
  icon-class token families already recognized by `extractIconName` in component-detector.ts
  (fa-/mdi-/bi-/material icon- tokens), only when accessibleName/ariaLabel/placeholder are empty.
- `src/definitions/click.ts` (priority-180 fallback only): pass `ctx.trigger.className`.
- `src/enrichment/meaning-resolver.ts`: when `targetName` resolves to 'element' or an icon-derived
  name on an icon-only target, prefer `componentData.iconName` when present.
- No other definitions change. No wire shape change (string content only).

## S1' — projection pairing of physical press→release (structural)
- `src/runtime/projection-engine.ts`: before projection, group entries with disposition
  unclaimed/pending by `pageId`; within a page group, a `mousedown` entry immediately followed in
  `captureSeq` order by a `click` entry on the **same elementKey** (D1 targetIdentity when present,
  else diagnostic identity) is one physical act — project a single Unclassified card using the
  `click` entry, with metadata `physicalEvents: ['mousedown','click']` and `pairedAtProjection: true`.
- Adjacency is strict (no intervening discrete entry) and identity must match; otherwise unchanged.
- `contextmenu`, `keydown`, `dragstart`, `drop` never pair (different physical acts).
- Ledger dispositions are NOT rewritten; only projected output changes. IR untouched.

## S3' — dropdown completion containment gating (structural)
- `src/definitions/dropdown.ts` `handleEvent`:
  1. Calendar-cell completion candidates are hard-excluded (`isCalendarCell`) — they belong to the
     DatePicker definition.
  2. An option-role/class click **with containment proof** (semantic-child ancestry per
     lifecycleOwnsTarget contract: `ctx.data.surfaceRole` present in `ancestorRoles`, or a
     dropdown-surface class that is not a calendar surface) completes.
  3. An option-role/class click **without** containment proof does NOT complete; sets
     `ctx.data.pendingOptionClick = { eventId, name }` and returns null. The lifecycle ends
     `abandoned` (rendered displaced) at the **next different-target discrete event** via
     `shouldCancelOnOutside` (event-sequence boundary, not elapsed time).
  4. On abandoned buildResult, if `pendingOptionClick` exists and no containment was proven,
     metadata gains `selectionConfirmed: false`, `provisionalSelection: <name>`.
  4b. Native `<select>` `change` completion (trigger tag SELECT) unchanged.
- No runtime changes; no `shouldCancelOnOutside: false` flip (C5.2 portal safety preserved);
  no MAX_LIFECYCLE changes; no INV-C1 changes.

## Acceptance criteria
- [ ] Unit: S2 — `icon-plus` on an `<i>` with no name → targetName "plus icon", meaning `Click "plus icon"`;
      `fa-plus` → "add icon" via ICON_SEMANTIC_NAMES; named elements never regress to icon naming.
- [ ] Unit: S1' — adjacent mousedown+click same elementKey → ONE Unclassified card with
      physicalEvents ['mousedown','click']; non-adjacent stays 2 cards; different element stays 2;
      contextmenu/keydown never paired.
- [ ] Unit: S3' — open custom dropdown, later click calendar cell → lifecycle does NOT complete
      with date as selection; ends abandoned with selectionConfirmed:false; OXD role=option within
      surface completes unchanged; native SELECT change completes unchanged.
- [ ] Full vitest suite green; existing OXD/react-select tests unchanged-passing.
- [ ] Real-Chrome: R3 43/43; AdaniOne clone 30/30; a-slice 35/35; Amazon 8/8; CP8 probe 4/4;
      native select record+replay OK; PaxAndClass sequence proof passes (Round Trip → +Adult →
      +Children → Premium Economy → Done captured at actual interactions in order).
