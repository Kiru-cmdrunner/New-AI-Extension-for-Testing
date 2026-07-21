# Legacy Pipeline-V2

**Archived:** July 2026  
**Status:** Superseded by Evidence Engine (V2)  
**Design concepts extracted to:** `.drytis/notes/pipeline-v2-design-concepts.md`

## What This Was

An alternative recording/classification pipeline that used:

1. **State Diff Engine** — DOM snapshot before/after each interaction, pure-function diff
2. **Canonical Event Schema** — Closed-vocabulary type system for events, units, and actions
3. **Pattern Registry** — 12 interaction behaviors matched via confidence-scored evaluation
4. **Boundary Detector** — Event-stream segmentation into atomic InteractionUnits
5. **Intent Resolver** — State diff as primary signal, patterns as accelerators
6. **Interaction Assembler** — Final action assembly with element identity resolution

## Why It Was Superseded

The evidence-engine approach won because:

- Provider-pluggable architecture is more extensible than a fixed pattern list
- Weighted voting handles conflicting signals better than single-pattern matching
- Works on the existing RecordedEvent type system (no schema migration needed)
- The V1 detector was already stable — the evidence engine was a smaller delta

## Why It's Kept

The pipeline-v2 concepts are directly relevant to future roadmap features:

| Concept | Relevant To |
|---------|------------|
| State Diff Engine (pure functions) | **Validation Engine** — snapshot/diff as test assertions |
| Canonical Event Schema (12 behaviors) | **AI Workflow Generation** — AI produces ResolvedAction sequences |
| Pattern Registry (behavior abstraction) | **Capability Engine** — probe what a page can do |
| Boundary Detector (event segmentation) | **AI Workflow Generation** — defines "what is one step" |

See `.drytis/notes/pipeline-v2-design-concepts.md` for the extracted design concepts.

**Do not import from these files.** They are not part of the build.
