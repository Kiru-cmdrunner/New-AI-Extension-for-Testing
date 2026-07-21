import { describe, it, expect } from 'vitest';
import type {
  ElementDescriptor,
  DeterministicState,
  Hypothesis,
  WorkflowHypothesis,
  ChangeAnalysis,
  ConfidenceState,
  MentalModel,
  ContextUpdate,
  SessionContext,
  CanonicalType,
  ClassifiedInteraction,
  ClassificationEvidence,
  SpecCanonicalStep,
  ReviewItem,
  ValidationResult,
  EvidenceBundle,
  AuditEvent,
  LogEntry,
  ErrorObject,
} from '../src/shared/architecture-types';
import type { SessionEvent, TestStep } from '../src/shared/types';

// Helper factory functions to create valid instances for type checking

function makeSessionEvent(): SessionEvent {
  return {
    actionId: 'nav-0001',
    type: 'navigation',
    url: 'https://example.com',
    title: 'Example',
    timestamp: '2026-07-17T00:00:00Z',
  };
}

function makeTestStep(): TestStep {
  return {
    stepId: 'step-0001',
    plainEnglish: 'Navigate to example.com',
    actionId: 'nav-0001',
    elementId: 'elem-0001',
    executionJson: {
      action: 'navigate',
      actionId: 'nav-0001',
      elementId: 'elem-0001',
      primaryLocator: { type: 'css', value: 'body' },
      fallbackLocators: [],
      tag: 'body',
      accessibleName: '',
      ariaRole: null,
      inIframe: false,
      shadowDom: false,
    },
    aiConfidence: 0,
    timestamp: '2026-07-17T00:00:00Z',
  };
}

