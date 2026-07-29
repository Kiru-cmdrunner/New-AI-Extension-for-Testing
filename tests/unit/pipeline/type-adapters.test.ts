/**
 * Type Adapter Tests — Phase 2
 *
 * Tests for the adapters that convert existing recorder types
 * (ElementIdentity, DomContext) to the new Phase 1 target types
 * (TargetElementIdentity, TargetDomContext).
 *
 * Verifies lossless conversion and correct evidence record synthesis.
 */

import { describe, it, expect } from 'vitest';
import {
  adaptElementIdentity,
  adaptDomContext,
  recordedEventToEvidenceRecords,
} from '../../../src/pipeline/adapters/type-adapters';
import type { ElementIdentity } from '../../../src/shared/types';
import type { DomContext } from '../../../src/recorder/recorded-event';
import type { SurfaceInfo } from '../../../src/types/element';

// ── Helpers ───────────────────────────────────────────────

function makeElementIdentity(overrides: Partial<ElementIdentity> = {}): ElementIdentity {
  return {
    accessibleName: 'Submit',
    ariaRole: 'button',
    ariaLabel: null,
    ariaLabelledBy: null,
    placeholder: null,
    tag: 'BUTTON',
    className: null,
    name: null,
    stableId: null,
    testId: null,
    dataCy: null,
    dataQa: null,
    cssSelector: 'button',
    xPath: '//button[1]',
    inIframe: false,
    shadowDom: false,
    elementId: 'BUTTON::Submit',
    ...overrides,
  };
}

function makeDomContext(overrides: Partial<DomContext> = {}): DomContext {
  return {
    inputType: null,
    ariaExpanded: null,
    ariaHasPopup: null,
    isContentEditable: false,
    ...overrides,
  };
}

// ── adaptElementIdentity Tests ────────────────────────────

describe('adaptElementIdentity', () => {
  it('should convert tag name', () => {
    const identity = makeElementIdentity({ tag: 'INPUT' });
    const result = adaptElementIdentity(identity);
    expect(result.tag).toBe('INPUT');
  });

  it('should convert accessible name', () => {
    const identity = makeElementIdentity({ accessibleName: 'Email Field' });
    const result = adaptElementIdentity(identity);
    expect(result.accessibleName).toBe('Email Field');
  });

  it('should convert ARIA role', () => {
    const identity = makeElementIdentity({ ariaRole: 'combobox' });
    const result = adaptElementIdentity(identity);
    expect(result.ariaRole).toBe('combobox');
  });

  it('should resolve locators in priority order', () => {
    const identity = makeElementIdentity({
      testId: 'login-btn',
      stableId: 'login',
      cssSelector: 'button#login',
      xPath: '//button[1]',
    });
    const result = adaptElementIdentity(identity);
    // testId should be first (highest priority)
    expect(result.locators[0].kind).toBe('testId');
    expect(result.locators[0].value).toBe('login-btn');
    expect(result.locators[0].confidence).toBe(0.95);
    expect(result.locators[0].source).toBe('observed');
    // id should be second
    expect(result.locators[1].kind).toBe('id');
    expect(result.primaryLocator.kind).toBe('testId');
  });

  it('should handle element with no locators (fallback to css)', () => {
    const identity = makeElementIdentity({
      testId: null, stableId: null, dataCy: null, dataQa: null,
      ariaLabel: null, name: null, placeholder: null,
      cssSelector: 'div.container',
      xPath: '',
    });
    const result = adaptElementIdentity(identity);
    expect(result.locators).toHaveLength(1);
    expect(result.locators[0].kind).toBe('css');
    expect(result.primaryLocator.kind).toBe('css');
  });

  it('should convert shadow DOM flag', () => {
    const identity = makeElementIdentity({ shadowDom: true });
    const result = adaptElementIdentity(identity);
    expect(result.inShadowDom).toBe(true);
  });

  it('should convert iframe context', () => {
    const identity = makeElementIdentity({
      inIframe: true,
      iframeContext: {
        frameSrc: 'https://example.com/frame',
        frameName: 'content',
        frameId: 'frame-1',
        frameSelector: 'iframe#frame-1',
        frameXPath: '//iframe[1]',
        frameIndex: 0,
        frameDepth: 1,
      },
    });
    const result = adaptElementIdentity(identity);
    expect(result.inIframe).toBe(true);
    expect(result.frameContext).not.toBeNull();
    expect(result.frameContext!.url).toBe('https://example.com/frame');
    expect(result.frameContext!.depth).toBe(1);
  });

  it('should set frameContext to null when not in iframe', () => {
    const identity = makeElementIdentity({ inIframe: false });
    const result = adaptElementIdentity(identity);
    expect(result.frameContext).toBeNull();
  });
});

