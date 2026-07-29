/**
 * Dropdown Select Pattern — Phase 4 (revised)
 *
 * working-better isDropdownTrigger():
 *   tag=SELECT, OR role in {combobox,listbox},
 *   OR className matches /(oxd-select-text|select|combobox|dropdown|antd.*select|MuiSelect)/i,
 *   OR aria-haspopup=listbox
 *
 * Completion: option click or native SELECT change event
 * No-op: selected value equals current display value
 */

import type { PatternDefinition } from '../../../types/foundation';

export const DROPDOWN_PATTERN: PatternDefinition = {
  id: 'dropdown-select-v1',
  verb: 'select',
  componentType: 'DropDownListbox',
  priority: 100,
  confidenceThreshold: 0.6,
  description: 'User selects an option from a dropdown/combobox',
  conditions: [
    {
      signalType: 'eventSequence',
      operator: 'contains',
      expected: 'click',
      weight: 1,
      description: 'Must include a click event',
    },
    {
      signalType: 'ariaRole',
      operator: 'equals',
      expected: 'combobox',
      weight: 2,
      description: 'Combobox, listbox, SELECT, or has popup=listbox',
      anyOf: [
        { signalType: 'ariaRole', operator: 'equals', expected: 'listbox' },
        { signalType: 'tag', operator: 'equals', expected: 'SELECT' },
        { signalType: 'ariaAttribute', operator: 'contains', expected: 'haspopup:listbox' },
        { signalType: 'cssClass', operator: 'matches', expected: '(?i)(oxd-select|combobox|dropdown|select)' },
      ],
    },
    {
      signalType: 'valueTransition',
      operator: 'exists',
      expected: null,
      weight: 3,
      description: 'Selection value changed',
    },
  ],
};
