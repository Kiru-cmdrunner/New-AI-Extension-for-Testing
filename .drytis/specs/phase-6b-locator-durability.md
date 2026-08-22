# Phase 6B — Locator Durability: Identity Vocabulary Expansion

**Status:** Approved 2026-08-22 (owner): L1–L3 as specced with two refinements —
(1) L3 family-tags emitted for NON-DEFAULT families only (`data-testid` stays bare,
byte-identical); (2) L4 folded into 6D.1 — 6B is purely identity-layer.
**Baseline:** 153f5c2 (capability-surgical-removal, 10 commits ahead of origin, unpushed)
**Predecessors:** 6D.0 (568adfe), 6A+6C (bd8e907), U1–U5 (f3452d5 → 7594401), doctrine pin (153f5c2)
**Roadmap source:** .drytis/notes/ROADMAP-2026-08-22.md §"Remaining Phase 6" — 6B is the next phase.

---

## 1. Problem

The RCA batches (arch-rca-3-batches-2026-08-21.md, adanione-clone-audit-2026-08-20.md)
identified **C2 — identity vocabulary too narrow** as a root cause with the widest blast
radius across the roadmap:

| Symptom | RCA ref | Mechanism |
|---|---|---|
| Every icon/custom-DIV step falls to positional `nth-of-type` CSS (conf 0.40) | O9 | ElementIdentity carries no `data-auto-id`; `className` is captured but is **never** a locator candidate; icon tier is display-only naming |
| Real-site attributes (`data-auto-id`, `data-test-id`, `data-test`, `name`, `aria-labelledby`) match none of the 13 selector groups | C2/C3 | Same vocabulary gap one layer up (page-content scanning) |
| Playback can mis-resolve a business ID to a different attribute family | Clone audit | `LocatorStrategyType.TEST_ID` carries a bare value with **no attribute-family provenance**; resolver + renderer probe/generate `data-testid`-only chains |

6D.0/6A closed surface-vocabulary and observation-layer gaps; 6B closes the
**identity-layer** gap so the same reality produces durable locators.

## 2. Design Principle (doctrine constraints, carried from the roadmap)

- **Deterministic-first.** No timing rules; no site-specific tokens (doctrine pin 153f5c2
  enforces site-agnosticism — every selector added here must pass the genericity tripwire).
- **Additive-only where possible.** New fields optional. Never narrower than before.
- **Full verification path** (new feature + IR-generation change ⇒ major): Stage 0 lock →
  TDD pins → full suite → dist → reviewer + infra_verifier → real-Chrome E2E → owner gate → commit.

---

## 3. Layered Design

### L1 — Identity vocabulary (capture): `src/tap/identity-extractor.ts`, `src/shared/types.ts`

RawElementIdentity gains ONE optional field (`null` when absent — every existing object
literal without it stays type-valid):

```ts
dataAutoId: string | null;   // data-auto-id attribute — industry-wide test-ID convention
```

**Grounding correction (2026-08-22):** the draft proposed a second field `nameAttr` for
the HTML `name` attribute — but `name: string | null` at types.ts:135 ALREADY captures
exactly that (same source: `getAttribute('name')`, identity-extractor.ts:355), and it is
already a ranked candidate (locator-ranking.ts:278, LABEL/STABLE_TECHNICAL). No duplicate
field, no duplicate candidate. L1 = `dataAutoId` only.

- `extractIdentity()` populates `dataAutoId` next to `testId/dataCy/dataQa` (identity-extractor.ts:356-359).
- `className` already exists in the type and is populated — no change needed.
- Keep the icon-naming tier (S2) unchanged: it is display-only and remains so in 6B.

### L2 — Candidate extraction: `src/domain/locator-ranking.ts`

`extractCandidatesFromIdentity()` — the single ranking entry for BOTH recording-time
(ir-bridge.ts:164) and healing-time (healing-service.ts:245 resolveFreshLocators):

- `dataAutoId` → `LocatorStrategyType.TEST_ID`, category BUSINESS (0.90).
- **NEW `stableClassCandidates()`** → `LocatorStrategyType.CSS` `[class~="token"]`, category
  STABLE_TECHNICAL (0.72). Deterministic filters (all pure string/structural — no timing,
  no site tokens):
  1. Strip style/utility tokens: any token matching `isCssInJsClass` patterns,
     `^css-`, `^sc-`, `^e-`, `^_`, `-?css-module`, `^x`, length < 3, `^hover:`/`^focus:`/
     `^group-`, Tailwind prefixes (`^sm:`/`^md:`/`^lg:`/`^hover\.`), `!important` fragments.
  2. Strip volatile tokens: `selected`, `checked`, `active`, `disabled`, `open`, `show`,
     `loading`, `is-`, `has-` prefixed states, `^ripple`, `^fade`, `^animate`, `^transition`,
     `^visible`, `^hidden`, `^showing`, `^collapse`, `^enter`, `^leave`, `^v-`, `^ember`,
     `^ng-`, `^svelte-`, `^astro-`, `^next-`, `^nuxt-`, `^gwt-`, `^dark:` variants.
  Token filtering must be purely structural (prefix/shape/length rules), never
  site-derived — the doctrine tripwire (153f5c2) stays green.
  3. Keep at most **2** class candidates per element (bounded).
