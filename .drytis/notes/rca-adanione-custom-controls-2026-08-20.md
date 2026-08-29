# RCA — AdaniOne flight-booking recording (Runs 1–3, live site, user-supplied screenshots)

Read-only RCA. Sources: user screenshots (batches 1–3, 2026-08-20 16:27–16:37Z), code at HEAD 65c67e2, prior note c5.2-custom-dropdown-defect-postmortem.md. No code changed.

## Intended sequence (user-stated)
Services hover → Book Flight → navigate → One Way arrow → Round Trip → 1 Economy arrow → +Adult → +Children → Premium Economy → Done → Chennai (From) → Bangalore (To) → departure date → return date.

## Captured (Run A, recognized cards) vs Run B (Unclassified cards, different run)
- Run A recognized: int-2 Hover 'Services' (0ms lifecycle-complete); int-6 Link 'Book Flight' (117ms page-reload, 15 net); int-7 Navigate (390ms stabilized, 19 net); int-10 Click 'element' (I icon-arrow-down, 318ms consequence-settled); int-15/17 'Click on element dialog' (I icon-plus ×2, Dialog tag, 344/620ms); int-20 Click on 'Done' dialog (BUTTON 'Done', children 0→1, 394ms, 25 DOM); int-28 Enter 'Chennai' From-DEL (4968ms, value New Delhi→Chennai, placeholder DEL→MAA); int-30 Enter 'Bangal' To-BOM (6605ms, Mumbai→Bangalore, BOM→BLR); int-32 Dropdown (12147ms displaced, target DIV '1Economy', state 1Economy→3Premium Economy, description 'Choose Saturday, September 5th…'); int-33 Enter 'Fri, 21 Aug' Depart on (3325ms, →Sat 05 Sep, 4× flightbookingv2 API GET 200); int-38 Enter 'Sun, 06 Sep' Return on (2899ms, →Tue 27 Oct, NEW SURFACES role=alert ×2).
- Run B Unclassified (post-stop transient view): int-43/44 date cells; int-47/48 'Round Trip'; int-52/53 'Premium Economy'; int-56/57 'Chennai, India'; int-59/60 'Bangalore, India'; int-62 date cell; int-65/66 '12h 10m'; int-67/68 Air India flight card. EVERY logical click = mousedown card + click card pair. Plus orphan windows 'Window: 0ms · sw-recovered-form-submit' (Unknown element, analytics-only). Footer: IR Plan — Test Steps 14.

## Root causes (all verified in code at 65c67e2)

### RC1 — Unclassified classification of custom-widget clicks (generic)
Nameless custom-widget elements (div/span/i; no role=button/option, no option class) match NO ComponentDefinition. Definitions require semantic hooks (dropdown.ts isDropdownTrigger: SELECT/combobox/listbox role or trigger class RE; option completion: role=option or DROPDOWN_OPTION_CLASS_RE=oxd-select-option|select-option|option-item|list-option|ant-select-item). AdaniOne +/- steppers and option list items are plain divs → fall through all 15 definitions → EvidenceLedger disposition 'unclaimed' → projection-engine.ts projects an Unclassified interaction per unclaimed ENTRY (metadata.reason 'unclaimed-at-projection', physicalEventType preserved). This is the capture-guarantee v2 design — data preserved, classification honest. Run B's Unclassified cards DO carry real accessible names ('Premium Economy', 'Chennai, India') via innerText tier-6 of computeAccessibleName — naming works; only classification falls back.

### RC2 — mousedown+click duplication (generic, projection-level)
Both physical events (mousedown, click) are ledgered as separate entries. Recognized lifecycles absorb both (member events). Unclaimed entries are projected 1:1 — no pairing — so each nameless click renders as TWO cards (physical: mousedown + physical: click). IR is unaffected (ir-bridge NOISE_TYPES filters ALL Unclassified before steps → hence Run B still produced 14 steps). Timeline-UX-only duplication.

### RC3 — 'element' vacuous descriptions for icon-only targets (generic)
bestName() (definitions/patterns.ts:29) returns literal 'element' when accessibleName/ariaLabel/placeholder all empty. Icon-only <i> elements (icon-plus, icon-arrow-down) have no text/aria/title/alt (computeAccessibleName tiers 1–11 all miss; innerText empty). The class tokens ARE captured (visible in Target Evidence) but never consulted for naming. Display-only degradation; locators/state evidence unaffected.

