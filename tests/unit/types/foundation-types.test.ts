/**
 * Foundation Type System Tests — Phase 1
 *
 * Tests verify:
 * 1. All types are properly defined and constructible (structural validation)
 * 2. Type guards work correctly
 * 3. Discriminated unions discriminate correctly
 * 4. Runtime type guards (isRecognised, isUnrecognised) work
 * 5. All exported types are accessible via the barrel
 * 6. Existing types in shared/types.ts are NOT affected
 */

import { describe, it, expect } from 'vitest';
import { isRecognised, isUnrecognised } from '../../../src/types/recognition';
import type {
  // Foundation
  ChannelId,
  SignalType,
  TargetRecordingState,
  ComponentType,
  InteractionVerb,
  EvidenceRecord,
  PatternOperator,
  PatternDefinition,
  // Element
  ResolvedLocator,
  TargetElementIdentity,
  TargetDomContext,
  // Evidence
  BatchStatus,
  EvidenceBatch,
  // Recognition
  UnrecognisedReason,
  RecognisedInteraction,
  UnrecognisedInteraction,
  RecognitionResult,
  RecognitionOutput,
  // Lifecycle
  LifecyclePhase,
  SemanticAction,
  LifecycleConfig,
  // Output
  BehavioralContract,
  IRStep,
  ExecutionIRPlan,
  RecordingArtifact,
  PipelineTrace,
  // Pipeline
  PipelineStageName,
  PipelineResult,
  ContentToSWMessage,
  SWToPanelMessage,
  PanelToSWMessage,
} from '../../../src/types';

// ── Helper Factories ──────────────────────────────────────

function makeLocator(overrides: Partial<ResolvedLocator> = {}): ResolvedLocator {
  return {
    kind: 'testId',
    value: 'submit-btn',
    confidence: 0.95,
    source: 'observed',
    ...overrides,
  };
}

function makeTargetElementIdentity(overrides: Partial<TargetElementIdentity> = {}): TargetElementIdentity {
  return {
    tag: 'BUTTON',
    accessibleName: 'Submit',
    ariaRole: 'button',
    ariaExpanded: null,
    ariaHasPopup: null,
    ariaChecked: null,
    ariaSelected: null,
    ariaPressed: null,
    inputType: null,
    isContentEditable: false,
    locators: [makeLocator()],
    primaryLocator: makeLocator(),
    inShadowDom: false,
    inIframe: false,
    frameContext: null,
    ...overrides,
  };
}

function makeTargetDomContext(overrides: Partial<TargetDomContext> = {}): TargetDomContext {
  return {
    surfaces: [],
    valueTransition: null,
    checkedTransition: null,
    ancestorChain: ['body'],
    datePicker: null,
    fileUpload: null,
    dialog: null,
    navigation: null,
    ...overrides,
  };
}

function makeEvidenceRecord(overrides: Partial<EvidenceRecord> = {}): EvidenceRecord {
  return {
    channelId: 'A',
    signalType: 'ariaRole',
    timestamp: '2025-01-01T00:00:00.000Z',
    value: 'button',
    confidence: 1.0,
    ...overrides,
  };
}

function makeEvidenceBatch(overrides: Partial<EvidenceBatch> = {}): EvidenceBatch {
  return {
    id: 'batch-001',
    startedAt: '2025-01-01T00:00:00.000Z',
    endedAt: '2025-01-01T00:00:01.000Z',
    target: makeTargetElementIdentity(),
    domContext: makeTargetDomContext(),
    evidence: [makeEvidenceRecord()],
    eventSequence: ['click'],
    status: 'pending',
    correlationGroup: null,
    pageUrl: 'https://example.com',
    ...overrides,
  };
}

