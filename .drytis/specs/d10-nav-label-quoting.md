# D10 (audit D11) — Navigation Label Double-Quoting

## Defect

**Audit reference:** `.drytis/notes/cp1-cp8-product-audit-2026-08-17.md` line 22 —
"D11 cosmetic: synthetic nav labels double-quoted (`Navigate to ""Title""`)."
(Numbering note: the audit's series has no "D10"; the nav-label quoting defect is
D11 there. The historical M9 "D10" (WorkflowEffects) was already fixed in d6dcb83.
This task is the nav-label quoting defect.)

**Symptom:** a Navigation interaction whose page title contains `"` characters is
rendered with nested/broken quotes, e.g. title `Results for "q"` produces
`Navigate to "Results for "q""` — visually double-quoted and ambiguous. If a title
arrives pre-wrapped in quotes (`"Dashboard"`), the template produces
`Navigate to ""Dashboard""`.

## Root Cause

Navigation labels are built with a naive template in two places:

1. `src/enrichment/meaning-resolver.ts:176-181` — `businessMeaning`
   (primary label, set by `enrichInteraction` in the onEmit path).
2. `src/sidepanel/interaction-renderer.ts:152-157` — fallback label when
   `businessMeaning` is absent.

Both do:

```ts
const title = String(metadata.pageTitle ?? '');
if (title) return `Navigate to "${title}"`;
```

`metadata.pageTitle` comes — raw and unsanitized — from:

- `src/tap/event-tap.ts:154` and `:344` — `document.title` (SPA nav + DOM events).
- `src/background/service-worker.ts:1133→1191` — `chrome.tabs.get().title`
  (full-page navigation synthetic events).

Nothing between the title source and the label template normalizes quotes. Any
title containing `"` breaks the visual quoting; a title stored pre-wrapped in
quotes double-wraps.

**Verified-correct boundary (do not change):** the URL fallback
(`Navigate to ${url}` when title empty) is unquoted and fine. The D7.5
synthetic-nav label-invariance logic (api-operation evidence skipping) is
untouched by this fix. Raw persisted data stays untouched — this is a
presentation-layer label fix only.

## Fix (smallest safe change)

One shared, pure, deterministic helper:

`src/enrichment/quote-safe.ts` (NEW — ~20 lines):

```ts
/** Strip wrapping quotes, then replace inner double-quotes with single
 *  quotes so a title can never break the label's visual quoting. */
export function quoteSafeTitle(raw: string): string
```

- Trims whitespace.
- If the string both starts and ends with `"` (a fully-wrapped quoted string),
  strips exactly that outer pair (repeat while true — handles `"x"`, `""x""`).
- Replaces remaining inner `"` with `'`.
- No other transformation (case, spacing, content preserved — evidence-derived
  labels stay truthful; nothing invented).

Both Navigation label sites consume the helper:

- meaning-resolver.ts Navigation case:
  `const title = quoteSafeTitle(String(metadata.pageTitle ?? ''))`
- interaction-renderer.ts Navigation case: same.

All other label cases (Click/TextEntry/…) are out of scope — the audit defect is
nav labels only.

## Files

| File | Change |
|---|---|
| `src/enrichment/quote-safe.ts` | NEW — quote-safe title normalizer |
| `src/enrichment/meaning-resolver.ts` | Navigation case uses helper |
| `src/sidepanel/interaction-renderer.ts` | Navigation fallback uses helper |
| `tests/enrichment/quote-safe.test.ts` | NEW — helper unit tests |
| `tests/enrichment/d10-nav-label-quoting.test.ts` | NEW — resolver regression (red phase) |
| `tests/sidepanel/d10-nav-label-quoting.test.ts` | NEW — renderer regression via JSDOM harness |

## Acceptance Criteria

- [ ] `quoteSafeTitle('Results for "q"')` → `Results for 'q'`
- [ ] `quoteSafeTitle('"Dashboard"')` → `Dashboard` (no double-wrap)
- [ ] `quoteSafeTitle('""Title""')` → `Title`
- [ ] `quoteSafeTitle('Plain Title')` → unchanged
- [ ] `quoteSafeTitle('')` → `''` (URL fallback still taken downstream)
- [ ] `quoteSafeTitle('  Trimmed  ')` → `Trimmed`
- [ ] resolveMeaning Navigation: quoted title renders `Navigate to "Results for 'q'"`
- [ ] resolveMeaning Navigation: pre-wrapped title renders `Navigate to "Dashboard"`
- [ ] resolveMeaning Navigation: plain title unchanged `Navigate to "Your Cart"`
- [ ] resolveMeaning Navigation: empty title still URL fallback (unquoted)
- [ ] sidepanel fallbackActionDescription Navigation: same three behaviors
- [ ] Side panel rendered DOM (`interaction-action-text`) shows quote-safe label
- [ ] Existing breadcrumb test (`Navigate to Home via breadcrumb`) untouched & green
- [ ] No other label cases modified; no persisted-data format changes
- [ ] tsc --noEmit exit 0; full suite green; build v10.9.0 unchanged size class
- [ ] Real-Chrome: page with quoted `<title>` renders single-quoted label in panel

## Tests

Unit (new `tests/enrichment/quote-safe.test.ts`) — helper behaviors above.

Regression (new `tests/enrichment/d10-nav-label-quoting.test.ts`) —
resolveMeaning with Navigation interactions carrying quoted / pre-wrapped /
plain / empty pageTitle; asserts exact label strings. Red phase: the quoted and
pre-wrapped cases fail against current code (`Navigate to "Results for "q""`).

Renderer (new `tests/sidepanel/d10-nav-label-quoting.test.ts`) — JSDOM harness
(reuse D4 pattern: real index.html, domInitialized, chrome stubs), build a
Navigation ComponentInteraction with quoted title, run `renderInteractions`,
assert the `.interaction-action-text` textContent is quote-safe.

## Real-Chrome Validation Plan

Replica (`/tmp/d10-val/server.mjs`, port 8098): copy d2d3 replica; change
search page title to `Search "Bazaar"` (contains quotes) and add one page whose
`<title>` is pre-wrapped (`"Cart"`). Harness (`/tmp/d10-val/harness.mjs`): the
proven D9/D2-D3 CDP recipe (pinned Chrome 148, persistent terminal, panel-page
routing, two-tab dance, storage readback). Assert:

1. Recorded Navigation interaction titles containing `"` produce panel labels
   with single quotes inside one visual quote pair.
2. No label anywhere in the Observed Workflow section contains `""`.
3. Pre-wrapped-title page label has no doubled quotes.
4. Plain-title label unchanged from pre-fix behavior.
5. URL-fallback label (empty title) still unquoted.
6. Zero console errors in the app tab and SW.

## Scope Exclusions

E1, executor-content-script defect, preview-URL defect, D2/D3/D8/D9/D4/D5/D6
surfaces, healing, intent-labeler, capture/status-enrichment logic (F1), raw
persisted data formats. 3 E1-prep files stay untouched.
