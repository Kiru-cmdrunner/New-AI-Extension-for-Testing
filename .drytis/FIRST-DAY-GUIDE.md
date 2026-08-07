# First Day Guide — Semantic Test Intelligence (CmdRunner)

**Created:** 2026-08-07
**Purpose:** Practical onboarding for the first hour. Read this before writing any code.

This guide complements `.drytis/ENGINEERING-HANDOVER.md`. The handover explains
*why* the architecture looks the way it does. This guide tells you *what to do*
when you sit down to work.

---

## 1. Read These First (In Order)

Do not skim. Read each one fully before moving to the next.

| # | Document | Time | What You'll Learn |
|---|----------|------|-------------------|
| 1 | `.drytis/ENGINEERING-HANDOVER.md` | 20 min | Everything. Vision, pipeline, invariants, evolution, debt, roadmap. |
| 2 | `.drytis/FIRST-DAY-GUIDE.md` | 5 min | This document. How to build, test, commit, and avoid mistakes. |
| 3 | `.drytis/notes/master-architectural-assessment.md` | 10 min | Where the dead code is and what's actually live. |
| 4 | `src/shared/component-types.ts` | 10 min | The type system. Every type you'll touch is here or imports from here. |
| 5 | `src/runtime/component-runtime.ts` | 10 min | The classification engine. Read `process()` top to bottom. |

After these five, you'll know enough to start. Refer to other docs as needed.

---

## 2. Build and Verify

### First-Time Setup

```bash
npm ci                    # Install dependencies (no audit, no fund)
npm run build             # Build extension → dist/ + download/cmdrunner-extension.zip
npm test                  # Run all tests (4072 tests, ~55s)
```

All three must succeed before you start working. If any fails, something is
wrong with the environment — fix that first.

### During Development

```bash
npm test                  # Run after every change. Non-negotiable.
npm run build             # Run before committing. The extension must build.
npx vitest run <file>     # Run a single test file while iterating
npx vitest run --reporter=verbose  # See every test name (useful for orientation)
```

### What "Green" Means

- **4072 tests pass** (175 files, ~55s)
- **Build produces `dist/` with 47 files**
- **ZIP at `download/cmdrunner-extension.zip`**

If you change test count (add/remove tests), update the numbers in
`ENGINEERING-HANDOVER.md` section 2 and section 9.

---

## 3. Canonical Documents (Trust These)

Not all files in `.drytis/` are equal. Some are frozen decisions. Some are
historical. Some are superseded. Here's the hierarchy:

### Authoritative (These Are the Law)

| Document | Authority |
|----------|-----------|
| `.drytis/ENGINEERING-HANDOVER.md` | Canonical handover — read first |
| `.drytis/specs/product-foundation-design-v1.0.md` | Frozen product vision (P1–P9, lifecycle) |
| `.drytis/specs/product-architecture-design-v1.0.md` | Frozen product architecture (PA1–PA12, 17 frozen decisions) |
| `.drytis/specs/end-to-end-capture-guarantee.md` | Evidence Ledger architecture spec (INV-1 through INV-7) |
| `.drytis/specs/e2e-capture-guarantee-milestones.md` | M1–M5 milestone plan (all complete) |
| `.drytis/specs/workflow-normalizer.md` | Subsumption filter spec |
| `.drytis/specs/capture-guarantee-v2.md` | Capture-first, classify-second contract |
| `.drytis/specs/capability-model-finalized.md` | Capability Model v2 (frozen) |

### Contextual (Read When Relevant)

| Document | When to Read |
|----------|-------------|
| `.drytis/notes/master-architectural-assessment.md` | When planning changes — dead code map |
| `.drytis/notes/agreed-architecture-principles.md` | When making architectural decisions — 10 principles + rejected alternatives |
| `.drytis/notes/content-script-not-injected-root-cause.md` | When debugging capture loss |
| `.drytis/specs/<component-name>.md` | When working on a specific component — there are 167 spec files |
| `.drytis/notes/<topic>.md` | When investigating a known issue — there are 63 notes, many are postmortems |

