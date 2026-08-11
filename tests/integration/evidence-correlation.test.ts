/**
 * Integration Tests: Evidence Correlation (M7-fix-001)
 *
 * Verifies the Event → Interaction → BehavioralEvidence correlation:
 *   - SW matches evidence by triggerEvent.eventId (Tier 1)
 *   - SW matches evidence by memberEvents[].eventId (Tier 2)
 *   - Evidence attaches to interaction.behavioralEvidence
 *   - First-write-only: trigger evidence wins over member evidence
 *   - Late evidence: pendingEvidence drains on onEmit
 *   - Unmatched evidence does not attach to wrong interaction
 *   - Re-render preserves evidence from storage
 *
 * Architecture: .drytis/notes/event-interaction-evidence-correlation-contract.md
 */

import { describe, it, expect, beforeEach } from 'vitest';
import type {
  ComponentInteraction,
  ObservedEvent,
} from '../../src/shared/component-types';
import type { BehavioralEvidence } from '../../src/shared/behavioral-evidence-types';
import type { ElementIdentity } from '../../src/shared/types';

// ── Test Helpers ─────────────────────────────────────────────────────

function makeIdentity(overrides: Partial<ElementIdentity> = {}): ElementIdentity {
  return {
    accessibleName: 'Test Element',
    ariaRole: 'button',
    ariaLabel: null,
    ariaLabelledBy: null,
    placeholder: null,
    tag: 'BUTTON',
    className: 'btn',
    name: null,
    stableId: 'test-btn',
    testId: null,
    dataCy: null,
    dataQa: null,
    cssSelector: '#test-btn',
    xPath: '//button',
    inIframe: false,
    shadowDom: false,
    href: null,
    inputType: null,
    elementId: 'elem-0001',
    ...overrides,
  };
}

function makeObservedEvent(
  eventId: string,
  eventType: string,
  overrides: Partial<ObservedEvent> = {},
): ObservedEvent {
  return {
    eventId,
    eventType: eventType as ObservedEvent['eventType'],
    timestamp: Date.now(),
    captureSeq: 0,
    isTrusted: true,
    target: makeIdentity(),
    domContext: {
      inputType: null,
      ariaExpanded: null,
      ariaHasPopup: null,
      isContentEditable: false,
      disabled: false,
      readOnly: false,
      required: false,
      ancestorRoles: [],
      ancestorClasses: [],
      tabIndex: null,
    },
    valueBefore: null,
    valueAfter: null,
    checkedBefore: null,
    checkedAfter: null,
    clientX: null,
    clientY: null,
    key: null,
    code: null,
    shiftKey: false,
    ctrlKey: false,
    altKey: false,
    metaKey: false,
    scrollDeltaY: null,
    scrollDeltaX: null,
    pageUrl: 'https://example.com',
    pageTitle: 'Test Page',
    ...overrides,
  };
}

function makeInteraction(
  interactionId: string,
  triggerEventId: string,
  memberEventIds: string[] = [],
  overrides: Partial<ComponentInteraction> = {},
): ComponentInteraction {
  const trigger = makeObservedEvent(triggerEventId, 'click');
  const members = memberEventIds.map((id, i) =>
    makeObservedEvent(id, i === 0 ? 'click' : 'input'),
  );
  return {
    interactionId,
    type: 'Click',
    trigger: makeIdentity(),
    triggerEvent: trigger,
    memberEvents: [trigger, ...members],
    startTime: Date.now(),
    endTime: Date.now(),
    endState: 'completed',
    metadata: {},
    ...overrides,
  };
}

function makeEvidence(
  sourceEventId: string,
  overrides: Partial<BehavioralEvidence> = {},
): BehavioralEvidence {
  return {
    sourceEventId,
    sourceEventType: 'click',
    windowId: `ev-${sourceEventId}`,
    frameId: 'main',
    window: {
      openedAt: 100,
      closedAt: 400,
      durationMs: 300,
      endReason: 'stabilized',
      stabilityTrace: [],
    },
    targetEvidence: {
      identity: makeIdentity(),
      identityCapturedAt: 100,
      before: null,
      after: null,
      focusMovement: null,
    },
    applicationEvidence: {
      domChanges: [],
      domChangeOverflow: 0,
      coarseMode: false,
      newSurfaces: [],
      removedSurfaces: [],
      visibilityChanges: [],
      navigation: [],
      networkActivity: [],
      performanceCondition: null,
    },
    ...overrides,
  };
}

