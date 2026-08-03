# 9. Repository Guide

## Folder Structure

```
/workspace/
├── src/                          ← All extension source code
│   ├── manifest.json             ← Chrome Extension MV3 manifest
│   │
│   ├── background/               ← Service worker (extension orchestration)
│   │   └── service-worker.ts
│   │
│   ├── recorder/                 ← Recording pipeline (observer, classifier, pipeline)
│   │   ├── deterministic-recorder.ts     ← Legacy content script (still production)
│   │   ├── recording-session.ts          ← Session lifecycle + event storage
│   │   ├── recorded-event.ts             ← Event type definition
│   │   ├── interaction-types.ts          ← 33 interaction type definitions
│   │   ├── action-id.ts                  ← Sequential ID generator
│   │   ├── element-id-generator.ts       ← Element ID generator
│   │   ├── step-id-generator.ts          ← Step ID generator
│   │   ├── surface-detector.ts           ← Page surface detection
│   │   ├── observer/                     ← Architecture C observer
│   │   │   ├── universal-interaction-observer.ts
│   │   │   ├── universal-observer-init.ts
│   │   │   └── observer-helpers.ts       ← Pure functions (identity, selectors, etc.)
│   │   ├── coalescer/
│   │   │   └── snapshot-coalescer.ts     ← Event grouping + temporal windowing
│   │   ├── context/
│   │   │   ├── state-tracker.ts          ← Session Context L1 (deterministic state)
│   │   │   └── state-tracker-init.ts
│   │   ├── pipeline/
│   │   │   ├── architecture-c-pipeline.ts ← Full Architecture C orchestrator
│   │   │   └── interaction-assembler.ts   ← Composite interaction buffering
│   │   ├── recognition/                  ← Component recognition
│   │   │   ├── pattern-catalogue.ts      ← 11 pattern definitions (DECLARATIVE)
│   │   │   ├── structural-recognizer.ts  ← Tier 1 (ARIA/HTML)
│   │   │   ├── behavioral-recognizer.ts  ← Tier 2 (evidence signatures)
│   │   │   ├── component-registry.ts     ← Component lifecycle management
│   │   │   └── orchestrator.ts            ← Coordinates recognition
│   │   └── enrichment/                   ← Phase 5 post-recording enrichment
│   │       ├── enrichment-orchestrator.ts ← End-to-end pipeline
│   │       ├── dom-inspector.ts           ← DOM access abstraction
│   │       ├── interaction-contract-deriver.ts
│   │       ├── option-set-extractor.ts
│   │       ├── behavioral-contract-deriver.ts
│   │       ├── semantic-aggregator.ts     ← Lifecycle occurrence segmentation
│   │       ├── workflow-deriver.ts
│   │       ├── surface-deriver.ts
│   │       └── fragment-assembler.ts
│   │
│   ├── classifier/               ← Interaction classification
│   │   ├── interaction-detector.ts       ← V1 rule-based (33 types)
│   │   ├── interaction-types.ts
│   │   └── evidence/                     ← V2 evidence engine
│   │       ├── engine.ts                 ← Weighted voting
│   │       ├── detector.ts
│   │       ├── combination.ts
│   │       ├── merge-layer.ts            ← V2-primary + V1-fallback
│   │       ├── ab-comparison.ts
│   │       ├── types.ts
│   │       └── providers/                ← 5 evidence providers
│   │           ├── dom-provider.ts
│   │           ├── aria-provider.ts
│   │           ├── event-sequence-provider.ts
│   │           ├── mutation-provider.ts
│   │           └── css-classname-provider.ts
│   │
│   ├── generation/               ← Test artifact generation
│   │   ├── verb-mapping-table.ts         ← FROZEN verb mappings
│   │   ├── types.ts
│   │   ├── contracts/
│   │   │   ├── generator-contract.ts
│   │   │   └── execution-json-types.ts
│   │   ├── engine/
│   │   │   ├── generation-engine.ts      ← Main orchestrator
│   │   │   ├── semantic-classifier.ts
│   │   │   ├── multi-tier-classifier.ts
│   │   │   ├── semantic-templates.ts
│   │   │   ├── step-to-semantic.ts
│   │   │   ├── locator-resolution-engine.ts
│   │   │   ├── confidence-engine.ts
│   │   │   ├── workflow-analyzer.ts
│   │   │   └── readability-optimizer.ts
│   │   ├── generators/
│   │   │   ├── canonical-step-generator.ts   ← Plain-English steps
│   │   │   ├── execution-json-generator.ts   ← CmdRunner JSON
│   │   │   └── playwright-generator.ts       ← Playwright code
│   │   └── registry/
│   │       └── generator-registry.ts
│   │
│   ├── adapters/                 ← Output format adapters
│   │   └── playwright/
│   │       ├── action-renderer.ts        ← IRAction → Playwright code
│   │       ├── locator-renderer.ts       ← ResolvedLocator → locator string
│   │       ├── assertion-renderer.ts     ← IRAssertion → expect() calls
│   │       ├── test-function-renderer.ts ← IRStep[] → test function
│   │       ├── page-object-renderer.ts   ← Optional POM pattern
│   │       ├── project-generator.ts      ← Complete project export
│   │       └── __fixtures__/             ← Reference IR plans for testing
│   │
│   ├── ai/                       ← AI integration
│   │   ├── ai-observer.ts                ← Advisory classification
│   │   ├── ai-service.ts                 ← Provider routing
│   │   ├── ai-understanding.ts
│   │   ├── provider-manager.ts
│   │   ├── connection-tester.ts
│   │   ├── types.ts
│   │   ├── index.ts
│   │   └── providers/                    ← 6 provider implementations
│   │       ├── types.ts
│   │       ├── openai.ts
│   │       ├── claude.ts
│   │       ├── gemini.ts
│   │       ├── azure-openai.ts
│   │       ├── openrouter.ts
│   │       └── custom.ts
│   │
│   ├── domain/                   ← Domain model (entities, enums, IR)
│   │   ├── enums.ts                      ← ALL enums (single source of truth)
│   │   ├── entities/
│   │   │   ├── ui-element.ts             ← FOUNDATIONAL
│   │   │   ├── observed-transition.ts   ← FOUNDATIONAL
│   │   │   ├── component-grouping.ts     ← FOUNDATIONAL
│   │   │   ├── application-knowledge.ts  ← DERIVED VIEWS + FRAGMENT
│   │   │   ├── approved-test-case.ts
│   │   │   ├── element.ts
│   │   │   ├── project.ts
│   │   │   └── source-artifact.ts
│   │   ├── execution-ir/
│   │   │   ├── types.ts                  ← IR type system
│   │   │   ├── generator.ts              ← ATC → IR plan
│   │   │   ├── staleness.ts              ← Staleness detection
│   │   │   ├── index.ts
│   │   │   └── adapters/
│   │   │       ├── ir-executor.ts
│   │   │       ├── ir-code-generator.ts
│   │   │       └── index.ts
│   │   └── errors/
│   │       └── invariant-errors.ts
│   │
│   ├── repository/               ← Repository UI + data layer
│   │   ├── index.html
│   │   ├── repository-page.ts
│   │   ├── repository-service.ts
│   │   ├── repository.css
│   │   ├── types.ts
│   │   └── v2/                           ← Dexie-backed persistence
│   │       ├── interfaces/               ← Repository contracts
│   │       │   ├── unit-of-work.ts
│   │       │   ├── element-repository.ts
│   │       │   ├── execution-ir-repository.ts
│   │       │   ├── project-repository.ts
│   │       │   ├── source-artifact-repository.ts
│   │       │   └── test-case-repository.ts
│   │       └── dexie/                    ← Dexie implementation
│   │           ├── dexie-database.ts
│   │           ├── dexie-unit-of-work.ts
│   │           ├── dexie-unit-of-work-factory.ts
│   │           └── dexie-*-repository.ts
│   │
│   ├── shared/                   ← Cross-cutting types
│   │   ├── types.ts                      ← AppMessage, SessionEvent, ElementIdentity, etc.
│   │   ├── messaging.ts                  ← Typed message helpers
│   │   ├── architecture-types.ts         ← Architecture C contracts
│   │   ├── evidence-types.ts             ← Evidence engine types
│   │   └── classifier-constants.ts       ← Classifier constants
│   │
│   ├── sidepanel/                ← Side Panel UI
│   │   ├── index.html
│   │   ├── sidepanel.ts
│   │   ├── timeline-renderer.ts
│   │   └── sidepanel.css
│   │
│   ├── settings/                 ← Settings/options page
│   │   ├── index.html
│   │   ├── settings.ts
│   │   └── settings.css
│   │
│   ├── screenshots/              ← Screenshot capture
│   │   └── screenshot-service.ts
│   │
│   ├── storage/                  ← Chrome storage abstraction
│   │   ├── storage-service.ts
│   │   └── schema-version.ts
│   │
│   ├── infrastructure/           ← Cross-cutting infrastructure
│   │   ├── audit-manager.ts
│   │   ├── error-handler.ts
│   │   └── logging-manager.ts
│   │
│   └── assets/                   ← Icons
│       ├── icon-16.png
│       ├── icon-48.png
│       └── icon-128.png
│
├── tests/                        ← All test files (124 files, 3324 tests)
│   ├── mock-chrome.ts                     ← Chrome API mock
│   ├── helpers.ts                         ← Test helpers
│   ├── enrichment-*.test.ts               ← Phase 5 tests (8 files)
│   ├── evidence-engine/                   ← V2 engine tests
│   ├── domain/                            ← Entity tests
│   ├── adapters/playwright/               ← Adapter tests
│   ├── recognition/                       ← Recognition tests
│   ├── repository-v2/                     ← Repository tests
│   └── ...                                ← Feature-specific tests
│
├── docs/                         ← Documentation (this handover)
│   ├── handover/                          ← Project handover docs
│   ├── TECHNICAL_ARCHITECTURE.md          ← V1 architecture reference
│   ├── architecture-review.md             ← UI Knowledge Model review
│   └── architecture-walkthrough.md        ← End-to-end scenario
│
├── .drytis/                      ← Development blueprints
│   ├── specs/                             ← 113 task specifications
│   ├── notes/                             ← 38 debugging/analysis notes
│   ├── spec.md, scope.md, architecture.md ← Project blueprints
│   ├── patterns.md                        ← Coding standards
│   ├── infrastructure.md                  ← Infra setup
│   └── domain-schema.md, domain-erd.md    ← Domain model design
│
├── legacy/                       ← Archived old code
├── public/                       ← Demo/validation HTML pages
├── userDocs/                     ← User-uploaded screenshots/docs
├── package.json
├── vite.config.ts
├── vitest.config.ts
├── tsconfig.json
└── .gitignore
```

