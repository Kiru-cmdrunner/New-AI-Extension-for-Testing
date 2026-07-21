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

## Testing
- Vitest with `jsdom` environment for DOM tests
- Mock `chrome.storage.local` and `chrome.runtime` in tests
- Every public function in storage/messaging has a unit test

## CSS
- No CSS framework — hand-written modern CSS
- CSS custom properties (variables) for theming
- Responsive within the narrow side panel width (~320–400px)