### Do NOT Trust Blindly

| Document | Why |
|----------|-----|
| `.drytis/specs/milestone-ai-observer-session-context.md` | Frozen but NEVER implemented. The spec is aspirational, not descriptive. |
| `.drytis/architecture.md` | Legacy blueprint from an earlier era. May not reflect current code. |
| `.drytis/schema.md` | Legacy schema doc. The actual schema is in `src/storage/schema-version.ts` and Dexie definitions. |
| `src/classifier/`, `src/recorder/recognition/`, `src/recorder/enrichment/`, `src/recorder/pipeline/` | DEAD CODE. Tests pass but nothing in production calls these. Reading them will confuse you about how the system actually works. |
| `tests/evidence-engine/` (33 files), `tests/recognition/` (5 files), `tests/recorder/` (1 file) | Tests for dead code. They inflate the test count. Do not use them as examples of how to test live code. |

---

## 4. Active vs Legacy/Dead Directories

### Production Source (Live Code — Safe to Read and Modify)

```
src/background/          932 lines   Service worker, recording lifecycle, health check
src/tap/               1,747 lines   EventTap, event capture (content script)
src/definitions/       2,272 lines   14 Component Definitions (click, dropdown, date-picker, etc.)
src/runtime/           1,955 lines   ComponentRuntime, EvidenceLedger, ProjectionEngine, VerificationMode, SW integration
src/presentation/        438 lines   OutputAdapter (filter + IR mapping), WorkflowNormalizer
src/capabilities/      2,722 lines   Capability Engine, 12 capability types, conflict resolution
src/semantics/           824 lines   M1 Behavioral Observation, M2 Semantic Effects
src/generation/          747 lines   IR Bridge (interactions → ExecutionIRPlan)
src/domain/            4,934 lines   Execution IR types, entities, generators
src/adapters/          2,685 lines   Playwright code generator, assertion renderer
src/shared/            2,922 lines   component-types.ts (THE type file), types.ts, patterns.ts
src/storage/             431 lines   Dexie/IndexedDB, schema-version
src/repository/        4,103 lines   Repository V2 (Test Case persistence)
src/sidepanel/         2,992 lines   Side panel UI
src/ai/                1,198 lines   Provider connection layer (API key mgmt — no inference yet)
src/settings/            284 lines   Settings page
src/screenshots/         130 lines   Screenshot capture
src/infrastructure/      476 lines   Infrastructure utilities
src/execution/         2,140 lines   Execution engine (replay — designed, partially built)
```

### Dead Source (Do NOT Read Unless Removing)

```
src/classifier/             4,595 lines   V1/V2 classifier — superseded by ComponentRuntime
src/recorder/recognition/   2,515 lines   Recognition layer — superseded
src/recorder/enrichment/    2,010 lines   Enrichment pipeline — never wired to production
src/recorder/pipeline/        555 lines   Old pipeline orchestrator — superseded
                            --------
                           9,675 lines    ~20% of total source
```

### Dead Tests (Test Dead Code — Don't Use as Examples)

```
tests/evidence-engine/     33 files    Tests for src/classifier/ — ~1,500+ tests
tests/recognition/          5 files    Tests for src/recorder/recognition/
tests/recorder/             1 file     Test for old recorder pipeline
```

These account for roughly 1,500–2,000 of the 4,072 tests. Live test count is
closer to ~2,100–2,500. When in doubt about whether a test exercises live code,
check whether the file it imports from is in the dead list above.

---

## 5. Git Workflow and Branching

### Current State

```
Branch:    capability-v1-complete  (HEAD: be03f78)
Remotes:   origin (Drytis-managed), github (user's repo)
Tags:      working-baseline-v10.9.0 (on f546cef)
```

### Branching Expectations