### RC4 — Economy dropdown date-picker description + late capture (generic open-lifecycle ownership weakness)
dropdown.ts lifecycle: trigger = DIV 'PaxAndClass-selectbox' (matched trigger class RE via 'select'). Completion requires click/mousedown on isDropdownOption element. AdaniOne option rows (+/- steppers, 'Premium Economy' row) do NOT match option role/class → lifecycle stays open (shouldCancelOnOutside deliberately false since C5.2 portal fix; no aria-haspopup → surfaceRole null → no positive ownership test). The FIRST later click that DOES match option semantics — the departure-date calendar cell (aria-label 'Choose Saturday, September 5th, 2026', role inferred option in their combobox date picker) — completes the lifecycle: selectedValue = date-cell accessibleName → description 'Select "Choose Saturday…"' while targetName = '1Economy' (trigger, correct) and resultingState 1Economy→3Premium Economy (honest). Window displaced at 12147ms. Root: option-matching completion has no surface containment or trigger-state guard — ANY later option-role click anywhere on the page completes an open dropdown lifecycle. Same class of weakness for any app interleaving listbox-style widgets (date pickers, autocomplete lists) with custom selects.

### RC5 — 'Premium Economy captured late' (two stacked mechanisms)
(a) Classification level: the Premium Economy row click didn't complete the Economy lifecycle (RC4) and itself fell to Unclassified (RC1) — its EFFECT surfaces only inside the lifecycle's displaced close (state diff 1Economy→3Premium Economy). (b) Display level: repeated diffs ('One Way → Round Trip', form input diffs) in EVERY subsequent card = DOMObserver accumulated summaries clear only at TRUE boundaries (evidence-collector.ts:492-499 INV-C1 fix-pair-2: clear only when no other live window). Lifecycle-bound dropdown window held open for 12s → no boundary → cumulative summaries re-drained by each successive window. Honest per-design, but noisy attribution display.

### RC6 — Dialog tag (not a defect; enrichment working)
enrichment/component-detector.ts DIALOG_RE/role=dialog detects the PaxAndClass modal ancestor on the +/- icon clicks → componentType 'Dialog' → meaning-resolver 'Click on "element" dialog'. Generic, working as designed. (Distinct from P2 native-dialog evidence — none of these were alert/confirm/prompt.)

### RC7 — sw-recovered-form-submit orphans (previously known path)
INV-4 form-submit recovery windows render 'Unknown element' with 0ms and analytics-only network. Known recovery artifact; naming could improve.

## Verdict: generic, not AdaniOne-specific
All six mechanisms are generic recorder/semantic-classification behaviors: nameless-widget fallback, unpaired physical projection, icon-only naming gap, open-lifecycle option completion without containment, cumulative DOM accumulation, modal enrichment. AdaniOne merely exhibits the patterns (icon-only steppers, class-based custom select, role=option date cells) that many widget libraries share (OXD, MUI custom builds, react-day-picker option cells). No site-specific fix is appropriate; no site-specific logic exists in the pipeline.

## Smallest generic solution options (for approval — NOT implemented)
S1 (small, projection-local): pair consecutive Unclassified entries with identical elementKey where physical sequence is mousedown→click within ≤2s into one card (click wins). ~30 lines in projection-engine + tests. IR untouched (already filtered).
S2 (small, display-only): extend bestName with an icon-class tier — derive 'Plus icon'/'Arrow-down icon' from icon-font class tokens (icon-*, *-icon, material icon ligatures) before 'element' fallback. ~20 lines + tests. Kills 'Click "element"' vacuity.
S3 (small, guarded completion): dropdown completion requires trigger still aria-expanded=true (or no aria-expanded attr AND within ≤5s of trigger) when the completing option has no positive surface ownership; else lifecycle ends displaced with honest 'no selection captured' metadata. ~25 lines in dropdown.ts + tests. Fixes RC4/RC5a class of wrong-completion without reintroducing portal breakage.
S4 (optional, display): suppress transient Unclassified 'Collecting…' cards in stopped view until post-stop merge completes, or label them 'pending merge'. Panel-only.
S5 (optional, display): boundary-limited DOM summary re-drain — when draining accumulated summaries into a window that opened after a lifecycle-bound window displaced, carry only summaries newer than the previous window's open. Larger; touches INV-C1 semantics; recommend deferring.

Recommended: S1+S2+S3 (generic, small, evidence-preserving). S4/S5 optional UX follow-ups.

## Correction (2026-08-20, user review) — S1 and S3 AS WRITTEN were timing rules

User correctly rejected the S1 (≤2s pairing window) and S3 (≤5s trigger-recency) proposals for
violating the no-timing-rules agreement. Corrected structural root causes and replacements:
- RC2: pairing must use **captureSeq adjacency + elementKey equality** (browser-monotonic event
  ordering), not elapsed time. mousedown immediately followed by click on the same identity is a
  structural fact of the event stream, true regardless of how fast/slow the user clicks.
