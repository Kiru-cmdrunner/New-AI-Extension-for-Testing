# RCA — Full-Audit Residual Gaps @ 350af71 (2026-08-20, read-only)

## G1 — Dialog capture dead at runtime (GENUINE PRODUCT GAP)

**Finding recap:** R3 exercised real `alert()` and `confirm()`; zero dialog data reached any
interaction, IR step, assertion, or codegen.

**Root cause (git-verified, single-event):** commit `b4222a6` "feat(M7): Wire Component
Runtime into service worker + manifest update" (2026-07-26) replaced the manifest content
script `src/recorder/deterministic-recorder.ts` → `src/recorder/phase5/recorder-entry.ts`
and the dialog-capture system was never ported. Full orphan inventory at HEAD:
- `deterministic-recorder.ts` has ZERO importers; not in manifest, not in dist bundle.
- The page-world wrapper installer (alert/confirm/prompt/window.open → `data-cmdrunner-dialog`
  / `data-cmdrunner-window-open` attributes, deterministic-recorder.ts:195-240) — dead.
- `readPageWorldSignals()` (deterministic-recorder.ts:245+) — dead.
- `triggeredDialog/dialogMessage/dialogResult` fields on `DomContext` (recorded-event.ts:63-65):
  no reader anywhere in runtime/, sidepanel/, repository/ (grep = 0 hits).
- Even the `RECORDED_EVENT` message type is unhandled in the SW (only defined in types.ts:547) —
  dead at BOTH ends.
- The SW-side `DomContext` type (component-types.ts) has NO dialog fields at all — the
  Component Runtime never had a dialog concept.

**Scope of loss:** alert/confirm/prompt evidence, window.open evidence. NOT modal/div dialogs
in general — DOM-based dialogs (`role=dialog`, overlays, `#attach-popover` visibility changes)
are captured by the live DOMObserver/evidence-collector path (dialog-evidence-rca note:
`newSurfaces=[div role=dialog]`, `visibilityChanges` proven lossless when in-window; only the
+400-900ms-late Amazon case exceeds the window — a separate, documented capture-timing issue).

**Smallest safe fix (3 layers, all additive):**
1. Port the page-world installer (~45 lines) into the LIVE entry path — as a second
   MAIN-world content script in manifest.json (like `public/assets/network-inject.js`) so
   it survives independently; no coupling to event-tap.
2. `event-tap.ts` `assembleObservedEvent` / `dom-context-extractor.ts`: after a `click`,
   read-and-clear the `data-cmdrunner-dialog` attribute (settle at setTimeout(0), same
   pattern the old recorder used) and stamp onto `ObservedEvent` (add optional
   `triggeredDialog/dialogMessage/dialogResult` to component-types DomContext).
3. Wire consumption: (a) projection metadata or a new Dialog definition → interaction; OR
   minimal: surface in ComponentInteraction.metadata + panel evidence card. Defer IR/assertion
   derivation — `presence` of dialog region is only meaningful with the surface evidence that
   already exists.
**Risk:** low — attribute-based, fire-and-forget, isTrusted already enforced; CSP degrade is
silent (same as old code).

## G2 — `data-sku`-only entities derive no assertion (GENUINE PRODUCT GAP, conservative gap)

**Finding recap:** `li[data-sku="SKU-WAR"]` captured as entity kind with
`attrs={data-sku:SKU-WAR}` but NO assertion derived.

**Root cause (code-traced, assertion-derivation.ts:455-470 + page-content-config.ts:88-93):**
the GENERIC entity selector `[data-product-id], [data-item-id], [data-sku]` declares
`idAttribute: 'data-product-id'`. For a `data-sku`-only element:
`entityId = getAttribute('data-product-id') = null` → `identityAttributeSelector()` requires
`item.entityId` → null → `decideLocator` entity branch falls to `#id`-from-domPath → none
(li has no id) → `tier 'none'` → **skipped** (the Defect-2c wrong-element guard correctly
refuses vacuous ancestor-#id; the skip itself is the SAFE behavior — no false assertion was
made, the entity is just SILENTLY unasserted).

