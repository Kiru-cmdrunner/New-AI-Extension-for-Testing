/**
 * Orchestrator — unit tests.
 *
 * Tests the full recognition flow: structural → behavioral → identity resolution →
 * merge → enrichment → lifecycle progression → rejection.
 *
 * Uses realistic ARIA fixtures to test structural recognition and synthesized
 * transition sequences for behavioral recognition.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  processInteraction,
  type OrchestratorInput,
} from '../../src/recorder/recognition/orchestrator';
import { ComponentRegistry } from '../../src/recorder/recognition/component-registry';
import {
  PatternType,
  ComponentRole,
  RecognitionSource,
  ComponentLifecycleState,
  TransitionOperation,
  TransitionEvidenceType,
  CascadeEffectType,
  RelevanceLevel,
} from '../../src/domain/enums';
import type { ElementRoleInfo } from '../../src/recorder/recognition/structural-recognizer';
import {
  createObservedTransition,
  emptyElementState,
} from '../../src/domain/entities/observed-transition';

// ── Helpers ──────────────────────────────────────────────

let transitionCounter = 0;

function mkTransition(overrides: {
  elementId: string;
  operation: TransitionOperation;
  evidence?: Array<{ type: TransitionEvidenceType; description: string; before?: string; after?: string }>;
  cascadeEffects?: Array<{ elementId: string; effect: CascadeEffectType; detail: string }>;
  relevance?: RelevanceLevel;
}) {
  transitionCounter++;
  return createObservedTransition({
    transitionId: `t${transitionCounter}`,
    elementId: overrides.elementId,
    componentId: null,
    operation: overrides.operation,
    timestamp: transitionCounter * 1000,
    relevance: overrides.relevance ?? RelevanceLevel.DELIBERATE,
    stateBefore: emptyElementState(),
    stateAfter: emptyElementState(),
    evidence: overrides.evidence ?? [],
    cascadeEffects: overrides.cascadeEffects ?? [],
  });
}

function mkElement(elementId: string, ariaRole: string | null, tag = 'div'): ElementRoleInfo {
  return { elementId, ariaRole, tag };
}

function mkInput(overrides: Partial<OrchestratorInput> & {
  element: ElementRoleInfo;
}): OrchestratorInput {
  return {
    element: overrides.element,
    ancestorRoles: overrides.ancestorRoles ?? [],
    siblingElementRoles: overrides.siblingElementRoles,
    relatedElementIds: overrides.relatedElementIds ?? [overrides.element.elementId],
    transitions: overrides.transitions ?? [],
    currentTransition: overrides.currentTransition ?? mkTransition({
      elementId: overrides.element.elementId,
      operation: TransitionOperation.CLICK,
    }),
  };
}

// ── Tests ────────────────────────────────────────────────

describe('Recognition Orchestrator', () => {
  let registry: ComponentRegistry;

  beforeEach(() => {
    registry = new ComponentRegistry();
    transitionCounter = 0;
  });

  // ── Structural Recognition → Create ──────────────────

  describe('structural recognition → component creation', () => {
    it('should create a dropdown component from ARIA combobox structure', () => {
      const input = mkInput({
        element: mkElement('opt-1', 'option', 'div'),
        ancestorRoles: [mkElement('lb-1', 'listbox'), mkElement('cb-1', 'combobox')],
        relatedElementIds: ['combobox-1', 'listbox-1', 'opt-1', 'opt-2'],
        currentTransition: mkTransition({
          elementId: 'opt-1',
          operation: TransitionOperation.CLICK,
        }),
      });

      const result = processInteraction(input, registry);

      expect(result.created).toBe(true);
      expect(result.component).not.toBeNull();
      expect(result.component!.patternType).toBe(PatternType.DROPDOWN);
      expect(result.component!.recognitionSource).toBe(RecognitionSource.STRUCTURAL);
      expect(result.structuralResult.patternType).toBe(PatternType.DROPDOWN);
    });

    it('should create a checkbox from ARIA checkbox role', () => {
      const input = mkInput({
        element: mkElement('checkbox-1', 'checkbox', 'div'),
        ancestorRoles: [],
        relatedElementIds: ['checkbox-1'],
        currentTransition: mkTransition({
          elementId: 'checkbox-1',
          operation: TransitionOperation.CLICK,
        }),
      });

      const result = processInteraction(input, registry);

      expect(result.created).toBe(true);
      expect(result.component!.patternType).toBe(PatternType.CHECKBOX);
    });
  });

  // ── No Recognition → Standalone ──────────────────────

  describe('no recognition → standalone element', () => {
    it('should return null component for non-component interaction', () => {
      const input = mkInput({
        element: mkElement('plain-div', null, 'div'),
        ancestorRoles: [],
        relatedElementIds: ['plain-div'],
        currentTransition: mkTransition({
          elementId: 'plain-div',
          operation: TransitionOperation.CLICK,
        }),
      });

      const result = processInteraction(input, registry);

      expect(result.component).toBeNull();
      expect(result.created).toBe(false);
      expect(result.structuralResult.patternType).toBeNull();
      expect(result.behavioralResult.patternType).toBeNull();
    });
  });

  // ── Structural + Behavioral Merge ────────────────────

  describe('structural + behavioral merge', () => {
    it('should merge behavioral constituents into structurally-recognized component', () => {
      // First interaction: structural recognition identifies the combobox
      const input1 = mkInput({
        element: mkElement('opt-1', 'option', 'div'),
        ancestorRoles: [mkElement('lb-1', 'listbox'), mkElement('cb-1', 'combobox')],
        relatedElementIds: ['combobox-1', 'listbox-1', 'opt-1', 'opt-2', 'done-btn'],
        currentTransition: mkTransition({
          elementId: 'opt-1',
          operation: TransitionOperation.CLICK,
        }),
      });
      processInteraction(input1, registry);

      // Second interaction: behavioral should discover done-btn as a constituent
      const input2 = mkInput({
        element: mkElement('done-btn', 'button', 'button'),
        ancestorRoles: [mkElement('cb-1', 'combobox')],
        relatedElementIds: ['combobox-1', 'listbox-1', 'opt-1', 'opt-2', 'done-btn'],
        currentTransition: mkTransition({
          elementId: 'done-btn',
          operation: TransitionOperation.CLICK,
        }),
      });
      const result2 = processInteraction(input2, registry);

      // Component should now include done-btn
      expect(result2.component).not.toBeNull();
      expect(result2.component!.constituents.some((c) => c.elementId === 'done-btn')).toBe(true);
    });
  });

  // ── Lifecycle Progression ────────────────────────────

  describe('lifecycle progression', () => {
    it('should promote checkbox to confirmed on first transition', () => {
      const input = mkInput({
        element: mkElement('cb', 'checkbox', 'div'),
        ancestorRoles: [],
        relatedElementIds: ['cb'],
        currentTransition: mkTransition({
          elementId: 'cb',
          operation: TransitionOperation.TOGGLE,
        }),
      });

      const result = processInteraction(input, registry);

      // Checkbox lifecycle = [TOGGLE], and we provided TOGGLE → should confirm
      // But wait — the orchestrator reads transitions for observed operations.
      // currentTransition is added via addTransition, but the observed operations
      // are collected from input.transitions + currentTransition.
      // For checkbox: expectedLifecycle = [TOGGLE], we have TOGGLE → confirmed.
      expect(result.component).not.toBeNull();
      // May be developing or confirmed depending on lifecycle check timing
      // The transition is added, then lifecycle is checked.
      // observedOperations includes currentTransition.operation = TOGGLE
      // expectedLifecycle for checkbox = [TOGGLE] → set-containment passes
      expect(result.promoted).toBe(true);
    });

    it('should NOT promote dropdown until full lifecycle observed', () => {
      // Dropdown lifecycle = [CLICK, SELECT]
      // First interaction: just a CLICK (open trigger)
      const input = mkInput({
        element: mkElement('opt-1', 'option', 'div'),
        ancestorRoles: [mkElement('lb-1', 'listbox'), mkElement('cb-1', 'combobox')],
        relatedElementIds: ['combobox-1', 'listbox-1', 'opt-1', 'opt-2'],
        currentTransition: mkTransition({
          elementId: 'opt-1',
          operation: TransitionOperation.CLICK,
        }),
      });

      const result = processInteraction(input, registry);

      expect(result.component).not.toBeNull();
      // Only CLICK observed, need SELECT too → not confirmed yet
      expect(result.promoted).toBe(false);
    });

    it('should promote modal to confirmed on first interaction', () => {
      const input = mkInput({
        element: mkElement('dialog', 'dialog', 'div'),
        ancestorRoles: [],
        relatedElementIds: ['dialog', 'open-btn'],
        currentTransition: mkTransition({
          elementId: 'dialog',
          operation: TransitionOperation.CLICK,
        }),
      });

      const result = processInteraction(input, registry);

      expect(result.component!.patternType).toBe(PatternType.MODAL);
      // Modal lifecycle = [CLICK], we have CLICK → confirmed
      expect(result.promoted).toBe(true);
    });
  });

  // ── Behavioral-Only Recognition ──────────────────────

  describe('behavioral-only recognition', () => {
    it('should recognize a checkbox from state flip without ARIA', () => {
      const transition = mkTransition({
        elementId: 'custom-cb',
        operation: TransitionOperation.CLICK,
        evidence: [
          {
            type: TransitionEvidenceType.STATE_CHANGE,
            description: 'checked state changed: false → true',
            before: 'false',
            after: 'true',
          },
        ],
      });

      const input = mkInput({
        element: mkElement('custom-cb', null, 'div'),
        ancestorRoles: [],
        relatedElementIds: ['custom-cb'],
        transitions: [transition],
        currentTransition: transition,
      });

      const result = processInteraction(input, registry);

      expect(result.created).toBe(true);
      expect(result.component!.patternType).toBe(PatternType.CHECKBOX);
      expect(result.component!.recognitionSource).toBe(RecognitionSource.BEHAVIORAL);
    });
  });

  // ── Identity Resolution Across Tiers ─────────────────

  describe('identity resolution across tiers', () => {
    it('should merge second interaction into same component by root match', () => {
      // First interaction creates the component
      const input1 = mkInput({
        element: mkElement('cb', 'checkbox', 'div'),
        ancestorRoles: [],
        relatedElementIds: ['cb'],
        currentTransition: mkTransition({
          elementId: 'cb',
          operation: TransitionOperation.TOGGLE,
        }),
      });
      processInteraction(input1, registry);

      // Second interaction on the same element should update, not create
      const input2 = mkInput({
        element: mkElement('cb', 'checkbox', 'div'),
        ancestorRoles: [],
        relatedElementIds: ['cb'],
        currentTransition: mkTransition({
          elementId: 'cb',
          operation: TransitionOperation.TOGGLE,
        }),
      });
      const result2 = processInteraction(input2, registry);

      expect(result2.created).toBe(false);
      expect(result2.updated).toBe(true);
      expect(registry.size).toBe(1); // still one component
    });
  });

  // ── Noise Filtering ──────────────────────────────────

  describe('noise filtering', () => {
    it('should skip behavioral recognition for noise transitions', () => {
      const transition = mkTransition({
        elementId: 'elem',
        operation: TransitionOperation.CLICK,
        relevance: RelevanceLevel.NOISE,
        evidence: [
          { type: TransitionEvidenceType.MUTATION, description: 'popup appeared' },
        ],
      });

      const input = mkInput({
        element: mkElement('elem', null, 'div'),
        ancestorRoles: [],
        relatedElementIds: ['elem'],
        transitions: [transition],
        currentTransition: transition,
      });

      const result = processInteraction(input, registry);

      // Behavioral should skip noise → null
      expect(result.behavioralResult.patternType).toBeNull();
    });
  });
});
