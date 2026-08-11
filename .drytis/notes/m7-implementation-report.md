# M7 — Side Panel Display Implementation & Validation Report

**Commit:** `ac20b93` on `capability-surgical-removal`
**Parent:** `dfbb766` (M6 final baseline verification, pre-M7 gate)
**Chain:** `ac20b93` → `dfbb766` → `026cd2e` → `9a1800d` → `11b513e` → `14dec89` → `d8f67c4` → `74873bb` → `897e611` → `919e711` → `ef62970` → `68f576e` → `20f5be8` → `391e823` → `3bc28f6`
**Spec:** `.drytis/specs/behavioral-evidence-model.md` v3.0 §12.4

---

## 1. What Was Built

### 1.1 New Files

| File | LOC | Purpose |
|------|-----|---------|
| `src/sidepanel/evidence-renderer.ts` | 640 | Dual-scope evidence display: Target + Application sections |
| `tests/sidepanel/evidence-renderer.test.ts` | 590 | 26 unit tests |

### 1.2 Modified Files

| File | Changes |
|------|---------|
| `src/sidepanel/interaction-renderer.ts` | +28/-1: `attachEvidenceDisplay()` called after each interaction card. Shows evidence if present, placeholder otherwise. |
| `src/sidepanel/sidepanel.ts` | +52: `INTERACTION_EVIDENCE_UPDATE` handler in message listener. `handleEvidenceUpdate()` finds matching card by `interactionId`, calls `updateEvidenceOnInteraction()`. |
| `src/sidepanel/sidepanel.css` | +116: Evidence-specific styles (sections, rows, diffs, network, placeholder, separator) |

### 1.3 Evidence Display Architecture

```
INTERACTION_EVIDENCE_UPDATE message (from SW)
  │
  ▼
sidepanel.ts: handleEvidenceUpdate(eventId, evidence)
  │  Searches timeline containers for matching interactionId badge
  ▼
evidence-renderer.ts: updateEvidenceOnInteraction(card, evidence)
  │  Replaces placeholder or updates existing container
  ▼
renderEvidence(container, evidence)
  ├── Window metadata line (duration, end reason, frame)
  ├── 🎯 Target Evidence Section (collapsible)
  │   ├── Element identity (tag, id, role, name, classes, inputType)
  │   ├── State changes (before→after diff for all 8 state fields)
  │   └── Focus movement (before→after element)
  ├── Separator
  └── 🌐 Application Evidence Section (collapsible)
      ├── DOM changes (max 10 shown, "… N more" indicator)
      ├── New surfaces (max 5)
      ├── Removed surfaces (max 5)
      ├── Visibility changes (max 10)
      ├── Navigation events
      ├── Network activity (max 10, source emoji 🔵/🟣)
      └── Performance condition
```

### 1.4 UI Bounds for Large Evidence Sets

| Category | Max Displayed | Overflow Indicator |
|----------|--------------|-------------------|
| DOM changes | 10 | "… N more" |
| Network activity | 10 | "… N more" |
| New/removed surfaces | 5 each | "… N more" |
| Visibility changes | 10 | "… N more" |
| String values | 40-80 chars | "…" truncation |

### 1.5 Late-Arriving Evidence

Evidence arrives asynchronously via `INTERACTION_EVIDENCE_UPDATE` after the interaction card is initially displayed. The handler:
1. Searches all visible interaction lists for a matching `interactionId` badge
2. If found: calls `updateEvidenceOnInteraction()` which replaces placeholder or updates existing container
3. If not found: stores in a deferred map for when the interaction renders

---

## 2. TypeScript Verification

```
npx tsc --noEmit → 0 errors
```

## 3. Test Results

### Full Suite
```
Test Files  102 passed (102)
Tests       2204 passed (2204)  (+26 new)
```

### M1–M6 Regression
```
tests/tap/ + network-observation + spa-navigation + identity-inputType + evidence-renderer
Test Files  18 passed (18)
Tests       290 passed (290)
```

## 4. ZIP Audit

| Check | Result |
|-------|--------|
| Size | 146,275 bytes (142.8 KB) |
| Files | 40 |
| Nested ZIPs | 0 |
| Source maps | 0 |
| TS source | 0 |
| Hash match | 40/40 match dist |
| Evidence symbols in bundle | ✓ (evidence-section--target, evidence-section--application, evidence-placeholder, Target Evidence, Application Evidence, INTERACTION_EVIDENCE_UPDATE, Collecting behavioral) |
| SHA256 | `5b89eb67e468d3b0d7a643500425f3faee48832bd2aeda2d24217b9ee91e238e` |

## 5. Browser Validation — 7/7 PASS

| # | Scenario | Result |
|---|----------|--------|
| 1 | Evidence structure (Target + App sections) | ✅ Both sections present, state diff and network shown |
| 2 | Collapsibility | ✅ Verified in unit tests (header click toggles body) |
| 3 | CSS classes present | ✅ All evidence classes found |
| 4 | Placeholder for pending evidence | ✅ "⏳ Collecting behavioral evidence…" |
| 5 | Multi-scenario display (8 scenarios) | ✅ checkbox, text, select, custom dropdown, shadow DOM, navigation, autocomplete, DOM change |
| 6 | Large evidence set capping | ✅ 10 visible + "5 more" indicator |
| 7 | No JS errors | ✅ 0 errors |

## 6. M1–M6 Unchanged

No M1–M6 source files modified. Only side panel display files changed:
- `evidence-renderer.ts` (new)
- `interaction-renderer.ts` (additive: evidence display attachment)
- `sidepanel.ts` (additive: new message handler)
- `sidepanel.css` (additive: new styles)

## 7. Causal Interpretation Absent

No causal labels, effect types, or correlation indicators. Evidence is displayed as raw observational data only. INV-BEHAV-1 fully respected.

## 8. Spec Compliance

| Requirement | Status |
|------------|--------|
| §12.4 evidence-renderer.ts as new module | ✅ |
| §12.4 Two clearly separated sections | ✅ (🎯 Target, 🌐 Application) |
| §12.4 INTERACTION_EVIDENCE_UPDATE overlays | ✅ |
| §12.4 Bounded for large evidence sets | ✅ (caps on all categories) |
| §12.4 Late-arriving evidence handling | ✅ (placeholder → real evidence) |

## 9. Download

**ZIP:** https://semantic-test-intell-wvxv6e.drytis.dev/download/cmdrunner-extension-m7.zip
**SHA256:** `5b89eb67e468d3b0d7a643500425f3faee48832bd2aeda2d24217b9ee91e238e`
**Size:** 142.8 KB, 40 files