// ── adaptDomContext Tests ─────────────────────────────────

describe('adaptDomContext', () => {
  it('should handle undefined DomContext', () => {
    const result = adaptDomContext(undefined, {
      valueBefore: null, valueAfter: null,
      checkedBefore: null, checkedAfter: null,
    });
    expect(result.surfaces).toHaveLength(0);
    expect(result.valueTransition).toBeNull();
    expect(result.checkedTransition).toBeNull();
  });

  it('should convert value transitions', () => {
    const result = adaptDomContext(undefined, {
      valueBefore: 'old@example.com',
      valueAfter: 'new@example.com',
      checkedBefore: null, checkedAfter: null,
    });
    expect(result.valueTransition).not.toBeNull();
    expect(result.valueTransition!.before).toBe('old@example.com');
    expect(result.valueTransition!.after).toBe('new@example.com');
  });

  it('should convert checked transitions', () => {
    const result = adaptDomContext(undefined, {
      valueBefore: null, valueAfter: null,
      checkedBefore: false, checkedAfter: true,
    });
    expect(result.checkedTransition).not.toBeNull();
    expect(result.checkedTransition!.before).toBe(false);
    expect(result.checkedTransition!.after).toBe(true);
  });

  it('should convert surface from DomContext', () => {
    const ctx = makeDomContext({
      surfaceType: 'modal',
      surfaceRole: 'dialog',
      surfaceLabel: 'Settings',
    });
    const result = adaptDomContext(ctx, {
      valueBefore: null, valueAfter: null,
      checkedBefore: null, checkedAfter: null,
    });
    expect(result.surfaces).toHaveLength(1);
    expect(result.surfaces[0].type).toBe('modal');
    expect(result.surfaces[0].role).toBe('dialog');
    expect(result.surfaces[0].accessibleName).toBe('Settings');
  });

  it('should convert provided SurfaceInfo[]', () => {
    const surfaces: SurfaceInfo[] = [{
      type: 'dropdown',
      role: 'listbox',
      accessibleName: 'Country',
      direction: 'appeared',
      detectedAt: '2025-01-01T00:00:00.000Z',
    }];
    const result = adaptDomContext(undefined, {
      valueBefore: null, valueAfter: null,
      checkedBefore: null, checkedAfter: null,
      surfaces,
    });
    expect(result.surfaces).toHaveLength(1);
    expect(result.surfaces[0].type).toBe('dropdown');
  });

  it('should convert date picker context', () => {
    const ctx = makeDomContext({
      dateType: 'date',
      isoValue: '2025-07-15',
      displayValue: 'July 15, 2025',
      dateConfidence: 1.0,
    });
    const result = adaptDomContext(ctx, {
      valueBefore: null, valueAfter: null,
      checkedBefore: null, checkedAfter: null,
    });
    expect(result.datePicker).not.toBeNull();
    expect(result.datePicker!.isoValue).toBe('2025-07-15');
  });

  it('should convert file upload context', () => {
    const ctx = makeDomContext({
      uploadMethod: 'browse',
      acceptedFileTypes: '.pdf,.docx',
      multipleFiles: false,
      fileData: [{ name: 'doc.pdf', type: 'application/pdf' }],
    });
    const result = adaptDomContext(ctx, {
      valueBefore: null, valueAfter: null,
      checkedBefore: null, checkedAfter: null,
    });
    expect(result.fileUpload).not.toBeNull();
    expect(result.fileUpload!.method).toBe('browse');
    expect(result.fileUpload!.files).toHaveLength(1);
  });

  it('should convert dialog context', () => {
    const ctx = makeDomContext({
      triggeredDialog: 'confirm',
      dialogMessage: 'Are you sure?',
      dialogResult: 'OK',
    });
    const result = adaptDomContext(ctx, {
      valueBefore: null, valueAfter: null,
      checkedBefore: null, checkedAfter: null,
    });
    expect(result.dialog).not.toBeNull();
    expect(result.dialog!.type).toBe('confirm');
    expect(result.dialog!.message).toBe('Are you sure?');
  });

  it('should convert ancestor roles', () => {
    const ctx = makeDomContext({
      ancestorRoles: ['div[role=group]', 'form'],
    });
    const result = adaptDomContext(ctx, {
      valueBefore: null, valueAfter: null,
      checkedBefore: null, checkedAfter: null,
    });
    expect(result.ancestorChain).toEqual(['div[role=group]', 'form']);
  });
});

