# Real-World Recording Instructions

## Avis Ford Recording

1. **Open** avisford.com/service-appointment.aspx
2. **Open** the extension side panel (click the extension icon)
3. **Click Start Recording** in the side panel
4. **Interact with the form:**
   - Click "New Customer"
   - Type a VIN (any 17 characters)
   - Select a Make
   - Select a Year
   - Type mileage
   - Scroll the page at least once
5. **Click Stop Recording** in the side panel
6. **Open Browser Console** (F12 → Console tab)
7. **Filter** the console by typing `Merge` or `Evidence` in the filter box
8. **Screenshot** the console output showing the Merge Metrics box
9. **Screenshot** the side panel showing Detected Interactions
10. **Share** both screenshots

## What to Look For

After Stop, the console should show:
```
══════════════════════════════════════════════════
  Merge Metrics
══════════════════════════════════════════════════
  V2 (Evidence Engine):     N interactions (N%)
  V1 (Fallback):            N interactions (N%)
  ...
══════════════════════════════════════════════════
```

If you don't see it, search the console for any of these keywords:
- `Merge Metrics`
- `Evidence Engine`
- `CMDRUNNER`
- `Classifier disagreement`

## Console Filter Tip

The Avis Ford page produces hundreds of console messages from its own tracking scripts.
Type `Merge` in the console filter box to isolate extension output.

## If No Merge Metrics Appear

This could mean:
- The events from the cross-origin iframe aren't reaching the service worker
- The STOP_RECORDING handler isn't running the merge
- The extension needs to be reloaded (chrome://extensions → click reload)

## Alternative: Use the Extension's Storage Inspector

If the console is too noisy:
1. Go to chrome://extensions
2. Click "Service Worker" under the extension (or click "Inspect views: service worker")
3. This opens a dedicated DevTools for the service worker
4. Click Stop Recording on a new recording
5. The Merge Metrics will appear in THIS console (not the page console)

The service worker console is much cleaner — no page noise.
