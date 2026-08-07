/**
 * Component Detector — Layer 2 Enrichment
 *
 * Identifies the UI component family from the element's DOM signature.
 * Operates on ObservedEvent identity + domContext — pure function, no DOM access.
 *
 * Detection strategy (cascading, first match wins):
 *   1. Framework-specific CSS class patterns (MUI, Ant, PrimeReact, AG Grid, etc.)
 *   2. Semantic ARIA roles + structural patterns
 *   3. Common CSS class naming conventions
 *   4. Fallback: Generic
 *
 * Architecture: .drytis/specs/three-layer-component-model.md §Layer 2
 */

import type { ObservedEvent, ElementIdentity, DomContext } from '../shared/component-types';
import type {
  ComponentDetectionResult,
  ComponentType,
  ComponentFramework,
} from './component-types';
import { ICON_SEMANTIC_NAMES } from './component-types';

// ── Framework detection ────────────────────────────────────────────────

const FRAMEWORK_CLASS_RE: Array<{ framework: ComponentFramework; re: RegExp }> = [
  { framework: 'MUI', re: /\bMui\w+/ },
  { framework: 'AntDesign', re: /\bant-\w+/ },
  { framework: 'PrimeReact', re: /\bp-\w+/ },
  { framework: 'AGGrid', re: /\bag-(?:theme|header|row|cell|grid)\b/ },
  { framework: 'ChakraUI', re: /\bchakra-\w+/ },
  { framework: 'RadixUI', re: /\bradix-\w+|data-radix/ },
  { framework: 'OXD', re: /\boxd-\w+/ },
  { framework: 'Syncfusion', re: /\be-control\b|\bsf-\w+/ },
  { framework: 'DevExtreme', re: /\bdx-\w+/ },
  { framework: 'Quill', re: /\bql-(?:editor|toolbar)\b/ },
  { framework: 'TinyMCE', re: /\btox-(?:editor|edit-area)\b/ },
];

function detectFramework(allClasses: string): ComponentFramework {
  for (const { framework, re } of FRAMEWORK_CLASS_RE) {
    if (re.test(allClasses)) return framework;
  }
  return 'Generic';
}

// ── Component type detection rules ─────────────────────────────────────

interface DetectionRule {
  type: ComponentType;
  test: (identity: ElementIdentity, domContext: DomContext, allClasses: string) => boolean;
}

const DATA_GRID_RE = /\b(?:ag-(?:grid|header|row|cell|theme)|MuiDataGrid|ant-table|p-datatable|oxd-table|data-grid|grid-view)\b/i;
const TREE_VIEW_RE = /\b(?:tree-view|ant-tree|p-tree|MuiTreeItem)\b/i;
const ACCORDION_RE = /\b(?:accordion|MuiAccordion|ant-collapse|p-accordion)\b/i;
const DIALOG_RE = /\b(?:modal|MuiDialog|ant-modal|p-dialog|dialog|popup|overlay)\b/i;
const DRAWER_RE = /\b(?:drawer|MuiDrawer|ant-drawer|sidebar|slide-over|offcanvas)\b/i;
const CAROUSEL_RE = /\b(?:carousel|swiper|slick|slide|slider-track)\b/i;
const CONTEXT_MENU_RE = /\b(?:context-menu|dropdown-menu|ant-dropdown-menu|p-menu|popover-menu)\b/i;
const BREADCRUMB_RE = /\b(?:breadcrumb|MuiBreadcrumbs|ant-breadcrumb)\b/i;
const STEPPER_RE = /\b(?:stepper|MuiStepper|ant-steps|p-steps|wizard)\b/i;
const SORT_RE = /\b(?:sort|sortable|column-header)\b/i;
const GRID_TOGGLE_RE = /\b(?:grid-toggle|list-toggle|view-toggle|layout-toggle|grid-view|list-view)\b/i;
const AUTOCOMPLETE_RE = /\b(?:autocomplete|MuiAutocomplete|ant-select-show-search|typeahead)\b/i;
const RICH_TEXT_RE = /\b(?:ql-editor|tox-edit-area|rich-text|contenteditable-editor|ProseMirror)\b/i;
const CHIP_INPUT_RE = /\b(?:chip-input|MuiChipInput|tag-input|token-input)\b/i;
const SPLIT_BUTTON_RE = /\b(?:split-button|btn-group|MuiButtonGroup)\b/i;
const SPINNER_RE = /\b(?:spinner|loading|loader|progress-spinner|preloader)\b/i;
const ALERT_RE = /\b(?:alert|MuiAlert|ant-alert|p-message|notification)\b/i;
const TOOLTIP_RE = /\b(?:tooltip|MuiTooltip|ant-tooltip|p-tooltip|hint)\b/i;
const PROGRESS_BAR_RE = /\b(?:progress-bar|MuiLinearProgress|ant-progress|p-progressbar)\b/i;
const RATING_RE = /\b(?:rating|star-rating|MuiRating|ant-rate|p-rating)\b/i;
const TOGGLE_SWITCH_RE = /\b(?:toggle-switch|switch|MuiSwitch|ant-switch|p-toggleswitch)\b/i;

