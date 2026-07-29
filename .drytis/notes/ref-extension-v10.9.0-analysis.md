# Reference Extension v10.9.0 — Complete Architecture Analysis

## Executive Summary
v10.9.0 inverts the architecture: all interaction detection moved OUT of the content script
INTO the service worker as a "Component Runtime" — a state-machine engine that processes
events live during recording via declarative component definitions.

## Key Architectural Differences from Integration Branch (v10.4.18)

### 1. Component Runtime (THE core innovation)
- Stateful component definitions process events in real-time in the SW
- 10 definitions: DatePicker(10), Dropdown(20), Checkbox(30), RadioButton(40),
  TextEntry(50), Hover(60), Link(70), Scroll(110), Navigation(120), Click(180)
- Each has: detectTrigger(), isInScope(), handleEvent(), shouldCancelOnOutside(),
  shouldCompleteOnOutside(), buildResult()
- Active component stack; stale components force-completed after 15s
- Dedup via seenEventIds (capped 500)
- State snapshotted to storage for MV3 crash recovery

### 2. SessionStorage Event Buffer with Exponential Backoff
- Events buffered in sessionStorage (survives SW death)
- Exponential backoff retry: 100ms → 200ms → 400ms → 800ms → 1600ms (max 5)
- Events only removed from buffer on confirmed delivery (response.ok === true)
- Flush on pagehide; resume on pageshow
- THIS IS THE MOST IMPORTANT RELIABILITY IMPROVEMENT

### 3. Hover Confidence Scoring (Real-Time Evidence Accumulation)
- Weighted evidence model with dwell-time gates:
  - aria-expanded changed: +100
  - Overlay/menu role in ancestors after 500ms: +70
  - aria-haspopup with listbox/dialog after 500ms: +60
  - Sustained dwell >3s with <10px displacement: +50
- Threshold: 50 to be "meaningful"

### 4. Content Script = Pure Event Forwarder
- 12 event types, capture phase, passive
- Per-event valueBefore/After (no session-wide valueTracker Map)
- Minimal suppression (scroll 16ms throttle, mousemove 50ms throttle)
- NO classification, NO surface detection, NO hover CSS analysis, NO date picker debouncing

### 5. No-Op Detection
- Dropdown same value → noOpSelection: true
- Radio already selected → noOpSelection: true
- TextEntry with no typing → userTyped: false
- Scroll with 0px delta → hasDelta: false

### 6. Capability Cross-Session Learning
- Repository tracks "capabilities" (abstract workflow definitions)
- New observations matched via weighted similarity:
  - Entry element (0.35), Input fields (0.30), Outcomes (0.25), Name (0.10)
- Thresholds: ≥0.75 auto-merge, 0.50-0.75 ambiguous, <0.50 new
- Confidence lifecycle: candidate → confirmed (2 sessions) → established (3+)

### 7. Runtime Element Healing During Test Execution
- When locator fails: extract fresh DOM context → generate new locators → persist heal → retry
- Two modes: cross-session healing (post-recording) and runtime healing (during execution)
- HealRecord with old/new strategies and reason tracking

### 8. Locator Ranking (5-tier)
- BUSINESS(1): data-testid, data-cy, data-qa → confidence 0.9
- ACCESSIBILITY(2): aria-label, aria-labelledby → 0.8
- STABLE_TECHNICAL(3): stable #id, name → 0.72
- CONTENT(4): accessibleName, placeholder → 0.62
- STRUCTURAL(5): CSS, XPath → 0.35
- Auto-generated ID detection (React, Angular, Vue, MUI, etc.)

### 9. Invariant-Driven Domain Model
- Element, LocatorStrategy, Capability use invariant errors
- Strict validation on construction and mutation
- Duplicate priority detection

### 10. Staleness Detection
- Checks elements modified after IR generation
- Checks generator version mismatch
- Informational only (doesn't block execution)

## What Was REMOVED from Integration Branch
- V2 Evidence Engine (5-provider weighted voting)
- Two-tier recognition (structural + behavioral)
- Pattern catalogue (6 declarative patterns)
- Enrichment pipeline (contracts, capabilities, workflows, surfaces)
- Page-world dialog interception
- Surface detection (post-click MutationObserver)
- CSS hover analysis
- A/B comparison + merge layer

## What This Means for Our Migration
The v10.9.0 component runtime is architecturally aligned with our Blueprint's
Lifecycle Engine (Phase 5). The component definitions map closely to our
PatternDefinition + LifecycleConfig concepts. However, v10.9.0 dropped the
evidence-based recognition that our Blueprint preserves as a core principle.

The MOST CRITICAL thing to incorporate is the SessionStorage event buffer
with exponential backoff — this solves the #1 reliability problem (SW restart
during recording). Our Phase 3 EventTap should implement this pattern.

Other things to incorporate:
- Component definition structure (maps to our PatternDefinition + LifecycleConfig)
- Hover confidence scoring model (maps to our evidence accumulation)
- No-op detection quality signals
- Locator ranking algorithm (5-tier with auto-generated ID detection)
- Per-event valueBefore/After (simpler than session-wide valueTracker)
