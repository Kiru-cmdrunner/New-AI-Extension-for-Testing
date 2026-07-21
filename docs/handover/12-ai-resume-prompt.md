# 12. AI Resume Prompt

> **This document defines the standard onboarding protocol for any AI assistant joining this project. Follow these steps before proposing or making any changes.**

> **← Back to [Root README](../../README.md) | [Handover Index](./README.md) | [AI Handover Guide](./10-ai-handover-guide.md)**

---

## Onboarding Protocol

### Step 1: Read the Documentation (in this order)

Read these documents fully — do not skim:

| # | Document | Purpose |
|---|----------|---------|
| 1 | [`10-ai-handover-guide.md`](./10-ai-handover-guide.md) | Project overview, what's done, what's frozen, where to continue |
| 2 | [`01-project-vision.md`](./01-project-vision.md) | What CmdRunner is and why it exists |
| 3 | [`04-design-decisions.md`](./04-design-decisions.md) | 12 architectural decisions with rationale + frozen invariants |
| 4 | [`05-implementation-status.md`](./05-implementation-status.md) | What's complete, partial, and pending |
| 5 | [`07-development-principles.md`](./07-development-principles.md) | 10 engineering principles that shape every change |

Then read these as needed for the task at hand:

| # | Document | When to Read |
|---|----------|-------------|
| 6 | [`02-architecture-overview.md`](./02-architecture-overview.md) | Before working on any subsystem |
| 7 | [`03-current-architecture.md`](./03-current-architecture.md) | Before modifying an existing phase |
| 8 | [`08-knowledge-model.md`](./08-knowledge-model.md) | Before working on enrichment, recognition, or the knowledge model |
| 9 | [`09-repository-guide.md`](./09-repository-guide.md) | Before navigating the codebase |
| 10 | [`06-future-roadmap.md`](./06-future-roadmap.md) | Before planning new work |
| 11 | [`11-architectural-decision-log.md`](./11-architectural-decision-log.md) | When questioning why something was built a certain way |

---

### Step 2: State Your Understanding

After reading, summarize the following **in your own words** before proposing any work:

1. **What this project is** — in 2–3 sentences
2. **Current implementation stage** — which phases are complete, which are in progress
3. **Frozen architectural decisions** — list the invariants that must not be violated
4. **What remains to be implemented** — the next priorities from the roadmap
5. **Development principles** — the rules that govern how changes are made here

This serves two purposes: it confirms you've absorbed the documentation, and it surfaces any misunderstandings before they cause damage.

---

### Step 3: Respect Frozen Architecture

The following are **permanently frozen** and must not be changed without explicit project owner approval:

| Frozen Decision | What It Means | Where Documented |
|-----------------|---------------|------------------|
| **AP1: Observer captures; classifier decides** | These concerns must never be merged | ADR-007 |
| **AP4: Evidence Sovereignty** | Deterministic evidence always overrides AI — structurally, not by configuration | ADR-008 |
| **Three foundational entities** | UiElement, ObservedTransition, ComponentGrouping — only deterministic data | ADR-017 |
| **No actionType enum in LogicalAction** | Actions are structural descriptions, consumers classify | ADR-019 |
| **Semantic aggregator is generic** | Zero PatternType references in the algorithm | ADR-019 |
| **Verb mapping table** | The source of truth for step phrasing | ADR-003 |
| **Hover recording strategy** | Permanently frozen — do not reopen | ADR-005 |
| **8 AI Principles (P1–P8)** | AI behavior constraints (max 3 hypotheses, confidence [0.05, 0.95], evidence citation, etc.) | ADR-009 |
| **IR is derived and disposable** | Never treat Execution IR as authoritative | ADR-016 |
| **Only CONFIRMED components are enriched** | TENTATIVE and DEVELOPING components are not enriched | ADR-018 |
| **Source Artifacts are immutable** | Never deleted or modified | ADR-016 |

**If you believe a frozen decision must change:**
1. Do NOT change it unilaterally
2. Document the architectural limitation you've discovered
3. Present your reasoning to the project owner
4. Await explicit approval before proceeding

---

### Step 4: Follow the Development Process

When you begin implementing changes:

1. **Write a spec** at `.drytis/specs/<task-name>.md` with acceptance criteria as checkboxes
2. **Build a todo list** with `todo_write`
3. **Write tests first** (TDD per phase) — every module gets its own test file
4. **Implement** following existing code patterns (kebab-case files, PascalCase types, strict TS)
5. **Run the full test suite** — all 3324+ tests must pass (`npx vitest run`)
6. **Run the build** — `npm run build` must succeed
7. **Commit** with the established message convention: `feat: <milestone> — <description> (<test count>)`

**Coding conventions:**
- Files: `kebab-case.ts`
- Types/Classes: `PascalCase`
- Constants/enums: `UPPER_SNAKE` or `PascalCase` (follow existing file)
- TypeScript strict mode — no `any` without justification
- Pure functions for core logic — side effects in adapters only
- Typed contracts at every boundary — no untyped message passing

---

### Step 5: Before You Finish

- Verify the todo list is 100% complete
- Ensure all tests pass and the build succeeds
- Confirm the git working tree is clean (`git status`)
- If you created new modules, update the relevant documentation:
  - New subsystem → update [03-current-architecture.md](./03-current-architecture.md)
  - New design decision → add to [04-design-decisions.md](./04-design-decisions.md) and the [decision log](./11-architectural-decision-log.md)
  - New implementation status → update [05-implementation-status.md](./05-implementation-status.md)
  - New important file → update [09-repository-guide.md](./09-repository-guide.md)

---

## What NOT to Do

- **Do not redesign frozen architecture.** The principles exist for reasons documented in the ADRs. If you think you have a better approach, read the ADR first — it explains what alternatives were already rejected.

- **Do not skip tests.** Every public function needs tests. The project has 3324 tests — that is the baseline, not a ceiling.

- **Do not modify `.env` files via shell or `write_file`.** Use the env key management tools only. (This applies if working within the Drytis workspace environment.)

- **Do not add `any` casts casually.** There are 162 pre-existing TS errors in legacy code — that is accepted debt. New code must have zero TS errors.

- **Do not commit secrets, API keys, preview URLs, or DB credentials in source code.** Reference them via env accessors.

- **Do not assume a feature is done because the code is written.** A feature is done when: tests pass, build succeeds, reviewer verifies spec compliance, and the spec's acceptance criteria are all checked.

---

## Quick Orientation Checklist

When you're ready to start working, verify you can:

- [ ] Run tests: `npx vitest run` → 3324+ tests pass
- [ ] Build: `npm run build` → succeeds
- [ ] Find a file: know that source is in `src/`, tests in `tests/`, specs in `.drytis/specs/`
- [ ] Find an enum: all enums live in `src/domain/enums.ts`
- [ ] Find a shared type: `src/shared/types.ts`
- [ ] Find a pattern definition: `src/recorder/recognition/pattern-catalogue.ts`
- [ ] Find the enrichment pipeline: `src/recorder/enrichment/enrichment-orchestrator.ts`
- [ ] Understand the feature flag: `ARCHITECTURE_C_ENABLED` in `chrome.storage.local`