const DETECTION_RULES: DetectionRule[] = [
  // ── Specific structural elements checked first ──
  // SortButton and GridToggle must be checked BEFORE DataGrid,
  // because grid headers with sort often match both patterns.
  {
    type: 'SortButton',
    test: (_id, _dc, classes) => SORT_RE.test(classes),
  },
  {
    type: 'GridToggle',
    test: (_id, _dc, classes) => GRID_TOGGLE_RE.test(classes),
  },
  {
    type: 'DataGrid',
    test: (_id, _dc, classes) => DATA_GRID_RE.test(classes) || _id.ariaRole === 'grid' || _id.ariaRole === 'gridcell' || _id.ariaRole === 'columnheader',
  },
  {
    type: 'TreeView',
    test: (_id, _dc, classes) => TREE_VIEW_RE.test(classes) || _id.ariaRole === 'treeitem' || _id.ariaRole === 'tree',
  },
  {
    type: 'Accordion',
    test: (_id, _dc, classes) => ACCORDION_RE.test(classes),
  },
  {
    type: 'Dialog',
    test: (_id, _dc, classes) => DIALOG_RE.test(classes) || _id.ariaRole === 'dialog',
  },
  {
    type: 'Drawer',
    test: (_id, _dc, classes) => DRAWER_RE.test(classes),
  },
  {
    type: 'Carousel',
    test: (_id, _dc, classes) => CAROUSEL_RE.test(classes),
  },
  {
    type: 'ContextMenu',
    test: (_id, _dc, classes) => CONTEXT_MENU_RE.test(classes) || _id.ariaRole === 'menu',
  },
  {
    type: 'Breadcrumb',
    test: (_id, _dc, classes) => BREADCRUMB_RE.test(classes),
  },
  {
    type: 'Stepper',
    test: (_id, _dc, classes) => STEPPER_RE.test(classes),
  },
  {
    type: 'Autocomplete',
    test: (_id, _dc, classes) => AUTOCOMPLETE_RE.test(classes),
  },
  {
    type: 'RichTextEditor',
    test: (_id, _dc, classes) => RICH_TEXT_RE.test(classes) || _dc.isContentEditable,
  },
  {
    type: 'ChipInput',
    test: (_id, _dc, classes) => CHIP_INPUT_RE.test(classes),
  },
  {
    type: 'SplitButton',
    test: (_id, _dc, classes) => SPLIT_BUTTON_RE.test(classes),
  },
  {
    type: 'ProgressBar',
    test: (_id, _dc, classes) => PROGRESS_BAR_RE.test(classes),
  },
  {
    type: 'Rating',
    test: (_id, _dc, classes) => RATING_RE.test(classes),
  },
  {
    type: 'ToggleSwitch',
    test: (_id, _dc, classes) => TOGGLE_SWITCH_RE.test(classes),
  },
];

// ── Icon detection ─────────────────────────────────────────────────────

/**
 * Detect if a button is an icon-only button (no text, just SVG/IMG/icon font).
 * Icon buttons need special naming since they have no accessibleName.
 */
function isIconButton(identity: ElementIdentity): boolean {
  // SVG icon, font-icon, or img inside button — no text content
  // Heuristic: no accessibleName, no ariaLabel, no placeholder
  const hasText =
    (identity.accessibleName && identity.accessibleName.trim().length > 0) ||
    (identity.ariaLabel && identity.ariaLabel.trim().length > 0);
  return !hasText && identity.tag === 'BUTTON';
}

