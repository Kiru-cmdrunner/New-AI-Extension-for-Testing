# Archive — Superseded Documentation

> **Created:** 2026-08-03 during documentation consolidation.
> **Reason:** These documents describe architecture that existed *before* the Amazon failure → R1/R2/R3 evolution. They reference deleted subsystems (V1/V2 dual-engine classification, Merge Layer, Evidence Channels, SemanticInteraction type, 38 interaction types) that no longer exist. Reading them for current architecture guidance will cause confusion.

## Archive Structure

| Directory | Contents | Why Archived |
|-----------|----------|--------------|
| `pre-r1-architecture/` | 19 design/review docs from 2026-07-29 era | Describe the V1+V2 dual-engine pipeline, Evidence Channels, Merge Layer — all deleted by R1 |
| `pre-r3-handover/` | 15 handover docs from 2026-07-21 | Frozen at pre-R1 state; describe "Universal Observer", "AI Observer", deleted directory structure |
| `pre-r3-phase-specs/` | 202 phase/milestone/stage/feature specs | Pre-R3 era specs for phases 0-12, milestones, stages, individual bugfixes. Historical implementation records |
| `pre-r3-architecture-specs/` | 18 architecture docs from docs/architecture/ | Describe pre-R3 validation, baselines, observation models |
| `pre-r3-domain-planning/` | 9 initial planning docs from 2026-07-21 | Earliest domain planning before recorder existed |
| `pre-r3-architecture/` | 6 transitional design docs (Tier 1/2 justification, validation) | Post-R1 but pre-R3 transitional designs |

## What Replaced These

For current architecture understanding, read **MASTER-HANDOVER.md** at the project root. It consolidates all authoritative information from the current era (R1/R2/R3/R4, P1/P2, Gen 1 pipeline, Capability model).

## Preservation Policy

These files are **preserved as historical record** — they contain implementation reasoning, postmortems, and debugging history that may be useful for understanding why specific decisions were made. They are NOT authoritative for current architecture or implementation guidance.
