# Legacy Module Reuse Protocol

Established: 2026-07-27, before Phase 1 implementation.

## Principle
The architecture (design-specification.md v3.2 Frozen) is the source of truth.
Legacy code is reference material, not trusted infrastructure.
"Worked before" is not sufficient evidence of correctness.

## Protocol for every reused module

1. **Review critically** — read the full implementation, understand what it does and why
2. **Map to new architecture** — verify it conforms to new interfaces, types, naming conventions
3. **Identify and remove:**
   - Hidden assumptions (browser-specific behavior, encoding hacks, format coupling)
   - Technical debt (workarounds, TODOs, defensive coding for bugs that don't exist here)
   - Unnecessary complexity (features not used by the new pipeline)
   - Obsolete logic (patterns from the old architecture that don't apply)
4. **Refactor to align** — adapt to the current type system, naming conventions, module structure
5. **No hidden dependencies** — the module must not import or reference legacy code, legacy types, or legacy patterns
6. **Architecture wins** — if a legacy module doesn't fit cleanly, rewrite it. Never adapt the architecture to accommodate old code.

## Decision criteria
- If the module's core algorithm is sound AND fits the new types: port with cleanup
- If the module's algorithm is sound but coupling/assumptions are deep: extract the algorithm, rewrite the interface
- If the module has design issues or doesn't fit: rewrite from scratch using the architecture spec

## Applies to all 18 reused modules from §10.1:
identity, dom-context, accessible-name, implicit-role, css-selector, xpath,
shadow-dom, iframe-context (8 extractors)
surface-detector, hover-detector, datepicker-detector (3 detectors)
value-tracker, locator-ranking, execution-ir, ir-executor, action-executor,
assertion-evaluator, locator-resolver, dexie-repository, ai-provider-abstraction
