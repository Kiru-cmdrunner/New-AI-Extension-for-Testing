/**
 * Playwright Page Object Renderer — Milestone 5
 *
 * Generates Page Object Model classes from an ExecutionIRPlan.
 * Groups elements by `pageOrComponent` and produces one class per group
 * with locator getters and action methods.
 *
 * Follows the official Playwright POM pattern (playwright.dev/docs/pom):
 *   - Page Object encapsulates interaction details (locators + actions)
 *   - Tests import page objects, instantiate them, call methods
 *   - Assertions stay in the test using page object locator getters
 *
 * Reference: execution-ir-design.md §7 (POM deferred but architected for)
 */

import type {
  ExecutionIRPlan,
  IRStep,
  IRAssertion,
  ElementTarget,
  ResolvedLocator,
} from '../../domain/execution-ir/types';
import { IRAction } from '../../domain/execution-ir/types';
import { renderLocator } from './locator-renderer';

// ── Types ─────────────────────────────────────────────────

/**
 * A page object to be generated. One per unique pageOrComponent value.
 */
export interface PageObjectModel {
  /** The pageOrComponent string from the IR (e.g., "LoginPage"). */
  readonly pageName: string;
  /** Slugified filename (e.g., "login-page.ts"). */
  readonly fileName: string;
  /** Class name (e.g., "LoginPage"). */
  readonly className: string;
  /** Unique elements on this page (for locator getters). */
  readonly elements: PageElement[];
  /** Action methods for this page. */
  readonly methods: PageObjectMethod[];
}

export interface PageElement {
  readonly elementId: string;
  readonly elementName: string;
  readonly locators: ResolvedLocator[];
  /** Getter name (e.g., "emailInput"). */
  readonly getterName: string;
}

export interface PageObjectMethod {
  /** Method name (e.g., "fillEmail"). */
  readonly methodName: string;
  readonly action: IRAction;
  /** Element this method acts on. */
  readonly elementGetter: string;
  /** Parameter declarations (e.g., "value: string" or ""). */
  readonly params: string;
  /** Body code (without async/await wrapper). */
  readonly body: string;
}

// ── Main Entry Point ──────────────────────────────────────

/**
 * Build page object models from an IR plan.
 * Groups all element-interacting steps + assertion elements by pageOrComponent.
 */
export function buildPageObjects(plan: ExecutionIRPlan): PageObjectModel[] {
  const pageMap = new Map<string, {
    elements: Map<string, PageElement>;
    methods: PageObjectMethod[];
    /** Dedup key set: `${action}:${elementGetter}` to prevent duplicate methods. */
    methodKeys: Set<string>;
  }>();

  // Scan steps for elements and actions
  for (const step of plan.steps) {
    // Register element targets and generate action methods
    if (step.target.kind === 'element') {
      const target = step.target;
      const pageName = target.pageOrComponent;

      if (!pageMap.has(pageName)) {
        pageMap.set(pageName, { elements: new Map(), methods: [], methodKeys: new Set() });
      }
      const pageData = pageMap.get(pageName)!;

      // Register element for locator getter
      if (!pageData.elements.has(target.elementId)) {
        pageData.elements.set(target.elementId, {
          elementId: target.elementId,
          elementName: target.elementName,
          locators: target.resolvedLocators,
          getterName: elementGetterName(target.elementName),
        });
      }

      // Generate action method for element-interacting steps (deduplicated)
      if (isElementInteractingAction(step.action)) {
        const method = buildMethod(step.action, target, step.input);
        if (method) {
          const dedupKey = `${step.action}:${method.elementGetter}`;
          if (!pageData.methodKeys.has(dedupKey)) {
            pageData.methodKeys.add(dedupKey);
            pageData.methods.push(method);
          }
        }
      }
    }

    // Register elements from assertions on ALL steps (including NAVIGATE/WAIT)
    for (const assertion of step.assertions) {
      registerAssertionElements(assertion, pageMap);
    }
  }

  // Convert to PageObjectModel[]
  return Array.from(pageMap.entries()).map(([pageName, data]) => ({
    pageName,
    fileName: pageFileName(pageName),
    className: pageClassName(pageName),
    elements: Array.from(data.elements.values()),
    methods: data.methods,
  }));
}

/**
 * Register elements referenced in assertions into the page map
 * (they need locator getters even though they have no action method).
 */
