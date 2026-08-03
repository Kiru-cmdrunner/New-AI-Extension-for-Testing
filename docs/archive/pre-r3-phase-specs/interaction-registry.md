# Refactoring: Interaction Type Registry

## Objective

Convert the per-type branching pattern into a centralized registry lookup,
reducing the number of touchpoints required to add a new interaction type
from ~7 to ~2. **No new interaction types are implemented.** Existing behavior
must remain identical.

## Acceptance Criteria

- [ ] All 285 existing tests pass without modification
- [ ] Execution JSON output is identical for all types
- [ ] Plain English output is identical for all types
- [ ] AI prompt output is identical for all types
- [ ] Screenshots continue to be captured correctly
- [ ] No UI behavior changes
- [ ] No repository structure changes
- [ ] No API contract (message type) changes

## Files Changed

| File | Change |
|------|--------|
| `src/recorder/interaction-types.ts` | **NEW** — central registry |
| `src/ai/ai-understanding.ts` | Delegates to registry |
| `src/recorder/step-builder.ts` | Delegates to registry |
| `src/recorder/recording-session.ts` | Generic addAction() |
| `src/background/service-worker.ts` | Generic processAction() |
| `src/sidepanel/sidepanel.ts` | Shared createActionElement() |

## Registry Shape

```typescript
interface InteractionTypeConfig {
  idPrefix: string;             // 'click', 'text', 'dropdown'
  actionType: string;           // 'click' | 'text_entry' | 'dropdown'
  buildPrompt: (info: ActionElementInfo) => string;
  toPlainEnglish: (identity, understanding, extras) => string;
  executionExtras: (event) => Record<string, unknown>;
}
```

## How a new type would be registered (example, NOT implemented)

```typescript
registerInteractionType({
  idPrefix: 'checkbox',
  actionType: 'checkbox',
  buildPrompt: (info) => `...`,
  toPlainEnglish: (identity, understanding) => `Check the "${name}"`,
  executionExtras: (event) => ({ isChecked: event.isChecked }),
});
```

Plus a content script. That's it — no changes to step-builder,
recording-session, service-worker, or sidepanel.
