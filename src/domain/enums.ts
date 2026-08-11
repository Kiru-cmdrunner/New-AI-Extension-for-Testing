/**
 * Domain Enums — canonical enum definitions for all domain entities.
 *
 * Reference: domain-schema.md
 * These are the ONLY enum definitions for the domain model. All other
 * modules must import from here, never re-declare.
 */

// ── 3.1 Project ──────────────────────────────────────────

/** Project lifecycle state. V1: Active is the default; Archived is deferred. */
export enum ProjectStatus {
  ACTIVE = 'active',
  ARCHIVED = 'archived',
}

// ── 3.2 Approved Test Case ────────────────────────────────

/** ATC priority level. */
export enum TestCasePriority {
  CRITICAL = 'critical',
  HIGH = 'high',
  MEDIUM = 'medium',
  LOW = 'low',
}

/** ATC lifecycle status. INV-ATC2 governs transitions. */
export enum TestCaseStatus {
  DRAFT = 'draft',
  IN_REVIEW = 'in_review',
  APPROVED = 'approved',
  DEPRECATED = 'deprecated',
}

// ── 3.2b Step ─────────────────────────────────────────────

/** Actions a step can perform. Steps with `navigate` and `wait` don't require elementId. */
export enum StepAction {
  CLICK = 'click',
  FILL = 'fill',
  SELECT = 'select',
  SELECT_DATE = 'selectDate',
  TOGGLE = 'toggle',
  HOVER = 'hover',
  NAVIGATE = 'navigate',
  VERIFY = 'verify',
  WAIT = 'wait',
}

/** Validation assertion types. */
export enum ValidationType {
  PRESENCE = 'presence',
  VISIBILITY = 'visibility',
  TEXT_MATCH = 'textMatch',
  ATTRIBUTE_MATCH = 'attributeMatch',
  COUNT = 'count',
  EQUALITY = 'equality',
  URL_MATCH = 'urlMatch',
  CUSTOM = 'custom',
}

/** Validation comparison operators. */
export enum ValidationComparison {
  EQUALS = 'equals',
  CONTAINS = 'contains',
  MATCHES = 'matches',
  STARTS_WITH = 'startsWith',
  GREATER_THAN = 'greaterThan',
  LESS_THAN = 'lessThan',
  IS_TRUE = 'isTrue',
  IS_FALSE = 'isFalse',
}

/** Validation severity — hard stops the test; soft records but continues. */
export enum ValidationSeverity {
  HARD = 'hard',
  SOFT = 'soft',
}

// ── 3.4 Element Repository ────────────────────────────────

/** Element lifecycle state. ACTIVE = locators valid, STALE = may need healing, BROKEN = locators failed. */
export enum ElementStatus {
  ACTIVE = 'active',
  STALE = 'stale',
  BROKEN = 'broken',
}

/** Locator strategy types. Semantic first (role, accessibleName), fragile last (css, xpath). */
export enum LocatorStrategyType {
  ROLE = 'role',
  ACCESSIBLE_NAME = 'accessibleName',
  TEST_ID = 'testId',
  TEXT = 'text',
  LABEL = 'label',
  CSS = 'css',
  XPATH = 'xpath',
}

// ── 3.3 Source Artifact ───────────────────────────────────

/** Source Artifact type discriminator (polymorphic entity). */
export enum SourceArtifactType {
  INTERACTION_TIMELINE = 'interaction_timeline',
  NATURAL_LANGUAGE = 'natural_language',
  IMAGE = 'image',
  IMPORTED_DOCUMENT = 'imported_document',
  MANUAL = 'manual',
}

// ── 3.5 UI Knowledge Model ───────────────────────────────
//
// Application-centric knowledge model entities.
// Reference: .drytis/specs/ui-knowledge-model-foundation.md
//            .drytis/notes/ui-knowledge-model-architecture.md

/** What an element can intrinsically do as a DOM node, derived from tag + role + inputType. */
export enum IntrinsicCapability {
  CLICK = 'click',
  ACCEPT_TEXT = 'acceptText',
  FOCUS = 'focus',
  HOVER = 'hover',
  SELECT_OPTION = 'selectOption',
  TOGGLE = 'toggle',
  SCROLL = 'scroll',
}

/** The role an element plays within a recognized component (semantic, assigned by the component). */
export enum ComponentRole {
  TRIGGER = 'trigger',
  CONTAINER = 'container',
  OPTION = 'option',
  COMMIT = 'commit',
  CANCEL = 'cancel',
  LABEL = 'label',
  DEPENDENT = 'dependent',
  TAB = 'tab',
  PANEL = 'panel',
  /**
   * Role not yet determined. Used for constituents discovered through
   * behavioral enrichment where the specific role isn't known at discovery
   * time. May be refined by later structural recognition.
   */
  UNKNOWN = 'unknown',
}

/** Recognized UI pattern types for the component recognition engine. */
export enum PatternType {
  DROPDOWN = 'dropdown',
  CHECKBOX = 'checkbox',
  RADIO_GROUP = 'radioGroup',
  DATE_PICKER = 'datePicker',
  MODAL = 'modal',
  TABS = 'tabs',
  ACCORDION = 'accordion',
  TABLE = 'table',
  SLIDER = 'slider',
  COMBOBOX = 'combobox',
  CUSTOM = 'custom',
}

/** How a component was recognized — drives the evidence sovereignty hierarchy. */
export enum RecognitionSource {
  STRUCTURAL = 'structural',
  BEHAVIORAL = 'behavioral',
  AI_ASSISTED = 'ai-assisted',
}

/** Progressive component lifecycle — hypothesis matures across interactions. */
export enum ComponentLifecycleState {
  TENTATIVE = 'tentative',
  DEVELOPING = 'developing',
  CONFIRMED = 'confirmed',
  REJECTED = 'rejected',
}
