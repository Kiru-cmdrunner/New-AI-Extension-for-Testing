# G5 — Native Form-Submit Ownership (click → submit → main-frame POST → synthetic nav)

Status: DESIGN + REGRESSION TESTS (implementation follows only after tests
fail-then-pass). Supersedes G4-C's blanket `submit` stamp-eligibility.
Builds on `multi-tab-capture-attribution.md` (G4-A–E, INV-G1..G10 — all
still binding except as amended below) and `native-form-submit-attribution.md`
(INV-N1..N7) and `form-submit-evidence-recovery.md` (INV-1..12).

Trigger: real amazon.in run — the single `/cart/add-to-cart` POST rendered
on BOTH int-18 (click, correct) and int-19 (synthetic nav, duplicate).
Audit: `.drytis/notes/add-to-cart-duplicate-display-audit.md`.

## 0. The problem, precisely

For the flow **trusted click → native form.submit() → main-frame POST →
onCommitted** there are two capture paths and they hold different
identities for the same HTTP request:

- **Bridge path (content script)**: the click opens an ACTION_WINDOW; the
  SW `forwardToTab` NETWORK_REQUEST events (carrying the real Chrome
  `requestId`) are buffered by the bridge; at window close, CER-3
  `collectForRange` includes the POST → BEHAVIORAL_EVIDENCE → attaches to
  the click with the real `requestId`. CORRECT owner, CORRECT id.
- **SW path (pendingDoc + ledger)**: the POST is also captured at
  onBeforeRequest → pendingMainFrame + DurableAttributionLedger (stamped).
  At onCommitted, `recoverNetworkForNavigationById` builds rows and
  `attachSyntheticNavEvidence` routes them.

The duplicate arises because:
1. (D1) The trusted `submit` DOM event overwrote the click's frame-0
   stamp (G4-C listed `submit` as stamp-eligible), so the SW path carried
   `<submitEventId>` — an id NO interaction owns (click.ts completes
   immediately; no form-submit definition exists) → ownerExists=false →
   INV-G10 fallback put the row on the synthetic nav.
