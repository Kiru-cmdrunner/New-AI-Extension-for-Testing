# Phase 2: Evidence Channels

## Summary
Implemented the five evidence channels (A-E) that collect structured evidence from DOM interactions. Each channel is a modular collector replicating proven extraction logic from the existing recorder. Also includes type adapters bridging existing types to the new Phase 1 target types.

## Files Added (10)
- `src/pipeline/channels/evidence-channel.ts` — EvidenceChannel interface, ChannelCollectInput, ChannelMap
- `src/pipeline/channels/channel-a-accessibility.ts` — ARIA roles/states, accessible name, landmarks
- `src/pipeline/channels/channel-b-dom-structure.ts` — tag, classes, hierarchy, locators, CSS selector + XPath generation
- `src/pipeline/channels/channel-c-behavioural.ts` — event sequence, value/checked transitions, validation attrs
- `src/pipeline/channels/channel-d-mutations.ts` — surface detection, mutation summarization
- `src/pipeline/channels/channel-e-focus-overlay.ts` — focus/blur, overlay/dialog tracking
- `src/pipeline/channels/index.ts` — registry: ALL_CHANNELS, CHANNEL_MAP, collectAllEvidence, collectFromChannel
- `src/pipeline/adapters/type-adapters.ts` — adaptElementIdentity, adaptDomContext, recordedEventToEvidenceRecords
- `tests/unit/pipeline/channels.test.ts` — 35 channel tests
- `tests/unit/pipeline/type-adapters.test.ts` — 22 adapter tests

### Modified (1)
- `src/types/element.ts` — added 'menu' to TargetSurfaceType

## Acceptance Criteria
- [ ] Five evidence channels (A-E) implementing the EvidenceChannel interface
- [ ] Each channel produces typed EvidenceRecord[] from ChannelCollectInput
- [ ] Channels are stateless and non-throwing
- [ ] Channel registry provides ordered iteration and O(1) lookup
- [ ] Type adapters convert ElementIdentity → TargetElementIdentity losslessly
- [ ] Type adapters convert DomContext → TargetDomContext losslessly
- [ ] recordedEventToEvidenceRecords synthesizes EvidenceRecord[] from existing event data
- [ ] 57 new tests pass
- [ ] Full test suite: 3,170 tests pass
- [ ] TypeCheck: 0 new errors (344 baseline maintained)
- [ ] Build: succeeds
- [ ] No existing files modified (except element.ts TargetSurfaceType expansion)

## Architectural Decisions
1. **Channels are stateless** — they don't accumulate state across events. This keeps them simple and testable.
2. **ChannelCollectInput pre-computes** — the EventTap (Phase 3) will pre-compute valueBefore/After, checkedBefore/After so channels don't need their own value trackers.
3. **Non-throwing contract** — every channel wraps its logic in try/catch. A failing channel returns [] and doesn't break others.
4. **Adapters are temporary** — they bridge the existing recorder's types to the new types. They'll be removed once the content script fully produces target types.
5. **recordedEventToEvidenceRecords** is the key bridge: it synthesizes EvidenceRecord[] from existing RecordedEvent data, enabling the new pipeline to process events from the old recorder.
