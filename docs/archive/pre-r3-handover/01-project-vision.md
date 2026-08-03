# 1. Project Vision

## What CmdRunner Is

CmdRunner is a **Chrome Extension** that records user interactions on any web application and converts them into structured, executable test automation. Unlike traditional recorders that produce brittle selectors and click-by-click scripts, CmdRunner builds a **semantic understanding** of what the user did — recognizing UI patterns (dropdowns, date pickers, modals), understanding business intent, and producing clean, maintainable test artifacts.

The extension sits in Chrome's Side Panel and captures interactions across all web pages the user visits during a recording session. When recording stops, it processes the raw interaction timeline through a multi-stage pipeline that classifies, enriches, and transforms events into:

1. **Plain-English test steps** — human-readable descriptions of each action
2. **Execution JSON** — CmdRunner's native automation format
3. **Playwright test code** — complete, runnable TypeScript test files
4. **Application Knowledge Fragment** — a semantic model of the application under test

## Long-Term Vision

CmdRunner aims to be the **bridge between manual exploration and automated testing**. A QA engineer, product manager, or developer should be able to:

1. Open a web app
2. Click "Start Recording"
3. Perform a workflow (book a flight, fill a form, navigate through tabs)
4. Click "Stop Recording"
5. Immediately receive a complete, readable, runnable test suite

The test suite should be **maintainable** — when a UI element changes, the system should detect staleness and offer self-healing locator resolution, not just break silently. The test steps should read like a human wrote them ("Select 'Economy' from the Travel Class dropdown"), not like a machine captured them ("Click div.class-xyz:nth-child(3)").

Beyond test generation, the project captures a **semantic model of the application** — understanding its components, their behaviors, and their relationships. This Application Knowledge Fragment can drive future capabilities: test impact analysis, coverage visualization, automated test maintenance, and AI-assisted test generation from natural language descriptions.

## Why This Extension Exists

### The Problem with Existing Recorders

Traditional browser test recorders (Chrome DevTools Recorder, Selenium IDE, Katalon) share fundamental limitations:

- **Brittle selectors** — they capture CSS/XPath at click time. When the UI changes, tests break silently.
- **No semantic understanding** — they record "click at (300, 200)" or "click .btn-primary", not "submit the login form".
- **No pattern recognition** — a custom dropdown (div + ARIA) is recorded as 5 separate clicks, not as "select 'Option B' from the dropdown".
- **No enrichment** — the recording captures what happened, not why it happened or what it means.
- **AI bolted on, not integrated** — existing tools that add AI do so as a post-processing step. CmdRunner integrates AI as an advisory layer within the classification pipeline, with deterministic evidence always taking priority.

### What CmdRunner Does Differently

| Capability | Traditional Recorders | CmdRunner |
|-----------|----------------------|-----------|
| Element identification | CSS selector at click time | 18-field identity signature (ARIA role, accessible name, tag, type, DOM path, test ID, classes, iframe context) |
| Interaction classification | Click = click | 10 canonical interaction types with 3-tier classification (structural → behavioral → AI) |
| Pattern recognition | None | Recognizes 11 UI patterns (dropdown, checkbox, radio, date picker, modal, tabs, accordion, slider, combobox, table, custom) |
| Semantic aggregation | Each event is a step | Multiple events grouped into logical actions (click + select = "choose option") |
| AI integration | Post-processing or none | Advisory layer with evidence sovereignty (deterministic evidence always wins) |
| Knowledge model | None | Dual output: test artifacts + Application Knowledge Fragment |
| Test output | Single format | Multiple: plain English, Execution JSON, Playwright code |
| Locator resilience | Re-record when broken | Staleness detection + self-healing architecture (designed, not yet materialized) |

## Design Philosophy

### 1. Application-Centric, Not AI-Centric

The project evolved through a critical realization: **the goal is understanding the application, not relying on AI to guess it.** AI is an advisory layer that enriches deterministic observations. The foundational knowledge — what elements exist, what transitions occurred, what components were recognized — is deterministic and observable. AI adds meaning and intent on top, but the system works correctly without it.

This is why the architecture has **Evidence Sovereignty** (AP4): Tier 1/2 deterministic evidence structurally overrides Tier 3 AI opinions. A click classified by structural rules as a "select" cannot be reclassified by AI as a "toggle".

### 2. Capture First, Classify Second

The recorder captures all interactions through a single universal observer. Classification happens later, in a pure-function pipeline with full evidence context. This separation means:
- The observer never needs to "decide" what something is
- The classifier has complete evidence (mutations, state changes, event sequences)
- Both can be tested independently
- New interaction types don't require new content scripts

### 3. Separation of Observation and Inference

Foundational entities (`UiElement`, `ObservedTransition`, `ComponentGrouping`) carry only **deterministic, observation-derived knowledge**. AI opinions, probabilistic inference, and semantic interpretations live in **derived views** (`InteractionContract`, `BehavioralContract`, `LogicalAction`, `ApplicationKnowledgeFragment`). This separation means the foundational data is trustworthy and reproducible — the same recording always produces the same foundational entities.

### 4. Progressive Enrichment

The pipeline enriches data progressively through stages, each building on the last:

```
Raw Events → Evidence Snapshots → Classified Interactions → Entity Creation →
Component Recognition → Semantic Enrichment → Knowledge Fragment Assembly
```

Each stage has well-defined inputs and outputs. Each can be tested independently. Each adds semantic richness without corrupting the deterministic foundation.

### 5. Dual Output

Every recording produces both **test artifacts** (for automation) and a **knowledge fragment** (for understanding). These are not competing concerns — they are complementary views of the same observation data. The test artifact tells you *what to do*; the knowledge fragment tells you *what the application is*.

## Overall Goals

1. **Zero-knowledge recording** — works on any web app without configuration, selectors, or DOM knowledge
2. **Semantic test steps** — output reads like a human wrote it
3. **Pattern-aware** — recognizes composite UI patterns, not just atomic clicks
4. **AI-enhanced, not AI-dependent** — AI improves results but isn't required for them
5. **Multi-format output** — plain English, JSON, Playwright, and extensible to other frameworks
6. **Application understanding** — builds a knowledge model alongside test artifacts
7. **Maintainable tests** — staleness detection, self-healing architecture, provenance tracking
8. **Provider-agnostic AI** — supports OpenAI, Claude, Gemini, Azure OpenAI, OpenRouter, and custom endpoints
