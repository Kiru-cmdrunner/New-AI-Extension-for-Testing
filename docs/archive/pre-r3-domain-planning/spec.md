# AI Extension for CmdRunner — Specification

## Overview
A Chrome Extension (Manifest V3) that serves as the CmdRunner Smart Recorder. It captures user browser interactions and builds structured execution models for test automation. This project is a fresh build under "AI Extension for CmdRunner" (project ID 2552).

## Tech Stack
- **Language:** TypeScript
- **Bundler:** Vite + @crxjs/vite-plugin (Chrome Extension bundling)
- **UI Framework:** Vanilla TS with modern CSS (no heavy framework for extension pages)
- **Testing:** Vitest
- **Extension APIs:** Manifest V3 — side panel, storage, runtime messaging, action

## Key Decisions
- Manifest V3 with Chrome Side Panel API
- No recording logic in Milestone 1 — UI state only
- No AI integration in Milestone 1
- Modular folder structure: background, sidepanel, settings, recorder, ai, storage, shared, assets
- Storage via `chrome.storage.local` for UI state persistence
- Side Panel as the primary UI surface (not popup)
