# Milestone 2: Event Matching Validation

## Architectural Question
Given a real DOM event (click on an icon inside a button, click on an OXD 
dropdown trigger, click on a radio label), can we correctly identify the 
logical control the user interacted with?

## What to Build
1. Control Model populated from discovery (Milestone 1 algorithms)
2. WeakMap<Element, ControlNode> index for O(1) lookup
3. Event matcher: composedPath() → WeakMap lookup → nearest ControlNode
4. Decorative element fallback: walk path ancestors when path[0] is unbound

## What to Test
On OrangeHRM "My Info" page:
- Click on `<i>` icon inside Save button → must match Save button
- Click on OXD Nationality dropdown trigger → must match the dropdown control
- Click on Gender radio wrapper → must match the radio input
- Click on Smoker checkbox wrapper → must match the checkbox input
- Click on a nav link icon → must match the link

On MUI/Ant Design (ARIA-compliant baseline):
- Click on button with nested spans → must match button
- Click on combobox trigger → must match combobox

## Success Criteria
- Every test click resolves to the correct logical control
- No "Click 'I'" or wrong-control associations
- Decorative element fallback works for icons inside interactive elements
