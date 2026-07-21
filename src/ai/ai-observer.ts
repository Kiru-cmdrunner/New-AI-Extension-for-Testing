/**
 * AI Observer — Architecture C Phase 6
 *
 * Blueprint: .drytis/architecture-c-production.md §6
 *
 * Enhances AI from "decorative enrichment" to "structural advisory classification."
 * The AI Observer receives SnapshotForAI (rich semantic context), calls the LLM
 * via the provider system, returns AIIntentResult (classification advisory), and
 * updates the Mental Model (L2 of Session Context).
 *
 * Key principles:
 *   P1: Observation First — AI sees semantics, not mechanics
 *   P5: Never Absolute — confidence clamped to [0.05, 0.95]
 *   P7: Prefer Null Over Fabrication — hallucination rejection
 *   AP4: Evidence Sovereignty — deterministic evidence always overrides AI
 */

import type {
  SnapshotForAI,
  AIIntentResult,
  CanonicalType,
} from '../shared/evidence-types';
import type {
  MentalModel,
  Hypothesis,
  WorkflowHypothesis,
  SessionContext,
} from '../shared/architecture-types';
import { AIService } from './ai-service';
import { ProviderManager } from './provider-manager';
import { isDateLikeValue } from '../shared/classifier-constants';
import {
  clampConfidence,
  updateConfidence,
  createDefaultConfidence,
} from '../generation/engine/confidence-engine';
import { analyzeWorkflow } from '../generation/engine/workflow-analyzer';
import type { SessionEvent } from '../shared/types';

// ── MV3-safe Mental Model persistence ──────────────────────────────────

/** Storage key for the Mental Model (L2 of Session Context). */
export const MENTAL_MODEL_STORAGE_KEY = 'session_context_l2';

/**
 * Maximum number of competing hypotheses per domain (P4).
 */
export const MAX_HYPOTHESES = 3;

// ── Prompt Construction ────────────────────────────────────────────────

/**
 * Build a semantic prompt for the LLM.
 *
 * The prompt gives the LLM element semantics + behavioral context + session
 * context. It does NOT include raw CSS selectors, XPath, or framework IDs.
 *
 * The LLM is asked to:
 *   1. Classify the interaction type (suggestedType)
 *   2. Provide a human-readable business name
 *   3. Describe the user's intent
 *   4. Rate its confidence (0.0–1.0)
 */
export function buildAIPrompt(snapshot: SnapshotForAI): string {
  const lines: string[] = [];

  lines.push('You are analyzing a user interaction on a web page.');
  lines.push('Based on the semantic context below, classify this interaction.');
  lines.push('');
  lines.push('ELEMENT:');
  lines.push(`  tag: ${snapshot.tagName}`);
  lines.push(`  accessibleName: "${snapshot.accessibleName}"`);
  lines.push(`  ariaRole: ${snapshot.ariaRole ?? 'none'}`);
  lines.push(`  className: ${snapshot.className ?? 'none'}`);
  lines.push('');

  lines.push('BEHAVIORAL CONTEXT:');
  lines.push(`  primaryEvent: ${snapshot.primaryEvent}`);
  lines.push(`  valueChanged: ${snapshot.valueChanged}`);
  if (snapshot.valueChanged) {
    lines.push(`  valueAfter: "${snapshot.valueAfter}"`);
  }
  lines.push(`  stateChanged: ${snapshot.stateChanged}`);
  if (snapshot.dwellTime !== null && snapshot.dwellTime > 0) {
    lines.push(`  dwellTime: ${snapshot.dwellTime}ms`);
  }
  lines.push('');

  lines.push('STRUCTURAL CONTEXT:');
  if (snapshot.ancestorRoles.length > 0) {
    lines.push(`  ancestorRoles: ${snapshot.ancestorRoles.join(' > ')}`);
  }
  lines.push(`  hasCalendarContext: ${snapshot.hasCalendarContext}`);
  lines.push(`  hasDropdownContext: ${snapshot.hasDropdownContext}`);
  lines.push(`  hasFormContext: ${snapshot.hasFormContext}`);
  lines.push('');

  lines.push('SESSION CONTEXT:');
  lines.push(`  currentUrl: ${snapshot.currentUrl}`);
  if (snapshot.precedingType) {
    lines.push(`  precedingInteraction: ${snapshot.precedingType}`);
  }
  if (snapshot.workflowHint) {
    lines.push(`  workflowHint: ${snapshot.workflowHint}`);
  }
  lines.push('');

  lines.push('CLASSIFICATION OPTIONS (pick the most appropriate):');
  lines.push('  click — A button, link, or generic clickable element');
  lines.push('  fill — Text entry into an input field');
  lines.push('  select — Choosing an option from a dropdown/listbox');
  lines.push('  selectDate — Picking a date from a calendar/date picker');
  lines.push('  toggle — Checking/unchecking a checkbox or toggle switch');
  lines.push('  hover — Hovering over an element to trigger a UI change');
  lines.push('  pressKey — Pressing a key (Enter, Escape, Tab, etc.)');
  lines.push('  navigate — Navigating to a different page');
  lines.push('');

  lines.push('Respond with ONLY a JSON object (no markdown, no code blocks):');
  lines.push('{');
  lines.push('  "suggestedType": "<one of the classification options>",');
  lines.push('  "businessName": "<clear, human-readable name for this element>",');
  lines.push('  "userIntent": "<what the user is trying to accomplish>",');
  lines.push('  "confidence": <number 0.0 to 1.0>');
  lines.push('}');

  return lines.join('\n');
}

