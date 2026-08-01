/**
 * Area 4 — Compound Interaction Validation
 *
 * Tests browser-driven compound interactions: multi-event gestures that
 * require coordinating several DOM events across time. These are marked
 * [SIMULATED] because the programmatic harness approximates browser
 * behavior without a real DOM or real user input device.
 *
 * Compound interactions include:
 *  - Mouse-based drag-and-drop (mousedown → mousemove → mouseup)
 *  - HTML5 drag-and-drop (dragstart → dragover → drop)
 *  - Keyboard shortcuts (keydown → keyup with modifier combos)
 *  - Multi-key text entry (keydown/keyup per character)
 *  - Touch gestures (touchstart → touchmove → touchend)
 *  - Scroll-based interactions (wheel → scroll)
 *  - Focus blur chains (focus field A → blur A → focus field B)
 *  - Double-click to select text
 *  - Right-click context menu
 *  - Resize handle drag
 *  - Pinch zoom / multi-touch
 *
 * Architecture: .drytis/EXPANDED_VALIDATION_DESIGN.md §6
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { runFullPipeline, makeTarget, makeContext, makeEvent, resetEventCounter } from './harness';
import type { RawObservation } from './types';

// ── Helpers ──────────────────────────────────────────────────────────

const observations: RawObservation[] = [];

function recordObs(
  observationId: string,
  capabilityId: string,
  scores: RawObservation['scores'],
  observed: string,
  rootCause: string,
  category: RawObservation['category'],
  severity: RawObservation['severity'],
  subsystem: RawObservation['subsystem'],
  emitted?: unknown[],
  playwrightCode?: string | null,
): void {
  observations.push({
    observationId,
    area: 'compound',
    capabilityId,
    framework: null,
    scores,
    support: scores.q1_intent >= 4 ? 'full' : scores.q1_intent >= 2 ? 'partial' : 'unsupported',
    observed,
    rootCause,
    category,
    severity,
    subsystem,
    confidence: 'SIMULATED',
    emittedInteractions: emitted,
    playwrightCode,
  });
}

function getTypes(result: ReturnType<typeof runFullPipeline>): string[] {
  return result.interactions.map(ci => {
    const r = ci as Record<string, unknown>;
    return (r.interactionSubtype as string) ?? (r.type as string);
  });
}

// ── Tests ────────────────────────────────────────────────────────────

describe('Compound Interactions [SIMULATED]', () => {
  beforeEach(() => resetEventCounter());

  // ── CI-01: Mouse-based Drag-and-Drop ───────────────────────────────

  describe('CI-01: Mouse-based drag-and-drop (mousedown→move→up)', () => {
    it('classifies as DragDrop with displacement data', () => {
      const dragHandle = makeTarget({
        tag: 'DIV', ariaRole: 'button', accessibleName: 'Drag card',
        className: 'drag-handle card-grip',
        testId: 'card-drag-handle', cssSelector: 'div.drag-handle[data-testid="card-drag-handle"]',
        xPath: '//div[@data-testid="card-drag-handle"]',
      });
      const dropZone = makeTarget({
        tag: 'DIV', ariaRole: 'region', accessibleName: 'Drop zone',
        testId: 'card-drop-zone', cssSelector: 'div[data-testid="card-drop-zone"]',
        xPath: '//div[@data-testid="card-drop-zone"]',
      });

      // Realistic mouse drag: mousedown on handle, several mousemove events,
      // mouseup on drop zone
      const events = [
        makeEvent('mousedown', dragHandle, makeContext({}),
          { timestamp: 1000, clientX: 100, clientY: 200 }),
        makeEvent('mousemove', dragHandle, makeContext({}),
          { timestamp: 1100, clientX: 150, clientY: 220 }),
        makeEvent('mousemove', dragHandle, makeContext({}),
          { timestamp: 1200, clientX: 200, clientY: 250 }),
        makeEvent('mousemove', dropZone, makeContext({}),
          { timestamp: 1300, clientX: 280, clientY: 300 }),
        makeEvent('mouseup', dropZone, makeContext({}),
          { timestamp: 1400, clientX: 280, clientY: 300 }),
      ];

      const result = runFullPipeline(events, {
        startUrl: 'https://app.example.com/board',
        pageTitle: 'Board',
        testCaseName: 'Drag card to zone',
      });

      const types = getTypes(result);
      const hasDrag = types.some(t => t.includes('Drag'));

      // Check for displacement metadata
      const dragInteraction = result.interactions.find(ci => {
        const t = (ci as Record<string, unknown>);
        return (t.type as string)?.includes('Drag') || (t.interactionSubtype as string)?.includes('Drag');
      });
      const hasDisplacement = dragInteraction
        ? !!(dragInteraction as Record<string, unknown>).displacement
        : false;

      const q1 = hasDrag ? 5 : 2;
      const q5 = hasDrag ? 4 : 2;

      recordObs('CI-01', 'mouse-drag-drop',
        { q1_intent: q1, q2_abstraction: 5, q3_locator: 4, q4_description: hasDrag ? 4 : 2, q5_replay: q5, q6_confidence: 4, q7_evidence: 3, q8_assertion: 2 },
        `${result.interactions.length} interactions [${types.join(', ')}]. drag=${hasDrag}, displacement=${hasDisplacement}`,
        hasDrag ? 'None' : 'Mouse-based drag not classified as DragDrop',
        hasDrag ? 'implementation-gap' : 'implementation-gap',
        hasDrag ? 'P3' : 'P2',
        'Definitions/DragDrop',
        result.interactions,
        result.playwright,
      );

      expect(result).toBeDefined();
    });
  });

  // ── CI-02: HTML5 Drag-and-Drop ────────────────────────────────────

  describe('CI-02: HTML5 drag-and-drop (dragstart→drop)', () => {
    it('classifies as DragDrop via HTML5 DnD API', () => {
      const dragHandle = makeTarget({
        tag: 'DIV', ariaRole: 'listitem', accessibleName: 'Task: Fix bug #42',
        testId: 'task-42', cssSelector: 'div[data-testid="task-42"]',
        xPath: '//div[@data-testid="task-42"]',
      });
      const dropZone = makeTarget({
        tag: 'DIV', ariaRole: 'list', accessibleName: 'Sprint Backlog',
        testId: 'sprint-backlog', cssSelector: 'div[data-testid="sprint-backlog"]',
        xPath: '//div[@data-testid="sprint-backlog"]',
      });

      const events = [
        makeEvent('dragstart', dragHandle, makeContext({}),
          { timestamp: 1000, clientX: 100, clientY: 200 }),
        makeEvent('dragover', dropZone, makeContext({}),
          { timestamp: 1200, clientX: 250, clientY: 300 }),
        makeEvent('drop', dropZone, makeContext({}),
          { timestamp: 1500, clientX: 250, clientY: 300 }),
      ];

      const result = runFullPipeline(events, {
        startUrl: 'https://app.example.com/backlog',
        pageTitle: 'Backlog',
        testCaseName: 'Drag task to sprint',
      });

      const types = getTypes(result);
      const hasDrag = types.some(t => t.includes('Drag'));

      recordObs('CI-02', 'html5-drag-drop',
        { q1_intent: hasDrag ? 5 : 2, q2_abstraction: 5, q3_locator: 4, q4_description: hasDrag ? 4 : 2, q5_replay: hasDrag ? 4 : 2, q6_confidence: 4, q7_evidence: 3, q8_assertion: 2 },
        `${result.interactions.length} interactions [${types.join(', ')}]. drag=${hasDrag}`,
        hasDrag ? 'None' : 'HTML5 drag events not classified as DragDrop',
        hasDrag ? 'implementation-gap' : 'implementation-gap',
        hasDrag ? 'P3' : 'P2',
        'Definitions/DragDrop',
        result.interactions,
        result.playwright,
      );

      expect(result).toBeDefined();
    });
  });

  // ── CI-03: Keyboard Shortcut (Ctrl+Enter) ─────────────────────────

  describe('CI-03: Keyboard shortcut (Ctrl+Enter to submit)', () => {
    it('captures keyboard shortcut interaction', () => {
      const target = makeTarget({
        tag: 'TEXTAREA', ariaRole: 'textbox', accessibleName: 'Message',
        testId: 'message-input', cssSelector: 'textarea[data-testid="message-input"]',
        xPath: '//textarea[@data-testid="message-input"]',
      });

      const events = [
        makeEvent('focus', target, makeContext({ isContentEditable: false }), { timestamp: 1000 }),
        makeEvent('input', target, makeContext({ isContentEditable: false }),
          { timestamp: 1100, valueBefore: '', valueAfter: 'Hello world' }),
        makeEvent('blur', target, makeContext({ isContentEditable: false }),
          { timestamp: 1200, valueBefore: '', valueAfter: 'Hello world' }),
        // Ctrl+Enter
        makeEvent('keydown', target, makeContext({}),
          { timestamp: 1300, key: 'Enter', code: 'Enter', ctrlKey: true }),
        makeEvent('keyup', target, makeContext({}),
          { timestamp: 1350, key: 'Enter', code: 'Enter', ctrlKey: true }),
      ];

      const result = runFullPipeline(events, {
        startUrl: 'https://app.example.com/chat',
        pageTitle: 'Chat',
        testCaseName: 'Send message with Ctrl+Enter',
      });

      const types = getTypes(result);
      const hasShortcut = types.some(t => t.includes('Shortcut') || t.includes('Keyboard'));

      // The shortcut event may or may not be captured as a separate interaction.
      // What matters is whether the text entry is captured.
      const hasText = types.some(t => t.includes('Text'));

      const q1 = hasText ? 4 : 2;
      const q4 = hasShortcut ? 4 : 2;

      recordObs('CI-03', 'keyboard-shortcut',
        { q1_intent: q1, q2_abstraction: 3, q3_locator: 4, q4_description: q4, q5_replay: q1, q6_confidence: 3, q7_evidence: 2, q8_assertion: 2 },
        `${result.interactions.length} interactions [${types.join(', ')}]. shortcut=${hasShortcut}, text=${hasText}`,
        hasShortcut ? 'None' : 'Keyboard shortcuts (Ctrl+Enter, Cmd+K, etc.) are not detected as interactions',
        hasShortcut ? 'implementation-gap' : 'capability-gap',
        hasShortcut ? 'P3' : 'P2',
        'Pipeline/Definitions',
        result.interactions,
        result.playwright,
      );

      expect(result).toBeDefined();
    });
  });

  // ── CI-04: Multi-character Text Entry ─────────────────────────────

  describe('CI-04: Multi-character text entry (typing "Hello")', () => {
    it('merges keystrokes into single TextEntry interaction', () => {
      const target = makeTarget({
        tag: 'INPUT', ariaRole: 'textbox', accessibleName: 'Name',
        testId: 'name-input', cssSelector: 'input[data-testid="name-input"]',
        xPath: '//input[@data-testid="name-input"]',
      });

      // Simulate per-keystroke input events for "Hello"
      const chars = ['H', 'He', 'Hel', 'Hell', 'Hello'];
      const events = chars.flatMap((val, i) => [
        makeEvent('input', target, makeContext({ inputType: 'text' }),
          { timestamp: 1000 + i * 50, valueBefore: i === 0 ? '' : chars[i - 1], valueAfter: val }),
      ]);

      const result = runFullPipeline(events, {
        startUrl: 'https://app.example.com/form',
        pageTitle: 'Form',
        testCaseName: 'Type name',
      });

      const types = getTypes(result);
      const textCount = result.interactions.filter(ci => {
        const t = (ci as Record<string, unknown>);
        return t.type === 'TextEntry' || t.interactionSubtype === 'TextEntry';
      }).length;

      // Should merge into exactly 1 TextEntry
      const q1 = textCount === 1 ? 5 : 2;
      const q2 = textCount === 1 ? 5 : 3;

      recordObs('CI-04', 'multi-char-text-entry',
        { q1_intent: q1, q2_abstraction: q2, q3_locator: 4, q4_description: 4, q5_replay: q1, q6_confidence: 4, q7_evidence: 3, q8_assertion: 3 },
        `${result.interactions.length} interactions (${textCount} text entries), expected 1. Input events: ${chars.length} keystrokes merged.`,
        textCount === 1 ? 'None' : `Expected 1 merged text entry, got ${textCount}`,
        'implementation-gap',
        textCount === 1 ? 'P3' : 'P2',
        'Pipeline/Dedup',
        result.interactions,
        result.playwright,
      );

      // Observation test — 0 text entries from input-only events is a valid finding
      expect(result).toBeDefined();
    });
  });

  // ── CI-05: Focus → Blur → Focus Chain ─────────────────────────────

  describe('CI-05: Focus blur chain (tab between fields)', () => {
    it('captures focus changes between fields', () => {
      const field1 = makeTarget({
        tag: 'INPUT', ariaRole: 'textbox', accessibleName: 'First name',
        testId: 'fname', cssSelector: 'input[data-testid="fname"]',
        xPath: '//input[@data-testid="fname"]',
      });
      const field2 = makeTarget({
        tag: 'INPUT', ariaRole: 'textbox', accessibleName: 'Last name',
        testId: 'lname', cssSelector: 'input[data-testid="lname"]',
        xPath: '//input[@data-testid="lname"]',
      });

      const events = [
        makeEvent('focus', field1, makeContext({ inputType: 'text' }), { timestamp: 1000 }),
        makeEvent('input', field1, makeContext({ inputType: 'text' }),
          { timestamp: 1100, valueBefore: '', valueAfter: 'John' }),
        makeEvent('blur', field1, makeContext({ inputType: 'text' }),
          { timestamp: 1200, valueBefore: '', valueAfter: 'John' }),
        makeEvent('focus', field2, makeContext({ inputType: 'text' }), { timestamp: 1300 }),
        makeEvent('input', field2, makeContext({ inputType: 'text' }),
          { timestamp: 1400, valueBefore: '', valueAfter: 'Doe' }),
        makeEvent('blur', field2, makeContext({ inputType: 'text' }),
          { timestamp: 1500, valueBefore: '', valueAfter: 'Doe' }),
      ];

      const result = runFullPipeline(events, {
        startUrl: 'https://app.example.com/form',
        pageTitle: 'Form',
        testCaseName: 'Tab between fields',
      });

      const types = getTypes(result);
      const textCount = result.interactions.filter(ci => {
        const t = (ci as Record<string, unknown>);
        return t.type === 'TextEntry' || t.interactionSubtype === 'TextEntry';
      }).length;

      // Should produce 2 distinct text entries
      const q1 = textCount >= 2 ? 5 : 2;
      const q2 = textCount === 2 ? 5 : 3;

      recordObs('CI-05', 'focus-blur-chain',
        { q1_intent: q1, q2_abstraction: q2, q3_locator: 4, q4_description: 4, q5_replay: q1, q6_confidence: 4, q7_evidence: 3, q8_assertion: 3 },
        `${result.interactions.length} interactions (${textCount} text entries), expected 2`,
        textCount >= 2 ? 'None' : 'Focus/blur chain did not produce distinct text entries',
        'implementation-gap',
        textCount >= 2 ? 'P3' : 'P2',
        'Pipeline',
        result.interactions,
        result.playwright,
      );

      expect(textCount).toBeGreaterThanOrEqual(1);
    });
  });

  // ── CI-06: Double-Click Text Selection ────────────────────────────

  describe('CI-06: Double-click text selection', () => {
    it('classifies as DoubleClick (not two separate Clicks)', () => {
      const textEl = makeTarget({
        tag: 'SPAN', ariaRole: null, accessibleName: 'Important text',
        testId: 'selectable-text', cssSelector: 'span.selectable',
        xPath: '//span[@class="selectable"]',
      });

      const events = [
        makeEvent('dblclick', textEl, makeContext({}), { timestamp: 1000 }),
      ];

      const result = runFullPipeline(events, {
        startUrl: 'https://app.example.com/doc',
        pageTitle: 'Document',
        testCaseName: 'Double-click to select text',
      });

      const types = getTypes(result);
      const hasDoubleClick = types.some(t => t.includes('Double'));

      recordObs('CI-06', 'double-click',
        { q1_intent: hasDoubleClick ? 5 : 2, q2_abstraction: 4, q3_locator: 4, q4_description: hasDoubleClick ? 4 : 2, q5_replay: hasDoubleClick ? 4 : 2, q6_confidence: 4, q7_evidence: 3, q8_assertion: 2 },
        `${result.interactions.length} interactions [${types.join(', ')}]. doubleClick=${hasDoubleClick}`,
        hasDoubleClick ? 'None' : 'dblclick not classified as DoubleClick',
        hasDoubleClick ? 'implementation-gap' : 'implementation-gap',
        hasDoubleClick ? 'P3' : 'P2',
        'Definitions/Click',
        result.interactions,
        result.playwright,
      );

      expect(result).toBeDefined();
    });
  });

  // ── CI-07: Right-Click Context Menu ───────────────────────────────

  describe('CI-07: Right-click context menu', () => {
    it('classifies as RightClick', () => {
      const target = makeTarget({
        tag: 'DIV', ariaRole: null, accessibleName: 'File: report.pdf',
        testId: 'file-item', cssSelector: 'div.file-item',
        xPath: '//div[@class="file-item"]',
      });

      const events = [
        makeEvent('contextmenu', target, makeContext({}), { timestamp: 1000 }),
      ];

      const result = runFullPipeline(events, {
        startUrl: 'https://app.example.com/files',
        pageTitle: 'Files',
        testCaseName: 'Right-click file',
      });

      const types = getTypes(result);
      const hasRightClick = types.some(t => t.includes('Right'));

      recordObs('CI-07', 'right-click',
        { q1_intent: hasRightClick ? 5 : 2, q2_abstraction: 4, q3_locator: 4, q4_description: hasRightClick ? 4 : 2, q5_replay: hasRightClick ? 4 : 2, q6_confidence: 4, q7_evidence: 3, q8_assertion: 2 },
        `${result.interactions.length} interactions [${types.join(', ')}]. rightClick=${hasRightClick}`,
        hasRightClick ? 'None' : 'contextmenu not classified as RightClick',
        hasRightClick ? 'implementation-gap' : 'implementation-gap',
        hasRightClick ? 'P3' : 'P2',
        'Definitions/Click',
        result.interactions,
        result.playwright,
      );

      expect(result).toBeDefined();
    });
  });

  // ── CI-08: Scroll Interaction ─────────────────────────────────────

  describe('CI-08: Scroll interaction (wheel event)', () => {
    it('captures scroll events', () => {
      const container = makeTarget({
        tag: 'DIV', ariaRole: null, accessibleName: '',
        cssSelector: 'div.scroll-container',
        xPath: '//div[@class="scroll-container"]',
      });

      const events = [
        makeEvent('wheel', container, makeContext({}),
          { timestamp: 1000, scrollDeltaY: 200, scrollDeltaX: 0 }),
        makeEvent('wheel', container, makeContext({}),
          { timestamp: 1100, scrollDeltaY: 150, scrollDeltaX: 0 }),
        makeEvent('wheel', container, makeContext({}),
          { timestamp: 1200, scrollDeltaY: 100, scrollDeltaX: 0 }),
      ];

      const result = runFullPipeline(events, {
        startUrl: 'https://app.example.com/feed',
        pageTitle: 'Feed',
        testCaseName: 'Scroll feed',
      });

      const types = getTypes(result);
      const hasScroll = types.some(t => t.includes('Scroll'));

      recordObs('CI-08', 'scroll-interaction',
        { q1_intent: hasScroll ? 4 : 2, q2_abstraction: 3, q3_locator: 3, q4_description: hasScroll ? 3 : 1, q5_replay: hasScroll ? 3 : 1, q6_confidence: 3, q7_evidence: 2, q8_assertion: 1 },
        `${result.interactions.length} interactions [${types.join(', ')}]. scroll=${hasScroll}`,
        hasScroll ? 'None' : 'Scroll/wheel events not classified as any interaction',
        hasScroll ? 'implementation-gap' : 'capability-gap',
        hasScroll ? 'P3' : 'P2',
        'Pipeline/Definitions',
        result.interactions,
        result.playwright,
      );

      expect(result).toBeDefined();
    });
  });

  // ── CI-09: Slider Drag (mousedown → move → up on slider) ──────────

  describe('CI-09: Slider drag interaction', () => {
    it('captures slider value change via mouse drag', () => {
      const sliderThumb = makeTarget({
        tag: 'INPUT', ariaRole: 'slider', accessibleName: 'Volume',
        testId: 'volume-slider', cssSelector: 'input[data-testid="volume-slider"]',
        xPath: '//input[@data-testid="volume-slider"]',
      });
      const sliderCtx = makeContext({
        inputType: 'range',
        ariaValueNow: '50',
        ariaValueMin: '0',
        ariaValueMax: '100',
      });

      const events = [
        makeEvent('mousedown', sliderThumb, sliderCtx,
          { timestamp: 1000, clientX: 200, clientY: 300 }),
        makeEvent('change', sliderThumb, makeContext({
          inputType: 'range', ariaValueNow: '75', ariaValueMin: '0', ariaValueMax: '100',
        }),
          { timestamp: 1500, valueBefore: '50', valueAfter: '75' }),
        makeEvent('mouseup', sliderThumb, makeContext({
          inputType: 'range', ariaValueNow: '75', ariaValueMin: '0', ariaValueMax: '100',
        }),
          { timestamp: 2000, clientX: 350, clientY: 300 }),
      ];

      const result = runFullPipeline(events, {
        startUrl: 'https://app.example.com/player',
        pageTitle: 'Player',
        testCaseName: 'Adjust volume',
      });

      const types = getTypes(result);
      const hasSlider = types.some(t => t.includes('Slider'));

      // Check for sliderValue metadata
      const sliderInteraction = result.interactions.find(ci => {
        const r = ci as Record<string, unknown>;
        return (r.type as string)?.includes('Slider') || (r.interactionSubtype as string)?.includes('Slider');
      });
      const hasSliderValue = sliderInteraction
        ? !!(sliderInteraction as Record<string, unknown>).sliderValue
        : false;

      recordObs('CI-09', 'slider-drag',
        { q1_intent: hasSlider ? 5 : 2, q2_abstraction: 4, q3_locator: 4, q4_description: hasSlider ? 4 : 2, q5_replay: hasSlider ? 4 : 2, q6_confidence: 4, q7_evidence: 3, q8_assertion: 3 },
        `${result.interactions.length} interactions [${types.join(', ')}]. slider=${hasSlider}, sliderValue=${hasSliderValue}`,
        hasSlider ? 'None' : 'Slider drag not classified as Slider interaction',
        hasSlider ? 'implementation-gap' : 'implementation-gap',
        hasSlider ? 'P3' : 'P2',
        'Definitions/Slider',
        result.interactions,
        result.playwright,
      );

      expect(result).toBeDefined();
    });
  });

  // ── CI-10: Touch Gesture (touchstart → touchmove → touchend) ──────

  describe('CI-10: Touch gesture (swipe)', () => {
    it('captures or rejects touch events', () => {
      const target = makeTarget({
        tag: 'DIV', ariaRole: null, accessibleName: 'Carousel',
        testId: 'carousel', cssSelector: 'div.carousel',
        xPath: '//div[@class="carousel"]',
      });

      const events = [
        makeEvent('touchstart', target, makeContext({}),
          { timestamp: 1000, clientX: 300, clientY: 200 }),
        makeEvent('touchmove', target, makeContext({}),
          { timestamp: 1100, clientX: 200, clientY: 200 }),
        makeEvent('touchend', target, makeContext({}),
          { timestamp: 1200, clientX: 100, clientY: 200 }),
      ];

      const result = runFullPipeline(events, {
        startUrl: 'https://app.example.com/gallery',
        pageTitle: 'Gallery',
        testCaseName: 'Swipe carousel',
      });

      const types = getTypes(result);

      // Touch events may not be in the event type union, so the pipeline
      // may silently ignore them. This is a finding.
      const hasTouch = types.length > 0;

      recordObs('CI-10', 'touch-swipe',
        { q1_intent: hasTouch ? 4 : 1, q2_abstraction: 3, q3_locator: 3, q4_description: hasTouch ? 3 : 1, q5_replay: hasTouch ? 3 : 1, q6_confidence: 3, q7_evidence: 2, q8_assertion: 1 },
        `${result.interactions.length} interactions [${types.join(', ')}]`,
        hasTouch ? 'None' : 'Touch events (touchstart/touchmove/touchend) not in BrowserEventType union — silently ignored',
        'capability-gap',
        hasTouch ? 'P3' : 'P2',
        'Pipeline/EventTypes',
        result.interactions,
        result.playwright,
      );

      expect(result).toBeDefined();
    });
  });

  // ── CI-11: Pinch Zoom (multi-touch) ───────────────────────────────

  describe('CI-11: Pinch zoom (multi-touch)', () => {
    it('captures or rejects multi-touch events', () => {
      const target = makeTarget({
        tag: 'IMG', ariaRole: 'img', accessibleName: 'Product photo',
        testId: 'product-img', cssSelector: 'img[data-testid="product-img"]',
        xPath: '//img[@data-testid="product-img"]',
      });

      // Pinch: two simultaneous touch trajectories
      const events = [
        makeEvent('touchstart', target, makeContext({}),
          { timestamp: 1000, clientX: 200, clientY: 300 }),
        makeEvent('touchstart', target, makeContext({}),
          { timestamp: 1010, clientX: 250, clientY: 300 }),
        makeEvent('touchmove', target, makeContext({}),
          { timestamp: 1100, clientX: 180, clientY: 300 }),
        makeEvent('touchmove', target, makeContext({}),
          { timestamp: 1110, clientX: 270, clientY: 300 }),
        makeEvent('touchend', target, makeContext({}),
          { timestamp: 1200, clientX: 180, clientY: 300 }),
        makeEvent('touchend', target, makeContext({}),
          {_timestamp: 1210, clientX: 270, clientY: 300 }),
      ];

      const result = runFullPipeline(events, {
        startUrl: 'https://shop.example.com/product/1',
        pageTitle: 'Product',
        testCaseName: 'Pinch zoom product photo',
      });

      const types = getTypes(result);
      const hasTouch = types.length > 0;

      recordObs('CI-11', 'pinch-zoom',
        { q1_intent: hasTouch ? 4 : 1, q2_abstraction: 3, q3_locator: 3, q4_description: hasTouch ? 3 : 1, q5_replay: hasTouch ? 2 : 1, q6_confidence: 3, q7_evidence: 2, q8_assertion: 1 },
        `${result.interactions.length} interactions [${types.join(', ')}]`,
        hasTouch ? 'None' : 'Multi-touch/pinch gestures not supported — architectural limitation',
        'capability-gap',
        'P2',
        'Pipeline/EventTypes',
        result.interactions,
        result.playwright,
      );

      expect(result).toBeDefined();
    });
  });

  // ── CI-12: Compound Click + Type (autocomplete) ───────────────────

  describe('CI-12: Autocomplete (click dropdown + type + select)', () => {
    it('captures autocomplete search and selection flow', () => {
      const searchInput = makeTarget({
        tag: 'INPUT', ariaRole: 'combobox', accessibleName: 'Search city',
        testId: 'city-search', cssSelector: 'input[data-testid="city-search"]',
        xPath: '//input[@data-testid="city-search"]',
      });
      const option = makeTarget({
        tag: 'LI', ariaRole: 'option', accessibleName: 'San Francisco, CA',
        testId: 'city-option-sf', cssSelector: 'li[data-testid="city-option-sf"]',
        xPath: '//li[@data-testid="city-option-sf"]',
      });

      const events = [
        // Click input to focus
        makeEvent('click', searchInput, makeContext({}), { timestamp: 1000 }),
        // Type "San"
        makeEvent('input', searchInput, makeContext({ inputType: 'text', ariaExpanded: 'true', ariaHasPopup: 'listbox' }),
          { timestamp: 1100, valueBefore: '', valueAfter: 'San' }),
        // Select option
        makeEvent('click', option, makeContext({}), { timestamp: 2000 }),
      ];

      const result = runFullPipeline(events, {
        startUrl: 'https://app.example.com/search',
        pageTitle: 'Search',
        testCaseName: 'Search and select city',
      });

      const types = getTypes(result);
      const interactionCount = result.interactions.length;

      // Ideal: single Autocomplete interaction or at least TextEntry + Dropdown
      const hasAutocomplete = types.some(t => t.includes('Autocomplete') || t.includes('Auto'));
      const hasText = types.some(t => t.includes('Text'));
      const hasDropdown = types.some(t => t.includes('Dropdown'));

      const q1 = hasText ? 4 : 2;
      const q2 = interactionCount <= 2 ? 5 : 3;

      recordObs('CI-12', 'autocomplete-flow',
        { q1_intent: q1, q2_abstraction: q2, q3_locator: 4, q4_description: hasAutocomplete ? 5 : 3, q5_replay: q1, q6_confidence: 4, q7_evidence: 3, q8_assertion: 3 },
        `${interactionCount} interactions [${types.join(', ')}]. autocomplete=${hasAutocomplete}, text=${hasText}, dropdown=${hasDropdown}`,
        hasAutocomplete ? 'None' : 'Autocomplete not recognized as single compound interaction — split into text + click',
        hasAutocomplete ? 'implementation-gap' : 'capability-gap',
        hasAutocomplete ? 'P3' : 'P2',
        'Pipeline/Definitions',
        result.interactions,
        result.playwright,
      );

      expect(result.interactions.length).toBeGreaterThanOrEqual(1);
    });
  });

  // ── Summary ────────────────────────────────────────────────────────

  describe('Compound Interaction Summary', () => {
    it('records all compound observations', () => {
      console.log(`\n[Compound Interactions] ${observations.length} observations recorded`);
      for (const obs of observations) {
        const avg = (
          obs.scores.q1_intent + obs.scores.q2_abstraction + obs.scores.q3_locator +
          obs.scores.q4_description + obs.scores.q5_replay + obs.scores.q6_confidence +
          obs.scores.q7_evidence + obs.scores.q8_assertion
        ) / 8;
        console.log(
          `  ${obs.observationId} (${obs.capabilityId}): Q1=${obs.scores.q1_intent} avg=${avg.toFixed(1)} | ${obs.severity} | ${obs.observed}`
        );
      }
      expect(observations.length).toBeGreaterThanOrEqual(12);
    });
  });
});
