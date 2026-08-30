# Hover Capture Generic Fix v1 (RC-1 … RC-8)

Status: IMPLEMENTED + cursor-inheritance amendment (2026-08-29). Supersedes
nothing; amends B7 discovery/admission doctrine by the documented tuning
levers only.
Source audit: `.drytis/notes/` + this session's read-only RCA (5 manual-test
screenshots, adani-one style marketing/booking SPA).

## 1. Problem

Manual testing on a real marketing/booking site produced:

- `Hover over "12345678"` — target = hero-banner carousel container `DIV`
  (`HeroBannerCarousel_homeHeroBanner__61LDi custom-arrow`), named by subtree
  promo text, carrying `stamped-fetch` (analytics beacons) + reinforced ×2 in KR.
- `Hover over "I"` — icon-only `<i role=img class="… icon-arrow-down">`.
- `Hover over "One Way Round Trip"` — `UL[role=list]` container named by joined
  menu-item text, no separator.
- One physical action (hover→click) surfacing a Hover card **and** a Click card.

All causes are generic; none are site-specific.

## 2. Root causes (from the live pipeline, not the legacy file)

The LIVE capture path is `EventTap → identity-extractor → SW discovery →
hover.ts lifecycle → evidence window → deriveConsequenceClasses → panel/KR`.
`deterministic-recorder.ts` is NOT manifest-loaded (RC-4/5/6 mechanisms there
are dead in production — see §8).

- **RC-1** `resolveTarget` (click-lifting: nearest interactive/cursor ancestor)
  runs for EVERY event type including `mouseenter` — hover anchors get lifted
  into large wrappers.
- **RC-2** `computeAccessibleName` tiers T6/T7 use `innerText`/`textContent`
  with no own-text vs subtree-text distinction — containers are named by their
  whole subtree ("12345678", "One WayRound Trip").
- **RC-3** Hover naming (`hover.ts nameOf`) = `accessibleName || ariaLabel || tag`
  — no placeholder tier, no icon-class tier → bare `"I"`.
- **RC-4** (live equivalent) hover admission classes include `stamped-fetch`:
  any telemetry beacon stamped to the enter admits the hover — every hover on an
  instrumented page becomes "meaningful".
- **RC-7** the evidence window drains the global buffer (INV-C1, unchanged by
  design): unrelated churn/analytics decorate and help admit hovers.
- **RC-8** the SW discovery gate `isInteractiveElement` uses
  `INTERACTIVE_CLASS_RE` — an UNBOUNDED substring list
  (`btn|…|chip|arrow|chevron|…`) — `custom-arrow`, `icon-arrow-down`,
  `tripType-dropDown` all match → class-only containers START hover lifecycles.

## 3. Goals

1. Hover anchor = the element under the pointer (bounded lift to the enclosing
   interactive control; never into unnamed wrappers). [RC-1]
2. Names are honest: subtree text is not a name for containers; icons get the
   icon tier; fallback is a structural descriptor, not garbage text. [RC-2/3]
3. Hover discovery gate is structural (shape or CSS-reveal fact) — class
   vocabulary never starts a lifecycle. [RC-8]
4. Hover admission is visible-UI only — telemetry fetches stop admitting. [RC-4/7]
5. One user action → one card: a `consumed-by-click` hover on the same target
   folds under the click card (presentation only). [pair noise]
6. Zero site-specific logic. No selectors/IDs/text mappings/special cases.

## 4. Non-goals

- No change to Click capture/typing/qualification (CQ v1.2 frozen).
- No change to evidence ownership (INV-C1 global buffer), P4 ownership pass,
  provenance links, KR signature grammar (frozen), IR generation.
- No dwell/timing admission (B7 doctrine: recorded facts, not clocks).
- No modification of `deterministic-recorder.ts` (dead in production, §8).

## 5. Design

### G1 — Hover anchor (RC-1): `resolveHoverTarget` in `identity-extractor.ts`

New function used by EventTap ONLY for `mouseenter` (click keeps
`resolveTarget` — CQ v1.2 depends on it):

1. raw = `composedPath()[0]`. If raw is hover-shaped (§ G3 shape test, DOM
   form) → **raw**.
