# Phase 7.4-B5 Spec — Modal Definition: Open Trigger + Escape Dismissal (B-Arc Slice 4)

**Status:** OWNER-REVIEW GATE — no implementation until approved.
**Date:** 2026-08-26
**Branch:** `capability-surgical-removal` (B4 shipped @ `1edbf41`/`ff8eb15`).
**Predecessors:** 7.4-M1 (affordance), B1 (Expander), B2 (typeable combobox),
B3 (capture completeness), B4 (D2 output-policy DROP).
**Evidence base (three read-only audits this session, all code-grounded):**
1. B5 grounding audit — signal trace capture→classification→lifecycle→evidence→IR→understanding→KR.
2. B5-2 validation audit — Escape/backdrop end-to-end; found the `keyboardShortcut`
   replay hole (no renderer case, no executor case) and the same-element absorption limit.
3. Priority/overlap audit — trigger disjointness vs all 19 definitions, priority
   arithmetic, focus-trap/nested cases, replay-change boundedness.

---

## §1 Problem (validated findings)

**F1 — No typed semantics for dialogs.** `role=dialog` / `alertdialog` / native
`<dialog>` appear in no claim vocabulary (`INTERACTIVE_TAGS`, `INTERACTIVE_ROLES`,
all definition gates). A dialog-opening trigger (`aria-haspopup="dialog"`) that is
not calendar-shaped lands at Click(180) — or Expander(80) when it also bears
`aria-expanded`. "Opened dialog X" exists only as evidence rows
(`newSurfaces[]`), never as a typed card.

**F2 — Dismissal is replay-silent.** Post-B4 (D2 DROP), every non-button
dismissal produces ZERO IR steps: bare Escape → Unclassified keydown → dropped;
sibling/plain backdrop click → Unclassified → dropped. A replayed test that
closed a modal via Escape or backdrop-click executes subsequent steps **behind
an open modal**. This is the only B5 finding that breaks replay correctness,
not just honesty.

**F3 — `keyboardShortcut` IR action is not executable or renderable anywhere.**
`action-executor.ts:282` and `executor-content-script.ts:423` default →
`UnknownAction` failure; Playwright `action-renderer.ts` handles 10 of 12 enum
members — no `KEYBOARD_SHORTCUT` (and no `DRAG_DROP`) case → throws
"Unsupported IRAction". **Pre-existing latent defect independent of B5:** any
recorded modifier shortcut (Ctrl/Cmd/Alt combos) already maps to
`KEYBOARD_SHORTCUT` (`ir-bridge.ts:79`), so such plans already fail replay today.
`ResolvedTarget` has a `NoTarget {kind:'none'}` variant used only by the ATC
generator (WAIT steps); the bridge always builds element targets — wrong shape
for a page-scoped keypress.

**F4 — Late-dialog evidence capture unverified.** The 2026-08-18 dialog RCA
(Category A) showed dialogs rendering +400–900ms after window close were never
captured; the Aug-23 consequence-settling rework (causal-idle gate, 10s TD-8
cap) plausibly fixed this, but **no run has verified it**. B5-3 verifies; it
does not assume.

