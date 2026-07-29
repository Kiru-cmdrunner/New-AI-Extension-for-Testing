# Control Model — Implementation Feasibility Review

> **Purpose**: Validate that the Control Model is buildable within Chrome 
> extension constraints, identify real risks, and define risk-reduction 
> milestones before committing to the full architecture.

---

## Part 1: Feasibility Assessment by Component

### A. Control Discovery (Page Walk + MutationObserver)

**Feasible? YES, with one hard limitation.**

| Aspect | Verdict | Evidence |
|--------|---------|----------|
| `querySelectorAll('*')` traversal for initial discovery | ✅ Standard DOM API | Works in all content scripts |
| `getAriaRole()` + `computeAccessibleName()` | ✅ Already implemented | Channel A — 310 lines, tested |
| MutationObserver on `document.body` | ✅ Standard DOM API | Already used in 2 locations in codebase |
| `attributeFilter` with `subtree: true` | ✅ Supported | Already used in production code |
| MutationObserver on OPEN shadow roots | ✅ Supported | Code already does `observer.observe(el.shadowRoot, options)` |
| MutationObserver on CLOSED shadow roots | ❌ **IMPOSSIBLE** | DOM Standard: `hostElement.shadowRoot` returns `null` for closed roots. Cannot get reference to observe. |

**The Closed Shadow DOM Gap**

This is a hard browser limitation, not a design flaw. Closed Shadow Roots are designed to be opaque — the browser intentionally prevents access. The current codebase explicitly handles this: `observeWithShadowRoots()` (deterministic-recorder.ts:606) has a comment "Closed shadow roots are skipped."

**Impact on Control Model:**
- Discovery: Cannot enumerate controls inside closed shadow roots via DOM traversal
- Mutation observation: Cannot detect state changes inside closed shadow roots
- Event matching: ✅ composedPath() DOES include closed shadow elements (DOM Standard guarantee) — so events CAN be matched, but the model has no ControlNode to match against

**Mitigation options:**
1. **Treat closed shadow roots as opaque containers** — if an event's composedPath enters a closed shadow root, create a behavioral control from the composedPath elements visible at the boundary. This is partial — we see the host element and can match the click, but can't observe internal state.
2. **Most enterprise frameworks use OPEN shadow roots** — Lit, Stencil, Lightning Web Components default to open. Closed is rare and typically used for security-sensitive widgets.
3. **Accept the limitation** — document it as a known constraint. Partial capture for closed shadow components is better than wrong capture.

**Risk Level**: LOW. Closed shadow DOM is rare in enterprise applications. The 95% case (open shadow, light DOM) is fully feasible.

---

### B. Continuous MutationObserver (Performance)

**Feasible? UNKNOWN — requires prototype validation.**

**Guaranteed by browser:**
- MutationObserver fires in microtask batches (browser coalesces rapid mutations)
- `attributeFilter` limits which attribute changes trigger callbacks
- Observer can be disconnected and reconnected

**Not guaranteed (must be measured):**
- Throughput on large enterprise DOMs (2,000-5,000 elements)
- Sustained performance under rapid mutations (React re-renders, AG Grid scrolling)
- Memory growth over long sessions

**What existing evidence tells us:**
- Current codebase uses **only short-lived observers** (300ms–500ms windows). The longest-running observer in production is the surface detection observer at 500ms.
- A rejected approach ("Periodic Background Snapshots") was explicitly rejected for "continuous performance cost, memory growth, non-deterministic timing."
- DOM Clone benchmarks show 0.05-1.5ms per clone for ≤500 elements, 8ms max — but this measures cloning, not mutation observation.

**Why this is the #1 implementation risk:**

The Control Model requires a continuous, never-disconnected MutationObserver on the entire document. No precedent exists in this codebase. Enterprise applications (Salesforce, SAP, Workday) have highly dynamic DOMs where React/Vue continuously re-render. The observer must handle:
- Batched mutations from React reconciliation (100+ mutations in a single microtask)
- Sustained mutation bursts during animations and transitions
- Large subtree replacements during route changes
- AG Grid scrolling (10+ row additions/removals per frame)

**Risk Level**: HIGH. This is the single biggest unknown. Must be prototyped before committing.

---

### C. Stable Identity / Re-binding

**Feasible? YES, with caveats.**