- `stableId` candidate stays category STABLE_TECHNICAL (no change).

### L3 — Value provenance: `LocatorStrategyType.TEST_ID` values become self-describing

Today `TEST_ID` values are bare strings; the renderer probes `[data-testid="X"]` and the
resolver additionally probes `[data-cy=]`/`[data-qa=]` (locator-resolver.ts:157-159).
Adding `data-auto-id` to those chains is possible but hides which attribute the user's app
actually uses — the wrong-attribute resolution bug from the clone audit.

6B makes the **value carry the family for NON-DEFAULT families only** (owner-approved
refinement): `data-testid` values stay **bare** and keep rendering `getByTestId('X')`
byte-identical to today (the overwhelmingly common path is untouched); `data-cy`,
`data-qa`, and `data-auto-id` values become family-tagged: `[data-cy="sign-in"]`,
`[data-auto-id="flight-card-F1"]`. Then:

- **Renderer** (`src/adapters/playwright/locator-renderer.ts:189 renderTestIdLocator`):
  already extracts from `[data-testid="X"]` form — extend the regex to
  `/\[data-(?:auto-)?(?:test)?-?id=...\]/` family or simpler: accept any `[data-*id="X"]`
  CSS-attr form and emit `page.locator('[data-auto-id="X"]')` (Playwright-best-practice:
  a CSS attribute locator is the correct expression for non-data-testid families).
  Bare values keep rendering `getByTestId('X')` (unchanged legacy path).
- **Executor** (`src/execution/locator-resolver.ts:155 resolveByTestId`): if value matches
  `[data-<attr>="X"]` form, querySelector that exact attribute; else keep the existing
  3-family probe.
- **Renderer does NOT know dataAutoId**: it renders what the IR carries (family-tagged CSS-attr
  value). No renderer import of shared/types — keeps panel/bundle separation.
- Family-tagged values also make `detectLocatorChanges` (healing-service.ts:254) diff
  correct across attribute families.

### L4 — Page-content semantic selectors: **FOLDED into 6D.1** (owner decision 2026-08-22)

Audit found counters/collections/entities family groups already landed with 6A/G2; the
remaining delta (notifications + status-badge family variants) has zero dependency on
L1–L3 and gets stronger clone-fidelity validation inside 6D.1's 6E-slice pass. 6B is
purely identity-layer. **Hand-off:** record the two pending groups in the 6D.1 spec/roadmap.

### L5 — Execution-side (Scope of record — OUT): see §6.

---

## 4. Files Changed / Not Changed

**Changed (implementation):**

| File | Change | Risk |
|---|---|---|
| `src/shared/types.ts` | +1 optional field (`dataAutoId`) in RawElementIdentity | None — additive |
| `src/tap/identity-extractor.ts` | populate `dataAutoId` | None — additive |
| `src/domain/locator-ranking.ts` | +dataAutoId candidate, +stableClassCandidates, family-tagged TEST_ID values | Behavior change confined to candidate extraction |
| `src/adapters/playwright/locator-renderer.test.ts` | pins for family-tagged rendering | None |
| `src/execution/locator-resolver.ts` | family-aware resolveByTestId | Replay-path only |
| test files (new pins) | vocabulary / ranking / renderer / resolver / config pins | None — test-only |

**Test files (new pins, TDD):** `tests/locator-ranking.test.ts` (+tier pins),
identity-vocabulary pins, `tests/adapters/playwright/locator-renderer*.test.ts`
(family-tagged rendering), `tests/execution/locator-resolver*.test.ts` (family-aware
resolution)
`tests/doctrine/genericity-pin.test.ts` (existing tripwire must stay green — no site tokens).

**Not changed:** Evidence Ledger, EventTap capture flow, projection, NOISE_TYPES,
identity freezing doctrine (V3.1 §3 — the freeze is now 20 fields), ir-bridge, healing
service (gains via resolveFreshLocators automatically), Element entity (domAttributes
already holds raw attributes), MS-U* sidepanel modules, KR signature hash (v1 frozen —
normalizeTarget stays accessible-name based; see Risks §7.R4).

**Test files (new pins, TDD):** identity vocabulary pins, ranking tier pins, family-tagged
renderer pins, family-aware resolver pins, doctrine genericity (existing tripwire must
stay green — no site tokens).

---

## 5. Acceptance Criteria

- [x] AC1: `extractIdentity` populates `dataAutoId` (new optional field); identity remains
      serializable; existing factory fixtures remain valid (optional field).