## Important Files to Know

### Entry Points
| File | Purpose |
|------|---------|
| `src/manifest.json` | Extension manifest — defines content scripts, service worker, side panel |
| `src/background/service-worker.ts` | Service worker — extension lifecycle, message routing |
| `src/recorder/deterministic-recorder.ts` | Production content script — captures interactions |
| `src/sidepanel/index.html` | Side Panel UI entry |

### Key Source Files (read these first)
| File | Why It's Important |
|------|-------------------|
| `src/domain/enums.ts` | ALL domain enums — single source of truth |
| `src/shared/types.ts` | All shared types — `AppMessage`, `SessionEvent`, `ElementIdentity` |
| `src/recorder/recognition/pattern-catalogue.ts` | Declarative pattern definitions — drives all recognition |
| `src/recorder/enrichment/semantic-aggregator.ts` | Core algorithm — lifecycle occurrence segmentation |
| `src/recorder/enrichment/enrichment-orchestrator.ts` | Enrichment pipeline — wires everything together |
| `src/generation/verb-mapping-table.ts` | Frozen verb mappings — source of truth for step phrasing |
| `src/domain/entities/application-knowledge.ts` | All derived view types + fragment definition |

### Configuration
| File | Purpose |
|------|---------|
| `package.json` | Dependencies, scripts |
| `vite.config.ts` | Vite + @crxjs build config |
| `vitest.config.ts` | Test config (jsdom environment) |
| `tsconfig.json` | TypeScript config (strict mode) |

