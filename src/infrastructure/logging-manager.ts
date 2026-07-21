/**
 * Logging Manager — structured logging for CmdRunner components.
 *
 * Phase 3 Task 8 (G10 / G11).
 *
 * Component Technical Specification §Infrastructure Layer:
 * Provides level-prioritized structured logging that any component can use.
 * Logs are categorized for filtering and include optional structured data.
 *
 * MV3 Constraints:
 * - console.* is the primary output (no file system in MV3)
 * - Logs are prefixed with [CMDRUNNER] and category for grep-ability
 * - Production builds can suppress debug logs via a flag
 *
 * This module is non-blocking and never throws — logging failures are
 * silently swallowed to prevent cascading failures.
 */

import type { LogEntry } from '../shared/architecture-types';

// ── Log Level ──────────────────────────────────────────────

export type LogLevel = LogEntry['level'];

/**
 * Numeric priority for level comparison.
 * Lower number = higher priority (error=0, debug=3).
 */
const LEVEL_PRIORITY: Record<LogLevel, number> = {
  error: 0,
  warn: 1,
  info: 2,
  debug: 3,
};

/**
 * Minimum log level to output.
 * Set to 'debug' in development, 'info' or 'warn' in production.
 */
let minimumLevel: LogLevel = 'debug';

/**
 * Set the minimum log level.
 * Messages below this level are suppressed.
 */
export function setLogLevel(level: LogLevel): void {
  minimumLevel = level;
}

/**
 * Get the current minimum log level.
 */
export function getLogLevel(): LogLevel {
  return minimumLevel;
}

// ── Log Entry Creation ─────────────────────────────────────

/**
 * Create a structured LogEntry.
 */
function createLogEntry(
  level: LogLevel,
  category: string,
  message: string,
  data?: Record<string, unknown>,
): LogEntry {
  return {
    level,
    category,
    message,
    timestamp: new Date().toISOString(),
    ...(data !== undefined && { data }),
  };
}

// ── Logger ─────────────────────────────────────────────────

/**
 * Category-scoped logger.
 *
 * Create one per component for consistent categorization:
 *   const logger = createLogger('recorder');
 *   logger.info('Click captured', { actionId: 'click-001' });
 */
export interface Logger {
  debug(message: string, data?: Record<string, unknown>): void;
  info(message: string, data?: Record<string, unknown>): void;
  warn(message: string, data?: Record<string, unknown>): void;
  error(message: string, data?: Record<string, unknown>): void;
  /** Get the category this logger is scoped to. */
  category: string;
}

/**
 * Create a category-scoped logger.
 *
 * @param category - Component name for log categorization (e.g. 'recorder', 'generation', 'ai').
 * @returns Logger instance.
 */
export function createLogger(category: string): Logger {
  function shouldLog(level: LogLevel): boolean {
    return LEVEL_PRIORITY[level] <= LEVEL_PRIORITY[minimumLevel];
  }

  function emit(level: LogLevel, message: string, data?: Record<string, unknown>): void {
    if (!shouldLog(level)) return;
    const entry = createLogEntry(level, category, message, data);
    output(entry);
  }

  return {
    category,
    debug: (msg, data) => emit('debug', msg, data),
    info: (msg, data) => emit('info', msg, data),
    warn: (msg, data) => emit('warn', msg, data),
    error: (msg, data) => emit('error', msg, data),
  };
}

/**
 * Output a log entry to the console.
 *
 * Uses console.error for errors, console.warn for warnings, console.log otherwise.
 * Prefixes with [CMDRUNNER:category] for grep-ability.
 */
function output(entry: LogEntry): void {
  const prefix = `[CMDRUNNER:${entry.category}]`;

  // Build the console arguments
  const args: unknown[] = [prefix, entry.message];
  if (entry.data) {
    args.push(entry.data);
  }

  try {
    switch (entry.level) {
      case 'error':
        console.error(...args);
        break;
      case 'warn':
        console.warn(...args);
        break;
      case 'info':
        console.info(...args);
        break;
      case 'debug':
        console.debug(...args);
        break;
    }
  } catch {
    // Logging must never throw — swallow errors
  }
}
