/**
 * 6B executor-content-script parity pin (reviewer WARN-4 / AC4).
 *
 * executor-content-script.ts is a SELF-INLINED mirror of locator-resolver.ts
 * (content scripts cannot import modules — see its header). This pin keeps
 * the family-tagged TEST_ID contract in sync across the two copies by
 * transpiling the mirror source (esbuild strips TS types) and executing the
 * inlined functions against a jsdom Document.
 *
 * Contract under test (mirrors locator-resolver.ts resolveByTestId):
 *   1. Family-tagged values '[data-<fam>="X"]' resolve the EXACT attribute —
 *      no cross-family fall-through (a decoy on a different family must not
 *      match).
 *   2. Bare values keep the legacy 3-family probe (data-testid → data-cy →
 *      data-qa), unchanged from pre-6B behavior.
 *   3. resolveAllByType('testId') honors the same contract for the
 *      union-of-elements path.
 *   4. extractElementIdentity reports dataAutoId (runtime healing signal).
 *   5. The mirror's family regex uses the SAFE_VALUE charset (no widening).
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as ts from 'typescript';

const EXECUTOR_SRC = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  'src',
  'execution',
  'executor-content-script.ts',
);

/** Transpile the mirror to plain JS and expose its runtime functions. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function loadExecutorFns(doc: Document): any {
  const source = readFileSync(EXECUTOR_SRC, 'utf-8');
  for (const marker of [
    'const TEST_ID_FAMILY_RE',
    'function familyAttrSelector(',
    'function resolveByTestId(',
    'function resolveAllByType(',
    'function extractElementIdentity(',
  ]) {
    if (!source.includes(marker)) {
      throw new Error(`executor-content-script.ts mirror drifted: missing ${marker}`);
    }
  }
  const { outputText: code } = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS },
  });
  // The full module body touches chrome.* at the top level (listener
  // registration). Stub the API surface so the module loads in jsdom.
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  const factory = new Function(
    'doc',
    'exports',
    `const chrome = {
       runtime: { onMessage: { addListener: () => undefined }, id: 'test' },
       storage: { local: { get: async () => ({}) } },
     };
     ${code}\nexports.cssEscape = cssEscape;
     exports.TEST_ID_FAMILY_RE = TEST_ID_FAMILY_RE;
     exports.familyAttrSelector = familyAttrSelector;
     exports.resolveByTestId = resolveByTestId;
     exports.resolveAllByType = resolveAllByType;
     exports.extractElementIdentity = extractElementIdentity;`,
  );
  factory(
    doc,
    exports,
    {
      runtime: { onMessage: { addListener: () => undefined }, id: 'test' },
      storage: { local: { get: async () => ({}) } },
    },
  );
  return exports;
}

function docOf(html: string): Document {
  return new DOMParser().parseFromString(html, 'text/html');
}

describe('6B executor-content-script family parity (AC4)', () => {
  it('family-tagged value resolves the EXACT attribute (no cross-family fall-through)', () => {
    const doc = docOf(
      '<button data-cy="sign-in">Sign in</button><button data-testid="sign-in">Decoy</button>',
    );
    const fns = loadExecutorFns(doc);
    const el = fns.resolveByTestId(doc, '[data-cy="sign-in"]') as HTMLElement | null;
    expect(el).not.toBeNull();
    expect(el?.textContent?.trim()).toBe('Sign in');
  });

  it('family-tagged decoy on a DIFFERENT family never matches', () => {
    const doc = docOf('<button data-qa="sign-in">Only QA</button>');
    const fns = loadExecutorFns(doc);
    expect(fns.resolveByTestId(doc, '[data-cy="sign-in"]')).toBeNull();
  });

  it('data-auto-id family resolves via the tagged path', () => {
    const doc = docOf('<input data-auto-id="from-airport" />');
    const fns = loadExecutorFns(doc);
    expect(fns.resolveByTestId(doc, '[data-auto-id="from-airport"]')).toBeInstanceOf(HTMLElement);
  });

  it('bare value keeps the legacy 3-family probe (testid → cy → qa)', () => {
    const doc = docOf('<button data-qa="legacy-btn">Legacy</button>');
    const fns = loadExecutorFns(doc);
    const el = fns.resolveByTestId(doc, 'legacy-btn') as HTMLElement | null;
    expect(el?.textContent?.trim()).toBe('Legacy');
  });

  it('resolveAllByType(testId) honors the tagged contract without double-counting', () => {
    const doc = docOf(
      '<div><button data-testid="dup">A</button><button data-cy="dup">B</button></div>',
    );
    const fns = loadExecutorFns(doc);
    const tagged = fns.resolveAllByType(doc, { type: 'testId', value: '[data-cy="dup"]' }) as HTMLElement[];
    expect(tagged).toHaveLength(1);
    expect(tagged[0]?.textContent?.trim()).toBe('B');
  });

  it('crafted value with brackets/commas is NOT treated as family-tagged (safe charset)', () => {
    const doc = docOf('<button data-cy="x">A</button>');
    const fns = loadExecutorFns(doc);
    const probe = '[data-cy="x"], body, [data-cy="y"]';
    expect(fns.TEST_ID_FAMILY_RE instanceof RegExp).toBe(true);
    expect((fns.TEST_ID_FAMILY_RE as RegExp).test(probe)).toBe(false);
  });

  it('extractElementIdentity reports dataAutoId (runtime healing signal)', () => {
    const doc = docOf('<input data-auto-id="from-airport" />');
    const fns = loadExecutorFns(doc);
    const el = doc.querySelector('input') as HTMLElement;
    const identity = fns.extractElementIdentity(el) as Record<string, string | null>;
    expect(identity.dataAutoId).toBe('from-airport');
  });
});
