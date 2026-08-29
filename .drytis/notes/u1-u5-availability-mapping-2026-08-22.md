# U1–U5 Availability Mapping — data sources, gaps, milestone order (2026-08-22)

Companion to app-understanding-panel-design-2026-08-22.md. Basis: researcher audit @ 64296a1
+ leader verification (ir-bridge.ts:414-421/565/587; knowledge-types.ts EpisodeRow members,
ActionSignatureRow; domain/entities/understanding-result.ts).

Legend: ✅ renderer-only (data + join key exist) · 🟡 partial (needs read-path helper or
spec-time field verify, NO schema/writer change) · 🔴 requires engine/pipeline change.

## U1 — Observed Workflow card upgrades
| Element | Source | Status |
|---|---|---|
| 18 type badges | InteractionType (component-types.ts L200-218); TYPE_DISPLAY gap at interaction-renderer.ts:32-49 | ✅ |
| EndState badge all states | ComponentInteraction.endState (:241) | ✅ (today rendered only when ≠completed) |
| Member-event chip `n events · ms` | memberEvents[] + startTime/endTime (:435-483) | ✅ |
| Understanding badge ✓/❓/⚠ | componentType, metadata.reason ('unclaimed-at-projection'), physicalEvents, projection-engine.ts:152-171 | ✅ |
| Why-block (recognized) | definition metadata: Hover evidenceReason, Dropdown selectionConfirmed/provisionalSelection, 6D.0 containment via surface vocab, priority from 14 definitions | ✅ recorded facts |
| Why-block (decisive-evidence detail) | definition-evaluation trace NOT recorded | 🔴 U6 (deferred; UI prints honest placeholder) |
| Assertion chip | IR plan steps + step-scoped assertions joined by sourceEventId (ir-bridge.ts:414-421, :587) | 🟡 verify emitted IRStep carries sourceEventId/elementId at spec time; join itself exists |
| KR linkage chip ◆ new/reinforced | interactionId → KnowledgeEpisodeRow.members[].interactionId → signatureKey → KnowledgeActionSignatureRow (occurrenceCount, firstSeenAtSession) | 🟡 read-only Dexie query helper; no schema change |
| Show-hidden toggle | renderProductionInteractions filter (interaction-renderer.ts:370-399); suppressed states already persisted | ✅ |

## U2 — Application Evidence drill-downs
| Element | Source | Status |
|---|---|---|
| Seed/selector provenance row | WireObservedItem.matchedSelector incl. 'changed-element-seed' sentinel (page-content-wire.ts L24-45) | ✅ |
| Item attributes / uniqueInSnapshot / visible | WireObservedItem fields | ✅ |
| entity→KR hyperlink | entityId + KR entities table | 🟡 cross-view link, read-only |
| Network requestBody/resourceType/source | NetworkActivity (:436-472) | ✅ disclosure only |
| DOM change raw metadata | DomChangeSummary batch fields | ✅ |
| Stability sparkline | EvidenceWindow.stabilityTrace cap 50 | ✅ |
| Raw evidence JSON | BehavioralEvidence on interaction | ✅ |

## U3 — Session Understanding card (side panel stopped view)
| Element | Source | Status |
|---|---|---|
| App identity | UnderstandingResult.appId + applications table | ✅ |
| View map + transitions | knowledgeViews + knowledgeViewTransitions | ✅ |
| Entities new/reinforced + state history | knowledgeEntities (stateHistory M9.9) | ✅ |
| Counters/collections/outcomes/transitions | knowledgeCounters/Collections/Outcomes/StateTransitions + result.outcomes/transitions | ✅ |
| Coverage stats | knowledgeBehaviorSessions coverage fields | ✅ |
| Gaps backlog | knowledgeGaps + Unclassified aggregation | ✅ |
| Warnings | UnderstandingResult.knowledgeWarnings | ✅ |
| Entity discovering-session provenance | KnowledgeEntityRow — verify which fields carry first-seen session | 🟡 spec-time verify |

Writer exists (service-worker.ts:580 understanding_result; pipeline writes all KR tables).
Renderer reads only. NO pipeline change.

## U4 — Knowledge Repository browser (repository page)
| Element | Source | Status |
|---|---|---|
| Entities/Views/Transitions/Counters/Collections/Notifications/Outcomes/StateTransitions | 15 Dexie tables, all written (understanding-pipeline.ts:399-459) | ✅ zero UI today |
| Action signatures + consequenceProfile + divergenceFlags + occurrence/staleness | KnowledgeActionSignatureRow (incl. status, sessionsSinceSeen) | ✅ |
| Recorded workflows + linkageState | knowledgeRecordedWorkflows (D6) | ✅ |
| Episodes/Edges with EvidenceRef drill-down | KnowledgeEpisodeRow.members[].interactionId; EdgeRow fromInteractionId; refJson | ✅ |
| Gaps ranked by recurrence | knowledgeGaps | ✅ |
| API seeds | KnowledgeContract + contract-queries listApiSeeds (no UI consumer today) | ✅ |
| Hosting | replaces dead 'capabilities-view' tab (repository-page.ts has zero refs) | ✅ |
| Context/access | extension-page Dexie read; same-origin as SW writes | 🟡 verify open path from panel/repo page at spec time |

## U5 — Forward links
| Element | Source | Status |
|---|---|---|
| Reinforcement chip ×n | occurrenceCount, firstSeen/lastSeenAtSession, sessionsSinceSeen | ✅ |
| Locator durability join → heal history | cmdrunner_repository elements.locator/heals (V2 Dexie) vs KR signature/entity | 🟡 cross-DB read-only join |
| Gap guidance (counts) | knowledgeGaps + Unclassified counts | ✅ deterministic counts only |
| Recognition hints into definitions | capability model | 🔴 roadmap 7.3 — out of U5 scope by design |

## Milestone order (safest, no architecture change)
MS-U1 card upgrades (pure renderer, smallest blast radius) → MS-U2 drill-downs (renderer) →
MS-U3 Session Understanding (first KR read path, single card scope) → MS-U4 KR browser
(isolated new surface in repository page, zero touch on recording flows) → MS-U5 forward
links (depends on U3/U4 joins proven). U6 decision-trace capture = engine-side, owner-gated,
separate (7.3 era). Each milestone independently shippable/revertable; pins + real-Chrome
panel harness reuse; owner gate per commit.

## Hard guarantees preserved
No writer paths change; no ledger/projection/IR/NOISE_TYPES edits; panel never writes KR;
deterministic-first AI-last (no AI narration); skip≠loss surfaced as gaps; no timing logic.