**F5 — Dead code.** `src/runtime/modal-tracker.ts` (114 lines): zero importers;
its aria-expanded-flip design is stale (now Expander's claim domain) and wiring
it would double-claim.

**Non-findings (deliberately unchanged):**
- In-overlay backdrops (MUI `.MuiDialog-root > .MuiBackdrop`): ancestor classes
  already match `OPEN_SELECTION_SURFACE_CLASS_RE` → claim Click via S6/LP1 →
  IR `click(backdrop)` **replays correctly**. No change.
- Programmatic dismissal (submit-in-dialog closes it, timers): produces no
  user event → no ledger entry → structurally cannot mint an interaction.
  The no-fabrication property is architectural (M5 + D2); B5 must not break it.

---

## §2 Design (from the priority/overlap audit)

### One definition, two trigger types

`src/definitions/modal.ts` — `type: 'Modal'`, **priority 75**
(`Tab 65 < Link 70 < Modal 75 < Expander 80 < Scroll 110 < Click 180`),
`triggerEventTypes: {click, keydown}`, immediate completion (Expander shape:
no lifecycle, `isInScope` always false, no active-stack residue).

**Open branch (click):** claim iff the resolved target's OWN
`event.domContext.ariaHasPopup === 'dialog'` (strict string equality — the W3C
token; `aria-haspopup="true"` means *menu* and MUST NOT claim). Never ancestry.
This keeps: DatePicker(10) ownership of MUI-style combobox+haspopup=dialog
triggers (calendar signals), Dropdown(20) untouched (`listbox` only), S6/LP1
in-dialog rescue untouched, in-dialog controls their own types.
Both-present (`aria-expanded` + `haspopup=dialog`, the common Filters shape):
Modal wins at 75 — dialog-opener convention subsumes disclosure (mirrors B1's
"stronger type keeps its type when also aria-expanded" rule, one rung up).

**Dismiss branch (keydown):** claim iff `event.key === 'Escape'` AND
(`event.target.ariaRole === 'dialog' || event.target.tag === 'DIALOG' ||
extractSemanticRoles(event.domContext.ancestorRoles) ∋ 'dialog' |
'alertdialog'`). Ancestry OR **self** — `getAncestorRoles` starts at
`parentElement`, so Escape pressed *on* the dialog container sees no dialog in
ancestry unless an outer dialog exists. Multi-token roles are already unwrapped
by `extractSemanticRoles` (quoted variants too).
Disjointness proof (audited): only `keyboard-shortcut.ts` listens to keydown;
its gates (modifier / Shift+special / F1–F12) cannot claim bare Escape. The
two branches are event-type disjoint and gate-disjoint from all 19 existing
definitions.

**Metadata (`buildResult`):**
`action: 'open' | 'dismiss-escape'`; `targetName` (bestName chain);
`targetTag`/`targetRole`; for open: `clientX/clientY` (Click parity); for
dismiss: `key: 'Escape'` + dialog fact used (`dialogInAncestry: boolean`).
Action-named, not outcome-named: an Escape the app ignores still produces the
card naming the ACTION; consequence attribution stays evidence-owned
(Expander precedent — direction lives on the behavioral layer).

### Replay (B5-2c — makes KEYBOARD_SHORTCUT real)

- `ir-bridge.ts`: `Modal: IRAction.CLICK` for open (replay parity — a human
  clicks the trigger; TOGGLE is checkbox-specific). For dismiss: the Modal
  interaction maps to `KEYBOARD_SHORTCUT` with `input = 'Escape'` (from
  metadata.key), description `Press Escape to dismiss the dialog`
  (direction-neutral per B1's description discipline), and
  `buildTarget` special-case → `{kind: 'none'}` — page-scoped keypress, no
  element. Locator-resolution in `ir-executor-impl.ts` skips non-element
  targets (the `navigate` precedent at :294 shows the guard shape).
- **Renderer:** `action-renderer.ts` + one case →
  `page.keyboard.press('<input>')` via a `renderWait`-style helper
  (page-scoped, ignores target — renderWait precedent). Generic over any
  shortcut string, not Escape-specific. **Incidentally closes F3 for every
  recorded modifier shortcut** (their plans currently throw on render).
- **Executors:** one case each in `action-executor.ts` and
  `executor-content-script.ts`: dispatch trusted-shaped `KeyboardEvent`
  keydown+keyup on `document.activeElement ?? document` — same synthetic-event
  family the executors already use (`el.click()`, `new Event('input')`).
- **Fidelity limit (documented, accepted):** synthetic keydowns are untrusted —
  JS-handled modals (MUI/AntD/Radix) close; the native `<dialog>` Escape
  auto-behavior will NOT. The Playwright render is a trusted real keypress and
  covers that path. Pin the limit, don't fix it.
- `DRAG_DROP` is the other unrendered enum member (same throw). **Out of B5
  scope** — logged as a finding for a separate disposition. Do not fold in.

### Panel

`TYPE_DISPLAY` entry (icon e.g. '🪟', label 'Modal', distinct color);
`DEFINITION_PRIORITIES.Modal = 75` (the fs-parse drift pins in
`understanding-badge.test.ts:120-130` auto-verify map ↔ registry agreement —
both must be updated together or the pin fails); why-block lines:
open → "aria-haspopup=dialog (W3C dialog-opener convention)"; dismiss →
"Escape pressed while dialog focused (ancestry/self)".

### Hygiene

Delete `src/runtime/modal-tracker.ts` (F5). No importers (verified); tsc + full
suite gate the removal.

---

## §3 Slices

- **B5-1 (open typing):** definition + wiring (union, registry, IR map,
  description case, DDC-3 allowlist, badge map, TYPE_DISPLAY) + pins.
- **B5-2a (Escape claim):** dismiss branch + pins (incl. the self-vs-ancestry
  gate, nested-dialog innermost claim, and the same-element-absorption limit).
- **B5-2b (backdrop — NO code):** documented non-change. In-overlay stays
  Click (pin as a regression: a `.MuiDialog-root`-shaped backdrop click must
  still be Click + IR click). Sibling stays Unclassified + actionability flag
  (B3 parity pin already exists — do not weaken).
- **B5-2c (replay):** the four touchpoints above + the recorded-modifier-
  shortcut regression pin (F3 closure).
- **B5-3 (E2E verification):** fixture + harness; verifies late-dialog capture
  (F4) — records whatever the truth is, fixes only if the root cause is
  in-scope (e.g. settle-window lifetime), otherwise logs an honest finding.
- **B5-4 (hygiene):** delete modal-tracker.ts.

## §4 Regression constraints (R1–R12, carried + new)

- **R1** IR plans for all previously-recorded flows remain semantically
  identical EXCEPT: new Modal steps (open: click with same locator — was
  Click-carded; dismiss: new KEYBOARD_SHORTCUT step replacing nothing — the
  prior state was silent omission). Pinned by diffing b3/b4 E2E IR baselines
  against the B5 run with the expected-delta list.
- **R2** capture-guarantee v2 (panel/storage) untouched.
- **R3** 6E-M2 DatePicker family, 6F-M1 gesture-ownership, 7.4-M1 affordance
  (12/0), B1 expander (13/0 + 3/0), B2 combobox IR parity (zero select), B3
  census composition (16 cards, unclassified taxonomy counts), B4 DROP pins —
  all green at their current counts.
- **R4** Doctrine: genericity-pin exemption baseline stays exactly the four
  files; vocabulary-freeze `*_CLASS_RE` baseline stays 10 (B5 adds ZERO class
  regexes — the claim is attribute/ancestry facts only); no site tokens.
- **R5** Union count pin 19→20 (`component-types.test.ts:137`, honest update);
  definition count pin 17→18 (`extended-interactions.test.ts:415`, honest
  update, comment carried).
- **R6** NOISE_TYPES untouched ({Scroll, Unclassified}); Modal never appears
  in it; Unclassified stays dropped (B4).
- **R7** DDC-3 reload-attribution allowlist gains 'Modal' (the B1 lesson:
  without it, dialog-triggered reload navigations silently lose attribution).
- **R8** KR vocabulary: 'Modal' enters `actionType` space; existing
  Click/Expander rows for dialog triggers fragment per the accepted cost
  (cold-restart, demote-not-destroy). Pin: signatureKey composition unchanged.
- **R9** Evidence drain/persist-exactly-once at STOP (B3 S1) unaffected.
- **R10** No definition double-claim: for any single event, at most one
  lifecycle is created (discovery is first-match by priority; pin the two
  boundary pairs: Modal-vs-Expander both-present, Modal-vs-KeyboardShortcut
  bare-Escape).
- **R11** Synthetic keypress executor path never claims/creates ledger
  entries (execution-side only; capture unaffected).
- **R12** `buildTarget` NoTarget path applies ONLY to KEYBOARD_SHORTCUT steps;
  every other type keeps element/url targets (pin).

## §5 Test plan

Unit/integration (red-first):
1. `tests/definitions/modal-claim-7-4-b5.test.ts` — open gate (strict
   `'dialog'` token; `haspopup="true"`/`"menu"`/`"listbox"` → null; absence →
   null; pre-B5 sessions' undefined → null), dismiss gate (Escape+ancestry;
   Escape+self; Escape+body-only → null — honest limit pinned; nested dialog
   innermost; other bare keys → null), registry order (75 between Link and
   Expander, B1-9 pattern), immediate completion shape.
2. `tests/generation/ir-bridge-modal-7-4-b5.test.ts` — open → CLICK with
   element target + locator; dismiss → KEYBOARD_SHORTCUT with
   `target.kind === 'none'` and input 'Escape'; description strings; NOISE
   untouched; R12 pin (other types still element targets).
3. `tests/execution/keyboard-shortcut-replay-7-4-b5.test.ts` — action-executor
   + executor-content-script keyboardShortcut case (KeyboardEvent dispatched on
   activeElement/document, keydown+keyup, success result); the F3 regression:
   a recorded Ctrl+S interaction → plan renders + executes (was: throw/
   UnknownAction).
4. `tests/adapters/playwright-keyboard-render-7-4-b5.test.ts` — renderer
   produces `page.keyboard.press('Escape')` / `press('Control+s')` from input;
   NoTarget not rendered as locator.
5. `tests/sidepanel/modal-display-7-4-b5.test.ts` — TYPE_DISPLAY entry, badge
   '✓ Modal (prio 75)', why-block lines, fs-parse map↔registry sync (auto-pin).
6. Boundary pairs (R10) inside (1): both-present → Modal not Expander;
   bare-Escape → Modal not KeyboardShortcut.
7. `tests/runtime/backdrop-parity-7-4-b5.test.ts` (B5-2b) — in-overlay
   backdrop click still Click + IR click; sibling backdrop still Unclassified
   with actionabilityEvidence flag (B3 parity).

E2E (`harness-74b5.mjs`, real Chrome CDP, fixture :8245, B1–B4 pattern):
fixture `public/modal-validation.html` — `#open-modal` button
(aria-haspopup=dialog) opening a `role=dialog` with an input + Cancel button;
Escape-while-focused dismiss; Cancel-button dismiss; nested dialog;
`.overlay > .backdrop` in-overlay click; a roleless sibling popover (B3
backdrop-b parity); late-dialog leg (open at +600ms).
Checks: M1 open card typed Modal (prio 75, why-block); M2 Escape card typed
Modal dismiss-escape; M3 Cancel still Click; M4 nested innermost claims; M5
in-overlay backdrop still Click; M6 IR = [click(keyboardShortcut?)…] open→
CLICK, Escape → keyboardShortcut kind:none, zero select (B2 parity); M7
recorded Ctrl-shortcut renders + executes (F3 closure); M8 late-dialog
newSurfaces captured on the opener's window (F4 truth, whatever it is); M9
zero panel console errors; M10 backdrop-b still Unclassified+flag (B3 parity).

House regressions: run the full matrix at R3's listed counts; suite green at
the grown count; tsc exactly 8.

## §6 Acceptance criteria (checkboxes)

- [x] B5-1-1 `Modal` in InteractionType union (20 members); count pin updated
- [x] B5-1-2 modal.ts definition @ 75, both branches, immediate completion
- [x] B5-1-3 registry entry; count pin 18; sort-order pin (Link < Modal < Expander)
- [x] B5-1-4 open gate: strict `ariaHasPopup === 'dialog'` only; haspopup=true/menu/listbox/absent/undefined → null (each pinned)
- [x] B5-1-5 both-present → Modal wins (Expander declined for same event)
- [x] B5-1-6 IR: open → CLICK, element target, locator preserved
- [x] B5-1-7 description case + plain-English for both actions
- [x] B5-1-8 DDC-3 allowlist includes Modal
- [x] B5-1-9 badge map entry 75 + TYPE_DISPLAY + why-block lines; fs-parse sync pin passes
- [x] B5-2a-1 dismiss gate: Escape + (self | ancestry dialog/alertdialog)
- [x] B5-2a-2 Escape-on-body → null (stays Unclassified; honest limit pinned)
- [x] B5-2a-3 nested: innermost dialog ancestry claims; name carries dialog fact
- [x] B5-2a-4 same-element absorption limit documented in spec + pinned as NOT claimed (existing semantic preserved)
- [x] B5-2a-5 bare non-Escape keys → null; modifier-Escape → KeyboardShortcut (not Modal)
- [x] B5-2b-1 in-overlay backdrop still Click + IR click (pin)
- [x] B5-2b-2 sibling backdrop still Unclassified + actionability flag (pin)
- [x] B5-2c-1 renderer case: keyboard.press from input; NoTarget not locator-rendered
- [x] B5-2c-2 both executors: keyboardShortcut case, keydown+keyup on activeElement/document
- [x] B5-2c-3 bridge: Modal-dismiss → KEYBOARD_SHORTCUT + NoTarget + input 'Escape'
- [x] B5-2c-4 ir-executor-impl skips locator resolution for non-element targets
- [x] B5-2c-5 F3 regression: recorded Ctrl-shortcut renders + executes
- [x] B5-2c-6 native-<dialog> synthetic-key fidelity limit documented (pinned comment/test)
- [x] B5-3-1 harness-74b5 10/10 with dumps preserved
- [x] B5-3-2 F4 late-dialog truth recorded (captured or honest finding + disposition)
- [x] B5-4-1 modal-tracker.ts deleted; zero references; suite green
- [x] R1–R12 all pinned/green; house matrix at documented counts; tsc exactly 8
- [x] ZIP v10.9.x rebuilt; four-way identity; README provenance updated
- [x] reviewer + infra_verifier PASS; real-Chrome E2E green
- [x] two-commit closure (src+tests / spec+evidence+roadmap+handover), owner-gated publish

## §7 Honest limits (accepted, documented)

1. Escape on a same-element-focused input (TextEntry lifecycle active) is
   silently absorbed as a memberEvent — existing typing semantic, not changed.
2. Escape-on-body (no focus trap) has no dialog signal → stays Unclassified.
3. Native `<dialog>` cannot be closed by the synthetic executor keypress;
   Playwright render covers it.
4. Roleless class-styled overlays produce no surface rows (RCA scenario C) —
   sibling-backdrop stays Unclassified; evidence-gated dismissal derivation
   remains parked with the promotion family (roadmap).
5. KR fragmentation for dialog triggers previously typed Click/Expander
   (cold-restart, demote-not-destroy — B1 accepted-cost precedent).
6. `DRAG_DROP` renderer gap out of scope (separate disposition).

## §8 Closure discipline (owner-gated)

Two commits on approval: (1) src + tests, (2) spec + evidence + docs.
Docs commit updates ENGINEERING-HANDOVER §Layer 6 (definition count, Modal
row, KEYBOARD_SHORTCUT replay note) and ROADMAP (B5 entry + NEXT).
No publish without owner approval. D1 stays closed.