function makeRecognisedInteraction(overrides: Partial<RecognisedInteraction> = {}): RecognisedInteraction {
  return {
    id: 'int-001',
    kind: 'recognised',
    verb: 'click',
    componentType: 'Button',
    matchedPattern: {
      id: 'click-button-v1',
      verb: 'click',
      componentType: 'Button',
      conditions: [{
        signalType: 'tag',
        operator: 'equals',
        expected: 'BUTTON',
        description: 'Element is a button',
        weight: 0.5,
      }],
      confidenceThreshold: 0.5,
      description: 'Button click',
    },
    confidence: 0.9,
    sourceBatches: ['batch-001'],
    timestamp: '2025-01-01T00:00:00.000Z',
    description: 'Clicked the Submit button',
    evidenceTrace: [{
      condition: {
        signalType: 'tag',
        operator: 'equals',
        expected: 'BUTTON',
        description: 'Element is a button',
        weight: 0.5,
      },
      matched: true,
      actualValue: 'BUTTON',
      contribution: 0.5,
    }],
    ...overrides,
  };
}

function makeUnrecognisedInteraction(overrides: Partial<UnrecognisedInteraction> = {}): UnrecognisedInteraction {
  return {
    id: 'int-002',
    kind: 'unrecognised',
    reason: 'no_pattern_matched',
    sourceBatches: ['batch-002'],
    timestamp: '2025-01-01T00:00:00.000Z',
    attemptedVerb: null,
    closestMatch: null,
    evidence: [],
    ...overrides,
  };
}

// ── Foundation Tests ──────────────────────────────────────

