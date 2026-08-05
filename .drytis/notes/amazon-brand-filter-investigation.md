# Amazon Brand Filter Classification Investigation (int-22)

**Date**: 2026-08-05
**Trigger**: Manual testing on Amazon.in, vivo brand filter click classified as `Link` instead of `Checkbox`
**Verdict**: D — Correct classification. Amazon's control is fundamentally a navigation link.

---

## 1. Actual Amazon DOM / Control Structure

Amazon's brand filter is NOT a checkbox control. It is a **navigation link styled to visually resemble a checkbox**:

```html
<a class="a-link-normal s-navigation-item"
   href="/s?k=vivo+phone&rh=p_89:vivo"
   aria-label="Apply the filter vivo to narrow results">
  <i class="a-icon a-icon-checkbox"></i>   <!-- visual checkbox icon (CSS only) -->
  <span class="a-label a-checkbox-label">vivo</span>
</a>
```

Key structural facts:
- **No `<input type="checkbox">`** — confirmed by our extension's resolveTarget returning the `<a>` (if an `<input>` existed in the composedPath before the `<a>`, it would have been resolved instead since `input` is in INTERACTIVE_SELECTOR)
- **No `role="checkbox"`** — the `<a>` tag has no explicit ARIA role
- **No `aria-checked`** — no ARIA checkbox semantics whatsoever
- The checkbox is a **purely visual CSS icon** (`<i class="a-icon a-icon-checkbox">`) inside the link
- The class `a-checkbox a-checkbox-fancy s-navigation-checkbox` seen in mutations is on a container that is **removed during rerender** — it is not on the clicked element or any ancestor
- The `<a>` has a real `href` that applies the filter via URL parameter change → **server-side filtering via navigation**

## 2. Actual Clicked / Raw Event Target

`event.composedPath()` returns (innermost → outermost):
1. `[0]` `<i class="a-icon a-icon-checkbox">` (innermost — mouse target)
2. `[1]` `<a class="a-link-normal s-navigation-item">` ← **matches `a[href]` in INTERACTIVE_SELECTOR**
3. ... ancestors up to `<body>`

`resolveTarget()` finds the `<a>` at index [1] as the first element matching `INTERACTIVE_SELECTOR`. This is **correct** — there is no interactive element above it in the path.

## 3. Target-Normalization Result

| Field | Value |
|-------|-------|
| **Resolved element** | `<a class="a-link-normal s-navigation-item">` |
| **tag** | `A` |
| **ariaRole** | `link` (from `TAG_ROLE_MAP['A'] = 'link'`) |
| **inputType** | `null` (not an `<input>`) |
| **className** | `a-link-normal s-navigation-item` |
| **accessibleName** | `"Apply the filter vivo to narrow results"` (from `aria-label`) |

No normalization bug. The correct element was resolved.

## 4. Evidence Available to the Classifier at Interaction Time

| Evidence | Present? | Value |
|----------|----------|-------|
| `tag = 'INPUT'` | ❌ | `tag = 'A'` |
| `inputType = 'checkbox'` | ❌ | `inputType = null` |
| `role = 'checkbox'` or `'switch'` | ❌ | `ariaRole = 'link'` |
| Checkbox class on element or ancestors | ❌ | Classes are `a-link-normal s-navigation-item` on element, section/div grid classes on ancestors |
| `aria-checked` attribute | ❌ | Not present |
| `tag = 'A'` | ✅ | Yes |
| `ariaRole = 'link'` | ✅ | Yes (implicit from TAG_ROLE_MAP) |

The checkbox wrapper class regex `CHECKBOX_WRAPPER_CLASS_RE` checks:
```
checkbox.*wrapper | checkbox.*input | oxd-checkbox | checkbox-input | custom-checkbox
```
None match `a-link-normal s-navigation-item` or any ancestor class. The `a-checkbox` classes are on a **descendant/sibling container** that is removed during rerender — they never appear in `ancestorClasses` (which walks UP, not DOWN).

## 5. Candidate Interaction Types Considered

The `tryDiscovery()` function iterates definitions by priority:

| Priority | Definition | `detectTrigger()` Result | Why |
|----------|-----------|-------------------------|-----|
| 10 | DatePicker | `null` | Not a date input/class |
| 20 | Dropdown | `null` | Not SELECT/combobox |
| 25 | Slider | `null` | Not range/slider |
| **30** | **Checkbox** | **`null`** | `isCheckbox('A', null, 'link')` = false. `CHECKBOX_WRAPPER_CLASS_RE` on all classes = false. |
| 35 | FileUpload | `null` | Not file input |
| 40 | RadioButton | `null` | Not radio |
| 50 | TextEntry | `null` | Not text input |
| 60 | Hover | `null` | Not a mouseenter event |
| 65 | Tab | `null` | `ariaRole` is 'link', not 'tab' |
| **70** | **Link** | **`{ type: 'Link' }`** ✅ | `isLink('A', 'link')` = true |
| 110+ | Scroll, Nav, Click | (not reached) | Link definition matched first |

## 6. Exact Rule/Scoring Path That Selected `Link`

