# Native Form-Submit Attribution — Deterministic Recovery of Document Requests

Status: IMPLEMENTED at the working tree (all gates G1–G3, R1–R11 green;
3098-test suite green; build v10.9.0 39 files). Extends
`form-submit-evidence-recovery.md`.
Audit basis: production trace of int-26/int-27 (Amazon Add-to-cart) at `aac4f42`.

## Problem

The Amazon `/cart/add-to-cart` request is absent from the click interaction
(int-26) while only telemetry (unagi `csm.csa.prod`) shows. Three independent
gates each have a **zero-path** condition for native form submits:

- **G1 — async stamping.** `handleObservedEvent` sets `lastTrustedAction` only
  after `await ensureSessionRestored()` + `await getActiveTab()` (a full
  `chrome.tabs.query` IPC; it also ignores `sender.tab.id`, which is already
  on the message). A native form submit's `main_frame` request is the click's
  *default action*: it can start before the stamp lands → `sourceEventId`
  undefined → the request has no identity → no recovery path applies (ledger
  rejects unstamped; commit routing only routes stamped; identity join empty).
- **G2 — document-request exclusion.** Three sites gate on request *shape*:
  `recoverNetworkForNavigationById` part 1 (`method !== 'GET' && requestBody`),
  part 2 (`documentRequest && !requestBody → continue`), ledger
  `shouldAttach` (`mainFrame && method !== 'GET'`). A GET form submit, or a
  POST whose body Chrome did not parse (non-urlencoded/multipart encodings
  yield no `formData`), satisfies none.
- **G3 — early CS window closure.** The click interaction is emitted ~160 ms
  in → `FINALIZE_EVIDENCE` → `executeFinalization` marks the window closed
  before closing it, so `closeWindow`'s +1000 ms late re-collect is
  unreachable. Defered submits join nothing. Deeper: a content script
  *fundamentally cannot* observe the request that replaces its own document —
  any CS-side fix for the Amazon case is doomed.

## Design principles

1. **Identity, not timing.** Every join is exact-ID or browser-declared
   causality. No TTL, no lookback, no window arithmetic anywhere new.
2. **Capture before classify.** A request is durably recorded at capture with
   whatever identity it has; classification (which trusted action owns it)
   can complete later from deterministic state.
3. **The SW owns document-request network attribution.** The CS window is
   demoted to a DOM/focus/same-page-XHR display collector; it is never a
   correctness path for the navigation request itself.

## Architecture changes

### G1-A — Synchronous stamp at message dispatch (service-worker.ts)

In the `chrome.runtime.onMessage` dispatcher, for `OBSERVED_EVENT` with
`isTrusted && eventType !== 'navigation'`: call
`setLastTrustedAction(sender.tab.id, { eventId, interactionId: '' })`
**synchronously, before any `await`**. `sender.tab.id` replaces
`getActiveTab()` (also fixes the wrong-tab hazard when focus moved). The
existing async handler keeps everything else (session restore, component
runtime processing, panel broadcast) — only the stamp moves up. Ordering
argument: the tap sends the message during the click's dispatch (capture
phase, `event-tap.ts:195`), while the default action (the form submit
request) starts only **after** dispatch completes — so the message is queued
to the SW strictly before the request can be issued. The sync map write in
`setLastTrustedAction` (`:404`) makes the stamp visible to any
`onBeforeRequest` that fires after message receipt, in the same tick.

### G1-B — Durable pending-document ledger (network-observation.ts)

`pendingMainFrameByTab` (already captured at `onBeforeRequest`, pre-redirect,
`:626-640`) becomes **durable for every `main_frame` request, stamped or
not**: new `StorageKeys.PENDING_NAV_DOCS = 'cmdrunner_pending_nav_docs'`,
per-tab map `{ requestId, originalUrl, method, requestBody?, sourceEventId? }`,
awaited in-dispatch (same durability gate as stamped entries; unstamped
entries key by tabId+requestId, not sourceEventId). Enriched at completion;
consumed (deleted) only by the `onCommitted` owner as today. Session-scoped
cleanup on STOP/new session. Stamped main_frame requests continue into
`UNATTACHED_REQUESTS` unchanged.

### G1-C — `form_submit` type join at onCommitted (service-worker.ts)