// ── Response Parsing ──────────────────────────────────────────────────

const VALID_TYPES: CanonicalType[] = [
  'navigate',
  'click',
  'fill',
  'select',
  'toggle',
  'selectDate',
  'hover',
  'pressKey',
  'upload',
  'drag',
];

/**
 * Parse a raw LLM response string into an AIIntentResult.
 *
 * Returns null on any parse failure (graceful degradation).
 * Clamps confidence to [0.05, 0.95] per P5.
 */
export function parseAIResponse(response: string): AIIntentResult | null {
  try {
    // Strip markdown code fences if present
    let cleaned = response.trim();
    if (cleaned.startsWith('```')) {
      cleaned = cleaned.replace(/^```(?:json)?\s*\n?/, '').replace(/\n?```\s*$/, '');
    }

    const parsed = JSON.parse(cleaned);

    // Validate required fields
    if (!parsed.suggestedType || typeof parsed.suggestedType !== 'string') return null;
    if (!parsed.businessName || typeof parsed.businessName !== 'string') return null;
    if (typeof parsed.confidence !== 'number') return null;

    // Validate suggestedType is a known canonical type
    if (!VALID_TYPES.includes(parsed.suggestedType as CanonicalType)) return null;

    const confidence = clampConfidence(parsed.confidence);

    return {
      suggestedType: parsed.suggestedType as CanonicalType,
      businessName: parsed.businessName,
      userIntent: parsed.userIntent ?? '',
      confidence,
    };
  } catch {
    return null; // JSON parse failure
  }
}

// ── Hallucination Rejection (P7) ───────────────────────────────────────

/**
 * Validate AI output against observed evidence.
 *
 * P7: Prefer null over fabrication. If the AI suggests a type that
 * contradicts the available evidence, reject the suggestion.
 *
 * Rejection rules:
 *   - AI says 'selectDate' but no date-like value AND no calendar context → reject
 *   - AI says 'toggle' but no state change evidence → reject
 *   - AI says 'fill' but no value change evidence → reject
 *   - AI says 'navigate' but primary event isn't navigation → reject
 */
export function validateAIResult(
  result: AIIntentResult,
  snapshot: SnapshotForAI,
): boolean {
  switch (result.suggestedType) {
    case 'selectDate':
      // Must have date-like value or calendar context
      if (!snapshot.hasCalendarContext && !isDateLikeValue(snapshot.valueAfter)) {
        return false;
      }
      break;

    case 'toggle':
      // Must have state change evidence
      if (!snapshot.stateChanged) {
        return false;
      }
      break;

    case 'fill':
      // Must have value change evidence
      if (!snapshot.valueChanged) {
        return false;
      }
      break;

    case 'navigate':
      // Navigation events are handled separately, not through AI
      return false;

    case 'hover':
      // Must have dwell time
      if (snapshot.dwellTime === null || snapshot.dwellTime < 500) {
        return false;
      }
      break;
  }

  return true;
}

// ── AI Observer Class ──────────────────────────────────────────────────

/**
 * The AI Observer — receives semantic snapshots, calls the LLM, returns
 * advisory classification, and maintains the Mental Model (L2).
 *
 * Lifecycle:
 *   const observer = new AIObserver();
 *   const result = await observer.understand(snapshotForAI, sessionContext);
 *   if (result) { use result.suggestedType, result.businessName, etc. }
 */
export class AIObserver {
  private mentalModel: MentalModel | null = null;
  private timeline: SessionEvent[] = [];