describe('Foundation Types', () => {
  describe('ChannelId', () => {
    it('should accept all five channel IDs', () => {
      const channels: ChannelId[] = ['A', 'B', 'C', 'D', 'E'];
      expect(channels).toHaveLength(5);
    });

    it('should accept valid channel ID', () => {
      const valid: ChannelId = 'A';
      expect(valid).toBe('A');
    });
  });

  describe('SignalType', () => {
    it('should accept structural signals', () => {
      const signals: SignalType[] = ['tag', 'cssClass', 'hierarchy', 'text'];
      expect(signals).toHaveLength(4);
    });

    it('should accept accessibility signals', () => {
      const signals: SignalType[] = ['ariaRole', 'ariaState', 'ariaAttribute', 'accessibleName', 'landmark'];
      expect(signals).toHaveLength(5);
    });

    it('should accept behavioural signals', () => {
      const signals: SignalType[] = ['eventSequence', 'valueTransition', 'checkedTransition', 'keySequence', 'dwellTime', 'focusDuration'];
      expect(signals).toHaveLength(6);
    });

    it('should accept mutation signals', () => {
      const signals: SignalType[] = ['surfaceAppearance', 'surfaceDisappearance', 'childListChange', 'attributeChange', 'visibilityChange'];
      expect(signals).toHaveLength(5);
    });

    it('should accept focus signals', () => {
      const signals: SignalType[] = ['focusEnter', 'focusExit', 'overlayOpen', 'overlayClose'];
      expect(signals).toHaveLength(4);
    });

    it('should accept navigation signals', () => {
      const signals: SignalType[] = ['navigation', 'tabOpen', 'tabClose'];
      expect(signals).toHaveLength(3);
    });
  });

  describe('TargetRecordingState', () => {
    it('should include all six states', () => {
      const states: TargetRecordingState[] = ['idle', 'starting', 'recording', 'stopping', 'completed', 'error_recovery'];
      expect(states).toHaveLength(6);
    });
  });

  describe('ComponentType', () => {
    it('should include all component types', () => {
      const types: ComponentType[] = [
        'Button', 'Link', 'TextInput', 'TextArea', 'Checkbox', 'RadioButton',
        'DropDownListbox', 'DatePicker', 'Slider', 'ToggleSwitch', 'Menu', 'MenuItem',
        'Tab', 'Accordion', 'Dialog', 'Tooltip', 'FileUpload', 'Breadcrumb',
        'NavigationBar', 'Generic',
      ];
      expect(types).toHaveLength(20);
    });
  });

  describe('InteractionVerb', () => {
    it('should include all interaction verbs', () => {
      const verbs: InteractionVerb[] = [
        'navigate', 'click', 'fill', 'select', 'toggle', 'selectOption',
        'selectDate', 'hover', 'scroll', 'upload', 'dragDrop', 'pressKey',
        'dismiss', 'unknown',
      ];
      expect(verbs).toHaveLength(14);
    });
  });

  describe('EvidenceRecord', () => {
    it('should construct with all fields', () => {
      const record = makeEvidenceRecord({
        channelId: 'B',
        signalType: 'tag',
        value: 'INPUT',
        confidence: 1.0,
      });
      expect(record.channelId).toBe('B');
      expect(record.signalType).toBe('tag');
      expect(record.value).toBe('INPUT');
      expect(record.confidence).toBe(1.0);
    });

    it('should support generic value types', () => {
      const stringRecord: EvidenceRecord<string> = { channelId: 'A', signalType: 'tag', timestamp: '2025-01-01T00:00:00.000Z', value: 'hello', confidence: 1.0 };
      const numberRecord: EvidenceRecord<number> = { channelId: 'A', signalType: 'tag', timestamp: '2025-01-01T00:00:00.000Z', value: 42, confidence: 1.0 };
      const objectRecord: EvidenceRecord<{ role: string }> = { channelId: 'A', signalType: 'tag', timestamp: '2025-01-01T00:00:00.000Z', value: { role: 'button' }, confidence: 1.0 };
      expect(stringRecord.value).toBe('hello');
      expect(numberRecord.value).toBe(42);
      expect(objectRecord.value).toEqual({ role: 'button' });
    });
  });

  describe('PatternDefinition', () => {
    it('should construct a complete pattern', () => {
      const pattern: PatternDefinition = {
        id: 'checkbox-toggle-v1',
        verb: 'toggle',
        componentType: 'Checkbox',
        conditions: [
          {
            signalType: 'tag',
            operator: 'equals',
            expected: 'INPUT',
            description: 'Element is an input',
            weight: 0.3,
          },
          {
            signalType: 'checkedTransition',
            operator: 'exists',
            expected: null,
            description: 'Checked state changed',
            weight: 0.7,
          },
        ],
        confidenceThreshold: 0.6,
        description: 'Checkbox toggle interaction',
        requiresGrouping: false,
      };
      expect(pattern.id).toBe('checkbox-toggle-v1');
      expect(pattern.verb).toBe('toggle');
      expect(pattern.conditions).toHaveLength(2);
      expect(pattern.confidenceThreshold).toBe(0.6);
    });
  });

  describe('PatternOperator', () => {
    it('should include all operators', () => {
      const operators: PatternOperator[] = [
        'equals', 'notEquals', 'contains', 'notContains',
        'exists', 'notExists', 'matches', 'greaterThan', 'lessThan', 'inRange',
      ];
      expect(operators).toHaveLength(10);
    });
  });
});

// ── Element & DOM Context Tests ───────────────────────────

