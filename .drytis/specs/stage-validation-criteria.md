# Stage Validation Criteria — Migration Plan

> Each stage ends with a **working extension** you can install and test.
> You must explicitly approve before the next stage begins.
>
> **How to install the extension during testing:**
> 1. Download the ZIP from the download link
> 2. Unzip
> 3. `chrome://extensions` → Enable Developer mode → Load unpacked → Select the unzipped folder
> 4. For feature flag toggle: extension popup → Settings → Recorder Engine

---

## Stage 1 — Production Control Model Module

### What works when complete
The validated discovery and matching algorithms exist as production source
files under `src/recorder/v2/`. They compile, type-check, and pass unit tests.
**Nothing is wired to the extension yet** — this is infrastructure that
subsequent stages import.

### What you should manually test
**Nothing in the extension.** This stage has no user-visible effect. You can
review the code and run tests, but the extension behaves identically to before.

### What remains unchanged
Everything. The extension you download after Stage 1 is byte-for-byte
identical in behavior to the one you have now.

### What new behaviour to expect
None. This is purely a code addition.

### Automated tests that must pass
| Suite | Count | What it proves |
|-------|-------|----------------|
| milestone2 event-matching (ported to import production source) | 34 | Control Model discovers controls and matches events correctly across 8 framework suites |
| milestone3 sync-identity (ported) | 23 | Controls survive re-renders, mutations tracked, identity stable |
| Full regression suite | 3,400+ | No existing functionality broken |
| TypeScript compilation | — | New modules compile cleanly |
| Build (`npm run build`) | — | Extension bundles successfully |

### Acceptable limitations
- No user-visible feature works yet
- No event capture occurs through the Control Model
- The new modules are imported only by tests, not by the extension runtime

### Rollback conditions
- TypeScript compilation fails and cannot be fixed
- Any regression in the existing 3,400+ test suite
- Build fails

**Rollback action:** Delete `src/recorder/v2/` directory. Zero impact.

---

## Stage 2 — New Content Script (Capture Layer)

### What works when complete
When the feature flag is set to `'control'`, the extension injects a new
content script that uses the Control Model for target resolution. Raw events
arrive at the service worker with **correct target identification** — the
right element name, the right role, the right control.

The downstream pipeline (V1/V2 classifier → merge → domain adapter →
enrichment → IR bridge → Playwright) is unchanged. So the classification
*types* still come from the old engine, but the *target data* feeding them
is now correct.

### What you should manually test

**Test A — Feature flag toggle**
1. Set flag to `'legacy'` → record → confirm behavior is identical to today
2. Set flag to `'control'` → record → confirm the extension still works (no crash, no console errors)

**Test B — Target identification (flag: `'control'`)**
Record on OrangeHRM My Info and check the **raw event timeline** in the side panel (not the final interactions — those still use the old classifier):

| Action | What you should see in the timeline |
|--------|--------------------------------------|
| Click Nationality dropdown | Target name contains "Nationality" — NOT "Blood Type" |
| Click Marital Status dropdown | Target name contains "Marital Status" — NOT "Blood Type" |
| Click Save button (on the icon) | Target name is "Save" — NOT "I" |
| Click Female radio | Target name is "Female" — NOT the wrapper div |
| Type in First Name field | Target name is "First Name" |

**Test C — No regression (flag: `'legacy'`)**
Switch back to `'legacy'` and record the same workflow. Confirm behavior is exactly as before — same bugs, same output. This proves the flag works and old code is untouched.

**Test D — Basic recording on a simple page**
Flag: `'control'`. Record on any simple HTML form (e.g., a login page with semantic `<input>`, `<button>`, `<select>`). Confirm events appear in the timeline with correct names.

### What remains unchanged
- **Classification**: The V1/V2 classifier still determines interaction types (TextEntry, Checkbox, DatePicker, etc.)
- **Interaction list**: The detected interactions in the stopped view come from the old classifier — they may still be wrong (e.g., fragmented date picker) because the classifier hasn't changed yet
- **IR steps and Playwright code**: Generated from old classifier output
- **Side panel layout**: Identical
- **Enrichment, repository, execution**: Identical
- **Dev view** (batch counts + captured interactions): Identical

