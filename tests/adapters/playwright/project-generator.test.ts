/**
 * Project Generator Tests — Milestone 4
 *
 * Tests that the project generator produces a complete, production-quality
 * Playwright project from an ExecutionIRPlan.
 */
import { describe, it, expect } from 'vitest';
import {
  PlaywrightCodeGenerator,
  buildProjectFiles,
  buildPackageJson,
  buildPlaywrightConfig,
  buildTsConfig,
  buildGitIgnore,
  buildTestSpec,
  slugify,
} from '../../../src/adapters/playwright/project-generator';
import type { ExecutionIRPlan } from '../../../src/domain/execution-ir/types';
import { IRAction, DEFAULT_EXECUTION_PARAMETERS } from '../../../src/domain/execution-ir/types';
import { LocatorStrategyType } from '../../../src/domain/enums';
import { ALL_REFERENCE_PLANS } from '../../../src/adapters/playwright/__fixtures__/reference-ir-plans';

// ── Fixtures ──────────────────────────────────────────────

function makeLocator(type: LocatorStrategyType, value: string, priority = 1) {
  return { type, value, priority, confidence: 0.9 };
}

function makePlan(
  title = 'Login Flow',
  browser: 'chrome' | 'firefox' | 'safari' | 'edge' = 'chrome',
): ExecutionIRPlan {
  return {
    testCaseId: 'tc-1',
    testCaseVersionId: 'tcv-1',
    testCaseVersionNumber: 1,
    title,
    tags: ['auth'],
    environment: {
      baseUrl: 'https://staging.example.com',
      browser,
      viewport: { width: 1440, height: 900 },
    },
    steps: [
      {
        id: 'step-1',
        order: 0,
        action: IRAction.NAVIGATE,
        description: 'Navigate to login page',
        target: { kind: 'url', url: 'https://staging.example.com/login' },
        input: null,
        assertions: [],
        executionParameters: { ...DEFAULT_EXECUTION_PARAMETERS },
      },
      {
        id: 'step-2',
        order: 1,
        action: IRAction.FILL,
        description: 'Enter email',
        target: {
          kind: 'element',
          elementId: 'elm-email',
          elementName: 'Email Input',
          pageOrComponent: 'LoginPage',
          resolvedLocators: [makeLocator(LocatorStrategyType.ROLE, 'textbox[name="Email"]')],
        },
        input: 'john@example.com',
        assertions: [],
        executionParameters: { ...DEFAULT_EXECUTION_PARAMETERS },
      },
    ],
  };
}

const defaultConfig = {
  language: 'typescript' as const,
  pattern: 'flat' as const,
  assertions: 'expect' as const,
};

// ── slugify ───────────────────────────────────────────────

describe('slugify', () => {
  it('lowercases and hyphenates', () => {
    expect(slugify('Login Flow')).toBe('login-flow');
  });

  it('handles special characters', () => {
    expect(slugify("User's Registration!")).toBe('user-s-registration');
  });

  it('handles numbers', () => {
    expect(slugify('Order #123')).toBe('order-123');
  });

  it('handles empty string', () => {
    expect(slugify('')).toBe('');
  });
});

// ── Structure ─────────────────────────────────────────────

describe('project structure', () => {
  it('generates exactly 5 files', () => {
    const files = buildProjectFiles(makePlan());
    expect(files).toHaveLength(5);
  });

  it('has correct file paths', () => {
    const files = buildProjectFiles(makePlan());
    const paths = files.map(f => f.path);
    expect(paths).toContain('package.json');
    expect(paths).toContain('playwright.config.ts');
    expect(paths).toContain('tsconfig.json');
    expect(paths).toContain('.gitignore');
    expect(paths).toContain('tests/login-flow.spec.ts');
  });

  it('all files have non-empty content', () => {
    const files = buildProjectFiles(makePlan());
    for (const file of files) {
      expect(file.content.length).toBeGreaterThan(0);
    }
  });
});

// ── package.json ──────────────────────────────────────────

