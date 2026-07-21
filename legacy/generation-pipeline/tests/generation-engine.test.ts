/**
 * Tests for the Artifact Generation Engine (Milestone B3).
 *
 * Covers:
 *   - Generator contracts
 *   - Generator registry (register, resolve order, cycle detection)
 *   - Canonical Step Generator (pure function: timeline → steps)
 *   - Generation Engine (orchestrator: Stop → GENERATING → GENERATED)
 *   - Empty timeline handling
 *   - Navigation event transformation
 *   - Click event transformation
 *   - Element identity projection
 *   - AI enrichment projection
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { GeneratorRegistry } from '../src/generation/registry/generator-registry';
import { canonicalStepGenerator } from '../src/generation/generators/canonical-step-generator';
import type { GeneratorContract, CanonicalStepGeneratorInput } from '../src/generation/contracts/generator-contract';

// ── Test Fixtures ──────────────────────────────────────────

const mockRecordingContext = {
  startUrl: 'https://www.adanione.com/',
  startTitle: 'Adani One',
  capturedAt: '2026-07-14T05:00:00Z',
};

function makeClickEvent(overrides: Partial<Record<string, unknown>> = {}): unknown {
  return {
    actionId: 'click-0001',
    type: 'click',
    timestamp: '2026-07-14T05:01:00Z',
    elementIdentity: {
      accessibleName: 'Book Flight',
      ariaRole: 'button',
      ariaLabel: 'Book Flight',
      ariaLabelledBy: null,
      placeholder: null,
      tag: 'BUTTON',
      name: null,
      stableId: 'book-flight-btn',
      testId: 'book-flight',
      dataCy: null,
      dataQa: null,
      className: null,
      cssSelector: 'button#book-flight-btn',
      xPath: '//button[@id="book-flight-btn"]',
      inIframe: false,
      shadowDom: false,
      elementId: 'elem-0001',
    },
    aiUnderstanding: {
      businessName: 'Book Flight Button',
      controlType: 'Button',
      userIntent: 'Navigate to flight booking page',
      confidenceScore: 0.95,
    },
    ...overrides,
  };
}

function makeNavEvent(url: string, title: string, actionId = 'nav-0001'): unknown {
  return {
    actionId,
    type: 'navigation',
    url,
    title,
    timestamp: '2026-07-14T05:01:30Z',
  };
}

// ── Generator Registry Tests ───────────────────────────────

describe('GeneratorRegistry', () => {
  let registry: GeneratorRegistry;

  beforeEach(() => {
    registry = new GeneratorRegistry();
  });

  it('registers and retrieves a generator', () => {
    const mock: GeneratorContract = {
      name: 'mock',
      dependencies: [],
      generate: () => ({ status: 'success', output: null, errors: [] }),
    };
    registry.register(mock);
    expect(registry.has('mock')).toBe(true);
    expect(registry.get('mock')).toBe(mock);
  });

  it('lists all registered names', () => {
    registry.register({
      name: 'gen-a', dependencies: [],
      generate: () => ({ status: 'success', output: null, errors: [] }),
    });
    registry.register({
      name: 'gen-b', dependencies: [],
      generate: () => ({ status: 'success', output: null, errors: [] }),
    });
    expect(registry.getAllNames().sort()).toEqual(['gen-a', 'gen-b']);
  });

  it('resolves execution order based on dependencies', () => {
    registry.register({
      name: 'gen-c', dependencies: ['gen-a', 'gen-b'],
      generate: () => ({ status: 'success', output: null, errors: [] }),
    });
    registry.register({
      name: 'gen-a', dependencies: [],
      generate: () => ({ status: 'success', output: null, errors: [] }),
    });
    registry.register({
      name: 'gen-b', dependencies: ['gen-a'],
      generate: () => ({ status: 'success', output: null, errors: [] }),
    });

    const ordered = registry.getOrdered();
    const names = ordered.map((g) => g.name);

    // gen-a must come before gen-b, gen-b before gen-c
    expect(names.indexOf('gen-a')).toBeLessThan(names.indexOf('gen-b'));
    expect(names.indexOf('gen-b')).toBeLessThan(names.indexOf('gen-c'));
  });

  it('throws on circular dependency', () => {
    registry.register({
      name: 'gen-x', dependencies: ['gen-y'],
      generate: () => ({ status: 'success', output: null, errors: [] }),
    });
    registry.register({
      name: 'gen-y', dependencies: ['gen-x'],
      generate: () => ({ status: 'success', output: null, errors: [] }),
    });

    expect(() => registry.getOrdered()).toThrow(/Circular dependency/);
  });

  it('throws on missing dependency', () => {
    registry.register({
      name: 'gen-z', dependencies: ['nonexistent'],
      generate: () => ({ status: 'success', output: null, errors: [] }),
    });

    expect(() => registry.getOrdered()).toThrow(/Missing dependency/);
  });
});

// ── Canonical Step Generator Tests ─────────────────────────

describe('CanonicalStepGenerator', () => {
  it('has the correct contract metadata', () => {
    expect(canonicalStepGenerator.name).toBe('canonical-step-generator');
    expect(canonicalStepGenerator.dependencies).toEqual([]);
  });

  it('transforms an empty timeline into an empty steps array', () => {
    const input: CanonicalStepGeneratorInput = {
      timeline: [],
      recordingContext: mockRecordingContext,
    };
    const result = canonicalStepGenerator.generate(input);

    expect(result.status).toBe('success');
    expect(result.output).toEqual([]);
    expect(result.errors).toEqual([]);
  });

  it('transforms a click event into a canonical step', () => {
    const input: CanonicalStepGeneratorInput = {
      timeline: [makeClickEvent() as never],
      recordingContext: mockRecordingContext,
    };
    const result = canonicalStepGenerator.generate(input);

    expect(result.status).toBe('success');
    expect(result.output).toHaveLength(1);

    const step = result.output![0];
    expect(step.stepNumber).toBe(1);
    expect(step.actionType).toBe('click');
    expect(step.linkedInteractionId).toBe('click-0001');
    expect(step.executionJson).toBeNull(); // B4 populates this
  });

  it('projects element identity from the interaction event', () => {
    const input: CanonicalStepGeneratorInput = {
      timeline: [makeClickEvent() as never],
      recordingContext: mockRecordingContext,
    };
    const result = canonicalStepGenerator.generate(input);

    const step = result.output![0];
    expect(step.elementIdentity.accessibleName).toBe('Book Flight');
    expect(step.elementIdentity.tag).toBe('BUTTON');
    expect(step.elementIdentity.elementId).toBe('elem-0001');
  });

  it('projects AI enrichment from the interaction event', () => {
    const input: CanonicalStepGeneratorInput = {
      timeline: [makeClickEvent() as never],
      recordingContext: mockRecordingContext,
    };
    const result = canonicalStepGenerator.generate(input);

    const step = result.output![0];
    expect(step.aiEnrichment).not.toBeNull();
    expect(step.aiEnrichment!.businessName).toBe('Book Flight Button');
    expect(step.aiConfidence).toBe(0.95);
  });

  it('handles events without AI enrichment', () => {
    const event = makeClickEvent();
    delete (event as Record<string, unknown>).aiUnderstanding;
    (event as Record<string, unknown>).aiError = 'AI failed';

    const input: CanonicalStepGeneratorInput = {
      timeline: [event as never],
      recordingContext: mockRecordingContext,
    };
    const result = canonicalStepGenerator.generate(input);

    expect(result.status).toBe('success');
    const step = result.output![0];
    expect(step.aiEnrichment).toBeNull();
    expect(step.aiConfidence).toBe(0);
  });

  it('transforms a navigation event into a canonical step', () => {
    const input: CanonicalStepGeneratorInput = {
      timeline: [makeNavEvent('https://www.adanione.com/flight-booking', 'Flight Booking') as never],
      recordingContext: mockRecordingContext,
    };
    const result = canonicalStepGenerator.generate(input);

    expect(result.status).toBe('success');
    const step = result.output![0];
    expect(step.actionType).toBe('navigate');
    expect(step.plainEnglish).toContain('flight-booking');
    expect(step.elementIdentity.tag).toBe('NAVIGATION');
    expect(step.aiEnrichment).toBeNull();
    expect(step.executionJson).toBeNull();
  });

  it('generates sequential step IDs', () => {
    const input: CanonicalStepGeneratorInput = {
      timeline: [
        makeClickEvent({ actionId: 'click-0001' }) as never,
        makeNavEvent('https://example.com', 'Example', 'nav-0001') as never,
        makeClickEvent({ actionId: 'click-0002' }) as never,
      ],
      recordingContext: mockRecordingContext,
    };
    const result = canonicalStepGenerator.generate(input);

    expect(result.output).toHaveLength(3);
    expect(result.output![0].stepId).toBe('step-0001');
    expect(result.output![1].stepId).toBe('step-0002');
    expect(result.output![2].stepId).toBe('step-0003');
  });

  it('assigns correct step numbers', () => {
    const input: CanonicalStepGeneratorInput = {
      timeline: [
        makeClickEvent() as never,
        makeClickEvent({ actionId: 'click-0002' }) as never,
      ],
      recordingContext: mockRecordingContext,
    };
    const result = canonicalStepGenerator.generate(input);

    expect(result.output![0].stepNumber).toBe(1);
    expect(result.output![1].stepNumber).toBe(2);
  });

  it('produces plain English using the frozen Semantic Interaction Language templates', () => {
    const input: CanonicalStepGeneratorInput = {
      timeline: [makeClickEvent() as never],
      recordingContext: mockRecordingContext,
    };
    const result = canonicalStepGenerator.generate(input);

    const step = result.output![0];
    // Frozen click template: "Click the {elementName}"
    // (using AI business name since confidence is high)
    expect(step.plainEnglish).toMatch(/^Click the /);
    expect(step.plainEnglish).toContain('Book Flight');
  });

  it('transforms mixed click and navigation events in order', () => {
    const input: CanonicalStepGeneratorInput = {
      timeline: [
        makeClickEvent({ actionId: 'click-0001' }) as never,
        makeNavEvent('https://www.adanione.com/flight-booking', 'Flight Booking', 'nav-0001') as never,
        makeClickEvent({ actionId: 'click-0002' }) as never,
      ],
      recordingContext: mockRecordingContext,
    };
    const result = canonicalStepGenerator.generate(input);

    expect(result.output).toHaveLength(3);
    expect(result.output![0].actionType).toBe('click');
    expect(result.output![1].actionType).toBe('navigate');
    expect(result.output![2].actionType).toBe('click');
    expect(result.output![1].plainEnglish).toContain('flight-booking');
  });

  it('does not modify the input timeline (pure function)', () => {
    const timeline = [
      makeClickEvent() as never,
    ];
    const input: CanonicalStepGeneratorInput = {
      timeline: [...timeline],
      recordingContext: mockRecordingContext,
    };

    canonicalStepGenerator.generate(input);

    // Original timeline should be unchanged
    expect(input.timeline).toHaveLength(1);
    expect(input.timeline[0].actionId).toBe('click-0001');
  });

  it('produces deterministic output for the same input (modulo timestamp)', () => {
    const timeline = [makeClickEvent() as never];
    const input: CanonicalStepGeneratorInput = {
      timeline,
      recordingContext: mockRecordingContext,
    };

    const result1 = canonicalStepGenerator.generate(input);
    const result2 = canonicalStepGenerator.generate(input);

    // Step content (minus timestamp) should be identical
    expect(result1.output![0].stepId).toBe(result2.output![0].stepId);
    expect(result1.output![0].actionType).toBe(result2.output![0].actionType);
    expect(result1.output![0].plainEnglish).toBe(result2.output![0].plainEnglish);
    expect(result1.output![0].linkedInteractionId).toBe(result2.output![0].linkedInteractionId);
  });

  it('generates correct linkedInteractionId for each step', () => {
    const input: CanonicalStepGeneratorInput = {
      timeline: [
        makeClickEvent({ actionId: 'click-0001' }) as never,
        makeNavEvent('https://example.com', 'Example', 'nav-0001') as never,
      ],
      recordingContext: mockRecordingContext,
    };
    const result = canonicalStepGenerator.generate(input);

    expect(result.output![0].linkedInteractionId).toBe('click-0001');
    expect(result.output![1].linkedInteractionId).toBe('nav-0001');
  });

  it('copies element identity without mutating the original', () => {
    const event = makeClickEvent();
    const originalName = (event as Record<string, unknown>).elementIdentity
      ? ((event as { elementIdentity: { accessibleName: string } }).elementIdentity.accessibleName)
      : '';
    const input: CanonicalStepGeneratorInput = {
      timeline: [event as never],
      recordingContext: mockRecordingContext,
    };
    canonicalStepGenerator.generate(input);

    // The original event's identity should be untouched
    const eventIdentity = (event as { elementIdentity: { accessibleName: string } }).elementIdentity;
    expect(eventIdentity.accessibleName).toBe(originalName);
  });
});

// ── Generator Contract Compliance Tests ────────────────────

describe('Generator Contract Compliance', () => {
  it('canonical-step-generator implements GeneratorContract', () => {
    const gen = canonicalStepGenerator;
    expect(typeof gen.name).toBe('string');
    expect(Array.isArray(gen.dependencies)).toBe(true);
    expect(typeof gen.generate).toBe('function');
  });

  it('generate returns a GeneratorResult with status, output, errors', () => {
    const input: CanonicalStepGeneratorInput = {
      timeline: [makeClickEvent() as never],
      recordingContext: mockRecordingContext,
    };
    const result = canonicalStepGenerator.generate(input);

    expect(result).toHaveProperty('status');
    expect(result).toHaveProperty('output');
    expect(result).toHaveProperty('errors');
    expect(['success', 'partial', 'failure']).toContain(result.status);
  });

  it('generate never throws — always returns a result', () => {
    // An event with no element identity will fail to transform,
    // but the generator should return a failure result, not throw.
    const event = {
      actionId: 'bad-0001',
      type: 'unknown-type',
      timestamp: '2026-01-01',
      // No elementIdentity — this will cause an error
    };
    const input: CanonicalStepGeneratorInput = {
      timeline: [event as never],
      recordingContext: mockRecordingContext,
    };

    // Should not throw
    expect(() => canonicalStepGenerator.generate(input)).not.toThrow();

    // Should return a failure result with error details
    const result = canonicalStepGenerator.generate(input);
    expect(result.status).toBe('failure');
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0].stepIndex).toBe(0);
    expect(result.errors[0].recoverable).toBe(true);
  });
});

// ── Extension by Addition Tests ────────────────────────────

describe('Extension by Addition (B2 AP7)', () => {
  it('a new generator can be added without modifying existing generators', () => {
    const registry = new GeneratorRegistry();

    // Register the canonical step generator
    registry.register(canonicalStepGenerator);

    // Simulate adding a future "mock-exec-json-generator"
    const mockJsonGen: GeneratorContract = {
      name: 'mock-exec-json-generator',
      dependencies: ['canonical-step-generator'],
      generate: (input: unknown) => ({
        status: 'success',
        output: input,
        errors: [],
      }),
    };
    registry.register(mockJsonGen);

    // The ordered list should put step generator first, then mock
    const ordered = registry.getOrdered();
    expect(ordered[0].name).toBe('canonical-step-generator');
    expect(ordered[1].name).toBe('mock-exec-json-generator');

    // The canonical step generator is NOT modified
    expect(canonicalStepGenerator.dependencies).toEqual([]);
  });

  it('a third generator (mock Playwright) can be added on top', () => {
    const registry = new GeneratorRegistry();
    registry.register(canonicalStepGenerator);
    registry.register({
      name: 'mock-exec-json-generator',
      dependencies: ['canonical-step-generator'],
      generate: (input: unknown) => ({ status: 'success', output: input, errors: [] }),
    });
    registry.register({
      name: 'mock-playwright-generator',
      dependencies: ['canonical-step-generator', 'mock-exec-json-generator'],
      generate: () => ({ status: 'success', output: 'test code', errors: [] }),
    });

    const ordered = registry.getOrdered().map((g) => g.name);
    expect(ordered).toEqual([
      'canonical-step-generator',
      'mock-exec-json-generator',
      'mock-playwright-generator',
    ]);
  });
});
