# Infrastructure

## Build & Preview
- **Build:** `npm run build` — Vite + @crxjs builds the extension into `dist/`
- **Preview:** `npx serve dist -l 5173` — static server serving the built extension files
- **Caddy proxy:** reverse proxy at `/` → port 5173

## Environment Variables
- No env vars needed (Chrome Extension — all config via chrome.storage.local)
- AI provider keys are stored in chrome.storage.local by the user via Settings

## Background Services
- `preview-server`: serves the built `dist/` directory on port 5173
- `extension-download-server`: serves extension zip on port 8080 (/download)

## Architecture C Pipeline (Phases 0–6)
- **Feature flag:** `ARCHITECTURE_C_ENABLED` in chrome.storage.local (default OFF)
- **Pipeline flow:** Universal Observer → Coalescer → Classifier (Tier 1/2/3) → SessionEvent
- **Phase 6 (AI Observer):** When `aiEligible=true`, async AI refinement via AIObserver
- **Mental Model persistence:** `session_context_l2` key in chrome.storage.local
- **Evidence Sovereignty:** Tier 1/2 deterministic rules structurally override Tier 3 AI

## Setup Script
```bash
npm ci          # install deps
npm run build   # build extension
npx vitest run  # run tests
```
