/**
 * Option Set Extractor — discovers all options for selectable components
 * via read-only DOM inspection.
 *
 * This is the enrichment pass that discovers options the user never interacted
 * with. It reads the physical DOM elements within a component's container to
 * extract the complete option set, then derives the component's business field
 * from its accessible name or label.
 *
 * Design principle: deterministic observation-derived knowledge only.
 * - optionSet comes from physical DOM elements (what exists in the page)
 * - businessField comes from accessibleName/label (a DOM attribute)
 * No AI opinions or semantic interpretations.
 *
 * Reference: .drytis/specs/ui-knowledge-model-phase5.md §3
 */

import type { ComponentGrouping, OptionEntry } from '../../domain/entities/component-grouping';
import type { UiElement } from '../../domain/entities/ui-element';
import type { DomInspector } from './dom-inspector';
import { ComponentRole } from '../../domain/enums';

/**
 * Result of option set extraction for a component.
 */
export interface ExtractionResult {
  /** The extracted option set, or null if component has no options. */
  readonly optionSet: OptionEntry[] | null;
  /** The business field label derived from the component root. */
  readonly businessField: string | null;
}

/**
 * Extract the complete option set and business field for a confirmed component.
 *
 * This function uses DomInspector to read the DOM of the component's container,
 * discovering all options present in the UI — not just the ones the user clicked.
 *
 * @param component The confirmed component to enrich.
 * @param elements  Map of elementId → UiElement for the component's constituents.
 * @param inspector DOM inspector for read-only DOM access.
 * @returns Extracted optionSet and businessField.
 */
export function extractOptionSet(
  component: ComponentGrouping,
  elements: ReadonlyMap<string, UiElement>,
  inspector: DomInspector,
): ExtractionResult {
  // Find the container element to query for options
  const container = findContainer(component, elements);

  // Extract business field from the root/container element's accessible name
  const businessField = deriveBusinessField(component, elements, inspector);

  // Only extract options for components that have option-bearing constituents
  if (!hasOptionConstituents(component)) {
    return { optionSet: null, businessField };
  }

  if (!container) {
    return { optionSet: null, businessField };
  }

  // Query the DOM for all option-like elements within the container
  const domContainer = inspector.querySelector(container.elementId);
  if (!domContainer) {
    return { optionSet: null, businessField };
  }

  // Selected state comes purely from DOM attributes (aria-selected, aria-checked),
  // NOT from constituent membership. The constituent list tells us which elements
  // the recognizer found — it does not indicate which were selected.
  const options = extractOptionsFromDom(domContainer);
  return { optionSet: options.length > 0 ? options : null, businessField };
}

// ── Private helpers ──────────────────────────────────────

/**
 * Find the container element of a component — the element whose role is CONTAINER.
 * Falls back to the root element if no container constituent exists.
 */
function findContainer(
  component: ComponentGrouping,
  elements: ReadonlyMap<string, UiElement>,
): UiElement | null {
  const containerConstituent = component.constituents.find(
    (c) => c.role === ComponentRole.CONTAINER,
  );

  if (containerConstituent) {
    return elements.get(containerConstituent.elementId) ?? null;
  }

  // Fallback: use root element
  return elements.get(component.rootElementId) ?? null;
}

/**
 * Check if this component has option-bearing constituents.
 * Components with OPTION roles are selectable and should have option sets.
 */
function hasOptionConstituents(component: ComponentGrouping): boolean {
  return component.constituents.some((c) => c.role === ComponentRole.OPTION);
}

/**
 * Derive the business field label for a component.
 *
 * Strategy (deterministic, DOM-attribute-based):
 * 1. Check the root element's accessible name (from DomInspector)
 * 2. Check the root element's aria-label or label attribute in domAttributes
 * 3. Check for an associated <label> element via the container
 * 4. Fall back to null if no label is found
 */