describe('Element & DOM Context Types', () => {
  describe('ResolvedLocator', () => {
    it('should construct with observed source', () => {
      const locator = makeLocator({ kind: 'ariaLabel', value: 'Close', source: 'observed' });
      expect(locator.kind).toBe('ariaLabel');
      expect(locator.source).toBe('observed');
    });

    it('should construct with computed source', () => {
      const locator = makeLocator({ kind: 'css', value: 'div > button.primary', source: 'computed' });
      expect(locator.source).toBe('computed');
    });
  });

  describe('TargetElementIdentity', () => {
    it('should construct a button identity', () => {
      const identity = makeTargetElementIdentity({
        tag: 'BUTTON',
        accessibleName: 'Login',
        ariaRole: 'button',
      });
      expect(identity.tag).toBe('BUTTON');
      expect(identity.accessibleName).toBe('Login');
      expect(identity.locators).toHaveLength(1);
    });

    it('should construct a text input identity', () => {
      const identity = makeTargetElementIdentity({
        tag: 'INPUT',
        inputType: 'text',
        ariaRole: 'textbox',
        accessibleName: 'Email Address',
        locators: [
          makeLocator({ kind: 'ariaLabel', value: 'Email Address' }),
          makeLocator({ kind: 'css', value: 'input[type="email"]', source: 'computed' }),
        ],
      });
      expect(identity.inputType).toBe('text');
      expect(identity.locators).toHaveLength(2);
    });

    it('should construct a Shadow DOM element identity', () => {
      const identity = makeTargetElementIdentity({ inShadowDom: true, tag: 'DIV' });
      expect(identity.inShadowDom).toBe(true);
    });

    it('should construct an iframe element identity', () => {
      const identity = makeTargetElementIdentity({
        inIframe: true,
        frameContext: {
          url: 'https://example.com/frame',
          name: 'content-frame',
          frameElementId: 'content-frame',
          frameSelector: 'iframe#content-frame',
          depth: 1,
        },
      });
      expect(identity.inIframe).toBe(true);
      expect(identity.frameContext?.depth).toBe(1);
    });
  });

  describe('TargetDomContext', () => {
    it('should construct with surface info', () => {
      const ctx = makeTargetDomContext({
        surfaces: [{
          type: 'modal',
          role: 'dialog',
          accessibleName: 'Settings Dialog',
          direction: 'appeared',
          detectedAt: '2025-01-01T00:00:00.500Z',
        }],
      });
      expect(ctx.surfaces).toHaveLength(1);
      expect(ctx.surfaces[0].type).toBe('modal');
    });

    it('should construct with value transition', () => {
      const ctx = makeTargetDomContext({
        valueTransition: { before: '', after: 'hello@example.com' },
      });
      expect(ctx.valueTransition?.after).toBe('hello@example.com');
    });

    it('should construct with date picker context', () => {
      const ctx = makeTargetDomContext({
        datePicker: {
          dateType: 'date',
          isoValue: '2025-07-15',
          displayValue: 'July 15, 2025',
          ambiguous: false,
          confidence: 1.0,
        },
      });
      expect(ctx.datePicker?.isoValue).toBe('2025-07-15');
    });

    it('should construct with file upload context', () => {
      const ctx = makeTargetDomContext({
        fileUpload: {
          method: 'browse',
          acceptedTypes: ['.pdf', 'image/*'],
          multiple: true,
          files: [{ name: 'document.pdf', type: 'application/pdf' }],
        },
      });
      expect(ctx.fileUpload?.method).toBe('browse');
      expect(ctx.fileUpload?.files).toHaveLength(1);
    });
  });
});

// ── Evidence Batch Tests ──────────────────────────────────

describe('EvidenceBatch', () => {
  it('should construct a minimal batch', () => {
    const batch = makeEvidenceBatch();
    expect(batch.id).toBe('batch-001');
    expect(batch.status).toBe('pending');
    expect(batch.evidence).toHaveLength(1);
  });

  it('should construct a multi-event batch', () => {
    const batch = makeEvidenceBatch({
      id: 'batch-002',
      eventSequence: ['focus', 'input', 'input', 'blur'],
      evidence: [
        makeEvidenceRecord({ signalType: 'focusEnter', channelId: 'E' }),
        makeEvidenceRecord({ signalType: 'valueTransition', channelId: 'C', value: { before: '', after: 'hello' } }),
        makeEvidenceRecord({ signalType: 'focusExit', channelId: 'E' }),
      ],
    });
    expect(batch.eventSequence).toHaveLength(4);
    expect(batch.evidence).toHaveLength(3);
  });

  it('should support all batch statuses', () => {
    const statuses: BatchStatus[] = ['pending', 'grouped', 'recognised', 'unrecognised', 'merged'];
    expect(statuses).toHaveLength(5);
  });
});

