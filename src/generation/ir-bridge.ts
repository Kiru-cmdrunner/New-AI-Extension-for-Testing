/**
 * IR Bridge — the single integration point where recording outputs converge
 * into a unified ExecutionIRPlan.
 *
 * Phase 8 — Milestone 8.2
 * Phase 3 — Type System Unification: bridge now accepts ComponentInteraction[]
 * directly. The adapter and classifier type vocabulary are eliminated.
 *
 * Architecture (see .drytis/PHASE3_DESIGN.md):
 *   SessionEvent[] + ComponentInteraction[] + ApplicationKnowledgeFragment
 *     → IR Bridge → ExecutionIRPlan
 *
 * The bridge is a pure function: same inputs → same plan, every time.
 * No side effects, no storage reads/writes. The caller (service worker)
 * handles persistence.
 *
 * Each input provides unique, non-overlapping data:
 *   SessionEvent[] — locators, input values, DOM context, AI enrichment
 *   ComponentInteraction[] — type classification, metadata, confidence
 *   KnowledgeFragment — assertions, business field labels, workflow structure
 */

import {
  IRAction,
  DEFAULT_EXECUTION_PARAMETERS,
  type IRStep,
  type ExecutionIRPlan,
  type ResolvedLocator,
  type ResolvedTarget,
  type ResolvedFrame,
  type ElementTarget,
  type IRAssertion,
  type IREnvironment,
  type IRInput,
} from '../domain/execution-ir/types';
import {
  ValidationType,
  ValidationComparison,
  ValidationSeverity,
} from '../domain/enums';
import type { SessionEvent, ElementIdentity, AIUnderstanding, IframeContext } from '../shared/types';
import type { ComponentInteraction } from '../shared/component-types';
import type {
  ApplicationKnowledgeFragment,
  InteractionContract,
  LogicalAction,
} from '../domain/entities/application-knowledge';
import {
  extractCandidatesFromIdentity,
  rankLocatorCandidates,
} from '../domain/locator-ranking';
import type { IRBridgeInput } from './ir-bridge-input';
import { deriveStateAssertions } from './assertion-deriver';
import type { EnrichmentOutput } from './interaction-enrichment';

// ── Bridge Interaction Type ──────────────────────────────────────────
//
// Internal type that replaces the external DetectedInteraction. The bridge
// accepts ComponentInteraction[] directly and converts to BridgeInteraction
// internally via toBridgeInteraction(). This eliminates the dependency on
// the classifier's type vocabulary (interaction-types.ts).
//
// The conversion preserves the exact same type resolution and metadata
// normalization that component-to-classifier-adapter.ts performed, ensuring
// byte-identical IR plan output (golden master equivalence).

/**
 * Resolved interaction type used internally by the IR Bridge.
 *
 * These values correspond to the entries in INTERACTION_TO_IR_ACTION below.
 * They are the same string literals that the former classifier InteractionType
 * used — preserved for behavioral equivalence.
 */
type BridgeInteractionType =
  | 'Click'
  | 'DoubleClick'
  | 'RightClick'
  | 'Hover'
  | 'DragDrop'
  | 'KeyboardShortcut'
  | 'TextEntry'
  | 'RichTextEditor'
  | 'NativeDropdown'
  | 'CustomDropdown'
  | 'Autocomplete'
  | 'MultiSelect'
  | 'Checkbox'
  | 'RadioButton'
  | 'ToggleSwitch'
  | 'Slider'
  | 'DatePicker'
  | 'TimePicker'
  | 'DateTimePicker'
  | 'FileUpload'
  | 'DragDropUpload'
  | 'Link'
  | 'Tab'
  | 'Menu'
  | 'Breadcrumb'
  | 'PageScroll'
  | 'ContainerScroll'
  | 'InfiniteScroll'
  | 'BrowserAlert'
  | 'Modal'
  | 'ModalDialog'
  | 'Stepper'
  | 'TagInput'
  | 'OtpInput'
  | 'HotkeySequence'
  | 'Drawer'
  | 'Popover'
  | 'Tooltip'
  | 'NewTab'
  | 'NewWindow'
  | 'Iframe'
  | 'PageNavigation'
  | 'Back'
  | 'Forward'
  | 'Refresh'
  | 'Unknown';

/**
 * The internal interaction shape consumed by all bridge functions.
 * Mirrors the former DetectedInteraction but without the external type dependency.
 *
 * Exported so assertion-deriver.ts (and other bridge-internal modules)
 * can share the same type without depending on the classifier vocabulary.
 */
export interface BridgeInteraction {
  interactionId: string;
  type: BridgeInteractionType;
  eventIds: string[];
  rawEventTypes: string[];
  target: ElementIdentity | undefined;
  metadata: Record<string, unknown>;
  confidence: number;
}

/**
 * Map coarse component types to their default bridge types.
 * Used when interactionSubtype is not explicitly set by the definition.
 * Preserves the exact same mapping as the former DEFAULT_SUBTYPE.
 */
const DEFAULT_BRIDGE_TYPE: Record<string, BridgeInteractionType> = {
  Click: 'Click',
  TextEntry: 'TextEntry',
  Dropdown: 'CustomDropdown',
  Checkbox: 'Checkbox',
  RadioButton: 'RadioButton',
  DatePicker: 'DatePicker',
  Hover: 'Hover',
  Link: 'Link',
  FileUpload: 'FileUpload',
  Slider: 'Slider',
  Tab: 'Tab',
  Scroll: 'PageScroll',
  Navigation: 'PageNavigation',
  DragDrop: 'DragDrop',
  KeyboardShortcut: 'KeyboardShortcut',
  ModalDialog: 'ModalDialog',
  Stepper: 'Stepper',
  TagInput: 'TagInput',
  OtpInput: 'OtpInput',
  HotkeySequence: 'HotkeySequence',
  NewTab: 'NewTab',
  NewWindow: 'NewWindow',
  Breadcrumb: 'Breadcrumb',
};

/**
 * Normalize a ComponentInteraction into the internal BridgeInteraction.
 *
 * This function internalizes the exact same logic that the former
 * component-to-classifier-adapter.ts performed:
 *   1. Type resolution: interactionSubtype → DEFAULT_BRIDGE_TYPE → 'Unknown'
 *   2. Metadata normalization: field renaming per type
 *
 * It is a pure, lossless transform — same input always produces the same output.
 */
