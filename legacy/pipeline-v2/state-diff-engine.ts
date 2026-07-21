/**
 * State Diff Engine — Pipeline V2 Layer 3
 *
 * Snapshots observable DOM state before and after each interaction unit,
 * then computes a structured StateDiff showing what changed.
 *
 * DESIGN PRINCIPLE: The state diff is the PRIMARY SIGNAL for intent resolution.
 * Unlike Architecture C where classifier rules are primary and state is
 * supplementary, here state diff leads and patterns confirm.
 *
 * FRAMEWORK AGNOSTICISM: The snapshot captures observable DOM state —
 * element values, checked states, selected options, ARIA attributes, open
 * surfaces. This works across React, Angular, Vue, Material UI, Ant Design,
 * and custom components because it observes the DOM effect, not the
 * framework cause. A native <select> and a div-based custom dropdown both
 * produce the same ValueChange in the diff.
 *
 * TWO MODES:
 *   1. snapshotState() — called to capture the current DOM state as a
 *      StateSnapshot. Used by the pipeline orchestrator to take a "before"
 *      snapshot before processing an interaction unit.
 *   2. computeDiff() — a pure function that compares two snapshots.
 *      Used after the interaction unit is closed.
 */

import type {
  StateSnapshot,
  StateDiff,
  ValueChange,
  ToggleChange,
  RadioChange,
  RangeChange,
  FocusChange,
  SurfaceChange,
  TabChange,
  UrlChange,
  InputFieldState,
  ToggleState,
  RadioGroupState,
  RangeState,
  OpenSurfaceState,
  TabState,
  ElementDescriptor,
  SurfaceType,
} from './canonical-event-schema';

// ── DOM State Capture (needs document access) ───────────────────────────

/**
 * Capture a complete snapshot of the current page's observable DOM state.
 *
 * This function accesses the live DOM (document, document.activeElement,
 * etc.). In tests, it runs against jsdom.
 *
 * PERFORMANCE: Queries visible interactive elements only. For large pages,
 * this is O(n) where n is the number of visible form controls.
 */
export function snapshotState(): StateSnapshot {
  const timestamp = new Date().toISOString();
  const url = typeof location !== 'undefined' ? location.href : '';
  const pageTitle = typeof document !== 'undefined' ? document.title : '';

  return {
    timestamp,
    url,
    pageTitle,
    inputs: captureInputs(),
    checkboxes: captureCheckboxes(),
    radios: captureRadios(),
    toggles: captureToggles(),
    ranges: captureRanges(),
    focusedElement: captureFocusedElement(),
    openSurfaces: captureOpenSurfaces(),
    activeTab: captureActiveTab(),
    expandedAccordions: captureExpandedAccordions(),
    interactiveElementCount: countInteractiveElements(),
  };
}

/**
 * Capture all visible input/textarea elements.
 * Also captures non-form elements that act as display fields (common in
 * custom date pickers, comboboxes, and SPA frameworks where the selected
 * value is shown in a div/span rather than a form input).
 */
function captureInputs(): InputFieldState[] {
  const inputs: InputFieldState[] = [];
  const seen = new Set<Element>();

  // Standard form elements
  const els = document.querySelectorAll('input, textarea, select');
  for (const el of els) {
    if (!isVisible(el)) continue;
    seen.add(el);
    const descriptor = toDescriptor(el);
    const value = captureValue(el);
    const inputType = getInputType(el);
    inputs.push({ descriptor, value, inputType });
  }

  // Non-form elements that display a selected value (custom widgets).
  // Many custom date pickers, comboboxes, and SPA dropdowns store the
  // selected value in a <div> or <span> with an aria-label or role.
  // We capture these so the state diff can detect when the value changes.
  const displaySelectors = [
    '[role="combobox"]',
    '[data-value]',
    '[aria-valuenow]',
  ];
  for (const selector of displaySelectors) {
    for (const el of document.querySelectorAll(selector)) {
      if (seen.has(el) || !isVisible(el)) continue;
      seen.add(el);
      const descriptor = toDescriptor(el);
      // For [data-value] and [aria-valuenow], use the attribute as the value.
      // For [role="combobox"], also try textContent (the display text).
      const value =
        el.getAttribute('data-value') ||
        el.getAttribute('aria-valuenow') ||
        (el.textContent?.trim() ?? '');
      const inputType = el.getAttribute('role') || el.tagName.toLowerCase();
      inputs.push({ descriptor, value, inputType });
    }
  }

  return inputs;
}