// ── Recognition Type Tests ────────────────────────────────

describe('Recognition Types', () => {
  describe('isRecognised / isUnrecognised type guards', () => {
    it('should identify a recognised interaction', () => {
      const r = makeRecognisedInteraction();
      expect(isRecognised(r)).toBe(true);
      expect(isUnrecognised(r)).toBe(false);
    });

    it('should identify an unrecognised interaction', () => {
      const r = makeUnrecognisedInteraction();
      expect(isRecognised(r)).toBe(false);
      expect(isUnrecognised(r)).toBe(true);
    });

    it('should discriminate the union correctly', () => {
      const results: RecognitionResult[] = [
        makeRecognisedInteraction(),
        makeUnrecognisedInteraction(),
      ];
      const recognised = results.filter(isRecognised);
      const unrecognised = results.filter(isUnrecognised);
      expect(recognised).toHaveLength(1);
      expect(unrecognised).toHaveLength(1);
    });
  });

  describe('RecognisedInteraction', () => {
    it('should construct with full evidence trace', () => {
      const r = makeRecognisedInteraction({
        verb: 'toggle',
        componentType: 'Checkbox',
        matchedPattern: {
          id: 'checkbox-toggle-v1',
          verb: 'toggle',
          conditions: [],
          confidenceThreshold: 0.5,
          description: 'Checkbox toggle',
        },
        confidence: 0.85,
        evidenceTrace: [
          {
            condition: { signalType: 'tag', operator: 'equals', expected: 'INPUT', description: 'Is input', weight: 0.3 },
            matched: true,
            actualValue: 'INPUT',
            contribution: 0.3,
          },
          {
            condition: { signalType: 'checkedTransition', operator: 'exists', expected: null, description: 'Checked changed', weight: 0.55 },
            matched: true,
            actualValue: { before: false, after: true },
            contribution: 0.55,
          },
        ],
      });
      expect(r.verb).toBe('toggle');
      expect(r.confidence).toBe(0.85);
      expect(r.evidenceTrace).toHaveLength(2);
    });
  });

  describe('UnrecognisedInteraction', () => {
    it('should construct with all reasons', () => {
      const reasons: UnrecognisedReason[] = [
        'no_pattern_matched',
        'confidence_below_threshold',
        'ambiguous_match',
        'grouping_failed',
        'target_unresolved',
        'error',
      ];
      expect(reasons).toHaveLength(6);
    });

    it('should construct with closest match info', () => {
      const r = makeUnrecognisedInteraction({
        reason: 'confidence_below_threshold',
        closestMatch: {
          pattern: {
            id: 'hover-tooltip-v1',
            verb: 'hover',
            conditions: [],
            confidenceThreshold: 0.7,
            description: 'Hover tooltip',
          },
          matchedConditions: 2,
          totalConditions: 3,
          confidence: 0.5,
        },
      });
      expect(r.closestMatch?.confidence).toBe(0.5);
    });
  });

  describe('RecognitionOutput', () => {
    it('should construct with counts', () => {
      const output: RecognitionOutput = {
        results: [makeRecognisedInteraction(), makeUnrecognisedInteraction()],
        batchCount: 10,
        candidateCount: 8,
        recognisedCount: 7,
        unrecognisedCount: 1,
        matchedPatternIds: ['click-button-v1', 'toggle-checkbox-v1'],
        completedAt: '2025-01-01T00:00:05.000Z',
        errors: [],
      };
      expect(output.results).toHaveLength(2);
      expect(output.recognisedCount).toBe(7);
    });
  });
});

// ── Lifecycle Type Tests ──────────────────────────────────