function registerAssertionElements(
  assertion: IRAssertion,
  pageMap: Map<string, {
    elements: Map<string, PageElement>;
    methods: PageObjectMethod[];
    methodKeys: Set<string>;
  }>,
): void {
  if (assertion.target.kind !== 'element') return;
  const target = assertion.target;
  const pageName = target.pageOrComponent;

  if (!pageMap.has(pageName)) {
    pageMap.set(pageName, { elements: new Map(), methods: [], methodKeys: new Set() });
  }
  const pageData = pageMap.get(pageName)!;

  if (!pageData.elements.has(target.elementId)) {
    pageData.elements.set(target.elementId, {
      elementId: target.elementId,
      elementName: target.elementName,
      locators: target.resolvedLocators,
      getterName: elementGetterName(target.elementName),
    });
  }
}

// ── Class Rendering ───────────────────────────────────────

/**
 * Render a Page Object Model to a complete .ts file.
 *
 * Output format follows playwright.dev/docs/pom:
 *   import { Page, Locator } from '@playwright/test';
 *
 *   export class LoginPage {
 *     readonly page: Page;
 *
 *     constructor(page: Page) {
 *       this.page = page;
 *     }
 *
 *     // ── Locators ──
 *     get emailInput(): Locator {
 *       return this.page.getByRole('textbox', { name: 'Email' });
 *     }
 *
 *     // ── Actions ──
 *     async fillEmail(value: string): Promise<void> {
 *       await this.emailInput.fill(value);
 *     }
 *   }
 */
export function renderPageObject(pom: PageObjectModel): string {
  const lines: string[] = [];

  // Import
  lines.push("import { Page, Locator } from '@playwright/test';");
  lines.push('');

  // Class declaration
  lines.push(`export class ${pom.className} {`);
  lines.push('  readonly page: Page;');
  lines.push('');
  lines.push('  constructor(page: Page) {');
  lines.push('    this.page = page;');
  lines.push('  }');

  // Locator getters
  if (pom.elements.length > 0) {
    lines.push('');
    lines.push('  // ── Locators ──');
    for (const element of pom.elements) {
      lines.push('');
      lines.push(`  get ${element.getterName}(): Locator {`);
      const rendered = renderLocator(element.locators, 'this.page');
      lines.push(`    return ${rendered.pageRef}.${rendered.expression};`);
      lines.push('  }');
    }
  }

  // Action methods
  if (pom.methods.length > 0) {
    lines.push('');
    lines.push('  // ── Actions ──');
    for (const method of pom.methods) {
      lines.push('');
      const paramsStr = method.params ? `${method.params}` : '';
      lines.push(`  async ${method.methodName}(${paramsStr}): Promise<void> {`);
      lines.push(`    ${method.body}`);
      lines.push('  }');
    }
  }

  lines.push('}');
  lines.push(''); // trailing newline

  return lines.join('\n');
}

/**
 * Render all page objects and return as GeneratedFile entries.
 */
export function renderPageObjectFiles(plan: ExecutionIRPlan): Array<{
  path: string;
  content: string;
}> {
  const poms = buildPageObjects(plan);
  return poms.map(pom => ({
    path: `pages/${pom.fileName}`,
    content: renderPageObject(pom),
  }));
}

// ── Method Building ───────────────────────────────────────

/**
 * Determine if an action interacts with a DOM element.
 */
function isElementInteractingAction(action: IRAction): boolean {
  return action === IRAction.CLICK
    || action === IRAction.FILL
    || action === IRAction.SELECT
    || action === IRAction.SELECT_DATE
    || action === IRAction.TOGGLE
    || action === IRAction.HOVER;
}

/**
 * Compose a method name from an action verb and an element name.
 *
 * Strips known suffixes from the element name, then deduplicates when
 * the verb already contains the stripped name — e.g. `setDate` +
 * `DatePicker` (→ `Date`) produces `setDate`, not `setDateDate`.
 * When the stripped name IS the verb (e.g. `toggle` + `Toggle`),
 * both are kept to avoid a generic bare-verb method name.
 */
function buildMethodName(verb: string, elementName: string): string {
  const stripped = stripSuffix(toPascalCase(elementName));
  // If the verb is longer than the stripped name and ends with it,
  // the name is already embedded in the verb (setDate + Date).
  if (
    stripped.length > 0 &&
    stripped.length < verb.length &&
    verb.toLowerCase().endsWith(stripped.toLowerCase())
  ) {
    return verb;
  }
  return verb + stripped;
}