// ── recordedEventToEvidenceRecords Tests ──────────────────

describe('recordedEventToEvidenceRecords', () => {
  it('should synthesize evidence records from existing event data', () => {
    const identity = makeElementIdentity({ ariaRole: 'button', accessibleName: 'Submit' });
    const records = recordedEventToEvidenceRecords(
      identity, undefined, 'click', '2025-01-01T00:00:00.000Z',
      null, null, null, null,
    );
    expect(records.length).toBeGreaterThanOrEqual(3);
    const channels = new Set(records.map(r => r.channelId));
    expect(channels.has('A')).toBe(true);
    expect(channels.has('B')).toBe(true);
    expect(channels.has('C')).toBe(true);
  });

  it('should include value transition evidence when present', () => {
    const identity = makeElementIdentity({ tag: 'INPUT' });
    const records = recordedEventToEvidenceRecords(
      identity, undefined, 'blur', '2025-01-01T00:00:00.000Z',
      'old@example.com', 'new@example.com', null, null,
    );
    const vtRecord = records.find(r => r.signalType === 'valueTransition');
    expect(vtRecord).toBeDefined();
    expect((vtRecord!.value as any).before).toBe('old@example.com');
  });

  it('should include checked transition evidence when present', () => {
    const identity = makeElementIdentity({ tag: 'INPUT' });
    const records = recordedEventToEvidenceRecords(
      identity, undefined, 'click', '2025-01-01T00:00:00.000Z',
      null, null, false, true,
    );
    const ctRecord = records.find(r => r.signalType === 'checkedTransition');
    expect(ctRecord).toBeDefined();
    expect((ctRecord!.value as any).after).toBe(true);
  });

  it('should include DomContext signals (aria-expanded, surface)', () => {
    const identity = makeElementIdentity();
    const ctx = makeDomContext({
      ariaExpanded: true,
      ariaHasPopup: 'listbox',
      surfaceType: 'modal' as any,
      surfaceRole: 'dialog',
      surfaceLabel: 'Options',
    });
    const records = recordedEventToEvidenceRecords(
      identity, ctx, 'click', '2025-01-01T00:00:00.000Z',
      null, null, null, null,
    );
    const expandedRecord = records.find(r =>
      r.signalType === 'ariaAttribute' &&
      (r.value as any).attribute === 'aria-expanded'
    );
    expect(expandedRecord).toBeDefined();
    expect((expandedRecord!.value as any).value).toBe(true);
    const surfaceRecord = records.find(r => r.signalType === 'surfaceAppearance');
    expect(surfaceRecord).toBeDefined();
  });

  it('should include hierarchy from ancestor roles', () => {
    const identity = makeElementIdentity();
    const ctx = makeDomContext({
      ancestorRoles: ['div[role=group]', 'main'],
    });
    const records = recordedEventToEvidenceRecords(
      identity, ctx, 'click', '2025-01-01T00:00:00.000Z',
      null, null, null, null,
    );
    const hierarchyRecord = records.find(r => r.signalType === 'hierarchy');
    expect(hierarchyRecord).toBeDefined();
    expect(hierarchyRecord!.value).toEqual(['div[role=group]', 'main']);
  });
});