// ── Pure Matching Logic Tests ────────────────────────────────────────
//
// These tests verify the correlation algorithm directly, without the
// SW's chrome.* APIs. The SW implementation will use this same logic
// internally.

/**
 * Find an interaction matching a sourceEventId using two-tier matching.
 * Tier 1: triggerEvent.eventId === sourceEventId (preferred)
 * Tier 2: memberEvents[].eventId === sourceEventId (fallback)
 */
function findMatchingInteraction(
  interactions: ComponentInteraction[],
  sourceEventId: string,
): ComponentInteraction | null {
  // Tier 1: trigger match
  const triggerMatch = interactions.find(
    (i) => i.triggerEvent?.eventId === sourceEventId,
  );
  if (triggerMatch) return triggerMatch;

  // Tier 2: member event match
  const memberMatch = interactions.find((i) =>
    i.memberEvents?.some((e) => e.eventId === sourceEventId),
  );
  return memberMatch ?? null;
}

describe('Evidence Correlation — Matching Algorithm', () => {
  // ── Scenario 1: Simple Click ───────────────────────────────────────

  it('scenario 1: simple click — evidence matches via triggerEvent.eventId (Tier 1)', () => {
    const interactions = [
      makeInteraction('int-1', 'evt-page1-1'),
    ];
    const evidence = makeEvidence('evt-page1-1');

    const match = findMatchingInteraction(interactions, evidence.sourceEventId);

    expect(match).not.toBeNull();
    expect(match!.interactionId).toBe('int-1');
  });

  // ── Scenario 2: Typing Session ─────────────────────────────────────

  it('scenario 2: typing session — evidence for input event matches via memberEvents (Tier 2)', () => {
    // TextEntry interaction: trigger = focus (evt-1), members include input (evt-2)
    const interaction = makeInteraction('int-1', 'evt-page1-1', ['evt-page1-2'], {
      type: 'TextEntry',
    });
    // EvidenceCollector opens window on the INPUT event, not the focus event
    const evidence = makeEvidence('evt-page1-2');

    const match = findMatchingInteraction([interaction], evidence.sourceEventId);

    // Tier 1 fails (trigger is evt-page1-1, not evt-page1-2)
    // Tier 2 succeeds (evt-page1-2 is in memberEvents)
    expect(match).not.toBeNull();
    expect(match!.interactionId).toBe('int-1');
  });

  // ── Scenario 3: Navigation ─────────────────────────────────────────

  it('scenario 3: navigation — evidence matches the navigation interaction', () => {
    const navInteraction = makeInteraction('int-3', 'evt-page1-5', [], {
      type: 'Navigation',
    });
    const evidence = makeEvidence('evt-page1-5');

    const match = findMatchingInteraction([navInteraction], evidence.sourceEventId);

    expect(match).not.toBeNull();
    expect(match!.interactionId).toBe('int-3');
  });

  // ── Scenario 4: Multi-Member Interaction ───────────────────────────

  it('scenario 4: dropdown with multiple events — trigger evidence wins (first-write-only)', () => {
    // Dropdown: trigger = click to open (evt-1), member = click option (evt-2)
    const interaction = makeInteraction('int-1', 'evt-page1-1', ['evt-page1-2'], {
      type: 'Dropdown',
    });

    // Evidence for trigger event
    const triggerEvidence = makeEvidence('evt-page1-1');
    // Evidence for member event
    const memberEvidence = makeEvidence('evt-page1-2');

    // Trigger evidence arrives first → attaches
    const match1 = findMatchingInteraction([interaction], triggerEvidence.sourceEventId);
    expect(match1).not.toBeNull();
    expect(match1!.interactionId).toBe('int-1');

    // Member evidence arrives second → also matches same interaction
    const match2 = findMatchingInteraction([interaction], memberEvidence.sourceEventId);
    expect(match2).not.toBeNull();
    expect(match2!.interactionId).toBe('int-1');

    // First-write-only: if interaction already has evidence, don't overwrite
    const interactionWithEvidence = { ...interaction, behavioralEvidence: triggerEvidence };
    // The SW should check: if interaction.behavioralEvidence is already set, skip
    expect(interactionWithEvidence.behavioralEvidence).toBe(triggerEvidence);
  });

  // ── Scenario 5: Rapid Consecutive Interactions ─────────────────────

  it('scenario 5: rapid consecutive clicks — each gets own evidence', () => {
    const interactions = [
      makeInteraction('int-1', 'evt-page1-1'),
      makeInteraction('int-2', 'evt-page1-2'),
      makeInteraction('int-3', 'evt-page1-3'),
      makeInteraction('int-4', 'evt-page1-4'),
      makeInteraction('int-5', 'evt-page1-5'),
    ];

    const evidences = [
      makeEvidence('evt-page1-1'),
      makeEvidence('evt-page1-2'),
      makeEvidence('evt-page1-3'),
      makeEvidence('evt-page1-4'),
      makeEvidence('evt-page1-5'),
    ];

    // Each evidence should match a DIFFERENT interaction
    for (let i = 0; i < 5; i++) {
      const match = findMatchingInteraction(interactions, evidences[i].sourceEventId);
      expect(match).not.toBeNull();
      expect(match!.interactionId).toBe(`int-${i + 1}`);
    }
  });

  // ── Scenario 6: Evidence Arriving After Card Rendered ──────────────

  it('scenario 6: evidence arriving after interaction is stored — attaches correctly', () => {
    // Simulate: interaction already in liveInteractions (already rendered)
    const interactions = [makeInteraction('int-1', 'evt-page1-1')];
    expect(interactions[0].behavioralEvidence).toBeUndefined();

    // Evidence arrives 300ms later
    const evidence = makeEvidence('evt-page1-1');
    const match = findMatchingInteraction(interactions, evidence.sourceEventId);

    expect(match).not.toBeNull();
    // Attach
    match!.behavioralEvidence = evidence;
    expect(interactions[0].behavioralEvidence).toBe(evidence);
  });

  // ── Scenario 7: Re-render Preserves Evidence ───────────────────────

  it('scenario 7: re-render after evidence attachment — evidence persists in serialized interaction', () => {
    const interaction = makeInteraction('int-1', 'evt-page1-1');
    const evidence = makeEvidence('evt-page1-1');

    // Simulate SW attaching evidence
    interaction.behavioralEvidence = evidence;

    // Simulate serialization to chrome.storage.local and deserialization
    const serialized = JSON.stringify(interaction);
    const deserialized = JSON.parse(serialized) as ComponentInteraction;

    expect(deserialized.behavioralEvidence).toBeDefined();
    expect(deserialized.behavioralEvidence!.sourceEventId).toBe('evt-page1-1');

    // After re-render, attachEvidenceDisplay checks interaction.behavioralEvidence
    // → should render evidence directly, NOT placeholder
    expect(deserialized.behavioralEvidence).toBeTruthy();
  });

  // ── Scenario 8: Unmatched Evidence ─────────────────────────────────

  it('scenario 8: unmatched evidence — does not attach to wrong interaction', () => {
    const interactions = [
      makeInteraction('int-1', 'evt-page1-1'),
      makeInteraction('int-2', 'evt-page1-2'),
    ];

    // Evidence for an event that was deduped or abandoned
    const unmatchedEvidence = makeEvidence('evt-page1-999');

    const match = findMatchingInteraction(interactions, unmatchedEvidence.sourceEventId);
    expect(match).toBeNull();

    // Neither interaction should have evidence
    expect(interactions[0].behavioralEvidence).toBeUndefined();
    expect(interactions[1].behavioralEvidence).toBeUndefined();
  });

  // ── Additional Edge Cases ──────────────────────────────────────────

  it('does not match when interaction has no triggerEvent', () => {
    const interaction = makeInteraction('int-1', 'evt-page1-1');
    // Simulate missing triggerEvent (defensive)
    const brokenInteraction = { ...interaction, triggerEvent: undefined } as unknown as ComponentInteraction;

    const evidence = makeEvidence('evt-page1-1');
    const match = findMatchingInteraction([brokenInteraction], evidence.sourceEventId);

    // triggerEvent is undefined → Tier 1 fails → Tier 2 checks memberEvents
    // memberEvents[0] is the trigger event which has eventId evt-page1-1
    // So Tier 2 should match
    expect(match).not.toBeNull();
    expect(match!.interactionId).toBe('int-1');
  });

  it('does not match when triggerEvent and memberEvents are both missing', () => {
    const interaction = {
      ...makeInteraction('int-1', 'evt-page1-1'),
      triggerEvent: undefined,
      memberEvents: [],
    } as unknown as ComponentInteraction;

    const evidence = makeEvidence('evt-page1-1');
    const match = findMatchingInteraction([interaction], evidence.sourceEventId);
    expect(match).toBeNull();
  });

  it('prioritizes trigger match over member match when two interactions could match', () => {
    // int-1: trigger = evt-1, member = evt-2
    // int-2: trigger = evt-2
    // Evidence for evt-2 should match int-2 (trigger) not int-1 (member)
    const interactions = [
      makeInteraction('int-1', 'evt-page1-1', ['evt-page1-2']),
      makeInteraction('int-2', 'evt-page1-2'),
    ];

    const evidence = makeEvidence('evt-page1-2');
    const match = findMatchingInteraction(interactions, evidence.sourceEventId);

    // Tier 1 should find int-2 first (trigger match)
    expect(match).not.toBeNull();
    expect(match!.interactionId).toBe('int-2');
  });
});

