# V2 MutationObserver Pattern — For R3.4 Reference

## Source
`src/recorder/v2/control-model.ts` (lines 130-165) — being deleted in R1.

## Pattern
The ControlModel used a MutationObserver to track DOM changes:

```typescript
this.observer = new MutationObserver((mutations) => {
  for (const mutation of mutations) {
    for (const node of mutation.addedNodes) {
      if (node.nodeType === 1) {
        const el = node as Element;
        // Track newly added elements
        this._discover(el, parentId);
      }
    }
  }
});

this.observer.observe(root, {
  childList: true,
  subtree: true,
  attributes: true,
  attributeFilter: [
    'role', 'aria-expanded', 'aria-checked', 'aria-selected',
    'class', 'value', 'checked', 'hidden', 'style',
  ],
});
```

## R3.4 Application
For attribute transition capture (R3.4), we need to observe attribute changes
on the **interaction target's subtree** (not the full document), watching for:

- `class` changes (e.g., `opt-tile` → `opt-tile selected` — toggle signal)
- `aria-expanded` changes (panel open/close — dropdown/tab signal)
- `aria-checked` changes (checked state transition)
- `style` changes (display/visibility transitions)

The key difference from v2's pattern: R3.4 should observe only the target
element's subtree for a short window after interaction (e.g., 400ms), not
continuously. This follows the existing `schedulePostClickValueCheck` template
(50/150/400ms deferred polls).

## Other V2 Capabilities Documented for Future Reference

### Semantic Control Resolution (matchEvent)
ARIA-role ancestor walk resolves events to the correct logical control.
Fixes "Nationality → Blood Type" mis-resolution. Active path uses
`resolveTarget()` (CSS-selector heuristic). Not needed for R1-R3.

### Hover Dwell + Cooldown
500ms threshold before hover is considered intentional.
2000ms post-click cooldown to suppress hovers on recently-clicked elements.
Active path handles hover classification downstream — no gap identified.

### Date Picker Metadata (dateSelect)
Calendar-aware event type with `isoValue`, `displayValue`, `dateConfidence`,
`dateAmbiguous`, 800ms debounce. Active path uses generic post-click value poll.
Richer date metadata is an optional future enhancement.
