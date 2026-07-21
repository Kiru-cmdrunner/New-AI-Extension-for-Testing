# AI Observer & Session Context Architecture Summary

**Date:** 2026-07-17  
**Spec:** `.drytis/specs/milestone-ai-observer-session-context.md` (1016 lines)

## Verdict
VALIDATED and FROZEN. LLM-independent design for AI Observer behavior and Session Context during recording.

## Core Architecture
- **Session Context** = 3-layer transient structure:
  - Layer 1: Deterministic State (URL, open dialogs/menus/dropdowns, form context, mutation summary) — written by State Tracker only
  - Layer 2: AI Understanding (5 reasoning domains, confidence, element names) — written by AI Observer only
  - Layer 3: Action History (immutable Timeline) — written by Recorder only (write-once)
- Write-protection boundary: no component writes to a layer it doesn't own
- All persisted to chrome.storage.local (MV3-safe)

## AI Reasoning Model
- 5 domains: Application Identity, Workflow Progression, Current UI Focus, User Intent, Change Analysis
- Per-interaction cadence (not continuous AI calls)
- Receives semantic snapshot (no CSS/XPath/selectors)
- Returns understanding with evidence citations

## Confidence Model
- 5 independent tracks, each [0.05, 0.95]
- Weighted average: Intent 35%, Workflow 25%, App 15%, UI Focus 15%, Change 10%
- Thresholds: ≥0.85 AI may override ambiguous evidence; 0.60-0.85 tie-breaker; <0.35 ignored
- Alternatives required when intent confidence < 0.7

## AI Constraints (10 negative + 2 positive)
- Never: modify/delete/merge/reorder actions, determine type, generate JSON/Playwright, block pipeline, override evidence
- Always: cite evidence, avoid certainty when insufficient

## Operating Philosophy (frozen)
"Observe continuously. Understand progressively. Preserve facts. Cite evidence. Generate meaning later."

## Migration: 6 phases (AO-1 through AO-6)
AO-1: State Tracker → AO-2: Session Context → AO-3: Expanded prompt → AO-4: Wire into processAction → AO-5: Classifier reads context → AO-6: Cleanup old enrichment

## 14 decisions frozen. All frozen milestones preserved.