2. Else walk the path/parents: first hover-shaped ancestor → that ancestor
   (bounded lift to the enclosing control; nearest wins). Stop at `BODY`.
3. Else: first ancestor-or-self with a scoped `:hover`-reveal CSS rule
   (`hoverReveal` probe, § G3) → that element.
4. Else → raw (honest pointer element; the SW gate then decides whether a
   lifecycle starts). Never LIFTS into wrappers; a raw enter on `HTML`/`BODY`
   itself returns raw (the structural gate renders it inert — no shape, no
   `hoverReveal` — so no lifecycle starts).

### G2 — Honest naming (RC-2/RC-3)

**G2a (tap, `identity-extractor.computeAccessibleName`):** innerText/textContent
(T6/T7) is a valid name ONLY when the subtree is a single text-bearing shape:

- ≤ 1 descendant element carrying non-empty text, AND
- no interactive-shaped descendant (a/button/[role]/… — a container with
  controls is not named by text), AND
- total text length ≤ 80, AND
- no newline in innerText.

Otherwise T6/T7 are skipped (fall to placeholder/icon/title tiers → ''). Pure
eligibility decision exported from `definitions/patterns.ts`
(`subtreeTextNameEligibility`) for unit tests. Applies to ALL event types —
a container click is equally mis-named today.

**G2b (SW, `hover.ts`):** `nameOf` → `bestName(accessibleName, ariaLabel,
placeholder, className)` (unifies with Click), then structural fallback
`ariaRole?.toLowerCase() || tag.toLowerCase()` instead of bare tag ("list",
"div" — honest, never subtree garbage).

### G3 — Structural discovery gate (RC-8): `isHoverDiscoveryShape`

New pure predicate in `definitions/patterns.ts`:

```
shape = INTERACTIVE_TAGS.has(tag)
     || INTERACTIVE_ROLES.has(ariaRole)
     || tabIndex >= 0
     || ariaHasPopup != null
     || clickHandler === true      // onclick attribute fact (DomContext)
     || pointerCursor === true     // computed-style fact (DomContext)
```

Discovery (BOTH call sites in sync: `evidence-collector.isHoverDiscoveryEnter`
AND `hover.ts detectTrigger`/local gate):

```
discover = isHoverDiscoveryShape(tag, role, tabIndex, ariaHasPopup, clickHandler, pointerCursor)
        || domContext.hoverReveal === true
```

- `isInteractiveElement` itself is UNCHANGED — it is also consumed by
  `click-qualification.ts` (`rawInteractiveShaped` fact); CQ behavior frozen.
- `hoverReveal` = new optional additive `DomContext` field (follows the
  `clickQualification` convention): true when a `:hover` rule on the element or
  ≤5 ancestors changes a reveal property for a descendant/self
  (port of legacy `hasCssHoverReveal` logic, bounded). Recorded at the capture
  instant ONLY when G1 reaches step 3 (rare path) — WeakMap-cached per element;
  undefined = not probed = false. No message-shape change (rides DomContext).

### G4 — Admission classes (RC-4/RC-7): drop `stamped-fetch` for Hover

`HOVER_CONSEQUENCE_CLASSES` (output-adapter) := reveal, insertion, removal,
nav, revert, pointer-reach. `stamped-fetch` remains a recorded evidence row and
a class for non-Hover types; it stops ADMITTING hovers (the docblock names the
class list as the tuning lever). Rationale: telemetry is not a user-visible
consequence; on instrumented pages it admits every gesture.

### G5 — Pair folding (presentation only)

Stopped-view renderer: a Hover card with `terminal === 'consumed-by-click'`
whose trigger identity (tag + stableId + accessibleName) equals the following
Click card's trigger identity renders as a collapsed child row of the Click
card ("hovered before click"). Structural keys only (the lifecycle already
encodes causality) — no timestamps. No persistence change; live timeline
unchanged; reveal via existing card expansion.

### G6 — KR impact (documented, accepted)

`anchorTargetOf` uses `trigger.accessibleName ?? metadata.targetName` → the
naming fix changes `normalizedTarget` for NEW captures only. Signature keys are
frozen; old rows (e.g. the "12345678" signature) go dormant → stale → diverged,
never evicted. Same population-split pattern as CQ D3; addendum added to
`.drytis/notes/kr-hygiene-cq-v12-population-split.md`.