### What new behaviour to expect
- Raw events in the timeline show **correct target names** when flag is `'control'`
- Clicking an icon inside a button resolves to the button name, not the icon
- Clicking a dropdown trigger resolves to the dropdown label, not a sibling
- No behavioral change when flag is `'legacy'`

### Automated tests that must pass
| Suite | Count | What it proves |
|-------|-------|----------------|
| milestone2 event-matching (production import) | 34 | Match logic correct in production code |
| Control-recorder integration tests | ~15 (new) | Content script builds correct RECORDED_EVENT messages |
| Feature flag routing tests | ~5 (new) | Flag correctly selects which CS to inject |
| Full regression suite | 3,400+ | Legacy path unaffected |

### Acceptable limitations
- Interaction types in the stopped view may still be wrong (old classifier)
- Date picker may still fragment (classifier issue, fixed in Stage 3)
- Dropdown options may not be recognized as "select" (classifier issue)
- The Playwright code still has the old bugs (wrong locators derived from correct-but-misclassified events)
- Only tested on OrangeHRM OXD + semantic HTML; other frameworks untested

### Rollback conditions
- Extension crashes on startup when flag is `'control'`
- Console errors during recording on OrangeHRM
- Feature flag toggle doesn't work (can't switch back to legacy)
- Any regression when flag is `'legacy'`
- No events appear in the timeline when flag is `'control'`

**Rollback action:** Set flag to `'legacy'`. Old content script resumes instantly.

---

## Stage 3 — New Classifier (Recognition Layer)

### What works when complete
When the feature flag is `'control'`, the **entire capture + classify pipeline**
runs through the Control Model. The InteractionRecognizer produces correct
semantic actions that feed directly into the existing domain adapter and
downstream pipeline. No V1, no V2, no merge layer.

This is the stage where the **v10.4.18 bugs are fixed**.

### What you should manually test

**Test A — Full OrangeHRM My Info workflow (flag: `'control'`)**
Record the 9-step workflow and verify in the **stopped view interactions list**:

| Step | Expected Verb | Expected Target | Expected Value |
|------|--------------|-----------------|----------------|
| 1. Login | (separate page) | — | — |
| 2. Navigate to My Info | navigate | My Info | — |
| 3. Edit First Name | fill | First Name | John |
| 4. Edit Last Name | fill | Last Name | Doe |
| 5. Select Nationality | select | Nationality | American |
| 6. Select Marital Status | select | Marital Status | Single |
| 7. Select Gender | select | Female | — |
| 8. Select Date of Birth | selectDate | Date of Birth | 15 |
| 9. Click Save | click | Save | — |

Verify:
- Exactly 7 interaction steps for the My Info page (steps 3–9)
- **No "Select Blood Type"** when clicking Nationality or Marital Status
- **No "Click I"** when clicking the Save icon
- Date of Birth is a **single step**, not fragmented into open/calendar/close
- No duplicate steps from label→input synthetic clicks

**Test B — v10.4.18 regression check**
Confirm NONE of the original bugs appear:
- Nationality resolves to "Nationality", not "Blood Type" ✓
- Marital Status resolves to "Marital Status", not "Blood Type" ✓
- Save icon resolves to "Save", not "I" ✓
- Date picker is one step, not 3+ ✓
- Radio selection is one step, not duplicated ✓

**Test C — Semantic HTML form (flag: `'control'`)**
Record on a basic HTML form with native `<input>`, `<select>`, `<button>`, `<a>`.
Confirm:
- Text input produces "fill" with correct label
- Native dropdown produces "select" with correct label and value
- Button produces "click" with correct text
- Link produces "navigate" with correct text

**Test D — Generated Playwright code (flag: `'control'`)**
After recording the OrangeHRM workflow, check the generated Playwright code:
- Locators use `getByRole` or `getByLabel` with correct names
- No locator references "Blood Type" when the action is about Nationality
- Date picker step is a single `fill()` call, not multiple click() calls
- Code is syntactically valid (you can paste it into a `.spec.ts` and it parses)

