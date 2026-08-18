/**
 * Shared type definitions for the CmdRunner Smart Recorder extension.
 *
 * This file retains genuinely cross-domain types — those used by 3+ modules
 * across different architectural layers (recorder, classifier, sidepanel,
 * service worker, storage).
 *
 * Domain-specific types have been extracted to their respective domains:
 *   - AI types         → src/ai/types.ts
 *   - Repository types → src/repository/types.ts
 *
 * Those are re-exported here for backward compatibility — existing imports
 * from `'../shared/types'` continue to work without changes.
 */

// ── Re-exports from domain modules (backward compatibility) ────────────────
export {
  type AIProviderId,
  type ProviderSettings,
  type ConnectionStatus,
  type AIConfig,
  defaultProviderSettings,
  DEFAULT_AI_CONFIG,
} from '../ai/types.js';

export {
  TestCaseState,
  type TestCaseDraft,
  type RepositoryTestCase,
  type Scenario,
  type Feature,
  type Project,
  type TestRepository,
} from '../repository/types.js';

// ── Core recording state ─────────────────────────────────────────────────

/** The three recording states displayed in the side panel. */
export enum RecordingState {
  Ready = 'ready',
  Recording = 'recording',
  Stopped = 'stopped',
}

/** Keys used for chrome.storage.local persistence. */
export enum StorageKeys {
  UI_STATE = 'ui_state',
  SESSION_EVENTS = 'session_events',
  SESSION_CONTEXT = 'session_context',
  AI_CONFIG = 'ai_config',
  STEPS = 'session_steps',
  REPOSITORY = 'test_repository',
  SCREENSHOTS = 'session_screenshots',
  TEST_CASE_DRAFT = 'test_case_draft',
  DETECTED_INTERACTIONS = 'detected_interactions',
  DETECTED_INTERACTIONS_V2 = 'detected_interactions_v2',
  DETECTED_INTERACTIONS_MERGED = 'detected_interactions_merged',
  KNOWLEDGE_FRAGMENT = 'knowledge_fragment',
  RECOGNITION_COMPONENTS = 'recognition_components',
  DOMAIN_ENTITIES = 'domain_entities',
  // ── Phase 8: Unified IR Pipeline ──
  EXECUTION_IR_PLAN = 'execution_ir_plan',
  GENERATED_FILES = 'generated_files',
  // ── Phase 9.5: Understanding Layer ──
  UNDERSTANDING_RESULT = 'understanding_result',
  // ── Phase 10.3: Repository V2 Persistence ──
  REPOSITORY_SESSION_ID = 'repo_session_id',
  // ── Phase 12: Execution Engine ──
  EXECUTION_RESULT = 'execution_result',
  // ── Component Runtime: Live interactions (in-progress recording state) ──
  LIVE_INTERACTIONS = 'cmdrunner_live_interactions',
  // ── Form-submit recovery: durable attribution ledger (stamped, unattached) ──
  UNATTACHED_REQUESTS = 'cmdrunner_unattached_requests',
  /** G1-B: pending (uncommitted) main-frame document request per tab. */
  PENDING_NAV_DOCS = 'cmdrunner_pending_nav_docs',
}

/**
 * Recording Context — the page where recording started.
 *
 * Milestone 0 specification: This is session metadata, NOT an event.
 * It captures where the user was when they pressed Start Recording.
 * It must never be replaced by a later navigation.
 */
export interface RecordingContext {
  /** URL of the page when Start Recording was pressed. */
  startUrl: string;
  /** Title of the page when Start Recording was pressed. */
  startTitle: string;
  /** ISO timestamp when the context was captured. */
  capturedAt: string;
  /**
   * D9: content viewport of the tab at capture time
   * (chrome.tabs.Tab width/height). Optional — capture failures omit it.
   */
  viewport?: { width: number; height: number };
}

/** Shape of the persisted UI state. */
export interface UIState {
  recordingState: RecordingState;
  /** ISO timestamp of the last state change (for future use). */
  lastChanged: string;
}

/** The default UI state written on first install or missing state. */
export const DEFAULT_UI_STATE: UIState = {
  recordingState: RecordingState.Ready,
  lastChanged: new Date(0).toISOString(),
};

// ── Element Identity ─────────────────────────────────────────────────────

/**
 * Raw element identity data captured by the content script at click time.
 * Sent to the background SW, which assigns an `elementId` before storing.
 */
