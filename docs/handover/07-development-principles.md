# 7. Development Principles

These are the engineering principles that shaped this codebase. They are not arbitrary rules — each one emerged from a specific problem encountered during development, and each one prevents a specific class of regression.

---

## 1. Architecture First, Code Second

**Principle:** Before writing any implementation code, design the architecture, write the spec, and create acceptance criteria. Only then begin coding.

**How it's applied:**
- Every feature starts with a spec in `.drytis/specs/<feature>.md`
- Specs include acceptance criteria as checkboxes
- The spec is reviewed and frozen before implementation begins
- The reviewer and tester sub-agents read the spec to verify compliance

**Why:** This project went through multiple architectural rewrites (Eras 1–4). Each rewrite was caused by coding before designing. The "architecture first" principle was adopted after the most painful rewrite and has prevented rewrites since.

**What happens if violated:** Code that works but doesn't fit the architecture. Technical debt accumulates. Eventually a rewrite is needed.

---

## 2. Validate Each Phase Before Continuing

**Principle:** Each architectural phase must be independently tested and verified before the next phase begins. A phase is not "done" when the code is written — it's done when all tests pass and the reviewer verifies compliance.

**How it's applied:**
- Bottom-up construction (Phase 0 → 1 → 2 → ... → 7)
- Each phase has its own test suite
- Phases depend only on earlier phases, never later ones
- The reviewer sub-agent checks spec compliance
- The infra_verifier sub-agent checks deployment readiness

**Why:** Skipping validation leads to compounding errors. A bug in Phase 2 that isn't caught becomes a mysterious failure in Phase 5 that's extremely hard to trace.

---

## 3. Frozen Decisions Require Explicit Justification to Change

**Principle:** Key design decisions are explicitly frozen. Changing them requires strong justification and project owner approval.

**How it's applied:**
- Design decisions are documented in `04-design-decisions.md`
- Specs marked `FROZEN` or `PERMANENTLY FROZEN` cannot be changed
- Invariants are listed and referenced in code comments

**Why:** This project spans multiple architectural eras (4 eras, 20 ADRs). Without frozen decisions, each new session risks reopening settled debates. Frozen decisions create stability.

**Frozen items include:** Evidence Sovereignty (AP4), the 8 AI principles (P1–P8), the verb mapping table, the 3 foundational entity model, the no-actionType-enum decision, the generic semantic aggregator.

---

## 4. Typed Contracts at Every Boundary

**Principle:** Every subsystem boundary has typed interfaces. No untyped message passing, no `any` at boundaries, no implicit data shapes.

**How it's applied:**
- `AppMessage` discriminated union for all extension messaging (21 message types)
- Typed interfaces for pipeline stages (`RawEvidence`, `InteractionSnapshot`, `CanonicalOutput`)
- Domain entity factories with invariant validation
- TypeScript strict mode

**Why:** Untyped boundaries cause integration bugs that only appear at runtime. Typed contracts catch mismatches at compile time and serve as living documentation.

---

## 5. Pure Functions for Core Logic

**Principle:** Classification, enrichment, and derivation logic should be pure functions. Side effects (DOM access, messaging, storage) are isolated to adapters.

**How it's applied:**
- The classifier is a pure function: `classifySnapshot(snapshot) → CanonicalOutput`
- The enrichment derivers are pure functions: `deriveInteractionContract(element, pattern) → InteractionContract`
- DOM access goes through the `DomInspector` interface, not direct `document.*` calls
- This makes everything testable in jsdom without a real browser

**Why:** Pure functions are deterministic, testable, and cacheable. They don't have hidden dependencies or side effects that make debugging nightmarish.

---

## 6. Feature Flags for Architectural Transitions

**Principle:** Major architectural changes run behind feature flags until proven. Both old and new systems coexist; the flag controls which is active.

**How it's applied:**
- `ARCHITECTURE_C_ENABLED` in `chrome.storage.local` controls Architecture C vs. legacy pipeline
- Both pipelines are fully implemented and tested
- The flag allows A/B comparison and safe rollback

**Why:** Big-bang rewrites are risky. Feature flags allow gradual rollout, comparison, and rollback without disrupting production.

---

## 7. Test Everything, Test Independently

**Principle:** Every subsystem has its own test suite. Tests don't cross subsystem boundaries. Each test file is focused on one module.

**How it's applied:**
- 3324 tests across 124 files
- Each enrichment module has its own test file (8 files, 145 tests)
- Each recognition module has its own test file (5 files)
- Integration tests use fixture-based implementations (e.g., `FixtureDomInspector` instead of real DOM)
- Tests run in jsdom environment

**Why:** When a test fails, you need to know immediately which module broke. Cross-subsystem tests hide the source of failures. Independent test suites make localization trivial.

---

## 8. Reusable Abstractions Over Duplication

**Principle:** When the same pattern appears in multiple places, extract an abstraction. Don't copy-paste logic.

**How it's applied:**
- The `DomInspector` interface abstracts DOM access (used by both option-set-extractor and enrichment-orchestrator)
- The pattern catalogue centralizes all pattern definitions (used by structural recognizer, behavioral recognizer, and semantic aggregator)
- The verb mapping table centralizes all step phrasing
- The provider abstraction centralizes all AI provider logic

**Why:** Duplicated logic diverges over time. When a bug is fixed in one copy but not another, subtle inconsistencies emerge. Centralized abstractions ensure consistency.

---

## 9. Readable Output Is a First-Class Requirement

**Principle:** Generated test steps must read like a human wrote them. Readability is not a post-processing afterthought — it's designed into the pipeline.

**How it's applied:**
- The Readability Optimizer merges redundant steps (consecutive text entries → one "enter text" step)
- The Verb Mapping Table provides human-readable verbs
- The Canonical Step Generator uses accessible names, not CSS selectors
- Semantic templates provide natural phrasing patterns

**Why:** If the output reads like machine-generated code, users won't trust it. Readable output is the difference between a tool people use and a tool people abandon.

---

## 10. Preserve Provenance

**Principle:** Every piece of data should carry information about where it came from. Source artifacts are immutable. Test runs pin to specific versions.

**How it's applied:**
- `SourceArtifact` entity is immutable — never deleted, never modified
- `TestRun` pins to a specific `ATCVersionId` — the test runs against the exact version it was created for
- `ExecutionIRPlan` tracks which elements it references for staleness detection
- AI hypotheses cite supporting evidence

**Why:** Without provenance, you can't trust your data. If a test fails, you need to know: which version of the test? Which elements? Which source generated it? Provenance makes debugging possible.