/**
 * Capture all checkboxes (native + ARIA).
 */
function captureCheckboxes(): ToggleState[] {
  const checkboxes: ToggleState[] = [];
  const selectors = [
    'input[type="checkbox"]',
    '[role="checkbox"]',
    '[role="switch"]',
  ];

  for (const selector of selectors) {
    for (const el of document.querySelectorAll(selector)) {
      if (!isVisible(el)) continue;
      // Skip radio — handled separately
      if (el.getAttribute('role') === 'radio') continue;
      const descriptor = toDescriptor(el);
      const checked = getCheckedState(el);
      checkboxes.push({ descriptor, checked });
    }
  }
  return checkboxes;
}

/**
 * Capture radio button groups.
 */
function captureRadios(): RadioGroupState[] {
  const groups = new Map<string, RadioGroupState>();

  // Native radio inputs grouped by name
  const nativeRadios = document.querySelectorAll('input[type="radio"]');
  for (const radio of nativeRadios) {
    if (!isVisible(radio)) continue;
    const name = radio.getAttribute('name') || '';
    if (!groups.has(name)) {
      const groupDescriptor = toDescriptor(radio.closest('[role="radiogroup"]') || radio);
      const options: ElementDescriptor[] = [];
      let selectedOption: ElementDescriptor | null = null;

      const siblings = document.querySelectorAll(`input[type="radio"][name="${cssEscape(name)}"]`);
      for (const sibling of siblings) {
        if (!isVisible(sibling)) continue;
        options.push(toDescriptor(sibling));
        if ((sibling as HTMLInputElement).checked) {
          selectedOption = toDescriptor(sibling);
        }
      }

      groups.set(name, {
        name,
        descriptor: groupDescriptor,
        selectedOption,
        options,
      });
    }
  }

  // ARIA radiogroup elements
  for (const group of document.querySelectorAll('[role="radiogroup"]')) {
    const name = group.getAttribute('aria-label') || group.id || '';
    if (groups.has(name)) continue;
    const options: ElementDescriptor[] = [];
    let selectedOption: ElementDescriptor | null = null;
    for (const radio of group.querySelectorAll('[role="radio"]')) {
      if (!isVisible(radio)) continue;
      options.push(toDescriptor(radio));
      if (radio.getAttribute('aria-checked') === 'true') {
        selectedOption = toDescriptor(radio);
      }
    }
    groups.set(`aria:${name}`, {
      name: name || group.id || 'unnamed',
      descriptor: toDescriptor(group),
      selectedOption,
      options,
    });
  }

  return Array.from(groups.values());
}

/**
 * Capture ARIA toggle buttons (aria-pressed).
 */
function captureToggles(): ToggleState[] {
  const toggles: ToggleState[] = [];
  for (const el of document.querySelectorAll('[aria-pressed]')) {
    if (!isVisible(el)) continue;
    // Skip if already captured as checkbox
    if (el.getAttribute('role') === 'checkbox' || el.getAttribute('role') === 'switch') continue;
    const descriptor = toDescriptor(el);
    const checked = el.getAttribute('aria-pressed') === 'true';
    toggles.push({ descriptor, checked });
  }
  return toggles;
}

/**
 * Capture range/slider elements.
 */
function captureRanges(): RangeState[] {
  const ranges: RangeState[] = [];
  const selectors = ['input[type="range"]', '[role="slider"]'];
  for (const selector of selectors) {
    for (const el of document.querySelectorAll(selector)) {
      if (!isVisible(el)) continue;
      const descriptor = toDescriptor(el);
      const value = (el as HTMLInputElement).value ||
        el.getAttribute('aria-valuenow') || '';
      const min = (el as HTMLInputElement).min ||
        el.getAttribute('aria-valuemin') || '0';
      const max = (el as HTMLInputElement).max ||
        el.getAttribute('aria-valuemax') || '100';
      ranges.push({ descriptor, value, min, max });
    }
  }
  return ranges;
}

/**
 * Capture the currently focused element.
 */
