/**
 * Interaction Types — Phase 2 Raw Interaction Type Detection
 *
 * Defines every interaction type, its detection tier, and its metadata schema.
 * Each type maps to a detection rule in interaction-detector.ts.
 *
 * Tier 1: Deterministic — detected from element identity + event patterns
 * Tier 2: Defined but detected as Unknown — requires future heuristics
 */

// ── Interaction Type Enum ───────────────────────────────────────────────

export type InteractionType =
  // Navigation
  | 'PageNavigation'
  | 'Back'
  | 'Forward'
  | 'Refresh'
  // Mouse
  | 'Click'
  | 'DoubleClick'
  | 'RightClick'
  | 'Hover'
  | 'DragDrop'
  // Keyboard
  | 'KeyboardShortcut'
  // Text Entry
  | 'TextEntry'
  | 'RichTextEditor'
  // Selection Controls
  | 'NativeDropdown'
  | 'CustomDropdown'
  | 'Autocomplete'
  | 'MultiSelect'
  | 'Checkbox'
  | 'RadioButton'
  | 'ToggleSwitch'
  | 'Slider'
  // Date & Time
  | 'DatePicker'
  | 'TimePicker'
  | 'DateTimePicker'
  // File Upload
  | 'FileUpload'
  | 'DragDropUpload'
  // Navigation UI
  | 'Link'
  | 'Tab'
  | 'Menu'
  | 'Breadcrumb'
  // Scrolling
  | 'PageScroll'
  | 'ContainerScroll'
  | 'InfiniteScroll'
  // Dialogs
  | 'BrowserAlert'
  | 'Modal'
  | 'Drawer'
  | 'Popover'
  | 'Tooltip'
  | 'ModalDialog'
  | 'Stepper'
  | 'TagInput'
  | 'OtpInput'
  | 'HotkeySequence'
  // Window & Frame
  | 'NewTab'
  | 'NewWindow'
  | 'Iframe'
  // Unknown
  | 'Unknown';

// ── Metadata ────────────────────────────────────────────────────────────

export interface InteractionMetadata {
  // Navigation
  url?: string;
  title?: string;
  transitionType?: string;
  // Text Entry
  textValue?: string;
  // Toggle states
  checked?: boolean;
  // Selection
  selectedValue?: string;
  // File Upload
  files?: string[];
  fileCount?: number;
  uploadMethod?: string;
  acceptedFileTypes?: string;
  multiple?: boolean;
  // Scroll
  scrollPosition?: { x: number; y: number };
  // Hover
  hoverDuration?: number;
  // Drag & Drop
  dropTarget?: string;
  sourceElement?: string;
  // Keyboard Shortcut
  /** Human-readable shortcut (e.g., "Ctrl+S", "Cmd+K", "Escape"). */
  shortcutKey?: string;
  /** Raw key value from the KeyboardEvent (e.g., "s", "Escape", "Enter"). */
  keyValue?: string;
  /** Raw code value from the KeyboardEvent (e.g., "KeyS", "Escape", "Enter"). */
  keyCode?: string;
  /** True if Ctrl was held. */
  hasCtrl?: boolean;
  /** True if Shift was held. */
  hasShift?: boolean;
  /** True if Alt/Option was held. */
  hasAlt?: boolean;
  /** True if Cmd (Mac metaKey) was held. */
  hasCmd?: boolean;
  /** Normalized key string for Playwright (e.g., "Control+s", "Escape"). */
  playwrightKey?: string;
  // Element name (for Click, Menu, and other interactions)
  accessibleName?: string;
  // Date & Time
  dateValue?: string;
  timeValue?: string;
  dateTimeValue?: string;
  /** Human-readable display value for date picker interactions. */
  displayValue?: string;
  /** True if the date value could not be confidently normalized. */
  dateAmbiguous?: boolean;
  // Slider
  sliderValue?: string;
  sliderMin?: string;
  sliderMax?: string;
  startValue?: string;
  endValue?: string;
  dragTracked?: boolean;
  // Tab
  selectedTab?: string;
  // Breadcrumb
  breadcrumbLevel?: number;
  breadcrumbPath?: string[];
  // Browser Alert (alert/confirm/prompt)
  dialogType?: string;
  dialogMessage?: string;
  dialogResult?: string;
  // New Tab / New Window
  openedUrl?: string;
  openedTitle?: string;
  // Iframe enrichment
  iframeSrc?: string;
  iframeName?: string;
  iframeDepth?: number;
  // Surface detection (Modal, Drawer, Popover, Tooltip)
  surfaceLabel?: string;
  surfaceRole?: string;
  /**
   * Surface context: populated when this interaction either opened a surface
   * (popover, drawer, modal) or occurred inside an already-open surface.
   * Used by the SemanticReasoner for multiConfig activation and absorption.
   */
  surfaceContext?: {
    /** Type of surface: 'modal' | 'drawer' | 'popover' | 'tooltip'. */
    type: string;
    /** Accessible name of the surface container, if known. */
    label?: string;
    /** ARIA role of the surface container, if known. */
    role?: string;
    /** True if this interaction is the one that caused the surface to appear. */
    openedByThisInteraction?: boolean;
  } | null;
  // ── Semantic Reasoning Enrichment ──
  /** Semantic action assigned by the reasoner: 'configure' | 'authenticate'. */
  semanticAction?: string;
  /** For MultiConfig: field-value pairs configured inside a panel. */
  configuredFields?: Record<string, string>;
  /** For MultiConfig: the panel's label (trigger accessibleName). */
  panelLabel?: string;
  /** For FormSubmit: the submit action label (e.g., 'Login', 'Sign Up'). */
  formSubmitAction?: string;
  /** For FormSubmit: interaction IDs of form fields in this submission. */
  formFields?: string[];
  // ModalDialog
  /** Title/label of the modal surface. */
  modalTitle?: string;
  /** Sub-actions captured inside the modal (selections, inputs, toggles). */
  modalSubActions?: Array<{
    action: string;
    label: string;
    value?: string;
  }>;
  /** Whether the modal interaction had any sub-actions. */
  hasSubActions?: boolean;
  // Stepper
  /** Field name (Adults, Children, Quantity, etc.) */
  fieldName?: string;
  /** Total delta (net increment/decrement count) */
  totalDelta?: number;
  /** Number of + clicks */
  incrementCount?: number;
  /** Number of - clicks */
  decrementCount?: number;
  /** Sub-actions for the stepper */
  stepperSubActions?: Array<{
    action: string;
    label: string;
    field: string;
    delta: number;
  }>;
  /** Delta for adapter passthrough */
  stepperDelta?: number;
  // Rich Text Editor
  /** Editor framework name (Quill, CKEditor, ProseMirror, etc.) */
  editorType?: string;
  /** Whether this TextEntry is a rich text editor */
  isRichTextEditor?: boolean;
}