**Test E — No regression (flag: `'legacy'`)**
Switch to `'legacy'`, record the same workflow, confirm the old bugs are still
there (proving old code is untouched and the flag works).

### What remains unchanged
- **IR bridge**: Still maps DetectedInteraction → IRStep
- **Playwright generator**: Still renders IR steps to code
- **Enrichment**: Still runs the 7-step enrichment pipeline
- **Side panel**: Same views, same sections
- **Storage**: Same keys, same format
- **Repository, execution**: Identical

### What new behaviour to expect
- **Correct interaction types**: Dropdowns recognized as "select", not "Unknown"
- **Correct targets**: Every interaction has the right element name
- **No fragmentation**: Compound interactions (dropdown open→select→close, date picker open→select day→close) produce a single step
- **Correct deduplication**: Label→input synthetic clicks produce one step, not two
- **Correct verbs**: fill, select, toggle, selectDate, click, navigate
- **Better Playwright locators**: Because targets are correct, locators derived from them are correct

### Automated tests that must pass
| Suite | Count | What it proves |
|-------|-------|----------------|
| milestone5 acceptance (production import) | 28 | All 12 interaction categories produce correct verb/target/value |
| Recognizer-adapter tests | ~15 (new) | SemanticAction → DetectedInteraction conversion correct |
| Full regression suite | 3,400+ | Legacy path unaffected |
| TypeScript compilation | — | Clean |
| Build | — | Extension bundles |

### Acceptable limitations
- Domain adapter still does the full RecordedEvent → Entity chain (simplified in Stage 4)
- Enrichment operates on the same quality of data as before (may not improve until Stage 4)
- Hover interactions not yet implemented (deferred — see Stage 3 spec)
- Drag & drop, file upload not yet implemented
- Multi-select, tree view, context menu not yet implemented
- Rich text editor not supported
- Only OXD, MUI, Ant Design, and semantic HTML are framework-tested; other frameworks may have gaps
- Scroll coalescing uses a simple time window; complex scroll patterns may over/under-coalesce

### Rollback conditions
- Any interaction type from the acceptance test suite produces wrong verb or target
- v10.4.18 bugs reappear
- Extension crashes during Stop processing
- No interactions appear in the stopped view
- Playwright code generation fails (empty output, syntax errors)
- Console errors during recording or stop processing
- Any regression when flag is `'legacy'`

**Rollback action:** Set flag to `'legacy'`. Old classifier resumes instantly.

---

## Stage 4 — Domain Adapter Simplification

### What works when complete
When the flag is `'control'`, the domain adapter maps SemanticActions directly
to domain entities (UiElement + ObservedTransition), bypassing the old
event-grouping and recognition orchestrator. This is simpler, faster, and
passes richer data to enrichment.

### What you should manually test

**Test A — Same workflow, same output (flag: `'control'`)**
Record the OrangeHRM 9-step workflow. Compare the output to Stage 3:
- Same number of steps
- Same verbs, targets, values
- Same (or better) Playwright code

**Test B — Enrichment quality**
Check the enrichment-derived data in the stopped view:
- Component groupings (dropdown, radio group, etc.) are present
- Option sets for dropdowns show selected value
- Interaction contracts show field constraints

**Test C — Post-stop processing speed**
Record a longer session (20+ interactions). The time from clicking Stop to
seeing results should be noticeably faster than Stage 3.

**Test D — No regression (flag: `'legacy'`)**
Confirm legacy path unaffected.

### What remains unchanged
- Capture (Control Model) — Stage 2
- Classification (InteractionRecognizer) — Stage 3
- Enrichment, IR bridge, Playwright, side panel, storage, repository — all unchanged