The comment in dedupeEntities ("e.g. the legacy entry (idAttribute data-product-id → entityId
null on data-sku-only rows)") shows the authors KNEW about this class; the co-occurrence
entry `[data-auto-id][data-sku]` (idAttribute data-sku) covers the AdaniOne convention, and
`data-asin` covers Amazon. Uncovered: plain `data-sku` / `data-item-id` without a partner
attr.

**Why it exists:** the entity identity ladder trusts ONLY the config's declared idAttribute,
never the co-present attributes — a deliberate anti-noise stance (decorative attrs must not
become identity), but over-conservative for universally-semantic attrs.

**Smallest safe fix (one-line-class, surgical):**
In `page-content-config.ts`, split the generic entity entry so each idAttribute has its own
entry whose selector demands it: `idAttribute: 'data-sku'` only for
`[data-sku]:not([data-product-id]):not([data-item-id])` (CSS :not is supported in
querySelectorAll), plus sibling entries for data-product-id/data-item-id. Then entityId is
set from the attr the element actually carries, `identityAttributeSelector` resolves
`[data-sku="SKU-WAR"]` (it scans captured attributes for value===entityId), tier
'identity-attribute', presence emitted. Alternatives rejected: (a) relaxing
identityAttributeSelector to accept any data-* attr with value match — weakens the
entityId==idAttribute invariant and risks decorative-attr identity; (b) config tuple
`idAttributes: [...]` — bigger type change.

**Risk:** low-moderate — changes capture classification for data-sku-only elements only;
covered by pinning unit tests + AdaniOne-clone gate unaffected (co-occurrence entry still
wins by dedupeEntities preference). Amazon `[data-asin]` untouched.

## G3 — Native `<select>` recording (NOT a product gap — harness limitation + one real gap)

**Decomposition:**
- Recorder wiring EXISTS and is correct: event-tap listens to `change`
  (event-tap.ts:353), rejects untrusted (line 204 `!rawEvent.isTrusted → return`), dropdown
  definition completes on `change` + `trigger.tag === 'SELECT'` and stores `selectedValue`
  (dropdown.ts:133-136); ir-bridge maps Dropdown → `IRAction.SELECT` with the value; executor
  `executeSelect` sets value + dispatches change (executor-content-script.ts:345-355);
  Playwright codegen renders `selectOption` (action-renderer.ts:180). Full chain intact.
- The R3 audit could not prove it because **CDP cannot produce a trusted `change` on a native
  select** without real keyboard navigation (ArrowDown+Enter focus-path); my synthetic
  dispatch was correctly rejected by the isTrusted guard. **Classification: NOT REACHABLE in
  harness, wiring verified by code-trace + unit tests** — not a product defect.
- REAL residual gap (small): no real-Chrome evidence exists for the native-select path end to
  end (only unit + Avis Ford manual-observation notes from the evidence-engine era).

**Smallest safe fix:** extend the R3 harness to select via TRUSTED input: click select →
ArrowDown/ArrowUp keyEvents → Enter, or Alt+ArrowDown option-pick sequence. Zero product
change.

## G4 — Network-idle vs timer-rendering (NOT a defect — correct soft-assertion semantics + a bounded enhancement)

**Finding recap:** steps 0003/0004 status-badge textMatch exp "In stock" got actual
"Searching…" on replay; step statuses still `passed` (soft), actual values honestly reported.

**Root cause:** Option D drain closes on network idle (2 consecutive 100ms samples of zero
in-flight XHR/fetch, network-observation.ts:909-913). My R3 app renders 400ms AFTER network
settle via `setTimeout` — a JS-timer gap the drain cannot see. Assertion evaluation is
single-shot right after drain (ir-executor-impl.ts:315-323) — no DOM-stability wait.

**Assessment:** this is CORRECT product behavior — the recorder captured the settled truth,
replay honestly reported the divergence as SOFT failures (run still passed, F3-real-actual
working). The limitation class (timer-driven mutation after network idle) is inherent to
network-based drain; the product already has the right semantics for it.

