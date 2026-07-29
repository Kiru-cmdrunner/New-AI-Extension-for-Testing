# Milestone 1: Discovery Validation — Multi-Framework Benchmark Suite

## Objective

Validate that the W3C-based discovery algorithm can identify logical UI 
controls across a diverse set of modern web frameworks, component libraries, 
and interaction patterns — before committing to the full Control Model 
architecture.

## Benchmark Suite

Each target is a publicly accessible demo page (no authentication required).

| # | Framework/Library | Demo URL | What It Tests |
|---|------------------|----------|---------------|
| 1 | OrangeHRM (OXD) | opensource-demo.orangehrmlive.com | Custom non-ARIA components |
| 2 | Material UI | mui.com/material-ui/react-button/ | React + emotion CSS |
| 3 | Ant Design | ant.design/components/button | React + less CSS |
| 4 | Bootstrap | getbootstrap.com/docs/5.3/examples/ | Classic CSS framework |
| 5 | Shoelace | shoelace.style/components | Web Components (open shadow) |
| 6 | Lit | lit.dev/playground | Web Components (light + shadow) |
| 7 | Ionic | ionicframework.com/docs/components | Mobile-first components |
| 8 | PrimeReact | primereact.org/button | React enterprise components |
| 9 | Fluent UI | fluentui.microsoft.com/components | Microsoft design system |
| 10 | React Spectrum | react-spectrum.adobe.com/react-spectrum | Adobe design system |

## Discovery Algorithm

For each element in the DOM:
1. Compute `role` via: explicit `[role]` → implicit tag mapping → input type mapping
2. Compute `accessibleName` via: aria-label → aria-labelledby → label[for] → wrapping label → textContent → title → placeholder
3. If role is a W3C widget role → classify as control
4. If no role but tag is interactive (button, a, input, select, textarea) → classify as control
5. Record: element tag, computed role, computed name, classes, depth

## Classification

For each discovered control:
- **Correct**: element is genuinely interactive, role is semantically accurate
- **Missed**: element is interactive but not discovered (no role, not a native tag)
- **Misclassified**: discovered as a control but with wrong role

## Output: Compatibility Matrix

For each framework:
- Total interactive elements (manually verified)
- Discovered correctly
- Missed
- Misclassified
- Coverage rate
- Failure categorization (ARIA gap, framework pattern needed, architecture gap)