  /**
   * Understand a single interaction.
   *
   * @returns AIIntentResult on success, null on any failure (P7: prefer null).
   */
  async understand(
    snapshot: SnapshotForAI,
    sessionContext: SessionContext | null,
  ): Promise<AIIntentResult | null> {
    // 1. Resolve the active provider
    const resolved = await AIService.resolve();
    if (!resolved) return null; // no provider configured

    const provider = ProviderManager.get(resolved.providerId);
    if (!provider || !provider.implemented) return null;

    // 2. Build prompt from semantic snapshot
    const prompt = buildAIPrompt(snapshot);

    // 3. Call LLM
    let response: string;
    try {
      const result = await provider.sendPrompt(resolved.config, prompt);
      if (!result.success || !result.response) return null;
      response = result.response;
    } catch {
      return null; // provider error — graceful degradation
    }

    // 4. Parse and validate response
    const parsed = parseAIResponse(response);
    if (!parsed) return null;

    // 5. P7: Hallucination rejection
    if (!validateAIResult(parsed, snapshot)) return null;

    // 6. Update Mental Model (L2)
    this.updateMentalModel(parsed, snapshot, sessionContext);

    return parsed;
  }

  /**
   * Get the current Mental Model (L2 of Session Context).
   */
  getMentalModel(): MentalModel | null {
    return this.mentalModel;
  }

  /**
   * Reset the Mental Model (called on START_RECORDING).
   */
  reset(): void {
    this.mentalModel = null;
    this.timeline = [];
  }

  /**
   * Set the current Timeline (L3) so the Workflow Analyzer has up-to-date events.
   *
   * Called by the pipeline each time a new event is appended.
   */
  setTimeline(events: SessionEvent[]): void {
    this.timeline = events;
  }

  /**
   * Persist the Mental Model (L2) to chrome.storage.local.
   *
   * MV3 safety: the service worker can be killed at any time. Persisting L2
   * ensures we don't lose progressive understanding between SW restarts.
   *
   * This is fire-and-forget — failures are silently ignored (the in-memory
   * model is still valid for the current session).
   */
  async persistMentalModel(): Promise<void> {
    if (!this.mentalModel) return;
    try {
      // chrome.storage may be unavailable in unit tests — guard.
      if (typeof chrome !== 'undefined' && chrome.storage?.local) {
        await chrome.storage.local.set({
          [MENTAL_MODEL_STORAGE_KEY]: this.mentalModel,
        });
      }
    } catch {
      // Silent: persistence is best-effort, not critical.
    }
  }

  /**
   * Load a previously persisted Mental Model from chrome.storage.local.
   *
   * Called on service worker restart to restore L2 state.
   */
  async loadMentalModel(): Promise<void> {
    try {
      if (typeof chrome !== 'undefined' && chrome.storage?.local) {
        const result = await chrome.storage.local.get(MENTAL_MODEL_STORAGE_KEY);
        const stored = result[MENTAL_MODEL_STORAGE_KEY];
        if (stored) {
          this.mentalModel = stored as MentalModel;
        }
      }
    } catch {
      // Silent: if storage fails, we start fresh — not an error.
    }
  }

  /**
   * Clear the persisted Mental Model from storage (called on STOP_RECORDING).
   */
  async clearPersistedMentalModel(): Promise<void> {
    try {
      if (typeof chrome !== 'undefined' && chrome.storage?.local) {
        await chrome.storage.local.remove(MENTAL_MODEL_STORAGE_KEY);
      }
    } catch {
      // Silent.
    }
  }

  // ── Mental Model (L2) Updates ─────────────────────────────────────────

  /**
   * Update the Mental Model with the latest AI understanding.
   *
   * P4: max 3 competing hypotheses per domain.
   * P5: confidence clamped to [0.05, 0.95].
   *
   * Progressive understanding: hypotheses are refined across interactions.
   * When a new observation agrees with the existing primary hypothesis,
   * confidence increases. When it disagrees, the primary is demoted to
   * alternatives and a new primary is established.
   */
  private updateMentalModel(
    result: AIIntentResult,
    snapshot: SnapshotForAI,
    sessionContext: SessionContext | null,
  ): void {
    const now = new Date().toISOString();

    // ── Progressive hypothesis refinement (P4) ──

    // User intent: refine if we have prior state
    const prevIntent = this.mentalModel?.userIntent ?? null;
    const userIntent: Hypothesis = this.refineHypothesis(
      prevIntent,
      result.userIntent || result.businessName,
      result.confidence,
    );

    // Current focus: the element business name
    const prevFocus = this.mentalModel?.currentFocus ?? null;
    const currentFocus: Hypothesis = this.refineHypothesis(
      prevFocus,
      result.businessName,
      result.confidence * 0.8, // slightly less confident about focus
    );

    // App identity from URL (stable across session)
    const prevApp = this.mentalModel?.appIdentity ?? null;
    const appName = this.extractAppIdentity(snapshot.currentUrl);
    const appIdentity: Hypothesis = this.refineHypothesis(
      prevApp,
      appName,
      appName === prevApp?.primary ? 0.8 : 0.5,
    );

    // Workflow analysis from Timeline — use the internal timeline which
    // is kept in sync by the pipeline via setTimeline().
    let workflow: WorkflowHypothesis | null = null;
    if (this.timeline.length > 0) {
      workflow = analyzeWorkflow(this.timeline);
    } else if (sessionContext) {
      workflow = analyzeWorkflow(sessionContext.layer3);
    }

    // Compute 5-track confidence
    const previousConfidence = this.mentalModel?.confidence ?? createDefaultConfidence();
    const confidence = updateConfidence({
      previous: previousConfidence,
      aiConfidence: result.confidence,
      evidenceSupportsIntent: true,
      workflowFit: workflow?.confidence ?? 0.3,
      actionFitsWorkflow: workflow !== null,
      elementMatchesApp: 0.5, // neutral — would need app-specific knowledge
      elementMatchesUI: 0.5,
      changeIsExpected: 0.5,
      changeMatchesExpected: true,
    });

    // Recent change analysis
    const recentChange = sessionContext?.layer2?.recentChange ?? null;

    this.mentalModel = {
      appIdentity,
      workflow,
      currentFocus,
      userIntent,
      recentChange,
      confidence,
      lastUpdated: now,
    };

    // MV3-safe persistence (fire-and-forget).
    void this.persistMentalModel();
  }

