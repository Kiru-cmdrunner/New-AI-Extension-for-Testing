/**
 * Phase 3 Real-World Validation Harness
 *
 * Exercises the full recording pipeline:
 *   ObservedEvent[] → ComponentRuntime → ComponentInteraction[]
 *   → IR Bridge → ExecutionIRPlan → Playwright test file
 *
 * Each capability produces a structured Finding with 8 quality dimension scores.
 * No assertions are fixed during the pass — this is observation only.
 */

import { describe, it } from 'vitest';
import { createRuntime, type ComponentRuntime } from '../../src/runtime/component-runtime';
import { ALL_DEFINITIONS } from '../../src/definitions';
import { build as buildIRPlan } from '../../src/generation/ir-bridge';
import type { IRBridgeInput } from '../../src/generation/ir-bridge-input';
import { renderTestFile } from '../../src/adapters/playwright/test-function-renderer';
import type {
  ComponentInteraction,
  ObservedEvent,
  BrowserEventType,
  ElementIdentity,
  DomContext,
  RuntimeConfig,
} from '../../src/shared/component-types';
import { IRAction } from '../../src/domain/execution-ir/types';
import type { LocatorStrategyType } from '../../src/domain/enums';

// ─── Quality Dimensions ───────────────────────────────────────────────

export interface QualityScores {
  q1_intent: number;       // Classification correctness
  q2_abstraction: number;  // Right granularity, no over-fragmentation
  q3_locator: number;      // Locator robustness and readability
  q4_description: number;  // Human-readable semantic description
  q5_replay: number;       // Would the generated code work?
  q6_confidence: number;   // Does confidence match reality?
  q7_evidence: number;     // Evidence trail quality
  q8_assertion: number;    // Assertion meaningfulness and correctness
}

export interface Finding {
  capabilityId: string;
  capabilityName: string;
  scenario: string;
  app: string;
  expected: string;
  observed: string;
  scores: QualityScores;
  supportLevel: 'full' | 'partial' | 'unsupported' | 'not_tested';
  rootCause: string;
  severity: 'P0' | 'P1' | 'P2' | 'P3';
  emitted: ComponentInteraction[];
  plan: ReturnType<typeof buildIRPlan> | null;
  playwrightCode: string | null;
}

// ─── Pipeline Runner ─────────────────────────────────────────────────

export interface PipelineResult {
  interactions: ComponentInteraction[];
  irPlan: ReturnType<typeof buildIRPlan> | null;
  playwright: string | null;
  error: string | null;
}

export function runFullPipeline(
  events: ObservedEvent[],
  options: {
    startUrl?: string;
    pageTitle?: string;
    testCaseName?: string;
  } = {},
): PipelineResult {
  const startUrl = options.startUrl ?? 'https://example.com';
  const pageTitle = options.pageTitle ?? 'Test Page';
  const testCaseName = options.testCaseName ?? 'Validation Test';

  // Stage 1: Runtime — events → interactions
  let interactions: ComponentInteraction[] = [];
  const config: RuntimeConfig = { onEmit: (i) => interactions.push(i) };
  const runtime = createRuntime(ALL_DEFINITIONS, config);

  for (const event of events) {
    try {
      runtime.process(event);
    } catch (e) {
      // Continue — record the error
    }
  }
  runtime.flush();

  // Stage 2: IR Bridge — interactions → plan
  let irPlan: ReturnType<typeof buildIRPlan> | null = null;
  let playwright: string | null = null;
  let error: string | null = null;

  try {
    const input: IRBridgeInput = {
      events: [],
      interactions,
      understanding: null,
      recordingContext: { startUrl, title: pageTitle },
      testCaseName,
    };
    irPlan = buildIRPlan(input);

    // Stage 3: Playwright — plan → test file
    playwright = renderTestFile(irPlan);
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  }

  return { interactions, irPlan, playwright, error };
}

// ─── Fixture Builders ────────────────────────────────────────────────

export function makeTarget(overrides: Partial<ElementIdentity> = {}): ElementIdentity {
  return {
    accessibleName: '',
    ariaRole: null,
    ariaLabel: null,
    ariaLabelledBy: null,
    placeholder: null,
    tag: 'DIV',
    className: null,
    name: null,
    stableId: null,
    testId: null,
    dataCy: null,
    dataQa: null,
    cssSelector: 'div',
    xPath: '/html/body/div',
    inIframe: false,
    shadowDom: false,
    elementId: '',
    ...overrides,
  };
}

export function makeContext(overrides: Partial<DomContext> = {}): DomContext {
  return {
    inputType: null,
    ariaExpanded: null,
    ariaHasPopup: null,
    isContentEditable: false,
    disabled: false,
    readOnly: false,
    required: false,
    ancestorRoles: [],
    ancestorClasses: [],
    ...overrides,
  };
}

let _eventCounter = 0;
export function makeEvent(
  eventType: string,
  target: Partial<ElementIdentity>,
  domContext: Partial<DomContext> = {},
  eventOverrides: Partial<ObservedEvent> = {},
): ObservedEvent {
  _eventCounter++;
  return {
    eventId: `evt-${String(_eventCounter).padStart(4, '0')}`,
    eventType: eventType as BrowserEventType,
    timestamp: Date.now() + _eventCounter,
    isTrusted: true,
    target: makeTarget(target),
    domContext: makeContext(domContext),
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
    ...eventOverrides,
  };
}

export function resetEventCounter(): void {
  _eventCounter = 0;
}

// ─── Analysis Helpers ────────────────────────────────────────────────

export function getResolvedType(ci: ComponentInteraction): string {
  return ci.interactionSubtype ?? ci.type;
}

export function getTopLocatorStrategy(plan: ReturnType<typeof buildIRPlan> | null): string | null {
  if (!plan || plan.steps.length === 0) return null;
  const step = plan.steps[0];
  if (step.target.kind === 'element' && step.target.resolvedLocators.length > 0) {
    const loc = step.target.resolvedLocators[0];
    return loc.type;
  }
  return null;
}

export function getAssertions(plan: ReturnType<typeof buildIRPlan> | null): number {
  if (!plan || plan.steps.length === 0) return 0;
  return plan.steps[0].assertions?.length ?? 0;
}

export function getDescription(plan: ReturnType<typeof buildIRPlan> | null): string {
  if (!plan || plan.steps.length === 0) return '';
  return plan.steps[0].description ?? '';
}

export function getPlaywrightAction(code: string | null, line: number = 0): string {
  if (!code) return '';
  const lines = code.split('\n').filter(l => l.trim().startsWith('await page.'));
  return lines[line]?.trim() ?? '';
}

// ─── Findings Collector ──────────────────────────────────────────────

export const findings: Finding[] = [];

export function recordFinding(f: Finding): void {
  findings.push(f);
  const avg = (
    (f.scores.q1_intent + f.scores.q2_abstraction + f.scores.q3_locator +
     f.scores.q4_description + f.scores.q5_replay + f.scores.q6_confidence +
     f.scores.q7_evidence + f.scores.q8_assertion) / 8
  ).toFixed(1);
  console.log(
    `[${f.capabilityId}] ${f.scenario}\n` +
    `  Expected: ${f.expected}\n` +
    `  Observed: ${f.observed}\n` +
    `  Support: ${f.supportLevel} | Avg: ${avg} | Severity: ${f.severity}\n` +
    `  Root cause: ${f.rootCause}\n`
  );
}