describe('Architecture data model types', () => {

  describe('Context Layer', () => {
    it('ElementDescriptor has all required fields', () => {
      const d: ElementDescriptor = {
        tag: 'button',
        role: 'button',
        accessibleName: 'Submit',
        className: 'btn-primary',
      };
      expect(d.tag).toBe('button');
      expect(d.className).toBe('btn-primary');
    });

    it('ElementDescriptor accepts null role and className', () => {
      const d: ElementDescriptor = {
        tag: 'div',
        role: null,
        accessibleName: '',
        className: null,
      };
      expect(d.role).toBeNull();
      expect(d.className).toBeNull();
    });

    it('DeterministicState has all required fields', () => {
      const s: DeterministicState = {
        currentUrl: 'https://example.com',
        pageTitle: 'Example',
        openDialogs: [],
        openDropdowns: [],
        activeForm: null,
        activeElement: null,
      };
      expect(s.currentUrl).toBe('https://example.com');
      expect(s.activeElement).toBeNull();
    });

    it('DeterministicState accepts populated element descriptors', () => {
      const dialog: ElementDescriptor = {
        tag: 'div', role: 'dialog', accessibleName: 'Settings', className: 'modal',
      };
      const s: DeterministicState = {
        currentUrl: 'https://example.com/settings',
        pageTitle: 'Settings',
        openDialogs: [dialog],
        openDropdowns: [],
        activeForm: null,
        activeElement: { tag: 'input', role: 'textbox', accessibleName: 'Name', className: 'form-control' },
      };
      expect(s.openDialogs).toHaveLength(1);
      expect(s.activeElement?.tag).toBe('input');
    });

    it('Hypothesis has primary, confidence, evidence, alternatives', () => {
      const h: Hypothesis = {
        primary: 'Login Form',
        confidence: 0.85,
        evidence: ['click-0001', 'text-0002'],
        alternatives: [
          { value: 'Registration Form', confidence: 0.15 },
        ],
      };
      expect(h.primary).toBe('Login Form');
      expect(h.evidence).toHaveLength(2);
      expect(h.alternatives).toHaveLength(1);
    });

    it('Hypothesis accepts empty alternatives', () => {
      const h: Hypothesis = {
        primary: 'Button',
        confidence: 0.5,
        evidence: [],
        alternatives: [],
      };
      expect(h.alternatives).toHaveLength(0);
    });

    it('WorkflowHypothesis has all required fields', () => {
      const w: WorkflowHypothesis = {
        workflowType: 'login',
        currentStep: 2,
        totalSteps: 4,
        expectedNextAction: 'Click submit button',
        confidence: 0.8,
      };
      expect(w.workflowType).toBe('login');
      expect(w.totalSteps).toBe(4);
    });

    it('WorkflowHypothesis accepts null totalSteps and expectedNextAction', () => {
      const w: WorkflowHypothesis = {
        workflowType: 'unknown',
        currentStep: 1,
        totalSteps: null,
        expectedNextAction: null,
        confidence: 0.1,
      };
      expect(w.totalSteps).toBeNull();
      expect(w.expectedNextAction).toBeNull();
    });

    it('ChangeAnalysis has all required fields', () => {
      const c: ChangeAnalysis = {
        changeType: 'page-navigation',
        description: 'Navigated to dashboard',
        confidence: 0.9,
        matchesExpected: true,
      };
      expect(c.changeType).toBe('page-navigation');
      expect(c.matchesExpected).toBe(true);
    });

    it('ConfidenceState has 5 tracks and composite', () => {
      const c: ConfidenceState = {
        intent: 0.35,
        workflow: 0.25,
        appFocus: 0.15,
        uiFocus: 0.15,
        change: 0.10,
        composite: 0.28,
      };
      expect(c.intent).toBe(0.35);
      expect(c.composite).toBe(0.28);
    });

    it('ConfidenceState respects P5 bounds (0.05–0.95)', () => {
      const c: ConfidenceState = {
        intent: 0.95,
        workflow: 0.05,
        appFocus: 0.5,
        uiFocus: 0.5,
        change: 0.5,
        composite: 0.6,
      };
      expect(c.intent).toBeLessThanOrEqual(0.95);
      expect(c.workflow).toBeGreaterThanOrEqual(0.05);
    });

    it('MentalModel has all 5 domains + confidence + lastUpdated', () => {
      const m: MentalModel = {
        appIdentity: null,
        workflow: null,
        currentFocus: null,
        userIntent: null,
        recentChange: null,
        confidence: {
          intent: 0.3, workflow: 0.3, appFocus: 0.3, uiFocus: 0.3, change: 0.3, composite: 0.3,
        },
        lastUpdated: '2026-07-17T00:00:00Z',
      };
      expect(m.appIdentity).toBeNull();
      expect(m.confidence.composite).toBe(0.3);
      expect(m.lastUpdated).toBeTruthy();
    });

    it('MentalModel accepts populated hypotheses', () => {
      const h: Hypothesis = {
        primary: 'Gmail', confidence: 0.9, evidence: ['nav-0001'], alternatives: [],
      };
      const m: MentalModel = {
        appIdentity: h,
        workflow: {
          workflowType: 'compose-email', currentStep: 1, totalSteps: null,
          expectedNextAction: 'Click compose', confidence: 0.7,
        },
        currentFocus: null,
        userIntent: h,
        recentChange: null,
        confidence: {
          intent: 0.7, workflow: 0.5, appFocus: 0.9, uiFocus: 0.3, change: 0.2, composite: 0.57,
        },
        lastUpdated: '2026-07-17T12:00:00Z',
      };
      expect(m.appIdentity?.primary).toBe('Gmail');
      expect(m.workflow?.workflowType).toBe('compose-email');
    });

    it('ContextUpdate discriminates by layer and changeType', () => {
      const u: ContextUpdate = {
        layer: 'L3',
        changeType: 'append',
        timestamp: '2026-07-17T00:00:00Z',
      };
      expect(u.layer).toBe('L3');
      expect(u.changeType).toBe('append');
    });

    it('SessionContext contains all 3 layers', () => {
      const ctx: SessionContext = {
        layer1: {
          currentUrl: 'https://example.com',
          pageTitle: 'Example',
          openDialogs: [],
          openDropdowns: [],
          activeForm: null,
          activeElement: null,
        },
        layer2: null,
        layer3: [makeSessionEvent()],
      };
      expect(ctx.layer1.currentUrl).toBe('https://example.com');
      expect(ctx.layer2).toBeNull();
      expect(ctx.layer3).toHaveLength(1);
    });
  });

  describe('Intelligence Layer', () => {
    it('CanonicalType includes all 10 types', () => {
      const types: CanonicalType[] = [
        'navigate', 'click', 'fill', 'select', 'toggle',
        'selectDate', 'hover', 'pressKey', 'upload', 'drag',
      ];
      expect(types).toHaveLength(10);
    });

    it('ClassifiedInteraction has canonicalType, tier, evidence', () => {
      const ci: ClassifiedInteraction = {
        canonicalType: 'click',
        actionId: 'click-0001',
        originalEvent: makeSessionEvent(),
        classificationTier: 1,
        evidence: 'Rule R1: click event on <button> element',
      };
      expect(ci.canonicalType).toBe('click');
      expect(ci.classificationTier).toBe(1);
    });

    it('ClassifiedInteraction supports tier 2 (advisory AI)', () => {
      const ci: ClassifiedInteraction = {
        canonicalType: 'fill',
        actionId: 'text-0001',
        originalEvent: makeSessionEvent(),
        classificationTier: 2,
        evidence: 'Tier 2: AI advisory indicated form field input',
      };
      expect(ci.classificationTier).toBe(2);
    });

    it('ClassifiedInteraction supports tier 3 (default click)', () => {
      const ci: ClassifiedInteraction = {
        canonicalType: 'click',
        actionId: 'click-0009',
        originalEvent: makeSessionEvent(),
        classificationTier: 3,
        evidence: 'Tier 3: default classification (no rule matched)',
      };
      expect(ci.classificationTier).toBe(3);
    });

    it('ClassificationEvidence has ruleId, description, signals, tier', () => {
      const ce: ClassificationEvidence = {
        ruleId: 'R3',
        ruleDescription: 'Native <select> change event',
        matchedSignals: ['change-event', 'element-tag=SELECT'],
        tier: 1,
      };
      expect(ce.ruleId).toBe('R3');
      expect(ce.matchedSignals).toHaveLength(2);
    });

    it('SpecCanonicalStep has nullable executionJson and elementId', () => {
      const step: SpecCanonicalStep = {
        stepId: 'step-0001',
        plainEnglish: 'Navigate to example.com',
        actionId: 'nav-0001',
        elementId: null,
        aiConfidence: 0,
        timestamp: '2026-07-17T00:00:00Z',
        executionJson: null,
      };
      expect(step.executionJson).toBeNull();
      expect(step.elementId).toBeNull();
    });
  });

  describe('Review Layer', () => {
    it('ReviewItem has status, originalStep, editedStep', () => {
      const step = makeTestStep();
      const ri: ReviewItem = {
        stepId: 'step-0001',
        status: 'pending',
        originalStep: step,
        editedStep: null,
      };
      expect(ri.status).toBe('pending');
      expect(ri.editedStep).toBeNull();
    });

    it('ReviewItem supports approved and edited states', () => {
      const step = makeTestStep();
      const edited: TestStep = { ...step, plainEnglish: 'Navigate to dashboard' };
      const ri: ReviewItem = {
        stepId: 'step-0001',
        status: 'edited',
        originalStep: step,
        editedStep: edited,
        reviewNotes: 'Changed description for clarity',
      };
      expect(ri.status).toBe('edited');
      expect(ri.editedStep?.plainEnglish).toBe('Navigate to dashboard');
    });

    it('ValidationResult has passed, errors, warnings', () => {
      const vr: ValidationResult = {
        stepId: 'step-0001',
        passed: true,
        errors: [],
        warnings: ['Locator uses tag name only'],
      };
      expect(vr.passed).toBe(true);
      expect(vr.warnings).toHaveLength(1);
    });

    it('ValidationResult can fail with errors', () => {
      const vr: ValidationResult = {
        stepId: 'step-0002',
        passed: false,
        errors: ['No locators generated'],
        warnings: [],
      };
      expect(vr.passed).toBe(false);
      expect(vr.errors).toHaveLength(1);
    });

    it('EvidenceBundle has all evidence fields', () => {
      const eb: EvidenceBundle = {
        actionId: 'click-0001',
        screenshot: null,
        elementIdentity: null,
        classificationEvidence: null,
        aiUnderstanding: null,
      };
      expect(eb.actionId).toBe('click-0001');
    });
  });

  describe('Infrastructure Layer', () => {
    it('AuditEvent has type, timestamp, entityId, details', () => {
      const ae: AuditEvent = {
        type: 'recording-started',
        timestamp: '2026-07-17T00:00:00Z',
        entityId: 'session-001',
        details: { url: 'https://example.com' },
      };
      expect(ae.type).toBe('recording-started');
      expect(ae.details.url).toBe('https://example.com');
    });

    it('LogEntry has level, category, message, timestamp', () => {
      const le: LogEntry = {
        level: 'info',
        category: 'recorder',
        message: 'Click captured on button#submit',
        timestamp: '2026-07-17T00:00:00Z',
      };
      expect(le.level).toBe('info');
      expect(le.category).toBe('recorder');
    });

    it('LogEntry supports all 4 levels', () => {
      const levels: LogEntry['level'][] = ['debug', 'info', 'warn', 'error'];
      expect(levels).toHaveLength(4);
    });

    it('LogEntry optional data field', () => {
      const le: LogEntry = {
        level: 'warn',
        category: 'generation',
        message: 'Locator strategy fallback used',
        timestamp: '2026-07-17T00:00:00Z',
        data: { strategy: 'tag-name', stepId: 'step-0001' },
      };
      expect(le.data?.strategy).toBe('tag-name');
    });

    it('ErrorObject has code, message, component, recoverable', () => {
      const e: ErrorObject = {
        code: 'AI_TIMEOUT',
        message: 'AI provider did not respond within 10s',
        component: 'AIObserver',
        recoverable: true,
      };
      expect(e.code).toBe('AI_TIMEOUT');
      expect(e.recoverable).toBe(true);
    });

    it('ErrorObject optional context field', () => {
      const e: ErrorObject = {
        code: 'LOCATOR_RESOLUTION_FAILED',
        message: 'No locators could be generated',
        component: 'LocatorResolutionEngine',
        recoverable: false,
        context: { stepId: 'step-0001', tag: 'div' },
      };
      expect(e.context?.stepId).toBe('step-0001');
      expect(e.recoverable).toBe(false);
    });
  });
});
