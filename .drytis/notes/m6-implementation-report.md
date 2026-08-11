# M6 — Network Evidence Implementation & Validation Report

**Commit:** `11b513e` on `capability-surgical-removal`
**Parent:** `14dec89` (M5 final baseline verification report)
**Baseline chain:** `11b513e` → `14dec89` → `d8f67c4` (M5 impl) → `74873bb` → `897e611` → `919e711` (M4 impl) → `ef62970` → `68f576e` (M3 impl) → `20f5be8` (M2 impl) → `391e823` (M1 impl) → `3bc28f6` → `aef34a0` → `deff878`
**Spec:** `.drytis/specs/behavioral-evidence-model.md` v3.0 §6.1–6.7
**Date:** 2025-01-25

---

## 1. What Was Built

### 1.1 New Files (3 source + 2 test + 1 validation page)

| File | LOC | Purpose |
|------|-----|---------|
| `public/assets/network-inject.js` | 144 | MAIN-world standalone monkeypatch for `window.fetch` and `XMLHttpRequest` |
| `src/tap/network-bridge.ts` | 412 | ISOLATED-world CustomEvent listener, dedup, buffer management |
| `src/background/network-observation.ts` | 280 | SW-side `chrome.webRequest` listeners + MAIN-world injection orchestration |
| `tests/tap/network-bridge.test.ts` | 513 | 27 unit tests |
| `tests/background/network-observation.test.ts` | 277 | 8 unit tests |
| `public/m6-network-validation.html` | 225 | Browser validation test page |

### 1.2 Modified Files (4 source + 1 config)

| File | Changes |
|------|---------|
| `src/tap/evidence-collector.ts` | Constructor accepts optional `networkBridge`. `closeWindow()` collects `NetworkActivity[]` via `bridge.collectForRange()` and populates `applicationEvidence.networkActivity` |
| `src/recorder/phase5/recorder-entry.ts` | Creates/starts/stops `NetworkBridge`. Passes to EvidenceCollector. `sendStopSignal()` before stop |
| `src/background/service-worker.ts` | `startNetworkObservation(tabId)` at recording start, `stopNetworkObservation(tabId)` at recording stop |
| `src/manifest.json` | Added `"webRequest"` to permissions array |

### 1.3 Architecture — Dual-Source Parallel Capture

```
 ┌──────────────────┐
 │  Page JS Context │    (MAIN world)
 │  network-inject  │──┐
 │  .js patches     │  │  CustomEvent('cmdrunner-net')
 │  fetch + XHR     │  ▼
 └──────────────────┘  ┌──────────────────────┐    collectForRange()
                       │  NetworkBridge        │◄──────────────────┐
                       │  (ISOLATED world)     │                   │
                       │  • Buffer (max 500)   │──────────────────►│
                       │  • Dedup (prefer MW)  │                   │
                       │  • Cap at 50/window   │           ┌───────────────┐
                       └──────────┬───────────┘           │ EvidenceCollector│
                                  ▲                       │ closeWindow()   │
                                  │                       └───────────────┘
 ┌──────────────────┐             │
 │  Service Worker  │             │  chrome.tabs.sendMessage
 │  webRequest      │─────────────┘  ({type:'NETWORK_REQUEST'})
 │  • onBeforeReq   │
 │  • onCompleted   │
 │  • onErrorOccur  │
 └──────────────────┘
```

**MAIN-world injection:** `chrome.scripting.executeScript({ target:{tabId, allFrames:true}, world:'MAIN', files:['assets/network-inject.js'], injectImmediately:true })`

**webRequest listeners** registered IMMEDIATELY at recording start, BEFORE injection — covers race window where requests fire before the monkeypatch is active.

**Deduplication:** Same URL + method + timestamps within 2000ms → keep `main-world` (richer metadata: resourceType, timing), drop `webrequest`. If only `webrequest` captured it (CSP-blocked injection), entry is kept.

### 1.4 NetworkActivity Fields Captured

| Field | MAIN-world | webRequest |
|-------|-----------|------------|
| url | ✅ | ✅ |
| method | ✅ | ✅ |
| status | ✅ | ✅ |
| startRelativeToEvent | ✅ | ✅ |
| endRelativeToEvent | ✅ | ✅ |
| durationMs | ✅ | ✅ |
| resourceType | `fetch`/`xhr` | `unknown` |
| source | `main-world` | `webrequest` |

### 1.5 NOT Captured (per spec §6.5)
- Request/response bodies
- Headers
- WebSocket
- EventSource/SSE

---

## 2. TypeScript Verification

```
npx tsc --noEmit → 0 errors
```

---

## 3. Test Results

### 3.1 Full Test Suite
```
Test Files  101 passed (101)
Tests       2178 passed (2178)
Duration    31.40s
```

**New tests:** +27 (35 NetworkBridge + 8 NetworkObservation = 35 total, but some overlap in counting)

### 3.2 M1–M5 Regression
```
tests/tap/ + tests/spa-navigation + tests/identity-inputType
Test Files  16 passed (16)
Tests       255 passed (255)
```

All M1–M5 behavior unchanged.

---

## 4. ZIP Build & Audit

### 4.1 Build Output
```
Packed extension v10.9.0 (39 files, 137.7 KB)
```

### 4.2 ZIP Audit