function captureFocusedElement(): ElementDescriptor | null {
  if (typeof document === 'undefined') return null;
  const active = document.activeElement;
  if (!active || active === document.body) return null;
  if (active instanceof Element) {
    return toDescriptor(active);
  }
  return null;
}

/**
 * Capture open overlay surfaces (modals, dropdowns, menus, popovers).
 */
function captureOpenSurfaces(): OpenSurfaceState[] {
  const surfaces: OpenSurfaceState[] = [];

  // Dialogs (native + ARIA)
  for (const el of document.querySelectorAll('dialog, [role="dialog"], [aria-modal="true"]')) {
    if (!isVisible(el)) continue;
    if (el instanceof HTMLDialogElement && !el.open) continue;
    surfaces.push({
      type: el.getAttribute('role') === 'dialog' || el.tagName === 'DIALOG' ? 'dialog' : 'modal',
      descriptor: toDescriptor(el),
    });
  }

  // Expanded dropdowns/menus/menubars with visible content
  for (const el of document.querySelectorAll('[aria-expanded="true"]')) {
    if (!isVisible(el)) continue;
    const hasPopup = el.getAttribute('aria-haspopup');
    if (hasPopup) {
      const surfaceType = mapHasPopupToSurface(hasPopup);
      surfaces.push({
        type: surfaceType,
        descriptor: toDescriptor(el),
      });
    }
  }

  // Listboxes / menus that are visible and not [aria-hidden]
  for (const el of document.querySelectorAll('[role="listbox"], [role="menu"], [role="tooltip"], .dropdown-menu, .popover')) {
    if (!isVisible(el)) continue;
    if (el.getAttribute('aria-hidden') === 'true') continue;
    const role = el.getAttribute('role');
    let type: SurfaceType = 'popover';
    if (role === 'listbox') type = 'dropdown';
    else if (role === 'menu') type = 'menu';
    else if (role === 'tooltip') type = 'popover';
    surfaces.push({ type, descriptor: toDescriptor(el) });
  }

  return surfaces;
}

/**
 * Capture the active tab in a tablist.
 */
function captureActiveTab(): TabState | null {
  for (const tablist of document.querySelectorAll('[role="tablist"]')) {
    const selectedTab = tablist.querySelector('[role="tab"][aria-selected="true"]');
    if (!selectedTab) continue;

    // Find the associated tab panel
    const controls = selectedTab.getAttribute('aria-controls');
    let activePanel: Element | null = null;
    if (controls) {
      activePanel = document.getElementById(controls);
    } else {
      activePanel = tablist.parentElement?.querySelector('[role="tabpanel"]') || null;
    }

    return {
      selectedTab: toDescriptor(selectedTab),
      activePanel: activePanel ? toDescriptor(activePanel) : toDescriptor(selectedTab),
    };
  }
  return null;
}

/**
 * Capture expanded accordion sections.
 */
function captureExpandedAccordions(): ElementDescriptor[] {
  const accordions: ElementDescriptor[] = [];
  for (const el of document.querySelectorAll('[aria-expanded="true"]')) {
    if (!isVisible(el)) continue;
    // Check if it's inside an accordion-like structure
    const parent = el.closest('[role="region"], details, .accordion, [data-accordion]');
    if (parent || el.tagName === 'SUMMARY') {
      accordions.push(toDescriptor(el));
    }
  }
  return accordions;
}

/**
 * Count visible interactive elements (for structural change detection).
 */
function countInteractiveElements(): number {
  if (typeof document === 'undefined') return 0;
  return document.querySelectorAll(
    'button, a, input, select, textarea, [role="button"], [role="link"], [role="checkbox"], [role="radio"], [role="tab"], [tabindex]'
  ).length;
}

// ── Diff Computation (pure function) ────────────────────────────────────

/**
 * Compute the structured difference between two state snapshots.
 *
 * This is a PURE FUNCTION — no DOM access. It compares two StateSnapshot
 * objects and produces a StateDiff showing exactly what changed.
 *
 * DESIGN: The diff is comprehensive — it checks every field type.
 * The Intent Resolver uses the diff as the primary signal.
 */
