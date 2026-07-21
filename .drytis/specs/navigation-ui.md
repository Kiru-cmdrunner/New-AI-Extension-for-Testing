# Navigation UI Completion — Breadcrumb & Menu

## Goal
Complete detection for Breadcrumb and Menu interactions. These types exist in the enum but have incomplete or missing detection logic, no CSS class patterns for Breadcrumb, and no timeline phrasing for either.

## Current State

| Type | Enum | V1 Detection | V2 Detection | CSS Patterns | Timeline | Tests |
|------|------|-------------|-------------|-------------|----------|-------|
| **Link** | ✅ | ✅ tag=A / role=link | ✅ DomProvider + AriaProvider | ✅ nav-link (Bootstrap) | ✅ `Click "X"` | ✅ |
| **Tab** | ✅ | ✅ role=tab | ✅ AriaProvider + CssClassnameProvider | ✅ MUI/AntD/Bootstrap/Generic | ✅ `Click "X" tab` | ✅ |
| **Menu** | ✅ | ✅ role=menuitem | ⚠️ AriaProvider intentionally skips menuitem | ❌ No nav-menu patterns | ❌ Falls through to default | ❌ |
| **Breadcrumb** | ✅ | ❌ No detection | ❌ No detection | ❌ None | ❌ No case | ❌ |

## Gaps

1. **Breadcrumb** — no detection at all (V1, V2, CSS, timeline)
2. **Menu** — no timeline phrasing case (falls through to generic default)
3. **Menu** — no CSS class patterns for navigation menus (AntD menu, Bootstrap navbar)
4. **No tests** for either type

## Design Decision: Breadcrumb vs Link

Breadcrumbs are a specialized form of navigation — they show the user's location in a hierarchy. A breadcrumb click is semantically different from a generic link click:
- **Link**: `Click "About Us"` — user navigates to a page
- **Breadcrumb**: `Click "Products" breadcrumb` — user navigates up the hierarchy

Detection signals for Breadcrumb:
- CSS classes: `breadcrumb-item`, `breadcrumb-link`, `ant-breadcrumb-link`, `crumb`
- ARIA: `aria-current="page"` on the current breadcrumb, `nav[aria-label="Breadcrumb"]`
- Container structure: element inside a `.breadcrumb` container

Since the Evidence Engine works at the element level (not container level), we detect breadcrumbs primarily via CSS class patterns on the clicked element itself.

## Design Decision: Menu vs CustomDropdown

The existing CssClassnameProvider maps `dropdown-item` and `menu-item` to `CustomDropdown`. This is correct for dropdown context (select-like menus) but wrong for navigation menus. The distinction:

- **CustomDropdown**: `dropdown-item` inside a `.dropdown` — form/select context
- **Menu**: `menu-item` inside a `.menu` / `.navbar` — navigation context

Since CSS alone can't reliably distinguish these, we keep the existing CustomDropdown mapping for `dropdown-item` and focus Menu detection on:
- ARIA `role="menuitem"` (already in V1 detector)
- Navigation-specific menu classes: `navbar-nav`, `nav-item`, `sidebar-menu`, `menu-link`

## Implementation

### Phase 1: Metadata

Add to `InteractionMetadata`:
```typescript
// Breadcrumb
breadcrumbLevel?: number;     // position in the breadcrumb trail (if detectable)
breadcrumbPath?: string[];    // full trail of breadcrumb names (if available)
```

### Phase 2: CSS Classname Provider

#### MUI
```typescript
'Breadcrumbs': { type: 'Breadcrumb', confidence: 0.85, weight: 0.8 },
```

#### AntD
```typescript
'breadcrumb-link':   { type: 'Breadcrumb', confidence: 0.85, weight: 0.8 },
'breadcrumb':        { type: 'Breadcrumb', confidence: 0.75, weight: 0.7 },
```

#### Bootstrap
```typescript
'breadcrumb-item':   { type: 'Breadcrumb', confidence: 0.85, weight: 0.8 },
```

#### Generic
```typescript
// Breadcrumb patterns — must be checked before generic menu/nav patterns
if (lower.includes('breadcrumb') || lower.includes('crumb')) {
  return { type: 'Breadcrumb', confidence: 0.75, weight: 0.7, framework: 'Generic' };
}
// Navigation menu patterns (not dropdown menus)
if (lower.includes('navbar-item') || lower.includes('sidebar-item') || lower.includes('menu-link') || lower.includes('nav-menu')) {
  return { type: 'Menu', confidence: 0.7, weight: 0.65, framework: 'Generic' };
}
```