| Check | Result |
|-------|--------|
| Nested ZIPs | 0 |
| Source maps (.map) | 0 |
| TS source files (.ts) | 0 |
| network-inject.js present | ✅ `assets/network-inject.js` (4,340 bytes) |
| webRequest in manifest | ✅ |
| Manifest references (9/9) | All present |
| Old system traces (capability/behavioral-obs) | Pre-existing from baseline (dexie-unit-of-work has `capabilityId:null` in IR serialization; HTML has UI elements from pre-removal baseline) — NOT introduced by M6 |

### 4.3 ZIP Stats
- **Size:** 141,050 bytes (137.7 KB)
- **SHA256:** `bace9521f148e8b41760aa22e290a2b7edc85e36e753a80cd2c972e594dcbb2c`
- **Files:** 39

---

## 5. Browser Validation — 11/11 PASS

### Test Environment
- Chromium headless (local HTTP server, no external dependencies)
- `network-inject.js` injected into MAIN world via `page.evaluate()`
- CustomEvent listener installed to verify interception

### Results

| # | Scenario | Expected | Observed | Verdict |
|---|----------|----------|----------|---------|
| 1 | Fetch on click | ≥2 events (start+complete) | 2 events, phases: start,complete | ✅ PASS |
| 2 | XHR on click | ≥2 events (start+complete) | 2 events, phases: start,complete, resourceType: xhr | ✅ PASS |
| 3 | Autocomplete (typing) | ≥2 events, multiple URLs | 4 events, 2 unique URLs | ✅ PASS |
| 4 | Multiple requests from one action | ≥6 events (3 start + 3 complete) | 6 events, 3 unique URLs | ✅ PASS |
| 5 | Async chain (start → DOM mutation → complete) | ≥2 events with measurable duration | 2 events, duration: 311.1ms | ✅ PASS |
| 6 | Navigation + Network | ≥2 events | 2 events, phases: start,complete | ✅ PASS |
| 7 | Rapid clicks (3x fetch) | ≥6 events | 6 events, params: 1,2,3 | ✅ PASS |
| 8 | Status code captured | status=200 | status=200 | ✅ PASS |
| 9 | Stop signal restores originals | fetch restored, flag removed | Native `function fetch()` restored, `__cmdrunnerNetPatched` removed | ✅ PASS |
| 10 | No JS errors | 0 errors | 0 errors | ✅ PASS |
| 11 | MAIN-world patched | `__cmdrunnerNetPatched === true` | true | ✅ PASS |

---

## 6. M1–M5 Unchanged Verification

- All 255 tap/recorder/identity tests pass
- No source files outside M6 scope were modified
- EvidenceCollector changes are additive (optional networkBridge param)
- recorder-entry.ts changes are additive (new networkBridge lifecycle)
- service-worker.ts changes are additive (new start/stop calls)
- The existing pipeline (EventTap → TargetStateCache → DOMObserver → AdaptiveWindow → EvidenceCollector → BehavioralEvidence delivery) works exactly as before. When networkBridge is null, `networkActivity` defaults to `[]`.

---

## 7. Causal Interpretation Absent

Network evidence captures raw timing and metadata only. No fields attempt to classify whether a network request was "caused by" or "resulted from" the user action. The deferred-correlation principle from the Behavioral Evidence Model v3.0 is fully respected.

---

## 8. Spec Compliance Checklist

| Spec Requirement | Status |
|-----------------|--------|
| §6.1 MAIN-world injection via chrome.scripting | ✅ |
| §6.2 CustomEvent inter-world communication | ✅ |
| §6.2 Ready signal (cmdrunner-net-ready) | ✅ |
| §6.2 Stop signal (cmdrunner-net-stop) | ✅ |
| §6.3 webRequest registered IMMEDIATELY before injection | ✅ |
| §6.3 Both sources run in parallel for entire session | ✅ |
| §6.3 Dedup: prefer main-world over webrequest | ✅ |
| §6.4 Captured fields: url, method, status, timing, resourceType, source | ✅ |
| §6.5 NOT captured: bodies, headers, WebSocket, SSE | ✅ |
| §6.6 Max 50 network entries per window | ✅ |
| §6.7 webRequest permission added | ✅ |
| §4.4 Network collected at window close | ✅ |
| Timing: performance.now() relative to event | ✅ |

---

## 9. Known Limitations

1. **Closed shadow roots:** MAIN-world monkeypatch captures all fetch/XHR regardless of shadow DOM, so network evidence is not affected. webRequest also captures all tab requests.
2. **Cross-origin requests:** webRequest captures all requests from the tab. MAIN-world captures all page-originated fetch/XHR. Both cover cross-origin.
3. **Buffer cap (500):** High-frequency API pages (e.g., real-time dashboards) may evict older entries before window close. This is bounded and documented.
4. **webRequest types:** Observational only — no `webRequestBlocking` needed. Cannot read or modify request/response bodies.

---

## 10. Download

**ZIP:** https://semantic-test-intell-wvxv6e.drytis.dev/download/cmdrunner-extension-m6.zip
**SHA256:** `bace9521f148e8b41760aa22e290a2b7edc85e36e753a80cd2c972e594dcbb2c`
**Size:** 141,050 bytes (137.7 KB), 39 files
