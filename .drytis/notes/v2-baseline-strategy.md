# Strategy Assessment: Baseline Selection for v2.0 Foundation Rebuild

## 1. Best Baseline Version

### Recommendation: `4c6b0b8` (tagged `v2.0.0-pre-datagrid`)

This is the cleanest foundation. It's the explicit checkpoint commit "Stable Recorder Before Enterprise Data Grid Recording" — the exact point before enterprise components were introduced.

**What it contains (15 content scripts — all core):**
- click, text-entry, dropdown, checkbox, radio, toggle, date-picker, slider, multi-select, file-upload, file-download, hover, scroll, right-click, drag-drop

**What it does NOT contain (zero enterprise contamination):**
- No grid, tree-view, rich-text-editor, modal-dialog, tabs, accordion, stepper, scheduler
- No enterprise types in interaction-types.ts, recording-session.ts, step-builder.ts, service-worker.ts, types.ts
- No enterprise test files

### Why NOT `a6c5045` (v1.16.0) or `b06aef4` (v1.16.1)

v1.16.0 introduced Data Grid recording (the first enterprise component). v1.16.1 was a stability fix for that grid implementation. Both already have enterprise contamination in the pipeline layers (types.ts, interaction-types.ts, recording-session.ts, step-builder.ts, service-worker.ts all carry grid-specific code). Starting from `4c6b0b8` avoids having to surgically remove enterprise code from the pipeline.

---

## 2. What Would Be Lost

### Must Be Reintroduced Later (Enterprise Components)

| Component | Lines | Reintroduction complexity |
|-----------|-------|--------------------------|
| grid-content-script.ts | ~650 | Medium — complex but well-isolated |
| tree-view-content-script.ts | ~480 | Medium |
| rich-text-editor-content-script.ts | ~711 | Medium |
| modal-dialog-content-script.ts | ~646 | Medium |
| tabs-content-script.ts | ~366 | Low |
| accordion-content-script.ts | ~406 | Low |
| stepper-content-script.ts | ~640 | Medium |
| scheduler-content-script.ts | ~909 | High |

### NOT Lost (Preserved in Git History)

**Nothing is lost permanently.** All enterprise code exists in tagged releases (v1.16.0–v1.24.2). When we reintroduce enterprise components, we can cherry-pick or copy from these versions and adapt them to the new ownership model.

---

## 3. Reusable Improvements to Retain

### Critical: Keep the v1.24.x Hover Improvements

The hover-content-script.ts went from 383 lines (baseline) to 907 lines (current) with massive improvements:

| Improvement | Introduced | Value |
|-------------|-----------|-------|
| Two-layer detection (semantic + observable effect) | v1.24.0 | Eliminates noise from incidental mouse movement |
| hoverVariant classification (menu_reveal, tooltip_display, etc.) | v1.24.0 | Intent-based Plain English |
| Same-element click suppression (mousedown cancel) | v1.24.2 | Eliminates "Hover Done" + "Click Done" duplicates |
| Portal tooltip fallback | v1.24.1 | Catches MUI/AntD/Radix portal tooltips |
| aria-haspopup semantic check | v1.24.1 | WAI-ARIA standard popup detection |
| aria-describedby in attributeFilter | v1.24.1 | Dynamic tooltip detection |

**Recommendation:** Port the current hover-content-script.ts into the baseline. Remove the hoverVariant field from types.ts and interaction-types.ts if we're reverting those to baseline, but the content script itself is pure improvement. Alternatively, keep hoverVariant in types — it's additive and doesn't hurt.

### Consider: Keep the `data-cmdrunner-handled` Signal Pattern

Even though no enterprise scripts exist in the baseline, building the handled-signal mechanism into click-content-script.ts NOW means it's ready when enterprise components are reintroduced. This is a 5-line addition to click-content-script.ts:

```typescript
// Skip if an enterprise content script already handled this click
if (target.closest('[data-cmdrunner-handled]')) return;
```

### Consider: Keep Improved Element Identity Engine

If the element identity engine was improved post-baseline (Shadow DOM detection, better accessible name computation), keep those improvements. They benefit ALL interactions.

### Do NOT Keep

| Change | Why Discard |
|--------|-------------|
| 8 enterprise content scripts | Premature — will reintroduce with new ownership model |
| Enterprise types in types.ts (SchedulerEvent, ModalDialogEvent, etc.) | Pollutes the type system — reintroduce with component |
| Enterprise configs in interaction-types.ts | 947 lines of enterprise registry code |
| Enterprise switch cases in recording-session.ts | Adds 8 action types to the session |
| Enterprise params in step-builder.ts (31 extra positional params) | Makes the function signature unwieldy |
| Enterprise handlers in service-worker.ts (8 extra cases) | Pipeline complexity |
| Enterprise test files (8 files, ~600 tests) | Test enterprise-specific behavior |

---

## 4. Rebuild Strategy

### Phase 0: Create the v2.0 Baseline Branch

```
4c6b0b8 (v2.0.0-pre-datagrid)
    │
    ├── Port in the current hover-content-script.ts (v1.24.2)
    │   (revert types.ts hoverVariant to optional if desired)
    │
    ├── Add data-cmdrunner-handled check to click-content-script.ts
    │
    ├── Port any element identity engine improvements
    │
    └── This becomes the v2.0.0-alpha baseline
```

### Phase 1-15: Harden Each Core Interaction

Follow the 15-item roadmap. For each:
1. Deep-read the content script
2. Test on real-world websites
3. Identify weaknesses
4. Fix and validate
5. Move to next

### Phase 16+: Reintroduce Enterprise Components

With the foundation solid and the ownership model proven:
1. Reintroduce enterprise components one at a time
2. Each must use the `data-cmdrunner-handled` signal
3. Each must pass high-confidence evidence checks
4. Enterprise ownership is earned, not assumed

---

## 5. Alternative Approach: Selective Stripping (NOT Recommended)

Instead of reverting to `4c6b0b8`, we could strip enterprise code from the current HEAD:

**Pros:**
- Keeps all post-baseline improvements to core scripts
- No need to port hover improvements

**Cons:**
- Requires surgical removal of enterprise code from 7 pipeline files (types.ts, interaction-types.ts, recording-session.ts, step-builder.ts, service-worker.ts, manifest.json, ai-understanding.ts)
- High risk of leaving orphaned references (type imports, switch cases)
- The pipeline files are deeply entangled with enterprise types
- More complex than starting clean and porting forward

**Verdict:** Reverting to baseline + porting forward is cleaner and lower-risk.