export interface RawElementIdentity {
  /** Computed accessible name (best-effort). */
  accessibleName: string;
  /** Explicit or implicit ARIA role, null if none. */
  ariaRole: string | null;
  /** Value of the aria-label attribute, null if absent. */
  ariaLabel: string | null;
  /** Value of the aria-labelledby attribute, null if absent. */
  ariaLabelledBy: string | null;
  /** Value of the placeholder attribute, null if absent. */
  placeholder: string | null;
  /** HTML tag name, e.g. 'BUTTON', 'A', 'INPUT'. */
  tag: string;
  /** CSS class names (space-joined), null if none. */
  className: string | null;
  /** Value of the name attribute (form elements), null if absent. */
  name: string | null;
  /** Value of the id attribute, null if absent. */
  stableId: string | null;
  /** Value of data-testid attribute, null if absent. */
  testId: string | null;
  /** Value of data-cy attribute, null if absent. */
  dataCy: string | null;
  /** Value of data-qa attribute, null if absent. */
  dataQa: string | null;
  /** Generated CSS selector (hidden fallback). */
  cssSelector: string;
  /** Generated XPath (hidden fallback). */
  xPath: string;
  /** True if the element is inside an iframe. */
  inIframe: boolean;
  /** True if the element is inside a Shadow DOM. */
  shadowDom: boolean;
  /** Raw href attribute value for anchor elements, null for non-links. */
  href: string | null;
  /** Value of the element's type attribute (inputs/select/textarea). Null for non-form elements. (Behavioral Evidence Model v3.0 §8.2) */
  inputType: string | null;
  /** Detailed iframe context when inIframe is true. Undefined for top-level frame. */
  iframeContext?: IframeContext;
}

/**
 * Full element identity — RawElementIdentity + elementId assigned by background.
 */
export interface ElementIdentity extends RawElementIdentity {
  /** Unique sequential element ID, e.g. "elem-0001". Assigned by background. */
  elementId: string;
}

/** Context about an iframe an action occurred inside. */
export interface IframeContext {
  /** The iframe's own URL (from window.location.href). */
  frameSrc: string;
  /** The <iframe> element's name attribute, if accessible (same-origin only). */
  frameName: string | null;
  /** The <iframe> element's id attribute, if accessible (same-origin only). */
  frameId: string | null;
  /** CSS selector for the <iframe> element in the parent document (same-origin only). */
  frameSelector: string | null;
  /** XPath for the <iframe> element in the parent document (same-origin only). */
  frameXPath: string | null;
  /** 0-based index of this iframe among siblings of the same tag (same-origin only). */
  frameIndex: number | null;
  /** How many levels deep this frame is (1 = direct child of top). */
  frameDepth: number;
}

// ── Session Events ───────────────────────────────────────────────────────

/** A single navigation event captured during recording. */
export interface NavigationEvent {
  /** Unique sequential action ID, e.g. "nav-0001". */
  actionId: string;
  /** Event type discriminator. */
  type: 'navigation';
  /** Destination URL of the page navigated to. */
  url: string;
  /** Page title at the time of navigation. */
  title: string;
  /** ISO timestamp of when the navigation was committed. */
  timestamp: string;
}

/**
 * A Click interaction event.
 *
 * Recorded when the user intentionally performs a click — the content
 * script resolves the target, extracts identity, and sends CLICK_CAPTURED.
 * The background SW assigns elementId and persists this event.
 *
 * Architecture Principle 6: Identity is immutable after classification.
 */
export interface ClickEvent {
  /** Unique sequential action ID, e.g. "click-0001". */
  actionId: string;
  /** Event type discriminator. */
  type: 'click';
  /** Element identity extracted at click time (immutable). */
  elementIdentity: ElementIdentity;
  /** ISO timestamp of when the click was classified. */
  timestamp: string;
  /** AI enrichment (added asynchronously after recording). Null if AI failed or not yet processed. */
  aiUnderstanding?: AIUnderstanding;
  /** Error message if AI enrichment failed. */
  aiError?: string;
}

/**
 * A text-entry event captured when the user types into an input/textarea
 * and moves focus away (blur event).
 *
 * The value is captured at blur time, not on every keystroke — this
 * avoids creating events for each character. One text-entry = one
 * event with the final value.
 */