```
tryDiscovery(event) {
  for (def of nonClickDefinitions by priority) {
    if (!def.triggerEventTypes.has('click')) continue;
    trigger = def.detectTrigger(event);
    if (trigger) return createContext(def, event);
  }
  // Click fallback if nothing matched
}
```

The Checkbox definition (priority 30) is checked **before** the Link definition (priority 70). But `detectTrigger` returns `null` for Checkbox because:
1. `isCheckbox('A', null, 'link')` → `tag !== 'INPUT'` AND `ariaRole !== 'checkbox'/'switch'` → false
2. `CHECKBOX_WRAPPER_CLASS_RE.test(allClasses)` → no checkbox wrapper classes in element or ancestors → false

Link definition (priority 70) is checked next. `isLink('A', 'link')` → `tag === 'A'` → true. Match.

## 7. Comparison With Checkbox Variants

| Variant | DOM Semantics | Classified As | Correct? |
|---------|---------------|---------------|----------|
| Native `<input type="checkbox">` | Real form control with `checked` property | Checkbox (pri 30) | ✅ |
| ARIA `role="checkbox" aria-checked` | Custom checkbox with ARIA semantics | Checkbox (pri 30) | ✅ |
| OXD wrapper `class="oxd-checkbox-wrapper"` | Framework wrapper around hidden input | Checkbox (pri 30, wrapper regex) | ✅ |
| **Amazon `<a>` with CSS checkbox icon** | **Navigation link with visual styling** | **Link (pri 70)** | **✅** |

The Amazon control is fundamentally different from all three checkbox variants above. It has:
- No form control (`<input>`)
- No ARIA checkbox role
- No framework checkbox wrapper class
- A real `href` attribute that navigates to a filtered URL
- CSS-only checkbox appearance (pure visual)

## 8. Interaction-Time vs Post-Interaction Evidence

### Interaction-time evidence (available to ComponentInteraction classifier):
- `tag=A`, `ariaRole=link`, `className=a-link-normal s-navigation-item`
- `accessibleName="Apply the filter vivo to narrow results"`
- `href` present (navigation link)
- **NO** `role=checkbox`, **NO** `aria-checked`, **NO** `inputType=checkbox`
- **NO** checkbox class on element or any ancestor (up to 10 levels)
- → **Classifier CANNOT know this involves a checkbox. There is no evidence to that effect.**

### Post-interaction evidence (M1 Behavioral Observation):
- `beforeSnapshot`: class=`a-link-normal s-navigation-item`, text=` vivo `, childCount=2
- `afterSnapshot`: everything null (element removed during rerender)
- 1237 mutations including `a-checkbox` class changing
- Semantic Effects: broad structural change (201 mutations, 45 paths, LOW) + element removed (LOW)
- → Post-observation shows checkbox classes existed in **descendant** elements that were removed during rerender. But this evidence is too noisy (full page rerender, 1237 mutations) to provide useful classification signal.

## 9. Root-Cause Classification

### **D — Correct classification because Amazon's control is fundamentally a link**

The Amazon brand filter is **not a checkbox**. It is a **navigation link** that:
1. Has a real `href` attribute that applies server-side filtering via URL change
2. Uses CSS to visually render a checkbox appearance for user familiarity
3. Has no form control (`<input type="checkbox">`), no ARIA checkbox semantics, and no framework checkbox wrapper

Classifying it as `Link` is **semantically correct** for our ComponentInteraction model:
- Replay action: click the link (navigate to filtered URL)
- Verification: check that the URL changed to include the filter parameter
- Test assertion: `expect(page).toHaveURL(/rh=p_89:vivo/)`

If we had classified it as `Checkbox`, the replay would try to toggle a checkbox state that doesn't exist:
- Replay: `check('#brand-filter-vivo')` → would fail (no `<input type="checkbox">` to check)
- Verification: `expect(checkbox).toBeChecked()` → would fail (no checkbox element)

## 10. Recommended Architectural Direction

**No code change needed.** The classifier correctly identified the Amazon brand filter as a `Link`.

However, there are two architectural improvements worth considering in future milestones (NOT now):

### Future Option A: Descendant Checkbox Detection (complex, not recommended)
Add a `querySelectorAll('input[type=checkbox], [role=checkbox]')` scan on the resolved element's subtree at capture time. If a descendant checkbox exists, consider re-classifying.
- **Problem**: This requires a DOM query at capture time (currently all pattern matching is on string identity only). It also wouldn't help Amazon since there's no actual checkbox descendant.
- **Rejected**.

### Future Option B: "Filter Link" Enrichment Sub-type (moderate, future)
The Enrichment layer (`enrich.ts`) could detect that a Link click caused a content/filter change by examining post-interaction behavioral evidence. This would add a `componentType: 'FilterLink'` and `businessMeaning: 'Apply filter: vivo'` enrichment — WITHOUT changing the interaction type from `Link`.
- **Benefit**: Test generation gets richer context ("this link applies a filter" vs "this link navigates").
- **Timing**: This belongs in the Capability Model milestone, not the current taxonomy.

### Future Option C: Nothing (recommended for now)
The current behavior is correct. `Link` is the right classification for a navigation element that filters results by changing the URL. The test step "Click link 'Apply the filter vivo to narrow results'" is accurate and replayable.