- RC4: completion gating must use **structural exclusion/containment**, not trigger age:
  calendar cells (isCalendarCell) can never complete a Dropdown; option clicks need positive
  containment proof (surfaceRole ancestry or non-calendar dropdown-surface class); an option click
  without proof parks as pendingOptionClick and the lifecycle ends abandoned (displaced) at the
  next different-target discrete event — an event-sequence boundary, not a clock.
Revised implementations (S1-prime/S2/S3-prime) specced in
.drytis/specs/structural-fixes-rca2-2026-08-20.md and implemented at working tree on top of 65c67e2.

## Implementation + validation results (2026-08-20 evening, S1'/S2/S3' structural)

Implemented (all no-timing): S2 icon-class naming tier (patterns.ts bestName + iconNameFromClasses
with fa-/mdi-/bi-/icon-/–icon families and ICON_NAME_OVERRIDES semantic map; wired into click.ts
fallback and dropdown buildResult; meaning-resolver prefers componentData.iconName over
icon-derived targetName); S1' projection pairing (pairPhysicalPress: same pageId + immediate
captureSeq adjacency + elementKey equality via D1 targetIdentity; consumed mousedown re-attached
as a synthetic memberEvent so the M4 capture-guarantee verification counts both physical events;
contextmenu/keydown/dragstart/drop never pair); S3' dropdown gating (calendar-cell exclusion by
class AND by W3C date-cell name shape via new hasDateCellName — "Choose Saturday, September 5th,
2026"; containment-proof completion via surface-class-ancestry or surfaceRole-in-ancestorRoles;
unproven option clicks park as pendingOptionClick and the lifecycle ends displaced on the next
different-target discrete event through shouldCancelOnOutside; buildResult carries honest
selectionConfirmed:false + provisionalSelection only when unproven; native SELECT unchanged).

TWO additional pre-existing defects found and fixed during validation (structural only):
1. stopRecording double-push: flush() emits through onEmit which already pushes into
   liveInteractions; the explicit liveInteractions.push(...flushed) duplicated every flushed
   lifecycle (previously masked because both copies were interrupted and production-filtered).
   Fix: stopRecording marks recordingStopped and does not re-push flush output.
2. Post-stop evidence clobber: handleBehavioralEvidence -> attachEvidenceToInteraction ->
   tryAttach -> persistLiveInteractions() could fire AFTER handleStopRecording wrote the projected
   production list, overwriting storage with the RAW list and erasing projected Unclassified
   cards (Round Trip / Premium Economy vanishing from the panel). Fix: recordingStopped flag —
   persistLiveInteractions no-ops once stopped (attach still mutates in place); flag re-armed in
   initRecording and restoreFromStorage, set in stopRecording and resetState.

VALIDATION MATRIX (all at working tree, dist rebuilt, ZIP repacked):
- Unit: 219 files / 4,032 tests green (34 new in tests/runtime/structural-fixes-rca2.test.ts).
- PaxAndClass sequence proof (new harness, .drytis/notes/evidence/paxandclass-seq-proof/):
  15/15 PASS — Round Trip (int-11 Unclassified, paired) < +Adult (int-2 'add icon') <
  +Children (int-4 'add icon') < Premium Economy (int-14 Unclassified, paired) < Done (int-6),
  seq order monotonic; 4 paired cards; no date-as-dropdown anywhere; M4 verification match=true;
  IR has no 'select date from dropdown' step.
- AdaniOne clone 30/30 gate: PASS (RUN_TEST 8/8, 13 assertions, codegen 5 files).
- a-slice: 35/35 PASS.
- R3 (incl. native select trusted-keyboard + CP8 same-session): 43/43 PASS.
- Amazon spot-check: 8/8 PASS (entity assertions replay-clean).
- dist bundle verified: pairing gate + date-name regex + icon naming present in
  service-worker-inline.js (minified), ZIP repacked (md5 f17e42b5…, 261,374 B).

Known honest behavior change: AdaniOne-style custom selects WITHOUT containment evidence
(no aria-haspopup, unknown surface classes) now end as unconfirmed/displaced Dropdowns with
provisionalSelection metadata instead of fabricating a confirmed selection from an unrelated
later option-role click; the selecting click itself surfaces as a paired Unclassified card at
its true position. IR unchanged (Unclassified already IR-filtered; Dropdown unconfirmed rows
carry no selectedValue so no SELECT IR step is emitted).