describe('package.json', () => {
  const pkg = buildPackageJson(makePlan());

  it('is valid JSON', () => {
    expect(() => JSON.parse(pkg.content)).not.toThrow();
  });

  it('has @playwright/test devDependency', () => {
    const json = JSON.parse(pkg.content);
    expect(json.devDependencies).toBeDefined();
    expect(json.devDependencies['@playwright/test']).toBeDefined();
    expect(json.devDependencies['@playwright/test']).toMatch(/^\^/);
  });

  it('has test script', () => {
    const json = JSON.parse(pkg.content);
    expect(json.scripts.test).toBe('npx playwright test');
  });

  it('has headed and ui scripts', () => {
    const json = JSON.parse(pkg.content);
    expect(json.scripts['test:headed']).toContain('--headed');
    expect(json.scripts['test:ui']).toContain('--ui');
  });

  it('has report script', () => {
    const json = JSON.parse(pkg.content);
    expect(json.scripts.report).toContain('show-report');
  });

  it('is private', () => {
    const json = JSON.parse(pkg.content);
    expect(json.private).toBe(true);
  });

  it('name is slugified from title', () => {
    const json = JSON.parse(pkg.content);
    expect(json.name).toBe('login-flow');
  });

  it('has no runtime dependencies', () => {
    const json = JSON.parse(pkg.content);
    expect(json.dependencies).toBeUndefined();
  });
});

// ── playwright.config.ts ──────────────────────────────────

describe('playwright.config.ts', () => {
  const config = buildPlaywrightConfig(makePlan());

  it('imports defineConfig and devices', () => {
    expect(config.content).toContain('import { defineConfig, devices }');
  });

  it('uses defineConfig', () => {
    expect(config.content).toContain('export default defineConfig(');
  });

  it('has testDir pointing to ./tests', () => {
    expect(config.content).toContain("testDir: './tests'");
  });

  it('has fullyParallel true', () => {
    expect(config.content).toContain('fullyParallel: true');
  });

  it('has forbidOnly with CI check', () => {
    expect(config.content).toContain('forbidOnly: !!process.env.CI');
  });

  it('has CI-aware retries', () => {
    expect(config.content).toContain('retries: process.env.CI ? 2 : 0');
  });

  it('has CI-aware workers', () => {
    expect(config.content).toContain('workers: process.env.CI ? 1 : undefined');
  });

  it('has html reporter', () => {
    expect(config.content).toContain("reporter: 'html'");
  });

  it('has baseURL from environment', () => {
    expect(config.content).toContain('baseURL: \'https://staging.example.com\'');
  });

  it('has viewport from environment', () => {
    expect(config.content).toContain('viewport: { width: 1440, height: 900 }');
  });

  it('has trace on first retry', () => {
    expect(config.content).toContain("trace: 'on-first-retry'");
  });

  it('has chromium project for chrome browser', () => {
    expect(config.content).toContain("name: 'chromium'");
    expect(config.content).toContain("devices['Desktop Chrome']");
  });

  it('has firefox project for firefox browser', () => {
    const config = buildPlaywrightConfig(makePlan('Test', 'firefox'));
    expect(config.content).toContain("name: 'firefox'");
    expect(config.content).toContain("devices['Desktop Firefox']");
  });

  it('has webkit project for safari browser', () => {
    const config = buildPlaywrightConfig(makePlan('Test', 'safari'));
    expect(config.content).toContain("name: 'webkit'");
    expect(config.content).toContain("devices['Desktop Safari']");
  });

  it('has msedge project for edge browser', () => {
    const config = buildPlaywrightConfig(makePlan('Test', 'edge'));
    expect(config.content).toContain("name: 'msedge'");
    expect(config.content).toContain("devices['Desktop Edge']");
  });
});

// ── tsconfig.json ─────────────────────────────────────────

describe('tsconfig.json', () => {
  const tsconfig = buildTsConfig();

  it('is valid JSON', () => {
    expect(() => JSON.parse(tsconfig.content)).not.toThrow();
  });

  it('has ES2020 target', () => {
    const json = JSON.parse(tsconfig.content);
    expect(json.compilerOptions.target).toBe('ES2020');
  });

  it('has strict mode', () => {
    const json = JSON.parse(tsconfig.content);
    expect(json.compilerOptions.strict).toBe(true);
  });

  it('includes tests directory', () => {
    const json = JSON.parse(tsconfig.content);
    expect(json.include).toContain('tests/**/*.ts');
  });

  it('has esModuleInterop', () => {
    const json = JSON.parse(tsconfig.content);
    expect(json.compilerOptions.esModuleInterop).toBe(true);
  });
});

// ── .gitignore ────────────────────────────────────────────

describe('.gitignore', () => {
  const gitignore = buildGitIgnore();

  it('ignores node_modules', () => {
    expect(gitignore.content).toContain('node_modules/');
  });

  it('ignores test-results', () => {
    expect(gitignore.content).toContain('test-results/');
  });

  it('ignores playwright-report', () => {
    expect(gitignore.content).toContain('playwright-report/');
  });

  it('ignores playwright cache', () => {
    expect(gitignore.content).toContain('playwright/.cache/');
  });
});

