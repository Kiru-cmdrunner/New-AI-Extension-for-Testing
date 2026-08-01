/**
 * UiElement Entity — the atom of the UI Knowledge Model.
 *
 * Every interactive element encountered during recording, with full mechanical
 * identity, DOM attributes, intrinsic capabilities, and optional component
 * membership. This is the structural foundation — everything traces back here.
 *
 * Design principle: application-centric. This models a UI element in the
 * application, not how AI interprets it.
 *
 * Reference: .drytis/specs/ui-knowledge-model-foundation.md (Phase 1)
 */

import { IntrinsicCapability, ComponentRole } from '../enums';
import { MissingFieldError, ValueObjectError } from '../errors/invariant-errors';
import type { ElementIdentity } from '../../shared/types';

// ── UiElement (entity) ───────────────────────────────────

/**
 * A UI element encountered during recording — the atomic unit of the
 * UI Knowledge Model.
 *
 * Carries:
 *   - Mechanical identity (existing 18-field ElementIdentity)
 *   - DOM attributes (required, min, max, step, pattern, type, etc.)
 *     → source of InteractionContract derivation
 *   - sourceUrl → which page this element was on
 *   - domTreePath → position in DOM tree for relationship derivation
 *   - intrinsicCapabilities → derived from tag + role + inputType
 *   - componentId / componentRole → null if standalone
 */
export interface UiElement {
  /** Stable session-scoped ID (e.g., "elem-0001"). */
  readonly elementId: string;
  /** The existing 18-field ElementIdentity from the recorder. */
  readonly identity: ElementIdentity;
  /**
   * All semantically relevant DOM attributes captured from the element.
   * Keys are attribute names, values are string representations.
   * Includes: required, min, max, step, pattern, type, minlength, maxlength,
   * multiple, accept, aria-required, aria-valuemin, aria-valuemax, placeholder,
   * autocomplete, etc.
   *
   * This is the source of InteractionContract derivation.
   */
  readonly domAttributes: Readonly<Record<string, string>>;
  /** The URL of the page where this element was encountered. */
  readonly sourceUrl: string;
  /** Position in the DOM tree (e.g., "html>body>div.form>input#email"). */
  readonly domTreePath: string;
  /** What this element can do as a DOM node — derived from tag + role + inputType. */
  readonly intrinsicCapabilities: readonly IntrinsicCapability[];
  /** Which component this element belongs to, or null if standalone. */
  readonly componentId: string | null;
  /** The role this element plays in its component, or null if standalone. */
  readonly componentRole: ComponentRole | null;
  /**
   * R4: Ancestor role chain from the first observed event's DomContext.
   * Up to 10 ancestors, format "tag[role=role]", index 0 = parent.
   * Undefined if DomContext.ancestorRoles was not available.
   */
  readonly ancestorRoles?: readonly string[];
}

/** Input for creating a UiElement. */
export interface CreateUiElementInput {
  elementId: string;
  identity: ElementIdentity;
  domAttributes?: Record<string, string>;
  sourceUrl: string;
  domTreePath: string;
  componentId?: string | null;
  componentRole?: ComponentRole | null;
  /** R4: Ancestor role chain from recording-time DomContext. */
  ancestorRoles?: readonly string[];
}

/**
 * Derive intrinsic capabilities from tag, role, and inputType.
 *
 * Pure function — deterministic mapping based on HTML semantics and ARIA roles.
 * Tag provides the base capability set; role and inputType can add or refine.
 *
 * @param tag - HTML tag name (lowercase).
 * @param role - ARIA role (optional, lowercase).
 * @param inputType - HTML input type attribute (optional, lowercase).
 * @returns array of intrinsic capabilities.
 */
