# CmdRunner AI Extension — Project Handover Documentation

> **Purpose:** This documentation is the permanent source of truth for the CmdRunner AI Extension project. A new AI assistant or developer can understand the project, its architecture, design philosophy, current state, and development trajectory by reading these documents — no prior conversation history required.

> **← Back to [Root README](../../README.md)**

---

## How to Use This Documentation

### If you are a new AI assistant
1. Read **[10-ai-handover-guide.md](./10-ai-handover-guide.md)** first — it tells you exactly what to read, what's frozen, and where to continue.
2. Then read **[01-project-vision.md](./01-project-vision.md)** to understand what you're building.
3. Skim **[05-implementation-status.md](./05-implementation-status.md)** to know what's done and what isn't.
4. Dive into architecture docs as needed.

### If you are a developer
1. Start with **[01-project-vision.md](./01-project-vision.md)**.
2. Read **[02-architecture-overview.md](./02-architecture-overview.md)** for the big picture.
3. Use **[09-repository-guide.md](./09-repository-guide.md)** to navigate the codebase.

---

## Document Index

| # | Document | Purpose |
|---|----------|---------|
| — | [Project Vision](./01-project-vision.md) | What CmdRunner is, why it exists, what problems it solves |
| — | [Architecture Overview](./02-architecture-overview.md) | High-level architecture, data flow, subsystems, diagrams |
| — | [Current Architecture](./03-current-architecture.md) | Every implemented phase explained — purpose, internals, relationships |
| — | [Design Decisions](./04-design-decisions.md) | Architectural choices, alternatives rejected, trade-offs, frozen invariants |
| — | [Implementation Status](./05-implementation-status.md) | What's done, partial, pending — with test counts and git status |
| — | [Future Roadmap](./06-future-roadmap.md) | Remaining phases, dependencies, recommended order |
| — | [Development Principles](./07-development-principles.md) | Engineering principles that shaped this codebase |
| — | [Knowledge Model](./08-knowledge-model.md) | UI Knowledge Model, workflow model, semantic aggregation, fragment assembly |
| — | [Repository Guide](./09-repository-guide.md) | Folder structure, entry points, build process, dev workflow |
| **★** | **[AI Handover Guide](./10-ai-handover-guide.md)** | **Start here if you're a new AI assistant** |
| — | [Architectural Decision Log](./11-architectural-decision-log.md) | Chronological ADR — how architecture evolved across four eras |
| **★** | **[AI Resume Prompt](./12-ai-resume-prompt.md)** | **Onboarding protocol for new AI assistants — read before proposing changes** |
| — | [Long-Term Roadmap](./13-long-term-roadmap.md) | Phases 8–18: what remains to achieve the product vision (2026-07-21 analysis) |

---

## Existing Documentation (Pre-Handover)

These documents were created during development and contain deeper technical detail:

| Document | Location | Description |
|----------|----------|-------------|
| Technical Architecture | [`../TECHNICAL_ARCHITECTURE.md`](../TECHNICAL_ARCHITECTURE.md) | Frozen at `semantic-interaction-engine-v1.0` tag — the V1 architecture reference |
| Architecture Review | [`../architecture-review.md`](../architecture-review.md) | Comprehensive Phase 1–4 review of the UI Knowledge Model |
| Architecture Walkthrough | [`../architecture-walkthrough.md`](../architecture-walkthrough.md) | End-to-end flight-booking scenario through all pipeline stages |
| Architecture Validation | [`../architecture-validation.md`](../architecture-validation.md) | Validation summary — points to handover docs for detailed results |

---

## Project Metadata

| Field | Value |
|-------|-------|
| **Project name** | AI Extension for CmdRunner |
| **Package name** | cmdrunner-smart-recorder |
| **Version** | 10.4.18 |
| **Platform** | Chrome Extension (Manifest V3) |
| **Language** | TypeScript (strict mode) |
| **Bundler** | Vite + @crxjs/vite-plugin |
| **Test framework** | Vitest (jsdom environment) |
| **Tests** | 3,126 tests across 119 files |
| **Git remote** | `github.com/Kiru-cmdrunner/cmdrunner-smart-recorder` |
| **HEAD branch** | `main` |
| **Root README** | [`/README.md`](../../README.md) — start there for project overview and onboarding |
