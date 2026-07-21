/**
 * Execution JSON Contract Types — the frozen B5.2 contract structure.
 *
 * Milestone B5.3 (v5.0.0) — Implementation
 *
 * These types implement the six-section Execution JSON contract defined
 * in milestone-b5.2-execution-json-contract.md (FROZEN).
 *
 * B5.2 §2.1: An Execution JSON is a single object with six top-level keys:
 *   action, target, locators, context, trace, meta
 *
 * Every producer (Execution JSON Generator) and consumer (Playwright
 * Generator, Execution Engine, UI) relies on these types.
 */

import type { IframeContext } from '../../shared/types';

// ── Section 1: Action ──────────────────────────────────────

/**
 * The action section — describes what the machine must do.
 *
 * B5.2 §2.2: action.type is the abstract action verb; action.value
 * carries operation-specific data (null for click/navigate in v1.0).
 */
export interface ExecutionAction {
  /** Abstract action category. v1.0: "click", "navigate". */
  type: string;
  /** Action-specific payload. null for actions that carry no data. */
  value: string | null;
}

// ── Section 2: Target ──────────────────────────────────────

/**
 * The target section — describes what element or resource the action targets.
 *
 * B5.2 §2.3: Uses a `kind` discriminator. "element" targets carry
 * tag, role (nullable), name. "navigation" targets carry url.
 */
export interface ExecutionTarget {
  /** Target type discriminator: "element" or "navigation". */
  kind: string;
  /** HTML tag name (required when kind = "element"). */
  tag?: string;
  /** ARIA role, null if none (optional when kind = "element"). */
  role?: string | null;
  /** Accessible name (required when kind = "element"). */
  name?: string;
  /** Destination URL (required when kind = "navigation"). */
  url?: string;
}

// ── Section 3: Locators ────────────────────────────────────

/**
 * Locator strategy enumeration.
 *
 * B5.2 §2.4 / B4.4 §2.1: Ordered by priority category.
 * Business → Accessibility → Stable Tech → Content → Structural.
 */
export type LocatorStrategy =
  // Category 1: Business Identifiers
  | 'testId'
  | 'dataCy'
  | 'dataQa'
  | 'dataTest'
  | 'dataAutomationId'
  // Category 2: Accessibility
  | 'ariaLabel'
  | 'ariaLabelledby'
  // Category 3: Stable Technical
  | 'id'
  | 'name'
  // Category 4: Content-Based
  | 'text'
  | 'placeholder'
  | 'alt'
  | 'title'
  // Category 5: Structural
  | 'css'
  | 'xpath';

/**
 * Locator role in the resolution set.
 *
 * B5.2 §2.4 / B4.4 §3.1: Exactly one primary when locators exist.
 * Secondary from a different category when possible. Fallback is lowest.
 */
export type LocatorRole = 'primary' | 'secondary' | 'fallback';

/**
 * A single resolved locator — strategy + value + role.
 *
 * B5.2 §2.4 / B4.3 §0.2: A locator is a prescriptive "how to find it"
 * pair, distinct from identity (what the element IS).
 */
export interface ExecutionLocator {
  /** How to find the element (e.g. "testId", "css"). */
  strategy: LocatorStrategy;
  /** The concrete value for this strategy. */
  value: string;
  /** Role in the resolution set. */
  role: LocatorRole;
}

// ── Section 4: Context ─────────────────────────────────────

/**
 * The context section — environmental factors affecting execution.
 *
 * B5.2 §2.5 / B4.2 §3.4: Describes iframe and Shadow DOM boundaries
 * that must be crossed before applying locators.
 */
export interface ExecutionContext {
  /** Whether the target element is inside an iframe. */
  iframe: boolean;
  /** Whether the target element is inside a Shadow DOM. */
  shadowDom: boolean;
  /** Detailed iframe navigation data. Null when iframe = false. */
  frame: IframeContext | null;
}

// ── Section 5: Traceability ────────────────────────────────

/**
 * The traceability section — links to source artifacts.
 *
 * B5.2 §2.6 / B4.2 §4.2: Bidirectional, unbreakable traceability
 * to the source interaction and parent step.
 */
export interface ExecutionTrace {
  /** The Timeline interaction's actionId (e.g. "click-0001"). */
  interactionId: string;
  /** The parent Canonical Test Step's stepId (e.g. "step-0001"). */
  stepId: string;
}

// ── Section 6: Metadata ────────────────────────────────────

/**
 * Generation status of this Execution JSON.
 *
 * B5.2 §2.7 / B5.1 §3.5: "generated" = successfully produced.
 * "error" = generation attempted but failed (NOT null — null means
 * "not yet generated").
 */
export type ExecutionStatus = 'generated' | 'error';

/**
 * The metadata section — operational data about the Execution JSON itself.
 *
 * B5.2 §2.7 / B4.2 §3.5: Status tracking, quality indicators, timestamps.
 * Does NOT affect execution semantics.
 */
export interface ExecutionMeta {
  /** Generation outcome. */
  status: ExecutionStatus;
  /** Non-fatal quality warnings. Empty array when none. */
  warnings: string[];
  /** ISO 8601 timestamp of generation. */
  generatedAt: string;
}

// ── The Complete Execution JSON ────────────────────────────

/**
 * The complete Execution JSON — the machine-executable intent of one
 * Canonical Test Step.
 *
 * B5.2 §2.1: Six top-level sections, one per B4.2 information category.
 * B4.5 §1.3: This is the persistent representation of the Execution Object.
 * B5.1 §1.3: Embedded in CanonicalStep.executionJson, stored under
 * GENERATED_STEPS.
 *
 * This type replaces the legacy flat ExecutionJson interface in
 * shared/types.ts. The flat interface was a pre-B4.x placeholder.
 */
export interface ExecutionJsonObject {
  /** What to do. */
  action: ExecutionAction;
  /** What to interact with. */
  target: ExecutionTarget;
  /** How to find it (0–3 entries, empty for navigation). */
  locators: ExecutionLocator[];
  /** Environmental factors. */
  context: ExecutionContext;
  /** Source links. */
  trace: ExecutionTrace;
  /** Operational data. */
  meta: ExecutionMeta;
}