- **`capability-v1-complete`** is the active development branch. Continue here unless told otherwise.
- **`main`** exists on both remotes but is behind. Do not merge to `main` without explicit instruction.
- **Commit messages** follow the pattern: `type(scope): description` (e.g., `feat(runtime): add drag-drop definition`, `fix(tap): resolve target walk edge case`).

### Before Starting Work

1. Check for incoming changes: ask the user "Want me to check for changes from the shared repo?"
2. The workspace uses `git push`/`git pull` under the hood. In conversation, say "get" (pull) and "publish" (push). Never expose git jargon to the user.

### Publishing

- Publish only when work is **finished and validated**. Not after every task.
- Before publishing, confirm with the user: "Ready to publish your changes?"
- The git_manager gets incoming changes before pushing, so nothing is overwritten.

### Commit After Each Milestone

The prior session committed after each milestone (M1, M2, M3, M4, M5). Continue this pattern. Each commit should be independently green (tests pass, build succeeds).

---

## 6. How to Validate Every Change

### The 4-Check Protocol

Run these after every change, no exceptions:

```
1. npm test           # All tests pass
2. npm run build      # Extension builds
3. git diff --stat    # Review what you changed
4. Read your own diff # Read every line of the diff before committing
```

### For Architecture Changes (Env, Services, Schema)

If you change environment variables, background services, Caddy proxies, or database schema:

1. Run the Infrastructure Gate (see `ENGINEERING-HANDOVER.md` section 10)
2. Delegate to the `infra_verifier` sub-agent
3. Then delegate to the `reviewer` sub-agent

### For New Interaction Types

1. Create the definition in `src/definitions/`
2. Add it to `ALL_DEFINITIONS` in `src/definitions/index.ts`
3. Add an IR mapping in `src/presentation/output-adapter.ts` (`toIRActions`)
4. Write tests for: trigger detection, lifecycle completion, IR mapping
5. Run full test suite + build

### For Runtime/Pipeline Changes

1. Write a self-consistency test: process events through the full pipeline (ledger → runtime → flush → projection)
2. Verify every discrete event is represented in the output
3. Check that the verification result shows `match: true`

---

## 7. Common Pitfalls and Mistakes to Avoid

### Pitfall 1: Reading Dead Code and Thinking It's Live

**The trap:** You open `src/classifier/evidence-engine.ts` or `src/recorder/enrichment/` and think "this is how classification works." It isn't. That code is never called. The live classification is in `src/runtime/component-runtime.ts` + `src/definitions/`.

**The fix:** Always check whether the file is in the dead code list (section 4 above). When in doubt, grep for imports: `grep -r "from.*classifier" src/background/ src/runtime/`. If the service worker and runtime don't import it, it's dead.

### Pitfall 2: Adding Unclassified Emission Back to the Runtime

**The trap:** You see that the runtime returns `[]` for unmatched events and think "that's a bug, let me add a fallback." It's not a bug. The Projection Engine handles this. Adding fallback emission back will break ledger disposition consistency and re-introduce the duplicate counting that M5 fixed.

**The fix:** If an event isn't being surfaced, check: (a) is it in the ledger? (b) what's its disposition? (c) is the Projection Engine finding it? The answer is always in the ledger.

### Pitfall 3: Editing `.env` Files Directly

**The trap:** You need to add a variable and reach for `echo >> .env` or `write_file`. This is forbidden. The backend regenerates `.env` on every deploy and your change will be silently blown away.

**The fix:** Always use `add_environment_key` or `bulk_add_environment_keys`. This project uses `chrome.storage.local` and IndexedDB, so `.env` files may not be needed at all. But if the workspace server needs configuration, use the env key tool.

### Pitfall 4: Using Dev Commands as Background Services

**The trap:** You need a process to run and think `npm run dev` or `vite` in a background service is fine. It's not. The container pauses after 10 min idle; dev processes don't survive.

**The fix:** Always register production commands via `add_background_service`. For this project, the extension is served by Caddy from `dist/` and `download/` — no dev server is needed.

### Pitfall 5: Comparing `liveInteractions` vs Projection Directly