/**
 * Extract semantic icon name from CSS classes or data attributes.
 * Common patterns: fa-close, fa-trash, mdi-delete, icon-close, etc.
 */
function extractIconName(allClasses: string): string | null {
  const classes = allClasses.toLowerCase();

  // Font Awesome: fa-close, fa-trash, fa-search, etc.
  const faMatch = classes.match(/\bfa-(?:solid|regular|brands?-)?([a-z][-a-z0-9]+)\b/);
  if (faMatch) {
    const name = faMatch[1].replace(/[-_]/g, '');
    if (ICON_SEMANTIC_NAMES[name]) return ICON_SEMANTIC_NAMES[name];
    if (ICON_SEMANTIC_NAMES[faMatch[1].replace(/-/g, '')]) return ICON_SEMANTIC_NAMES[faMatch[1].replace(/-/g, '')];
    return faMatch[1].replace(/-/g, ' ');
  }

  // Material Icons: material-icons class + ligature text
  // (text would be in accessibleName — skip)

  // Heroicons / generic: icon-close, icon-delete
  const iconMatch = classes.match(/\bicon-([a-z][-a-z0-9]+)\b/);
  if (iconMatch) {
    const name = iconMatch[1].replace(/[-_]/g, '');
    if (ICON_SEMANTIC_NAMES[name]) return ICON_SEMANTIC_NAMES[name];
    return iconMatch[1].replace(/-/g, ' ');
  }

  // MUI icon button: often has class like 'MuiIconButton-root' with no text
  // Try matching by specific class patterns
  for (const [key, value] of Object.entries(ICON_SEMANTIC_NAMES)) {
    const keyRe = new RegExp(`\\b(?:${key}|icon-${key}|fa-${key})\\b`, 'i');
    if (keyRe.test(classes)) return value;
  }

  // OXD icon buttons: oxd-icon-button with specific icon class
  const oxdIconMatch = classes.match(/oxd-icon-(?:button-)?([a-z][-a-z0-9]*)/);
  if (oxdIconMatch) {
    const name = oxdIconMatch[1].replace(/[-_]/g, '');
    if (ICON_SEMANTIC_NAMES[name]) return ICON_SEMANTIC_NAMES[name];
  }

  return null;
}

// ── Main detection function ────────────────────────────────────────────

/**
 * Detect the component type and framework for an observed event.
 *
 * This is a PURE function — it operates only on the event's identity and
 * domContext. No DOM access. Framework-safe and testable.
 *
 * @param event — the observed event with identity and domContext
 * @returns detection result with componentType, framework, meaning, and data
 */
export function detectComponent(event: ObservedEvent): ComponentDetectionResult {
  const { target: identity, domContext } = event;

  // Combine all class sources for matching
  const ownClasses = identity.className ?? '';
  const ancestorClassesStr = domContext.ancestorClasses.join(' ');
  const allClasses = `${ownClasses} ${ancestorClassesStr}`;

  // Detect framework
  const componentFramework = detectFramework(allClasses);

  // Initialize result data
  const componentData: Record<string, string> = {};

  // Try each detection rule — first match wins
  let componentType: ComponentType = 'Generic';
  for (const rule of DETECTION_RULES) {
    if (rule.test(identity, domContext, allClasses)) {
      componentType = rule.type;
      break;
    }
  }

  // Icon button detection (overrides Generic for button with no text)
  if (componentType === 'Generic' && isIconButton(identity)) {
    componentType = 'IconButton';
    const iconName = extractIconName(allClasses);
    if (iconName) {
      componentData.iconName = iconName;
    }
  }

  // Alert and tooltip detection (often in ancestors)
  if (componentType === 'Generic') {
    if (ALERT_RE.test(allClasses)) componentType = 'Alert';
    else if (TOOLTIP_RE.test(allClasses)) componentType = 'Tooltip';
    else if (SPINNER_RE.test(allClasses)) componentType = 'Spinner';
  }

  // Extract component-specific data
  if (componentType === 'DataGrid') {
    // Try to extract column name from accessible name
    if (identity.accessibleName) {
      componentData.columnName = identity.accessibleName;
    }
  }

  if (componentType === 'SortButton' && identity.accessibleName) {
    componentData.columnName = identity.accessibleName;
  }

  return {
    componentType,
    componentFramework,
    businessMeaning: '', // resolved by MeaningResolver
    componentData,
  };
}