### Phase 3: V2 DomProvider

Add breadcrumb detection to `onEvent()`:
```typescript
// ── Breadcrumb link ──
{
  const className = (event.target.className || '').toLowerCase();
  if (className.includes('breadcrumb') || className.includes('crumb')) {
    if (event.eventType === 'click' || event.eventType === 'auxclick') {
      evidence.push({
        provider: this.name,
        suggestedType: 'Breadcrumb' as InteractionType,
        confidence: 0.85,
        weight: 0.8,
        metadata: extractNameMetadata(event),
        reason: `Breadcrumb element detected (CSS class contains breadcrumb/crumb)`,
      });
    }
  }
}
```

Add navigation menu detection:
```typescript
// ── Navigation menu item ──
{
  const className = (event.target.className || '').toLowerCase();
  if ((className.includes('navbar-item') || className.includes('sidebar-item') || className.includes('menu-link')) &&
      (event.eventType === 'click' || event.eventType === 'auxclick')) {
    evidence.push({
      provider: this.name,
      suggestedType: 'Menu' as InteractionType,
      confidence: 0.75,
      weight: 0.7,
      metadata: extractNameMetadata(event),
      reason: `Navigation menu element detected`,
    });
  }
}
```

### Phase 4: V1 Interaction Detector

Add Breadcrumb detection BEFORE the Link section (so breadcrumb clicks aren't classified as generic Links):
```typescript
// ── Breadcrumb ──
{
  const className = (target.className || '').toLowerCase();
  if (className.includes('breadcrumb') || className.includes('crumb')) {
    return {
      type: 'Breadcrumb',
      metadata: { accessibleName: target.accessibleName ?? undefined },
      confidence: 1.0,
    };
  }
}
```

### Phase 5: Timeline Renderer

Add Breadcrumb case:
```typescript
case 'Breadcrumb':
  return targetName
    ? `Click "${targetName}" breadcrumb`
    : 'Click breadcrumb';
```

Add Menu case:
```typescript
case 'Menu':
  return targetName
    ? `Click "${targetName}" menu item`
    : 'Click menu item';
```

## Timeline Examples
- Breadcrumb: `Click "Products" breadcrumb`
- Menu: `Click "Settings" menu item`
- Link (unchanged): `Click "About Us"`

## Files to Change

| File | Change |
|------|--------|
| `src/classifier/interaction-types.ts` | Add breadcrumbLevel, breadcrumbPath to InteractionMetadata |
| `src/classifier/evidence/providers/css-classname-provider.ts` | MUI/AntD/Bootstrap/Generic breadcrumb + nav-menu patterns |
| `src/classifier/evidence/providers/dom-provider.ts` | Breadcrumb + nav-menu element detection |
| `src/classifier/interaction-detector.ts` | V1 Breadcrumb detection before Link |
| `src/sidepanel/timeline-renderer.ts` | Breadcrumb + Menu phrasing |
| `tests/evidence-engine/navigation-ui.test.ts` | NEW — comprehensive tests |

## Acceptance Criteria

### Breadcrumb
- [ ] Bootstrap `breadcrumb-item` CSS → Breadcrumb
- [ ] AntD `ant-breadcrumb-link` CSS → Breadcrumb
- [ ] MUI `MuiBreadcrumbs` CSS → Breadcrumb
- [ ] Generic `breadcrumb`/`crumb` CSS → Breadcrumb
- [ ] Breadcrumb click NOT classified as Link
- [ ] Timeline: `Click "Products" breadcrumb`

### Menu
- [ ] `role="menuitem"` → Menu (V1, already works)
- [ ] Generic nav-menu CSS (`navbar-item`, `sidebar-item`, `menu-link`) → Menu
- [ ] Timeline: `Click "Settings" menu item`

### Regression
- [ ] Link detection unaffected (nav-link still → Link)
- [ ] Tab detection unaffected
- [ ] CustomDropdown unaffected (dropdown-item still → CustomDropdown)
- [ ] Click detection unaffected
- [ ] All 2537 existing tests pass
