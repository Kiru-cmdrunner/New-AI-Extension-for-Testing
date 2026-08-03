# Milestone 3 — AI Provider Connection Foundation

## Objective
Build a provider-agnostic AI connection layer for the extension. Establish and validate communication with an AI model. No recording analysis, no JSON generation, no test step generation.

## Architecture

```
Settings UI (AI section)
  ↓ user enters provider + API key + model
StorageService (chrome.storage.local)
  ↓ persists AIConfig
ProviderManager (factory + registry)
  ↓ returns the right provider based on config
AIProvider (interface)
  ├── GeminiProvider (implemented)
  ├── OpenAIProvider (placeholder)
  ├── ClaudeProvider (placeholder)
  ├── OpenRouterProvider (placeholder)
  ├── AzureOpenAIProvider (placeholder)
  └── CustomProvider (placeholder)
ConnectionTester
  ↓ sends "Reply with: Connection Successful"
  ↓ validates response
Settings UI ← status update (Connected/Failed)
```

## New Files

### Provider Layer
- `src/ai/providers/types.ts` — `AIProvider` interface, model definitions
- `src/ai/providers/gemini.ts` — Google Gemini provider (implemented)
- `src/ai/providers/openai.ts` — OpenAI (placeholder)
- `src/ai/providers/claude.ts` — Claude (placeholder)
- `src/ai/providers/openrouter.ts` — OpenRouter (placeholder)
- `src/ai/providers/azure-openai.ts` — Azure OpenAI (placeholder)
- `src/ai/providers/custom.ts` — Custom OpenAI-compatible (placeholder)
- `src/ai/provider-manager.ts` — registry + factory
- `src/ai/connection-tester.ts` — test connection utility

### Tests
- `tests/provider-manager.test.ts`
- `tests/connection-tester.test.ts`
- `tests/ai-storage.test.ts`

## Modified Files
- `src/shared/types.ts` — add AIProviderId, AIConfig, ConnectionStatus, new storage keys
- `src/storage/storage-service.ts` — add AI config storage methods
- `src/manifest.json` — add host_permissions for AI API endpoints
- `src/settings/index.html` — rebuild AI section with full config UI
- `src/settings/settings.ts` — AI config logic (save, test, status)
- `src/settings/settings.css` — AI section styles

## Acceptance Criteria

- [ ] AI Settings page has: provider dropdown, API key field, model dropdown, Test Connection button, Save Settings button, connection status indicator
- [ ] Google Gemini is implemented and functional (sends prompt, receives response)
- [ ] OpenAI, Claude, OpenRouter, Azure OpenAI, Custom are placeholders (show "coming soon" when selected)
- [ ] Default model is gemini-2.5-flash
- [ ] API key is stored securely in chrome.storage.local
- [ ] Test Connection sends "Reply with: Connection Successful" prompt
- [ ] Connection status displays: Not Connected, Connecting, Connected, Failed
- [ ] Response from AI is displayed in a developer log
- [ ] Architecture supports adding new providers without refactoring existing code
- [ ] Unit tests pass for: provider-manager registry/factory, connection-tester logic, AI storage operations
- [ ] Extension builds with `npm run build`, no console errors

## Edge Cases
- Empty API key → test connection fails gracefully with error message
- Invalid API key → test connection fails with AI provider's error message
- Network error → test connection fails with network error message
- Switching providers → model dropdown updates to that provider's models
- Saving without testing → config persists, status remains "Not Connected"