| Aspect | Verdict | Evidence |
|--------|---------|----------|
| `WeakRef<Element>` in content scripts | ✅ Chrome 84+, MV3 requires 88+ | Full platform support |
| `WeakMap<Element, ControlNode>` for O(1) lookup | ✅ Chrome 36+ | Universally supported |
| Semantic fingerprint (role + name + treePath) | ✅ Computable from existing algorithms | Channel A already computes role + name |
| Re-bind via MutationObserver (detect removed → find replacement) | ✅ Technically feasible | No precedent in codebase |
| Positional ordinal for disambiguation | ✅ Computable | Standard sibling indexing |

**Assumptions that must be validated:**
1. **React reconciliation timing**: Does the old DOM node removal + new node insertion happen within the same mutation batch? If so, re-binding is straightforward. If they're in separate batches separated by a gap, the 200ms grace period handles it.
2. **Fingerprint uniqueness**: Is `role + accessibleName + treePath + ordinal` truly unique within a page? For pages with repeated identical controls in different forms, this should work. For repeated controls within the SAME form (rare but possible), it may not.
3. **Name normalization**: Does stripping dynamic content (counts, timestamps) from accessible names actually improve stability? This is heuristic and needs real-world validation.

**Risk Level**: MEDIUM. The algorithms are feasible. The heuristics (normalization, grace period timing) need empirical tuning.

---

### D. Event Matcher (composedPath → ControlNode)

**Feasible? YES.**

| Aspect | Verdict | Evidence |
|--------|---------|----------|
| `event.composedPath()` in content scripts | ✅ Standard DOM API | Already used in resolveTarget |
| `composedPath()` traverses open shadow boundaries | ✅ DOM Standard guarantee | Explicitly specified |
| `composedPath()` traverses closed shadow boundaries | ✅ DOM Standard guarantee | Explicitly specified |
| `WeakMap<Element, ControlNode>` O(1) lookup per path element | ✅ Standard | O(path length) per event — path ≤30 elements |
| Ancestor walk in composedPath for decorative-child matching | ✅ Feasible | Walk path array, check WeakMap per element |

**Risk Level**: LOW. This is the most straightforward component. Pure data structure lookups.

---

### E. Framework Adapter System

**Feasible? YES.**

| Aspect | Verdict |
|--------|---------|
| Adapter interface (detect, inferRole, inferStateChange) | ✅ Simple pattern matching on CSS classes |
| Lazy adapter loading (only instantiate detected frameworks) | ✅ Check for framework signature classes on first event |
| Multiple adapters coexisting | ✅ First-match priority |

**Risk Level**: LOW. Framework adapters are pure pattern matching. Each adapter is ~50-100 lines of CSS class detection. Low complexity, low risk.

---

### F. Composite Control Management

**Feasible? YES, but popup composites need careful handling.**

| Aspect | Verdict | Notes |
|--------|---------|-------|
| W3C ownership table (static map) | ✅ Trivial | Just a lookup table |
| Parent-child relationship building | ✅ DOM hierarchy walk | Standard |
| Popup composite expansion/contraction | ✅ MutationObserver detects `aria-expanded` change | attributeFilter: ['aria-expanded', 'class'] |
| Portal-rendered overlay association | ⚠️ Needs heuristic | No standard API; must infer from timing/proximity |

**Portal overlay association** is the trickiest part. When a React Portal renders a dropdown popup into `document.body`, there's no DOM hierarchy connecting the combobox trigger to the popup. We must infer the association from:
- `aria-controls` attribute (if present — links trigger to popup by ID)
- Temporal proximity (popup appeared within 100ms of trigger expansion)
- `aria-owns` attribute (less common but explicit)

If neither `aria-controls` nor `aria-owns` is present, temporal association is the fallback. This is heuristic and may produce false associations on pages with rapid concurrent overlays.

**Risk Level**: MEDIUM. Static composites are easy. Popup/portal composites need real-world validation.

---

### G. Scaling (Large Enterprise Applications)

**Feasible? UNKNOWN — requires prototype validation.**

**The core question**: Can we maintain a Control Model for a page with 2,000-5,000 DOM elements without degrading page performance?

**Design mitigations (from critical review):**
- Lazy discovery (only discover visible controls)
- Viewport-gated tracking (full state only for visible controls)
- Batched mutation processing
- Budget limits (max 2000 active controls, max 100ms per mutation batch)

**Unknowns:**
- How many DOM elements does a typical enterprise page have? (Salesforce, SAP, Workday, ServiceNow)
- How many of those are interactive controls vs structural?
- What is the mutation rate during normal use?
- Does `attributeFilter` sufficiently reduce mutation volume?
- Does lazy discovery via IntersectionObserver add meaningful overhead?