export interface TextEntryEvent {
  /** Unique sequential action ID, e.g. "text-0001". */
  actionId: string;
  /** Event type discriminator. */
  type: 'text';
  /** Element identity extracted at blur time (immutable). */
  elementIdentity: ElementIdentity;
  /** The text value entered by the user. */
  value: string;
  /** ISO timestamp of when the text entry was classified. */
  timestamp: string;
  /** AI enrichment (added asynchronously after recording). Null if AI failed or not yet processed. */
  aiUnderstanding?: AIUnderstanding;
  /** Error message if AI enrichment failed. */
  aiError?: string;
}

/** AI understanding result for a captured action. */
export interface AIUnderstanding {
  /** Human-readable name for the business element, e.g. "Login Button". */
  businessName: string;
  /** UI control type classification, e.g. "Button", "Link", "Checkbox". */
  controlType: string;
  /** What the user likely intends to do, e.g. "Submit the login form". */
  userIntent: string;
  /** Confidence score from 0.0 to 1.0. */
  confidenceScore: number;
}

/**
 * A Hover interaction event captured when the user intentionally pauses
 * over an element that produces observable application behavior.
 */
export interface HoverEvent {
  /** Unique sequential action ID, e.g. "hover-0001". */
  actionId: string;
  /** Event type discriminator. */
  type: 'hover';
  /** Element identity extracted at hover commit time (immutable). */
  elementIdentity: ElementIdentity;
  /** ISO timestamp of when the hover was qualified and committed. */
  timestamp: string;
  /** AI enrichment. */
  aiUnderstanding?: AIUnderstanding;
  /** Error message if AI enrichment failed. */
  aiError?: string;
}

/** A meaningful Checkbox state transition. */
export interface CheckboxEvent {
  /** Unique sequential action ID, e.g. "check-0001". */
  actionId: string;
  /** Event type discriminator. */
  type: 'checkbox';
  /** Element identity extracted at state change time (immutable). */
  elementIdentity: ElementIdentity;
  /** Resulting state: true = checked, false = unchecked. */
  checked: boolean;
  /** ISO timestamp of when the state change was confirmed. */
  timestamp: string;
  /** AI enrichment. */
  aiUnderstanding?: AIUnderstanding;
  /** Error message if AI enrichment failed. */
  aiError?: string;
}

/** A meaningful Radio Button selection. */
export interface RadioEvent {
  /** Unique sequential action ID, e.g. "radio-0001". */
  actionId: string;
  /** Event type discriminator. */
  type: 'radio';
  /** Element identity extracted at selection time (immutable). */
  elementIdentity: ElementIdentity;
  /** ISO timestamp of when the selection was confirmed. */
  timestamp: string;
  /** AI enrichment. */
  aiUnderstanding?: AIUnderstanding;
  /** Error message if AI enrichment failed. */
  aiError?: string;
}

/** A meaningful Dropdown & Select interaction. */
export interface SelectEvent {
  /** Unique sequential action ID, e.g. "select-0001". */
  actionId: string;
  /** Event type discriminator. */
  type: 'select';
  /** Element identity extracted at selection time (immutable). */
  elementIdentity: ElementIdentity;
  /** The user-visible label of the selected option (e.g. "India"). */
  value: string;
  /** ISO timestamp of when the selection was confirmed. */
  timestamp: string;
  /** AI enrichment. */
  aiUnderstanding?: AIUnderstanding;
  /** Error message if AI enrichment failed. */
  aiError?: string;
}

/** Sub-type of a date selection. */
export type DateSelectSubType = 'date' | 'dateRange' | 'time' | 'dateTime' | 'month' | 'week';

/** A meaningful Date Picker interaction. */
export interface DateSelectEvent {
  /** Unique sequential action ID, e.g. "dateSelect-0001". */
  actionId: string;
  /** Event type discriminator. */
  type: 'dateSelect';
  /** Element identity extracted at selection time (immutable). */
  elementIdentity: ElementIdentity;
  /** The date sub-type (determines Canonical Step format). */
  dateType: DateSelectSubType;
  /** Human-readable display value, e.g. "15 July 2026". */
  displayValue: string;
  /** ISO value for execution, e.g. "2026-07-15". */
  isoValue: string;
  /** For ranges: start display value. */
  startDisplayValue?: string;
  /** For ranges: end display value. */
  endDisplayValue?: string;
  /** For ranges: start ISO value. */
  startIsoValue?: string;
  /** For ranges: end ISO value. */
  endIsoValue?: string;
  /** ISO timestamp of when the selection was confirmed. */
  timestamp: string;
  /** AI enrichment. */
  aiUnderstanding?: AIUnderstanding;
  /** Error message if AI enrichment failed. */
  aiError?: string;
}

