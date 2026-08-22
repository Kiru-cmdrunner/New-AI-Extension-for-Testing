# Coding Patterns & Standards

## Naming
- Files: kebab-case (`storage-service.ts`, `service-worker.ts`)
- Types/Classes: PascalCase (`RecordingState`, `StorageService`)
- Constants: UPPER_SNAKE (`STORAGE_KEYS`, `DEFAULT_STATE`)
- CSS classes: BEM-ish (`.status-indicator__dot--recording`)

## TypeScript
- Strict mode enabled
- No `any` — use `unknown` + type guards or explicit interfaces
- Export/import via ES modules
- Enums for finite states (`RecordingState`)

## Storage
- All reads/writes through `StorageService` class
- Never call `chrome.storage` directly outside the storage module
- Keys defined as constants in `shared/types.ts`

## Messaging
- Use typed helper functions from `shared/messaging.ts`
- Never send raw `{}` messages

## Evidence semantics (Phase 6A/6C)
- **typedValue vs textValue contract**: `metadata.typedValue` = user intent
  (set on input/change, NEVER overwritten by blur); `metadata.textValue` =
  committed application state (blur-wins). IR fills/descriptions read
  `typedValue || textValue`; assertions read the COMMITTED state only.
- **Seed sentinel**: scan items derived from changed-element seeds carry
  `matchedSelector: 'changed-element-seed'` (not a selector string). The
  seed pass runs AFTER the selector pass and only adds uncovered paths —
  selector-matched snapshots stay byte-identical.
- **Identity attribute vocabulary**: entity seeds recognize exactly the
  config's entity idAttribute family (data-asin, data-product-id,
  data-item-id, data-sku, data-order-id, data-order-number). No new
  attribute names in classifiers/probes.
- **Dedup key**: sibling entities dedup on `entity:<id>` (id is identity);
  everything else on domPath. The seed pass uses the SAME keys.

## Testing
- Vitest with `jsdom` environment for DOM tests
- Mock `chrome.storage.local` and `chrome.runtime` in tests
- Every public function in storage/messaging has a unit test

## CSS
- No CSS framework — hand-written modern CSS
- CSS custom properties (variables) for theming
- Responsive within the narrow side panel width (~320–400px)
