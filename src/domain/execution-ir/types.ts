/**
 * Execution IR Type System — execution-ir-design.md §2
 *
 * The framework-neutral execution contract. These types define what to do
 * (actions), where to target (resolved locators), what to verify (assertions),
 * and how to behave (execution parameters) — without any engine-specific concepts.
 *
 * Design Principles:
 *   P1: IR is a contract, not a framework — no Playwright/Selenium/Cypress references.
 *   P2: IR is derived and disposable — always regenerable from ATC + Element Repository.
 *   P3: Adapters receive only the IR — never the ATC, Element Repository, or Environment Profile.
 *   P4: IR is self-contained at generation time — all resolution happens during generation.
 *   P5: Linear in V1, designed for graph evolution — steps are self-contained leaf nodes.
 *
 * Reference: execution-ir-design.md §2
 */

import {
  LocatorStrategyType,
  ValidationType,
  ValidationComparison,
  ValidationSeverity,
} from '../enums';
import type { AIUnderstanding } from '../../shared/types';

// ── 2.1 IRAction ──────────────────────────────────────────

/**
 * The IR's action vocabulary. A superset of the ATC's StepAction.
 *
 * Business-authored actions (click, fill, select, etc.) carry forward 1:1
 * from the ATC. Execution-only actions (waitForElement) are injected by the
 * generation pipeline based on implicit rules — the business never authors them.
 *
 * The generator maps StepAction → IRAction via identity for business-authored
 * actions. It may INSERT execution-only steps between authored steps, but never
 * transforms an authored action into a different one.
 *
 * Future execution-only actions (switchFrame, acceptDialog, screenshot, etc.)
 * will be added here when needed — the enum is designed to grow.
 */
export enum IRAction {
  // ── Business-authored (1:1 with StepAction) ──
  CLICK = 'click',
  FILL = 'fill',
  SELECT = 'select',
  SELECT_DATE = 'selectDate',
  TOGGLE = 'toggle',
  HOVER = 'hover',
  NAVIGATE = 'navigate',
  DRAG_DROP = 'dragAndDrop',
  PRESS_KEY = 'pressKey',
  VERIFY = 'verify',
  WAIT = 'wait',

  // ── Execution-only (injected by pipeline, never authored) ──
  /** Injected before element-interacting steps when waitStrategy != 'none'. */
  WAIT_FOR_ELEMENT = 'waitForElement',
}

// ── 2.2 ResolvedLocator ───────────────────────────────────

/**
 * A snapshot of a locator strategy, copied from the Element Repository at
 * IR generation time. Structurally identical to domain LocatorStrategy, but
 * semantically a snapshot — not a live reference.
 */
export interface ResolvedLocator {
  readonly type: LocatorStrategyType;
  readonly value: string;
  /** Rank order (1 = highest priority, tried first). */
  readonly priority: number;
  /** Confidence score (0.0–1.0) from the source Element's LocatorStrategy. */
  readonly confidence: number | null;
}

// ── 2.3 ResolvedTarget ────────────────────────────────────

/**
 * Discriminated union for what a step targets.
 * Kind discriminates: 'element' (with resolved locators), 'url', or 'none'.
 */
export type ResolvedTarget = ElementTarget | UrlTarget | NoTarget;

/** The step targets a UI element — locators resolved at generation time. */
export interface ElementTarget {
  readonly kind: 'element';
  /** Stable element ID (back-reference for reporting and self-heal correlation). */
  readonly elementId: string;
  /** Logical name (for human-readable output and POM class naming). */
  readonly elementName: string;
  /** Scope label — which page or component this element belongs to (for POM organization). */
  readonly pageOrComponent: string;
  /** Locator strategies resolved at generation time — the key derived field. */
  readonly resolvedLocators: ResolvedLocator[];
}

/** The step targets a URL — for navigate actions. */
export interface UrlTarget {
  readonly kind: 'url';
  /** Fully resolved URL — baseUrl prepended to relative paths at generation time. */
  readonly url: string;
}

/** The step has no target — for pure waits, verify-only steps. */
export interface NoTarget {
  readonly kind: 'none';
}

// ── 2.4 IRAssertion ───────────────────────────────────────

/**
 * A resolved validation assertion. The ATC's Validation type carries an
 * elementId reference; at IR generation time, that reference is resolved to
 * concrete locators and embedded as a ResolvedTarget.
 */
export interface IRAssertion {
  readonly type: ValidationType;
  readonly comparison: ValidationComparison;
  readonly expectedValue: unknown;
  readonly severity: ValidationSeverity;
  /** Resolved target — element locators or URL. Replaces Validation.elementId. */
  readonly target: ResolvedTarget;
  /** Which property to check (e.g., "text", "value", "visible", "count"). */
  readonly property: string | null;
}

// ── 2.5 ExecutionParameters ───────────────────────────────

/**
 * Per-step execution configuration. These are execution concerns, not business
 * intent — they are NOT in the ATC. The generator resolves them from defaults
 * or the Environment Profile at IR generation time and embeds them.
 *
 * Every IR step has fully resolved ExecutionParameters — no undefined fields.
 */