`webNavigation.onCommitted` reports `transitionType: 'form_submit'` for
form-induced navigations — GET and POST alike (note: it is a **transition
TYPE**, not a qualifier; the commit handler already lists it in
`fullReloadTypes` at `service-worker.ts:967`). This is the browser's own
causal classification: deterministic, identity-based, zero timing. At
commit, when `details.transitionType === 'form_submit'` and the tab's
`pendingDoc` lacks `sourceEventId` (G1-A race lost, or programmatic
`form.submit()` where no submit event fires): back-fill
`sourceEventId = lastTrustedAction(tabId).eventId`, then push the entry into
the durable attribution ledger as a stamped entry — the existing machinery
(identity join → interaction → LIVE_INTERACTIONS → ack → panel) takes over
unchanged. G1-A and G1-C are belt-and-braces: either suffices; both never
conflict (idempotent stamp write, same eventId).

### G2 — Identity-not-shape recovery rules

Participation in recovery is gated by **identity only**; method and body
presence demote to display metadata:

- `recoverNetworkForNavigationById` part 1: include `pendingDoc` iff
  `pendingDoc.sourceEventId` OR the nav is `form_submit`-typed. Render
  `requestBody: pendingDoc.requestBody ?? null` honestly when Chrome did not
  parse a body.
- Part 2 loop: replace `if (req.documentRequest && !req.requestBody) continue;`
  with `if (req.documentRequest && !req.sourceEventId && !navIsFormSubmit)
  continue;` — unstamped, non-form-submit document requests (address bar,
  reload) stay excluded; the navigation evidence already records them.
- Ledger `shouldAttach`: any **stamped** `mainFrame` entry is user-caused by
  definition (the stamp is causal proof) → `if (entry.mainFrame) return true;`
  (drop the `method !== 'GET'` clause). Telemetry/noise regexes still apply to
  non-document stamped entries.

### G3 — CS window demotion + finalize-path re-collect (display-only)

- **Correctness** for document requests moves entirely SW-side (G1-B/G1-C +
  ledger). The CS window never gates it; its 160 ms closure becomes
  irrelevant to network correctness.
- **Display enrichment** (SPA case, no navigation): when
  `executeFinalization` runs with `getInFlightCount() > 0`, schedule the same
  single +1000 ms re-collect the adaptive path uses (currently unreachable:
  `isClosed` early-return at `evidence-collector.ts:457`) — before marking
  the window closed, for same-page deferred XHRs. Correctness never depends
  on it: a deferred XHR started by page JS after the click is stamped by the
  still-active per-tab stamp (stamps persist until replaced — no TTL) and is
  attached by the STOP drain / boot reconcile even if the re-collect never
  runs.

## End-to-end flow (Amazon GET case, deterministic)

```
click INPUT#add-to-cart-button (type=submit)
 ├─ CS: capture-phase tap → OBSERVED_EVENT evt-click-26 sent DURING dispatch
 ├─ SW: onMessage → SYNC setLastTrustedAction(tab, evt-click-26)   [G1-A]
 ├─ browser default action → main_frame GET /cart/add-to-cart?… starts
 ├─ SW onBeforeRequest: stamp present → pendingDoc durable (awaited)  [G1-B]
 │        + ledger recordStamped (awaited) → UNATTACHED_REQUESTS
 ├─ CS window (160 ms): DOM/focus evidence + unagi beacon (MAIN-world)
 │        → delivered; window closes — network correctness unaffected
 ├─ onCommitted (transitionType form_submit): pendingDoc unstamped?       [G1-C]
 │        back-fill sourceEventId ← tab stamp → push into ledger
 ├─ ledger.attachStampedActivity → identity join → int-26.networkActivity
 │        += GET /cart/add-to-cart → persist → acknowledgeAfterPersist
 ├─ synthetic nav int-27: causedByInteractionId = int-26, no network
 └─ STOP / boot reconcile: nothing left (or attaches leftovers)
Panel: int-26 Network = unagi POST + GET /cart/add-to-cart; int-27 none ✓
```

POST / body-less case: identical flow; body renders `null` when Chrome
parsed none. SPA case: deferred XHR at +500 ms stamped by the persisting
per-tab stamp → ledger → STOP drain attaches.

## Invariants

- **INV-N1 Sync stamp** — a trusted action's stamp is written to the per-tab
  map synchronously at message dispatch (sender.tab.id), before any await.
- **INV-N2 Durable pendingDoc** — every `main_frame` request is durably
  recorded at capture (awaited in-dispatch) with original URL/method/body,
  stamped or not; deleted only by the commit consumer; session-scoped.
- **INV-N3 Type causality** — a `form_submit`-typed navigation's document
  request is attributed to the tab's current trusted action at commit;
  browser-declared, no time math.
- **INV-N4 Identity-not-shape** — method and requestBody presence never gate
  recovery; participation = stamp or qualifier. They are display metadata.
