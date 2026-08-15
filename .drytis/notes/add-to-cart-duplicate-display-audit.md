# Audit — `/cart/add-to-cart` POST rendered under BOTH int-18 (click) and int-19 (synthetic nav)

Verdict: ONE HTTP request, TWO display copies written by two independent
capture systems that share NO dedup key. Not a requestId shared between
interactions — the nav's copy carries NO requestId at all.

## Observed data decoded

- int-18 "Network (6)": 1 🔵 (main-world fetch/XHR patch) + 5 🟣
  (`source:'webrequest'`). The POST row here came from the **content-script
  window**: `forwardToTab` (SW→bridge NETWORK_REQUEST events, real
  Chrome requestId) → buffer → EvidenceCollector window [open@click,
  close@+159ms lifecycle-complete] → CER-3 `collectForRange` →
  BEHAVIORAL_EVIDENCE → attached to the click. The POST started ~+5ms —
  inside the window → legitimately collected.
- int-19 "Network (1)": ONE 🟣 POST row with method **POST** → this is the
  **pendingDoc row** from `recoverNetworkForNavigationById` STEP 1
  (service-worker.ts:1059-1078). Only step-1 rows keep method=POST +
  originalUrl; ring/in-flight rows for a redirect chain would show the
  chain-final method/URL or be deduped by `seenRequestIds`.

## Intended logic (INV-5 / commit-time causal routing)

`onCommitted` → `recoverNetworkForNavigationById`:
1. Consume pendingDoc (main_frame POST captured at onBeforeRequest).
   G1-C back-fill stamps it if `transitionType==='form_submit'` and the
   tab's frame-0 (or tab-unique) stamp resolves.
2. `attachSyntheticNavEvidence` routes each recovered row:
   - stamped AND ownerExists in liveInteractions → ledger → causal CLICK.
     Nav gets `causedByInteractionId`, networkActivity stays EMPTY.
   - unstamped OR owner-missing → `forSyntheticNav.push` (INV-G10
     "honest degradation": unattributable requests render on the nav,
     never guessed onto an interaction).
3. Step-1/step-2 rows are built WITHOUT a `requestId` field
   (NetworkActivity literals, service-worker.ts:1061-1077 & 1100-1111).

## Root cause — CONFIRMED in code: G4-C's `submit` stamp-eligibility steals
## the click's stamp; the ownerExists fallback then renders the POST on the nav

Chain (every step verified in source):

1. Click on `INPUT#add-to-cart-button [type=submit]` (trusted `click`).
   Tap sends OBSERVED_EVENT; dispatcher stamps frame-0 =
   `{eventId: <clickEventId>}` (service-worker.ts:1377). Click interaction
   int-18 emitted immediately — `src/definitions/click.ts` isInScope returns
   false unconditionally ("Click is immediate — no lifecycle") and
   handleEvent completes at once, so int-18 exists in liveInteractions with
   NO memberEvents beyond the click itself.
2. Native form submission fires a trusted `submit` DOM event. The tap
   captures it (event-tap.ts:358 includes 'submit') and the dispatcher
   OVERWRITES frame-0 stamp → `{eventId: <submitEventId>}` — G4-C listed
   `submit` in STAMP_ELIGIBLE_EVENT_TYPES (network-observation.ts:593).
   No `form-submit` definition exists (definitions/ has none; grep for
   'submit' in definitions/ finds only date-picker lifecycle notes), so the
   submit event is never claimed by any component.
3. POST `/cart/add-to-cart` (main_frame) → onBeforeRequest: exact frame-0
   stamp lookup returns the SUBMIT eventId → pendingDoc.sourceEventId =
   <submitEventId>; ledger entry recorded under <submitEventId>.
   forwardToTab also forwards the request (real requestId) to the bridge.
4. Content-script side: the click's ACTION_WINDOW (evidence-collector.ts:98,
   click is a window-opener) is still open (159ms, closes
   lifecycle-complete). The bridge-forwarded POST (started ~+5ms) is inside
   the window → CER-3 collectForRange includes it → BEHAVIORAL_EVIDENCE
   attaches to int-18 with the real requestId. → int-18 "Network (6)" row.
   CORRECT capture, correct owner.