- [x] AC2: `extractCandidatesFromIdentity` emits TEST_ID (BUSINESS) for dataAutoId and ≤2
      stable-class CSS candidates; no auto-generated / state-volatile / Tailwind / CSS-in-JS
      token ever becomes a candidate (the pre-existing `name` candidate at
      locator-ranking.ts:278 is untouched — no duplicates).
- [x] STAB: candidate order for identities WITHOUT the new fields is byte-identical to pre-6B
      (regression pin over a fixture corpus).
- [x] AC3: family-tagged TEST_ID values render `[data-auto-id="X"]` → `page.locator('[data-auto-id="X"]')`;
      bare values still `getByTestId('X')`; `data-testid` values stay bare (STAB for the common path).
- [x] AC4: executor resolves family-tagged values against the exact attribute; bare values keep the
      3-family probe.
- [x] ~~AC5~~ FOLDED to 6D.1 (owner decision 2026-08-22) — notifications + status-badge
      family variants move to the 6D.1 spec; counters/collections/entities already covered
      by 6A/G2. 6B keeps zero page-content-config changes.
- [x] AC6: healing detects locator changes across families via family-tagged values.
- [x] AC7: O9 class of steps: an icon `<i class="icon-plus">` target now yields a class-based CSS
      candidate (conf 0.72) BEFORE the structural walk — verified in real Chrome; no nth-of-type
      first-priority locator for such targets.
- [x] AC8: no ranking regressions — full existing locator-ranking/ir-bridge/healing suites green;
      stable-identity-key harvest join unchanged (elementIdentityKey gains dataAutoId in its
      business-ID chain ONLY as a lower-priority fallback after testId/dataCy/dataQa/stableId —
      no change to keys that currently resolve via existing business IDs).
- [x] AC9: full suite green; tsc errors remain exactly the 8 pre-existing baseline.
- [x] AC10: real-Chrome E2E — record on harness apps using data-auto-id conventions; verify seeded
      observations, IR locators (class/attr-based, not nth-of-type), codegen `page.locator('[data-auto-id=…]')`,
      replay resolution, zero console errors.
- [x] AC11: reviewer + infra_verifier PASS; doctrine tripwire green (no site tokens introduced).
      (Reviewer PASS all criteria + security + doctrine 2026-08-22; infra_verifier RESULT: PASS, 0 failures.)
- [x] AC12: roadmap docs updated; ZIP pinned only after owner approval.
      (Roadmap updated 2026-08-22: 6B shipped; 6D.1 owns L4 remainder. ZIP v10.9.0 built from the 6B tree,
      md5 7dd37d092eee5fed1b49a88ee6f514ad — pinned per owner gate 2026-08-22.)

## 6. Out of Scope (deferred)

- Execution-wait routing / `resolveElementWithWait` (clone-audit replay fix) — separate Phase 8.1.
- KR signature-key change — v1 FROZEN at behavior-knowledge-mapper.ts:60-71; accessible-name-based
  target normalization deliberately unchanged this phase.
- Clone 6E full-fidelity mirror work — 6E-slice groups land with 6D.1's clone pass.
- Rendering `name`-attr LABEL strategies to Playwright `getByLabel` (may follow in 6B.1).
- O1/O2/O7/O13/O14 display hygiene (6F).

## 7. Risks

- **R1 (H):** class-token filter under-/over-matches on real sites → wrong locator ranked above structural.
  Mitigation: bounded to ≤2 candidates, conf 0.72 < aria (0.80) and business (0.90); ranking already
  prefers verified attrs + aria when present; O9 targets today have ONLY structural 0.40 — any
  correct class candidate is a strict improvement; AC7 E2E proves it live.
- **R2 (M):** family-tagged values change stored LocatorStrategy values in the elements table
  (healing diffs) → one-time perceived change on existing rows. Mitigation: migration is additive
  (new rows carry family tags; old rows keep bare values; detectLocatorChanges handles both);
  documented in commit message.
- **R2b (M):** play.safe — IR plans recorded pre-6B with bare TEST_ID values replay fine
  (bare path unchanged); post-6B recordings with family-tagged values require the new
  renderer/resolver (shipped together in this phase).
- **R3 (M):** over-matching page-content family groups (adani-popup-banner-class containers). Same
  honesty contract as P3: over-match yields plain Click/Unclassified, never fabricated semantics.
- **R4 (L):** KR signature keys continue using accessible-name targets — cross-session reinforcement
  on nameless icon targets stays coarse until 7.x. Accepted (frozen v1).
- **R5 (L):** verifier/tester detection of fixture drift in `makeIdentity` helpers (new optional
  fields) — pins include fixtures with and without new fields.

## 8. Verification Plan (major-change full path)

Stage 0 lock → RED pins (L1 vocabulary; L2 ranking; L3 renderer/resolver family; L4 config;
doctrine tripwire) → implement → green → full suite + tsc baseline check → dist rebuild →
reviewer (spec A1–A12) + infra_verifier (7 sections) → real-Chrome E2E harness
(data-auto-id app + icon-class app + regression app) → owner gate → commit → ZIP after approval.
