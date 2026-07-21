/**
 * AI Understanding — prompt building and response parsing for the
 * AI element-understanding pipeline.
 *
 * v2.2.0 — Interaction Engine Reset
 * v7.1.0 — Architecture C Phase 6: added semantic prompt bridge
 *
 * The 24 type-specific optional fields have been removed from
 * ActionElementInfo. The interface is now minimal — interaction types
 * will extend it as they are introduced.
 *
 * parseUnderstandingResponse() is pure infrastructure and is preserved.
 *
 * Phase 6 bridge functions (buildSemanticPrompt / parseIntentResponse)
 * re-export the Architecture C semantic prompt builder and intent response
 * parser from ai-observer.ts, so callers that already import from
 * ai-understanding.ts can access the enhanced capabilities.
 */

import { AIUnderstanding } from '../shared/types';
// Re-export the Architecture C Phase 6 implementations.
// buildSemanticPrompt(SnapshotForAI) builds the semantic prompt (no selectors).
// parseIntentResponse(string) parses the LLM JSON response into AIIntentResult.
export { buildAIPrompt as buildSemanticPrompt, parseAIResponse as parseIntentResponse } from './ai-observer';

/** Element info sent to the AI for understanding. */
export interface ActionElementInfo {
  actionType: string;
  text: string;
  tag: string;
  role: string | null;
  className: string | null;
}

/**
 * Build the AI prompt for understanding a UI element interaction.
 *
 * In v2.2.0 with no registered interaction types, this returns a
 * generic prompt. Each interaction type will register its own builder.
 *
 * ICON AWARENESS: Modern web apps use <i>, <svg>, and <span> elements
 * for icons (FontAwesome, Material Icons, Bootstrap Icons), NOT for
 * italic text. The prompt explicitly guides the LLM to recognize icon
 * classes so it doesn't misclassify icons as text formatting.
 */
export function buildUnderstandingPrompt(info: ActionElementInfo): string {
  const lines: string[] = [];
  lines.push(`Element: ${info.text}`);
  lines.push(`HTML tag: ${info.tag}`);
  if (info.role) {
    lines.push(`ARIA role: ${info.role}`);
  }
  if (info.className) {
    lines.push(`CSS classes: ${info.className}`);
  }

  // Icon-specific guidance when the element is likely an icon
  const isIconTag = ['I', 'SVG', 'PATH', 'SPAN'].includes(info.tag.toUpperCase());
  const hasIconClass = info.className && (
    /\b(fa|fas|far|fab|fal|fad|material-icons|material-symbols|bi-|glyphicon|icon|oi)\b/i.test(info.className)
  );

  if (isIconTag || hasIconClass) {
    lines.push('');
    lines.push('IMPORTANT: In modern web development, <i>, <svg>, and <span> elements are');
    lines.push('commonly used for ICONS (not italic text). Icon libraries include FontAwesome');
    lines.push('(fa, fas, far), Material Icons (material-icons), Bootstrap Icons (bi-),');
    lines.push('and others. CSS classes like "fa-chevron-down", "material-icons", "icon-arrow"');
    lines.push('indicate an icon, NOT text formatting.');
    lines.push('');
    lines.push('Determine what icon this is from its CSS classes, and name it accordingly.');
    lines.push('For example: "Search Icon", "Dropdown Arrow", "Close Button", "Calendar Icon".');
  }

  lines.push('');
  lines.push('Analyze this UI element and determine its purpose.');
  lines.push('');
  lines.push('Respond with ONLY a JSON object (no markdown, no code blocks) with these fields:');
  lines.push('  - businessName: a clear, human-readable name for this element');
  lines.push('  - controlType: the UI control type');
  lines.push('  - userIntent: what the user is trying to accomplish');
  lines.push('  - confidenceScore: your confidence (0.0 to 1.0)');
  return lines.join('\n');
}

/**
 * Parse the AI response into an AIUnderstanding object.
 * Handles JSON wrapped in markdown code blocks.
 */
export function parseUnderstandingResponse(response: string): AIUnderstanding {
  // Strip markdown code block if present
  let cleaned = response.trim();
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```(?:json)?\s*/, '').replace(/\s*```$/, '');
  }

  const data = JSON.parse(cleaned);

  let confidence = typeof data.confidenceScore === 'number' ? data.confidenceScore : 0.5;
  confidence = Math.max(0, Math.min(1, confidence));

  return {
    businessName: String(data.businessName ?? 'Unknown'),
    controlType: String(data.controlType ?? 'Unknown'),
    userIntent: String(data.userIntent ?? 'Unknown'),
    confidenceScore: confidence,
  };
}