export function computeDiff(before: StateSnapshot, after: StateSnapshot): StateDiff {
  return {
    valueChanges: diffValueChanges(before.inputs, after.inputs),
    toggleChanges: diffToggleChanges(
      [...before.checkboxes, ...before.toggles],
      [...after.checkboxes, ...after.toggles],
    ),
    radioChanges: diffRadioChanges(before.radios, after.radios),
    rangeChanges: diffRangeChanges(before.ranges, after.ranges),
    focusChange: diffFocusChange(before.focusedElement, after.focusedElement),
    surfaceChanges: diffSurfaceChanges(before.openSurfaces, after.openSurfaces),
    tabChange: diffTabChange(before.activeTab, after.activeTab),
    urlChange: diffUrlChange(before.url, after.url),
    structuralChangeDetected:
      before.interactiveElementCount !== after.interactiveElementCount,
  };
}

/**
 * Diff input field values.
 */
function diffValueChanges(
  before: InputFieldState[],
  after: InputFieldState[],
): ValueChange[] {
  const changes: ValueChange[] = [];
  const afterMap = new Map(after.map((f) => [f.descriptor.id || f.descriptor.cssSelector, f]));

  for (const beforeField of before) {
    const key = beforeField.descriptor.id || beforeField.descriptor.cssSelector;
    const afterField = afterMap.get(key);
    if (afterField && beforeField.value !== afterField.value) {
      changes.push({
        descriptor: afterField.descriptor,
        field: afterField.descriptor.accessibleName || afterField.descriptor.tag,
        before: beforeField.value,
        after: afterField.value,
        inputType: afterField.inputType,
      });
    }
  }

  // Check for new fields that appeared (value went from nothing to something)
  const beforeKeys = new Set(before.map((f) => f.descriptor.id || f.descriptor.cssSelector));
  for (const afterField of after) {
    const key = afterField.descriptor.id || afterField.descriptor.cssSelector;
    if (!beforeKeys.has(key) && afterField.value) {
      changes.push({
        descriptor: afterField.descriptor,
        field: afterField.descriptor.accessibleName || afterField.descriptor.tag,
        before: '',
        after: afterField.value,
        inputType: afterField.inputType,
      });
    }
  }

  return changes;
}

/**
 * Diff toggle (checkbox/switch/aria-pressed) states.
 */
function diffToggleChanges(before: ToggleState[], after: ToggleState[]): ToggleChange[] {
  const changes: ToggleChange[] = [];
  const afterMap = new Map(after.map((t) => [t.descriptor.id || t.descriptor.cssSelector, t]));

  for (const beforeToggle of before) {
    const key = beforeToggle.descriptor.id || beforeToggle.descriptor.cssSelector;
    const afterToggle = afterMap.get(key);
    if (afterToggle && beforeToggle.checked !== afterToggle.checked) {
      changes.push({
        descriptor: afterToggle.descriptor,
        field: afterToggle.descriptor.accessibleName || afterToggle.descriptor.tag,
        before: beforeToggle.checked,
        after: afterToggle.checked,
      });
    }
  }

  return changes;
}

/**
 * Diff radio group selections.
 */
function diffRadioChanges(before: RadioGroupState[], after: RadioGroupState[]): RadioChange[] {
  const changes: RadioChange[] = [];
  const afterMap = new Map(after.map((r) => [r.name, r]));

  for (const beforeGroup of before) {
    const afterGroup = afterMap.get(beforeGroup.name);
    if (!afterGroup) continue;

    const beforeSel = beforeGroup.selectedOption?.accessibleName || null;
    const afterSel = afterGroup.selectedOption?.accessibleName || null;

    if (beforeSel !== afterSel) {
      changes.push({
        groupName: beforeGroup.name,
        groupDescriptor: afterGroup.descriptor,
        before: beforeGroup.selectedOption,
        after: afterGroup.selectedOption,
      });
    }
  }

  return changes;
}

/**
 * Diff range/slider values.
 */
function diffRangeChanges(before: RangeState[], after: RangeState[]): RangeChange[] {
  const changes: RangeChange[] = [];
  const afterMap = new Map(after.map((r) => [r.descriptor.id || r.descriptor.cssSelector, r]));

  for (const beforeRange of before) {
    const key = beforeRange.descriptor.id || beforeRange.descriptor.cssSelector;
    const afterRange = afterMap.get(key);
    if (afterRange && beforeRange.value !== afterRange.value) {
      changes.push({
        descriptor: afterRange.descriptor,
        field: afterRange.descriptor.accessibleName || afterRange.descriptor.tag,
        before: beforeRange.value,
        after: afterRange.value,
      });
    }
  }

  return changes;
}

