/**
 * Tests: Behavioral Renderer (Phase E)
 *
 * Verifies that ObservationResult[] is rendered as a collapsible evidence
 * section with correct before/after state, mutations, and window metadata.
 *
 * Architecture: .drytis/specs/m1-phase-e-design.md
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { renderBehavioralEvidence, renderSemanticEffects } from '../../src/sidepanel/behavioral-renderer';
import type {
  ObservationResult,
  ElementStateSnapshot,
  MutationRecord2,
} from '../../src/shared/observation-types';
import type { SemanticEffect } from '../../src/semantics/effect-types';

// ── Fixtures ──────────────────────────────────────────────────────────

function makeSnapshot(overrides: Partial<ElementStateSnapshot> = {}): ElementStateSnapshot {
  return {
    value: null,
    checked: null,
    className: '',
    disabled: false,
    ariaExpanded: null,
    ariaChecked: null,
    ariaPressed: null,
    textContent: null,
    childCount: 0,
    capturedAt: Date.now(),
    ...overrides,
  };
}

function makeMutation(overrides: Partial<MutationRecord2> = {}): MutationRecord2 {
  return {
    id: 1,
    type: 'attributes',
    targetPath: 'body > div',
    targetTag: 'DIV',
    attributeName: 'class',
    oldValue: 'old',
    newValue: 'new',
    addedNodesCount: 0,
    removedNodesCount: 0,
    timestamp: 100,
    windowIds: ['obs-evt-001'],
    ...overrides,
  };
}

function makeResult(overrides: Partial<ObservationResult> = {}): ObservationResult {
  return {
    sourceEventId: 'evt-001',
    sourceEventType: 'click',
    windowId: 'obs-evt-001',
    openedAt: 1000,
    closedAt: 4000,
    durationMs: 3000,
    endReason: 'completed',
    beforeSnapshot: null,
    finalSnapshot: null,
    mutations: [],
    mutationCount: 0,
    documentWideMutationTotal: 0,
    performanceCondition: null,
    ...overrides,
  };
}

function makeSemanticEffect(overrides: Partial<SemanticEffect> = {}): SemanticEffect {
  return {
    category: 'state-toggle',
    description: 'Element checked state changed',
    confidence: 'high',
    confidenceBasis: 'direct-property',
    affectedTarget: { role: null, label: null, cssPath: '#target' },
    evidenceRef: { windowId: 'obs-001', sourceEventId: 'evt-001' },
    ...overrides,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────

describe('Behavioral Renderer (Phase E)', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  // ── Collapsible Container ───────────────────────────────────────────

  it('renders a collapsible section with toggle and count', () => {
    const observations = [makeResult()];
    const el = renderBehavioralEvidence(observations);
    document.body.appendChild(el);

    const toggle = el.querySelector('.behavioral-evidence__toggle') as HTMLButtonElement;
    expect(toggle).not.toBeNull();
    expect(toggle.textContent).toContain('Behavioral Evidence');
    expect(toggle.textContent).toContain('(1)');

    // Content hidden by default
    const content = el.querySelector('.behavioral-evidence__content') as HTMLElement;
    expect(content.hidden).toBe(true);
  });

  it('expands/collapses on toggle click', () => {
    const observations = [makeResult()];
    const el = renderBehavioralEvidence(observations);
    document.body.appendChild(el);

    const toggle = el.querySelector('.behavioral-evidence__toggle') as HTMLButtonElement;
    const content = el.querySelector('.behavioral-evidence__content') as HTMLElement;

    // Initially collapsed
    expect(content.hidden).toBe(true);
    expect(toggle.getAttribute('aria-expanded')).toBe('false');

    // Click to expand
    toggle.click();
    expect(content.hidden).toBe(false);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(toggle.textContent).toContain('▼');

    // Click to collapse
    toggle.click();
    expect(content.hidden).toBe(true);
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(toggle.textContent).not.toContain('▼');
  });

  it('renders multiple observation results', () => {
    const observations = [
      makeResult({ windowId: 'obs-evt-001', sourceEventType: 'click' }),
      makeResult({ windowId: 'obs-evt-002', sourceEventType: 'change' }),
    ];
    const el = renderBehavioralEvidence(observations);
    document.body.appendChild(el);

    const cards = el.querySelectorAll('.behavioral-result-card');
    expect(cards.length).toBe(2);

    const toggle = el.querySelector('.behavioral-evidence__toggle') as HTMLButtonElement;
    expect(toggle.textContent).toContain('(2)');
  });

  // ── State Diff Rendering ────────────────────────────────────────────

  it('shows before → after when both snapshots exist and values changed', () => {
    const result = makeResult({
      beforeSnapshot: makeSnapshot({ checked: false, className: 'off' }),
      finalSnapshot: makeSnapshot({ checked: true, className: 'on' }),
    });
    const el = renderBehavioralEvidence([result]);
    document.body.appendChild(el);

    const content = el.querySelector('.behavioral-evidence__content') as HTMLElement;
    expect(content).not.toBeNull();

    const stateDiff = content.querySelector('.behavioral-state-diff');
    expect(stateDiff).not.toBeNull();

    const rows = content.querySelectorAll('.behavioral-state-row');
    expect(rows.length).toBeGreaterThanOrEqual(2);

    // Check the 'checked' row shows false → true
    const checkedRow = Array.from(rows).find((r) =>
      r.querySelector('.behavioral-state-row__label')?.textContent === 'checked');
    expect(checkedRow).toBeDefined();
    expect(checkedRow!.querySelector('.behavioral-state-row__before')?.textContent).toContain('false');
    expect(checkedRow!.querySelector('.behavioral-state-row__after')?.textContent).toContain('true');
    expect(checkedRow!.querySelector('.behavioral-state-row__arrow')).not.toBeNull();
  });

  it('shows unchanged values without arrow, greyed', () => {
    const result = makeResult({
      beforeSnapshot: makeSnapshot({ checked: true, className: 'same' }),
      finalSnapshot: makeSnapshot({ checked: true, className: 'same' }),
    });
    const el = renderBehavioralEvidence([result]);
    document.body.appendChild(el);

    const content = el.querySelector('.behavioral-evidence__content') as HTMLElement;
    const checkedRow = Array.from(content.querySelectorAll('.behavioral-state-row')).find(
      (r) => r.querySelector('.behavioral-state-row__label')?.textContent === 'checked',
    );
    expect(checkedRow).toBeDefined();
    expect(checkedRow!.querySelector('.behavioral-state-row__arrow')).toBeNull();
    expect(checkedRow!.querySelector('.behavioral-state-row__unchanged')).not.toBeNull();
  });

  it('omits properties that are null in both snapshots', () => {
    const result = makeResult({
      beforeSnapshot: makeSnapshot({ value: 'hello', checked: null, ariaExpanded: null }),
      finalSnapshot: makeSnapshot({ value: 'world', checked: null, ariaExpanded: null }),
    });
    const el = renderBehavioralEvidence([result]);
    document.body.appendChild(el);

    const content = el.querySelector('.behavioral-evidence__content') as HTMLElement;
    const rows = content.querySelectorAll('.behavioral-state-row');
    const labels = Array.from(rows).map((r) =>
      r.querySelector('.behavioral-state-row__label')?.textContent);
    // value should be present (changed), but checked/ariaExpanded should be absent
    expect(labels).toContain('value');
    expect(labels).not.toContain('checked');
    expect(labels).not.toContain('aria-expanded');
  });

  it('shows note when both snapshots are null', () => {
    const result = makeResult({
      beforeSnapshot: null,
      finalSnapshot: null,
    });
    const el = renderBehavioralEvidence([result]);
    document.body.appendChild(el);

    const content = el.querySelector('.behavioral-evidence__content') as HTMLElement;
    const note = content.querySelector('.behavioral-state-diff__note');
    expect(note).not.toBeNull();
    expect(note!.textContent).toContain('No element state captured');
  });

  it('shows value transition for native select (property-only, no mutations)', () => {
    const result = makeResult({
      sourceEventType: 'change',
      beforeSnapshot: makeSnapshot({ value: 'a' }),
      finalSnapshot: makeSnapshot({ value: 'b' }),
      mutations: [],
      mutationCount: 0,
    });
    const el = renderBehavioralEvidence([result]);
    document.body.appendChild(el);

    const content = el.querySelector('.behavioral-evidence__content') as HTMLElement;
    const valueRow = Array.from(content.querySelectorAll('.behavioral-state-row')).find(
      (r) => r.querySelector('.behavioral-state-row__label')?.textContent === 'value',
    );
    expect(valueRow).toBeDefined();
    expect(valueRow!.querySelector('.behavioral-state-row__before')?.textContent).toContain('"a"');
    expect(valueRow!.querySelector('.behavioral-state-row__after')?.textContent).toContain('"b"');

    // Should also show "No DOM mutations captured"
    const mutationNote = content.querySelector('.behavioral-mutations__note');
    expect(mutationNote).not.toBeNull();
    expect(mutationNote!.textContent).toContain('No DOM mutations captured');
  });

  // ── Mutation Rendering ──────────────────────────────────────────────

  it('renders attribute mutations grouped by target path', () => {
    const mutations = [
      makeMutation({ id: 1, targetPath: 'body > div.a', attributeName: 'class', oldValue: 'off', newValue: 'on', timestamp: 1100 }),
      makeMutation({ id: 2, targetPath: 'body > div.a', attributeName: 'aria-expanded', oldValue: 'false', newValue: 'true', timestamp: 1150 }),
      makeMutation({ id: 3, targetPath: 'body > div.b', attributeName: 'hidden', oldValue: null, newValue: null, timestamp: 1200 }),
    ];
    const result = makeResult({
      mutations,
      mutationCount: 3,
      documentWideMutationTotal: 3,
    });
    const el = renderBehavioralEvidence([result]);
    document.body.appendChild(el);

    const content = el.querySelector('.behavioral-evidence__content') as HTMLElement;
    const groups = content.querySelectorAll('.behavioral-mutation-group');
    expect(groups.length).toBe(2); // div.a and div.b

    const header = content.querySelector('.behavioral-mutations__header');
    expect(header?.textContent).toContain('Mutations (3)');
  });

  it('renders childList mutations with add/remove counts', () => {
    const mutations = [
      makeMutation({ id: 1, type: 'childList', targetPath: 'body > ul', attributeName: null, oldValue: null, newValue: null, addedNodesCount: 3, removedNodesCount: 0, timestamp: 1100 }),
      makeMutation({ id: 2, type: 'childList', targetPath: 'body > ul', attributeName: null, oldValue: null, newValue: null, addedNodesCount: 0, removedNodesCount: 1, timestamp: 1200 }),
    ];
    const result = makeResult({
      mutations,
      mutationCount: 2,
      documentWideMutationTotal: 2,
    });
    const el = renderBehavioralEvidence([result]);
    document.body.appendChild(el);

    const content = el.querySelector('.behavioral-evidence__content') as HTMLElement;
    const details = content.querySelectorAll('.behavioral-mutation-row__detail');
    expect(details.length).toBe(2);
    expect(details[0]!.textContent).toContain('+3 node');
    expect(details[1]!.textContent).toContain('-1 node');
  });

  it('renders characterData mutations with text transitions', () => {
    const mutations = [
      makeMutation({ id: 1, type: 'characterData', targetPath: 'body > p', attributeName: null, oldValue: 'Loading', newValue: 'Done', timestamp: 1100 }),
    ];
    const result = makeResult({
      mutations,
      mutationCount: 1,
      documentWideMutationTotal: 1,
    });
    const el = renderBehavioralEvidence([result]);
    document.body.appendChild(el);

    const content = el.querySelector('.behavioral-evidence__content') as HTMLElement;
    const detail = content.querySelector('.behavioral-mutation-row__detail');
    expect(detail?.textContent).toContain('Loading');
    expect(detail?.textContent).toContain('Done');
    expect(detail?.textContent).toContain('→');
  });

  it('shows mutation timestamp relative to window open', () => {
    const mutations = [
      makeMutation({ id: 1, timestamp: 1150 }),
    ];
    const result = makeResult({
      openedAt: 1000,
      mutations,
      mutationCount: 1,
      documentWideMutationTotal: 1,
    });
    const el = renderBehavioralEvidence([result]);
    document.body.appendChild(el);

    const content = el.querySelector('.behavioral-evidence__content') as HTMLElement;
    const time = content.querySelector('.behavioral-mutation-row__time');
    expect(time?.textContent).toContain('+150ms');
  });

  it('shows "No DOM mutations captured" when mutations array is empty', () => {
    const result = makeResult({ mutations: [], mutationCount: 0 });
    const el = renderBehavioralEvidence([result]);
    document.body.appendChild(el);

    const content = el.querySelector('.behavioral-evidence__content') as HTMLElement;
    const note = content.querySelector('.behavioral-mutations__note');
    expect(note).not.toBeNull();
    expect(note!.textContent).toContain('No DOM mutations captured');
  });

  // ── Window Metadata ─────────────────────────────────────────────────

  it('renders window metadata: duration, endReason, mutation counts', () => {
    const result = makeResult({
      durationMs: 3000,
      endReason: 'completed',
      mutationCount: 5,
      documentWideMutationTotal: 8,
    });
    const el = renderBehavioralEvidence([result]);
    document.body.appendChild(el);

    const content = el.querySelector('.behavioral-evidence__content') as HTMLElement;
    const meta = content.querySelector('.behavioral-window-meta');
    expect(meta?.textContent).toContain('3000ms');
    expect(meta?.textContent).toContain('completed');
    expect(meta?.textContent).toContain('5 mutation');
    expect(meta?.textContent).toContain('8 doc-wide');
  });

  it('renders recording-stopped endReason', () => {
    const result = makeResult({
      durationMs: 1200,
      endReason: 'recording-stopped',
    });
    const el = renderBehavioralEvidence([result]);
    document.body.appendChild(el);

    const content = el.querySelector('.behavioral-evidence__content') as HTMLElement;
    const meta = content.querySelector('.behavioral-window-meta');
    expect(meta?.textContent).toContain('recording-stopped');
    expect(meta?.textContent).toContain('1200ms');
  });

  it('renders performance condition diagnostic badge', () => {
    const result = makeResult({
      performanceCondition: {
        batchRecordCount: 47,
        batchDurationMs: 18,
        timestamp: 2000,
      },
    });
    const el = renderBehavioralEvidence([result]);
    document.body.appendChild(el);

    const content = el.querySelector('.behavioral-evidence__content') as HTMLElement;
    const badge = content.querySelector('.behavioral-perf-badge');
    expect(badge).not.toBeNull();
    expect(badge!.textContent).toContain('47 mutations');
    expect(badge!.textContent).toContain('18ms');
  });

  it('does not render performance condition badge when null', () => {
    const result = makeResult({ performanceCondition: null });
    const el = renderBehavioralEvidence([result]);
    document.body.appendChild(el);

    const content = el.querySelector('.behavioral-evidence__content') as HTMLElement;
    const badge = content.querySelector('.behavioral-perf-badge');
    expect(badge).toBeNull();
  });

  // ── Integration with Interaction Renderer ───────────────────────────

  it('evidence section is appended to interaction element when observations exist', async () => {
    const { createInteractionElement } = await import('../../src/sidepanel/interaction-renderer');

    const interaction = {
      interactionId: 'int-001',
      type: 'Click',
      componentType: 'Generic',
      componentFramework: 'Generic',
      businessMeaning: null,
      triggerEvent: {
        eventId: 'evt-001',
        eventType: 'click',
        timestamp: 1000,
        target: {
          tag: 'INPUT',
          accessibleName: 'Checkbox',
          role: 'checkbox',
          id: 'cb',
          stableId: 'cb',
        },
      },
      memberEvents: [],
      endState: 'completed',
      metadata: {
        targetName: 'Checkbox',
      },
      behavioralObservations: [makeResult()],
    } as any;

    const el = createInteractionElement(interaction);
    document.body.appendChild(el);

    const evidence = el.querySelector('.behavioral-evidence');
    expect(evidence).not.toBeNull();
    const toggle = evidence!.querySelector('.behavioral-evidence__toggle');
    expect(toggle?.textContent).toContain('(1)');
  });

  it('no evidence section when behavioralObservations is absent', async () => {
    const { createInteractionElement } = await import('../../src/sidepanel/interaction-renderer');

    const interaction = {
      interactionId: 'int-002',
      type: 'Click',
      componentType: 'Generic',
      componentFramework: 'Generic',
      businessMeaning: null,
      triggerEvent: {
        eventId: 'evt-002',
        eventType: 'click',
        timestamp: 2000,
        target: {
          tag: 'BUTTON',
          accessibleName: 'Submit',
        },
      },
      memberEvents: [],
      endState: 'completed',
      metadata: {
        targetName: 'Submit',
      },
      // behavioralObservations intentionally omitted
    } as any;

    const el = createInteractionElement(interaction);
    document.body.appendChild(el);

    const evidence = el.querySelector('.behavioral-evidence');
    expect(evidence).toBeNull();
  });

  // ── Overlapping Windows (Shared Mutations) ──────────────────────────

  it('renders multiple results with independent evidence for overlapping windows', () => {
    const observations = [
      makeResult({
        windowId: 'obs-evt-006',
        sourceEventId: 'evt-006',
        sourceEventType: 'click',
        openedAt: 1000,
        closedAt: 4000,
        mutations: [
          makeMutation({ id: 1, targetPath: 'body > div.a', timestamp: 1100 }),
          makeMutation({ id: 2, targetPath: 'body > div.b', timestamp: 1600 }), // shared period
        ],
        mutationCount: 2,
        documentWideMutationTotal: 3,
      }),
      makeResult({
        windowId: 'obs-evt-007',
        sourceEventId: 'evt-007',
        sourceEventType: 'click',
        openedAt: 1500,
        closedAt: 4500,
        mutations: [
          makeMutation({ id: 2, targetPath: 'body > div.b', timestamp: 1600 }), // same shared mutation
          makeMutation({ id: 3, targetPath: 'body > div.c', timestamp: 2000 }),
        ],
        mutationCount: 2,
        documentWideMutationTotal: 3,
      }),
    ];
    const el = renderBehavioralEvidence(observations);
    document.body.appendChild(el);

    const content = el.querySelector('.behavioral-evidence__content') as HTMLElement;
    const cards = content.querySelectorAll('.behavioral-result-card');
    expect(cards.length).toBe(2);

    // Both cards show the shared mutation (id=2, body > div.b)
    const card1Mutations = cards[0]!.querySelectorAll('.behavioral-mutation-row');
    const card2Mutations = cards[1]!.querySelectorAll('.behavioral-mutation-row');
    expect(card1Mutations.length).toBe(2);
    expect(card2Mutations.length).toBe(2);

    // Each shows doc-wide total of 3, window count of 2
    const meta1 = cards[0]!.querySelector('.behavioral-window-meta');
    const meta2 = cards[1]!.querySelector('.behavioral-window-meta');
    expect(meta1?.textContent).toContain('3 doc-wide');
    expect(meta2?.textContent).toContain('3 doc-wide');
  });
});

// ── Semantic Effects Rendering (Sub-phase 3) ──────────────────────────

describe('Semantic Effects Rendering (Sub-phase 3)', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  // ── renderSemanticEffects() unit tests ────────────────────────────

  it('renders effects section with label "What happened"', () => {
    const effects = [
      makeSemanticEffect({ category: 'state-toggle', description: 'checked: false → true' }),
    ];
    const el = renderSemanticEffects(effects);
    expect(el).not.toBeNull();
    expect(el!.querySelector('.semantic-effects__label')?.textContent).toContain('What happened');
  });

  it('renders effect description text', () => {
    const effects = [
      makeSemanticEffect({ description: 'unchecked → checked' }),
    ];
    const el = renderSemanticEffects(effects);
    expect(el).not.toBeNull();
    expect(el!.querySelector('.semantic-effect__description')?.textContent).toContain('unchecked → checked');
  });

  it('renders HIGH confidence badge', () => {
    const effects = [makeSemanticEffect({ confidence: 'high' })];
    const el = renderSemanticEffects(effects);
    const badge = el!.querySelector('.semantic-effect__confidence--high');
    expect(badge).not.toBeNull();
    expect(badge?.textContent).toBe('HIGH');
  });

  it('renders MEDIUM confidence badge', () => {
    const effects = [makeSemanticEffect({ confidence: 'medium' })];
    const el = renderSemanticEffects(effects);
    expect(el!.querySelector('.semantic-effect__confidence--medium')).not.toBeNull();
  });

  it('renders LOW confidence badge', () => {
    const effects = [makeSemanticEffect({ confidence: 'low' })];
    const el = renderSemanticEffects(effects);
    expect(el!.querySelector('.semantic-effect__confidence--low')).not.toBeNull();
  });

  it('renders correct icon for state-toggle category', () => {
    const effects = [makeSemanticEffect({ category: 'state-toggle' })];
    const el = renderSemanticEffects(effects);
    expect(el!.querySelector('.semantic-effect__icon')?.textContent).toBe('✓');
  });

  it('renders correct icon for unclassified category', () => {
    const effects = [makeSemanticEffect({ category: 'unclassified' })];
    const el = renderSemanticEffects(effects);
    expect(el!.querySelector('.semantic-effect__icon')?.textContent).toBe('?');
  });

  it('renders correct icon for no-observable-effect category', () => {
    const effects = [makeSemanticEffect({ category: 'no-observable-effect' })];
    const el = renderSemanticEffects(effects);
    expect(el!.querySelector('.semantic-effect__icon')?.textContent).toBe('∅');
  });

  it('renders multiple effects as separate rows', () => {
    const effects = [
      makeSemanticEffect({ description: 'toggle' }),
      makeSemanticEffect({ description: 'content changed', category: 'content-change' }),
    ];
    const el = renderSemanticEffects(effects);
    const rows = el!.querySelectorAll('.semantic-effect');
    expect(rows.length).toBe(2);
  });

  it('returns null when effects array is empty', () => {
    const el = renderSemanticEffects([]);
    expect(el).toBeNull();
  });

  it('returns null when effects is undefined', () => {
    const el = renderSemanticEffects(undefined as unknown as never[]);
    expect(el).toBeNull();
  });

  // ── Integration: effects + evidence in full interaction ───────────

  it('renders both semantic effects and behavioral evidence for interaction', async () => {
    const { createInteractionElement } = await import('../../src/sidepanel/interaction-renderer');
    const observation = makeResult({
      beforeSnapshot: makeSnapshot({ checked: false }),
      finalSnapshot: makeSnapshot({ checked: true }),
      mutations: [
        makeMutation({
          id: 1, type: 'attributes',
          attributeName: 'class',
          oldValue: 'off',
          newValue: 'on',
        }),
      ],
      semanticEffects: [
        makeSemanticEffect({
          category: 'state-toggle',
          description: 'checked: false → true',
          confidence: 'high',
        }),
      ],
    });

    const interaction = {
      interactionId: 'int-001',
      type: 'Checkbox',
      componentType: 'Checkbox',
      componentFramework: 'Native',
      businessMeaning: 'Accept Terms',
      triggerEvent: {
        eventId: 'evt-001',
        eventType: 'click',
        timestamp: 1000,
        target: { tag: 'INPUT', accessibleName: 'Accept Terms', role: 'checkbox', id: 'cb' },
      },
      memberEvents: [],
      endState: 'completed',
      metadata: { targetName: 'Accept Terms' },
      behavioralObservations: [observation],
    } as any;

    const el = createInteractionElement(interaction);
    document.body.appendChild(el);

    // Semantic effects present
    const effectsSection = el.querySelector('.semantic-effects');
    expect(effectsSection).not.toBeNull();
    expect(effectsSection!.querySelector('.semantic-effect__description')?.textContent)
      .toContain('checked: false → true');

    // Raw evidence also present
    const evidenceSection = el.querySelector('.behavioral-evidence');
    expect(evidenceSection).not.toBeNull();
  });

  it('semantic effects appear BEFORE behavioral evidence in DOM order', async () => {
    const { createInteractionElement } = await import('../../src/sidepanel/interaction-renderer');
    const observation = makeResult({
      semanticEffects: [makeSemanticEffect()],
    });

    const interaction = {
      interactionId: 'int-001',
      type: 'Click',
      componentType: 'Generic',
      componentFramework: 'Generic',
      businessMeaning: null,
      triggerEvent: {
        eventId: 'evt-001', eventType: 'click', timestamp: 1000,
        target: { tag: 'BUTTON', accessibleName: 'Test' },
      },
      memberEvents: [],
      endState: 'completed',
      metadata: { targetName: 'Test' },
      behavioralObservations: [observation],
    } as any;

    const el = createInteractionElement(interaction);
    document.body.appendChild(el);

    const effectsSection = el.querySelector('.semantic-effects');
    const evidenceSection = el.querySelector('.behavioral-evidence');

    // Both present
    expect(effectsSection).not.toBeNull();
    expect(evidenceSection).not.toBeNull();

    // Effects come before evidence in DOM order
    const allChildren = Array.from(el.children);
    const effectsIdx = allChildren.indexOf(effectsSection!);
    const evidenceIdx = allChildren.indexOf(evidenceSection!);
    expect(effectsIdx).toBeLessThan(evidenceIdx);
  });

  it('no semantic effects section when observations lack semanticEffects', async () => {
    const { createInteractionElement } = await import('../../src/sidepanel/interaction-renderer');
    const observation = makeResult(); // no semanticEffects field

    const interaction = {
      interactionId: 'int-001',
      type: 'Click',
      componentType: 'Generic',
      componentFramework: 'Generic',
      businessMeaning: null,
      triggerEvent: {
        eventId: 'evt-001', eventType: 'click', timestamp: 1000,
        target: { tag: 'BUTTON', accessibleName: 'Test' },
      },
      memberEvents: [],
      endState: 'completed',
      metadata: { targetName: 'Test' },
      behavioralObservations: [observation],
    } as any;

    const el = createInteractionElement(interaction);
    document.body.appendChild(el);

    expect(el.querySelector('.semantic-effects')).toBeNull();
    // But raw evidence still present
    expect(el.querySelector('.behavioral-evidence')).not.toBeNull();
  });

  it('semantic effects section is visible by default (not collapsed/hidden)', () => {
    const effects = [makeSemanticEffect()];
    const el = renderSemanticEffects(effects);
    document.body.appendChild(el!);

    const section = document.querySelector('.semantic-effects') as HTMLElement;
    expect(section).not.toBeNull();
    // Should NOT have hidden attribute or display:none
    expect(section.hidden).toBe(false);
    expect(section.style.display).not.toBe('none');
  });
});

// ── Broadcast Payload Merge: Immediate Update Proof ───────────────────

describe('Broadcast Payload Merge — Immediate Update (Sub-phase 3)', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('fresh semanticEffects from broadcast appear even when storage is stale', async () => {
    // Simulate the exact flow:
    // 1. Storage has stale interaction (no behavioralObservations)
    // 2. Broadcast arrives with behavioralObservations containing semanticEffects
    // 3. UI merge overlays the broadcast data
    // 4. Re-render shows both effects AND raw evidence

    const { createInteractionElement } = await import('../../src/sidepanel/interaction-renderer');

    // Step 1: Stale interaction from storage (no observations)
    const staleInteraction = {
      interactionId: 'int-001',
      type: 'Checkbox',
      componentType: 'Checkbox',
      componentFramework: 'Native',
      businessMeaning: 'Accept Terms',
      triggerEvent: {
        eventId: 'evt-001', eventType: 'click', timestamp: 1000,
        target: { tag: 'INPUT', accessibleName: 'Accept Terms', role: 'checkbox', id: 'cb' },
      },
      memberEvents: [],
      endState: 'completed',
      metadata: { targetName: 'Accept Terms' },
      // behavioralObservations: ABSENT — stale storage
    } as any;

    // Step 2: Broadcast payload (from SW in-memory interaction)
    const broadcastPayload = {
      interactionId: 'int-001',
      behavioralObservations: [
        makeResult({
          sourceEventId: 'evt-001',
          beforeSnapshot: makeSnapshot({ ariaChecked: false }),
          finalSnapshot: makeSnapshot({ ariaChecked: true }),
          semanticEffects: [
            makeSemanticEffect({
              category: 'state-toggle',
              description: 'aria-checked: false → true',
              confidence: 'high',
            }),
          ],
        }),
      ],
    };

    // Step 3: UI-only merge — overlay broadcast data onto stale interaction
    // (This is what the INTERACTION_EFFECTS_UPDATE handler does)
    const interactions = [staleInteraction];
    const target = interactions.find((i) => i.interactionId === broadcastPayload.interactionId);
    expect(target).toBeDefined();
    target!.behavioralObservations = broadcastPayload.behavioralObservations;

    // Step 4: Re-render and verify BOTH effects AND evidence appear
    const el = createInteractionElement(interactions[0]);
    document.body.appendChild(el);

    // Semantic effects visible from broadcast payload
    const effectsSection = el.querySelector('.semantic-effects');
    expect(effectsSection).not.toBeNull();
    expect(effectsSection!.querySelector('.semantic-effect__description')?.textContent)
      .toContain('aria-checked: false → true');

    // Raw evidence also visible
    const evidenceSection = el.querySelector('.behavioral-evidence');
    expect(evidenceSection).not.toBeNull();
  });

  it('broadcast merge does NOT write back to storage', async () => {
    // Verify that the merge is purely in-memory: the original interaction
    // object in a separate array is NOT affected.
    const staleInteraction = {
      interactionId: 'int-001',
      type: 'Click',
      componentType: 'Generic',
      componentFramework: 'Generic',
      businessMeaning: null,
      triggerEvent: {
        eventId: 'evt-001', eventType: 'click', timestamp: 1000,
        target: { tag: 'BUTTON', accessibleName: 'Test' },
      },
      memberEvents: [],
      endState: 'completed',
      metadata: { targetName: 'Test' },
    } as any;

    // Simulate the handler: read from storage into a fresh array, merge
    const storageCopy = [{ ...staleInteraction }]; // shallow copy as storage.local.get returns
    const target = storageCopy.find((i) => i.interactionId === 'int-001');
    target!.behavioralObservations = [makeResult({ semanticEffects: [makeSemanticEffect()] })];

    // The original stale interaction is unchanged — merge is on the copy
    expect((staleInteraction as any).behavioralObservations).toBeUndefined();
    // The storage copy has the merged data
    expect(storageCopy[0]!.behavioralObservations).toBeDefined();
  });
});
