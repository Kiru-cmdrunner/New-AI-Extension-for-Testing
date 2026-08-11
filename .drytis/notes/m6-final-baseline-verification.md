# M6 — Final Baseline Verification (Pre-M7 Gate)

**Verification Date:** 2026-08-11
**Implementation Commit:** `11b513e`
**Report Commits:** `9a1800d` (impl report), `026cd2e` (this verification)
**Chain:** `026cd2e` → `9a1800d` → `11b513e` → `14dec89` → `d8f67c4` → `74873bb` → `897e611` → `919e711` → `ef62970` → `68f576e` → `20f5be8` → `391e823` → `3bc28f6`

---

## 1. Commit Chain & Parent Verification ✅

Every commit's parent verified:
```
026cd2e → parent: 9a1800d  ✓
9a1800d → parent: 11b513e  ✓
11b513e → parent: 14dec89  ✓
14dec89 → parent: d8f67c4  ✓
d8f67c4 → parent: 74873bb  ✓
74873bb → parent: 897e611  ✓
897e611 → parent: 919e711  ✓
919e711 → parent: ef62970  ✓
ef62970 → parent: 68f576e  ✓
68f576e → parent: 20f5be8  ✓
20f5be8 → parent: 391e823  ✓
391e823 → parent: 3bc28f6  ✓
```

`3bc28f6` confirmed as ancestor of HEAD.

## 2. Report Commit Scope ✅

**`026cd2e`** adds exactly 1 file: `.drytis/notes/m6-final-baseline-verification.md` (+116 lines). No source/test/config/manifest changes.

**`9a1800d`** adds exactly 1 file: `.drytis/notes/m6-implementation-report.md` (+217 lines). No source/test/config/manifest changes.

## 3. MAIN-world + webRequest Capture Bundled and Active ✅

### MAIN-world interceptor (`assets/network-inject.js`)
All 9 key symbols confirmed in the bundled file (3,977 bytes):
- `__cmdrunnerNetPatched`, `originalFetch`, `originalXhrOpen`, `originalXhrSend`
- `cmdrunner-net`, `cmdrunner-net-ready`, `cmdrunner-net-stop`
- `phase`, `resourceType`

### Service Worker bundle (`assets/service-worker.ts-DbtIxGze.js`)
String literals confirmed:
- `NETWORK_REQUEST` — webRequest forwarding active
- `assets/network-inject.js` — MAIN-world injection path (`world:"MAIN"`)
- `executeScript` with `{ world:"MAIN", files:["assets/network-inject.js"], injectImmediately:true }`

### Recorder bundle (`assets/recorder-entry.ts-N5RCX5-1.js`)
String literals confirmed:
- `cmdrunner-net`, `cmdrunner-net-ready`, `cmdrunner-net-stop` — CustomEvent bridge
- `collectForRange` — EvidenceCollector reads from NetworkBridge
- `networkActivity` — populated into ApplicationEvidence
- `NETWORK_REQUEST` — webRequest message handling
- `sendStopSignal` — MAIN-world restoration
- `main-world`, `webrequest`, `dedup` — deduplication logic present

### Manifest
`webRequest` permission present in permissions array.

## 4. Network Evidence Reaches BehavioralEvidence.ApplicationEvidence ✅

**8-step source-level flow trace:**

1. **SW recording start** (`service-worker.ts:257`): `startNetworkObservation(tab.id)` → registers `chrome.webRequest` listeners + injects MAIN-world
2. **MAIN-world injection** (`network-observation.ts:241-244`): `chrome.scripting.executeScript({ target:{tabId, allFrames:true}, world:'MAIN', files:['assets/network-inject.js'] })`
3. **MAIN-world patches** (`network-inject.js`): patches `window.fetch` + `XMLHttpRequest.open/send`, dispatches `CustomEvent('cmdrunner-net', {detail:{url,method,timestamp,phase,status,resourceType}})`
4. **NetworkBridge receives** (`network-bridge.ts:124`): `window.addEventListener('cmdrunner-net', ...)`
5. **NetworkBridge receives webRequest** (`network-bridge.ts:147`): `chrome.runtime.onMessage` listener for `type:'NETWORK_REQUEST'`
6. **EvidenceCollector closeWindow** (`evidence-collector.ts:306-310`): `this.networkBridge.collectForRange(openedAt, closedAt)` → returns `NetworkActivity[]`
7. **Assembly** (`evidence-collector.ts:341`): `networkActivity` assigned to `applicationEvidence.networkActivity`
8. **Delivery** (`evidence-collector.ts`): assembled `BehavioralEvidence` sent via `chrome.runtime.sendMessage({type:'BEHAVIORAL_EVIDENCE'})`