2. (D2) Recovered rows are built without a `requestId`, so the nav-side
   copy is invisible to every downstream dedup (ownership ledger,
   `mergeNetworkEvidence`'s method:url filter).
3. (D3) The ledger attach path (`attachStampedActivity`) may re-attach a
   copy of an already-attached request under a synthetic fallback id
   (`${method}:${url}:${stamped}`), because `pushStamped` dedups by
   requestId and the synthetic id differs from the real one.

## 1. Ownership model (the contract)

**INV-F1 (causal owner).** For a native form submission, the trusted
user action that initiated it — the click on the submit button (or an
Enter keydown in the form) — is THE causal owner of the submission's
main-frame document request and of the synthetic navigation it produces.
The native `submit` DOM event is a *consequence* of the initiating action,
never a new trusted action: it must not create, steal, or overwrite a
stamp. The nav's own `networkActivity` MUST be empty for stamped doc
requests; the nav records the causal link via `causedByInteractionId`.

**INV-F2 (submit is derived).** A `submit` event is STAMP-SECONDARY: it
may create a stamp ONLY when no stamp exists for that exact
`(tabId, frameId)`; it may NEVER overwrite an existing stamp. (Rationale:
the only scenario where a `submit` is the sole trusted cause is a
programmatic `form.submit()` — there the click already stamped the frame
in nearly all cases; when it truly is the first stamp, it IS the trusted
cause and stamping is correct. Non-overwrite preserves R14's guarantee
for every other case.)

**INV-F3 (single representation).** A `requestId` has exactly one owning
interaction across ALL capture paths. Consequences:
  - Recovered rows MUST carry the real `requestId` (from pendingDoc or
    ring entry) so every consumer can dedup.
  - Ownership is decided ONCE per requestId — at the first durable,
    identity-verified attach — and is immutable afterwards.
  - Any later duplicate capture (bridge row, ring row, recovered row)
    must be dropped, not merged. `mergeNetworkEvidence` (sw-integration)
    dedups requestId-first, falling back to method:url only when neither
    side carries an id.

**INV-F4 (deterministic join).** A recovered doc request is attributed
iff `stamp.sourceEventId` resolves to a live non-synthetic interaction
(two-tier: triggerEvent.eventId, then memberEvents[].eventId) with
triple-key origin compatibility (INV-G2). Unattributable → held in the
durable ledger for the STOP drain (the designed retry path), NEVER placed
on the synthetic nav when it is stamped. Unstamped doc requests follow
existing G1-C back-fill; on failure they remain on the nav (unchanged,
INV-G10).

**INV-F5 (no nav display of stamped docs).** A stamped doc request row
must never be admitted into the synthetic nav's `networkActivity`. If the
owner interaction does not exist yet at commit time, the row is held in
the durable ledger (already durable via the capture-time durability gate)
— the STOP drain and BEHAVIORAL_EVIDENCE retry are the designed recovery
paths; the nav renders nothing for it.

**INV-F6 (exact id propagation).** The real Chrome `requestId` flows to
every representation of a recovered doc request: the recovered-row
literal, the ledger entry, and any attached NetworkActivity. The
`${method}:${url}:${stamped}` synthetic fallback is retained ONLY for
entries with no requestId at all (defensive; webRequest always provides
one in practice).

## 2. Changes (what production code will do)

### G5-A — stampEligibility becomes tri-state (amends G4-C)

`stampEligible(eventType, key)` in network-observation.ts is replaced by:

```ts
export type StampClass = 'primary' | 'secondary' | 'ineligible';

export function stampClass(eventType: string, key?: string | null): StampClass {
  if (eventType === 'submit') return 'secondary';
  if (eventType === 'keydown') return key === 'Enter' ? 'primary' : 'ineligible';
  if (PRIMARY_SET.has(eventType)) return 'primary';
  return 'ineligible'; // mousemove/focus/blur/input/scroll/…
}
```

`PRIMARY_SET = { click, contextmenu, change, drop }` (submit removed).
Back-compat export: `stampEligible(type, key) => stampClass(...) !== 'ineligible'`
— preserved because R14's assertions and any external callers expect it.

### G5-B — dispatcher routes secondary stamps (service-worker.ts OBSERVED_EVENT)

```ts
if (msg.payload?.isTrusted && _sender?.tab?.id != null) {
  const cls = stampClass(msg.payload.eventType, msg.payload.key);
  if (cls === 'primary') {
    setLastTrustedAction(tabId, frameId, action);      // overwrite (current behavior)
  } else if (cls === 'secondary') {
    setLastTrustedActionIfAbsent(tabId, frameID, action); // create-only
  }
}
```

### G5-C — `setLastTrustedActionIfAbsent` (network-observation.ts)

New export next to `setLastTrustedAction`. Create-only semantics: write
the map entry iff the exact `frameKey(tabId, frameId)` has NO stamp yet.
Persistence unchanged (full map snapshot, same key). See INV-F2.

### G5-D — recovered rows carry the real requestId + nav admission gate

In `recoverNetworkForNavigationById` (service-worker.ts):
- Step-1 row literal gains `requestId: pendingDoc.requestId`.
- Step-2 rows gain `requestId: req.requestId`.

In `attachSyntheticNavEvidence`:
- **Nav admission gate (INV-F5):** any recovered row whose
  `sourceEventId` is non-empty is NEVER pushed to `forSyntheticNav`.
  Stamped rows route to the ledger when ownerExists, else are held
  (ledger entry already durable from capture time; STOP drain /
  BEHAVIORAL_EVIDENCE retry attach when the interaction exists).
  `holdStampedActivity(entry)` (new ledger method) records the entry
  idempotently for the retry paths — call it in the owner-missing branch
  instead of `forSyntheticNav.push`.
  The `causedByInteractionId` stamping on the nav (INV-5 legacy) is
  preserved via the ledger's `stampCausalLink` at the eventual attach.
- **requestId propagation (INV-F6):** when routing to the ledger, pass
  the row's real `requestId` when present; use the synthetic fallback
  only when the row lacks one.

### G5-E — requestId-first dedup in mergeNetworkEvidence

`attachEvidenceToInteraction`'s `mergeNetworkEvidence` (sw-integration.ts):
add an intersection test on `requestId` ahead of the method:url fallback:

```ts
const existingIds = new Set(entries.map(e => e.requestId).filter(Boolean));
newEntries = incoming.filter(n => !existingIds.has(n.requestId)
  && !existingUrls.has(`${n.method}:${n.url}`));
```

Also apply the same guard when `mergeNetworkEvidence`'s caller processes
nav-triggered evidence updates? No — mergeNetworkEvidence only runs for
network-supplement evidence attaching to an interaction that ALREADY has
evidence. Nav evidence attaches to the nav interaction itself via
attachEvidenceToInteraction direct-attach; the nav's rows are what the
gate (G5-D) prevents from entering. Keep G5-E scoped to interaction-level
merges.

### G5-F — STOP drain ring entry recognition (network-drain.ts)

`drainNetworkEvidence` already skips ring entries already attached (Guard
A). Extend `DrainEntry` shape awareness: ring entries carry `requestId`,
`sourceEventId`, `drain` passes `documentRequest: r.documentRequest` —
this flows through today. G5-F is a no-op aside from the R28 test that
pins the behavior.

## 3. Determinism argument (why no timing)

- Every join remains equality on browser-assigned identifiers. The only
  ordering assumptions are browser-dispatch properties (the tap sends
  OBSERVED_EVENT during the click dispatch; onBeforeRequest cannot fire
  before the click's default action request starts).
- The `submit` secondary rule uses no clock: it is a key-existence check
  on the in-memory map (`setLastTrustedActionIfAbsent`), and the stamp
  map is written synchronously during message dispatch.
- Ownership decisions are made exactly once (durable attach) and become
  immutable (ownership ledger). Later duplicates are dropped by
  requestId equality.
- The nav admission gate is a synchronous decision at commit; held rows
  are retried by existing event-driven paths (STOP drain, BEHAVIORAL
  EVIDENCE retry, boot rehydrate) — no timers, no lookback windows.

##  Stamp-eligibility matrix (G5-A)

| event type            | G4-C class   | G5 class    | rule                     |
|-----------------------|--------------|-------------|--------------------------|
| click                 | eligible     | primary     | overwrite                |
| contextmenu           | eligible     | primary     | overwrite                |
| change                | eligible     | pure        | overwrite                |
| drop                  | eligible     | primary     | POST-change drop         |
| submit                | eligible     | **secondary** | create-only (never overwrites click/Enter) |
| keydown Enter         | Enter-only   | primary     | Enter-only               |
| keydown other         | none         | ineligible  | —                        |
| mousemove/focus/…     | none         | ineligible  | —                        |
| change → submit chain | —            | change primary then submit secondary | change owns; submit cannot steal |

## 4. Data-flow after G5 (the amazon.in case)

```
trusted click (INPUT#add-to-cart-button type=submit)
  ├─ dispatcher: stampClass('click') = primary → frame-0 stamp = <clickId>
  ├─ int-18 emitted immediately (click def completes on trigger)
  ├─ int-18 captureOrigin = (tab, 0)
  ├─ bridge: ACTION_WINDOW opens (evidence-collector)
  ├─ native submit DOM event
  │    └─ dispatcher: stampClass('submit') = secondary → setIfAbsent:
  │         frame-0 already = <clickId> → NO overwrite ✓
  ├─ POST /cart/add-to-cart (main_frame) fires
  │    ├─ onBeforeRequest: stamp lookup → <clickId>
  │    ├─ pendingDoc.sourceEventId = <clickId>; ledger entry (durable)
  │    └─ forwardToTab → bridge buffers (real requestId, started +5ms)
  ├─ onCommitted (form_submit transition)
  │    ├─ pendingDoc consumed; G1-C back-fill no-op (already stamped <clickId>)
  │    ├─ recovered row: {method POST, url originalUrl, requestId REAL,
  │    │                 sourceEventId <clickId>}
  │    ├─ ownerExists: int-18.triggerEvent.eventId === <clickId> ✓ → ledger
  │    │    route: attachStampedActivity(requestId=REAL, mainFrame=true)
  │    │    → ownership: REAL → int-18; causedByInteractionId stamped on nav
  REAL, sourceEventId <clickId>} → ownerExists ✓ → ledger
  │    ├─ nav networkActivity = [] (INV-F5: stamped row never admitted)
  │    └─ nav.causedByInteractionId = int-18
  └─ window closes (+159ms): CER-3 collectForRange → POST row (real
     requestId) → BEHAVIORAL evidence → attach to int-18 via
     mergeNetworkEvidence → requestId dedup → 0 new rows (already there)
```

Net: one POST row, on int-18, one owning interaction, empty nav network.

## 5. Regression tests (R24–R28)

All identity-joins, no timing. New file
`tests/unit/background/native-form-submit-ownership.test.ts`.

- **R24 (THE amazon.in repro)**: click → submit → main-frame POST →
  commit; click interaction exists. Expect: exactly ONE `/cart/add-to-cart`
  row total across all interactions; it is on the click; nav
  networkActivity empty; `causedByInteractionId` set on nav; ownership
  ledger maps REAL requestId → click.
- **R25 (fast path / pre-attached evidence)**: same, but click already
  carries the bridge row (real requestId) BEFORE commit; commit routes
  the row to the ledger → ownership blocks (already attached) → 0 new
  rows anywhere; nav empty. *(Implemented as R24's 4th test; the file's
  R25 block instead pins the owner-absent-at-commit hold path that
  INV-F5's retry design relies on — both behaviors are covered.)*
- **R26 (programmatic submit, no click)**: no click stamp; `submit`
  event stamps (create-only fires); POST stamps <submitId>; commit:
  ownerExists false (no interaction owns <submitId>) → G5-D hold in
  ledger (not nav) → STOP drain: `resolveInteractionForEventId(<submitId>)`
  … no interaction owns it → entry remains unresolved → clearAll. Nav
  empty. (Deterministic outcome pinned; honest: the request belongs to
  no interaction because none captured it.)
- **R27 (multi-frame no-bleed)**: click in frame 3 stamps (tab,3);
  top-level submit POST (frame 0) → frame-0 lookup misses (exact-frame,
  INV-G2) → unstamped → G1-C back-fill rule 1: frame-0 stamp? none →
  rule 2: tab-unique = (tab,3) → resolves to click. Attributed to the
  iframe click — matches the G1-C design. Frame-0 fetch with no stamps:
  unstamped → nav (unchanged).
- **R28 (bridge+SW double capture, requestId dedup)**: interaction has a
  bridge row (requestId 'r1', already attached); ledger contains a copy
  stamped <clickId> under requestId 'r1' (same) AND a synthetic-id copy
  ('POST:url:click' ≠ 'r1'). STOP drain: ring copy with 'r1' → guard A
  blocks (already attached). Synthetic-id ledger copy → attachToInteractions
  → ownership.isAttached('r1')? The ledger copy's id differs
  ('POST:url:click') → would attach a duplicate UNLESS ownership ALSO
  checks (method, url, sourceEventId) equality… design decision:
  ownership remains requestId-keyed (INV-F3) and G5-D drops the
  synthetic-id copy at routing time: when the real requestId is known,
  the ledger entry must be pushed under the REAL id. Implementation:
  `attachStampedActivity` entry dedups in pushStamped by requestId, and
  the routing call site passes the real id — the synthetic-id copy never
  exists because capture-time pushes use the real id; R28 pins that the
  *routing* call site uses the real requestId (routing with
  'POST:url:click' while capture-time entry 'r1' exists must not create
  a second entry). **R28 expectation**: click has exactly ONE POST row;
  the second R28 test pins holdStampedActivity idempotence under the
  real id directly.

**Existing suites stay green.** R14's assertions (`click/contextmenu/
change/submit/drop stamp`) become: primary set stamps; submit stamps
**only when absent** (assert `setLastTrustedActionIfAbsent` semantics via
observable behavior: stamp click → submit → stamp is still the click's).
R16/R17/R21–R23 unchanged (their paths never involve `submit` events).

## 6. Out of scope

- Form-submit component definition (submit event as memberEvent of the
  click) — a larger runtime change; the G5 model achieves the ownership
  contract without it. Revisit if evidence windows need submit-evidence.
- Main-world fetch/XHR patch capturing form submissions from isolated
  worlds; behavioral replay origin limitations.
- Session-scoped audit of ring TTL interplay with held ledger entries —
  ledger `clearAll()` at session end is unchanged (INV session scoping).