**Risk Level**: HIGH. Cannot be assessed theoretically. Must be measured.

---

### H. Message Passing (Content Script → Service Worker)

**Feasible? YES — already in production.**

The existing architecture uses `chrome.runtime.sendMessage()` for content script → service worker communication. The Control Model would use the same pattern, sending `SEMANTIC_INTERACTION` messages instead of `RECORDED_EVENT` messages. The service worker already handles MV3 lifecycle (termination/restart) with `chrome.storage.local` persistence and `chrome.alarms` health checks.

**Risk Level**: LOW. Proven pattern.

---

### I. Surface and Context Layers (from Critical Review)

**Feasible? YES, but adds complexity.**

Surfaces (dialogs, menus) are detected by MutationObserver (appearance of `[role=dialog]`, `[aria-modal=true]` elements). Context layers (forms, sections) are detected by structural hierarchy (`[role=form]`, `<form>` elements).

**Risk Level**: LOW-MEDIUM. Conceptually sound, but adds two more layers to maintain.

---

### J. Multi-Source Evidence Model (from Critical Review)

**Feasible? YES.**

Replacing the three-tier cascade with weighted evidence is a data model change, not a browser API challenge. Structural, adapter, and behavioral signals are all already collectable.

**Risk Level**: LOW. Algorithmic, not API-constrained.

---

## Part 2: Risk Summary

| Component | Feasible? | Risk Level | Prototype Required? |
|-----------|-----------|------------|---------------------|
| Control Discovery (open shadow + light DOM) | ✅ | LOW | No |
| Control Discovery (closed shadow DOM) | ❌ Partial | LOW (rare) | No (accept limitation) |
| Continuous MutationObserver | ⚠️ Unknown | **HIGH** | **YES — Milestone 0** |
| Stable Identity / Re-binding | ✅ | MEDIUM | **YES — Milestone 1** |
| Event Matcher | ✅ | LOW | No |
| Framework Adapters | ✅ | LOW | No |
| Composite Controls (static) | ✅ | LOW | No |
| Composite Controls (popup/portal) | ✅ | MEDIUM | **YES — Milestone 2** |
| Scaling on Enterprise DOMs | ⚠️ Unknown | **HIGH** | **YES — Milestone 3** |
| Message Passing | ✅ | LOW | No |
| Surfaces/Contexts | ✅ | LOW-MEDIUM | No |
| Multi-source evidence | ✅ | LOW | No |

**Two HIGH risks. Both must be de-risked before full implementation.**

---

## Part 3: Risk-Reduction Milestones

Each milestone is the **smallest experiment** that answers a specific 
architectural question. If a milestone fails, we learn before building the 
full system.

### Milestone 0: Continuous Observer Performance

**Architectural question**: Can a continuous MutationObserver on a large 
enterprise DOM maintain acceptable performance?

**What to build**:
- A standalone content script (no Control Model, no patterns, no 
  lifecycle) that:
  1. Attaches a MutationObserver to `document.body` with 
     `{childList: true, subtree: true, attributes: true, attributeFilter: 
     [...relevant...]}`
  2. Also observes all open shadow roots
  3. For each mutation batch, records: batch size, processing time, 
     mutation types
  4. Exposes metrics via `window.__controlModelPerf`

**What to test against**:
- OrangeHRM (small-to-medium DOM, ~500-800 elements)
- Salesforce Lightning (large DOM, 2000+ elements) — if accessible
- A synthetic page with 5,000 elements and simulated React re-renders

**Success criteria**:
- Mutation batch processing < 16ms (one frame) for 95th percentile on 
  OrangeHRM
- Mutation batch processing < 50ms for 95th percentile on synthetic 5,000 
  element page
- No memory growth over 5 minutes of continuous use
- No visible page jank during normal interaction

**Failure path**: If performance is unacceptable, investigate:
- Throttling observer (disconnect during rapid bursts, reconnect after 
  settle)
- Scoped observers (one per detected surface/region, not global)
- Sampling (observe every Nth mutation during bursts)

**Effort**: 1-2 days. Standalone script, no integration.

---

### Milestone 1: Control Discovery + Identity Stability

**Architectural question**: Can we build a Control Model from the DOM and 
maintain stable identities across React re-renders?

**What to build**:
- Control discovery: walk DOM, compute roles + names (reuse Channel A 
  algorithms), create ControlNodes
