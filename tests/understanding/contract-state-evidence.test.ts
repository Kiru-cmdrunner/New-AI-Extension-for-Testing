/**
 * D9 — Interaction Contract State from TargetStateSnapshot Tests
 *
 * Verifies that InteractionContract state fields (disabled, checked,
 * expanded, required, optionCount) are populated from actual behavioral
 * evidence (TargetStateSnapshot / DomContext), not hardcoded defaults.
 *
 * Architecture: .drytis/specs/deterministic-defects.md §D9
 */

import { describe, it, expect } from 'vitest';
import { extractInteractionContract } from '../../src/understanding/enrichment/interaction-contract';
import type { ComponentInteraction } from '../../src/shared/component-types';
import type { BehavioralEvidence } from '../../src/shared/behavioral-evidence-types';

function makeInteraction(opts: {
  tag?: string;
  inputType?: string;
  accessibleName?: string;
  domContext?: Partial<{
    disabled: boolean;
    required: boolean;
    ariaExpanded: boolean | null;
  }>;
  targetAfter?: Partial<{
    disabled: boolean;
    checked: boolean | null;
    ariaExpanded: boolean | null;
    ariaChecked: boolean | null;
    childCount: number;
  }>;
}): ComponentInteraction {
  const id = `int-${Math.random()}`;
  const now = Date.now();
  const tag = opts.tag ?? 'BUTTON';

  const evidence = {
    sourceEventId: `evt-${id}`,
    sourceEventType: 'click',
    windowId: `bev-${id}`,
    frameId: 'main',
    window: { openedAt: now, closedAt: now + 100, durationMs: 100, endReason: 'stabilized', stabilityTrace: [] },
    targetEvidence: {
      identity: null,
      identityCapturedAt: 0,
      before: null,
      after: opts.targetAfter ?? null,
      focusMovement: null,
      changed: false,
      changeSummary: [],
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
  } as unknown as BehavioralEvidence;

  return {
    interactionId: id,
    type: 'click',
    trigger: {
      elementId: `elem-${id}`,
      accessibleName: opts.accessibleName ?? 'Test',
      ariaRole: tag.toLowerCase(),
      ariaLabel: null,
      ariaLabelledBy: null,
      placeholder: null,
      tag,
      className: null,
      name: null,
      stableId: null,
      testId: null,
      dataCy: null,
      dataQa: null,
      cssSelector: `#${id}`,
      xPath: '/html/body/button',
      inIframe: false,
      shadowDom: false,
      href: null,
      inputType: opts.inputType ?? null,
    },
    triggerEvent: {
      eventId: `evt-${id}`,
      eventType: 'click',
      timestamp: now,
      captureSeq: 0,
      isTrusted: true,
      target: {} as any,
      domContext: {
        inputType: opts.inputType ?? null,
        ariaExpanded: opts.domContext?.ariaExpanded ?? null,
        ariaHasPopup: null,
        isContentEditable: false,
        disabled: opts.domContext?.disabled ?? false,
        readOnly: false,
        required: opts.domContext?.required ?? false,
        ancestorRoles: [],
        ancestorClasses: [],
        tabIndex: null,
      },
      valueBefore: null,
      valueAfter: null,
      checkedBefore: null,
      checkedAfter: null,
    } as any,
    memberEvents: [],
    scopeKeys: new Set(),
    componentDefinition: tag,
    completionReason: 'event-matched',
    startTime: now,
    endTime: now + 100,
    behavioralEvidence: evidence,
  } as unknown as ComponentInteraction;
}

describe('D9 — Interaction Contract State from Evidence', () => {
  it('reads disabled=true from TargetStateSnapshot', () => {
    const interaction = makeInteraction({
      targetAfter: { disabled: true },
    });
    const contract = extractInteractionContract(interaction);
    expect(contract.disabled).toBe(true);
  });

  it('reads disabled=false from TargetStateSnapshot', () => {
    const interaction = makeInteraction({
      targetAfter: { disabled: false },
    });
    const contract = extractInteractionContract(interaction);
    expect(contract.disabled).toBe(false);
  });

  it('falls back to domContext.disabled when no TargetStateSnapshot', () => {
    const interaction = makeInteraction({
      domContext: { disabled: true },
    });
    const contract = extractInteractionContract(interaction);
    expect(contract.disabled).toBe(true);
  });

  it('defaults to false when no evidence available', () => {
    const interaction = makeInteraction({});
    const contract = extractInteractionContract(interaction);
    expect(contract.disabled).toBe(false);
  });

  it('reads checked=true from TargetStateSnapshot.checked', () => {
    const interaction = makeInteraction({
      tag: 'INPUT',
      inputType: 'checkbox',
      targetAfter: { checked: true },
    });
    const contract = extractInteractionContract(interaction);
    expect(contract.checked).toBe(true);
  });

  it('reads checked from ariaChecked when checked is null', () => {
    const interaction = makeInteraction({
      tag: 'DIV',
      targetAfter: { ariaChecked: true },
    });
    const contract = extractInteractionContract(interaction);
    expect(contract.checked).toBe(true);
  });

  it('reads expanded from TargetStateSnapshot.ariaExpanded', () => {
    const interaction = makeInteraction({
      targetAfter: { ariaExpanded: true },
    });
    const contract = extractInteractionContract(interaction);
    expect(contract.expanded).toBe(true);
  });

  it('falls back to domContext.ariaExpanded when no TargetStateSnapshot', () => {
    const interaction = makeInteraction({
      domContext: { ariaExpanded: false },
    });
    const contract = extractInteractionContract(interaction);
    expect(contract.expanded).toBe(false);
  });

  it('reads required from domContext.required (actual DOM attribute)', () => {
    const interaction = makeInteraction({
      tag: 'INPUT',
      inputType: 'text',
      domContext: { required: true },
    });
    const contract = extractInteractionContract(interaction);
    expect(contract.required).toBe(true);
  });

  it('reads optionCount from TargetStateSnapshot.childCount for select elements', () => {
    const interaction = makeInteraction({
      tag: 'SELECT',
      targetAfter: { childCount: 5 },
    });
    const contract = extractInteractionContract(interaction);
    expect(contract.optionCount).toBe(5);
  });

  it('optionCount is null for non-select elements even with childCount', () => {
    const interaction = makeInteraction({
      tag: 'DIV',
      targetAfter: { childCount: 10 },
    });
    const contract = extractInteractionContract(interaction);
    expect(contract.optionCount).toBeNull();
  });

  it('domContext.required=false takes precedence over heuristic', () => {
    const interaction = makeInteraction({
      tag: 'INPUT',
      inputType: 'text',
      accessibleName: 'Email Address (required)',
      domContext: { required: false },
    });
    const contract = extractInteractionContract(interaction);
    // domContext.required is the actual DOM attribute → false wins over heuristic
    expect(contract.required).toBe(false);
  });

  it('heuristic used when domContext is absent', () => {
    // No domContext at all — synthetic interaction
    const interaction = makeInteraction({
      tag: 'INPUT',
      inputType: 'text',
      accessibleName: 'Email Address (required)',
    });
    // Remove triggerEvent so domContext can't be read
    (interaction as any).triggerEvent = undefined;
    const contract = extractInteractionContract(interaction);
    expect(contract.required).toBe(true);
  });
});
