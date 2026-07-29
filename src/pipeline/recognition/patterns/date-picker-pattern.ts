/**
 * Date Picker Pattern — Phase 4 (revised)
 *
 * working-better: tag=INPUT with type in {date,time,datetime-local,month,week},
 * OR className matches datepicker patterns, OR aria-haspopup=dialog+INPUT,
 * OR name attribute matches date/dob/calendar regex
 */

import type { PatternDefinition } from '../../../types/foundation';

export const DATE_PICKER_PATTERN: PatternDefinition = {
  id: 'date-picker-v1',
  verb: 'selectDate',
  componentType: 'DatePicker',
  priority: 150,
  confidenceThreshold: 0.6,
  description: 'User selects a date from a date picker',
  conditions: [
    {
      signalType: 'eventSequence',
      operator: 'contains',
      expected: 'click',
      weight: 1,
      description: 'Must include a click or change event',
      anyOf: [
        { signalType: 'eventSequence', operator: 'contains', expected: 'change' },
      ],
    },
    {
      signalType: 'ariaAttribute',
      operator: 'contains',
      expected: 'inputType:date',
      weight: 3,
      description: 'Date/time input type, or haspopup=dialog on INPUT',
      anyOf: [
        { signalType: 'ariaAttribute', operator: 'contains', expected: 'inputType:time' },
        { signalType: 'ariaAttribute', operator: 'contains', expected: 'inputType:datetime-local' },
        { signalType: 'ariaAttribute', operator: 'contains', expected: 'haspopup:dialog' },
      ],
    },
  ],
};