5. onCommitted (form_submit transition) → recoverNetworkForNavigationById:
   pendingDoc IS stamped (<submitEventId>) → step-1 row built (method POST,
   originalUrl) → attachSyntheticNavEvidence line 1147: stamped →
   ownerExists scan: int-18.triggerEvent.eventId = <clickEventId> ≠
   <submitEventId>; memberEvents empty (click completed immediately);
   no interaction owns <submitEventId> → ownerExists = false → line 1198:
   `forSyntheticNav.push(activity)` → 🟣 POST row on int-19. THE OBSERVED ROW.
6. STOP: ring/ledger entries under <submitEventId> resolve to nothing
   (drain keys off each interaction's own sourceEventId; click's is
   <clickEventId>) → unresolved → clearAll drops them. No third copy.
   Exactly matches the report: 6 rows on int-18, 1 row on int-19.

So: ONE HTTP request. int-18's row = content-script window capture via the
bridge (real requestId, `source:'webrequest'` rows from forwarding). 
int-19's row = pendingDoc recovery row stamped with the SUBMIT event's id,
which no interaction owns, falling into the INV-G10 owner-missing branch.
The two copies were written by two capture systems that share no dedup key
— the nav row has no requestId at all (step-1 literal omits it).

Alternative (ii-a, G1-A message race → unstamped pendingDoc + failed G1-C
back-fill) is NOT what happened here: G1-C would have back-filled the
frame-0 CLICK stamp (present by commit), ownerExists would then be TRUE
(int-18 emitted), and the row would have gone to the ledger → int-18, not
the nav. The stolen-stamp path is the only one that yields exactly the
observed split.

Either way: the click's copy (bridge/window path) and the nav's copy
(pendingDoc path) were written by systems that never see each other. The
nav's row has no requestId → `mergeNetworkEvidence`'s `method:url` dedup
never runs against it → no downstream pass can remove it.

## Confirmed NOT the cause (ruled out in code)

- Two HTTP requests from Amazon: no evidence; a redirect chain reuses the
  requestId, and each display copy traces to a different write path, not
  two captures of two requests. (Definitive check: DevTools network panel
  during repro, or requestId in stored ring data.)
- Ledger double-attach of the real requestId: ownership ledger blocks it
  (capture-time entry skipped once the bridge row with the real requestId
  is on int-18; drain guard A also blocks).
- Step-2 ring dedup: `seenRequestIds` correctly collapses the pendingDoc
  and the ring entry (same requestId).

## Residual secondary defect (not what produced this display, but real)

When routing DOES go to the ledger (stamped + ownerExists), the fallback
requestId `` `${method}:${url}:${stamped}` `` (service-worker.ts:1178-79)
differs from the real Chrome requestId already recorded at capture
(durability gate). `pushStamped` dedups by requestId → a SECOND ledger
entry attaches to the click with the synthetic id → click shows two POST
rows. Didn't fire here (int-18 shows one row) but will in the
fast-message-delivery ordering.

## Fix direction (audit only — nothing applied)

1. **Carry the real requestId** on step-1/step-2 recovered rows so every
   consumer can dedup (pendingDoc has it; ring entries have it).
2. **Cross-path dedup at the nav**: before `forSyntheticNav.push`, check
   ownership/ledger + whether the pendingDoc's requestId was already
   captured inside a live interaction's window evidence (or at minimum,
   drop nav rows whose requestId is ownership-attached).
3. **Revisit `submit` in STAMP_ELIGIBLE**: a submit DOM event following a
   click on a submit-input steals the click's stamp by design of G4-C.
   Either exclude 'submit' when a click stamp is fresher in the same
   frame, or make the runtime absorb submit into the click's memberEvents
   so tier-2 resolution finds the owner.
4. G1-A race: if real-world message ordering can lose to onBeforeRequest,
   the G1-C back-fill (form_submit + frame-0 rule) is the designed rescue —
   verify transitionType actually was 'form_submit' in the repro.

## Regression plan for the fix

R24: click INPUT[type=submit] → submit DOM event → POST main_frame →
commit: exactly ONE /cart/add-to-cart row TOTAL across all interactions,
on the click; nav networkActivity empty; causedByInteractionId set.
R25: same but click evidence already attached before commit (fast path) —
still one row. All 151 files / 3127 tests stay green.