## Build Process

```bash
# Install dependencies
npm ci

# Build the extension (outputs to dist/)
npm run build

# Run all tests
npx vitest run

# Watch mode (for development)
npm run dev    # builds with --watch
npm run test:watch  # tests with --watch
```

### What `npm run build` does
1. Vite + @crxjs/vite-plugin compiles TypeScript and bundles the extension
2. Outputs to `dist/` with the correct MV3 structure
3. HTML pages (sidepanel, settings, repository) are bundled with their CSS/JS
4. The service worker is bundled as a module

### How the extension is loaded
The `dist/` directory is served by `npx serve dist -l 5173` and proxied through Caddy. In production, the `dist/` directory is loaded as an unpacked extension in Chrome.

## Development Workflow

### Adding a new interaction type
1. Add the interaction to `src/recorder/interaction-types.ts`
2. Add classification rules to `src/classifier/interaction-detector.ts` (V1) or evidence providers (V2)
3. Add a verb mapping in `src/generation/verb-mapping-table.ts`
4. Add a semantic template in `src/generation/engine/semantic-templates.ts`
5. Write tests in `tests/`

### Adding a new UI pattern
1. Register the pattern in `src/recorder/recognition/pattern-catalogue.ts`
2. Add structural recognition rules (if applicable)
3. Add behavioral signature (if applicable)
4. The semantic aggregator will handle it automatically (generic algorithm)

### Adding a new enrichment module
1. Create the module in `src/recorder/enrichment/`
2. Add it to the pipeline in `enrichment-orchestrator.ts`
3. Write tests in `tests/enrichment-*.test.ts`
4. Update the spec in `.drytis/specs/ui-knowledge-model-phase5.md`

### Adding a new AI provider
1. Create the provider in `src/ai/providers/`
2. Implement the provider interface from `src/ai/providers/types.ts`
3. Register it in `src/ai/provider-manager.ts`
4. Add a settings UI option in `src/settings/`
