# B7.2 Design Clarification — Same Element Detection

**Type:** Implementation Design Clarification (no code)
**Status:** FROZEN
**Date:** 2026-07-15
**Scope:** OR-1 (Focus-Click + Text-Entry Merge) matching strategy only

---

## The Product Rule (Unchanged, Frozen)

> **Merge a focus click and subsequent text entry only when both interactions refer to the same logical element.**

This is the product rule from B7.1. It is permanently frozen. It says nothing about which fields are compared.

## Implementation Choice: Composite Identity Key

### Strategy

Use a **composite identity key** derived from stable, per-element structural attributes captured by the recorder:

```
identityKey = tag | stableId | cssSelector
```

Two steps are "same element" if and only if their identity keys are identical (exact string comparison).

This is **not a new invention.** The existing click content script already uses this exact function (`identityKey()` at line 651 of `click-content-script.ts`) for double-click detection — the same "same element?" question. The key composition is proven in production.

### Why This Implementation Choice

| Factor | Assessment |
|---|---|
| **Both content scripts use the same `generateCssSelector()` algorithm** | ✅ Identical implementation — same strategy (ID-based if present, else `nth-of-type` chain to depth 5). Two interactions on the same element within the same page state produce byte-identical selectors. |
| **`tag` is always present** | ✅ Every element has a tagName. |
| **`stableId` is present or null** | ✅ Both scripts capture `el.id \|\| null`. If present, the CSS selector is `#id`, making stableId redundant in the key — but including it explicitly is harmless and provides a second confirmation. |
| **Both scripts capture identity from the same DOM element** | ✅ Click captures on mousedown; text entry captures on blur. If both fire on the same `<input>`, the element's tag, id, and DOM position are identical at both moments. |
| **Precedent in the codebase** | ✅ `identityKey()` has been used for double-click detection since Milestone 3 (v3.0.0). It is the established pattern for "same element" comparison. |

### Why Not Use a Single Attribute

| Single attribute | Why insufficient alone |
|---|---|
| `elementId` | Session-scoped sequential counter — unique per interaction, not per element. Two calls to `addAction()` always produce different IDs. |
| `cssSelector` alone | Two different elements on different pages could share the same selector (e.g., `input:nth-of-type(1)`). Adding `tag` is redundant but the real disambiguator is the page context (OR-1 only checks adjacent steps). |
| `stableId` alone | Often null. Many elements have no `id` attribute. |
| `accessibleName` alone | Two different elements may share the same name (e.g., two "Search" buttons). |

The composite key resolves the weaknesses of any single attribute: `tag` disambiguates element types, `stableId` provides a strong signal when present, and `cssSelector` provides positional uniqueness.

### Known Limitations

| # | Limitation | Impact | Mitigation |
|---|---|---|---|
| L1 | **React re-render between click and blur.** If the framework re-renders the element between the mousedown (click capture) and blur (text capture), the CSS selector may change (e.g., a class added, position shifted). | OR-1 will not fire — both steps remain separate. | **Conservative — correct behavior.** When uncertain, do not merge. |
| L2 | **ID removed by framework between events.** Some frameworks strip/add IDs dynamically. If `stableId` changes, the key changes. | Same as L1 — no merge. | Conservative — correct behavior. |
| L3 | **Dynamically inserted elements.** If an element is removed and re-inserted (e.g., React key change), its `nth-of-type` position may change even though it represents the "same" logical component. | OR-1 will not fire. | Conservative — correct behavior. The optimizer cannot prove these are the same element, so it should not merge. |
| L4 | **Elements with auto-generated IDs.** If `el.id` is an auto-generated value (e.g., `react-3.7.2.1`), the CSS selector becomes `#react-3.7.2.1`. The Locator Resolution Engine rejects these for locator purposes (B4.4 DQ-1), but the identity key would still match if both interactions see the same generated ID. This is actually **correct** — we want to merge if both interactions are on the same DOM node, regardless of whether its ID is stable enough for a locator. | None — the identity key is used only for same-element detection, not for locator generation. | No mitigation needed. |

### Future Replaceability

The matching mechanism is designed as a **single function**:

```
function isSameElement(a: ElementIdentity, b: ElementIdentity): boolean
```

The optimizer calls `isSameElement()` — it does not know or care how the function is implemented. Today the function uses the composite key. In the future, if the recorder provides a more reliable identity mechanism (e.g., a stable element fingerprint, a `data-cmdrunner-element-uid` attribute stamped on first interaction, or a DOM node snapshot hash), only `isSameElement()` needs to change. The optimization rule, the merge logic, and the step generation remain unchanged.

**The product rule ("merge when same element") is permanently frozen.**  
**The implementation of "same element" (`isSameElement()`) is a replaceable detail.**

---

## Freeze Declaration

This document defines the implementation choice for OR-1's same-element detection. It is frozen as the initial implementation strategy for B7.2. The strategy may be replaced in the future without changing the frozen product rule or any frozen architecture decision.

---

*End of B7.2 Design Clarification — Same Element Detection*