export function toBridgeInteraction(ci: ComponentInteraction): BridgeInteraction {
  // Resolve type
  const subtype = ci.interactionSubtype as BridgeInteractionType | undefined;
  const type: BridgeInteractionType =
    subtype ||
    DEFAULT_BRIDGE_TYPE[ci.type] ||
    'Unknown';

  // Normalize metadata (same logic as former adaptMetadata)
  const meta = ci.metadata ?? {};
  const result: Record<string, unknown> = {};

  // Common fields
  if (meta.targetName) result.accessibleName = meta.targetName;
  if (meta.selectedValue) result.selectedValue = meta.selectedValue;

  // TextEntry
  if (ci.type === 'TextEntry') {
    if (meta.textValue) result.textValue = meta.textValue;
    else if (meta.finalValue) result.textValue = meta.finalValue;
    if (meta.editorType) result.editorType = meta.editorType;
    if (meta.isRichTextEditor !== undefined) result.isRichTextEditor = meta.isRichTextEditor;
  }

  // Checkbox / Toggle
  if (ci.type === 'Checkbox') {
    if (meta.checked !== undefined) result.checked = meta.checked;
  }

  // DatePicker
  if (ci.type === 'DatePicker') {
    if (meta.selectedDate) result.dateValue = meta.selectedDate;
    if (meta.displayValue) result.displayValue = meta.displayValue;
    if (meta.dateAmbiguous) result.dateAmbiguous = meta.dateAmbiguous;
  }

  // FileUpload
  if (ci.type === 'FileUpload') {
    if (meta.fileName) result.files = [meta.fileName];
    if (meta.fileCount !== undefined) result.fileCount = meta.fileCount;
  }

  // Slider
  if (ci.type === 'Slider') {
    if (meta.sliderValue !== undefined) result.sliderValue = String(meta.sliderValue);
    else if (meta.value !== undefined) result.sliderValue = String(meta.value);
    if (meta.startValue !== undefined) result.startValue = meta.startValue;
    if (meta.endValue !== undefined) result.endValue = meta.endValue;
    if (meta.min !== undefined) result.sliderMin = meta.min;
    if (meta.max !== undefined) result.sliderMax = meta.max;
    if (meta.dragTracked !== undefined) result.dragTracked = meta.dragTracked;
  }

  // Navigation
  if (ci.type === 'Navigation') {
    const navEvent = ci.triggerEvent;
    if (navEvent?.pageUrl) result.url = navEvent.pageUrl;
    if (navEvent?.pageTitle) result.title = navEvent.pageTitle;
  }

  // Hover
  if (ci.type === 'Hover') {
    if (meta.hoverDuration) result.hoverDuration = meta.hoverDuration;
  }

  // DragDrop
  if (ci.type === 'DragDrop') {
    if (meta.dropTarget) result.dropTarget = meta.dropTarget;
    if (meta.sourceElement) result.sourceElement = meta.sourceElement;
  }

  // KeyboardShortcut
  if (ci.type === 'KeyboardShortcut') {
    if (meta.shortcutKey) result.shortcutKey = meta.shortcutKey;
    if (meta.keyValue) result.keyValue = meta.keyValue;
    if (meta.keyCode) result.keyCode = meta.keyCode;
    if (meta.playwrightKey) result.playwrightKey = meta.playwrightKey;
    if (meta.hasCtrl !== undefined) result.hasCtrl = meta.hasCtrl;
    if (meta.hasShift !== undefined) result.hasShift = meta.hasShift;
    if (meta.hasAlt !== undefined) result.hasAlt = meta.hasAlt;
    if (meta.hasCmd !== undefined) result.hasCmd = meta.hasCmd;
  }

  // ModalDialog
  if (ci.type === 'ModalDialog') {
    if (meta.modalTitle) result.modalTitle = meta.modalTitle;
    if (meta.subActions) result.modalSubActions = meta.subActions;
    if (meta.hasSubActions !== undefined) result.hasSubActions = meta.hasSubActions;
  }

  // Stepper
  if (ci.type === 'Stepper') {
    if (meta.fieldName) result.targetName = meta.fieldName;
    if (meta.totalDelta !== undefined) result.stepperDelta = meta.totalDelta;
    if (meta.subActions) result.stepperSubActions = meta.subActions;
  }

  // ConfigurationSession — pass through for field-based IR expansion
  if (meta.configurationSession) {
    result.configurationSession = meta.configurationSession;
    const cs = meta.configurationSession as Record<string, unknown>;
    if (cs.fields) {
      const fields = cs.fields as Array<{
        label: string;
        finalValue?: string;
        delta?: number;
      }>;
      const configured: Record<string, string> = {};
      for (const f of fields) {
        if (f.finalValue) {
          configured[f.label] = f.finalValue;
        } else if (f.delta !== undefined) {
          configured[f.label] = `${f.delta > 0 ? '+' : ''}${f.delta}`;
        }
      }
      if (Object.keys(configured).length > 0) {
        result.configuredFields = configured;
        result.semanticAction = 'configure';
      }
    }
    if (cs.triggerLabel) {
      result.panelLabel = cs.triggerLabel;
    }
  }

  return {
    interactionId: ci.interactionId,
    type,
    eventIds: (ci.memberEvents ?? []).map((e) => e.eventId),
    rawEventTypes: [...new Set((ci.memberEvents ?? []).map((e) => e.eventType))],
    target: ci.trigger,
    metadata: result,
    // Use evidence-calibrated confidence when available; fall back to
    // endState-based heuristic for interactions that bypassed annotation.
    confidence: ci.confidence ?? (ci.endState === 'completed' ? 1.0 : 0.5),
  };
}

// ── Interaction Type → IRAction Mapping ────────────────────

const INTERACTION_TO_IR_ACTION: Record<BridgeInteractionType, IRAction> = {
  // Navigation
  PageNavigation: IRAction.NAVIGATE,
  Back: IRAction.NAVIGATE,
  Forward: IRAction.NAVIGATE,
  Refresh: IRAction.NAVIGATE,
  // Mouse
  Click: IRAction.CLICK,
  DoubleClick: IRAction.CLICK,
  RightClick: IRAction.CLICK,
  Hover: IRAction.HOVER,
  DragDrop: IRAction.DRAG_DROP,
  KeyboardShortcut: IRAction.PRESS_KEY,
  // Text Entry
  TextEntry: IRAction.FILL,
  RichTextEditor: IRAction.FILL,
  // Selection Controls
  NativeDropdown: IRAction.SELECT,
  CustomDropdown: IRAction.SELECT,
  Autocomplete: IRAction.SELECT,
  MultiSelect: IRAction.SELECT,
  Checkbox: IRAction.TOGGLE,
  RadioButton: IRAction.CLICK,
  ToggleSwitch: IRAction.TOGGLE,
  Slider: IRAction.FILL,
  // Date & Time
  DatePicker: IRAction.SELECT_DATE,
  TimePicker: IRAction.SELECT_DATE,
  DateTimePicker: IRAction.SELECT_DATE,
  // File Upload
  FileUpload: IRAction.FILL,
  DragDropUpload: IRAction.FILL,
  // Navigation UI
  Link: IRAction.CLICK,
  Tab: IRAction.CLICK,
  Menu: IRAction.CLICK,
  Breadcrumb: IRAction.CLICK,
  // Scrolling — noise, filtered out
  PageScroll: IRAction.CLICK,
  ContainerScroll: IRAction.CLICK,
  InfiniteScroll: IRAction.CLICK,
  // Dialogs
  BrowserAlert: IRAction.CLICK,
  Modal: IRAction.CLICK,
  ModalDialog: IRAction.CLICK,
  Stepper: IRAction.CLICK,
  TagInput: IRAction.FILL,
  OtpInput: IRAction.FILL,
  HotkeySequence: IRAction.PRESS_KEY,
  Drawer: IRAction.CLICK,
  Popover: IRAction.CLICK,
  Tooltip: IRAction.HOVER,
  // Window & Frame
  NewTab: IRAction.CLICK,
  NewWindow: IRAction.CLICK,
  Iframe: IRAction.CLICK,
  // Unknown
  Unknown: IRAction.CLICK,
};

// ── Locator Resolution (ElementIdentity → ResolvedLocator[]) ──

/**
 * Resolve locators from ElementIdentity using the shared ranking rules.
 *
 * Delegates to the shared rankLocatorCandidates() function so that
 * recording-time and execution-time locator resolution use the same
 * priority assignment, filtering, and confidence scoring.
 *
 * @see src/domain/locator-ranking.ts for the shared ranking logic.
 */
export function resolveLocatorsForIR(identity: ElementIdentity): ResolvedLocator[] {
  const candidates = extractCandidatesFromIdentity(identity);
  const ranked = rankLocatorCandidates(candidates);
  // RankedLocator is structurally compatible with ResolvedLocator
  return ranked as ResolvedLocator[];
}