export interface ExecutionParameters {
  /** Maximum time to wait for the action to complete (ms). */
  readonly timeoutMs: number;
  /** Number of retries on failure before giving up. */
  readonly retryCount: number;
  /** Delay between retries (ms). */
  readonly retryDelayMs: number;
  /** Wait strategy before interacting with the element. */
  readonly waitStrategy: 'none' | 'visible' | 'present' | 'stable';
}

/** Default execution parameters applied when no overrides are specified. */
export const DEFAULT_EXECUTION_PARAMETERS: ExecutionParameters = {
  timeoutMs: 30_000,
  retryCount: 0,
  retryDelayMs: 1_000,
  waitStrategy: 'visible',
};

// ── 2.6 IRInput ───────────────────────────────────────────

/**
 * Input value for a step. V1: always a literal. Future: may be a variable
 * reference resolved by the executor at runtime from an active data set.
 */
export type IRInput = string | number | boolean | null;

// ── 2.7 IRStep ────────────────────────────────────────────

/**
 * The atomic execution unit. Self-contained — carries everything an adapter
 * needs to produce engine-specific code or execute the action. No step
 * references another step (designs for graph evolution: steps[] → nodes[]
 * with control-flow wrappers is an additive change).
 */
export interface IRStep {
  /** Stable identifier (carried from the ATC Step ID, or generated for injected steps). */
  readonly id: string;
  /** Position in the linear sequence (0-based). */
  readonly order: number;
  /** What to do. */
  readonly action: IRAction;
  /** Human-readable description (carried from the ATC step, or generated for injected steps). */
  readonly description: string;
  /** Where to target — resolved element locators, URL, or none. */
  readonly target: ResolvedTarget;
  /** Input value — literal in V1. */
  readonly input: IRInput;
  /** Post-step assertions — each with resolved targets. */
  readonly assertions: IRAssertion[];
  /** Execution configuration for this step. */
  readonly executionParameters: ExecutionParameters;

  // ── Recording provenance (optional — populated by IR bridge, not ATC path) ──

  /** AI advisory enrichment from the recording session. Null if AI failed or wasn't used. */
  readonly aiEnrichment?: AIUnderstanding | null;
  /** Back-link to the source SessionEvent actionId (e.g., "click-0001"). Undefined for ATC-authored steps. */
  readonly sourceEventId?: string;
  /** Template-generated human description. Undefined for ATC-authored steps. */
  readonly plainEnglish?: string;
}

// ── 2.8 IREnvironment ─────────────────────────────────────

/**
 * Resolved environment snapshot. Environment values are resolved from the
 * Environment Profile at IR generation time. An adapter never queries the
 * Environment Profile — everything it needs is here.
 */
export interface IREnvironment {
  /** Fully resolved base URL (from Environment Profile). */
  readonly baseUrl: string;
  readonly browser: 'chrome' | 'firefox' | 'safari' | 'edge';
  readonly viewport: { width: number; height: number };
}

// ── 2.9 ExecutionIRPlan ───────────────────────────────────

/**
 * The pure IR structure — what the generator produces and the adapter consumes.
 * No persistence concerns. This is the ONLY type passed to adapter methods.
 */
export interface ExecutionIRPlan {
  readonly testCaseId: string;
  readonly testCaseVersionId: string;
  readonly testCaseVersionNumber: number;
  /** Human-readable title (for test file naming, report headers). */
  readonly title: string;
  /** Tags carried from the ATC (for categorization in generated projects). */
  readonly tags: string[];
  /** Resolved environment — base URL, browser, viewport. */
  readonly environment: IREnvironment;
  /** The ordered sequence of steps. */
  readonly steps: IRStep[];
}

// ── 2.10 Rendering ────────────────────────────────────────

/** Which rendering engine produced this output. */
export type RenderingEngine = 'cmdrunner' | 'playwright' | 'cypress' | 'appium';

/** Output format of the rendering. */
export type RenderingFormat = 'json' | 'typescript' | 'javascript';

/**
 * Cached engine-specific rendering output. Memoization, not a first-class entity.
 * Wiped when the IR is regenerated.
 */
export interface Rendering {
  readonly engine: RenderingEngine;
  readonly format: RenderingFormat;
  /** The rendered content — JSON string, TypeScript source code, etc. */
  readonly content: string;
  readonly generatedAt: string;
}

// ── 2.11 ExecutionIRArtifact ──────────────────────────────

/**
 * The cached wrapper around the IR plan. Carries provenance and cached
 * renderings. This is what gets stored (IndexedDB in V1).
 *
 * The adapter contract takes ExecutionIRPlan, NOT ExecutionIRArtifact —
 * the adapter never sees id, generatedAt, generatorVersion, or renderings.
 */
export interface ExecutionIRArtifact {
  /** Unique identifier for this artifact. */
  readonly id: string;
  /** Which ATC version this IR was generated from. */
  readonly testCaseVersionId: string;
  /** The actual IR — the plan consumed by adapters. */
  readonly plan: ExecutionIRPlan;
  /** When the IR was generated. Used for staleness detection. */
  readonly generatedAt: string;
  /** Version of the generator that produced this IR (e.g., 'ir-gen-1.0.0'). */
  readonly generatorVersion: string;
  /**
   * Cached engine-specific renderings, keyed by RenderingEngine.
   * Wiped on regeneration — re-populated on next execution/export.
   */
  readonly renderings: Record<string, Rendering>;
}