describe('Lifecycle Types', () => {
  describe('LifecyclePhase', () => {
    it('should include all phases', () => {
      const phases: LifecyclePhase[] = ['target', 'activate', 'intermediate', 'commit', 'cancel'];
      expect(phases).toHaveLength(5);
    });
  });

  describe('SemanticAction', () => {
    it('should construct a single-interaction action', () => {
      const action: SemanticAction = {
        id: 'action-001',
        kind: 'semantic_action',
        verb: 'click',
        componentType: 'Button',
        interactions: ['int-001'],
        startedAt: '2025-01-01T00:00:00.000Z',
        endedAt: '2025-01-01T00:00:01.000Z',
        lifecyclePhase: 'commit',
        confidence: 0.95,
        value: null,
        plainEnglish: 'Clicked the Submit button',
        committed: true,
      };
      expect(action.verb).toBe('click');
      expect(action.interactions).toHaveLength(1);
      expect(action.committed).toBe(true);
    });

    it('should construct a multi-interaction dropdown action', () => {
      const action: SemanticAction = {
        id: 'action-002',
        kind: 'semantic_action',
        verb: 'select',
        componentType: 'DropDownListbox',
        interactions: ['int-001', 'int-002'],
        startedAt: '2025-01-01T00:00:00.000Z',
        endedAt: '2025-01-01T00:00:03.000Z',
        lifecyclePhase: 'commit',
        confidence: 0.88,
        value: 'India',
        plainEnglish: 'Selected "India" from the Country dropdown',
        committed: true,
      };
      expect(action.interactions).toHaveLength(2);
      expect(action.value).toBe('India');
    });

    it('should construct a cancelled action', () => {
      const action: SemanticAction = {
        id: 'action-003',
        kind: 'semantic_action',
        verb: 'click',
        componentType: 'Dialog',
        interactions: ['int-003'],
        startedAt: '2025-01-01T00:00:00.000Z',
        endedAt: '2025-01-01T00:00:02.000Z',
        lifecyclePhase: 'cancel',
        confidence: 0.7,
        value: null,
        plainEnglish: 'Cancelled the dialog',
        committed: false,
      };
      expect(action.lifecyclePhase).toBe('cancel');
      expect(action.committed).toBe(false);
    });
  });

  describe('LifecycleConfig', () => {
    it('should construct a dropdown lifecycle config', () => {
      const config: LifecycleConfig = {
        id: 'dropdown-select-v1',
        actionVerb: 'select',
        componentType: 'DropDownListbox',
        transitions: [
          { from: 'target', to: 'activate', triggeredBy: 'click', requiresComponent: 'DropDownListbox' },
          { from: 'activate', to: 'intermediate', triggeredBy: 'click' },
          { from: 'intermediate', to: 'commit', triggeredBy: 'click' },
        ],
        maxWindowMs: 5000,
        description: 'Dropdown selection: open -> select item -> commit',
      };
      expect(config.transitions).toHaveLength(3);
      expect(config.maxWindowMs).toBe(5000);
    });
  });
});

// ── Output & Enrichment Type Tests ────────────────────────

