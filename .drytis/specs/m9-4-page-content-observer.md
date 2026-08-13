# M9.4 — Page Content Observer

## Objective
Observe meaningful application-level content that cannot be reliably derived
from existing evidence streams (Target Evidence, navigation, network,
DOM mutation summaries, surface changes).

## Core Principle (anti-duplication)
PageContentObserver is a **semantic snapshot scanner**, NOT a generic DOM
recorder and NOT another copy of Target Evidence.

What M1–M8 already captures — PageContentObserver MUST NOT re-capture:
- Element property state (TargetEvidence before/after 9 properties)
- DOM mutations (DomChangeSummary, capped 200)
- Surfaces/dialogs (SurfaceChange)
- Visibility changes
- Network metadata
- Navigation URLs

What only rendered content reveals — PageContentObserver's domain:
- Semantic state of the **destination page after full-page reload**
  (the int-19 gap: 0ms evidence window on Amazon add-to-cart reload)
- **Counters rendered in content** (cart count badge, notification badge)
  when their mutation fell outside any evidence window
- **Collections with item counts** rendered in content
  (cart table rows, search result counts, order line items)
- **Entity attributes in content** (product title/price on PDP, order
  number on confirmation page)
- **Status badges/labels** (order status, payment status, availability)

## Architecture
New module `src/understanding/page-content/`:
- `page-content-types.ts` — PageContentSnapshot + semantic observation types
- `page-content-config.ts` — configurable selectors registry (per-domain or
  generic; no hardcoded Amazon-specific logic in the observer itself)
- `page-content-observer.ts` — scans the live DOM (content-script side),
  produces PageContentSnapshot; bounded: max N semantic elements per scan,
  single scan per pageshow/view-change, no MutationObserver, no polling loop
- `page-content-signals.ts` — signal extractor: converts snapshot into
  PageContentSignal entries feeding M9.2 StateBuilder and M9.3 OutcomeDeterminer

## Bounded observation
- Max 50 semantic elements per snapshot
- Max 200 chars per text value
- Max 30 attributes per entity
- No recursive scanning below configured semantic selectors
- No hidden elements (offsetParent null / aria-hidden / display:none)

## Feeding M9.2/M9.3
- `PageContentSignal` extends Signal with source 'page-content'
- StateBuilder: creates/updates entities (id from selector's entityType +
  extracted id), setCount() on collections, record() on counters,
  recordAppearance() on notifications found in content
- OutcomeDeterminer: new evidence kind 'page-content' with low weight (0.2)
  — corroborates but never alone confirms

## Acceptance Criteria
- [ ] Snapshot scan is bounded (50 elements, 200 chars, 30 attrs)
- [ ] Noise filtering: script/style/template/link/meta tags skipped; hidden
      elements skipped; text under 2 chars skipped; non-semantic containers
      (body/html/div without configured selector) skipped
- [ ] No duplication of M1–M8 evidence (no element state props, no mutation
      records, no network, no navigation)
- [ ] Produces PageContentSignal with provenance (interactionId, confidence)
- [ ] StateBuilder processes page-content signals: entities, collections,
      counters, notifications
- [ ] OutcomeDeterminer counts page-content evidence at low weight
- [ ] Amazon cart-confirmation example: snapshot after reload yields
      cart-item entity + cart counter + notification → outcome flips from
      'incomplete' to 'success' with corroborating evidence
- [ ] No M1–M8 files modified
