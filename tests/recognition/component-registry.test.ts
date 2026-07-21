/**
 * Component Registry — unit tests.
 *
 * Tests identity resolution, merge logic, evidence accumulation,
 * lifecycle progression, and rejection.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  ComponentRegistry,
  createEvidence,
  resolveIdentity,
  mergeRecognition,
  shouldReject,
  CONTRADICTION_THRESHOLD,
  type EvidenceEntry,
  type EvidenceDisposition,
} from '../../src/recorder/recognition/component-registry';
import {
  PatternType,
  ComponentRole,
  RecognitionSource,
  ComponentLifecycleState,
} from '../../src/domain/enums';
import {
  createComponentGrouping,
  addConstituent,
  rejectComponent,
  type ComponentGrouping,
} from '../../src/domain/entities/component-grouping';
import type { RecognitionResult } from '../../src/recorder/recognition/structural-recognizer';

// ── Helpers ──────────────────────────────────────────────

function mkResult(
  overrides: Partial<RecognitionResult> & { rootElementId: string; patternType: PatternType },
): RecognitionResult {
  return {
    patternType: overrides.patternType,
    rootElementId: overrides.rootElementId,
    constituents: overrides.constituents ?? [
      { elementId: overrides.rootElementId, role: ComponentRole.TRIGGER },
    ],
    confidence: overrides.confidence ?? 0.75,
    recognitionSource: overrides.recognitionSource ?? RecognitionSource.BEHAVIORAL,
    matchedRole: overrides.matchedRole ?? null,
    reason: overrides.reason ?? 'test',
  };
}

function mkComponent(
  overrides: Partial<ComponentGrouping> & { rootElementId: string; patternType: PatternType },
): ComponentGrouping {
  let component = createComponentGrouping({
    groupingId: overrides.groupingId ?? 'comp-test',
    patternType: overrides.patternType,
    rootElementId: overrides.rootElementId,
    constituents: overrides.constituents ?? [
      { elementId: overrides.rootElementId, role: ComponentRole.TRIGGER },
    ],
    recognitionSource: overrides.recognitionSource ?? RecognitionSource.BEHAVIORAL,
    recognitionConfidence: overrides.recognitionConfidence ?? 0.75,
  });

  // Apply lifecycle state overrides (factory always starts TENTATIVE)
  if (overrides.lifecycleState === ComponentLifecycleState.REJECTED) {
    component = rejectComponent(component);
  }

  return component;
}

// ── Evidence Entry Tests ─────────────────────────────────

describe('EvidenceEntry', () => {
  it('should create evidence with all fields', () => {
    const e = createEvidence(
      RecognitionSource.STRUCTURAL,
      'supporting',
      'ARIA role matched',
    );
    expect(e.source).toBe(RecognitionSource.STRUCTURAL);
    expect(e.disposition).toBe('supporting');
    expect(e.description).toBe('ARIA role matched');
    expect(e.timestamp).toBeGreaterThan(0);
  });

  it('should reject empty description', () => {
    expect(() =>
      createEvidence(RecognitionSource.BEHAVIORAL, 'neutral', ''),
    ).toThrow();
    expect(() =>
      createEvidence(RecognitionSource.BEHAVIORAL, 'neutral', '   '),
    ).toThrow();
  });
});

// ── Identity Resolution Tests ────────────────────────────

describe('resolveIdentity', () => {
  it('should match by exact root element', () => {
    const component = mkComponent({
      rootElementId: 'elem-1',
      patternType: PatternType.DROPDOWN,
    });
    const result = mkResult({
      rootElementId: 'elem-1',
      patternType: PatternType.DROPDOWN,
    });

    const match = resolveIdentity(result, [component]);
    expect(match?.groupingId).toBe(component.groupingId);
  });

  it('should match when result root is a constituent of existing component', () => {
    const component = mkComponent({
      rootElementId: 'root-elem',
      patternType: PatternType.DROPDOWN,
      constituents: [
        { elementId: 'root-elem', role: ComponentRole.TRIGGER },
        { elementId: 'child-elem', role: ComponentRole.OPTION },
      ],
    });
    const result = mkResult({
      rootElementId: 'child-elem',
      patternType: PatternType.DROPDOWN,
      constituents: [{ elementId: 'child-elem', role: ComponentRole.OPTION }],
    });

    const match = resolveIdentity(result, [component]);
    expect(match?.groupingId).toBe(component.groupingId);
  });

  it('should match when existing root is a constituent of the result', () => {
    const component = mkComponent({
      rootElementId: 'child-elem',
      patternType: PatternType.DROPDOWN,
      constituents: [
        { elementId: 'child-elem', role: ComponentRole.OPTION },
      ],
    });
    const result = mkResult({
      rootElementId: 'root-elem',
      patternType: PatternType.DROPDOWN,
      constituents: [
        { elementId: 'root-elem', role: ComponentRole.TRIGGER },
        { elementId: 'child-elem', role: ComponentRole.OPTION },
      ],
    });

    const match = resolveIdentity(result, [component]);
    expect(match?.groupingId).toBe(component.groupingId);
  });

  it('should match by constituent overlap (Jaccard ≥ 0.34)', () => {
    const component = mkComponent({
      rootElementId: 'a',
      patternType: PatternType.DROPDOWN,
      constituents: [
        { elementId: 'a', role: ComponentRole.TRIGGER },
        { elementId: 'b', role: ComponentRole.OPTION },
        { elementId: 'c', role: ComponentRole.OPTION },
      ],
    });
    // result shares 'b' and 'c' out of union {a,b,c,d,e} → 2/5 = 0.4 ≥ 0.34
    const result = mkResult({
      rootElementId: 'd',
      patternType: PatternType.DROPDOWN,
      constituents: [
        { elementId: 'd', role: ComponentRole.TRIGGER },
        { elementId: 'b', role: ComponentRole.OPTION },
        { elementId: 'c', role: ComponentRole.OPTION },
        { elementId: 'e', role: ComponentRole.OPTION },
      ],
    });

    const match = resolveIdentity(result, [component]);
    expect(match?.groupingId).toBe(component.groupingId);
  });

  it('should NOT match when overlap is below threshold', () => {
    const component = mkComponent({
      rootElementId: 'a',
      patternType: PatternType.DROPDOWN,
      constituents: [
        { elementId: 'a', role: ComponentRole.TRIGGER },
        { elementId: 'b', role: ComponentRole.OPTION },
        { elementId: 'c', role: ComponentRole.OPTION },
      ],
    });
    // result shares only 'b' out of union {a,b,c,d,e,f} → 1/6 = 0.17 < 0.34
    const result = mkResult({
      rootElementId: 'd',
      patternType: PatternType.DROPDOWN,
      constituents: [
        { elementId: 'd', role: ComponentRole.TRIGGER },
        { elementId: 'b', role: ComponentRole.OPTION },
        { elementId: 'e', role: ComponentRole.OPTION },
        { elementId: 'f', role: ComponentRole.OPTION },
      ],
    });

    const match = resolveIdentity(result, [component]);
    expect(match).toBeNull();
  });

  it('should return null for null recognition result', () => {
    const component = mkComponent({
      rootElementId: 'a',
      patternType: PatternType.DROPDOWN,
    });
    const nullResult: RecognitionResult = {
      patternType: null,
      rootElementId: null,
      constituents: [],
      confidence: 0,
      recognitionSource: RecognitionSource.STRUCTURAL,
      matchedRole: null,
      reason: null,
    };

    expect(resolveIdentity(nullResult, [component])).toBeNull();
  });

  it('should skip rejected components', () => {
    // Must create then reject, since createComponentGrouping always starts TENTATIVE
    const component = mkComponent({
      rootElementId: 'elem-1',
      patternType: PatternType.DROPDOWN,
    });
    const rejected = rejectComponent(component);
    const result = mkResult({
      rootElementId: 'elem-1',
      patternType: PatternType.DROPDOWN,
    });

    expect(resolveIdentity(result, [rejected])).toBeNull();
  });
});

// ── Merge Logic Tests ────────────────────────────────────

describe('mergeRecognition', () => {
  it('should union constituents from both sources', () => {
    const existing = mkComponent({
      rootElementId: 'root',
      patternType: PatternType.DROPDOWN,
      recognitionSource: RecognitionSource.STRUCTURAL,
      constituents: [
        { elementId: 'root', role: ComponentRole.TRIGGER },
        { elementId: 'listbox', role: ComponentRole.CONTAINER },
      ],
    });
    const result = mkResult({
      rootElementId: 'root',
      patternType: PatternType.DROPDOWN,
      recognitionSource: RecognitionSource.BEHAVIORAL,
      constituents: [
        { elementId: 'root', role: ComponentRole.TRIGGER },
        { elementId: 'done-btn', role: ComponentRole.COMMIT },
      ],
    });

    const merged = mergeRecognition(existing, result);
    expect(merged.constituents).toHaveLength(3); // root + listbox + done-btn
    expect(merged.constituents.some((c) => c.elementId === 'done-btn')).toBe(true);
  });

  it('should keep structural role on conflict', () => {
    const existing = mkComponent({
      rootElementId: 'root',
      patternType: PatternType.DROPDOWN,
      recognitionSource: RecognitionSource.STRUCTURAL,
      constituents: [
        { elementId: 'root', role: ComponentRole.TRIGGER },
        { elementId: 'opt-1', role: ComponentRole.OPTION },
      ],
    });
    const result = mkResult({
      rootElementId: 'root',
      patternType: PatternType.DROPDOWN,
      recognitionSource: RecognitionSource.BEHAVIORAL,
      constituents: [
        { elementId: 'opt-1', role: ComponentRole.COMMIT }, // conflicting role
      ],
    });

    const merged = mergeRecognition(existing, result);
    const opt1 = merged.constituents.find((c) => c.elementId === 'opt-1');
    expect(opt1?.role).toBe(ComponentRole.OPTION); // structural wins
  });

  it('should upgrade source from behavioral to structural', () => {
    const existing = mkComponent({
      rootElementId: 'root',
      patternType: PatternType.DROPDOWN,
      recognitionSource: RecognitionSource.BEHAVIORAL,
      recognitionConfidence: 0.75,
    });
    const result = mkResult({
      rootElementId: 'root',
      patternType: PatternType.DROPDOWN,
      recognitionSource: RecognitionSource.STRUCTURAL,
      confidence: 0.95,
    });

    const merged = mergeRecognition(existing, result);
    expect(merged.recognitionSource).toBe(RecognitionSource.STRUCTURAL);
    expect(merged.recognitionConfidence).toBe(0.95);
  });

  it('should NOT downgrade source from structural to behavioral', () => {
    const existing = mkComponent({
      rootElementId: 'root',
      patternType: PatternType.DROPDOWN,
      recognitionSource: RecognitionSource.STRUCTURAL,
      recognitionConfidence: 0.95,
    });
    const result = mkResult({
      rootElementId: 'root',
      patternType: PatternType.DROPDOWN,
      recognitionSource: RecognitionSource.BEHAVIORAL,
      confidence: 0.50,
    });

    const merged = mergeRecognition(existing, result);
    expect(merged.recognitionSource).toBe(RecognitionSource.STRUCTURAL);
    expect(merged.recognitionConfidence).toBe(0.95);
  });

  it('should override patternType when structural disagrees', () => {
    const existing = mkComponent({
      rootElementId: 'root',
      patternType: PatternType.ACCORDION,
      recognitionSource: RecognitionSource.BEHAVIORAL,
    });
    const result = mkResult({
      rootElementId: 'root',
      patternType: PatternType.DROPDOWN,
      recognitionSource: RecognitionSource.STRUCTURAL,
    });

    const merged = mergeRecognition(existing, result);
    expect(merged.patternType).toBe(PatternType.DROPDOWN); // structural overrides
  });
});

// ── Rejection Algorithm Tests ────────────────────────────

describe('shouldReject', () => {
  it('should not reject with only supporting evidence', () => {
    const evidence: EvidenceEntry[] = [
      createEvidence(RecognitionSource.STRUCTURAL, 'supporting', 'match'),
      createEvidence(RecognitionSource.BEHAVIORAL, 'supporting', 'reinforced'),
    ];
    expect(shouldReject(evidence)).toBe(false);
  });

  it('should reject when net contradiction reaches threshold', () => {
    const evidence: EvidenceEntry[] = [
      createEvidence(RecognitionSource.STRUCTURAL, 'supporting', 'initial'),
      createEvidence(RecognitionSource.BEHAVIORAL, 'contradicting', 'wrong type'),
      createEvidence(RecognitionSource.BEHAVIORAL, 'contradicting', 'navigation away'),
      createEvidence(RecognitionSource.BEHAVIORAL, 'contradicting', 'no popup'),
      createEvidence(RecognitionSource.BEHAVIORAL, 'contradicting', 'no state change'),
    ];
    // supporting=1, contradicting=4 → net=3 ≥ threshold
    expect(shouldReject(evidence)).toBe(true);
  });

  it('should not reject when supporting evidence compensates', () => {
    const evidence: EvidenceEntry[] = [
      createEvidence(RecognitionSource.STRUCTURAL, 'supporting', 'match'),
      createEvidence(RecognitionSource.BEHAVIORAL, 'supporting', 'lifecycle step'),
      createEvidence(RecognitionSource.BEHAVIORAL, 'contradicting', 'noise 1'),
      createEvidence(RecognitionSource.BEHAVIORAL, 'contradicting', 'noise 2'),
    ];
    // supporting=2, contradicting=2 → net=0 < threshold
    expect(shouldReject(evidence)).toBe(false);
  });

  it('should ignore neutral evidence', () => {
    const evidence: EvidenceEntry[] = [
      createEvidence(RecognitionSource.BEHAVIORAL, 'neutral', 'unrelated'),
      createEvidence(RecognitionSource.BEHAVIORAL, 'neutral', 'noise'),
      createEvidence(RecognitionSource.BEHAVIORAL, 'contradicting', 'wrong type'),
    ];
    // supporting=0, contradicting=1 → net=1 < threshold
    expect(shouldReject(evidence)).toBe(false);
  });
});

// ── ComponentRegistry Tests ──────────────────────────────

describe('ComponentRegistry', () => {
  let registry: ComponentRegistry;

  beforeEach(() => {
    registry = new ComponentRegistry();
  });

  describe('register', () => {
    it('should create a new component from a recognition result', () => {
      const result = mkResult({
        rootElementId: 'trigger',
        patternType: PatternType.DROPDOWN,
        recognitionSource: RecognitionSource.STRUCTURAL,
        confidence: 0.95,
        constituents: [
          { elementId: 'trigger', role: ComponentRole.TRIGGER },
          { elementId: 'listbox', role: ComponentRole.CONTAINER },
          { elementId: 'opt-1', role: ComponentRole.OPTION },
        ],
      });

      const component = registry.register(result);
      expect(component.rootElementId).toBe('trigger');
      expect(component.patternType).toBe(PatternType.DROPDOWN);
      expect(component.lifecycleState).toBe(ComponentLifecycleState.TENTATIVE);
      expect(component.recognitionConfidence).toBe(0.95);
    });

    it('should merge into existing component when identity matches', () => {
      const structural = mkResult({
        rootElementId: 'root',
        patternType: PatternType.DROPDOWN,
        recognitionSource: RecognitionSource.STRUCTURAL,
        confidence: 0.95,
        constituents: [
          { elementId: 'root', role: ComponentRole.TRIGGER },
        ],
      });
      registry.register(structural);

      const behavioral = mkResult({
        rootElementId: 'root',
        patternType: PatternType.DROPDOWN,
        recognitionSource: RecognitionSource.BEHAVIORAL,
        confidence: 0.75,
        constituents: [
          { elementId: 'root', role: ComponentRole.TRIGGER },
          { elementId: 'done', role: ComponentRole.COMMIT },
        ],
      });
      const merged = registry.register(behavioral);

      expect(merged.constituents.some((c) => c.elementId === 'done')).toBe(true);
      expect(merged.recognitionSource).toBe(RecognitionSource.STRUCTURAL);
    });

    it('should throw on null recognition result', () => {
      const nullResult: RecognitionResult = {
        patternType: null,
        rootElementId: null,
        constituents: [],
        confidence: 0,
        recognitionSource: RecognitionSource.STRUCTURAL,
        matchedRole: null,
        reason: null,
      };
      expect(() => registry.register(nullResult)).toThrow();
    });

    it('should generate sequential component IDs', () => {
      const r1 = mkResult({ rootElementId: 'a', patternType: PatternType.CHECKBOX });
      const r2 = mkResult({ rootElementId: 'b', patternType: PatternType.CHECKBOX });

      const c1 = registry.register(r1);
      const c2 = registry.register(r2);
      expect(c1.groupingId).toBe('comp-0001');
      expect(c2.groupingId).toBe('comp-0002');
    });
  });

  describe('addEvidence', () => {
    it('should accumulate evidence entries', () => {
      const result = mkResult({ rootElementId: 'elem', patternType: PatternType.CHECKBOX });
      const component = registry.register(result);

      registry.addEvidence(
        component.groupingId,
        createEvidence(RecognitionSource.BEHAVIORAL, 'supporting', 'state flip observed'),
      );

      const evidence = registry.getEvidence(component.groupingId);
      // 1 from registration + 1 manually added
      expect(evidence.length).toBe(2);
      expect(evidence[1].description).toBe('state flip observed');
    });
  });

  describe('addTransition', () => {
    it('should advance tentative → developing on first transition', () => {
      const result = mkResult({ rootElementId: 'elem', patternType: PatternType.CHECKBOX });
      const component = registry.register(result);
      expect(component.lifecycleState).toBe(ComponentLifecycleState.TENTATIVE);

      const updated = registry.addTransition(component.groupingId, 't1');
      expect(updated.lifecycleState).toBe(ComponentLifecycleState.DEVELOPING);
    });

    it('should be idempotent for duplicate transitions', () => {
      const result = mkResult({ rootElementId: 'elem', patternType: PatternType.CHECKBOX });
      const component = registry.register(result);

      registry.addTransition(component.groupingId, 't1');
      const updated = registry.addTransition(component.groupingId, 't1');

      expect(updated.observedTransitionIds.filter((id) => id === 't1')).toHaveLength(1);
    });
  });

  describe('checkRejection', () => {
    it('should reject when contradiction threshold exceeded', () => {
      const result = mkResult({ rootElementId: 'elem', patternType: PatternType.DROPDOWN });
      const component = registry.register(result);

      // register() seeds 1 supporting evidence (initial recognition is supporting).
      // To reach net contradiction = CONTRADICTION_THRESHOLD, we need
      // CONTRADICTION_THRESHOLD + 1 contradicting entries.
      for (let i = 0; i < CONTRADICTION_THRESHOLD + 1; i++) {
        registry.addEvidence(
          component.groupingId,
          createEvidence(RecognitionSource.BEHAVIORAL, 'contradicting', `contradiction ${i}`),
        );
      }

      const wasRejected = registry.checkRejection(component.groupingId);
      expect(wasRejected).toBe(true);

      const rejected = registry.getComponent(component.groupingId)!;
      expect(rejected.lifecycleState).toBe(ComponentLifecycleState.REJECTED);
    });

    it('should not reject confirmed components', () => {
      const result = mkResult({ rootElementId: 'elem', patternType: PatternType.CHECKBOX });
      const component = registry.register(result);
      registry.addTransition(component.groupingId, 't1');
      registry.promote(component.groupingId);

      // Add tons of contradiction
      for (let i = 0; i < 10; i++) {
        registry.addEvidence(
          component.groupingId,
          createEvidence(RecognitionSource.BEHAVIORAL, 'contradicting', `c${i}`),
        );
      }

      expect(registry.checkRejection(component.groupingId)).toBe(false);
    });

    it('should clear element index when rejecting', () => {
      const result = mkResult({
        rootElementId: 'root',
        patternType: PatternType.DROPDOWN,
        constituents: [
          { elementId: 'root', role: ComponentRole.TRIGGER },
          { elementId: 'opt', role: ComponentRole.OPTION },
        ],
      });
      const component = registry.register(result);

      // Verify index has the elements
      expect(registry.getByElement('root')).toBeDefined();
      expect(registry.getByElement('opt')).toBeDefined();

      // Reject — need to overcome the 1 supporting entry from registration.
      for (let i = 0; i < CONTRADICTION_THRESHOLD + 1; i++) {
        registry.addEvidence(
          component.groupingId,
          createEvidence(RecognitionSource.BEHAVIORAL, 'contradicting', `c${i}`),
        );
      }
      registry.checkRejection(component.groupingId);

      // Index should be cleared
      expect(registry.getByElement('root')).toBeUndefined();
      expect(registry.getByElement('opt')).toBeUndefined();
    });
  });

  describe('getByElement', () => {
    it('should find a component by any constituent element', () => {
      const result = mkResult({
        rootElementId: 'root',
        patternType: PatternType.DROPDOWN,
        constituents: [
          { elementId: 'root', role: ComponentRole.TRIGGER },
          { elementId: 'opt-1', role: ComponentRole.OPTION },
          { elementId: 'opt-2', role: ComponentRole.OPTION },
        ],
      });
      registry.register(result);

      expect(registry.getByElement('root')?.patternType).toBe(PatternType.DROPDOWN);
      expect(registry.getByElement('opt-1')?.patternType).toBe(PatternType.DROPDOWN);
      expect(registry.getByElement('opt-2')?.patternType).toBe(PatternType.DROPDOWN);
    });

    it('should return undefined for unknown element', () => {
      expect(registry.getByElement('nonexistent')).toBeUndefined();
    });
  });

  describe('hasComponent', () => {
    it('should return true for elements in active components', () => {
      const result = mkResult({ rootElementId: 'elem', patternType: PatternType.CHECKBOX });
      registry.register(result);

      expect(registry.hasComponent('elem')).toBe(true);
    });

    it('should return false for rejected components', () => {
      const result = mkResult({ rootElementId: 'elem', patternType: PatternType.DROPDOWN });
      const component = registry.register(result);

      // register() seeds 1 supporting evidence; need net contradiction = 3,
      // so add CONTRADICTION_THRESHOLD + 1 contradicting entries.
      for (let i = 0; i < CONTRADICTION_THRESHOLD + 1; i++) {
        registry.addEvidence(
          component.groupingId,
          createEvidence(RecognitionSource.BEHAVIORAL, 'contradicting', `c${i}`),
        );
      }
      registry.checkRejection(component.groupingId);

      expect(registry.hasComponent('elem')).toBe(false);
    });
  });

  describe('clear', () => {
    it('should reset the registry to empty', () => {
      registry.register(mkResult({ rootElementId: 'a', patternType: PatternType.CHECKBOX }));
      registry.register(mkResult({ rootElementId: 'b', patternType: PatternType.CHECKBOX }));
      expect(registry.size).toBe(2);

      registry.clear();

      expect(registry.size).toBe(0);
      expect(registry.getAll()).toHaveLength(0);
    });
  });
});
