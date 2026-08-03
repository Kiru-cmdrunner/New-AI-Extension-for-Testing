# Provider-Agnostic AI Service + Provider Capabilities

## Goal
Transform the AI Provider Manager from a partially-implemented layer (only Gemini works; 5 providers are stubs) into a fully provider-agnostic architecture where all 6 providers are implemented, every provider exposes capabilities, and the recording engine interacts exclusively through a common `AIService` interface — never calling provider APIs directly.

## Background
- Gemini is the only implemented provider. OpenAI, Claude, OpenRouter, Azure OpenAI, and Custom are all placeholders (`implemented: false`).
- The recorder already calls `getAIUnderstanding()` in `ai-understanding.ts`, which goes through `ProviderManager` → `provider.sendPrompt()`. This is good — the core flow is already provider-agnostic at the call site.
- No capabilities system exists. The extension cannot ask "does this provider support vision?" without checking provider IDs.

## Files to Change

### Core AI Layer (`src/ai/`)
1. **`providers/types.ts`** — Add `ProviderCapabilities` interface; add `capabilities` to `AIProvider` interface; add `testConnection()` method to `AIProvider`.
2. **`providers/gemini.ts`** — Add capabilities; add `testConnection()` using lightweight models list endpoint.
3. **`providers/openai.ts`** — Full implementation: `sendPrompt()` via `/v1/chat/completions`; `testConnection()` via `/v1/models`; capabilities.
4. **`providers/claude.ts`** — Full implementation: `sendPrompt()` via `/v1/messages`; `testConnection()` via a minimal message; capabilities.
5. **`providers/openrouter.ts`** — Full implementation: `sendPrompt()` via `/api/v1/chat/completions` (OpenAI-compatible); `testConnection()` via `/api/v1/key/info`; capabilities.
6. **`providers/azure-openai.ts`** — Full implementation: `sendPrompt()` via deployment endpoint; `testConnection()`; requires `baseUrl` (deployment endpoint) + API key; capabilities.
7. **`providers/custom.ts`** — Full implementation: OpenAI-compatible `sendPrompt()` using user-supplied `baseUrl`; `testConnection()` via `/v1/models`; capabilities all true (unknown).
8. **`provider-manager.ts`** — Add `getCapabilities(id)` convenience method.
9. **`ai-service.ts`** (NEW) — The `AIService` class: the single entry point for all AI calls. Loads config from storage, resolves the selected provider, validates it's configured, delegates to the provider, normalizes the response into the standard schema. Provides capability queries.
10. **`connection-tester.ts`** — Update to call `provider.testConnection()` when available, falling back to `sendPrompt()` for providers that don't override it.

### Storage & Types
11. **`shared/types.ts`** — Add `ProviderCapabilities` type; update `AIConfig` to support per-provider API keys (map) so each provider has its own key/baseUrl/model independently.
12. **`storage/storage-service.ts`** — Update to handle per-provider configuration storage.

### Settings UI
13. **`settings/settings.ts`** — Update to manage per-provider API key, model, base URL fields; show capabilities badge; test connection per-provider independently.
14. **`settings/index.html`** — Update the AI section to show per-provider config fields and capabilities display.
15. **`settings/settings.css`** — Add capabilities badge styles.

### Manifest
16. **`manifest.json`** — Expand `host_permissions` to include all provider API domains.

### Tests (TDD — written first, then implementation)
17. **`tests/providers/test-connection.test.ts`** — Each provider's `testConnection()`.
18. **`tests/ai-service.test.ts`** — AIService routing, capability queries, error handling.
19. **`tests/capabilities.test.ts`** — Capabilities for each provider.
20. Update existing `tests/provider-manager.test.ts`, `tests/connection-tester.test.ts` — adapt to new interface.

## Acceptance Criteria

### Provider Implementation
- [ ] All 6 providers (`gemini`, `openai`, `claude`, `openrouter`, `azure-openai`, `custom`) have `implemented: true`
- [ ] Each provider implements `sendPrompt()` that calls the correct API endpoint
- [ ] Each provider implements `testConnection()` with provider-specific validation
- [ ] `testConnection()` works independently for every provider — no cross-dependencies

### Capabilities System
- [ ] `ProviderCapabilities` interface defined with: `supportsVision`, `supportsFunctionCalling`, `supportsStreaming`, `supportsReasoning`
- [ ] Every provider exposes a `capabilities` property
- [ ] `AIService.getCapabilities()` returns the capabilities of the active provider
- [ ] Extension code never checks provider IDs to determine features — only capability queries

### AIService Abstraction
- [ ] `AIService` is the single entry point — recorder calls `AIService.understand()`, never `provider.sendPrompt()`
- [ ] `AIService` loads the user-selected provider from storage
- [ ] All providers return the same response schema (`AIUnderstanding`)
- [ ] Switching providers requires no changes to recorder, element identity, step builder, or JSON mapping
- [ ] If a provider isn't configured: clear error message, recorder continues, user can switch providers

### Per-Provider Configuration
- [ ] Each provider has its own API key storage (user can configure multiple providers)
- [ ] The "active" provider is the one selected by the user
- [ ] Settings UI shows per-provider fields and saves them independently
- [ ] Capabilities are displayed as badges in the settings UI

### Error Handling
- [ ] AI errors are shown to the user but do NOT stop the recorder
- [ ] User can switch providers from settings without restarting the extension
- [ ] Provider misconfiguration produces a clear, actionable error message

### Architecture
- [ ] Adding a new provider requires only: implement `AIProvider`, register in `ProviderManager`. No changes to recorder, AIService consumers, step builder, or element identity.
- [ ] Manifest includes all necessary host permissions

## Test Plan
- Unit: each provider's `sendPrompt` and `testConnection` with mocked `fetch`
- Unit: AIService routing, provider resolution, error handling
- Unit: capabilities for each provider
- Unit: per-provider config storage
- All existing tests still pass
