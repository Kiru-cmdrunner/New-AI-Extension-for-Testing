/**
 * Pipeline Tracer — Runtime Traceability
 *
 * LEARNING 5 (Runtime Traceability): The previous implementation had no way
 * to debug the flow of events through the pipeline. This tracer logs every
 * event's journey through all layers, making it visible in:
 *   1. The browser DevTools console (structured, color-coded)
 *   2. Stored for the side panel to display (if trace UI is built)
 *
 * Each layer stamps a TraceEntry with:
 *   - Layer name
 *   - Input (what it received)
 *   - Output (what it produced)
 *   - Decision (why it made the choice it did)
 *   - Duration
 */

import type { TraceEntry, TraceLevel, TraceLayer } from './canonical-event-schema';

// ── Pipeline Tracer ─────────────────────────────────────────────────────

export class PipelineTracer {
  private entries: TraceEntry[] = [];
  private level: TraceLevel = 'normal';
  private readonly maxEntries: number;

  constructor(level: TraceLevel = 'normal', maxEntries = 500) {
    this.level = level;
    this.maxEntries = maxEntries;
  }

  /**
   * Set the trace level.
   */
  setLevel(level: TraceLevel): void {
    this.level = level;
  }

  /**
   * Trace a layer's processing.
   *
   * @param layer     Which layer is tracing
   * @param action    What action the layer performed
   * @param input     What the layer received (stringified)
   * @param output    What the layer produced (stringified)
   * @param durationMs How long the processing took
   * @param decision  Optional: why the layer made its choice
   * @param eventId   Optional: the event ID being processed
   * @param unitId    Optional: the interaction unit ID
   */
  trace(
    layer: TraceLayer,
    action: string,
    input: string,
    output: string,
    durationMs: number,
    decision?: string,
    eventId?: string,
    unitId?: string,
  ): void {
    if (this.level === 'off') return;

    const entry: TraceEntry = {
      timestamp: new Date().toISOString(),
      layer,
      action,
      input,
      output,
      durationMs,
      decision,
      eventId,
      unitId,
    };

    this.entries.push(entry);

    // Trim if exceeding max
    if (this.entries.length > this.maxEntries) {
      this.entries = this.entries.slice(-this.maxEntries);
    }

    // Log to console with color coding
    if (this.level !== 'errors-only') {
      this.logToConsole(entry);
    }
  }

  /**
   * Get all trace entries (for the side panel or debugging).
   */
  getEntries(): TraceEntry[] {
    return [...this.entries];
  }

  /**
   * Get entries for a specific event or unit.
   */
  getEntriesForTarget(eventId?: string, unitId?: string): TraceEntry[] {
    return this.entries.filter(
      (e) =>
        (eventId && e.eventId === eventId) ||
        (unitId && e.unitId === unitId),
    );
  }

  /**
   * Clear all trace entries.
   */
  clear(): void {
    this.entries = [];
  }

  /**
   * Get the current trace level.
   */
  getLevel(): TraceLevel {
    return this.level;
  }

  // ── Console Logging ────────────────────────────────────────────────

  private logToConsole(entry: TraceEntry): void {
    const styles = this.getStylesForLayer(entry.layer);
    const prefix = `%c[PipelineV2:${entry.layer}]`;
    const message = `${entry.action} (${entry.durationMs}ms)${entry.decision ? ` → ${entry.decision}` : ''}`;

    if (this.level === 'verbose') {
      console.groupCollapsed(prefix, styles.style, message);
      console.log('Input:', entry.input);
      console.log('Output:', entry.output);
      if (entry.eventId) console.log('Event:', entry.eventId);
      if (entry.unitId) console.log('Unit:', entry.unitId);
      console.groupEnd();
    } else {
      console.log(prefix, styles.style, message);
    }
  }

  private getStylesForLayer(layer: TraceLayer): { style: string } {
    const colors: Record<TraceLayer, string> = {
      'event-capture': 'color: #3b82f6',      // blue
      'boundary-detection': 'color: #8b5cf6', // purple
      'state-diff': 'color: #10b981',         // green
      'pattern-registry': 'color: #f59e0b',   // amber
      'interaction-assembler': 'color: #06b6d4', // cyan
      'intent-resolver': 'color: #ec4899',    // pink
      'pipeline-output': 'color: #6366f1',    // indigo
    };
    return { style: colors[layer] || 'color: inherit' };
  }
}

/**
 * Singleton tracer instance.
 * Used by all pipeline layers.
 */
let globalTracer: PipelineTracer | null = null;

export function getTracer(): PipelineTracer {
  if (!globalTracer) {
    globalTracer = new PipelineTracer();
  }
  return globalTracer;
}

export function setTracer(tracer: PipelineTracer): void {
  globalTracer = tracer;
}

export function resetTracer(): void {
  if (globalTracer) {
    globalTracer.clear();
  }
}