describe('Output & Enrichment Types', () => {
  describe('BehavioralContract', () => {
    it('should construct a required-field contract', () => {
      const contract: BehavioralContract = {
        actionId: 'action-001',
        type: 'required',
        description: 'Email field is required',
        constraint: 'required',
        source: 'domAttribute',
      };
      expect(contract.type).toBe('required');
    });
  });

  describe('IRStep', () => {
    it('should construct a click IR step', () => {
      const step: IRStep = {
        stepId: 'step-001',
        actionId: 'action-001',
        verb: 'click',
        description: 'Click the Submit button',
        locators: [
          { kind: 'testId', value: 'submit-btn', confidence: 0.95 },
          { kind: 'css', value: 'button[type="submit"]', confidence: 0.7 },
        ],
        value: null,
        checked: null,
        frame: null,
      };
      expect(step.locators).toHaveLength(2);
      expect(step.verb).toBe('click');
    });

    it('should construct a fill IR step with value', () => {
      const step: IRStep = {
        stepId: 'step-002',
        actionId: 'action-002',
        verb: 'fill',
        description: 'Fill the email field',
        locators: [{ kind: 'ariaLabel', value: 'Email', confidence: 0.9 }],
        value: 'hello@example.com',
        checked: null,
        frame: null,
      };
      expect(step.value).toBe('hello@example.com');
    });
  });

  describe('ExecutionIRPlan', () => {
    it('should construct a complete plan', () => {
      const plan: ExecutionIRPlan = {
        schemaVersion: 1,
        steps: [],
        stepCount: 0,
        generatedAt: '2025-01-01T00:00:00.000Z',
      };
      expect(plan.schemaVersion).toBe(1);
    });
  });

  describe('RecordingArtifact', () => {
    it('should construct a complete artifact', () => {
      const artifact: RecordingArtifact = {
        recordingId: 'rec-001',
        metadata: {
          startedAt: '2025-01-01T00:00:00.000Z',
          stoppedAt: '2025-01-01T00:01:00.000Z',
          durationMs: 60000,
          startUrl: 'https://example.com',
          startTitle: 'Example',
          totalEvents: 50,
          schemaVersion: 1,
        },
        enrichedRecording: {
          actions: [],
          unrecognised: [],
          contracts: [],
          capabilities: [],
          coverage: {
            totalInteractiveElements: 10,
            interactedElements: 5,
            coverage: 0.5,
            uncoveredElements: [],
          },
          enrichedAt: '2025-01-01T00:00:05.000Z',
        },
        executionIR: {
          schemaVersion: 1,
          steps: [],
          stepCount: 0,
          generatedAt: '2025-01-01T00:00:05.000Z',
        },
        generatedCode: [{
          framework: 'playwright',
          code: 'test("example", () => {});',
          generatedAt: '2025-01-01T00:00:06.000Z',
        }],
        plainEnglishNarrative: 'The user navigated to example.com and clicked the Submit button.',
        pipelineTrace: {
          stages: [],
          totalDurationMs: 5000,
          allStagesSucceeded: true,
          warnings: [],
        },
      };
      expect(artifact.recordingId).toBe('rec-001');
      expect(artifact.metadata.durationMs).toBe(60000);
    });
  });

  describe('PipelineTrace', () => {
    it('should construct with stage traces', () => {
      const trace: PipelineTrace = {
        stages: [{
          stage: 'recognition',
          startedAt: '2025-01-01T00:00:00.000Z',
          completedAt: '2025-01-01T00:00:02.000Z',
          durationMs: 2000,
          succeeded: true,
          error: null,
          metrics: { patternsMatched: 5 },
        }],
        totalDurationMs: 2000,
        allStagesSucceeded: true,
        warnings: [],
      };
      expect(trace.stages).toHaveLength(1);
    });
  });
});

// ── Pipeline Orchestration Type Tests ─────────────────────