export function deriveCapabilities(
  tag: string,
  role?: string | null,
  inputType?: string | null,
): IntrinsicCapability[] {
  const caps: IntrinsicCapability[] = [];
  const t = tag.toLowerCase();
  const r = role?.toLowerCase() ?? '';
  const it = inputType?.toLowerCase() ?? '';

  // Click capability: interactive elements that respond to clicks
  const clickableTags = ['button', 'a', 'select', 'summary', 'label'];
  const clickableRoles = ['button', 'link', 'menuitem', 'menuitemcheckbox', 'menuitemradio',
    'tab', 'option', 'treeitem', 'checkbox', 'radio', 'switch', 'combobox'];
  // Input types that are clickable (checkbox, radio, submit, button, image, etc.)
  const clickableInputTypes = ['checkbox', 'radio', 'submit', 'button', 'image', 'reset', 'file'];

  if (clickableTags.includes(t) || clickableRoles.includes(r) ||
      (t === 'input' && clickableInputTypes.includes(it))) {
    caps.push(IntrinsicCapability.CLICK);
  }

  // Accept text: elements that can receive text input
  const textInputTags = ['input', 'textarea'];
  const textInputRoles = ['textbox', 'searchbox', 'combobox', 'spinbutton'];
  const textInputTypes = ['text', 'email', 'password', 'search', 'tel', 'url',
    'number', 'textarea', ''];

  if (textInputTags.includes(t) || textInputRoles.includes(r)) {
    // For <input>, verify the input type is text-bearing
    if (t === 'input' && it && !textInputTypes.includes(it)) {
      // Non-text input types (checkbox, radio, date, etc.) — don't accept text
    } else {
      caps.push(IntrinsicCapability.ACCEPT_TEXT);
    }
  }

  // Focus capability: elements that can receive focus
  const focusableTags = ['button', 'a', 'input', 'textarea', 'select', 'summary'];
  const focusableRoles = ['button', 'link', 'checkbox', 'radio', 'switch', 'tab',
    'menuitem', 'menuitemcheckbox', 'menuitemradio', 'combobox', 'option',
    'textbox', 'searchbox', 'spinbutton', 'treeitem', 'slider'];

  if (focusableTags.includes(t) || focusableRoles.includes(r)) {
    caps.push(IntrinsicCapability.FOCUS);
  }

  // Hover capability: elements that can be hovered (essentially all interactive elements)
  if (caps.length > 0) {
    caps.push(IntrinsicCapability.HOVER);
  }

  // Select option: elements that represent selectable options within a container
  const optionRoles = ['option', 'treeitem'];
  if (optionRoles.includes(r) || t === 'option') {
    caps.push(IntrinsicCapability.SELECT_OPTION);
  }

  // Toggle: checkbox/switch elements
  const toggleRoles = ['checkbox', 'switch', 'menuitemcheckbox'];
  if (toggleRoles.includes(r) || (t === 'input' && it === 'checkbox')) {
    caps.push(IntrinsicCapability.TOGGLE);
  }

  // Deduplicate (an element may match multiple criteria)
  return [...new Set(caps)];
}

/**
 * Create a UiElement entity with invariant validation.
 *
 * Invariants:
 *   - elementId is required and non-empty
 *   - identity is required
 *   - sourceUrl is required and non-empty
 *   - componentId and componentRole must both be set or both be null
 *
 * @throws MissingFieldError if required fields are empty
 * @throws ValueObjectError if component fields are inconsistent
 */
export function createUiElement(input: CreateUiElementInput): UiElement {
  if (!input.elementId?.trim()) {
    throw new MissingFieldError('UiElement', 'elementId');
  }
  if (!input.identity) {
    throw new MissingFieldError('UiElement', 'identity');
  }
  if (!input.sourceUrl?.trim()) {
    throw new MissingFieldError('UiElement', 'sourceUrl');
  }

  // Validate component membership consistency
  const hasComponentId = input.componentId?.trim();
  const hasComponentRole = input.componentRole != null;

  if (hasComponentId && !hasComponentRole) {
    throw new ValueObjectError(
      'UiElement',
      `componentId is set but componentRole is null for element ${input.elementId}`,
    );
  }
  if (!hasComponentId && hasComponentRole) {
    throw new ValueObjectError(
      'UiElement',
      `componentRole is set but componentId is null for element ${input.elementId}`,
    );
  }

  return {
    elementId: input.elementId.trim(),
    identity: input.identity,
    domAttributes: input.domAttributes ?? {},
    sourceUrl: input.sourceUrl.trim(),
    domTreePath: input.domTreePath,
    intrinsicCapabilities: deriveCapabilities(
      input.identity.tag ?? '',
      input.identity.ariaRole,
      input.domAttributes?.['type'] ?? null,
    ),
    componentId: input.componentId?.trim() || null,
    componentRole: input.componentRole ?? null,
    ancestorRoles: input.ancestorRoles,
  };
}

/**
 * Create an updated UiElement with component membership assigned.
 *
 * Used when the Component Recognizer associates an element with a component.
 */
export function assignToComponent(
  element: UiElement,
  componentId: string,
  role: ComponentRole,
): UiElement {
  if (!componentId?.trim()) {
    throw new ValueObjectError('UiElement', 'componentId is required');
  }
  return {
    ...element,
    componentId: componentId.trim(),
    componentRole: role,
  };
}

/**
 * Create an updated UiElement with component membership removed.
 *
 * Used when a tentative component is rejected and its constituents revert to standalone.
 */
export function removeFromComponent(element: UiElement): UiElement {
  return {
    ...element,
    componentId: null,
    componentRole: null,
  };
}