/**
 * Build a PageObjectMethod for a step's action.
 */
function buildMethod(
  action: IRAction,
  target: ElementTarget,
  input: IRStep['input'],
): PageObjectMethod | null {
  const getter = elementGetterName(target.elementName);

  switch (action) {
    case IRAction.CLICK:
      return {
        methodName: buildMethodName('click', target.elementName),
        action,
        elementGetter: getter,
        params: '',
        body: `await this.${getter}.click()`,
      };

    case IRAction.FILL:
      return {
        methodName: buildMethodName('fill', target.elementName),
        action,
        elementGetter: getter,
        params: 'value: string',
        body: `await this.${getter}.fill(value)`,
      };

    case IRAction.SELECT:
      return {
        methodName: buildMethodName('select', target.elementName),
        action,
        elementGetter: getter,
        params: 'value: string',
        body: `await this.${getter}.selectOption(value)`,
      };

    case IRAction.SELECT_DATE:
      return {
        methodName: buildMethodName('setDate', target.elementName),
        action,
        elementGetter: getter,
        params: 'date: string',
        body: `await this.${getter}.fill(date)`,
      };

    case IRAction.TOGGLE:
      if (input === true) {
        return {
          methodName: buildMethodName('check', target.elementName),
          action,
          elementGetter: getter,
          params: '',
          body: `await this.${getter}.check()`,
        };
      }
      if (input === false) {
        return {
          methodName: buildMethodName('uncheck', target.elementName),
          action,
          elementGetter: getter,
          params: '',
          body: `await this.${getter}.uncheck()`,
        };
      }
      // null input = literal toggle
      return {
        methodName: buildMethodName('toggle', target.elementName),
        action,
        elementGetter: getter,
        params: '',
        body: `await this.${getter}.click()`,
      };

    case IRAction.HOVER:
      return {
        methodName: buildMethodName('hover', target.elementName),
        action,
        elementGetter: getter,
        params: '',
        body: `await this.${getter}.hover()`,
      };

    default:
      return null;
  }
}

// ── Naming Helpers ────────────────────────────────────────

/** Suffixes stripped from element names for method naming. */
const STRIP_SUFFIXES = [
  'Input', 'Button', 'Checkbox', 'Radio', 'Dropdown',
  'Field', 'Element', 'Item', 'Select', 'Text',
  'Menu', 'Link', 'Switch', 'Picker',
];

/**
 * Convert an element name to a getter name.
 * "Email Input" → "emailInput"
 * "Sign In Button" → "signInButton"
 */
function elementGetterName(elementName: string): string {
  return toCamelCase(elementName);
}

/**
 * Convert a page name to a class name.
 * "LoginPage" → "LoginPage" (already PascalCase)
 * "login page" → "LoginPage"
 */
function pageClassName(pageName: string): string {
  // If already PascalCase (no spaces), use as-is
  if (!pageName.includes(' ') && /^[A-Z]/.test(pageName)) {
    return pageName;
  }
  return toPascalCase(pageName);
}

/**
 * Convert a page name to a slugified filename.
 * "LoginPage" → "login-page.ts"
 * "login page" → "login-page.ts"
 */
function pageFileName(pageName: string): string {
  return pageName
    .replace(/([A-Z])/g, '-$1')
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/^-+|-+$/g, '')
    .replace(/-+/g, '-')
    + '.ts';
}

/**
 * Strip known suffixes from an element name for method naming.
 * "EmailInput" → "Email"
 * "SignInButton" → "SignIn"
 */
function stripSuffix(pascalName: string): string {
  for (const suffix of STRIP_SUFFIXES) {
    if (pascalName.endsWith(suffix) && pascalName.length > suffix.length) {
      return pascalName.slice(0, -suffix.length);
    }
  }
  return pascalName;
}

/**
 * Convert "Email Input" → "emailInput" (camelCase)
 */
function toCamelCase(str: string): string {
  const pascal = toPascalCase(str);
  return pascal.charAt(0).toLowerCase() + pascal.slice(1);
}

/**
 * Convert "email input" → "EmailInput" (PascalCase)
 * Convert "Sign In Button" → "SignInButton"
 */
function toPascalCase(str: string): string {
  return str
    .split(/\s+/)
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join('');
}