/** Union of all session event types. */
export type SessionEvent =
  | NavigationEvent
  | ClickEvent
  | TextEntryEvent
  | HoverEvent
  | CheckboxEvent
  | RadioEvent
  | SelectEvent
  | DateSelectEvent;

// ── Test Steps & Execution ───────────────────────────────────────────────

/** Locator type for execution JSON. */
export type LocatorType = 'css' | 'xpath' | 'testId' | 'id' | 'ariaLabel' | 'name' | 'text';

/** A single locator strategy. */
export interface Locator {
  type: LocatorType;
  value: string;
}

/**
 * Machine-readable execution payload for a step.
 */
export interface ExecutionJson {
  /** Action type. */
  action: string;
  /** Linked Action ID from the recording session. */
  actionId: string;
  /** Linked Element ID from the element identity. */
  elementId: string;
  /** Best available locator strategy. */
  primaryLocator: Locator;
  /** Fallback locator strategies in priority order. */
  fallbackLocators: Locator[];
  /** Element metadata. */
  tag: string;
  accessibleName: string;
  ariaRole: string | null;
  /** True if element is inside an iframe (context for CmdRunner executor). */
  inIframe: boolean;
  /** True if element is inside a Shadow DOM. */
  shadowDom: boolean;
  /** Detailed iframe context when inIframe is true. */
  iframeContext?: IframeContext;
}

/**
 * Legacy Execution JSON contract types — preserved for SpecCanonicalStep
 * and PlaywrightGeneratorOutput references. These were originally in
 * src/generation/contracts/ but were moved here when the legacy generation
 * pipeline was retired (Phase 8.5).
 *
 * See docs/handover/14-target-generation-architecture.md for the migration.
 */

// ── Execution JSON Contract (legacy) ───────────────────────

export interface ExecutionAction {
  type: string;
  value: string | null;
}

export interface ExecutionTarget {
  kind: string;
  tag?: string;
  role?: string | null;
  name?: string;
  url?: string;
}

export type LocatorStrategy =
  | 'testId' | 'dataCy' | 'dataQa' | 'dataTest' | 'dataAutomationId'
  | 'ariaLabel' | 'ariaLabelledby'
  | 'id' | 'name'
  | 'text' | 'placeholder' | 'alt' | 'title'
  | 'css' | 'xpath';

export type LocatorRole = 'primary' | 'secondary' | 'fallback';

export interface ExecutionLocator {
  strategy: LocatorStrategy;
  value: string;
  role: LocatorRole;
}

export interface ExecutionContext {
  iframe: boolean;
  shadowDom: boolean;
  frame: IframeContext | null;
}

export interface ExecutionTrace {
  interactionId: string;
  stepId: string;
}

export type ExecutionStatus = 'generated' | 'error';

export interface ExecutionMeta {
  status: ExecutionStatus;
  warnings: string[];
  generatedAt: string;
}

export interface ExecutionJsonObject {
  action: ExecutionAction;
  target: ExecutionTarget;
  locators: ExecutionLocator[];
  context: ExecutionContext;
  trace: ExecutionTrace;
  meta: ExecutionMeta;
}

// ── Playwright Generator Output (legacy) ───────────────────

export interface PlaywrightGeneratorOutput {
  testCode: string;
  isManualEdit: false;
  generatedAt: string;
}

/** A complete test step generated from a recorded action. */
export interface TestStep {
  /** Unique sequential step ID, e.g. "step-0001". */
  stepId: string;
  /** Human-readable plain English description. */
  plainEnglish: string;
  /** Linked Action ID, e.g. "click-0001". */
  actionId: string;
  /** Linked Element ID, e.g. "elem-0001". */
  elementId: string;
  /** Machine-readable execution JSON. */
  executionJson: ExecutionJson;
  /** AI confidence score (0.0–1.0). 0 if AI failed. */
  aiConfidence: number;
  /** ISO timestamp of step generation. */
  timestamp: string;
}

// ── Screenshot Metadata ──────────────────────────────────────────────────

