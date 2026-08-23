# 6E-M1 — Real-Site Evidence Checklist: AdaniOne Flights Results Page

**Purpose:** O10 ("all results-page interactions Unclassified") can only be
closed on REAL results-page markup. Live AdaniOne remains egress-blocked from
this environment (verified 2026-08-23: HTTP 000 both `/` and `/flights`;
Akamai). The user is the live evidence loop (standing process).

**How to collect (one session, ~5 minutes):**

1. Open the real AdaniOne flights flow in Chrome (normal browsing).
2. Reach the RESULTS page (after search from home).
3. For each numbered item below: right-click the element → **Inspect** →
   in Elements panel right-click the highlighted node → **Copy → Copy
   outerHTML** (or screenshot the Elements panel including the node and its
   ancestors). Screenshot the page too (visual context).
4. If the DevTools "Recorder" export is easier: capture any panel-recording
   export + a HAR are nice-to-have but NOT required — outerHTML is the
   critical artifact.

**Items (each maps to a 6E-M1 matrix cell / M2 decision):**

| # | Element | Why needed (matrix cell) |
|---|---------|--------------------------|
| 1 | **One flight card, whole node incl. 2–3 ancestor levels** (the clickable card that selects a flight) | C1/C2: decides whether the real card is Shape-A (plain div → Unclassified residual) or Shape-B (role=button → already claimed). This single artifact decides the M2 classification question. |
| 2 | **The `#depart`-equivalent date field** (input + its label) | C5: whether the real field carries a date-hint token (→ DatePicker lifecycle) or is name-only like the clone (→ TextEntry, measured). |
| 3 | **One calendar date cell** (as used on the results page if present) | C6: real class names + role — decides whether `DATEPICKER_CELL_CLASS_RE` covers it (→ DatePicker completion) or unknown-class (→ honest Click, measured). |
| 4 | **One duration/stop filter chip** ('02h 30m' / '12h 10m'-shaped) | C3/C4: real class names — whether chips carry interactive tokens (→ Click, measured) or none (→ Unclassified, measured). |
| 5 | **Any results-page container** wrapping the flight list (the list parent) | C7: real attributes of the list + card elements (any identity attrs? `data-auto-id` naming?) — decides whether entity recognition could ever be evidence-based here. |
| 6 | **Cart/badge counter** on the results page (if any) | C9: confirms the measured counter path (already green) on real markup. |

**Where to put them:** `.drytis/notes/evidence/user-batch-<date>/` (or paste
into chat; either way they get archived). Every M2 decision cites these.

**Doctrine note:** until this batch exists, NO classification, entity, or
selector changes ship for results-page shapes (6D.2 lesson: census before
definition). The clone models BOTH plausible card shapes and the measured
HEAD table below bounds the residual honestly in the meantime.