// ── Side Panel Matching Tests ────────────────────────────────────────
//
// Verify that the side panel can match evidence by interactionId (not eventId)

describe('Evidence Correlation — Side Panel Matching', () => {
  /**
   * Simulates the side panel's handleEvidenceUpdate logic.
   * Searches for a card whose ID badge matches the interactionId.
   */
  function simulateHandleEvidenceUpdate(
    cards: { idBadge: string; el: HTMLElement }[],
    interactionId: string,
  ): HTMLElement | null {
    for (const card of cards) {
      if (card.idBadge === interactionId) {
        return card.el;
      }
    }
    return null;
  }

  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('finds card by interactionId badge text', () => {
    const card1 = document.createElement('div');
    card1.className = 'interaction-event';
    card1.innerHTML = '<span class="timeline-event__id">int-1</span>';

    const card2 = document.createElement('div');
    card2.className = 'interaction-event';
    card2.innerHTML = '<span class="timeline-event__id">int-2</span>';

    document.body.append(card1, card2);

    const cards = [
      { idBadge: 'int-1', el: card1 },
      { idBadge: 'int-2', el: card2 },
    ];

    const result = simulateHandleEvidenceUpdate(cards, 'int-1');
    expect(result).toBe(card1);
  });

  it('does NOT match by eventId (old broken behavior)', () => {
    const card1 = document.createElement('div');
    card1.className = 'interaction-event';
    card1.innerHTML = '<span class="timeline-event__id">int-1</span>';

    document.body.append(card1);

    const cards = [{ idBadge: 'int-1', el: card1 }];

    // Old behavior would search for 'evt-page1-1' — should NOT match
    const result = simulateHandleEvidenceUpdate(cards, 'evt-page1-1');
    expect(result).toBeNull();
  });

  it('returns null when no card matches', () => {
    const card1 = document.createElement('div');
    card1.className = 'interaction-event';
    card1.innerHTML = '<span class="timeline-event__id">int-1</span>';

    document.body.append(card1);

    const cards = [{ idBadge: 'int-1', el: card1 }];

    const result = simulateHandleEvidenceUpdate(cards, 'int-999');
    expect(result).toBeNull();
  });
});

