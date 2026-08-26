/**
 * Component Definitions — Registry
 *
 * Aggregates all component definitions into a single array.
 * The Component Runtime receives this array and uses it as its
 * classification vocabulary.
 *
 * Adding a new interaction type:
 * 1. Create a new definition file (e.g., src/definitions/slider.ts)
 * 2. Implement the ComponentDefinition interface
 * 3. Import it here and add to ALL_DEFINITIONS
 * 4. No other files change (AP7: Additive Extensibility)
 *
 * Architecture: `.drytis/specs/m0a-architecture-validation.md` §2.3
 */

import type { ComponentDefinition } from '../shared/component-types';
import { dragDropDefinition } from './drag-drop';
import { keyboardShortcutDefinition } from './keyboard-shortcut';
import { datePickerDefinition } from './date-picker';
import { dropdownDefinition } from './dropdown';
import { sliderDefinition } from './slider';
import { colorInputDefinition } from './color-input';
import { checkboxDefinition } from './checkbox';
import { fileUploadDefinition } from './file-upload';
import { radioButtonDefinition } from './radio-button';
import { textEntryDefinition } from './text-entry';
import { hoverDefinition } from './hover';
import { linkDefinition } from './link';
import { modalDefinition } from './modal';
import { tabDefinition } from './tab';
import { expanderDefinition } from './expander';
import { scrollDefinition } from './scroll';
import { navigationDefinition } from './navigation';
import { clickDefinition } from './click';

/**
 * All registered component definitions, ordered by priority.
 * The ComponentRuntime sorts this by priority (ascending) during discovery.
 *
 * Priority semantics (lower = higher priority in discovery order):
 *   10 = most specific (DatePicker)
 *   20 = Dropdown
 *   25 = Slider
 *   15 = ColorInput
 *   30 = Checkbox
 *   35 = FileUpload
 *   40 = RadioButton
 *   50 = TextEntry
 *   60 = Hover
 *   65 = Tab (checked before Link — tabs are often <a> tags)
 *   70 = Link
 *   80 = Expander (7.4-B1: aria-expanded disclosure; above Click fallback,
 *        below Tab/Dropdown which keep their types when also aria-expanded)
 *  110 = Scroll
 *  120 = Navigation
 *  180 = Click (universal fallback — always checked last)
 *
 * M9.10 additions:
 *    5 = DragDrop (dragstart is unambiguous, check before everything)
 *    8 = KeyboardShortcut (modifier+keydown, check before TextEntry)
 */
export const ALL_DEFINITIONS: ComponentDefinition[] = [
  dragDropDefinition,        // priority 5
  keyboardShortcutDefinition,// priority 8
  datePickerDefinition,      // priority 10
  dropdownDefinition,        // priority 20
  sliderDefinition,          // priority 25
  colorInputDefinition,      // priority 15
  checkboxDefinition,        // priority 30
  fileUploadDefinition,      // priority 35
  radioButtonDefinition,     // priority 40
  textEntryDefinition,       // priority 50
  hoverDefinition,           // priority 60
  tabDefinition,             // priority 65
  linkDefinition,            // priority 70
  modalDefinition,            // priority 75 (7.4-B5: dialog open + Escape dismissal)
  expanderDefinition,        // priority 80 (7.4-B1: aria-expanded disclosure)
  scrollDefinition,          // priority 110
  navigationDefinition,      // priority 120
  clickDefinition,           // priority 180 (fallback)
];

/**
 * For external consumers that need individual definitions.
 */
export {
  dragDropDefinition,
  keyboardShortcutDefinition,
  datePickerDefinition,
  dropdownDefinition,
  sliderDefinition,
  colorInputDefinition,
  checkboxDefinition,
  fileUploadDefinition,
  radioButtonDefinition,
  textEntryDefinition,
  hoverDefinition,
  linkDefinition,
  modalDefinition,
  tabDefinition,
  scrollDefinition,
  navigationDefinition,
  clickDefinition,
};