**Bounded enhancement (optional, NOT required for correctness):** in
`executor-content-script.ts`, for textMatch/count/presence assertions that FAIL on
first evaluation, retry once after a short settle (e.g. 500ms) before recording the
failure — mirrors the existing `resolveElementWithWait` poll pattern (already exists for
ELEMENT resolution, lines 560-610). This converts timer-gap noise into passes without
weakening honesty (actual value still reported if still failing). Alternatively add an
optional `assertionSettleMs` per-step execution parameter defaulting to 0 (opt-in).
**Risk:** low if retry-on-fail-only; changes timing profile slightly.

## Phase 5b gating assessment

Phase 5b = contract response bodies (per 1703e43 commit body: "5b response bodies and 5c DB
oracle remain gated"). 5b reads network RESPONSE BODIES from recorded evidence. Gating
analysis:
- **G2 SHOULD land before 5b.** 5b pairs request bodies with observed state; entity
  presence facts (data-sku identity) are exactly the join 5a built on. A silently-unasserted
  entity weakens the "observed state" side of the pairing. Small, isolated, test-pinnable.
- **G1 dialog capture is INDEPENDENT of 5b** (dialogs are DOM/JS, not network bodies). Can
  land before or after; recommend before only because it's small and closes a whole
  capability hole surfaced by the audit. Not a 5b blocker.
- **G3 native-select harness fix is validation-only** — do it as part of the R3 gate
  rerun, not as a product change.
- **G4 enhancement is optional** — do NOT block 5b on it; the failure semantics are already
  correct. If desired, land the retry-on-fail as a separate tiny PR after 5b.

## Prioritized plan

| P | Item | Type | Size | Lands before 5b? |
|---|------|------|------|------------------|
| 1 | G2 config-split for entity idAttributes | product, surgical | ~30 lines + tests | YES |
| 2 | G1 dialog capture port (MAIN-world script + DomContext fields + panel evidence) | product, additive | ~120 lines | YES (recommended, not blocking) |
| 3 | G3 harness: trusted select via keyboard | validation | ~20 lines harness | with gate rerun |
| 4 | G4 assertion retry-on-fail (settle) | product, optional | ~30 lines | NO — after 5b |

### Validation plan (real-Chrome gates, all read-only runs)
1. **Unit:** new pinning tests — G2: data-sku-only entity derives `[data-sku="X"]` presence;
   data-auto-id+data-sku co-occurrence still prefers the co-occurrence entry; data-asin
   unchanged; decorative-attr noise pin (G1: none — no unit surface for page-world).
   Full suite must stay 217+ files green.
2. **Gate R3 (extended):** rerun `r3-harness.mjs` (same workflow) + assert: dialog
   evidence present on place-order/cancel-order steps (alert + confirm captured);
   entity presence `[data-sku="SKU-WAR"]` derived; native-select step via TRUSTED keyboard
   (ArrowDown+Enter) → Dropdown interaction + IR select step + replay executes it; replay
   soft-assertion pass count increases (badge textMatch now passes when retry lands, if G4
   included — else accept the 2 known soft failures with real actuals).
3. **Gate 1 AdaniOne clone (30/30)**: byte-identical rerun must stay 30/30 (co-occurrence
   entry unaffected; qty/consequence timing unchanged).
4. **Gate 2 a-slice (35/35)**: byte-identical rerun must stay 35/35.
5. **Amazon spot-check (F-series):** entity presence on `[data-asin]` still derived; no
   #cart-root regression.
6. **CP8 probe:** rerun contract probe — action linkage counts must not regress (6 actions
   wf=1; sessions/descriptor shapes unchanged).

## Evidence pointers
- Full audit: `.drytis/notes/evidence/full-audit-350af71/` (r3-run8-final.log, r3-dumps/,
  cp8-probe-result.json, d3-repository-elements.json)
- Orphan proof: grep importers of deterministic-recorder = 0; manifest content_scripts =
  recorder-entry + network-inject only; RECORDED_EVENT unhandled in SW.
- G2 trace: assertion-derivation.ts identityAttributeSelector (:117 requires item.entityId)
  + decideLocator entity branch (:236-243) + config idAttribute (:88-93).
- G4 trace: network-observation.ts EXECUTION_DRAIN_STABLE_SAMPLES=2 × 100ms;
  ir-executor-impl.ts single-shot EVALUATE_ASSERTIONS after drain.