// ── Detection Result ────────────────────────────────────────────────────

export interface DetectedInteraction {
  interactionId: string;
  type: InteractionType;
  eventIds: string[];
  rawEventTypes: string[];
  target?: import('../shared/types').ElementIdentity;
  metadata: InteractionMetadata;
  confidence: number;
  /** Which engine produced this interaction: 'v2' (Evidence Engine) or 'v1-fallback' (V1 detector). */
  engine?: string;
}

// ── Category → Type Mapping ─────────────────────────────────────────────

export const INTERACTION_CATEGORIES: Record<string, InteractionType[]> = {
  Navigation: ['PageNavigation', 'Back', 'Forward', 'Refresh'],
  Mouse: ['Click', 'DoubleClick', 'RightClick', 'Hover', 'DragDrop'],
  Keyboard: ['KeyboardShortcut', 'HotkeySequence'],
  'Text Entry': ['TextEntry', 'RichTextEditor', 'TagInput', 'OtpInput'],
  'Selection Controls': ['NativeDropdown', 'CustomDropdown', 'SearchableDropdown', 'Autocomplete', 'MultiSelect', 'Checkbox', 'RadioButton', 'ToggleSwitch', 'Slider', 'Stepper'],
  'Date & Time': ['DatePicker', 'TimePicker', 'DateTimePicker'],
  'File Upload': ['FileUpload', 'DragDropUpload'],
  'Navigation UI': ['Link', 'Tab', 'Menu', 'Breadcrumb'],
  Scrolling: ['PageScroll', 'ContainerScroll', 'InfiniteScroll'],
  Dialogs: ['BrowserAlert', 'Modal', 'ModalDialog', 'Drawer', 'Popover', 'Tooltip'],
  'Window & Frame': ['NewTab', 'NewWindow', 'Iframe'],
  Unknown: ['Unknown'],
};

// ── Tier Classification ─────────────────────────────────────────────────

export const TIER1_TYPES: Set<InteractionType> = new Set([
  'PageNavigation', 'Back', 'Forward', 'Refresh',
  'Click', 'DoubleClick', 'RightClick', 'Hover', 'DragDrop',
  'KeyboardShortcut',
  'TextEntry', 'RichTextEditor',
  'NativeDropdown',
  'Checkbox', 'RadioButton', 'ToggleSwitch', 'Slider', 'Stepper',
  'DatePicker', 'TimePicker', 'DateTimePicker',
  'FileUpload',
  'Link', 'Tab', 'Menu', 'Breadcrumb',
  'PageScroll', 'ContainerScroll',
  'BrowserAlert', 'ModalDialog',
  'NewTab', 'NewWindow', 'Iframe',
]);

export const TIER2_TYPES: Set<InteractionType> = new Set([
  'CustomDropdown', 'Autocomplete', 'MultiSelect',
  'InfiniteScroll',
  'Modal', 'Drawer', 'Popover', 'Tooltip',
  'DragDropUpload',
]);