/**
 * Diff focus state.
 */
function diffFocusChange(
  before: ElementDescriptor | null,
  after: ElementDescriptor | null,
): FocusChange | null {
  if (!before && !after) return null;
  const beforeKey = before?.cssSelector || null;
  const afterKey = after?.cssSelector || null;
  if (beforeKey === afterKey) return null;
  return { from: before, to: after };
}

/**
 * Diff open surfaces (what opened or closed).
 */
function diffSurfaceChanges(
  before: OpenSurfaceState[],
  after: OpenSurfaceState[],
): SurfaceChange[] {
  const changes: SurfaceChange[] = [];
  const beforeSet = new Set(before.map((s) => s.descriptor.cssSelector));
  const afterSet = new Set(after.map((s) => s.descriptor.cssSelector));

  // Closed surfaces
  for (const surface of before) {
    if (!afterSet.has(surface.descriptor.cssSelector)) {
      changes.push({
        type: surface.type,
        action: 'closed',
        descriptor: surface.descriptor,
      });
    }
  }

  // Opened surfaces
  for (const surface of after) {
    if (!beforeSet.has(surface.descriptor.cssSelector)) {
      changes.push({
        type: surface.type,
        action: 'opened',
        descriptor: surface.descriptor,
      });
    }
  }

  return changes;
}

/**
 * Diff active tab.
 */
function diffTabChange(
  before: TabState | null,
  after: TabState | null,
): TabChange | null {
  if (!before || !after) return null;
  if (before.selectedTab.cssSelector === after.selectedTab.cssSelector) return null;
  return {
    from: before.selectedTab,
    to: after.selectedTab,
  };
}

/**
 * Diff URL.
 */
function diffUrlChange(before: string, after: string): UrlChange | null {
  if (before === after) return null;
  return { from: before, to: after };
}

// ── Helpers ─────────────────────────────────────────────────────────────

/**
 * Check if an element is visible on the page.
 */
function isVisible(el: Element): boolean {
  if (!el.isConnected) return false;
  const htmlEl = el as HTMLElement;
  if (htmlEl.hidden) return false;
  if (el.getAttribute('aria-hidden') === 'true') return false;
  const style = htmlEl.style;
  if (style.display === 'none') return false;
  if (style.visibility === 'hidden') return false;
  return true;
}

/**
 * Create an ElementDescriptor from a DOM element.
 */
function toDescriptor(el: Element): ElementDescriptor {
  return {
    accessibleName: computeAccessibleName(el),
    ariaRole: el.getAttribute('role'),
    tag: el.tagName,
    id: el.id || null,
    cssSelector: generateCssSelector(el),
  };
}

/**
 * Compute accessible name (simplified cascade).
 */
function computeAccessibleName(el: Element): string {
  const ariaLabel = el.getAttribute('aria-label');
  if (ariaLabel && ariaLabel.trim()) return ariaLabel.trim().slice(0, 200);

  const labelledBy = el.getAttribute('aria-labelledby');
  if (labelledBy) {
    const ref = document.getElementById(labelledBy);
    if (ref?.textContent) return ref.textContent.trim().slice(0, 200);
  }

  // label[for] association
  if (el.id) {
    const label = document.querySelector(`label[for="${cssEscape(el.id)}"]`);
    if (label?.textContent) return label.textContent.trim().slice(0, 200);
  }

  if (el instanceof HTMLElement) {
    const inner = el.innerText?.trim();
    if (inner) return inner.slice(0, 200);
  }

  const textContent = el.textContent?.trim();
  if (textContent) return textContent.slice(0, 200);

  const placeholder = el.getAttribute('placeholder');
  if (placeholder?.trim()) return placeholder.trim().slice(0, 200);

  const title = el.getAttribute('title');
  if (title?.trim()) return title.trim().slice(0, 200);

  return '';
}

/**
 * Capture the value of a form control.
 */
