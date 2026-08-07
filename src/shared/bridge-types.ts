/**
 * Bridge Types — Temporary Compatibility Bridge
 *
 * These types were extracted from the deleted src/classifier/interaction-types.ts
 * during Phase 1.1 (Dead Code Removal). They exist ONLY because the generation
 * pipeline (ir-bridge.ts) and sidepanel UI (timeline-renderer.ts) have not yet
 * been unified to use ComponentInteraction directly.
 *
 * Phase 1.3 (Type Bridge Unification) will eliminate DetectedInteraction,
 * InteractionType, and InteractionMetadata when the IR Bridge is updated to
 * accept ComponentInteraction[]. TYPE_DISPLAY will be replaced with a proper
 * display registry in a future UI track.
 *
 * This file has a SCHEDULED DELETION DATE: Phase 1.3.
 * Do NOT add new consumers. Do NOT extend these types.
 */

import type { ElementIdentity } from './types';

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
  // Text Entry
  | 'TextEntry'
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
}

// ── Detection Result ────────────────────────────────────────────────────

export interface DetectedInteraction {
  interactionId: string;
  type: InteractionType;
  eventIds: string[];
  rawEventTypes: string[];
  target?: ElementIdentity;
  metadata: InteractionMetadata;
  confidence: number;
  /** Which engine produced this interaction: 'v2' (Evidence Engine) or 'v1-fallback' (V1 detector). */
  engine?: string;
}

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
  TextEntry:       { label: 'Text Entry',      icon: '⌨️', color: '#10b981' },
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
  NewTab:          { label: 'New Tab',         icon: '🗂️', color: '#3b82f6' },
  NewWindow:       { label: 'New Window',      icon: '🪟', color: '#3b82f6' },
  Iframe:          { label: 'Iframe',          icon: '🖼️', color: '#3b82f6' },
  Unknown:         { label: 'Unknown',         icon: '❓', color: '#9ca3af' },
};