// ── Test Spec File ────────────────────────────────────────

describe('test spec file', () => {
  const spec = buildTestSpec(makePlan());

  it('has slugified filename', () => {
    expect(spec.path).toBe('tests/login-flow.spec.ts');
  });

  it('contains the M3 test function output', () => {
    expect(spec.content).toContain("import { test, expect }");
    expect(spec.content).toContain("test.describe(");
    expect(spec.content).toContain("test(");
  });

  it('contains awaited actions', () => {
    expect(spec.content).toContain('await page.goto');
  });
});

// ── PlaywrightCodeGenerator (interface implementation) ────

describe('PlaywrightCodeGenerator', () => {
  it('implements IRCodeGenerator interface', async () => {
    const gen = new PlaywrightCodeGenerator();
    const result = await gen.generate(makePlan(), defaultConfig);

    expect(result.files).toHaveLength(5);
    expect(result.projectMetadata.engine).toBe('playwright');
    expect(result.projectMetadata.language).toBe('typescript');
    expect(result.projectMetadata.pattern).toBe('flat');
    expect(result.projectMetadata.fileCount).toBe(5);
  });

  it('returns a Promise (async)', () => {
    const gen = new PlaywrightCodeGenerator();
    const result = gen.generate(makePlan(), defaultConfig);
    expect(result).toBeInstanceOf(Promise);
  });
});

// ── Reference Plan Coverage ───────────────────────────────

describe('reference plan coverage', () => {
  for (const entry of ALL_REFERENCE_PLANS) {
    it(`generates complete project for "${entry.name}"`, () => {
      const plan = entry.factory();
      const files = buildProjectFiles(plan);

      // Must have 5 files
      expect(files).toHaveLength(5);

      // All must have non-empty content
      for (const file of files) {
        expect(file.content.length).toBeGreaterThan(0);
      }

      // package.json must be valid JSON
      const pkgFile = files.find(f => f.path === 'package.json')!;
      expect(() => JSON.parse(pkgFile.content)).not.toThrow();

      // tsconfig.json must be valid JSON
      const tsFile = files.find(f => f.path === 'tsconfig.json')!;
      expect(() => JSON.parse(tsFile.content)).not.toThrow();

      // Config must have testDir
      const configFile = files.find(f => f.path === 'playwright.config.ts')!;
      expect(configFile.content).toContain("testDir: './tests'");

      // Test spec must have imports
      const specFile = files.find(f => f.path.startsWith('tests/'))!;
      expect(specFile.content).toContain("import { test, expect }");
    });
  }
});

// ── Production Quality ────────────────────────────────────

describe('production quality', () => {
  it('generated config follows Playwright best practices', () => {
    const files = buildProjectFiles(makePlan());
    const config = files.find(f => f.path === 'playwright.config.ts')!;

    // Check all official best-practice settings from playwright.dev/docs/best-practices
    expect(config.content).toContain('fullyParallel');
    expect(config.content).toContain('forbidOnly');
    expect(config.content).toContain('retries');
    expect(config.content).toContain('trace');
    expect(config.content).toContain('reporter');
  });

  it('package.json has no unnecessary dependencies', () => {
    const files = buildProjectFiles(makePlan());
    const pkg = JSON.parse(files.find(f => f.path === 'package.json')!.content);
    const depCount = Object.keys(pkg.devDependencies).length;
    expect(depCount).toBe(1); // Only @playwright/test
  });

  it('no hardcoded URLs beyond IR-provided values', () => {
    const plan: ExecutionIRPlan = {
      ...makePlan(),
      environment: { ...makePlan().environment, baseUrl: 'https://custom-app.example.com' },
    };
    const files = buildProjectFiles(plan);
    const config = files.find(f => f.path === 'playwright.config.ts')!.content;

    expect(config).toContain('https://custom-app.example.com');
  });

  it('test spec is generated from the M3 renderer', () => {
    const plan = makePlan('Complex Flow');
    const files = buildProjectFiles(plan);
    const spec = files.find(f => f.path === 'tests/complex-flow.spec.ts')!;

    // Should contain the describe block with plan title
    expect(spec.content).toContain('Complex Flow');
    // Should contain step descriptions as comments
    expect(spec.content).toContain('// Navigate to login page');
  });

  it('escapes star-slash in plan title for JSDoc safety', () => {
    const plan = makePlan('Evil */ var x = 1; /* Test');
    const files = buildProjectFiles(plan);
    const config = files.find(f => f.path === 'playwright.config.ts')!.content;

    // The raw star-slash sequence should NOT appear in the config
    expect(config).not.toContain('Evil */');
    // The escaped version should be present
    expect(config).toContain('*\\/');
  });
});