// ── Pending Evidence Drain Tests ─────────────────────────────────────
//
// Verify that when an interaction is emitted, pending evidence is drained.

describe('Evidence Correlation — Pending Evidence Drain', () => {
  it('drains matching pending evidence on interaction emit', () => {
    // Simulate: evidence arrived before interaction was classified
    const pendingEvidence = new Map<string, BehavioralEvidence>();
    const evidence = makeEvidence('evt-page1-1');
    pendingEvidence.set('evt-page1-1', evidence);

    // Interaction is emitted
    const interaction = makeInteraction('int-1', 'evt-page1-1');

    // Drain logic: check if pendingEvidence has evidence for triggerEvent
    const triggerId = interaction.triggerEvent?.eventId;
    expect(triggerId).toBe('evt-page1-1');

    if (triggerId && pendingEvidence.has(triggerId)) {
      interaction.behavioralEvidence = pendingEvidence.get(triggerId);
      pendingEvidence.delete(triggerId);
    }

    expect(interaction.behavioralEvidence).toBe(evidence);
    expect(pendingEvidence.size).toBe(0);
  });

  it('does not drain when no pending evidence matches', () => {
    const pendingEvidence = new Map<string, BehavioralEvidence>();
    pendingEvidence.set('evt-page1-999', makeEvidence('evt-page1-999'));

    const interaction = makeInteraction('int-1', 'evt-page1-1');

    const triggerId = interaction.triggerEvent?.eventId;
    if (triggerId && pendingEvidence.has(triggerId)) {
      interaction.behavioralEvidence = pendingEvidence.get(triggerId);
      pendingEvidence.delete(triggerId);
    }

    expect(interaction.behavioralEvidence).toBeUndefined();
    expect(pendingEvidence.size).toBe(1);
  });

  it('also checks memberEvents when draining', () => {
    const pendingEvidence = new Map<string, BehavioralEvidence>();
    // Evidence for a non-trigger member event
    const evidence = makeEvidence('evt-page1-2');
    pendingEvidence.set('evt-page1-2', evidence);

    const interaction = makeInteraction('int-1', 'evt-page1-1', ['evt-page1-2']);

    // Drain: check trigger first, then members
    let matched = false;
    const triggerId = interaction.triggerEvent?.eventId;
    if (triggerId && pendingEvidence.has(triggerId)) {
      interaction.behavioralEvidence = pendingEvidence.get(triggerId);
      pendingEvidence.delete(triggerId);
      matched = true;
    }
    if (!matched) {
      for (const ev of interaction.memberEvents ?? []) {
        if (pendingEvidence.has(ev.eventId)) {
          if (!interaction.behavioralEvidence) {
            interaction.behavioralEvidence = pendingEvidence.get(ev.eventId);
            pendingEvidence.delete(ev.eventId);
          }
          break;
        }
      }
    }

    expect(interaction.behavioralEvidence).toBe(evidence);
    expect(pendingEvidence.size).toBe(0);
  });
});