- WeakMap index: `Element → ControlNode` for O(1) lookup
- MutationObserver integration: on mutations, create/update/destroy 
  ControlNodes
- Re-bind logic: when an element is removed, search for semantic 
  equivalent within 200ms grace period
- Identity fingerprint: `hash(role + normalizedAccessibleName + treePath 
  + siblingOrdinal)`
- Simple test page: React app with a form (text input, dropdown, 
  checkbox, button) that force-re-renders every 2 seconds

**What to test**:
- After React re-render, do controls maintain their controlId?
- After route change (full content replacement), are old controls 
  destroyed and new ones discovered?
- After adding a second "Phone Number" field (duplicate), do both get 
  unique identities?
- After expanding a combobox, are child options discovered?

**Success criteria**:
- Control identity survives React re-render with >95% reliability
- Discovery walk on OrangeHRM "My Info" page finds all expected controls 
  (First Name, Last Name, Nationality, Marital Status, Gender radios, 
  DOB, Save)
- Re-bind completes within the grace period

**Failure path**: If identity is not stable, investigate:
- Using `data-testid` / `name` attributes as primary identity signal
- Increasing grace period
- Using FinalizationRegistry to detect WeakRef cleanup

**Effort**: 3-4 days. Core discovery + identity, no event matching yet.

---

### Milestone 2: Event Matching + Composite Controls

**Architectural query**: Can we match DOM events to ControlNodes and 
correctly handle composite controls (dropdowns, dialogs)?

**What to build**:
- Event matcher: `composedPath()` → `WeakMap` lookup → ControlNode
- Decorative element fallback: walk path ancestors when path[0] is not 
  bound
- Composite expansion tracking: MutationObserver detects 
  `aria-expanded` change → discover child controls
- Portal overlay association: `aria-controls` → popup element lookup, 
  with temporal fallback
- Simple lifecycle: combobox open → option select → combobox commit

**What to test**:
- Click on `<i>` inside a `<button>` → matches the button ControlNode
- Click on OXD dropdown trigger → activates combobox lifecycle
- Click on dropdown option → matches option ControlNode → commits as 
  "Select X from Y"
- Dialog open → all controls inside get surface context
- React Portal dropdown → popup associated with trigger despite being in 
  document.body

**Success criteria**:
- Event matching on OrangeHRM "My Info" page correctly identifies: Save 
  button, Nationality dropdown (not Blood Type), Date of Birth trigger
- Composite dropdown lifecycle produces one SemanticAction: 
  "Select American from Nationality"
- No more "Click 'I'" or wrong dropdown association

**Failure path**: If event matching misses controls, investigate:
- Multi-candidate scoring as fallback for unmapped path elements
- Behavioral control creation for unbound elements

**Effort**: 3-4 days. Builds on Milestone 1.

---

### Milestone  Control Model on Enterprise DOM

**Architectural question**: Does the Control Model scale to large enterprise 
applications with thousands of elements and rapid mutations?

**What to build**:
- The full Milestone 1 + 2 system with:
  - Lazy discovery (only discover visible controls via 
    IntersectionObserver)
  - Viewport-gated state tracking
  - Batched mutation processing with budget limits
  - Control count limits (max 2000 active)

**What to test against**:
- OrangeHRM with all modules (Admin, PIM, Leave, Time, Recruitment)
- Synthetic page with 5,000 elements and automated mutation generator 
  (simulating React re-renders at 60fps)
- AG Grid demo with 10,000 rows and virtualised scrolling

**Success criteria**:
- Discovery of visible controls completes < 500ms on any page
- Mutation batch processing < 16ms (95th percentile) on OrangeHRM
- Mutation batch processing < 50ms (95th percentile) on synthetic 5,000 
  element page
- Virtualised grid scrolling doesn't thrash the model (control 
  creation/destruction < 5ms per batch)
- Memory stays < 5MB for the Control Model data structures

**Failure path**: If scaling fails, investigate:
- Region-based observer partitioning (observe only the active region)
- More aggressive lazy discovery (discover only on event, not on 
  mutation)
- Dropping attribute observation for non-interactive elements

**Effort**: 2-3 days. Builds on Milestones 1+2.

---

### Milestone 4: Acceptance Test Suite Validation

**Architectural question**: Does the Control Model-based recorder produce 
correct semantic interactions for all 12 categories in the acceptance test 
suite?

**What to build**:
- Full pipeline: Control Model → Event Matcher → Lifecycle Engine → 
  SemanticAction output