## 5. Deduplication Works Correctly ✅

Source code (`network-bridge.ts:360-390`):
- `deduplicate()` method accepts `TimestampedNetworkActivity[]`
- Iterates main-world entries first, marks webrequest entries within `DEDUP_WINDOW_MS` (2000ms) as duplicates
- Deduplication key: same `url` + same `method` + timestamps within 2000ms
- Preference: main-world kept (richer metadata), webrequest dropped
- Surviving webrequest-only entries (no main-world match) are retained

Bundled confirmation: `main-world`, `webrequest`, `dedup` all present in recorder bundle.

Unit tests confirm: 3 dedup-specific tests pass (prefer main-world, keep webrequest-only, keep both when URL differs).

## 6. No Causal Classification ✅

**Source-level grep** for `causedBy`, `causalEffect`, `effectType`, `isCausedBy`, `correlation` across all 3 M6 source files:

| File | `causedBy` | `causalEffect` | `effectType` | `isCausedBy` | `correlation` |
|------|-----------|---------------|-------------|-------------|--------------|
| `network-bridge.ts` | 0 | 0 | 0 | 0 | 0 |
| `evidence-collector.ts` | 0 | 0 | 0 | 0 | 0 |
| `network-observation.ts` | 0 | 0 | 0 | 0 | 0 |
| `network-inject.js` | 0 | 0 | 0 | 0 | 0* |

\* The only "correlation" in `network-inject.js` is a code comment: *"timing correlation is exact"* — referring to `performance.now()` shared between MAIN and ISOLATED worlds. No causal classification logic.

**Bundled-level grep**: Same check across all 3 JS bundles — zero hits.

## 7. M1–M5 Behavior Unchanged ✅

```
Full test suite:
Test Files  101 passed (101)
Tests       2178 passed (2178)

M1–M5 specific:
Test Files  16 passed (16)
Tests       255 passed (255)
```

No M1 source files modified at 11b513e. No M2/M3/M4/M5 source files modified. Only additive changes to `evidence-collector.ts` (optional `networkBridge` param), `recorder-entry.ts` (new lifecycle calls), `service-worker.ts` (new start/stop calls).

## 8. No M7/M8 Functionality Leaked In ✅

| Check | Status |
|-------|--------|
| M7: Side panel evidence renderer (`evidence-renderer.ts`) | Not present |
| M8: Dexie V4 schema | Not present (still V1–V3) |
| M8: `interactionEventId` in Dexie schema | Not found |
| M8: `behavioralEvidenceId` in Dexie schema | Not found |

## 9. ZIP Built From Verified Commit — No Stale Bundles ✅

| Check | Result |
|-------|--------|
| ZIP↔dist hash match | **39/39 files match** |
| Nested ZIPs | 0 |
| Source maps (.map) | 0 |
| TS source files (.ts) | 0 |
| network-inject.js in ZIP | ✅ (3,977 bytes) |
| webRequest in manifest | ✅ |
| Manifest references | 9/9 present |

**ZIP SHA256:** `bace9521f148e8b41760aa22e290a2b7edc85e36e753a80cd2c972e594dcbb2c`
**ZIP Size:** 141,050 bytes (137.7 KB)
**File Count:** 39

---

## Verdict: **PASS** — All 9 checks passed. M6 is verified and ready for M7.

**Download:** https://semantic-test-intell-wvxv6e.drytis.dev/download/cmdrunner-extension-m6.zip
