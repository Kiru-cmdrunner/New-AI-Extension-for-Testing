/**
 * Workflow Analyzer — identifies and tracks workflow progression.
 *
 * Phase 3 Task 7 (G6).
 *
 * Implements workflow analysis for the Mental Model (L2 layer).
 * Uses pattern matching on the Timeline to identify common workflows
 * (login, checkout, form submission, search, navigation) and tracks
 * progression through the workflow steps.
 *
 * This is a deterministic analysis tool. It does NOT call AI — it
 * provides evidence for the AI Observer to use in forming hypotheses.
 *
 * The Workflow Analyzer's output (WorkflowHypothesis) is advisory.
 * It feeds into the Mental Model's workflow sub-domain.
 */

import type { SessionEvent, ElementIdentity } from '../../shared/types';
import type { WorkflowHypothesis } from '../../shared/architecture-types';

// ── Workflow Patterns ──────────────────────────────────────

/**
 * A workflow pattern definition.
 *
 * Patterns are matched by examining the sequence of interaction types
 * and element characteristics in the Timeline.
 */
interface WorkflowPattern {
  /** Workflow type identifier. */
  type: string;
  /** Human-readable description. */
  description: string;
  /** Estimated total steps. */
  estimatedSteps: number;
  /** Signals that indicate this workflow. Each entry is a regex or string check. */
  signals: {
    /** Element names/roles that indicate this workflow. */
    elementSignals: RegExp[];
    /** Action types that indicate this workflow. */
    actionTypes: string[];
  };
}

/**
 * Known workflow patterns.
 *
 * Ordered by specificity (most specific first).
 * The analyzer tries each pattern and reports the best match.
 */
const WORKFLOW_PATTERNS: WorkflowPattern[] = [
  {
    type: 'login',
    description: 'User authentication (login)',
    estimatedSteps: 3,
    signals: {
      elementSignals: [
        /(password|passwd|pwd)/i,
        /(username|user|email|login)/i,
        /(sign\s*in|log\s*in|submit)/i,
        /(remember|forgot|2fa|otp|verification)/i,
      ],
      actionTypes: ['text', 'click'],
    },
  },
  {
    type: 'checkout',
    description: 'E-commerce checkout process',
    estimatedSteps: 6,
    signals: {
      elementSignals: [
        /(cart|checkout|basket)/i,
        /(payment|card|cvv|expiry|billing)/i,
        /(shipping|address|delivery|postal|zip)/i,
        /(place\s*order|confirm\s*order|complete\s*purchase)/i,
        /(coupon|promo|discount)/i,
      ],
      actionTypes: ['text', 'click', 'select'],
    },
  },
  {
    type: 'form-submission',
    description: 'General form filling and submission',
    estimatedSteps: 5,
    signals: {
      elementSignals: [
        /(submit|save|apply|confirm)/i,
        /(form|field|input|required)/i,
        /(first\s*name|last\s*name|phone|address|email)/i,
      ],
      actionTypes: ['text', 'click', 'select', 'checkbox', 'radio', 'dateSelect'],
    },
  },
  {
    type: 'search',
    description: 'Search or filter operation',
    estimatedSteps: 2,
    signals: {
      elementSignals: [
        /(search|query|find|filter)/i,
        /(sort|order\s*by)/i,
      ],
      actionTypes: ['text', 'click', 'select'],
    },
  },
  {
    type: 'navigation',
    description: 'Page navigation and browsing',
    estimatedSteps: 4,
    signals: {
      elementSignals: [
        /(menu|nav|sidebar|link|breadcrumb)/i,
      ],
      actionTypes: ['click', 'hover'],
    },
  },
  {
    type: 'data-entry',
    description: 'Data entry into fields or grids',
    estimatedSteps: 5,
    signals: {
      elementSignals: [
        /(add|new|create|edit|update)/i,
        /(table|grid|row|column|cell)/i,
        /(date|time|amount|quantity)/i,
      ],
      actionTypes: ['text', 'select', 'dateSelect', 'click'],
    },
  },
  {
    type: 'configuration',
    description: 'Settings or configuration changes',
    estimatedSteps: 4,
    signals: {
      elementSignals: [
        /(settings|preferences|config|options)/i,
        /(enable|disable|toggle|checkbox|switch)/i,
        /(theme|language|timezone|notification)/i,
      ],
      actionTypes: ['click', 'select', 'checkbox', 'toggle'],
    },
  },
];

// ── Analysis ───────────────────────────────────────────────

/**
 * Result of analyzing a single event against workflow patterns.
 */
