# Milestone 1 — Extension Foundation

## Objective
Build the foundation of the CmdRunner Smart Recorder Chrome Extension: a production-ready, installable Manifest V3 extension with a modern UI. No recording logic, no AI, no JSON generation, no CmdRunner integration.

## Files to Create

### Project scaffolding
- `package.json` — deps: vite, @crxjs/vite-plugin, typescript, vitest, jsdom, @types/chrome
- `tsconfig.json` — strict mode, DOM lib
- `vite.config.ts` — @crxjs plugin with manifest input

### Extension core
- `src/manifest.json` — MV3 manifest: action, side_panel, service_worker, options_page, icons, permissions (sidePanel, storage)
- `src/background/service-worker.ts` — opens side panel on action click, message routing
- `src/shared/types.ts` — RecordingState enum, StorageKeys, AppMessage types
- `src/shared/messaging.ts` — typed sendMessage helpers

### Storage
- `src/storage/storage-service.ts` — get/set UI state via chrome.storage.local

### Side Panel
- `src/sidepanel/index.html` — Side Panel HTML
- `src/sidepanel/sidepanel.ts` — state management, Start/Stop button handlers, state transitions
- `src/sidepanel/sidepanel.css` — modern styling

### Settings
- `src/settings/index.html` — Settings page HTML with 4 tab sections
- `src/settings/settings.ts` — tab switching logic
- `src/settings/settings.css` — Settings page styling

### Assets
- `src/assets/icon-16.png`, `icon-48.png`, `icon-128.png`

### Tests
- `tests/storage-service.test.ts`
- `tests/messaging.test.ts`
- `tests/state-management.test.ts`

## Acceptance Criteria

- [ ] Extension builds successfully with `npm run build`
- [ ] Manifest V3 with side panel, action, service worker, options page, icons
- [ ] Side Panel opens when extension action icon is clicked
- [ ] Three recording states displayed: Ready, Recording, Stopped
- [ ] "Start Recording" button transitions Ready→Recording or Stopped→Recording
- [ ] "Stop Recording" button transitions Recording→Stopped
- [ ] Settings page opens with 4 sections: General, AI, Recording, About
- [ ] Settings page tab navigation works (switch between sections)
- [ ] Storage Service persists last UI state to chrome.storage.local
- [ ] UI state is restored when side panel is reopened (reads from storage on load)
- [ ] No console errors on any extension page
- [ ] Unit tests pass for: storage service get/set, messaging helpers, state transitions
- [ ] Modular folder structure: background/, sidepanel/, settings/, storage/, shared/, assets/, recorder/ (placeholder), ai/ (placeholder)

## Edge Cases
- Rapid Start/Stop clicks — state should always reflect the last click
- Side panel reopen — should restore last persisted state (Ready, Recording, or Stopped)
- Settings opened from side panel — should open in a new tab