### G7 — Legacy file decision

`deterministic-recorder.ts` (RC-4 legacy signals, RC-5 cooldown-clear, RC-6
unstable keys) is not manifest-loaded and has no runtime consumer. Do NOT
modify it this phase (avoid churn in dead code); note for future deletion.

## 6. Implementation phases (TDD, red first)

- **T1** pure shared: `isHoverDiscoveryShape`, `subtreeTextNameEligibility`
  (+ tests) in `definitions/patterns.ts`.
- **T2** tap: `resolveHoverTarget`, scoped `hoverReveal` probe (WeakMap cache),
  `computeAccessibleName` T6/T7 gating, `DomContext.hoverReveal` population in
  `event-tap.handleRawEvent` mouseenter branch (+ tests).
- **T3** SW gate: both discovery call sites → shape OR hoverReveal (+ tests).
- **T4** `hover.ts` naming: bestName + structural fallback (+ tests).
- **T5** admission: drop stamped-fetch for Hover; re-baseline pinned tests
  (justified: doctrine tuning lever, documented here).
- **T6** stopped-view pair folding (+ tests).
- **T7** full suite, tsc ≤ 8 pre-existing, build v10.9.0, new real-Chrome
  matrix (§7) + ALL standing gates re-run green together.
- **T8** Infrastructure Gate + infra_verifier + reviewer; refresh download
  README/zip (manual-testing surface). No git publish (owner gate).

## 7. Acceptance criteria (ALL VERIFIED 2026-08-29)

Unit/integration:
- [x] Container with promo text + links: accessibleName '' (not "12345678").
- [x] `<button><span>Save</span></button>` still named "Save" (single
      text-bearing wrapper allowed).
- [x] `UL` with 2 menu items: no text name → "list" fallback label.
- [x] Icon-only `<i class="icon-arrow-down">` hover label "arrow-down icon".
- [x] `resolveHoverTarget`: raw shaped → raw; span in link → link; unnamed
      container → no lift past BODY; class-only container not lifted as shape.
- [x] Discovery: class-only `custom-arrow` container with no shape facts and no
      hoverReveal → NO lifecycle; same container with `cursor:pointer` →
      lifecycle (honest — it IS the control).
- [x] hoverReveal CSS fixture (`.x:hover .panel{display:block}`) → discovery
      true without shape.
- [x] Admission: hover with ONLY stamped-fetch evidence → not admitted (no KR
      anchor, suppressed card); reveal still admits.
- [x] Pair fold: consumed-by-click hover + same-identity click → one card.
- [x] CQ Step-2 suite unchanged green; isInteractiveElement untouched.

Real-Chrome matrix (new fixture set, generic patterns):
- [x] Hero-carousel page (mutating content, analytics beacons, custom-arrow
      class): crossing/resting over it produces NO hover card and NO KR hover
      signature named by container text; carousel-arrow click still records.
- [x] Nav mega-menu (real `<a>` + JS reveal): hover→reveal→consume still
      records Hover + provenance link (P3 S1 contract intact).
- [x] Icon chevron inside link: one hover named "Services"-style link name.
- [x] Click-away on empty space: honest Unclassified click (B3 S4) unchanged.
- [x] All standing gates green in the same run: B7-P3 S1/S2+KR, B7-P4
      canonical/V1/V2, CQ Step-2, B6.1.

## 8. Risks / residuals (documented, accepted)

- **R-1 Discovery honesty trade-off:** a class-only custom widget with NO
  shape facts (no cursor/role/tabindex) and no `:hover` CSS (JS-only reveal)
  no longer starts a hover lifecycle — silent negative. Accepted: hover
  discovery now requires a DECLARED affordance (same principle as CQ: no
  vocabulary guessing). Watch metric: hover capture rate on custom-widget
  sites during manual testing.
- **R-2 pointerCursor breadth:** `cursor:pointer` is common on decorative
  elements; some noisy hovers will remain (but naming + admission fixes keep
  them honest and unadmitted).
- **R-3 Naming churn:** corrected names change `normalizedTarget` for new KR
  signatures (G6). Old noisy signatures (e.g. "12345678") go dormant — no
  migration, no key rewrite (frozen grammar).