interface PatternMatch {
  type: string;
  score: number;
}

/**
 * Score how well a single event matches a workflow pattern.
 *
 * Returns a score from 0 (no match) to 1 (strong match).
 */
function scoreEventForPattern(
  event: SessionEvent,
  pattern: WorkflowPattern,
): number {
  let score = 0;

  // Check action type
  if (pattern.signals.actionTypes.includes(event.type)) {
    score += 0.3;
  }

  // Check element signals
  const identity = getElementIdentity(event);
  if (identity) {
    const text = [
      identity.accessibleName,
      identity.tag,
      identity.ariaRole,
    ].filter(Boolean).join(' ');

    for (const signal of pattern.signals.elementSignals) {
      if (signal.test(text)) {
        score += 0.4;
        break; // Only count once per event
      }
    }
  }

  return Math.min(1, score);
}

/**
 * Safely extract element identity from a session event.
 * NavigationEvent has no elementIdentity — returns null for it.
 */
function getElementIdentity(event: SessionEvent): ElementIdentity | null {
  if (!('elementIdentity' in event)) return null;
  return event.elementIdentity;
}

/**
 * Analyze a Timeline to identify the current workflow.
 *
 * Examines the last N events (sliding window) and returns the best-matching
 * workflow pattern with a confidence score.
 *
 * @param timeline - The recorded session events.
 * @param windowSize - How many recent events to examine (default 10).
 * @returns WorkflowHypothesis or null if no pattern matches.
 */
export function analyzeWorkflow(
  timeline: SessionEvent[],
  windowSize: number = 10,
): WorkflowHypothesis | null {
  if (timeline.length === 0) return null;

  // Use the last N events
  const window = timeline.slice(-windowSize);

  // Score each pattern across the window
  const matches: PatternMatch[] = [];

  for (const pattern of WORKFLOW_PATTERNS) {
    let totalScore = 0;
    for (const event of window) {
      totalScore += scoreEventForPattern(event, pattern);
    }
    // Normalize: average score per event
    const avgScore = totalScore / window.length;
    matches.push({ type: pattern.type, score: avgScore });
  }

  // Find the best match
  matches.sort((a, b) => b.score - a.score);
  const best = matches[0];

  if (best.score < 0.15) {
    // Below threshold — return "unknown" workflow
    return {
      workflowType: 'unknown',
      currentStep: window.length,
      totalSteps: null,
      expectedNextAction: null,
      confidence: 0.05,
    };
  }

  // Find the pattern definition for step estimation
  const patternDef = WORKFLOW_PATTERNS.find((p) => p.type === best.type)!;

  // Estimate current step (how many events matched this pattern)
  let matchedSteps = 0;
  for (const event of window) {
    if (scoreEventForPattern(event, patternDef) > 0) {
      matchedSteps++;
    }
  }

  // Predict next action
  const expectedNextAction = predictNextAction(best.type, matchedSteps);

  return {
    workflowType: best.type,
    currentStep: matchedSteps,
    totalSteps: patternDef.estimatedSteps,
    expectedNextAction,
    confidence: Math.min(0.95, Math.max(0.05, best.score)),
  };
}

/**
 * Predict the likely next action in a workflow.
 *
 * This is a simple heuristic — not AI. It provides a hint for the
 * Mental Model's expected behaviour sub-domain.
 */
function predictNextAction(workflowType: string, currentStep: number): string | null {
  const predictions: Record<string, string[]> = {
    login: ['Enter username/email', 'Enter password', 'Click login button', 'Handle 2FA if prompted'],
    checkout: ['Enter shipping address', 'Select shipping method', 'Enter payment details', 'Review order', 'Place order'],
    'form-submission': ['Fill required fields', 'Review form', 'Click submit'],
    search: ['Enter search query', 'Review results'],
    navigation: ['Click navigation link', 'Wait for page load'],
    'data-entry': ['Fill data fields', 'Save or submit entry'],
    configuration: ['Change settings', 'Save configuration'],
  };

  const steps = predictions[workflowType];
  if (!steps || currentStep >= steps.length) return null;
  return steps[currentStep];
}

/**
 * Get a human-readable description for a workflow type.
 */
export function getWorkflowDescription(workflowType: string): string {
  const pattern = WORKFLOW_PATTERNS.find((p) => p.type === workflowType);
  return pattern?.description ?? 'Unknown workflow';
}

/**
 * Get all recognized workflow types.
 */
export function getKnownWorkflowTypes(): string[] {
  return WORKFLOW_PATTERNS.map((p) => p.type);
}
