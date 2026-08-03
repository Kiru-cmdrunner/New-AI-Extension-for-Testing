# Phase 3 Integration — Step 3: Semantic Interaction Language as Source of Truth for Plain English

## Objective

Make the **Semantic Interaction Language** (§8.2 frozen templates) the single source of truth for plain-English test step generation within the production generation pipeline. Remove the canonical-step-generator's dependency on the legacy `interaction-types.ts` registry for semantic interpretation or plain-English generation.

**Target Pipeline after Step 3:**
Timeline → Stage 3a → ClassifiedInteraction → **Stage 3b (frozen templates)** → CanonicalStep → Stage 4 → Execution JSON

## Design

### New Module: `semantic-templates.ts`

Location: `src/generation/engine/semantic-templates.ts`

Exports:
- `resolveElementName(identity, understanding)` — resolves display name: AI businessName > accessibleName > tag (§8.2)
- `renderSemanticPlainEnglish(params)` — dispatches to frozen template by canonical type

### Frozen Templates (§8.2 — immutable)

| CanonicalType | Template |
|---|---|
| navigate | `Navigate to {url}` |
| click | `Click the {elementName}` |
| fill | `Enter '{value}' in the {elementName}` |
| select | `Select '{value}' from {elementName}` |
| toggle | `{checked ? 'Check' : 'Uncheck'} the {elementName}` |
| selectDate | `Select {value} as the {elementName}` |
| hover | `Hover over the {elementName}` |
| pressKey | `Press {key}` |
| upload | `Upload {files}` |
| drag | `Drag {source} to {target}` |

`elementName` = AI businessName > accessibleName > tag (with truncation at 100 chars).

### Edge Cases

- **`select` without `value` (radio buttons):** Radio events carry no `value` field — the element name IS the selected option. Render as `Select '{elementName}'` (no "from" clause when no separate value exists).
- **`fill` without `value`:** Render as `Enter text in the {elementName}`.
- **`selectDate` ranges:** Format value as `"{start}" to "{end}"` before passing to template.
- **Unknown canonicalType:** Default to click template (L5: click is always valid).
- **Navigation template change:** Frozen template drops quotes around URL: `Navigate to https://...` instead of legacy `Navigate to "https://..."`.

### Changes to `canonical-step-generator.ts`

1. Remove `import { getInteractionType } from '../../recorder/interaction-types'`
2. Add `import { renderSemanticPlainEnglish, resolveElementName } from '../engine/semantic-templates'`
3. Add `import { normalizeToCanonical } from '../engine/step-to-semantic'` (already exists in the project)
4. `transformNavigationEvent`: Use frozen navigate template (drop quotes around URL)
5. `transformActionEvent`: Resolve canonical type via `normalizeToCanonical()`, then call `renderSemanticPlainEnglish()` with identity, understanding, value, checked, and date display value
6. Remove the legacy `extras` extraction block — replace with direct template params

### What does NOT change

- `interaction-types.ts` file itself — preserved for recording layer and UI layer
- `getInteractionType` import in `service-worker.ts` (recording layer)
- `getInteractionType` / `BaseActionEvent` import in `timeline-renderer.ts` (UI layer)
- `BaseActionEvent` type import in `step-builder.ts` (recording layer)
- `addToSession()`, `renderTitle()`, `buildPrompt()`, `executionExtras()` — all recording/UI layer utilities
- `resolveDisplayName()`, `isIconElement()`, `truncate()`, `buildPromptHeader()` — shared helpers for recording layer

### Test Updates Required

Tests that assert specific `plainEnglish` strings from the canonical-step-generator pipeline must be updated to match frozen template output. Tests that directly test the legacy registry's `toPlainEnglish()` (recording-layer tests) remain unchanged.

Files requiring updates (generation pipeline tests):
- `tests/stage3a-integration.test.ts` — "Plain English Preserved" section → verify frozen template output
- `tests/hover-pipeline-integration.test.ts` — plainEnglish assertions
- `tests/click-interaction.test.ts` — plainEnglish assertions from generator
- `tests/checkbox-radio-recording.test.ts` — plainEnglish assertions from generator
- `tests/select-recording.test.ts` — plainEnglish assertions from generator
- `tests/text-entry-recording.test.ts` — plainEnglish assertions from generator
- `tests/checkbox-radio-artifact-generation.test.ts` — plainEnglish assertions
- `tests/generation-engine.test.ts` — plainEnglish assertions
- `tests/hover-content-script.test.ts` — plainEnglish assertions from generator

Files NOT changed (recording-layer / fixture-only):
- `tests/select-recording.test.ts` — tests calling `getInteractionType().toPlainEnglish()` directly
- `tests/execution-json-generator.test.ts` — fixture data only
- `tests/playwright-generator.test.ts` — fixture data only
- `tests/stage3b-integration.test.ts` — fixture data only
- `tests/readability-optimizer.test.ts` — fixture data only
- `tests/repository-service.test.ts` — fixture data only

## Acceptance Criteria

- [ ] `semantic-templates.ts` module created with all 10 frozen templates
- [ ] `resolveElementName()` implements businessName > accessibleName > tag priority
- [ ] `renderSemanticPlainEnglish()` renders correct template per canonical type
- [ ] `canonical-step-generator.ts` no longer imports from `interaction-types.ts`
- [ ] `canonical-step-generator.ts` uses `renderSemanticPlainEnglish()` for all plain English
- [ ] Navigation template uses frozen format (no quotes around URL)
- [ ] Date select template uses frozen format
- [ ] Select/radio rendering handles value-absent case
- [ ] No generation pipeline file imports from `interaction-types.ts`
- [ ] `interaction-types.ts` itself is NOT modified or removed
- [ ] Recording layer (`service-worker.ts`, `step-builder.ts`) still imports from `interaction-types.ts`
- [ ] UI layer (`timeline-renderer.ts`) still imports from `interaction-types.ts`
- [ ] All existing tests pass (updated for new template output)
- [ ] New unit tests verify frozen template rendering for all 10 types
- [ ] Execution JSON verbs are unchanged (Step 2 not regressed)
- [ ] Playwright generation is unchanged
- [ ] Backward compat: generator works without `classified` input