- **INV-N5 Unattributed documents** — document requests with no identity and
  no form_submit qualifier remain excluded from network evidence (address
  bar, reload); navigation evidence alone records them.
- **INV-N6 CS demotion** — the content-script window is never a correctness
  path for document-request network; all correctness paths are SW-side,
  event-driven (commit, evidence, stop, boot).
- **INV-N7 Re-collect display-only** — the +1000 ms re-collect (now also on
  the finalize path) enriches display only; stamped data attaches via ledger
  triggers regardless.
- Existing invariants unchanged and still binding: exactly-once ownership,
  delete-after-persist, no-TTL for stamped entries, session scoping, replay
  confluence, richness monotonicity.

## Ambiguity handling

- **Programmatic `form.submit()`** — no submit event, no click on a submit
  control; G1-C joins to the most recent trusted action (the JS that called
  submit was itself caused by one). No fabrication: absent qualifier, absent
  join.
- **Enter-key submit** — keydown (Enter) + submit + click-equivalent events
  all tapped and trusted; whichever lands last sets the stamp; tier-2
  memberEvents join resolves all of them to the same interaction.
- **Multiple rapid actions** — the per-tab stamp holds exactly the latest
  trusted action (deterministic state, arrival-ordered). The qualifier join
  uses that map at commit; requestId dedup (ownership ledger) prevents
  double-attach.
- **Same-page submit (target=iframe)** — sub_frame document request, not
  covered by G1-B (main_frame only); stamped via the normal path when the
  stamp is active (G1-A makes it sync). Known boundary, rendered as a regular
  stamped request.
- **Qualifier unavailable** — if a Chromium build omits `form_submit`, G1-A
  alone still stamps (sync); the back-fill no-ops. No degradation beyond
  today's behavior.
- **Hybrid (stamped XHR + form submit)** — both carry the click's eventId;
  both attach to int-26 (requestId dedup, cap 20). Panel shows both rows.

## Cross-domain behavior

All state is per-tab: the stamp (`lastTrustedActionByTab`), pendingDoc
(`pendingMainFrameByTab` → `PENDING_NAV_DOCS` keyed by tabId), and the
qualifier join. A form on origin A submitting to origin B attributes to the
click on A. Known, unchanged limitation: buffered *behavioral* evidence
replay is per-origin (sessionStorage), so DOM evidence for the destroyed page
on A cannot replay on B — network attribution does not depend on it.

## Regression tests (extend the existing suites)

- **R1 sync stamp ordering** — dispatch OBSERVED_EVENT, then fire
  onBeforeRequest in the same turn before microtasks run; assert the request
  is stamped (map write observable synchronously).
- **R2 race-lost back-fill** — onBeforeRequest with empty stamp map →
  pendingDoc durable unstamped; then OBSERVED_EVENT; then onCommitted with
  `transitionType: 'form_submit'` → ledger entry carries the eventId;
  attaches to the click.
- **R3 GET form submit** — pendingDoc GET with stamp → part-1 recovery
  includes it; ledger `shouldAttach` exempts stamped mainFrame GET; panel row
  renders (🟣 webrequest, no body chip).
- **R4 body-less POST** — POST with `requestBody: undefined` → included via
  identity; renders `status` and URL, body null.
- **R5 unattributed documents** — reload / address-bar main_frame (no stamp,
  no qualifier) → not attached to any interaction; synthetic nav unchanged.
- **R6 exactly-once across back-fill + drain + boot** — requestId dedup
  through G1-C, STOP drain, and boot reconcile orderings (extends T9).
- **R7 SPA deferred XHR** — click stamp persists; XHR at +500 ms stamped;
  window already closed; STOP drain attaches (correctness path), re-collect
  optional (INV-N7).
- **R8 finalize-path re-collect** — `executeFinalization` with in-flight > 0
  schedules exactly one +1000 ms re-collect; re-delivered evidence dedupes
  against earlier rows; no double rows.
- **R9 cross-domain form action** — click on A, main_frame POST to B,
  qualifier join → attaches to A's click (per-tab state).
- **R10 qualifier absent (link nav)** — `transitionType: 'link'` with no
  stamp → no back-fill; G1-A-stamped requests attach via the normal stamp
  path.
- **R11 panel regression** — int-26 shows unagi + cart rows; int-27 shows
  `causedByInteractionId`, no Network section.

## Implementation prerequisite

`src/background/evidence-attribution.ts` is currently unreadable on disk
(`Structure needs cleaning`, recurring FS corruption). Git HEAD holds the
committed copy — restore it (`git checkout -- src/background/evidence-attribution.ts`
or re-clone the blob) **before** any build; `tsc` fails until then.