// ── Type → Display Info ─────────────────────────────────────────────────

export const TYPE_DISPLAY: Record<InteractionType, { label: string; icon: string; color: string }> = {
  PageNavigation:  { label: 'Page Navigation', icon: '🧭', color: '#3b82f6' },
  Back:            { label: 'Back',            icon: '⬅️', color: '#3b82f6' },
  Forward:         { label: 'Forward',         icon: '➡️', color: '#3b82f6' },
  Refresh:         { label: 'Refresh',         icon: '🔄', color: '#3b82f6' },
  Click:           { label: 'Click',           icon: '👆', color: '#7c3aed' },
  DoubleClick:     { label: 'Double Click',    icon: '👆', color: '#7c3aed' },
  RightClick:      { label: 'Right Click',     icon: '🖱️', color: '#dc2626' },
  Hover:           { label: 'Hover',           icon: '👁️', color: '#6b7280' },
  DragDrop:        { label: 'Drag & Drop',     icon: '📦', color: '#0891b2' },
  KeyboardShortcut:{ label: 'Keyboard Shortcut', icon: '⌨️', color: '#7c3aed' },
  TextEntry:       { label: 'Text Entry',      icon: '⌨️', color: '#10b981' },
  RichTextEditor:  { label: 'Rich Text Editor', icon: '📝', color: '#8b5cf6' },
  NativeDropdown:  { label: 'Native Dropdown', icon: '📋', color: '#9333ea' },
  CustomDropdown:  { label: 'Custom Dropdown', icon: '📋', color: '#9333ea' },
  Autocomplete:    { label: 'Autocomplete',    icon: '🔍', color: '#9333ea' },
  MultiSelect:     { label: 'Multi Select',    icon: '☑️', color: '#ca8a04' },
  Checkbox:        { label: 'Checkbox',        icon: '☑️', color: '#0d9488' },
  RadioButton:     { label: 'Radio Button',    icon: '🔘', color: '#be123c' },
  ToggleSwitch:    { label: 'Toggle Switch',   icon: '🎚️', color: '#e11d48' },
  Slider:          { label: 'Slider',          icon: '🎚️', color: '#6366f1' },
  DatePicker:      { label: 'Date Picker',     icon: '📅', color: '#7c3aed' },
  TimePicker:      { label: 'Time Picker',     icon: '🕐', color: '#7c3aed' },
  DateTimePicker:  { label: 'DateTime Picker', icon: '📅', color: '#7c3aed' },
  FileUpload:      { label: 'File Upload',     icon: '📎', color: '#16a34a' },
  DragDropUpload:  { label: 'Drag-Drop Upload',icon: '📎', color: '#16a34a' },
  Link:            { label: 'Link',            icon: '🔗', color: '#2563eb' },
  Tab:             { label: 'Tab',             icon: '📑', color: '#8b5cf6' },
  Menu:            { label: 'Menu',            icon: '📜', color: '#6366f1' },
  Breadcrumb:      { label: 'Breadcrumb',      icon: '🍞', color: '#6366f1' },
  PageScroll:      { label: 'Page Scroll',     icon: '📜', color: '#6b7280' },
  ContainerScroll: { label: 'Container Scroll',icon: '📜', color: '#6b7280' },
  InfiniteScroll:  { label: 'Infinite Scroll', icon: '♾️', color: '#6b7280' },
  BrowserAlert:    { label: 'Browser Alert',   icon: '⚠️', color: '#f59e0b' },
  Modal:           { label: 'Modal',           icon: '🪟', color: '#f59e0b' },
  Drawer:          { label: 'Drawer',          icon: '🗄️', color: '#f59e0b' },
  Popover:         { label: 'Popover',          icon: '💬', color: '#f59e0b' },
  Tooltip:         { label: 'Tooltip',          icon: '💡', color: '#f59e0b' },
  ModalDialog:     { label: 'Modal Dialog',     icon: '🪟', color: '#f59e0b' },
  Stepper:         { label: 'Stepper',          icon: '🔢', color: '#155e75' },
  TagInput:        { label: 'Tag Input',        icon: '🏷️', color: '#8b5cf6' },
  OtpInput:        { label: 'OTP Input',        icon: '🔐', color: '#dc2626' },
  HotkeySequence:  { label: 'Hotkey Sequence',  icon: '⌨️', color: '#059669' },
  NewTab:          { label: 'New Tab',         icon: '🗂️', color: '#3b82f6' },
  NewWindow:       { label: 'New Window',      icon: '🪟', color: '#3b82f6' },
  Iframe:          { label: 'Iframe',          icon: '🖼️', color: '#3b82f6' },
  Unknown:         { label: 'Unknown',         icon: '❓', color: '#9ca3af' },
};
