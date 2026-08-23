# User Evidence Batch — 2026-08-23 07:00 UTC (first post-6D.1 manual run)

**Context:** Manual test on REAL AdaniOne (desktop Chrome, extension ZIP
10.9.0 @ sha256 d0386bf8…, audited CLEAN at HEAD 317c527). This is the
post-6D.1 user-evidence loop the roadmap expected ("post-6D.1 → results-page
recognition (O10 closes)").

**Captured artifacts:** 4 side-panel screenshots (image_7dcfbae0,
image_ced621d1, image_4d5513e2, image_541020d3).

## Findings (read from screenshots)

F-1 **'Depart on'/'Return on' ARE correctly captured as TextEntry** with full
value transitions (`Mon, 24 Aug → Sat, 05 Sep`, `Sun, 06 Sep → Sun, 27 Sep`,
8 DOM changes, 1 network, new surface role=alert). Exactly the 6E-M1 C5
measured shape. NOT broken — the user's "date is not fixed yet" impression
stems from F-2/F-3 below (the calendar *cell* clicks project Unclassified,
which visually reads as "date went to Unclassified").

F-2 **Calendar date cells → Unclassified (unclaimed-at-projection) on the
REAL site.** Cards int-40, int-41, int-52: "Unclassified on 'Choose
Saturday, Septembe…'/'Choose Sunday, September …'" — physical click,
unclaimed-at-projection, "new signature". 6E-M1 measured this cell as
*standalone Click* on the clone; on the real site the cell is NOT claimed as
Click either → real cells carry neither interactive tag/role nor interactive
class token. W3C date-name machinery (hasDateCellName) excludes them from
Dropdown, but nothing claims them. **Real-site cell markup still unknown —
checklist item 3 stands.**

F-2b **int-52 shows physical: mousedown with NO paired marker** — possibly
the cross-target/adjacent-pairing residual (S1' doesn't pair mousedown
without same-elementKey click). Check whether a matching click int exists in
the full card list; screenshots may simply not show it.

F-3 **Results-page clicks DELBOM (int-55) and "- 16:55" (int-56) →
Unclassified with "Unknown element" + "sw-recovered-form-submit".**
"Unknown element" + "sw-recovered" = the click landed AFTER service-worker
recovery / form-submit navigation — targetIdentity reconstruction from the
recovering page failed. This is the O10 card-body residual measured by
6E-M1 C1 (plain-div card / no interactive signal) PLUS an F4-adjacent
capture-recovery artifact: the click happens mid-navigation so even the
element identity is lost ("Unknown element").

## Classification (product vs harness)

- F-1: PASS — no defect.
- F-2: genuine product gap (measured C6 at HEAD; classification candidate
  only with real cell markup → M2 checklist item 3).
- F-2b: needs card-list confirmation (screenshot incomplete).
- F-3: genuine product gap — O10 plain-card residual (C1) compounded by
  sw-recovery identity loss (F4 family, 6F window). The real results-page
  card markup remains unknown → M2 checklist item 1 STILL decisive.

## What this batch DECIDES (per 6E-M1 report §M2 gate)

- Checklist item 1 (flight-card outerHTML) — still not collected; DELBOM /
  16:55 clicks confirm the real card body is non-interactive-shaped, but the
  attributes remain unmeasured. **6E-M2 stays gated.**
- The user-visible symptom "result.date not fixed" is REAL for the calendar
  cells (F-2) — the depart/return FIELDS are fine (F-1), and IR likely
  contains fill steps for both date fields (TextEntry cards int-33/int-34
  completed). What's missing from Observed Workflow/IR is the cell-click
  steps (filtered as Unclassified noise).
