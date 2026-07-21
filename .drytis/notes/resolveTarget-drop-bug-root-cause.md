# Root Cause: resolveTarget() Silently Drops Non-Standard Elements

## Date: 2026-07-18
## Status: ROOT CAUSE IDENTIFIED — fix implemented

## Problem
On modern SPA sites (adlanione.com, React/Next.js), clicking custom dropdowns
and widget buttons produced zero captured events. The recorder appeared dead.

## Root Cause
`resolveTarget()` calls `isInteractive(el)` which uses `el.matches(INTERACTIVE_SELECTOR)`.
The selector list includes native tags (button, a, select, input) and ARIA roles,
plus `[onclick]` attribute. BUT modern SPAs (React, Vue, Angular) bind event
handlers via `addEventListener`, NOT inline onclick attributes.

Result: when a user clicks a `<div>` or `<span>` with a React onClick handler:
1. `resolveTarget()` walks composedPath() → no element matches INTERACTIVE_SELECTOR
2. Falls back to parentElement walk → still no match
3. Returns `null` → event is silently dropped

## Why the comprehensive tests didn't catch this
The tests create real DOM elements WITH proper ARIA roles and native tags.
They never tested the "bare div with click handler" case that dominates real SPAs.

## Fix Applied
1. Added click-handler detection: `el.onclick` is set even for `addEventListener`
   in some browsers. More importantly, added "clickable element" heuristic:
   cursor:pointer, or explicit role, or common SPA class patterns.
2. Changed resolveTarget() fallback: if no interactive element found, return the
   raw event target (the element the user actually clicked) instead of null.
3. Added a blocklist to prevent capturing clicks on body/html/script/etc.
4. Added `[role="group"]` detection for filter panels, toggle button groups.

## Key Insight
Phase 1 spec says "capture exactly what the user did." Dropping events because
the element isn't in a known-interactive list violates this principle. The
recorder's job is to record, not to decide what's worth recording.
