/**
 * Error Handler — structured error creation and propagation.
 *
 * Phase 3 Task 8 (G11).
 *
 * Component Technical Specification §Infrastructure Layer:
 * Provides a standardized way to create, classify, and propagate errors
 * across components. Ensures all errors have consistent metadata for
 * debugging, logging, and user notification.
 */

import type { ErrorObject } from '../shared/architecture-types';
import { createLogger } from './logging-manager';

const logger = createLogger('error-handler');

// ── Error Codes ────────────────────────────────────────────

/**
 * Known error codes.
 * Add new codes as needed — this is extensible.
 */
export const ErrorCode = {
  // Recording
  RECORDING_NOT_ACTIVE: 'RECORDING_NOT_ACTIVE',
  ELEMENT_NOT_FOUND: 'ELEMENT_NOT_FOUND',
  IDENTITY_EXTRACTION_FAILED: 'IDENTITY_EXTRACTION_FAILED',

  // Generation
  GENERATION_FAILED: 'GENERATION_FAILED',
  LOCATOR_RESOLUTION_FAILED: 'LOCATOR_RESOLUTION_FAILED',
  EMPTY_TIMELINE: 'EMPTY_TIMELINE',

  // AI
  AI_TIMEOUT: 'AI_TIMEOUT',
  AI_RATE_LIMIT: 'AI_RATE_LIMIT',
  AI_INVALID_RESPONSE: 'AI_INVALID_RESPONSE',
  AI_NOT_CONFIGURED: 'AI_NOT_CONFIGURED',

  // Storage
  STORAGE_QUOTA_EXCEEDED: 'STORAGE_QUOTA_EXCEEDED',
  STORAGE_READ_FAILED: 'STORAGE_READ_FAILED',
  STORAGE_WRITE_FAILED: 'STORAGE_WRITE_FAILED',

  // Infrastructure
  SW_RESTART_DETECTED: 'SW_RESTART_DETECTED',
  NAVIGATION_DEBOUNCE: 'NAVIGATION_DEBOUNCE',
} as const;

/**
 * Error codes that are considered recoverable.
 * The system can retry or fall back gracefully.
 */
const RECOVERABLE_CODES: ReadonlySet<string> = new Set([
  ErrorCode.AI_TIMEOUT,
  ErrorCode.AI_RATE_LIMIT,
  ErrorCode.SW_RESTART_DETECTED,
  ErrorCode.NAVIGATION_DEBOUNCE,
  ErrorCode.STORAGE_QUOTA_EXCEEDED,
]);

// ── Error Factory ──────────────────────────────────────────

/**
 * Create a structured ErrorObject.
 *
 * @param code      - Error code from ErrorCode enum (or custom string).
 * @param message   - Human-readable error message.
 * @param component - Which component produced the error.
 * @param context   - Optional additional context.
 * @returns Structured ErrorObject.
 */
export function createError(
  code: string,
  message: string,
  component: string,
  context?: Record<string, unknown>,
): ErrorObject {
  return {
    code,
    message,
    component,
    recoverable: RECOVERABLE_CODES.has(code),
    ...(context !== undefined && { context }),
  };
}

/**
 * Create an error from a caught exception.
 *
 * @param err       - The caught error.
 * @param component - Which component caught the error.
 * @param fallbackCode - Error code to use if the exception doesn't carry one.
 * @returns Structured ErrorObject.
 */
export function createErrorFromException(
  err: unknown,
  component: string,
  fallbackCode: string = ErrorCode.GENERATION_FAILED,
): ErrorObject {
  const message = err instanceof Error ? err.message : String(err);
  const context = err instanceof Error
    ? { name: err.name, stack: err.stack }
    : { type: typeof err };

  return createError(fallbackCode, message, component, context);
}

/**
 * Log an error and return it.
 *
 * Convenience function: logs the error at 'error' level, then returns
 * the ErrorObject so the caller can use it for flow control.
 */
export function logError(error: ErrorObject): ErrorObject {
  logger.error(error.message, {
    code: error.code,
    component: error.component,
    recoverable: error.recoverable,
    ...error.context,
  });
  return error;
}

/**
 * Check if an error is recoverable.
 */
export function isRecoverable(error: ErrorObject): boolean {
  return error.recoverable;
}

/**
 * Check if an error is AI-related.
 */
export function isAIError(error: ErrorObject): boolean {
  return error.code.startsWith('AI_');
}

/**
 * Check if an error is storage-related.
 */
export function isStorageError(error: ErrorObject): boolean {
  return error.code.startsWith('STORAGE_');
}