### What new behaviour to expect
- Faster post-stop processing
- Potentially richer enrichment data (because SemanticActions carry control
  role, parent group name, and other context the old RecordedEvent didn't)
- IR steps should be identical to Stage 3 (same logic, different source data path)

### Automated tests that must pass
| Suite | Count | What it proves |
|-------|-------|----------------|
| Domain adapter tests (new) | ~12 | SemanticAction → UiElement + Transition mapping correct |
| IR bridge regression tests | existing | IR steps unchanged from Stage 3 output |
| Playwright output diff tests | ~8 (new) | Generated code identical or improved vs Stage 3 |
| Full regression suite | 3,400+ | Legacy path unaffected |

### Acceptable limitations
- Same interaction type limitations as Stage 3 (hover, drag&drop, file upload, etc.)
- Enrichment quality improvement is incremental, not transformative
- The recognition orchestrator code still exists but is bypassed

### Rollback conditions
- IR steps differ from Stage 3 in a way that makes Playwright code worse
- Enrichment produces errors or empty output
- Post-stop processing is slower, not faster
- Any regression when flag is `'legacy'`

**Rollback action:** Set flag to `'legacy'`.

---

## Stage 5 — Parallel Validation (A/B Testing)

### What works when complete
Both pipelines run simultaneously during a single recording session. After
Stop, the side panel shows results from both the legacy pipeline and the
Control Model pipeline side by side. You can compare step counts, interaction
accuracy, target names, and generated Playwright code.

### What you should manually test

**Test A — Side-by-side comparison on OrangeHRM**
Record the 9-step workflow. In the comparison view:
- Count legacy steps vs control steps
- Check target names side by side
- Compare Playwright code

**Test B — Test on 5+ different websites/frameworks**
Record the same simple workflow (fill a form, click a button, select a
dropdown) on:
1. OrangeHRM (OXD)
2. A semantic HTML page
3. A MUI-based page
4. An Ant Design page
5. A Bootstrap page

Compare old vs new for each.

**Test C — Edge cases**
Record on pages with:
- Shadow DOM elements
- SPA navigation (React Router)
- iframes
- Dynamic content (AJAX-loaded forms)

### What remains unchanged
- When flag is `'legacy'`: only legacy pipeline runs (identical to today)
- The A/B comparison is additive — it doesn't change either pipeline's output

### What new behaviour to expect
- Side panel shows a new comparison section after Stop
- Both result sets are stored (can be reviewed later)
- Recording may be slightly slower (two capture layers running)

### Automated tests that must pass
| Suite | Count | What it proves |
|-------|-------|----------------|
| milestone5 behavioral parity | 10 | New pipeline produces correct output matching expected behavior |
| Comparison rendering tests | ~5 (new) | Side panel comparison view renders without errors |
| Full regression suite | 3,400+ | Both paths work independently |

### Acceptable limitations
- Performance impact from running both capture layers (expected, temporary)
- Comparison view is basic (counts + text diff, not visual diff)
- Only the capture + classify layers are compared; enrichment onward is single-path

### Rollback conditions
- Running both pipelines causes crashes or memory issues
- Side panel rendering breaks
- Any regression when flag is `'legacy'`

**Rollback action:** Set flag to `'legacy'`. Comparison view disappears.

---

## Stage 6 — Cutover (Old Code Disabled)

### What works when complete
The feature flag defaults to `'control'`. The old recorder code still exists
in the codebase but is not loaded by the extension. The manifest no longer
references `deterministic-recorder.ts`. The old classifier code path is
unreachable.

The `'legacy'` flag option still exists as a fallback.

### What you should manually test

**Test A — Full re-test of all interaction types**
Record workflows that exercise every implemented interaction type:

| Interaction | Where to test | Expected verb |
|-------------|--------------|---------------|
| Text entry | Any form input | fill |
| Button click | Any button | click |
| Link navigation | Any `<a>` | navigate |
| OXD dropdown | OrangeHRM selects | select |
| Native dropdown | HTML `<select>` | select |
| Radio button | OrangeHRM gender | select |
| Checkbox | OrangeHRM smoker | toggle |
| Date picker | OrangeHRM DOB | selectDate |
| Scroll | Any scrollable page | scroll (coalesced) |

**Test B — Extended recording sessions**
Record a session with 20+ interactions. Verify:
- No performance degradation
- No memory leaks (extension doesn't slow down over time)
- All interactions captured

**Test C — SPA navigation resilience**
Record across multiple page navigations in an SPA (React/Angular/Vue app).
Verify the Control Model re-discovers controls after each route change.

**Test D — Fallback**
Set flag to `'legacy'`. Confirm old recorder still works (it's still present,
just not default).

**Test E — Console health**
Record on 5+ different websites. Check DevTools console for:
- No JavaScript errors
- No unhandled promise rejections
- No excessive logging

### What remains unchanged
- Everything from Stage 4's "unchanged" list
- The old code physically exists (just not loaded)

### What new behaviour to expect
- Old recorder is no longer injected on any page
- Slightly faster extension load (one less content script to parse)
- Flag defaults to `'control'` on fresh install

### Automated tests that must pass
| Suite | Count | What it proves |
|-------|-------|----------------|
| All milestone suites | 111 | Complete behavioral validation |
| Full regression suite | 3,400+ | No regressions |
| Cutover integration tests | ~10 (new) | Flag defaults correctly, old code not loaded |
| Build | — | Extension bundles without old recorder reference |

### Acceptable limitations
- Same interaction type limitations as Stage 3/4
- The old code is present but dead — slightly larger bundle until Stage 7
- `'legacy'` fallback still available but no longer the default

### Rollback conditions
- Any regression in interaction capture quality vs Stage 5
- Performance regression vs Stage 5
- Crash on any of the 5+ test websites
- SPA navigation loses controls
- Generated Playwright code is invalid

**Rollback action:** Re-add `deterministic-recorder.ts` to manifest,
set flag default to `'legacy'`. ~5 minutes.

---

## Stage 7 — Cleanup (Old Code Removed)

### What works when complete
The old capture and classification code is deleted from the codebase.
The extension is smaller, the codebase is cleaner, and there is one pipeline.

### What you should manually test

**Test A — Full regression re-test**
Repeat the full interaction type test from Stage 6. Output should be identical.

**Test B — Extension size**
Confirm the extension ZIP is smaller (old code removed).

**Test C — No references to old code**
Search the codebase for any remaining imports of deleted modules. There should
be none.

### What remains unchanged
- All behavior from Stage 6 — this stage only deletes dead code
- No functional change whatsoever

### What new behaviour to expect
- Smaller extension bundle
- Cleaner codebase
- No other behavioral change

### Automated tests that must pass
| Suite | Count | What it proves |
|-------|-------|----------------|
| All milestone suites | 111 | Behavior unchanged after deletion |
| Full regression suite | 3,400+ | No regressions from deletion |
| TypeScript compilation | — | No broken imports |
| Build | — | Extension bundles cleanly |

### Acceptable limitations
- The `'legacy'` flag option is removed (no old code to fall back to)
- Git history is the only rollback path

### Rollback conditions
- Any regression at all (the deleted code should have been dead code — any
  regression means it wasn't actually dead)
- TypeScript compilation breaks (dangling import)

**Rollback action:** `git revert` the cleanup commit. ~10 minutes.

---

## Quick Reference: Stage Exit Criteria Summary

| Stage | Key Deliverable | You Approve When… |
|-------|----------------|-------------------|
| 1 | Control Model in production source | All tests pass, build succeeds |
| 2 | Correct targets in event timeline | Raw events show right names on OrangeHRM, flag toggle works |
| 3 | Correct classified interactions | 9-step workflow produces 7 correct steps, no v10.4.18 bugs |
| 4 | Simplified domain pipeline | Same output as Stage 3, faster processing |
| 5 | Side-by-side comparison view | 5+ workflows compared, new ≥ old on all |
| 6 | New pipeline is default | Full re-test passes on all interaction types, 5+ websites clean |
| 7 | Old code deleted | Zero regressions, smaller bundle |

---

## Manual Test Cheat Sheet

### Always test (every stage from 2+)
1. **Flag toggle works**: Switch between `'legacy'` and `'control'`, confirm both function
2. **OrangeHRM My Info**: Record the 9-step workflow, check targets
3. **Console health**: No errors during recording or stop

### Stage-specific tests
- **Stage 2**: Focus on raw event timeline (target names)
- **Stage 3**: Focus on detected interactions (verbs + targets + values) and Playwright code
- **Stage 4**: Focus on processing speed and enrichment quality
- **Stage 5**: Focus on A/B comparison across multiple frameworks
- **Stage 6**: Focus on stability and SPA resilience
- **Stage 7**: Focus on regression (nothing should change)