**The trap:** You write a test that does `compareOutputs(liveInteractions, projection.interactions)` and expect `match: true`. Under M5, they intentionally diverge: `liveInteractions` includes interrupted/abandoned interactions, but the projection excludes them.

**The fix:** Use the self-consistency check instead: verify every discrete ledger event is represented in the projection (either by a completed interaction or an Unclassified).

### Pitfall 6: Thinking the Test Count Reflects Live Code

**The trap:** You see "4072 tests" and think the live codebase has 4072 tests of coverage. It doesn't. Roughly 1,500–2,000 tests are for dead code (`tests/evidence-engine/`, `tests/recognition/`).

**The fix:** When evaluating coverage, look at test files in `tests/runtime/`, `tests/definitions/`, `tests/presentation/`, `tests/tap/`, `tests/capabilities/`, `tests/domain/`. These test live code.

### Pitfall 7: Assuming Content Scripts Are Always Injected

**The trap:** You think Chrome's `manifest.json` content_scripts declaration handles injection. It doesn't — not for already-open tabs, and not after SPA navigations through tracking redirects.

**The fix:** The health check (`ensureContentScriptInjected`) handles this. If you're debugging capture loss, always check whether the content script's `cmdrunner_is_recording` flag is set on the target page.

### Pitfall 8: Adding Gesture Correlation or Timeouts to the Runtime

**The trap:** You see a mousedown followed by a click and think the runtime should correlate them. It shouldn't. The runtime does only evidence classification and lifecycle management.

**The fix:** Gesture correlation is the Workflow Normalizer's job (`src/presentation/workflow-normalizer.ts`). The runtime sees each event independently.

---

## 8. Continuing the Roadmap Without Re-Architecting

The architecture is **complete and stable**. The Evidence Ledger, Component Runtime, Projection Engine, and Workflow Normalizer form a clean 6-layer pipeline with well-defined contracts. **Do not re-architect any of these layers.** Extend them.

### How to Add a New Interaction Type

1. **Create the definition:** `src/definitions/<type>.ts` — implement `ComponentDefinition`
2. **Register it:** Add to `ALL_DEFINITIONS` in `src/definitions/index.ts`
3. **Map to IR:** Add a case in `output-adapter.ts:toIRActions()` — map to an existing `IRAction` or add a new one
4. **Test it:** Write tests for trigger detection, lifecycle, and IR mapping

No other files need to change. The pipeline will automatically: capture the event → append to ledger → classify via the new definition → project → normalize → output.

### How to Add a New Capability

1. **Create the rule:** `src/capabilities/rules/<capability>.ts`
2. **Register it:** Add to the capability engine
3. **Test it:** Write tests for evidence extraction and conflict resolution

### How to Implement AI Understanding (Phase 3 of Roadmap)

This is the largest remaining piece of work. The spec exists (`milestone-ai-observer-session-context.md`) but was never implemented.

1. **Do NOT build it into the runtime.** The runtime stays deterministic.
2. **Build it as a post-recording analysis pass** that reads `liveInteractions` and writes back `AIUnderstanding`.
3. **Feed it to `buildIRPlan`** which currently receives `understanding: null`.
4. **Use `create_openai_api_key(project_id)`** to mint an API key. Never hardcode one.

### How to Remove Dead Code

1. **Delete the directories:** `src/classifier/`, `src/recorder/recognition/`, `src/recorder/enrichment/`, `src/recorder/pipeline/`
2. **Delete their tests:** `tests/evidence-engine/`, `tests/recognition/`, `tests/recorder/`
3. **Remove any imports** from live code that reference them (grep first)
4. **Update `ENGINEERING-HANDOVER.md`** with the new test count and line counts
5. **Run full test suite** — verify nothing broke

---

## 9. Engineering Philosophy

### How to Think About This Codebase

This is a **deterministic-first** system. The architecture was designed with a clear hierarchy:

```
Browser evidence (ground truth)
        ↓
Existing knowledge (patterns, definitions)
        ↓
Deterministic reasoning (classification, capability inference)
        ↓
AI (only when all else fails, and always as hypothesis + confidence)
```

Every design decision should be evaluated against this hierarchy. If you can solve something deterministically, do not reach for AI. If you must use AI, its output is a hypothesis with a confidence score, never ground truth.

### How to Make Architectural Decisions

1. **Check the invariants first.** Does your change violate INV-1 through INV-7? If yes, stop.
2. **Check the principles.** Does it violate P1–P9 or the 10 architecture principles? If yes, stop.
3. **Check for existing solutions.** The Workflow Normalizer, Projection Engine, and Evidence Ledger were designed to be permanent. Can your change be expressed as an extension of these rather than a modification?
4. **Prefer additive change.** AP7 (Additive Extensibility): new interaction types should be addable without touching existing code. If you must modify existing definitions to add a new one, the abstraction is wrong.
5. **Separate concerns.** The runtime classifies. The Projection Engine projects. The Normalizer filters. The Capability Engine infers. Do not mix these responsibilities.
6. **Pure functions where possible.** The Projection Engine is pure. The Workflow Normalizer is pure. Prefer this pattern for new layers.
7. **Evidence is immutable.** The ledger is append-only. Subsumed interactions are removed from presentation, not from evidence. Never delete evidence.

### How to Write Tests

- **Test through the full pipeline** when possible. Use the `processFull()` pattern (ledger append → runtime process → flush → projection) rather than testing `runtime.process()` in isolation.
- **Write self-consistency tests** for any pipeline change: every discrete event in the ledger should be represented in the output.
- **Test edge cases:** bare divs, SVG elements, role-less spans, elements with `tabindex=-1`, elements with "select" in their class name but no select semantics.
- **One test file per concern.** If you're testing a new definition, create `tests/definitions/<type>.test.ts`. If you're testing a runtime change, add to `tests/runtime/`.

### How to Debug

When something doesn't work:

1. **Don't guess. Observe.** Use the SW diagnostic snippet from `ENGINEERING-HANDOVER.md` section 9.
2. **Check the ledger first.** Is the event in the ledger? What's its disposition?
3. **Check storage keys.** `cmdrunner_live_interactions`, `cmdrunner_evidence_ledger`, `cmdrunner_verification_result`.
4. **Check the content script.** Is `cmdrunner_is_recording` set on the page? Is the content script responding to PING?
5. **Search notes.** There are 63 notes in `.drytis/notes/`. Many are postmortems for bugs you might encounter. `grep -r "<keyword>" .drytis/notes/` before re-deriving a root cause.

### How to Communicate With the User

- Say "get" not "pull". Say "publish" not "push". Never use git jargon.
- Ask before publishing. "Ready to publish your changes?"
- Report what you built, what passed, and what the download URL is.
- When showing test results: total count, file count, and duration.
- When the user tests the extension: ask for the SW diagnostic output if something is wrong. Don't guess.

---

## 10. The First Hour Checklist

Run through this when you start:

```
[ ] 1. Read ENGINEERING-HANDOVER.md (20 min)
[ ] 2. Read this document (5 min)
[ ] 3. npm ci && npm run build && npm test — all green?
[ ] 4. git log --oneline -10 — understand recent history
[ ] 5. Read src/shared/component-types.ts — understand the types
[ ] 6. Read src/runtime/component-runtime.ts:process() — understand classification
[ ] 7. Read src/runtime/projection-engine.ts — understand projection
[ ] 8. Read src/runtime/evidence-ledger.ts — understand dispositions
[ ] 9. Understand what's dead (section 4 above) — don't read it
[ ] 10. Check the roadmap (ENGINEERING-HANDOVER.md section 8) — know what's next
```

You are now ready to work. Start with the roadmap's Phase 1 (stabilize and clean up)
unless the user directs you elsewhere.

---

**This document is your operating manual. Keep it open.**