// ── Target Resolution (ElementIdentity → ResolvedTarget) ───

function resolveElementTarget(identity: ElementIdentity): ElementTarget {
  const locators = resolveLocatorsForIR(identity);
  return {
    kind: 'element',
    elementId: identity.elementId,
    elementName: identity.accessibleName || identity.ariaLabel || identity.tag,
    pageOrComponent: 'main',
    resolvedLocators: locators,
  };
}

function resolveUrlTarget(url: string): ResolvedTarget {
  return { kind: 'url', url };
}

// ── Frame Resolution ──────────────────────────────────────

/**
 * Regex to detect CSS-unsafe characters in id/name values.
 * Non-global: used only with .test() (global flag causes lastIndex statefulness).
 */
const CSS_UNSAFE_CHAR_RE = /[^a-zA-Z0-9_-]/;

/**
 * CSS.escape polyfill for contexts where the global CSS object is unavailable
 * (e.g. service workers have no DOM, no window, no CSS global).
 * Mirrors the guarded pattern used in identity-extractor.ts, locator-resolver.ts,
 * and phase5 recorder (removed v1).
 */
function cssEscape(value: string): string {
  if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') {
    return CSS.escape(value);
  }
  // Polyfill: escape ALL special chars (global flag required for replace)
  return value.replace(/[^a-zA-Z0-9_-]/g, (ch) => `\\${ch}`);
}

/**
 * URLs that don't resolve to meaningful iframe[src*=...] selectors.
 * Multiple iframes can share these (e.g. multiple srcdoc editors).
 */
const AMBIGUOUS_FRAME_URLS = new Set(['about:srcdoc', 'about:blank']);

/**
 * Resolve a frame locator from an element's iframe context.
 *
 * Uses the service worker's authoritative frame tree data (`swAncestorUrls`)
 * when available — this provides the complete ancestor chain for nested
 * iframes. Falls back to the content script's single-frame data otherwise.
 *
 * ## Selector Priority (per frame in the chain)
 * 1. frameSelector (CSS selector — same-origin only)
 * 2. frameName → iframe[name="..."]
 * 3. frameId → iframe#id
 * 4. frameSrc → iframe[src*="partial-url"] (cross-origin safe)
 * 5. frameIndex → fallback nth-of-type
 *
 * Returns undefined for top-frame elements.
 */
function resolveFrame(identity: ElementIdentity): ResolvedFrame | undefined {
  if (!identity.inIframe || !identity.iframeContext) {
    return undefined;
  }

  const ctx: IframeContext = identity.iframeContext;

  // ── Resolve the immediate parent frame selector ──
  const immediateSelector = resolveFrameSelector(ctx);
  if (!immediateSelector) return undefined;

  // Use SW's authoritative depth if available, fall back to content script's
  const depth = ctx.swDepth ?? ctx.frameDepth;

  // ── Resolve ancestor chain for nested iframes ──
  // swAncestorUrls is populated by the SW's FrameTree. It includes all frame URLs
  // from the top frame down to the immediate parent:
  //   [topFrameUrl, ancestor1Url, ..., immediateParentUrl]
  //
  // For ancestor chain (intermediate iframes that need frameLocator()):
  // - Exclude index 0 (top frame — it's the page itself, not an iframe)
  // - Exclude the last element (immediate parent — already handled by `selector`)
  let ancestors: ResolvedFrame['ancestors'];

  if (ctx.swAncestorUrls && ctx.swAncestorUrls.length > 2) {
    // Slice from index 1 (skip top frame) to -1 (skip immediate parent)
    const ancestorUrls = ctx.swAncestorUrls.slice(1, -1);
    ancestors = ancestorUrls.map(url => resolveFrameFromUrl(url));
  }

  return {
    selector: immediateSelector.selector,
    strategy: immediateSelector.strategy,
    frameSrc: ctx.frameSrc,
    depth,
    ...(ancestors && ancestors.length > 0 ? { ancestors } : {}),
  };
}

/**
 * Resolve a single frame selector from an IframeContext's DOM-derived fields.
 *
 * Priority: frameSelector > frameName > frameId > frameSrc > frameIndex
 */