- **R-4 Test re-baselines:** pinned expectations that encoded container-text
  names, bare-tag hover names, or stamped-fetch hover admission are updated
  with justification comments pointing here.

## 9. Amendment log

- 2026-08-29 v1 created (this document) — generic hover capture fix, owner
  request after manual-testing RCA.
- 2026-08-29 **infra verification (final)**: infra_verifier PASS (7/7
  sections; zero hardcoded secrets/URLs in src+serve roots; all services
  production commands; /download artifact 200 with the fresh zip;
  setup script deploy-ready). One WARN — the live-session `serve/`
  mirror under `/` was stale after the rebuild (file-server copies dist
  at start); REMEDIATED by restarting service-bg-service-3591
  (serve/dist/assets/service-worker-inline.js now byte-identical to
  dist/, manifest 10.9.0 served live). The CANONICAL artifact route
  /download/cmdrunner-extension.zip was already fresh (download-server
  restarted at zip-sync time).
- 2026-08-29 **review follow-up (gate-family sync + doc truth)**: reviewer
  PASS with 4 WARNs; all resolved. (1) WARN-1 — two residual hover-gate
  call sites still used isInteractiveElement's class-substring form
  (EvidenceLedger.isGatedDiscoveryEnter; service-worker R-4 stamp
  dispatcher): BOTH synced to the structural gate
  (isHoverDiscoveryShape OR recorded hoverReveal) — class vocabulary no
  longer gates ANY hover path family-wide; pinned by
  tests/runtime/hover-gate-family-sync.test.ts (5 tests). (2) WARN-2 —
  dead doc claims ("stamped-fetch remains admitted for non-Hover types")
  corrected in output-adapter.ts / interaction-renderer.ts; the network
  evidence itself remains recorded. (3) WARN-3 — suite expectation
  refreshed (5,205/5,205 in 359 files; the previously recorded 5,202/360
  included two RCA probe files removed after the matrix). (4) WARN-4 —
  G1's "never return HTML/BODY" line clarified: resolveHoverTarget never
  LIFTS to wrappers; a raw body/documentElement enter returns raw (the
  SW gate renders it inert) — spec text corrected below.
- 2026-08-29 **cursor-inheritance amendment** (real-Chrome validation of the
  first implementation). The `#nav-products` anchor (`Products <i>▾</i>`)
  still captured `accessibleName: ''` in real Chrome while green in jsdom:
  `cursor` is an INHERITED CSS property and Chrome's UA stylesheet sets
  `cursor: pointer` on `a[href]`, so icon glyphs inside links inherit pointer
  and counted as "interactive-shaped" — poisoning RC-2's
  `hasInteractiveShapedDescendant` (anchor named "link") and G1 (hovers
  anchored on glyphs instead of lifting to the enclosing control). jsdom has
  no UA link-pointer rule, which is why unit fixtures alone could not catch
  it. Rules landed (both generic, pure CSS semantics, no vocabulary):
  1. **pointerCursor is an OWN-BOUNDARY fact** — it counts only when the
     cursor CHANGES at the element boundary (parent's computed cursor is not
     already `pointer`). Applied uniformly at both DOM-edge producers:
     `domShapeOf` (`tap/identity-extractor.ts`) and
     `DomContext.pointerCursor` (`definitions/dom-context-extractor.ts`).
     `resolveTarget`'s click-lifting Strategy 2 keeps the RAW computed read
     (CQ v1.2 frozen). Consumer set verified: only the hover discovery gate
     reads the fact (hover.ts ×2, evidence-collector ×1, patterns shape
     test); CQ never does.
  2. **aria-hidden subtree exclusion** (accname conformance): descendants
     beyond an `aria-hidden="true"` boundary contribute neither name text
     (`visibleSubtreeText` strips them in tiers T6/T7) nor shape evidence
     (`measureSubtreeText` skips them).
  3. Re-baselined one stale 7.4-M1 pin (`eventtap-affordance-7-4-m1.test.ts`
     C4b): it pinned the OLD raw-cursor fact on an inherited-pointer leaf;
     its original purpose (leaf passes click gate 4) died with CQ v1.2
     Step 2 (claim is unconditional). Now pins own-boundary `false` on the
     inherited leaf + unconditional claim.
