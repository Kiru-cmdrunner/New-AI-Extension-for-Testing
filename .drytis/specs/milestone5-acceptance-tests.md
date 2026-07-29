# Milestone 5: End-to-End Acceptance Tests

## Goal
Validate the Control Model pipeline end-to-end: Discovery → Event Matching → 
State Tracking → Interaction Recognition. Test against representative DOM
structures for every interaction type from the behavioural acceptance suite.

## Architecture Under Test
This milestone integrates the proven components from M1-M4 into a single
pipeline and simulates real user interactions against realistic DOM structures.

```
DOM → ControlModel.discover() → MutationObserver active
  ↓
User Event (click/input/keydown) → Event Matcher (composedPath + WeakMap)
  ↓
Control identified → State Tracker checks before/after state
  ↓
SemanticAction emitted: { verb, target, value, name, role }
```

## Test Coverage

### Individual Interaction Types (from behavioural suite)
1. Text Entry — click+type+blur → Fill
2. Dropdown (OXD) — click trigger + click option → Select
3. Radio Button — click label → Select
4. Checkbox — click wrapper → Toggle
5. Button Click — click icon inside button → Click
6. Navigation — click link → Navigate
7. Scroll — coalesced burst → single Scroll
8. Hover — mouseenter with state change → Hover (deferred)

### Compound Interactions
9. Dropdown lifecycle: open → select → close
10. Date picker lifecycle: open → navigate → select day
11. Checkbox double-event suppression (OXD label→input)

### The Original Failure: OrangeHRM My Info
12. Full 9-step My Info workflow against OXD DOM
13. No v10.4.18 bugs reproduce (Nationality→BloodType, Click "I", etc.)

### Multi-Framework Coverage
14. Semantic HTML forms
15. MUI components
16. Ant Design components

## Acceptance Criteria
- [ ] Every interaction type produces correct verb + target + value
- [ ] No v10.4.18 bugs reproduce
- [ ] Compound interactions are not fragmented
- [ ] No spurious steps from decorative elements
- [ ] Multi-framework coverage verified