function deriveBusinessField(
  component: ComponentGrouping,
  elements: ReadonlyMap<string, UiElement>,
  inspector: DomInspector,
): string | null {
  const rootElement = elements.get(component.rootElementId);
  if (!rootElement) return null;

  // 1. Check DomInspector for accessible name
  const domRoot = inspector.querySelector(rootElement.elementId);
  if (domRoot?.accessibleName?.trim()) {
    return domRoot.accessibleName.trim();
  }

  // 2. Check aria-label in captured attributes
  const attrs = rootElement.domAttributes;
  if (attrs['aria-label']?.trim()) {
    return attrs['aria-label'].trim();
  }

  // 3. Check for a <label> element nearby (via aria-labelledby)
  const labelledBy = attrs['aria-labelledby'];
  if (labelledBy) {
    const labelEl = inspector.querySelector(labelledBy);
    if (labelEl?.textContent?.trim()) {
      return labelEl.textContent.trim();
    }
  }

  // 4. Check for a <label for="..."> — but we'd need to look outside the element.
  //    For now, check the textContent of the container element.
  const containerConstituent = component.constituents.find(
    (c) => c.role === ComponentRole.CONTAINER,
  );
  if (containerConstituent) {
    const containerEl = elements.get(containerConstituent.elementId);
    if (containerEl) {
      const domContainer = inspector.querySelector(containerEl.elementId);
      if (domContainer?.accessibleName?.trim()) {
        return domContainer.accessibleName.trim();
      }
    }
  }

  return null;
}

/**
 * Extract options from the DOM container's children.
 *
 * Looks for elements that are options (role=option, role=menuitem, role=radio,
 * or <option> tags) within the container. For each, derives value, label,
 * selected state, and disabled state from DOM attributes.
 *
 * Selected state comes purely from DOM attributes (aria-selected, aria-checked).
 * This is a deterministic observation — the DOM reflects the current state.
 */
function extractOptionsFromDom(
  domContainer: { children: readonly DomInspectorChild[] },
): OptionEntry[] {
  const options: OptionEntry[] = [];
  walkForOptions(domContainer.children, options);
  return options;
}

/** Internal type for walking DOM children. */
type DomInspectorChild = {
  readonly elementId: string;
  readonly attributes: Readonly<Record<string, string>>;
  readonly textContent: string | null;
  readonly children: readonly DomInspectorChild[];
};

/** Recursively walk DOM children to find option-like elements. */
function walkForOptions(
  children: readonly DomInspectorChild[],
  out: OptionEntry[],
): void {
  for (const child of children) {
    if (isOptionLike(child)) {
      const option = buildOptionEntry(child);
      if (option) out.push(option);
    }
    // Recurse into children regardless
    if (child.children && child.children.length > 0) {
      walkForOptions(child.children, out);
    }
  }
}

/** Check if a DOM element looks like an option. */
function isOptionLike(el: DomInspectorChild): boolean {
  const role = el.attributes['role'] ?? '';
  return (
    role === 'option' ||
    role === 'menuitem' ||
    role === 'menuitemradio' ||
    role === 'radio' ||
    role === 'treeitem'
  );
}

/** Build an OptionEntry from a DOM element and known interaction state. */
function buildOptionEntry(
  el: DomInspectorChild,
): OptionEntry | null {
  const value =
    el.attributes['data-value'] ??
    el.attributes['value'] ??
    el.textContent?.trim() ??
    el.elementId;

  const label = el.textContent?.trim() || el.attributes['aria-label']?.trim() || value;

  // Selected state: purely from DOM attributes (deterministic observation)
  const isSelected =
    el.attributes['aria-selected'] === 'true' ||
    el.attributes['aria-checked'] === 'true';

  const isDisabled =
    el.attributes['disabled'] !== undefined ||
    el.attributes['aria-disabled'] === 'true';

  return {
    value,
    label,
    selected: isSelected,
    disabled: isDisabled,
  };
}