describe('Pipeline Orchestration Types', () => {
  describe('PipelineStageName', () => {
    it('should include all five stages', () => {
      const stages: PipelineStageName[] = ['event_grouping', 'recognition', 'lifecycle', 'enrichment', 'output'];
      expect(stages).toHaveLength(5);
    });
  });

  describe('PipelineResult', () => {
    it('should construct with null stages (pipeline not started)', () => {
      const result: PipelineResult = {
        batches: [makeEvidenceBatch()],
        recognition: null,
        lifecycle: null,
        enrichment: null,
        artifact: null,
        stageResults: [],
        totalDurationMs: 0,
        allStagesSucceeded: false,
        trace: { stages: [], totalDurationMs: 0, allStagesSucceeded: false, warnings: [] },
      };
      expect(result.batches).toHaveLength(1);
      expect(result.recognition).toBeNull();
    });

    it('should construct with all stages completed', () => {
      const result: PipelineResult = {
        batches: [makeEvidenceBatch()],
        recognition: { results: [], batchCount: 1, candidateCount: 1, recognisedCount: 1, unrecognisedCount: 0, matchedPatternIds: [], completedAt: '', errors: [] },
        lifecycle: { actions: [], ungrouped: [], interactionCount: 1, actionCount: 1, completedAt: '', errors: [] },
        enrichment: {
          actions: [],
          unrecognised: [],
          contracts: [],
          capabilities: [],
          coverage: { totalInteractiveElements: 0, interactedElements: 0, coverage: 0, uncoveredElements: [] },
          enrichedAt: '',
        },
        artifact: null,
        stageResults: [
          { stage: 'recognition', status: 'completed', durationMs: 100, error: null, metrics: {} },
        ],
        totalDurationMs: 100,
        allStagesSucceeded: true,
        trace: { stages: [], totalDurationMs: 100, allStagesSucceeded: true, warnings: [] },
      };
      expect(result.recognition).not.toBeNull();
    });
  });

  describe('Messaging Types', () => {
    it('ContentToSWMessage should support EVIDENCE_BATCH_DELIVERED', () => {
      const msg: ContentToSWMessage = {
        type: 'EVIDENCE_BATCH_DELIVERED',
        batch: makeEvidenceBatch(),
      };
      expect(msg.type).toBe('EVIDENCE_BATCH_DELIVERED');
    });

    it('ContentToSWMessage should support PING', () => {
      const msg: ContentToSWMessage = { type: 'PING', tabId: 1, alive: true, url: 'https://example.com' };
      expect(msg.type).toBe('PING');
    });

    it('SWToPanelMessage should support PIPELINE_PROGRESS', () => {
      const msg: SWToPanelMessage = {
        type: 'PIPELINE_PROGRESS',
        stage: 'recognition',
        status: 'running',
        metrics: { batchesProcessed: 5 },
      };
      expect(msg.type).toBe('PIPELINE_PROGRESS');
    });

    it('PanelToSWMessage should support START_RECORDING', () => {
      const msg: PanelToSWMessage = { type: 'START_RECORDING' };
      expect(msg.type).toBe('START_RECORDING');
    });
  });
});

// ── Existing Types Unchanged ──────────────────────────────

describe('Existing Types Are Unchanged', () => {
  it('shared/types RecordingState enum still has exactly 3 states', async () => {
    const mod = await import('../../../src/shared/types');
    expect(mod.RecordingState.Ready).toBe('ready');
    expect(mod.RecordingState.Recording).toBe('recording');
    expect(mod.RecordingState.Stopped).toBe('stopped');
    expect(Object.keys(mod.RecordingState)).toHaveLength(3);
  });

  it('shared/types ElementIdentity still has elementId field', async () => {
    const mod = await import('../../../src/shared/types');
    type ElemIdentity = import('../../../src/shared/types').ElementIdentity;
    const identity: ElemIdentity = {
      elementId: 'elem-0001',
      accessibleName: 'Test',
      ariaRole: 'button',
      ariaLabel: null,
      ariaLabelledBy: null,
      placeholder: null,
      tag: 'BUTTON',
      className: null,
      name: null,
      stableId: null,
      testId: null,
      dataCy: null,
      dataQa: null,
      cssSelector: 'button',
      xPath: '//button',
      inIframe: false,
      shadowDom: false,
    };
    expect(identity.elementId).toBe('elem-0001');
    expect(mod.RecordingState).toBeDefined();
  });

  it('shared/types StorageKeys enum is unchanged', async () => {
    const mod = await import('../../../src/shared/types');
    expect(mod.StorageKeys.UI_STATE).toBe('ui_state');
    expect(mod.StorageKeys.SESSION_EVENTS).toBe('session_events');
  });

  it('foundation types do NOT conflict with existing RecordingState', async () => {
    const sharedMod = await import('../../../src/shared/types');
    expect(sharedMod.RecordingState.Recording).toBeDefined();
    // TargetRecordingState is a type-only export — verify it compiles without error
    const state: import('../../../src/types/foundation').TargetRecordingState = 'recording';
    expect(state).toBe('recording');
  });
});