function captureValue(el: Element): string {
  if (el instanceof HTMLSelectElement) {
    const option = el.options[el.selectedIndex];
    if (option) {
      return option.text?.trim() || option.textContent?.trim() || option.value || '';
    }
    return '';
  }
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
    return el.value ?? '';
  }
  // ARIA combobox: aria-activedescendant
  const descendantId = el.getAttribute('aria-activedescendant');
  if (descendantId) {
    const option = document.getElementById(descendantId);
    if (option) return option.textContent?.trim() || '';
  }
  return '';
}

/**
 * Get the checked state of a checkbox/toggle.
 */
function getCheckedState(el: Element): boolean {
  if (el instanceof HTMLInputElement) return el.checked;
  const ariaChecked = el.getAttribute('aria-checked');
  if (ariaChecked !== null) return ariaChecked === 'true';
  const ariaPressed = el.getAttribute('aria-pressed');
  if (ariaPressed !== null) return ariaPressed === 'true';
  return false;
}

/**
 * Get the input type for classification.
 */
function getInputType(el: Element): string {
  if (el instanceof HTMLInputElement) return el.type || 'text';
  if (el instanceof HTMLSelectElement) return el.multiple ? 'select-multiple' : 'select-one';
  if (el instanceof HTMLTextAreaElement) return 'textarea';
  return el.getAttribute('role') || el.tagName.toLowerCase();
}

/**
 * Map aria-haspopup values to SurfaceType.
 */
function mapHasPopupToSurface(hasPopup: string): SurfaceType {
  switch (hasPopup.toLowerCase()) {
    case 'dialog': return 'dialog';
    case 'menu': return 'menu';
    case 'listbox': return 'dropdown';
    case 'grid': return 'dropdown';
    case 'tree': return 'dropdown';
    default: return 'popover';
  }
}

/**
 * Escape a string for use in a CSS selector.
 */
function cssEscape(value: string): string {
  if (typeof CSS !== 'undefined' && CSS.escape) {
    return CSS.escape(value);
  }
  return value.replace(/[^a-zA-Z0-9_-]/g, (m) => `\\${m}`);
}

/**
 * Generate a CSS selector for an element.
 */
function generateCssSelector(el: Element): string {
  if (el.id) return `#${cssEscape(el.id)}`;

  const parts: string[] = [];
  let current: Element | null = el;
  let depth = 0;
  const MAX_DEPTH = 5;

  while (current && current !== document.documentElement && depth < MAX_DEPTH) {
    const tag = current.tagName.toLowerCase();
    const parent = current.parentElement;

    if (!parent) {
      parts.unshift(tag);
      break;
    }

    const siblings = Array.from(parent.children).filter((s: Element) => s.tagName === current!.tagName);
    if (siblings.length === 1) {
      parts.unshift(tag);
    } else {
      const index = siblings.indexOf(current as Element) + 1;
      parts.unshift(`${tag}:nth-of-type(${index})`);
    }

    current = parent;
    depth++;
  }

  return parts.join(' > ');
}

// ── Diff Analysis Helpers ───────────────────────────────────────────────

/**
 * Check if a StateDiff has any meaningful changes.
 *
 * Used by the Intent Resolver to determine whether to produce an action
 * or discard an incidental interaction.
 */
export function hasMeaningfulChanges(diff: StateDiff): boolean {
  return (
    diff.valueChanges.length > 0 ||
    diff.toggleChanges.length > 0 ||
    diff.radioChanges.length > 0 ||
    diff.rangeChanges.length > 0 ||
    diff.tabChange !== null ||
    diff.urlChange !== null ||
    diff.surfaceChanges.length > 0
  );
}

/**
 * Check if a StateDiff represents a value selection
 * (one input value changed).
 */
export function isValueSelection(diff: StateDiff): boolean {
  return diff.valueChanges.length === 1 && diff.valueChanges[0].after !== '';
}

/**
 * Check if a StateDiff represents a toggle change.
 */
export function isToggleChange(diff: StateDiff): boolean {
  return diff.toggleChanges.length === 1;
}

/**
 * Check if a StateDiff represents a radio selection.
 */
export function isRadioSelection(diff: StateDiff): boolean {
  return diff.radioChanges.length === 1;
}
