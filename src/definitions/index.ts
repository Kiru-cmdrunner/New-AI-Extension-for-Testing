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
import { keyboardShortcutDefinition } from './keyboard-shortcut';
import { hotkeySequenceDefinition } from './hotkey-sequence';
import { modalDialogDefinition } from './modal-dialog';
import { datePickerDefinition } from './date-picker';
import { dragAndDropDefinition } from './drag-and-drop';
import { dropdownDefinition } from './dropdown';
import { sliderDefinition } from './slider';
import { checkboxDefinition } from './checkbox';
import { fileUploadDefinition } from './file-upload';
import { radioButtonDefinition } from './radio-button';
import { tagInputDefinition } from './tag-input';
import { otpInputDefinition } from './otp-input';
import { stepperDefinition } from './stepper';
import { textEntryDefinition } from './text-entry';
import { hoverDefinition } from './hover';
import { linkDefinition } from './link';
import { tabDefinition } from './tab';
import { breadcrumbDefinition } from './breadcrumb';
import { newTabDefinition } from './new-tab';
import { newWindowDefinition } from './new-window';
import { scrollDefinition } from './scroll';
import { navigationDefinition } from './navigation';
import { clickDefinition } from './click';

/**
 * All registered component definitions, ordered by priority.
 * The ComponentRuntime sorts this by priority (ascending) during discovery.
 *
 * Priority semantics (lower = higher priority in discovery order):
 *   5 = KeyboardShortcut (keydown with modifiers or special keys)
 *   10 = most specific (DatePicker)
 *   15 = DragDrop (before Dropdown/Slider — captures mousedown first)
 *   20 = Dropdown
 *   22 = ModalDialog (after Dropdown — fires as catch-all for generic clicks
 *        that might open modals; confirmed by modal-type surface binding)
 *   25 = Slider
 *   30 = Checkbox
 *   35 = FileUpload
 *   40 = RadioButton
 *   50 = TextEntry
 *   60 = Hover
 *   65 = Tab (checked before Link — tabs are often <a> tags)
 *   70 = Link
 *  110 = Scroll
 *  120 = Navigation
 *  180 = Click (universal fallback — always checked last)
 */
export const ALL_DEFINITIONS: ComponentDefinition[] = [
  keyboardShortcutDefinition, // priority 5
  hotkeySequenceDefinition,   // priority 6
  datePickerDefinition,     // priority 10
  dragAndDropDefinition,    // priority 15
  dropdownDefinition,      // priority 20
  modalDialogDefinition,    // priority 22
  sliderDefinition,        // priority 25
  stepperDefinition,       // priority 28
  checkboxDefinition,      // priority 30
  fileUploadDefinition,    // priority 35
  radioButtonDefinition,   // priority 40
  tagInputDefinition,      // priority 45
  otpInputDefinition,      // priority 46
  textEntryDefinition,     // priority 50
  hoverDefinition,         // priority 60
  tabDefinition,           // priority 65
  breadcrumbDefinition,    // priority 68
  newTabDefinition,        // priority 68
  newWindowDefinition,     // priority 68
  linkDefinition,          // priority 70
  scrollDefinition,        // priority 110
  navigationDefinition,    // priority 120
  clickDefinition,         // priority 180 (fallback)
];

/**
 * For external consumers that need individual definitions.
 */
export {
  keyboardShortcutDefinition,
  hotkeySequenceDefinition,
  modalDialogDefinition,
  datePickerDefinition,
  dragAndDropDefinition,
  dropdownDefinition,
  sliderDefinition,
  checkboxDefinition,
  fileUploadDefinition,
  radioButtonDefinition,
  tagInputDefinition,
  otpInputDefinition,
  stepperDefinition,
  textEntryDefinition,
  hoverDefinition,
  linkDefinition,
  tabDefinition,
  breadcrumbDefinition,
  newTabDefinition,
  newWindowDefinition,
  scrollDefinition,
  navigationDefinition,
  clickDefinition,
};