// ── POM Mode (Milestone 5) ───────────────────────────────

describe('POM mode (page-object pattern)', () => {
  const pomConfig = {
    language: 'typescript' as const,
    pattern: 'page-object' as const,
    assertions: 'expect' as const,
  };

  it('generates more than 5 files (includes page objects)', () => {
    const files = buildProjectFiles(makePlan(), pomConfig);
    expect(files.length).toBeGreaterThan(5);
  });

  it('has pages/ directory with .ts files', () => {
    const files = buildProjectFiles(makePlan(), pomConfig);
    const pageFiles = files.filter(f => f.path.startsWith('pages/'));
    expect(pageFiles.length).toBeGreaterThan(0);
    expect(pageFiles.every(f => f.path.endsWith('.ts'))).toBe(true);
  });

  it('test file imports page object classes', () => {
    const files = buildProjectFiles(makePlan(), pomConfig);
    const spec = files.find(f => f.path.startsWith('tests/'))!;
    expect(spec.content).toContain("import {");
    expect(spec.content).toContain("} from '../pages/");
  });

  it('test file instantiates page objects', () => {
    const files = buildProjectFiles(makePlan(), pomConfig);
    const spec = files.find(f => f.path.startsWith('tests/'))!;
    expect(spec.content).toContain('new LoginPage');
  });

  it('tsconfig includes pages/ directory', () => {
    const files = buildProjectFiles(makePlan(), pomConfig);
    const tsconfig = JSON.parse(files.find(f => f.path === 'tsconfig.json')!.content);
    expect(tsconfig.include).toContain('pages/**/*.ts');
  });

  it('flat config does NOT include pages/ directory', () => {
    const files = buildProjectFiles(makePlan(), defaultConfig);
    const tsconfig = JSON.parse(files.find(f => f.path === 'tsconfig.json')!.content);
    expect(tsconfig.include).not.toContain('pages/**/*.ts');
  });

  it('same base files (package.json, config, .gitignore) for both modes', () => {
    const flatFiles = buildProjectFiles(makePlan(), defaultConfig);
    const pomFiles = buildProjectFiles(makePlan(), pomConfig);

    // package.json should be identical
    const flatPkg = flatFiles.find(f => f.path === 'package.json')!.content;
    const pomPkg = pomFiles.find(f => f.path === 'package.json')!.content;
    expect(flatPkg).toBe(pomPkg);

    // playwright.config.ts should be identical
    const flatConfig = flatFiles.find(f => f.path === 'playwright.config.ts')!.content;
    const pomConfigFile = pomFiles.find(f => f.path === 'playwright.config.ts')!.content;
    expect(flatConfig).toBe(pomConfigFile);

    // .gitignore should be identical
    const flatGit = flatFiles.find(f => f.path === '.gitignore')!.content;
    const pomGit = pomFiles.find(f => f.path === '.gitignore')!.content;
    expect(flatGit).toBe(pomGit);
  });

  it('test spec delegates to page object methods', () => {
    const files = buildProjectFiles(makePlan(), pomConfig);
    const spec = files.find(f => f.path.startsWith('tests/'))!;
    // The FILL step on "Email Input" in LoginPage should call loginPage.fillEmail(...)
    expect(spec.content).toContain('loginPage.fillEmail');
  });

  it('NAVIGATE stays as raw page call in POM mode', () => {
    const files = buildProjectFiles(makePlan(), pomConfig);
    const spec = files.find(f => f.path.startsWith('tests/'))!;
    expect(spec.content).toContain('await page.goto');
  });

  it('all reference plans produce valid POM projects', () => {
    for (const entry of ALL_REFERENCE_PLANS) {
      const plan = entry.factory();
      const files = buildProjectFiles(plan, pomConfig);

      // Must have page object files
      const pageFiles = files.filter(f => f.path.startsWith('pages/'));
      expect(pageFiles.length).toBeGreaterThan(0);

      // Test spec must import at least one page object
      const spec = files.find(f => f.path.startsWith('tests/'))!;
      expect(spec.content).toContain("from '../pages/");
    }
  });
});