function resolveFrameSelector(ctx: IframeContext): {
  selector: string;
  strategy: 'css' | 'name' | 'url' | 'index';
} | null {
  // Priority 1: CSS selector (most reliable — same-origin only)
  if (ctx.frameSelector) {
    return { selector: ctx.frameSelector, strategy: 'css' };
  }

  // Priority 2: name attribute — escape quotes to prevent selector injection
  if (ctx.frameName) {
    const escapedName = ctx.frameName.replace(/["\\]/g, '\\$&');
    return { selector: `iframe[name="${escapedName}"]`, strategy: 'name' };
  }

  // Priority 3: id attribute — escape special CSS characters
  if (ctx.frameId) {
    const escapedId = CSS_UNSAFE_CHAR_RE.test(ctx.frameId)
      ? cssEscape(ctx.frameId)
      : ctx.frameId;
    return { selector: `iframe#${escapedId}`, strategy: 'css' };
  }

  // Priority 4: source URL partial match (always available — cross-origin safe)
  // Ambiguous URLs (about:srcdoc, about:blank) can't uniquely identify an iframe
  if (ctx.frameSrc && !AMBIGUOUS_FRAME_URLS.has(ctx.frameSrc)) {
    const urlPart = extractUrlFragment(ctx.frameSrc);
    const escapedUrl = urlPart.replace(/["\\]/g, '\\$&');
    return { selector: `iframe[src*="${escapedUrl}"]`, strategy: 'url' };
  }

  // Priority 5: index-based fallback
  if (ctx.frameIndex !== null) {
    return { selector: `iframe >> nth=${ctx.frameIndex}`, strategy: 'index' };
  }

  return null;
}

/**
 * Resolve a frame selector from a URL alone (for ancestor frames where
 * we only have the URL from the SW's FrameTree, not DOM attributes).
 *
 * For ambiguous URLs (about:srcdoc, about:blank), the URL cannot be used
 * to uniquely identify an iframe. We fall back to a broader selector and
 * rely on frameLocator() chaining from the parent to disambiguate.
 */
function resolveFrameFromUrl(url: string): {
  selector: string;
  strategy: 'css' | 'name' | 'url' | 'index';
  frameSrc?: string;
} {
  // Ambiguous URLs — can't match by src attribute meaningfully
  if (AMBIGUOUS_FRAME_URLS.has(url)) {
    return {
      selector: 'iframe',
      strategy: 'index',
      frameSrc: url,
    };
  }

  const urlPart = extractUrlFragment(url);
  const escapedUrl = urlPart.replace(/["\\]/g, '\\$&');
  return {
    selector: `iframe[src*="${escapedUrl}"]`,
    strategy: 'url',
    frameSrc: url,
  };
}

/**
 * Extract a stable URL fragment for iframe src matching.
 *
 * Strategy:
 * 1. Last path segment (usually most distinctive) — e.g. "checkout" from /api/checkout
 * 2. If query params exist, append the first param key+value for disambiguation
 *    (e.g. "checkout?session=a" to distinguish multiple same-path iframes)
 * 3. Fall back to hostname
 */
function extractUrlFragment(url: string): string {
  try {
    const parsed = new URL(url);
    // Prefer the last path segment — usually most distinctive
    const segments = parsed.pathname.split('/').filter(Boolean);
    const pathPart = segments.length > 0
      ? segments[segments.length - 1]
      : parsed.hostname;

    // If query params exist, include the first one for disambiguation
    // This handles common patterns like /widget?session=A vs /widget?session=B
    const searchParams = parsed.searchParams;
    if (searchParams.toString()) {
      const firstParam = Array.from(searchParams.entries())[0];
      if (firstParam) {
        const [key, value] = firstParam;
        // Use a short, safe fragment of the value to keep selectors manageable
        const valuePart = value.slice(0, 20).replace(/["\\]/g, '');
        return `${pathPart}?${key}=${valuePart}`;
      }
    }

    return pathPart;
  } catch {
    // Not a valid URL — return as-is (may be a relative path)
    return url.slice(-30);
  }
}

// ── Description Generation ─────────────────────────────────

function generateDescription(
  interaction: BridgeInteraction,
  event: SessionEvent | undefined,
  logicalAction: LogicalAction | undefined,
): string {
  const name = getElementDisplayName(interaction, event);
  const businessField = logicalAction?.businessField;

  switch (interaction.type) {
    case 'TextEntry':
    case 'RichTextEditor': {
      const value = event?.type === 'text' ? event.value : interaction.metadata.textValue ?? '';
      return businessField
        ? `Fill "${value}" in the ${businessField} field`
        : `Fill "${value}" in the ${name}`;
    }
    case 'Checkbox':
    case 'ToggleSwitch': {
      const checked = event?.type === 'checkbox' ? event.checked : interaction.metadata.checked ?? false;
      return businessField
        ? `${checked ? 'Check' : 'Uncheck'} the ${businessField}`
        : `${checked ? 'Check' : 'Uncheck'} the ${name}`;
    }
    case 'NativeDropdown':
    case 'CustomDropdown':
    case 'Autocomplete':
    case 'MultiSelect': {
      const value = event?.type === 'select' ? event.value : interaction.metadata.selectedValue ?? '';
      return businessField
        ? `Select "${value}" from the ${businessField}`
        : `Select "${value}" from the ${name}`;
    }
    case 'RadioButton': {
      const value = interaction.metadata.selectedValue ?? name;
      return businessField
        ? `Select "${value}" in the ${businessField}`
        : `Select "${value}"`;
    }
    case 'DatePicker':
    case 'TimePicker':
    case 'DateTimePicker': {
      const value = event?.type === 'dateSelect' ? event.displayValue : interaction.metadata.dateValue ?? '';
      return businessField
        ? `Select ${value} in the ${businessField}`
        : `Select ${value} in the ${name}`;
    }
    case 'PageNavigation':
    case 'Back':
    case 'Forward':
    case 'Refresh': {
      const url = event?.type === 'navigation' ? event.url : interaction.metadata.url ?? '';
      return `Navigate to ${url}`;
    }
    case 'Hover':
      return `Hover over the ${name}`;
    case 'KeyboardShortcut': {
      const shortcut = interaction.metadata.shortcutKey ?? 'key';
      return `Press ${shortcut}`;
    }
    case 'DragDrop': {
      const dropTarget = interaction.metadata.dropTarget ?? 'target';
      return businessField
        ? `Drag the ${businessField} to ${dropTarget}`
        : `Drag the ${name} to ${dropTarget}`;
    }
    case 'Slider': {
      const value = interaction.metadata.sliderValue ?? '';
      return businessField
        ? `Set the ${businessField} to ${value}`
        : `Set the slider to ${value}`;
    }
    case 'FileUpload':
    case 'DragDropUpload': {
      const count = interaction.metadata.fileCount ?? 1;
      return businessField
        ? `Upload ${count} file(s) to the ${businessField}`
        : `Upload ${count} file(s)`;
    }
    case 'PageScroll':
    case 'ContainerScroll':
    case 'InfiniteScroll':
      return `Scroll the page`;
    case 'Tab': {
      const tab = interaction.metadata.selectedTab ?? name;
      return `Click the "${tab}" tab`;
    }
    case 'Link':
      return `Click the "${name}" link`;
    case 'Modal':
    case 'Drawer':
    case 'Popover':
      return `Interact with the ${interaction.metadata.surfaceLabel ?? name}`;
    case 'BrowserAlert': {
      const result = interaction.metadata.dialogResult ?? '';
      return `${result} the ${interaction.metadata.dialogType ?? 'dialog'}`;
    }
    case 'Stepper': {
      const delta = Number(interaction.metadata.stepperDelta ?? 0);
      const field = interaction.metadata.targetName ?? name;
      if (delta > 0) return businessField ? `Increase ${businessField} by ${delta}` : `Increase ${field} by ${delta}`;
      if (delta < 0) return businessField ? `Decrease ${businessField} by ${Math.abs(delta)}` : `Decrease ${field} by ${Math.abs(delta)}`;
      return businessField ? `Adjust ${businessField}` : `Adjust ${field}`;
    }
    case 'ModalDialog': {
      const title = interaction.metadata.modalTitle ?? name;
      return businessField ? `Open the ${businessField} dialog` : `Open the "${title}" dialog`;
    }
    case 'TagInput': {
      const tags = (interaction.metadata.tags as string[]) ?? [];
      const field = businessField ?? name;
      if (tags.length === 1) return `Add tag "${tags[0]}" to ${field}`;
      if (tags.length > 1) return `Add tags ${tags.map(t => `"${t}"`).join(', ')} to ${field}`;
      return `Type in ${field}`;
    }
    case 'OtpInput': {
      const value = (interaction.metadata.otpValue as string) ?? '';
      const field = businessField ?? name;
      return `Enter ${value} in the ${field}`;
    }
    case 'HotkeySequence': {
      const sequence = (interaction.metadata.sequenceDisplay as string) ?? 'key sequence';
      return `Press ${sequence}`;
    }
    default:
      return businessField
        ? `Click the ${businessField}`
        : `Click the ${name}`;
  }
}

function generatePlainEnglish(
  interaction: BridgeInteraction,
  event: SessionEvent | undefined,
  logicalAction: LogicalAction | undefined,
): string {
  // plainEnglish is a simpler, more human-friendly version
  const description = generateDescription(interaction, event, logicalAction);
  // Capitalize first letter
  return description.charAt(0).toUpperCase() + description.slice(1);
}

function getElementDisplayName(
  interaction: BridgeInteraction,
  event: SessionEvent | undefined,
): string {
  if (interaction.target?.accessibleName) {
    return interaction.target.accessibleName;
  }
  if (interaction.target?.ariaLabel) {
    return interaction.target.ariaLabel;
  }
  if (event && 'elementIdentity' in event) {
    return event.elementIdentity.accessibleName || event.elementIdentity.ariaLabel || event.elementIdentity.tag;
  }
  return (interaction.metadata.accessibleName as string) ?? 'element';
}

// ── Input Value Extraction ─────────────────────────────────

function extractInputValue(
  interaction: BridgeInteraction,
  event: SessionEvent | undefined,
): IRInput {
  const m = interaction.metadata;
  switch (interaction.type) {
    case 'TextEntry':
    case 'RichTextEditor':
      return event?.type === 'text' ? event.value : ((m.textValue as string) ?? null);

    case 'Checkbox':
    case 'ToggleSwitch':
      return event?.type === 'checkbox' ? event.checked : ((m.checked as boolean) ?? null);

    case 'NativeDropdown':
    case 'CustomDropdown':
    case 'Autocomplete':
    case 'MultiSelect':
    case 'RadioButton':
      return event?.type === 'select' ? event.value : ((m.selectedValue as string) ?? null);

    case 'DatePicker':
    case 'TimePicker':
    case 'DateTimePicker':
      return event?.type === 'dateSelect' ? event.isoValue : ((m.dateValue as string) ?? null);

    case 'Slider':
      return (m.sliderValue as string) ?? null;

    case 'TagInput':
      return ((m.tags as string[]) ?? []).join(', ') || null;

    case 'OtpInput':
      return (m.otpValue as string) ?? null;

    case 'HotkeySequence':
      return (m.playwrightSequence as string) ?? (m.sequenceDisplay as string) ?? null;

    case 'KeyboardShortcut':
      return (m.playwrightKey as string) ?? (m.shortcutKey as string) ?? null;

    case 'PageNavigation':
    case 'Back':
    case 'Forward':
    case 'Refresh':
      return event?.type === 'navigation' ? event.url : ((m.url as string) ?? null);

    default:
      return null;
  }
}

// ── AI Enrichment Extraction ───────────────────────────────

function extractAIEnrichment(event: SessionEvent | undefined): AIUnderstanding | null {
  if (!event) return null;
  if (!('aiUnderstanding' in event)) return null;
  return event.aiUnderstanding ?? null;
}

// ── Assertion Derivation (from Knowledge Fragment) ─────────

/**
 * Derive IRAssertion[] from InteractionContract.constraints.
 *
 * Maps DOM constraints captured by the enrichment pipeline into
 * executable validation assertions.
 */
export function deriveAssertions(
  elementId: string,
  fragment: ApplicationKnowledgeFragment | null,
): IRAssertion[] {
  if (!fragment) return [];

  // Find the interaction contract that applies to this element
  const contract = fragment.interactionContracts.find(
    (c) => c.appliesTo.type === 'element' && c.appliesTo.id === elementId,
  );

  if (!contract) return [];

  return constraintsToAssertions(contract, elementId);
}

function constraintsToAssertions(
  contract: InteractionContract,
  elementId: string,
): IRAssertion[] {
  const assertions: IRAssertion[] = [];
  const c = contract.constraints;
  const target: ResolvedTarget = {
    kind: 'element',
    elementId,
    elementName: '',
    pageOrComponent: '',
    resolvedLocators: [],
  };

  // required → presence assertion
  if (c.required === true) {
    assertions.push({
      type: ValidationType.PRESENCE,
      comparison: ValidationComparison.IS_TRUE,
      expectedValue: true,
      severity: ValidationSeverity.HARD,
      target,
      property: 'required',
    });
  }

  // valueRange (min/max) → comparison assertions
  if (c.valueRange) {
    if (c.valueRange.min !== null && c.valueRange.min !== undefined) {
      assertions.push({
        type: ValidationType.ATTRIBUTE_MATCH,
        comparison: ValidationComparison.GREATER_THAN,
        expectedValue: c.valueRange.min,
        severity: ValidationSeverity.SOFT,
        target,
        property: 'min',
      });
    }
    if (c.valueRange.max !== null && c.valueRange.max !== undefined) {
      assertions.push({
        type: ValidationType.ATTRIBUTE_MATCH,
        comparison: ValidationComparison.LESS_THAN,
        expectedValue: c.valueRange.max,
        severity: ValidationSeverity.SOFT,
        target,
        property: 'max',
      });
    }
  }

  // lengthRange (minLength/maxLength)
  if (c.lengthRange) {
    if (c.lengthRange.minLength !== null && c.lengthRange.minLength !== undefined) {
      assertions.push({
        type: ValidationType.ATTRIBUTE_MATCH,
        comparison: ValidationComparison.GREATER_THAN,
        expectedValue: c.lengthRange.minLength,
        severity: ValidationSeverity.SOFT,
        target,
        property: 'minlength',
      });
    }
    if (c.lengthRange.maxLength !== null && c.lengthRange.maxLength !== undefined) {
      assertions.push({
        type: ValidationType.ATTRIBUTE_MATCH,
        comparison: ValidationComparison.LESS_THAN,
        expectedValue: c.lengthRange.maxLength,
        severity: ValidationSeverity.SOFT,
        target,
        property: 'maxlength',
      });
    }
  }

  // format (regex pattern)
  if (c.format?.regex) {
    assertions.push({
      type: ValidationType.TEXT_MATCH,
      comparison: ValidationComparison.MATCHES,
      expectedValue: c.format.regex,
      severity: ValidationSeverity.SOFT,
      target,
      property: 'pattern',
    });
  }

  // validOptions → equality assertion (value must be one of)
  if (c.validOptions && c.validOptions.length > 0) {
    assertions.push({
      type: ValidationType.EQUALITY,
      comparison: ValidationComparison.EQUALS,
      expectedValue: c.validOptions,
      severity: ValidationSeverity.SOFT,
      target,
      property: 'value',
    });
  }

  return assertions;
}

// ── Event ↔ Interaction Correlation ────────────────────────

/**
 * Build a lookup from actionId → SessionEvent for fast correlation.
 */
function buildEventIndex(events: SessionEvent[]): Map<string, SessionEvent> {
  const index = new Map<string, SessionEvent>();
  for (const event of events) {
    index.set(event.actionId, event);
  }
  return index;
}

/**
 * Find the SessionEvent that corresponds to a DetectedInteraction.
 * DetectedInteraction.eventIds links back to the raw events.
 */
function findCorrespondingEvent(
  interaction: BridgeInteraction,
  eventIndex: Map<string, SessionEvent>,
): SessionEvent | undefined {
  for (const eventId of interaction.eventIds) {
    const event = eventIndex.get(eventId);
    if (event) return event;
  }
  return undefined;
}

/**
 * Find the LogicalAction that corresponds to a transition/interaction.
 * Uses timestamp proximity — the LogicalAction whose timestamp is closest.
 */
function findLogicalAction(
  interaction: BridgeInteraction,
  fragment: ApplicationKnowledgeFragment | null,
): LogicalAction | undefined {
  if (!fragment) return undefined;

  // Try to match by transition IDs in the logical action
  // LogicalAction.transitionIds contains transition IDs from the enrichment pipeline
  // These correspond to ObservedTransition.transitionId, which were mapped from
  // DetectedInteraction.interactionId in the domain adapter.
  const match = fragment.logicalActions.find(
    (la) => la.transitionIds.includes(interaction.interactionId),
  );
  if (match) return match;

  // Fallback: no match found
  return undefined;
}

// ── Noise Filtering ────────────────────────────────────────

/**
 * Interaction types that produce no meaningful test step.
 * Filtered out during IR plan construction.
 */
const NOISE_TYPES: Set<BridgeInteractionType> = new Set([
  'PageScroll',
  'ContainerScroll',
  'InfiniteScroll',
  'Unknown',
]);

// ── Readability Rules ──────────────────────────────────────

/**
 * Apply readability rules to IRStep[].
 *
 * OR-1: Merge consecutive focus+click on the same element into a single CLICK step.
 * (In the recording pipeline, focus and click are often captured as separate events,
 * but they represent a single user action.)
 *
 * Note: In the current pipeline, DetectedInteractions are already classified at the
 * interaction level (not the raw event level), so duplicate focus+click patterns
 * are rare. This rule handles the edge case where they slip through.
 */
function applyReadabilityRules(steps: IRStep[]): IRStep[] {
  if (steps.length <= 1) return steps;

  const result: IRStep[] = [];
  let i = 0;

  while (i < steps.length) {
    const current = steps[i];
    const next = steps[i + 1];

    // OR-1: Merge consecutive CLICK on same element
    if (
      next &&
      current.action === IRAction.CLICK &&
      next.action === IRAction.CLICK &&
      current.target.kind === 'element' &&
      next.target.kind === 'element' &&
      current.target.elementId === next.target.elementId
    ) {
      // Skip the duplicate — keep only the first
      result.push(current);
      i += 2;
      continue;
    }

    // OR-2: Merge consecutive FILL on same element (e.g., date picker
    // fires change events for both old and new value, producing duplicate
    // TextEntry interactions). Keep only the LAST fill (final value).
    // Compare by elementId OR by matching top resolved locator.
    if (
      next &&
      current.action === IRAction.FILL &&
      next.action === IRAction.FILL &&
      current.target.kind === 'element' &&
      next.target.kind === 'element'
    ) {
      const sameId = current.target.elementId === next.target.elementId;
      const sameLocator =
        current.target.resolvedLocators?.[0]?.value === next.target.resolvedLocators?.[0]?.value &&
        !!current.target.resolvedLocators?.[0]?.value;
      const sameName = current.target.elementName === next.target.elementName &&
        !!current.target.elementName;

      if (sameId || sameLocator || sameName) {
        // Skip current, keep next (next has the final committed value)
        i += 1;
        continue;
      }
    }

    result.push(current);
    i++;
  }

  // Re-number order after merging
  return result.map((step, idx) => ({ ...step, order: idx }));
}

// ── Main Build Function ────────────────────────────────────

/**
 * Build an ExecutionIRPlan from recording outputs.
 *
 * This is the single integration point where:
 *   - SessionEvent[] provides locators, input values, DOM context, AI enrichment
 *   - DetectedInteraction[] provides classification (40 types), metadata, confidence
 *   - ApplicationKnowledgeFragment provides assertions, business fields, workflow structure
 *
 * The plan produced is the single source of truth for all downstream phases
 * (code generation, test execution, staleness detection).
 *
 * @param input Encapsulated bridge inputs (see IRBridgeInput)
 * @returns ExecutionIRPlan — the unified execution representation
 */
export function build(input: IRBridgeInput, enrichment?: EnrichmentOutput): ExecutionIRPlan {
  const { events, recordingContext, testCaseName } = input;
  const fragment = input.understanding?.fragment ?? null;

  // Convert ComponentInteraction[] → BridgeInteraction[] (internal normalization)
  const interactions = input.interactions.map(toBridgeInteraction);

  // Build a lookup from interactionId to original ComponentInteraction for
  // accessing semantic fields (intent, evidenceTrail) not present on BridgeInteraction.
  const componentInteractionById = new Map<string, ComponentInteraction>();
  for (const ci of input.interactions) {
    componentInteractionById.set(ci.interactionId, ci);
  }

  const eventIndex = buildEventIndex(events);
  const steps: IRStep[] = [];
  let stepCounter = 0;

  for (const interaction of interactions) {
    // Filter noise interactions
    if (NOISE_TYPES.has(interaction.type)) continue;

    const event = findCorrespondingEvent(interaction, eventIndex);
    const logicalAction = findLogicalAction(interaction, fragment);

    // ── Phase 0e: Structural Semantic Enrichment ──
    // When configurationSession is present, use field-based expansion.
    // Each field becomes an IR step with the optimal action for its kind:
    //   counter → fill (if target accepts text) or click N times
    //   select  → click on the option
    //   toggle  → check/uncheck
    //   text    → fill
    //   date    → fill
    const configSession = interaction.metadata?.configurationSession;
    if (
      configSession &&
      typeof configSession === 'object' &&
      'fields' in configSession
    ) {
      const session = configSession as {
        fields: Array<{
          label: string;
          kind: string;
          finalValue: string;
          delta?: number;
          evidence?: Array<{ target?: ElementIdentity; action: string }>;
        }>;
        commitAction?: { label?: string };
        triggerLabel?: string;
      };

      for (const field of session.fields) {
        const fieldStep = buildFieldStep(
          field, interaction, event, logicalAction, stepCounter,
        );
        if (fieldStep) {
          steps.push(fieldStep);
          stepCounter++;
        }
      }

      // Add commit action as final step
      if (session.commitAction) {
        const commitLabel = session.commitAction.label ?? 'Done';
        steps.push({
          id: `step-${String(stepCounter + 1).padStart(4, '0')}`,
          order: stepCounter,
          action: IRAction.CLICK,
          description: `Click ${commitLabel}`,
          target: resolveElementTarget(
            { ...interaction.target!, elementId: `${interaction.target?.elementId ?? 'elem'}::${commitLabel}`, accessibleName: commitLabel },
          ),
          input: null,
          assertions: deriveAssertions('', null),
          executionParameters: DEFAULT_EXECUTION_PARAMETERS,
          aiEnrichment: null,
          sourceEventId: interaction.eventIds[0] ?? event?.actionId,
          plainEnglish: `Confirm ${session.triggerLabel ?? 'selections'}`,
        });
        stepCounter++;
      }
      continue; // Skip default single-step generation
    }

    // ── Multi-config dropdown expansion (legacy subActions path) ──
    // When a Dropdown interaction has subActions (steppers, options, toggles,
    // confirm button), expand into one IR step per subAction. This produces
    // the correct Playwright code: open → adjust Adults → select Premium
    // Economy → click Done.
    const subActions = interaction.metadata.subActions;
    if (
      subActions &&
      Array.isArray(subActions) &&
      subActions.length > 0 &&
      interaction.metadata.isMultiConfig === true
    ) {
      for (const sub of subActions as Array<{ action: string; label: string; value?: string }>) {
        const subStep = buildSubActionStep(
          sub, interaction, event, logicalAction, stepCounter,
        );
        if (subStep) {
          steps.push(subStep);
          stepCounter++;
        }
      }
      continue; // Skip the default single-step generation
    }

    // ── ModalDialog subAction expansion ──
    // A ModalDialog interaction captures all clicks/inputs inside the modal.
    // Expand into one IR step per subAction: open modal (trigger click) →
    // select option → check box → click confirm/close.
    const modalSubActions = interaction.metadata.modalSubActions;
    if (
      modalSubActions &&
      Array.isArray(modalSubActions) &&
      modalSubActions.length > 0
    ) {
      // Step 1: the trigger click that opened the modal
      const triggerLabel = interaction.metadata.accessibleName ?? interaction.metadata.modalTitle ?? 'Open modal';
      steps.push({
        id: `step-${String(stepCounter + 1).padStart(4, '0')}`,
        order: stepCounter,
        action: IRAction.CLICK,
        description: `Open "${interaction.metadata.modalTitle ?? triggerLabel}" dialog`,
        target: resolveElementTarget(interaction.target!),
        input: null,
        assertions: deriveAssertions('', null),
        executionParameters: DEFAULT_EXECUTION_PARAMETERS,
        aiEnrichment: null,
        sourceEventId: interaction.eventIds[0] ?? event?.actionId,
        plainEnglish: `Open ${interaction.metadata.modalTitle ?? triggerLabel} dialog`,
      });
      stepCounter++;

      // Steps 2..N: each subAction inside the modal
      for (const sub of modalSubActions as Array<{ action: string; label: string; value?: string }>) {
        const subStep = buildSubActionStep(
          sub, interaction, event, logicalAction, stepCounter,
        );
        if (subStep) {
          steps.push(subStep);
          stepCounter++;
        }
      }
      continue; // Skip the default single-step generation
    }

    // Determine action
    const action = INTERACTION_TO_IR_ACTION[interaction.type] ?? IRAction.CLICK;

    // Resolve target
    let target: ResolvedTarget;
    if (action === IRAction.NAVIGATE) {
      const url = event?.type === 'navigation' ? event.url : ((interaction.metadata.url as string) ?? recordingContext.startUrl);
      target = resolveUrlTarget(url);
    } else if (interaction.target) {
      target = resolveElementTarget(interaction.target);
    } else if (event && 'elementIdentity' in event) {
      target = resolveElementTarget(event.elementIdentity);
    } else {
      target = { kind: 'none' };
    }

    // Resolve frame context for iframe-embedded elements
    const frameSource = interaction.target ?? (event && 'elementIdentity' in event ? event.elementIdentity : null);
    const frame = frameSource ? resolveFrame(frameSource as ElementIdentity) : undefined;

    // Extract input value
    const inputValue = extractInputValue(interaction, event);

    // Generate description
    const description = generateDescription(interaction, event, logicalAction);
    const plainEnglish = generatePlainEnglish(interaction, event, logicalAction);

    // Extract AI enrichment
    const aiEnrichment = extractAIEnrichment(event);

    // Source event ID
    const sourceEventId = interaction.eventIds[0] ?? event?.actionId;

    // Derive assertions. When enrichment output is provided (Interaction
    // Enrichment Pass), use pre-derived assertions with already-backfilled
    // locators. Otherwise, fall back to inline derivation + backfill.
    let assertions: IRAssertion[];
    if (enrichment) {
      assertions = enrichment.assertions.get(interaction.interactionId) ?? [];
    } else {
      // Backward-compatible path: derive + backfill inline
      const elementId = target.kind === 'element' ? target.elementId : '';
      const constraintAssertions = deriveAssertions(elementId, fragment);
      const stateAssertions = deriveStateAssertions(interaction);
      const rawAssertions = [...constraintAssertions, ...stateAssertions];

      // Backfill resolved locators into assertion targets (F5 fix).
      // deriveStateAssertions() creates targets with empty resolvedLocators[].
      // Without locators, the Playwright assertion renderer crashes. Copy the
      // step's resolved locators into every element-kind assertion target.
      const targetLocators = target.kind === 'element' ? target.resolvedLocators : [];
      const targetElementId = target.kind === 'element' ? target.elementId : '';
      const targetElementName = target.kind === 'element' ? target.elementName : '';
      assertions = rawAssertions.map((assertion) => {
        if (assertion.target.kind === 'element') {
          return {
            ...assertion,
            target: {
              ...assertion.target,
              resolvedLocators: targetLocators,
              elementId: targetElementId || assertion.target.elementId,
              elementName: targetElementName || assertion.target.elementName,
            },
          };
        }
        return assertion;
      });
    }

    // Execution parameters — default, with wait strategy based on confidence
    const executionParameters = {
      ...DEFAULT_EXECUTION_PARAMETERS,
      waitStrategy: interaction.confidence < 0.7 ? ('visible' as const) : DEFAULT_EXECUTION_PARAMETERS.waitStrategy,
    };

    // Map semantic intent and evidence trail from the original ComponentInteraction.
    // These fields are set by the evidence engine in onEmit via annotateWithEvidence().
    const originalCi = componentInteractionById.get(interaction.interactionId);
    const intent = originalCi?.intent;
    const evidenceTrail = originalCi?.evidenceTrail;

    steps.push({
      id: `step-${String(stepCounter + 1).padStart(4, '0')}`,
      order: stepCounter,
      action,
      description,
      target,
      input: inputValue,
      assertions,
      executionParameters,
      aiEnrichment,
      sourceEventId,
      plainEnglish,
      ...(frame ? { frame } : {}),
      ...(intent ? { intent } : {}),
      ...(evidenceTrail?.length ? { evidenceTrail } : {}),
    });

    stepCounter++;
  }

  // Apply readability rules (merge duplicates, re-number)
  const finalSteps = applyReadabilityRules(steps);

  // Derive tags from workflow surfaces
  const tags = deriveTags(fragment, recordingContext);

  // Build environment
  const environment: IREnvironment = {
    baseUrl: recordingContext.startUrl,
    browser: 'chrome',
    viewport: { width: 1280, height: 720 },
  };

  return {
    testCaseId: `tc-${Date.now()}`,
    testCaseVersionId: `tcv-${Date.now()}`,
    testCaseVersionNumber: 1,
    title: testCaseName,
    tags,
    environment,
    steps: finalSteps,
  };
}

/**
 * Derive tags from the knowledge fragment's recorded workflow.
 * Uses surface transition URLs as tags (e.g., "login", "dashboard").
 */
function deriveTags(
  fragment: ApplicationKnowledgeFragment | null,
  recordingContext: IRBridgeInput['recordingContext'],
): string[] {
  const tags: string[] = [];

  // Add the start URL path segment as a tag
  try {
    const url = new URL(recordingContext.startUrl);
    const pathSegment = url.pathname.split('/').filter(Boolean)[0];
    if (pathSegment) tags.push(pathSegment);
  } catch {
    // Ignore invalid URLs
  }

  // Add surface transitions from the fragment
  if (fragment?.recordedWorkflow.surfaceTransitions) {
    for (const transition of fragment.recordedWorkflow.surfaceTransitions) {
      try {
        const url = new URL(transition.toUrl);
        const segment = url.pathname.split('/').filter(Boolean)[0];
        if (segment && !tags.includes(segment)) {
          tags.push(segment);
        }
      } catch {
        // Ignore invalid URLs
      }
    }
  }

  return tags.slice(0, 5); // Max 5 tags
}

// ── Multi-Config SubAction Expansion ──────────────────────────────────
//
// When a Dropdown interaction has subActions (compound interaction), each
// subAction becomes its own IR step. The Playwright adapter then renders
// each step as a separate code line:
//
//   await page.getByRole('button', { name: 'Economy' }).click();       // open
//   await page.getByRole('button', { name: /Adults.*increase/ }).click(); // +
//   await page.getByRole('radio', { name: 'Premium Economy' }).click();  // select
//   await page.getByRole('button', { name: 'Done' }).click();            // confirm

interface RawSubAction {
  action: string;
  label: string;
  value?: string;
}

function buildSubActionStep(
  sub: RawSubAction,
  interaction: BridgeInteraction,
  event: SessionEvent | undefined,
  logicalAction: LogicalAction | undefined,
  stepCounter: number,
): IRStep | null {
  const fieldName = logicalAction?.businessField ?? getElementDisplayName(interaction, event);
  const assertions = deriveAssertions('', null);
  // Target is always defined when this function is called (subAction interactions
  // have targets by construction). Use non-null assertion for the type system.
  const target = interaction.target!;

  switch (sub.action) {
    case 'selectOption': {
      const stepAction = IRAction.CLICK; // SPA option clicks, not selectOption()
      return {
        id: `step-${String(stepCounter + 1).padStart(4, '0')}`,
        order: stepCounter,
        action: stepAction,
        description: `Select "${sub.value || sub.label}" in ${fieldName}`,
        target: resolveElementTarget(
          sub.label
            ? { ...target, accessibleName: sub.value || sub.label }
            : target,
        ),
        input: sub.value || sub.label,
        assertions,
        executionParameters: DEFAULT_EXECUTION_PARAMETERS,
        aiEnrichment: null,
        sourceEventId: interaction.eventIds[0] ?? event?.actionId,
        plainEnglish: `Select ${sub.value || sub.label}`,
      };
    }
    case 'increment': {
      return {
        id: `step-${String(stepCounter + 1).padStart(4, '0')}`,
        order: stepCounter,
        action: IRAction.CLICK,
        description: `Increase ${sub.label} in ${fieldName}`,
        target: resolveElementTarget(
          sub.label
            ? { ...target, accessibleName: sub.label, ariaLabel: `Increase ${sub.label}` }
            : target,
        ),
        input: null,
        assertions,
        executionParameters: DEFAULT_EXECUTION_PARAMETERS,
        aiEnrichment: null,
        sourceEventId: interaction.eventIds[0] ?? event?.actionId,
        plainEnglish: `Increase ${sub.label}`,
      };
    }
    case 'decrement': {
      return {
        id: `step-${String(stepCounter + 1).padStart(4, '0')}`,
        order: stepCounter,
        action: IRAction.CLICK,
        description: `Decrease ${sub.label} in ${fieldName}`,
        target: resolveElementTarget(
          sub.label
            ? { ...target, accessibleName: sub.label, ariaLabel: `Decrease ${sub.label}` }
            : target,
        ),
        input: null,
        assertions,
        executionParameters: DEFAULT_EXECUTION_PARAMETERS,
        aiEnrichment: null,
        sourceEventId: interaction.eventIds[0] ?? event?.actionId,
        plainEnglish: `Decrease ${sub.label}`,
      };
    }
    case 'toggle': {
      const checked = sub.value === 'checked';
      return {
        id: `step-${String(stepCounter + 1).padStart(4, '0')}`,
        order: stepCounter,
        action: IRAction.TOGGLE,
        description: `${checked ? 'Check' : 'Uncheck'} ${sub.label} in ${fieldName}`,
        target: resolveElementTarget(
          sub.label
            ? { ...target, accessibleName: sub.label }
            : target,
        ),
        input: checked,
        assertions,
        executionParameters: DEFAULT_EXECUTION_PARAMETERS,
        aiEnrichment: null,
        sourceEventId: interaction.eventIds[0] ?? event?.actionId,
        plainEnglish: `${checked ? 'Check' : 'Uncheck'} ${sub.label}`,
      };
    }
    case 'fillInput': {
      return {
        id: `step-${String(stepCounter + 1).padStart(4, '0')}`,
        order: stepCounter,
        action: IRAction.FILL,
        description: `Enter "${sub.value || ''}" in ${sub.label || fieldName}`,
        target: resolveElementTarget(
          sub.label
            ? { ...target, accessibleName: sub.label }
            : target,
        ),
        input: sub.value || '',
        assertions,
        executionParameters: DEFAULT_EXECUTION_PARAMETERS,
        aiEnrichment: null,
        sourceEventId: interaction.eventIds[0] ?? event?.actionId,
        plainEnglish: `Enter ${sub.value || ''} in ${sub.label || fieldName}`,
      };
    }
    case 'confirm': {
      return {
        id: `step-${String(stepCounter + 1).padStart(4, '0')}`,
        order: stepCounter,
        action: IRAction.CLICK,
        description: `Click Done/Apply in ${fieldName}`,
        target: resolveElementTarget(
          sub.label
            ? { ...target, accessibleName: sub.label, ariaLabel: sub.label }
            : { ...target, accessibleName: 'Done' },
        ),
        input: null,
        assertions,
        executionParameters: DEFAULT_EXECUTION_PARAMETERS,
        aiEnrichment: null,
        sourceEventId: interaction.eventIds[0] ?? event?.actionId,
        plainEnglish: `Confirm ${fieldName} selections`,
      };
    }
    default:
      return null;
  }
}

// ── Phase 0e: Field-Based Step Builder ────────────────────────────────
//
// Uses ConfigurationField data to choose the optimal IR action per field:
//   counter → FILL (if target element known, fill the target value)
//   select  → CLICK on the option
//   toggle  → TOGGLE with boolean input
//   text    → FILL
//   date    → SELECT_DATE

interface ConfigFieldData {
  label: string;
  kind: string;
  finalValue: string;
  delta?: number;
  evidence?: Array<{ target?: ElementIdentity; action: string }>;
}

function buildFieldStep(
  field: ConfigFieldData,
  interaction: BridgeInteraction,
  event: SessionEvent | undefined,
  logicalAction: LogicalAction | undefined,
  stepCounter: number,
): IRStep | null {
  const fieldName = logicalAction?.businessField ?? getElementDisplayName(interaction, event);
  const assertions = deriveAssertions('', null);
  const stepId = `step-${String(stepCounter + 1).padStart(4, '0')}`;
  const sourceEventId = interaction.eventIds[0] ?? event?.actionId;

  // Try to get a target from the evidence chain (element identity)
  const evidenceTarget = field.evidence?.[0]?.target;
  const baseTarget = (evidenceTarget ?? interaction.target)!;

  // Each field step gets a unique elementId so readability rules
  // (OR-1 merge consecutive CLICK same elementId, OR-2 merge consecutive
  // FILL same elementId) don't collapse field steps together.
  // The field label distinguishes the targets semantically.
  const fieldElementId = `${baseTarget.elementId ?? 'elem'}::${field.label}`;

  function makeFieldTarget(displayName: string): ElementTarget {
    const identity: ElementIdentity = {
      ...baseTarget,
      elementId: fieldElementId,
      accessibleName: displayName,
      ariaLabel: displayName,
    };
    return resolveElementTarget(identity);
  }

  switch (field.kind) {
    case 'counter': {
      // Fill the final value (optimal strategy — idempotent)
      const displayValue = field.finalValue || (field.delta !== undefined ? String(field.delta) : '');
      return {
        id: stepId,
        order: stepCounter,
        action: IRAction.FILL,
        description: `Set ${field.label} to ${displayValue} in ${fieldName}`,
        target: makeFieldTarget(field.label),
        input: field.finalValue || null,
        assertions,
        executionParameters: DEFAULT_EXECUTION_PARAMETERS,
        aiEnrichment: null,
        sourceEventId,
        plainEnglish: `Set ${field.label} to ${displayValue}`,
      };
    }
    case 'select': {
      return {
        id: stepId,
        order: stepCounter,
        action: IRAction.CLICK,
        description: `Select "${field.finalValue}" in ${fieldName}`,
        target: makeFieldTarget(field.finalValue || field.label),
        input: field.finalValue,
        assertions,
        executionParameters: DEFAULT_EXECUTION_PARAMETERS,
        aiEnrichment: null,
        sourceEventId,
        plainEnglish: `Select ${field.finalValue}`,
      };
    }
    case 'toggle': {
      const checked = field.finalValue === 'true';
      return {
        id: stepId,
        order: stepCounter,
        action: IRAction.TOGGLE,
        description: `${checked ? 'Check' : 'Uncheck'} ${field.label} in ${fieldName}`,
        target: makeFieldTarget(field.label),
        input: checked,
        assertions,
        executionParameters: DEFAULT_EXECUTION_PARAMETERS,
        aiEnrichment: null,
        sourceEventId,
        plainEnglish: `${checked ? 'Check' : 'Uncheck'} ${field.label}`,
      };
    }
    case 'text': {
      return {
        id: stepId,
        order: stepCounter,
        action: IRAction.FILL,
        description: `Enter "${field.finalValue}" in ${field.label || fieldName}`,
        target: makeFieldTarget(field.label || fieldName),
        input: field.finalValue,
        assertions,
        executionParameters: DEFAULT_EXECUTION_PARAMETERS,
        aiEnrichment: null,
        sourceEventId,
        plainEnglish: `Enter ${field.finalValue} in ${field.label || fieldName}`,
      };
    }
    case 'date': {
      return {
        id: stepId,
        order: stepCounter,
        action: IRAction.SELECT_DATE,
        description: `Select date ${field.finalValue} in ${field.label || fieldName}`,
        target: makeFieldTarget(field.label || fieldName),
        input: field.finalValue,
        assertions,
        executionParameters: DEFAULT_EXECUTION_PARAMETERS,
        aiEnrichment: null,
        sourceEventId,
        plainEnglish: `Select date ${field.finalValue}`,
      };
    }
    default:
      return null;
  }
}