  /**
   * Refine a hypothesis with progressive understanding (P4).
   *
   * - If the new value matches the existing primary, increase confidence.
   * - If the new value is different, the existing primary becomes an alternative
   *   and the new value becomes primary with its own confidence.
   * - P4: max MAX_HYPOTHESES (3) competing hypotheses (alternatives array trimmed).
   */
  private refineHypothesis(
    previous: Hypothesis | null,
    newValue: string,
    newConfidence: number,
  ): Hypothesis {
    const clamped = clampConfidence(newConfidence);

    if (previous && previous.primary === newValue) {
      // Agreement: increase confidence (progressive confirmation)
      return {
        primary: previous.primary,
        confidence: clampConfidence(previous.confidence + (clamped - previous.confidence) * 0.5),
        evidence: previous.evidence,
        alternatives: previous.alternatives,
      };
    }

    // New value differs: old primary → alternative, new value → primary
    const alternatives: { value: string; confidence: number }[] = [];
    if (previous) {
      alternatives.push({ value: previous.primary, confidence: previous.confidence });
      // Merge old alternatives
      for (const alt of previous.alternatives) {
        if (alt.value !== newValue && !alternatives.some(a => a.value === alt.value)) {
          alternatives.push(alt);
        }
      }
    }
    // P4: enforce max 3 alternatives
    alternatives.splice(MAX_HYPOTHESES);

    return {
      primary: newValue,
      confidence: clamped,
      evidence: [],
      alternatives,
    };
  }

  /**
   * Extract a simple app identity from the URL.
   */
  private extractAppIdentity(url: string): string {
    try {
      const u = new URL(url);
      return u.hostname.replace(/^www\./, '');
    } catch {
      return 'unknown';
    }
  }
}

// ── SnapshotForAI Builder ──────────────────────────────────────────────

/**
 * Build a SnapshotForAI from an InteractionSnapshot.
 *
 * Strips raw selectors, XPath, and framework-generated IDs — keeps only
 * semantic and behavioral information that an LLM can reason about.
 */
export function toSnapshotForAI(
  snapshot: import('../shared/evidence-types').InteractionSnapshot,
  sessionContext: SessionContext | null,
): SnapshotForAI {
  const identity = snapshot.identity;

  // Extract ancestor roles from the snapshot's ancestorContext
  const ancestorRoles = snapshot.ancestorContext?.roles ?? [];

  return {
    tagName: identity.tag ?? '',
    accessibleName: identity.accessibleName ?? '',
    ariaRole: identity.ariaRole,
    className: identity.className,

    primaryEvent: snapshot.primaryEvent.type,
    valueChanged: !!snapshot.valueChange,
    valueAfter: snapshot.valueChange?.after ?? '',
    stateChanged: !!snapshot.stateChange,
    dwellTime: snapshot.dwellTime ?? null,

    ancestorRoles,
    hasCalendarContext: snapshot.ancestorContext?.hasCalendarAncestor ?? false,
    hasDropdownContext:
      snapshot.ancestorContext?.hasListboxAncestor ??
      snapshot.ancestorContext?.hasMenuAncestor ?? false,
    hasFormContext: false, // would need DOM traversal for form detection

    precedingType: snapshot.precedingSnapshotType ?? null,
    currentUrl: sessionContext?.layer1.currentUrl ?? '',
    workflowHint: sessionContext?.layer2?.workflow?.workflowType ?? null,
  };
}
