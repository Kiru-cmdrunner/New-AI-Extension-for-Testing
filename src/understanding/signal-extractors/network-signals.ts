/**
 * Network Signal Extractor — extracts API-operation signals from
 * NetworkActivity URLs and status codes.
 *
 * Reads the `applicationEvidence.networkActivity[]` array and classifies
 * each request into a semantic API operation type based on URL patterns.
 * Produces outcome hints from HTTP status codes.
 *
 * M9.1: Classification patterns are heuristic and configurable.
 */

import type { ComponentInteraction } from '../../shared/component-types';
import type {
  SignalExtractor,
  Signal,
  ApiOperationSignal,
  ApiOperationType,
  OutcomeHint,
} from '../types';

/**
 * A URL pattern → operation classification rule.
 */
interface NetworkPattern {
  operation: ApiOperationType;
  /** Regex pattern (string form) tested against the full URL. */
  pattern: string;
}

/**
 * Default classification patterns for common API operations.
 * Tested in order — first match wins.
 */
const DEFAULT_NETWORK_PATTERNS: NetworkPattern[] = [
  // ── Search autocomplete ──
  { operation: 'search-autocomplete', pattern: '/suggest' },
  { operation: 'search-autocomplete', pattern: '/autocomplete' },
  { operation: 'search-autocomplete', pattern: '/typeahead' },

  // ── Search ──
  { operation: 'search', pattern: '/search' },
  { operation: 'search', pattern: '/query' },

  // ── Cart operations ──
  { operation: 'add-to-cart', pattern: '/cart/add' },
  { operation: 'add-to-cart', pattern: '/cart.*add' },
  { operation: 'add-to-cart', pattern: '/addToCart' },
  { operation: 'remove-from-cart', pattern: '/cart.*remove' },
  { operation: 'remove-from-cart', pattern: '/removeFromCart' },
  { operation: 'update-cart', pattern: '/cart.*update' },
  { operation: 'update-cart', pattern: '/cart.*quantity' },

  // ── Checkout ──
  { operation: 'checkout', pattern: '/checkout' },
  { operation: 'checkout', pattern: '/payment' },

  // ── Authentication ──
  { operation: 'login', pattern: '/login' },
  { operation: 'login', pattern: '/signin' },
  { operation: 'login', pattern: '/auth' },
  { operation: 'logout', pattern: '/logout' },
  { operation: 'logout', pattern: '/signout' },
  { operation: 'register', pattern: '/register' },
  { operation: 'register', pattern: '/signup' },

  // ── Form submission ──
  { operation: 'submit-form', pattern: '/submit' },
  { operation: 'submit-form', pattern: '/form' },

  // ── Analytics / telemetry (no semantic value for app understanding) ──
  { operation: 'analytics', pattern: '/events/' },
  { operation: 'analytics', pattern: '/batch/' },
  { operation: 'analytics', pattern: '/uedata' },       // Amazon analytics
  { operation: 'analytics', pattern: '/unagi' },         // Amazon telemetry
  { operation: 'analytics', pattern: '/csm' },           // Amazon metrics
  { operation: 'analytics', pattern: '/safeframe' },
  { operation: 'analytics', pattern: '/aax2' },
  { operation: 'analytics', pattern: '/impression' },
  { operation: 'analytics', pattern: '/pixel' },
  { operation: 'analytics', pattern: '/beacon' },
  { operation: 'analytics', pattern: '/track' },
];

/**
 * Static resources — images, fonts, stylesheets, scripts.
 * Classified as 'resource' and given low outcome weight.
 */
const RESOURCE_PATTERNS: RegExp[] = [
  /\.(png|jpg|jpeg|gif|webp|svg|ico)(\?|$)/i,
  /\.(css|js|mjs)(\?|$)/i,
  /\.(woff2?|ttf|eot)(\?|$)/i,
  /\.(mp4|webm|mp3)(\?|$)/i,
];

/**
 * Derive an outcome hint from an HTTP status code.
 */
function deriveOutcomeHint(status: number | null): OutcomeHint | null {
  if (status === null) return null;
  if (status >= 200 && status < 300) {
    return { result: 'success', weight: 0.3, detail: `HTTP ${status}` };
  }
  if (status >= 400 && status < 500) {
    return { result: 'failure', weight: 0.4, detail: `HTTP ${status} (client error)` };
  }
  if (status >= 500) {
    return { result: 'failure', weight: 0.5, detail: `HTTP ${status} (server error)` };
  }
  if (status >= 300 && status < 400) {
    return { result: 'unknown', weight: 0.1, detail: `HTTP ${status} (redirect)` };
  }
  return null;
}

/**
 * Classify a URL into an API operation type.
 */
function classifyUrl(url: string): ApiOperationType {
  // Check resource patterns first
  for (const re of RESOURCE_PATTERNS) {
    if (re.test(url)) return 'resource';
  }

  // Check operation patterns in order
  for (const p of DEFAULT_NETWORK_PATTERNS) {
    const re = new RegExp(p.pattern, 'i');
    if (re.test(url)) return p.operation;
  }

  return 'unknown';
}

export class NetworkSignalExtractor implements SignalExtractor {
  readonly name = 'NetworkSignalExtractor';

  extract(interaction: ComponentInteraction): Signal[] {
    const evidence = interaction.behavioralEvidence;
    if (!evidence) return [];

    const networkEntries = evidence.applicationEvidence.networkActivity;
    if (!networkEntries || networkEntries.length === 0) return [];

    const signals: ApiOperationSignal[] = [];

    for (const entry of networkEntries) {
      const operation = classifyUrl(entry.url);

      // Skip analytics and static resources — they carry no semantic value
      // for application understanding.
      if (operation === 'analytics' || operation === 'resource') continue;

      const outcomeHint = deriveOutcomeHint(entry.status);

      signals.push({
        type: 'api-operation',
        interactionId: interaction.interactionId,
        source: entry.status !== null ? 'network-status' : 'network-url',
        confidence: operation === 'unknown' ? 0.2 : 0.7,
        operation,
        method: entry.method,
        status: entry.status,
        succeeded: entry.status !== null ? (entry.status >= 200 && entry.status < 300) : null,
        url: entry.url,
        outcomeHint,
      });
    }

    return signals;
  }
}
