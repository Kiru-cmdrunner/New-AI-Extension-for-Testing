# Legacy Content Scripts

**Archived:** July 2026  
**Status:** Superseded by `src/recorder/deterministic-recorder.ts`  
**Reason for archival:** Phase 1 unification consolidated all per-interaction-type
content scripts into a single deterministic recorder.

## What These Were

Before the deterministic recorder, each interaction type had its own self-contained
content script:

| Script | Lines | Interaction Type |
|--------|-------|-----------------|
| `select-content-script.ts` | ~1,538 | Dropdown / Select |
| `hover-content-script.ts` | ~1,391 | Hover / Mouse interactions |
| `datepicker-content-script.ts` | ~1,132 | Date Picker |
| `click-content-script.ts` | ~1,005 | Click |
| `checkbox-radio-content-script.ts` | ~846 | Checkbox / Radio |
| `text-entry-content-script.ts` | ~350 | Text Entry |
| **Total** | **~6,262** | |

## Why They Were Replaced

The per-type approach required injecting multiple content scripts per page (one
per interaction type), each attaching its own set of event listeners. This caused:

- Listener conflicts and double-capture when multiple scripts overlapped
- No unified event ordering across interaction types
- Code duplication (element identity extraction, surface detection, etc.)
- Maintenance overhead — each new interaction type needed its own script

The deterministic recorder (`deterministic-recorder.ts`) replaced all of these
with a single content script that:

- Uses document-level capture-phase event delegation (15 listeners total)
- Captures all interaction types via event type + DOM context
- Resolves targets through `event.composedPath()` (Shadow DOM support)
- Runs with `all_frames: true` for iframe support

## Kept for Reference

These files are retained in `legacy/` for historical reference. The proven helper
functions (hover detection, datepicker gridcell matching, select option resolution)
were inlined into the deterministic recorder with improvements. If any pattern
needs to be re-examined, git history and these archived files are the source.

**Do not import from these files.** They are not part of the build.
