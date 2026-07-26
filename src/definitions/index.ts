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
import { datePickerDefinition } from './date-picker';
import { dropdownDefinition } from './dropdown';
import { checkboxDefinition } from './checkbox';
import { radioButtonDefinition } from './radio-button';
import { textEntryDefinition } from './text-entry';
import { hoverDefinition } from './hover';
import { linkDefinition } from './link';
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
 *   30 = Checkbox
 *   40 = RadioButton
 *   50 = TextEntry
 *   60 = Hover
 *   70 = Link
 *  110 = Scroll
 *  120 = Navigation
 *  180 = Click (universal fallback — always checked last)
 */
export const ALL_DEFINITIONS: ComponentDefinition[] = [
  datePickerDefinition,    // priority 10
  dropdownDefinition,      // priority 20
  checkboxDefinition,      // priority 30
  radioButtonDefinition,   // priority 40
  textEntryDefinition,     // priority 50
  hoverDefinition,         // priority 60
  linkDefinition,          // priority 70
  scrollDefinition,        // priority 110
  navigationDefinition,    // priority 120
  clickDefinition,         // priority 180 (fallback)
];

/**
 * For external consumers that need individual definitions.
 */
export {
  datePickerDefinition,
  dropdownDefinition,
  checkboxDefinition,
  radioButtonDefinition,
  textEntryDefinition,
  hoverDefinition,
  linkDefinition,
  scrollDefinition,
  navigationDefinition,
  clickDefinition,
};
