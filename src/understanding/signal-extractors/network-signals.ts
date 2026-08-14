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
import type { NetworkPatternRegistry } from '../domain-config/network-pattern-registry';

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
 *
 * M9.11: When a domain pattern registry is provided, domain patterns are
 * checked FIRST — a domain-specific match wins over built-in defaults.
 * Domain-specific operations that aren't in the built-in union are
 * reported as their string label (the ApiOperationType union remains
 * open for new domains via the registry).
 */
function classifyUrl(url: string, domainRegistry?: NetworkPatternRegistry | null): ApiOperationType | string {
  // Check resource patterns first
  for (const re of RESOURCE_PATTERNS) {
    if (re.test(url)) return 'resource';
  }

  // M9.11: domain patterns take priority over built-in defaults
  if (domainRegistry && domainRegistry.size > 0) {
    const domainOp = domainRegistry.classify(url);
    if (domainOp) return domainOp;
  }

  // Check operation patterns in order
  for (const p of DEFAULT_NETWORK_PATTERNS) {
    const re = new RegExp(p.pattern, 'i');
    if (re.test(url)) return p.operation;
  }

  return 'unknown';
}

/**
 * Patterns for extracting entity hints from request body fields.
 * When a POST body contains these keys, we extract the value as a
 * potential entity identifier.
 */
const ENTITY_HINT_PATTERNS: { field: RegExp; hint: string }[] = [
  { field: /^asin$/i, hint: 'product-id' },
  { field: /^product[_-]?id$/i, hint: 'product-id' },
  { field: /^item[_-]?id$/i, hint: 'product-id' },
  { field: /^sku$/i, hint: 'product-id' },
  { field: /^quantity$/i, hint: 'quantity' },
  { field: /^qty$/i, hint: 'quantity' },
  { field: /^leave[_-]?type$/i, hint: 'leave-type' },
  { field: /^employee[_-]?id$/i, hint: 'employee-id' },
  { field: /^issue[_-]?id$/i, hint: 'issue-id' },
  { field: /^user[_-]?id$/i, hint: 'user-id' },
];

/**
 * Extract entity hints from a parsed request body.
 */
function extractEntityHints(body: Record<string, string>): { field: string; value: string; hint: string }[] {
  const hints: { field: string; value: string; hint: string }[] = [];
  for (const [key, value] of Object.entries(body)) {
    for (const pattern of ENTITY_HINT_PATTERNS) {
      if (pattern.field.test(key)) {
        hints.push({ field: key, value, hint: pattern.hint });
        break;
      }
    }
  }
  return hints;
}

// ── GraphQL operationName extraction (DDC-7) ──────────────────────────

/**
 * Extract a GraphQL operation name from a request body.
 *
 * Handles the two standard shapes:
 *  - { query: "mutation AddToCart($asin:String!){...}", variables: "{...}" }
 *  - { operationName: "AddToCart", query: "..." }
 *  - batched operations: [ { query: "..." }, ... ]
 *
 * Returns `graphql:<Name>` on match, null otherwise. Deterministic — pure
 * regex on the captured body, no inference.
 */
export function extractGraphqlOperation(
  body: Record<string, string> | undefined,
): string | null {
  if (!body) return null;

  // 1. Explicit operationName field (Apollo-style)
  if (typeof body.operationName === 'string' && body.operationName.length > 0) {
    return `graphql:${body.operationName}`;
  }

  // 2. Parse the query/operations string for "mutation|query <Name>"
  const queryStr =
    typeof body.query === 'string' ? body.query :
    typeof body.operations === 'string' ? body.operations :
    null;
  if (queryStr) {
    const m = queryStr.match(/\b(?:mutation|query|subscription)\s+([A-Za-z0-9_]+)/);
    if (m) return `graphql:${m[1]}`;
    // Bare query with no name ("{ cart { items } }") — no name to use
    return null;
  }

  return null;
}

/**
 * Extract entity hints from a GraphQL body's `variables` JSON string.
 * Variables carry the identifiers: { "asin": "B08KGRVW2S", "qty": 1 }.
 */
function extractGraphqlVariableHints(
  body: Record<string, string> | undefined,
): { field: string; value: string; hint: string }[] {
  if (!body) return [];
  const varsStr = typeof body.variables === 'string' ? body.variables : null;
  if (!varsStr) return [];

  let vars: Record<string, unknown>;
  try {
    vars = JSON.parse(varsStr);
  } catch {
    return [];
  }
  if (!vars || typeof vars !== 'object') return [];

  const hints: { field: string; value: string; hint: string }[] = [];
  for (const [key, value] of Object.entries(vars)) {
    if (typeof value !== 'string' && typeof value !== 'number') continue;
    for (const pattern of ENTITY_HINT_PATTERNS) {
      if (pattern.field.test(key)) {
        hints.push({ field: `variables.${key}`, value: String(value), hint: pattern.hint });
        break;
      }
    }
  }
  return hints;
}

export class NetworkSignalExtractor implements SignalExtractor {
  readonly name = 'NetworkSignalExtractor';

  private readonly domainPatternRegistry: NetworkPatternRegistry | null;

  /**
   * @param domainPatternRegistry Optional M9.11 domain pattern registry.
   *   When provided, domain patterns are checked before built-in defaults.
   */
  constructor(domainPatternRegistry?: NetworkPatternRegistry | null) {
    this.domainPatternRegistry = domainPatternRegistry ?? null;
  }

  extract(interaction: ComponentInteraction): Signal[] {
    const evidence = interaction.behavioralEvidence;
    if (!evidence) return [];

    const networkEntries = evidence.applicationEvidence.networkActivity;
    if (!networkEntries || networkEntries.length === 0) return [];

    const signals: ApiOperationSignal[] = [];

    for (const entry of networkEntries) {
      let operation = classifyUrl(entry.url, this.domainPatternRegistry);

      // DDC-7: GraphQL bodies override URL classification — a single
      // /graphql endpoint classifies as 'unknown' for every operation;
      // the operationName carries the actual semantic.
      const graphqlOp = extractGraphqlOperation(entry.requestBody);
      if (graphqlOp) {
        operation = graphqlOp;
      }

      // Skip analytics and static resources — they carry no semantic value
      // for application understanding.
      if (operation === 'analytics' || operation === 'resource') continue;

      const outcomeHint = deriveOutcomeHint(entry.status);

      // Extract entity hints from request body if available
      // (form fields first, GraphQL variables second)
      let entityHints = entry.requestBody ? extractEntityHints(entry.requestBody) : [];
      if (entityHints.length === 0 && entry.requestBody) {
        entityHints = extractGraphqlVariableHints(entry.requestBody);
      }

      signals.push({
        type: 'api-operation',
        interactionId: interaction.interactionId,
        source: entry.status !== null ? 'network-status' : 'network-url',
        confidence:
          graphqlOp ? 0.8 :
          operation === 'unknown' ? 0.2 : 0.7,
        operation,
        method: entry.method,
        status: entry.status,
        succeeded: entry.status !== null ? (entry.status >= 200 && entry.status < 300) : null,
        url: entry.url,
        outcomeHint,
        requestBody: entry.requestBody,
        entityHints: entityHints.length > 0 ? entityHints : undefined,
      });
    }

    return signals;
  }
}
