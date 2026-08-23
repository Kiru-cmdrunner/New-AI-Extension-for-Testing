# User Evidence Batch 2 — 2026-08-23 07:24 UTC (real-site outerHTML samples)

**Context:** Follow-up to batch 2026-08-23-0700. Three DevTools Elements
screenshots supplying the checklist items that gate 6E-M2. Decoded below;
root causes verified against HEAD 317c527 source.

## Sample 1 (image_aabf267e) — calendar date cell — REAL MARKUP CAPTURED

```html
<div class="react-datepicker__day react-datepicker__day--selected react-datepicker__day--keyboard-selected react-datepicker__day--range-start react-datepicker__day--range-end react-datepicker__day--in-range react-datepicker__day--weekend"
     tabindex="0" aria-label="Choose Saturday, September 5th, 2026"
     role="option" aria-disabled="false" aria-selected="true">
  <div class="datepicker-date-holder">
    <div class="full datepicker-date"><span>5</span></div>
  </div>
  <p class="bg-fff fs-9">7,000</p>
</div>
```
Framework: **react-datepicker** (one of the most widely used date pickers).
Week/month containers: `react-datepicker__week`, `react-datepicker__month[role=listbox]`,
`react-datepicker__month-container`, root `react-datepicker` with
`span[role=alert][aria-live=polite].react-datepicker__aria-live`.

## Sample 2 (image_1ca7fe17) — calendar container + trigger wrapper chain

`city-inputs-wrapper > travel-date-wrapper > travel_date(.focused) >
(adl-floating-input form-floating | .hide) > div.date_picker.undefined >
react-datepicker > [triangle, aria-live span, month-container] > month[role=listbox] > week > day`

Trigger input (from batch 1): `INPUT #onward/#return [role=textbox]`
"Depart on"/"Return on", class `withIcon form-control`, type=text.

## Sample 3 (image_01a709e8) — RESULTS PAGE — flight card + filter bar

```html
<div class="srp-d-filter mr-tb20 flx-vc">…</div>           <!-- filter strip -->
<div class="full results-holder">
  <div class="card-box full">
    <div class="full result-item result-item-desktop anim"
         auto-id="data_select_departure_flight" id="DCdc1s">…</div>  <!-- flight card -->
```
Route URL: `/flight/bookingV2/srp/…/DEL-BOM-05092026/REGF`. Card interior
(visible in page): IndiGo rows, times, price, **"Book Now" button**, route
DEL → JDH → BOM. Filters: native checkboxes (1 Stop, airlines), time-band
chips, price slider.

## Root causes verified against HEAD source (node-tested)

RC-A **DatePicker trigger never fires** (three independent misses):
1. wrapper class `date_picker` (underscore) fails
   `DATEPICKER_TRIGGER_CLASS_RE=/(oxd-date-input|datepicker|date-picker|date-input|calendar-input)/i`
   — `'date_picker'.includes('datepicker')` = **false** (underscore vs hyphen);
2. input class `withIcon form-control` — no token;
3. names 'Depart on'/'Return on' lack `DATE_NAME_HINT_RE` tokens; no
   aria-haspopup=dialog; input type=text.
→ No lifecycle → cells have nothing to attach to. TextEntry correctly owns
the fields (batch 1, F-1 PASS).

RC-B **Cell class fails the cell vocabulary**:
`DATEPICKER_CELL_CLASS_RE=/(oxd-date-day|calendar-day|datepicker-day|day-cell|flatpickr-day)/i`
— real class `react-datepicker__day` contains `datepicker__day` (double
underscore) not `datepicker-day` → **false**. role=option alone insufficient
(guard against listbox options, correct). Note `hasDateCellName()` (6D.0)
DOES match the W3C name "Choose Saturday, September 5th, 2026" — the
name-shape machinery already shipped.

RC-C **Flight card = plain div**: class `result-item result-item-desktop anim`
matches no INTERACTIVE_CLASS_RE token (tested false); bare `auto-id`
attribute is NOT read by the engine (grep: no `auto-id` family in src/ — only
`data-auto-id`). Booking path exists via **Book Now button** (claimed Click).
Card-body click Unclassified = honest C1 shape with REAL attributes now known.

RC-D **DELBOM / 16:55 chips**: filter-strip chips (`srp-d-filter` area)
without interactive tokens + `Unknown element` + `sw-recovered-form-submit` =
identity lost during SW recovery — F4 service-worker-lifecycle family (6F
window), NOT an understanding-layer fix.

## M2 decisions now unblocked (evidence: real markup)
- W-A DatePicker react-datepicker family: trigger token normalization
  (`date[_-]picker`), cell token (`react-datepicker__day` /
  `datepicker__day`), and/or structural `hasDateCellName`-augmented
  isCalendarCell (library-agnostic, uses shipped 6D.0 machinery).
  Layer: src/definitions/patterns.ts only.
- W-B bare `auto-id` identity: NEW attribute family — touches capture/
  identity (6B territory) → owner-gated separately; NOT fuzzy matching.
- W-C card-body classification: NOT needed for booking (Book Now is a
  button); card click stays honest Unclassified. DELBOM/16:55 chips = C4
  class residual; identity loss = 6F.
