/**
 * Data Resolver — validates test data against DataRequirement constraints.
 *
 * Pure function module — no I/O, no repository access.
 * Design: .drytis/specs/p2-capability-derived-ir-generation.md §4.3
 */

import type { DataRequirement } from '../entities/data-requirement';
import type { TestData, DataWarning } from './p2-types';

export interface ResolvedTestData {
  readonly resolved: ReadonlyMap<string, string | number | boolean>;
  readonly warnings: DataWarning[];
}

/**
 * Resolve and validate test data against data requirements.
 *
 * For each requirement:
 *   - If value is present and valid → include in resolved map.
 *   - If value is present but invalid → warning 'invalid-value', skip.
 *   - If required and missing → warning 'missing-required', skip.
 *   - If optional and missing → use defaultValue or skip silently.
 */
export function resolveTestData(
  requirements: readonly DataRequirement[],
  testData: TestData,
): ResolvedTestData {
  const resolved = new Map<string, string | number | boolean>();
  const warnings: DataWarning[] = [];

  for (const req of requirements) {
    const value = testData.get(req.field);

    if (value === undefined) {
      // Missing from testData
      if (req.required) {
        warnings.push({
          field: req.field,
          reason: 'missing-required',
          message: `Required field "${req.field}" has no test data value`,
        });
      } else if (req.defaultValue !== null) {
        // Use default value — validate it too
        const defaultValid = validateValue(req, req.defaultValue);
        if (defaultValid.valid) {
          resolved.set(req.field, defaultValid.coerced!);
        }
        // If default is invalid, silently skip (it shouldn't be, but don't fail)
      }
      // Optional with no default → silently skip
      continue;
    }

    // Value is present — validate against constraints
    const result = validateValue(req, value);
    if (result.valid) {
      resolved.set(req.field, result.coerced!);
    } else {
      warnings.push({
        field: req.field,
        reason: 'invalid-value',
        message: `Field "${req.field}": ${result.error}`,
      });
    }
  }

  return { resolved, warnings };
}

// ── Validation ───────────────────────────────────────────────

interface ValidationResult {
  valid: boolean;
  coerced?: string | number | boolean;
  error?: string;
}

function validateValue(req: DataRequirement, value: string | number | boolean): ValidationResult {
  switch (req.kind) {
    case 'text':
    case 'email':
      return validateText(req, value);
    case 'number':
      return validateNumber(req, value);
    case 'boolean':
      return validateBoolean(value);
    case 'date':
      return validateDate(value);
    case 'select':
      return validateSelect(req, value);
    default:
      return { valid: false, error: `Unknown kind: ${req.kind}` };
  }
}

function validateText(req: DataRequirement, value: string | number | boolean): ValidationResult {
  const str = typeof value === 'string' ? value : String(value);

  const { minLength, maxLength, pattern } = req.constraints;
  if (minLength !== null && str.length < minLength) {
    return { valid: false, error: `length ${str.length} < minLength ${minLength}` };
  }
  if (maxLength !== null && str.length > maxLength) {
    return { valid: false, error: `length ${str.length} > maxLength ${maxLength}` };
  }
  if (pattern !== null) {
    try {
      const re = new RegExp(pattern);
      if (!re.test(str)) {
        return { valid: false, error: `does not match pattern ${pattern}` };
      }
    } catch {
      // Invalid regex pattern — skip pattern check
    }
  }
  return { valid: true, coerced: str };
}

function validateNumber(req: DataRequirement, value: string | number | boolean): ValidationResult {
  if (typeof value === 'boolean') {
    return { valid: false, error: 'expected number, got boolean' };
  }
  const num = typeof value === 'number' ? value : parseFloat(value);
  if (isNaN(num)) {
    return { valid: false, error: `"${value}" is not a valid number` };
  }
  const { min, max, step } = req.constraints;
  if (min !== null && num < min) {
    return { valid: false, error: `${num} < min ${min}` };
  }
  if (max !== null && num > max) {
    return { valid: false, error: `${num} > max ${max}` };
  }
  if (step !== null && step > 0) {
    const remainder = min !== null ? (num - min) % step : num % step;
    if (Math.abs(remainder) > 1e-9 && Math.abs(step - remainder) > 1e-9) {
      // Not aligned to step — allow if close enough (floating point)
      return { valid: false, error: `${num} not aligned to step ${step}` };
    }
  }
  return { valid: true, coerced: num };
}

function validateBoolean(value: string | number | boolean): ValidationResult {
  if (typeof value === 'boolean') {
    return { valid: true, coerced: value };
  }
  if (value === 'true' || value === 1) {
    return { valid: true, coerced: true };
  }
  if (value === 'false' || value === 0) {
    return { valid: true, coerced: false };
  }
  return { valid: false, error: `"${value}" is not a valid boolean` };
}

function validateDate(value: string | number | boolean): ValidationResult {
  const str = typeof value === 'string' ? value : String(value);
  const date = new Date(str);
  if (isNaN(date.getTime())) {
    return { valid: false, error: `"${str}" is not a valid date` };
  }
  return { valid: true, coerced: str };
}

function validateSelect(req: DataRequirement, value: string | number | boolean): ValidationResult {
  const str = typeof value === 'string' ? value : String(value);
  const options = req.constraints.options;
  if (options !== null && options.length > 0) {
    // Filter out null entries in options
    const validOptions = options.filter((o) => o !== null);
    if (!validOptions.includes(str)) {
      return { valid: false, error: `"${str}" not in options [${validOptions.join(', ')}]` };
    }
  }
  return { valid: true, coerced: str };
}