/** Metadata for a screenshot captured during recording. */
export interface ScreenshotMetadata {
  /** Unique sequential screenshot ID, e.g. "shot-0001". */
  screenshotId: string;
  /** ISO timestamp of when the screenshot was captured. */
  timestamp: string;
  /** The action that triggered this screenshot, e.g. "nav-0001". */
  actionId: string;
  /** The element associated with the action, e.g. "elem-0001". Null for navigation. */
  elementId: string | null;
  /** The type of action that triggered the screenshot. */
  actionType: string;
  /** Base64-encoded PNG screenshot of the visible tab. */
  dataUrl: string;
}

// ── Messaging ────────────────────────────────────────────────────────────

/**
 * Discriminated union for all messages between extension contexts.
 */
export type AppMessage =
  | { type: 'START_RECORDING' }
  | { type: 'STOP_RECORDING' }
  | { type: 'OPEN_SETTINGS' }
  | { type: 'OPEN_REPOSITORY' }
  | { type: 'PING' }
  | { type: 'CONTENT_SCRIPT_STATUS'; tabId: number; alive: boolean; recording: boolean; url: string }
  | { type: 'STATE_UPDATE'; payload: UIState }
  | { type: 'RUN_TEST' }
  | { type: 'EXECUTION_RESULT'; status: 'passed' | 'failed' | 'error'; stepCount: number; passedSteps: number; durationMs: number; healedElements: number }
  | {
      type: 'RECORDED_EVENT';
      eventType: 'click' | 'dblclick' | 'contextmenu' | 'focus' | 'blur' | 'change' | 'input' | 'scroll' | 'mouseenter' | 'dragstart' | 'drop' | 'dateSelect';
      timestamp: string;
      target: ElementIdentity;
      valueBefore: string | null;
      valueAfter: string | null;
      checkedBefore: boolean | null;
      checkedAfter: boolean | null;
      domContext?: import('../recorder/recorded-event').DomContext;
    }
  // ── Component Runtime messages (Phase 6) ──
  | { type: 'OBSERVED_EVENT'; payload: import('./component-types').ObservedEvent }
  // ── Behavioral Evidence Model (v3.0) ──
  | { type: 'BEHAVIORAL_EVIDENCE'; payload: import('./behavioral-evidence-types').BehavioralEvidence }
  | { type: 'INTERACTION_EVIDENCE_UPDATE'; payload: { interactionId: string; evidence: import('./behavioral-evidence-types').BehavioralEvidence } }
  // ── Post-Navigation Capture (NAV pull model) ──
  // CS → SW: destination page asks for this tab's pending full-reload nav record
  | { type: 'NAV_PENDING_REQUEST' }
  // SW → CS: the record, or null when absent/consumed/expired
  | { type: 'NAV_PENDING_RESPONSE'; payload: import('./post-nav-types').PostNavCaptureRecord | null }
  // ── Lifecycle-Driven Evidence (v3.1) ──
  // SW → CS: a semantic interaction lifecycle has started
  | {
      type: 'LIFECYCLE_BOUND';
      payload: {
        lifecycleId: string;
        triggerEventId: string;
        interactionType: string;
      };
    }
  // SW → CS: a semantic interaction lifecycle has completed — finalize evidence now
  | {
      type: 'FINALIZE_EVIDENCE';
      payload: {
        lifecycleId: string;
        interactionId: string;
        interactionType: string;
        eventIds: string[];
        metadata: Record<string, unknown>;
        endState: string;
        /** Trigger element identity from the interaction. Used when no evidence
         *  window was opened (capture-only trigger path) to avoid null identity. */
        triggerIdentity?: import('./types').ElementIdentity;
      };
    };

/** Type guard: narrows an unknown value to AppMessage. */
export function isAppMessage(value: unknown): value is AppMessage {
  if (typeof value !== 'object' || value === null) return false;
  const msg = value as Record<string, unknown>;
  return (
    typeof msg['type'] === 'string' &&
    [
      'START_RECORDING',
      'STOP_RECORDING',
      'OPEN_SETTINGS',
      'OPEN_REPOSITORY',
      'PING',
      'CONTENT_SCRIPT_STATUS',
      'STATE_UPDATE',
      'RUN_TEST',
      'EXECUTION_RESULT',
      'RECORDED_EVENT',
      'OBSERVED_EVENT',
      'BEHAVIORAL_EVIDENCE',
      'INTERACTION_EVIDENCE_UPDATE',
      'NAV_PENDING_REQUEST',
      'NAV_PENDING_RESPONSE',
      'LIFECYCLE_BOUND',
      'FINALIZE_EVIDENCE',
    ].includes(msg['type'])
  );
}