- Wire to side panel: display SemanticActions (replacing current 
  Observed Workflow display)
- Acceptance test suite execution against OrangeHRM

**What to test**:
- Run all 12 categories of the acceptance test suite
- Specifically: the 14-step "My Info" integration workflow

**Success criteria**:
- All 12 categories produce ✅ PASS results
- The 14-step "My Info" workflow produces exactly 14 steps with correct 
  verbs, targets, and values

**Effort**: 3-4 days. Full integration test.

---

## Part 4: Milestone Dependency Graph

```
Milestone 0: Continuous Observer Performance
    │
    │ (if PASS → proceed)
    │
    ▼
Milestone 1: Control Discovery + Identity Stability
    │
    ├──► (parallel) ──► Milestone 3: Scaling Validation
    │                        │
    │                        │ (if PASS → proceed)
    │                        ▼
    │                   Milestone 4: Acceptance Tests
    │
    ▼
Milestone 2: Event Matching + Composite Controls
    │
    ▼
Milestone 4: Acceptance Tests
```

- Milestone 0 is a **gate** — if continuous observation is too slow, the 
  entire architecture needs a different observation strategy before any 
  other work is meaningful.
- Milestones 1 and 2 can proceed sequentially (1 → 2) since event matching 
  requires a populated model.
- Milestone 3 can start in parallel with Milestone 2 (same model, 
  different test focus).
- Milestone 4 requires all prior milestones to pass.

**Total estimated effort for risk reduction**: ~12-15 days of prototyping 
and validation. This is deliberately front-loaded — if any milestone 
fails, we learn the lesson before building the full system.

---

## Part 5: Browser API Dependency Reference

| Component | Browser APIs Required | Guaranteed? |
|-----------|----------------------|-------------|
| Control Discovery | `querySelectorAll`, `getAttribute`, `getBoundingClientRect` | ✅ |
| Role Computation | `getAttribute('role')`, tag name, `input.type` | ✅ |
| Accessible Name | `aria-label`, `aria-labelledby`, `<label>`, `textContent`, `title` | ✅ |
| Continuous Observation | `MutationObserver`, `observe()`, `disconnect()` | ✅ (perf unknown) |
| Shadow Root Observation | `element.shadowRoot` (open only), `observer.observe(shadowRoot)` | ✅ open, ❌ closed |
| Event Matching | `event.composedPath()` | ✅ |
| Control Lookup | `WeakMap<Element, ControlNode>`, `WeakRef<Element>` | ✅ Chrome 84+ |
| Viewport Tracking | `IntersectionObserver` | ✅ Chrome 51+ |
| Frame Handling | `window.frames`, `frame.contentDocument` (same-origin) | ✅ same-origin |
| Message Passing | `chrome.runtime.sendMessage`, `chrome.runtime.onMessage` | ✅ Production-proven |
| State Persistence | `chrome.storage.local` | ✅ |

**Guaranteed assumptions** (browser standard, will not change):
- composedPath includes shadow DOM elements (open + closed)
- MutationObserver batches mutations in microtasks
- WeakMap/WeakRef provide O(1) lookup without preventing GC
- attributeFilter works with subtree:true

**Inferred assumptions** (likely true, must be validated):
- MutationObserver can sustain continuous observation on large DOMs without performance degradation
- React reconciliation removes old DOM nodes and adds new ones within 1-2 microtask batches
- Semantic fingerprints are unique enough for stable identity in practice
- IntersectionObserver adds negligible overhead for viewport tracking

---

## Conclusion

**The Control Model is feasible within Chrome extension constraints.** The 
core mechanisms — DOM traversal for discovery, MutationObserver for 
maintenance, composedPath for matching, WeakMap for lookup — are all 
standard browser APIs, several already used in this codebase.

Two HIGH risks must be de-risked before full commitment:
1. **Continuous MutationObserver performance** (Milestone 0)
2. **Scaling to enterprise DOMs** (Milestone 3)

Neither can be assessed theoretically. Both require prototype validation. 
But if they pass, the remaining components are LOW-MEDIUM risk and 
straightforward to implement.

The closed Shadow DOM limitation is real but low-impact — enterprise 
frameworks predominantly use open shadow roots. Partial capture for closed 
shadow components is an acceptable trade-off.

The milestones are designed so that **if any milestone fails, the failure 
informs the next architectural decision** rather than wasting work. Each 
milestone produces reusable code (discovery algorithms, event matcher, 
identity system) that feeds into the production system if successful.
