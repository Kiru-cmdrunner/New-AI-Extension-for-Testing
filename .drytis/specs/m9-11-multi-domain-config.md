# M9.11 — Multi-Domain Configuration

## Goal
Make Application Understanding genuinely extensible beyond e-commerce.
Adding a new domain must be a DATA-ONLY operation — no core algorithm
modifications.

## Self-Review: Current State by Module

| Module | Status | Action |
|---|---|---|
| Domain signatures | ✅ registry API exists | Add HR + DevTools packs |
| Entity type registry | ✅ registry API exists | Already has HR/DevTools seeds |
| StateBuilder legacy | ⚠️ Amazon patterns embedded | Registry consulted FIRST (order flip: registry → legacy) for entity resolution ONLY; legacy still runs as fallback for back-compat |
| State vocabulary | ❌ no API | Add StateVocabularyRegistry |
| View patterns | ✅ registry API exists | Add HR + DevTools packs |
| Intent vocabulary | ❌ no API | Add IntentVocabularyRegistry |
| Page content selectors | ✅ registry API exists | Add HR + DevTools packs |
| Network patterns | ❌ no API | Add NetworkPatternRegistry |
| Outcome confirmation views | ❌ no API | Add confirmation-view set to domain pack |
| Component recognizer | ✅ domain-neutral (ARIA) | None |
| Domain classifier | ✅ algorithm neutral | Reads signatures from registry |
| Intent labeler | ❌ hard-coded method→intent map | Add method→intent overrides registry |
| Workflow discoverer | ⚄ almost neutral | genericIntents from vocabulary registry |

## Design: Domain Configuration Pack

A `DomainPack` is one JSON-serializable object containing ALL domain-specific
data for one domain:

```ts
interface DomainPack {
  id: string;                      // 'hr', 'devtools', ...
  label: string;                   // 'Human Resources'
  domainType?: DomainType;         // for classification
  signatures: DomainSignature[];   // classification evidence
  entityTypes: EntityTypeDetectionRule[];  // entity detection
  stateVocabulary: StateVocabEntry[];      // lifecycle states
  viewPatterns: ViewPatternSpec[];         // view detection
  intentVocabulary: IntentVocabEntry[];    // intent labels
  networkPatterns: NetworkPatternSpec[];   // API classification
  confirmationViews: string[];             // outcome success patterns
  pageContentSelectors: SemanticSelector[]; // page-content semantics
}
```

## Registries to create
1. `StateVocabularyRegistry` — state keyword → canonical state
2. `IntentVocabularyRegistry` — intent entries with matchers
3. `NetworkPatternRegistry` — URL pattern → operation
4. `DomainPackRegistry` — aggregates all sub-registries; install(pack)

## Registry-first resolution order changes (additive only)
- StateBuilder entity resolution: registry → legacy Amazon logic (for entity type only). Amazon behavior preserved because e-commerce types resolve identically via either path; registry-first only matters when registry has a matching rule.
- Outcome determiner: confirmation views = DEFAULT ∪ domain-pack additions.
- Intent labeler: optional registry param; falls back to getAllVocabEntries() when absent.

## Files (planned)
```
src/understanding/domain-config/
  domain-pack-types.ts        (NEW — DomainPack + sub-spec types)
  domain-pack-registry.ts     (NEW — install/lookup)
  state-vocabulary-registry.ts (NEW)
  intent-vocabulary-registry.ts (NEW)
  network-pattern-registry.ts (NEW)
  packs/
    ecommerce-pack.ts         (NEW — extracted from existing defaults; NOT installed by default beyond current behavior)
    hr-pack.ts                (NEW — OrangeHRM)
    devtools-pack.ts          (NEW — GitHub)
```

## Acceptance Criteria
- [ ] DomainPack type aggregates all 8 configurable dimensions
- [ ] DomainPackRegistry.install/uninstall/getInstalled work
- [ ] StateVocabularyRegistry: register entry → normalizeStateText resolves it
- [ ] IntentVocabularyRegistry: register entry → labelIntent resolves it
- [ ] NetworkPatternRegistry: register pattern → classifyUrl resolves it
- [ ] E-commerce pack: data extracted from current defaults, preserves Amazon behavior exactly
- [ ] HR pack: OrangeHRM patterns (/pim, /leave, /admin, /recruitment, /time), employee/leave-request/candidate entities, approval lifecycle states, save/submit/assign intents
- [ ] DevTools pack: GitHub patterns (/issues, /pulls, /repos, commits), issue/PR/commit entities, open/closed/merged lifecycle, merge/comment/review intents
- [ ] StateBuilder consults registry before legacy (entity type only)
- [ ] Outcome determiner accepts optional confirmation-view overrides
- [ ] Intent labeler accepts optional vocabulary registry
- [ ] NetworkSignalExtractor accepts optional pattern registry
- [ ] Amazon regression: existing tests unchanged and green
- [ ] TSC = 0, full regression green, clean build
- [ ] Focused tests: each registry, each pack, integration with StateBuilder/OutcomeDeterminer/IntentLabeler/NetworkSignalExtractor

## Out of Scope
- M9.12 production wiring; AI/LLM; refactoring frozen M1–M8 algorithms