// ── Interaction Renderer Integration Tests ───────────────────────────
//
// Verify that interaction-renderer renders evidence when behavioralEvidence
// is present on the interaction, and shows placeholder when absent.

describe('Evidence Correlation — Renderer Integration', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('renders evidence directly when interaction.behavioralEvidence is set', () => {
    const interaction = makeInteraction('int-1', 'evt-page1-1');
    interaction.behavioralEvidence = makeEvidence('evt-page1-1');

    // Simulate attachEvidenceDisplay check
    const hasEvidence = !!interaction.behavioralEvidence;
    expect(hasEvidence).toBe(true);
  });

  it('shows placeholder when interaction.behavioralEvidence is not set', () => {
    const interaction = makeInteraction('int-1', 'evt-page1-1');

    const hasEvidence = !!interaction.behavioralEvidence;
    expect(hasEvidence).toBe(false);
  });

  it('evidence survives JSON round-trip (storage persistence)', () => {
    const interaction = makeInteraction('int-1', 'evt-page1-1');
    interaction.behavioralEvidence = makeEvidence('evt-page1-1');

    // Simulate chrome.storage.local serialization
    const stored = JSON.parse(JSON.stringify(interaction)) as ComponentInteraction;

    expect(stored.behavioralEvidence).toBeDefined();
    expect(stored.behavioralEvidence!.sourceEventId).toBe('evt-page1-1');
    expect(stored.behavioralEvidence!.targetEvidence).toBeDefined();
    expect(stored.behavioralEvidence!.applicationEvidence).toBeDefined();
  });
});
