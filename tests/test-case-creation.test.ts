/**
 * Tests for Milestone A — Test Case Creation Flow
 *
 * Tests cover:
 * - TestCaseState enum values
 * - TestCaseDraft interface shape
 * - Storage persistence (set/get/clear TestCaseDraft)
 * - AppMessage type guard (core messages accepted, legacy types rejected)
 * - Form validation logic
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  TestCaseState,
  StorageKeys,
  TestCaseDraft,
  isAppMessage,
} from '../src/shared/types';
import { StorageService } from '../src/storage/storage-service';

// ── Mock chrome.storage ────────────────────────────────────

const mockStore: Record<string, unknown> = {};

const mockChrome = {
  storage: {
    local: {
      get: async (key: string) => {
        if (typeof key === 'string') {
          return { [key]: mockStore[key] };
        }
        return { ...mockStore };
      },
      set: async (items: Record<string, unknown>) => {
        Object.assign(mockStore, items);
      },
      remove: async (key: string) => {
        delete mockStore[key];
      },
    },
    onChanged: {
      addListener: () => {},
      removeListener: () => {},
    },
  },
};

(globalThis as unknown as { chrome: typeof mockChrome }).chrome = mockChrome;

// ── Tests ──────────────────────────────────────────────────

describe('TestCaseState enum', () => {
  it('has 8 lifecycle states', () => {
    expect(Object.values(TestCaseState).length).toBe(8);
  });

  it('starts with DRAFT', () => {
    expect(TestCaseState.DRAFT).toBe('draft');
  });

  it('transitions through RECORDING', () => {
    expect(TestCaseState.RECORDING).toBe('recording');
  });

  it('ends with SAVED', () => {
    expect(TestCaseState.SAVED).toBe('saved');
  });

  it('has the full lifecycle in order', () => {
    const states = Object.values(TestCaseState);
    expect(states).toEqual([
      'draft', 'recording', 'recorded',
      'generating', 'generated', 'under_review', 'approved', 'saved',
    ]);
  });
});

describe('TestCaseDraft shape', () => {
  it('creates a valid draft object', () => {
    const draft: TestCaseDraft = {
      id: 'tc-1234567890',
      name: 'Book a one-way flight',
      expectedResult: 'User sees flight confirmation',
      projectId: 'proj-1',
      projectName: 'Adani One',
      featureId: 'feat-1',
      featureName: 'Flight Booking',
      scenarioId: 'scn-1',
      scenarioName: 'One Way Trip',
      status: TestCaseState.DRAFT,
      createdAt: new Date().toISOString(),
    };

    expect(draft.id).toBe('tc-1234567890');
    expect(draft.name).toBe('Book a one-way flight');
    expect(draft.status).toBe(TestCaseState.DRAFT);
  });

  it('allows missing expectedResult', () => {
    const draft: TestCaseDraft = {
      id: 'tc-1',
      name: 'Test login',
      projectId: 'p1',
      projectName: 'App',
      featureId: 'f1',
      featureName: 'Auth',
      scenarioId: 's1',
      scenarioName: 'Login',
      status: TestCaseState.DRAFT,
      createdAt: new Date().toISOString(),
    };

    expect(draft.expectedResult).toBeUndefined();
  });
});

describe('StorageKeys.TEST_CASE_DRAFT', () => {
  it('exists with correct value', () => {
    expect(StorageKeys.TEST_CASE_DRAFT).toBe('test_case_draft');
  });
});

describe('StorageService TestCaseDraft', () => {

  beforeEach(async () => {
    // Clear mock store
    for (const key of Object.keys(mockStore)) {
      delete mockStore[key];
    }
  });

  it('returns null when no draft exists', async () => {
    const result = await StorageService.getTestCaseDraft();
    expect(result).toBeNull();
  });

  it('persists and retrieves a draft', async () => {
    const draft: TestCaseDraft = {
      id: 'tc-test1',
      name: 'Test the cart',
      projectId: 'p1',
      projectName: 'Shop',
      featureId: 'f1',
      featureName: 'Cart',
      scenarioId: 's1',
      scenarioName: 'Add to cart',
      status: TestCaseState.DRAFT,
      createdAt: '2026-07-14T00:00:00.000Z',
    };

    await StorageService.setTestCaseDraft(draft);
    const result = await StorageService.getTestCaseDraft();
    expect(result).not.toBeNull();
    expect(result!.id).toBe('tc-test1');
    expect(result!.name).toBe('Test the cart');
    expect(result!.status).toBe(TestCaseState.DRAFT);
  });

  it('clears the draft', async () => {
    const draft: TestCaseDraft = {
      id: 'tc-clear',
      name: 'To be cleared',
      projectId: 'p1',
      projectName: 'P',
      featureId: 'f1',
      featureName: 'F',
      scenarioId: 's1',
      scenarioName: 'S',
      status: TestCaseState.DRAFT,
      createdAt: '2026-07-14T00:00:00.000Z',
    };

    await StorageService.setTestCaseDraft(draft);
    await StorageService.clearTestCaseDraft();
    const result = await StorageService.getTestCaseDraft();
    expect(result).toBeNull();
  });

  it('updates draft status', async () => {
    const draft: TestCaseDraft = {
      id: 'tc-status',
      name: 'Status update test',
      projectId: 'p1',
      projectName: 'P',
      featureId: 'f1',
      featureName: 'F',
      scenarioId: 's1',
      scenarioName: 'S',
      status: TestCaseState.DRAFT,
      createdAt: '2026-07-14T00:00:00.000Z',
    };

    await StorageService.setTestCaseDraft(draft);
    const stored = await StorageService.getTestCaseDraft();
    await StorageService.setTestCaseDraft({
      ...stored!,
      status: TestCaseState.RECORDING,
    });
    const updated = await StorageService.getTestCaseDraft();
    expect(updated!.status).toBe(TestCaseState.RECORDING);
  });
});

describe('AppMessage types', () => {
  it('accepts core recording messages', () => {
    expect(isAppMessage({ type: 'START_RECORDING' })).toBe(true);
    expect(isAppMessage({ type: 'STOP_RECORDING' })).toBe(true);
  });

  it('rejects unknown message types', () => {
    expect(isAppMessage({ type: 'UNKNOWN_TYPE' })).toBe(false);
  });

  it('rejects removed legacy message types', () => {
    // These message types were removed in Phase 7 when Architecture C
    // was archived. They must not be accepted by the type guard.
    expect(isAppMessage({ type: 'CREATE_TEST_CASE', payload: {} })).toBe(false);
    expect(isAppMessage({ type: 'CLEAR_TEST_CASE' })).toBe(false);
    expect(isAppMessage({ type: 'CLICK_CAPTURED', payload: {} })).toBe(false);
    expect(isAppMessage({ type: 'DATE_SELECT_CAPTURED', payload: {} })).toBe(false);
  });
});

describe('Form validation logic', () => {
  // Simulate the validation function
  function validateForm(
    project: string,
    feature: string,
    scenario: string,
    name: string,
  ): boolean {
    const NEW_OPTION = '__new__';
    const hasProject = project && project !== NEW_OPTION;
    const hasFeature = feature && feature !== NEW_OPTION;
    const hasScenario = scenario && scenario !== NEW_OPTION;
    const hasName = name.trim().length > 0;
    return !!(hasProject && hasFeature && hasScenario && hasName);
  }

  it('passes when all fields are filled', () => {
    expect(validateForm('p1', 'f1', 's1', 'My Test')).toBe(true);
  });

  it('fails when project is empty', () => {
    expect(validateForm('', 'f1', 's1', 'My Test')).toBe(false);
  });

  it('fails when feature is empty', () => {
    expect(validateForm('p1', '', 's1', 'My Test')).toBe(false);
  });

  it('fails when scenario is empty', () => {
    expect(validateForm('p1', 'f1', '', 'My Test')).toBe(false);
  });

  it('fails when name is empty', () => {
    expect(validateForm('p1', 'f1', 's1', '')).toBe(false);
  });

  it('fails when name is whitespace only', () => {
    expect(validateForm('p1', 'f1', 's1', '   ')).toBe(false);
  });

  it('fails when any field is the NEW_OPTION sentinel', () => {
    expect(validateForm('__new__', 'f1', 's1', 'Test')).toBe(false);
    expect(validateForm('p1', '__new__', 's1', 'Test')).toBe(false);
    expect(validateForm('p1', 'f1', '__new__', 'Test')).toBe(false);
  });
});

describe('Test Case draft lifecycle integration', () => {

  beforeEach(async () => {
    for (const key of Object.keys(mockStore)) {
      delete mockStore[key];
    }
  });

  it('simulates the full TC creation → recording flow', async () => {
    // 1. Create draft
    const draft: TestCaseDraft = {
      id: 'tc-lifecycle-1',
      name: 'Book flight',
      expectedResult: 'Confirmation page shown',
      projectId: 'p1',
      projectName: 'Adani One',
      featureId: 'f1',
      featureName: 'Flight Booking',
      scenarioId: 's1',
      scenarioName: 'One Way',
      status: TestCaseState.DRAFT,
      createdAt: '2026-07-14T00:00:00.000Z',
    };
    await StorageService.setTestCaseDraft(draft);

    // 2. Verify it's DRAFT
    let stored = await StorageService.getTestCaseDraft();
    expect(stored!.status).toBe(TestCaseState.DRAFT);

    // 3. Simulate Start Recording → status changes to RECORDING
    await StorageService.setTestCaseDraft({
      ...stored!,
      status: TestCaseState.RECORDING,
    });
    stored = await StorageService.getTestCaseDraft();
    expect(stored!.status).toBe(TestCaseState.RECORDING);

    // 4. Clear on Record Another
    await StorageService.clearTestCaseDraft();
    const after = await StorageService.getTestCaseDraft();
    expect(after).toBeNull();
  });
});
