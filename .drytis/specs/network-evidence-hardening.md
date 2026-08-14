# Network/API Evidence Hardening Milestone

## Problem

Three decisive deterministic gaps prevent M9 from understanding application
operations on traditional (form-submit, full-page-reload) apps like Amazon:

1. **SW webRequest data not bridged into synthetic navigation evidence** —
   `service-worker.ts:904` hardcodes `networkActivity: []`. The SW's
   webRequest listeners DID see the POST but never wire it into evidence.

2. **No PerformanceObserver** — fetch/XHR patches in `network-inject.js`
   can't see form-submit navigations. PerformanceObserver with
   `entryType: ['navigation', 'resource']` would capture ALL requests from
   the MAIN world.

3. **No request/response body capture** — only URL + method + status
   recorded. Entity details, product IDs, error messages all live in bodies.

## Implementation Plan

### Cross-page reload correlation strategy

When the user clicks "Add to Cart" (form submit), the sequence is:

```
[Page A: product detail]
  1. User clicks Add to Cart → form POST starts
  2. webRequest.onBeforeRequest fires (POST /cart/add-to-cart, requestId=R1)
  3. forwardToTab(page A) → content script on page A may still be alive briefly
  4. Page A begins unloading → content script destroyed
  5. webRequest.onCompleted fires (POST /cart/add-to-cart, 302→/cart, requestId=R1)
  6. forwardToTab(page A) → content script DEAD, message lost
  7. webNavigation.onCommitted fires for page B (cart page)
  8. SW creates synthetic nav evidence for page B
  9. New content script loads on page B
```

**Solution: SW-side request buffer + synthetic evidence injection.**

The SW already tracks in-flight requests via `inFlightRequests` map. We add:

- A ring buffer of recently COMPLETED requests (URL, method, status, timestamp,
  requestId, wallClock) kept for 10 seconds.
- When `attachSyntheticNavEvidence` fires (step 8), it queries this buffer
  for requests whose URL matches an operation pattern (e.g., `/cart/add`)
  AND whose timestamp is within 5 seconds of the navigation timestamp.
- Matching requests are injected into the synthetic evidence's
  `networkActivity[]` array.

This means: the form POST that Amazon sends is captured by webRequest,
buffered in the SW, and injected into the synthetic nav evidence of the
RESULTING page load. The network evidence travels WITH the navigation.

### Deduplication

The existing `NetworkBridge.deduplicate()` already handles main-world vs
webrequest dedup with a 2000ms window. The synthetic evidence injection
adds `source: 'webrequest'` entries, so if the new page's content script
also captures the same request via PerformanceObserver, the dedup logic
prefers the richer source.

For the synthetic nav evidence case specifically: since the request happened
on page A and the evidence is attached to the page B navigation interaction,
there's no overlap — no content script on page B would have captured it.

### PerformanceObserver in network-inject.js

Add `PerformanceObserver` with entryTypes `['navigation', 'resource']` that
captures requests the fetch/XHR patches miss:
- Form-submit POSTs (seen as `navigation` entries)
- `sendBeacon` calls (seen as `resource` entries)
- Server-sent events, preloads, etc.

Dispatch these via the same `cmdrunner-net` CustomEvent with
`resourceType: 'navigation'` or `resourceType: 'resource'`.

Dedup: PerformanceObserver entries may duplicate fetch/XHR-captured entries.
The NetworkBridge dedup uses URL + method + timestamp within 2000ms —
PerformanceObserver timestamps are `performance.now()` based (same clock),
so dedup works correctly.

### Request body capture (webRequest)

Request `extraInfoSpec: ['requestBody']` for `onBeforeRequest`. This gives
us the POST body for form submits. We parse `formData` into a key-value
map and include the top-level fields (e.g., `ASIN=B08KGRVW2S`,
`quantity=1`) in the NetworkActivity entry.

Response bodies: NOT captured. `chrome.webRequest` doesn't provide response
bodies, and intercepting them via `chrome.debugger` is too invasive for
production recording. This is a known limitation.

### Files to change

1. `src/background/network-observation.ts` — add completed-request ring buffer,
   requestBody in extraInfoSpec, expose `getRecentRequests()` method
2. `src/background/service-worker.ts` — wire `getRecentRequests()` into
   `attachSyntheticNavEvidence`
3. `public/assets/network-inject.js` — add PerformanceObserver
4. `src/shared/behavioral-evidence-types.ts` — extend NetworkActivity with
   optional `requestBody`, `resourceType: 'navigation'`
5. `src/tap/network-bridge.ts` — handle PerformanceObserver entries,
   accept requestBody from webRequest source
6. `src/understanding/signal-extractors/network-signals.ts` — extract
   entity hints from requestBody (e.g., ASIN, quantity)

### Acceptance criteria

- [ ] SW buffers completed webRequest entries for 10s
- [ ] Synthetic nav evidence includes matched network requests
- [ ] PerformanceObserver captures navigation + resource entries in MAIN world
- [ ] Request body (formData) captured for POST requests via webRequest
- [ ] NetworkBridge dedup handles PerformanceObserver entries
- [ ] Network signal extractor extracts entity hints from request bodies
- [ ] Amazon Add-to-Cart scenario: POST /cart/add-to-cart is detected,
      add-to-cart operation classified, cart-item entity created,
      outcome determined as success
- [ ] SPA scenario: existing fetch/XHR capture still works
- [ ] Full regression suite passes
- [ ] TSC 0 errors
- [ ] Clean build

## Application Understanding improvements

After this milestone:
- Form-submit apps (Amazon, OrangeHRM) get API operation detection
- Entity creation from request body (product ASIN, leave type, etc.)
- Outcome determination from actual API status codes
- Cross-page-reload correlation of the triggering action → result
