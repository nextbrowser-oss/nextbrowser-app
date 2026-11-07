# Tooltip

Public API: `Tooltip`, `TooltipProvider`, `TooltipContent`, `TooltipAnchor`, `TooltipSide`, exported from `shared/ui` and this directory's `index.ts`.

Mount `TooltipProvider` once at application initialization (already done in `src/main.tsx`). Wrap one native DOM element:

```tsx
import { Tooltip } from "../shared/ui";

<Tooltip content="Connect an account first" side="top">
  <button disabled={!connected} onClick={send}>Send</button>
</Tooltip>
```

The child remains the same DOM element: no layout wrapper, ref replacement or handler replacement. Disabled buttons retain hints. Icon-only buttons and links receive a fallback accessible name from string content; provide an explicit `aria-label` when the action name differs from the explanation. Text labels and existing accessible names are preserved. Empty content adds no hint.

Hover opens after a short delay; keyboard focus opens immediately. Escape dismisses the hint before its parent dialog. Hints are portalled to the document body, flip at viewport edges, remain hoverable for reading long content, and close on outside interaction or scrolling. Use passive text in hints; interactive controls belong in a popover or dialog.

Use `TooltipContent` for controlled rich content such as a chart. Supply an element or a virtual `TooltipAnchor` with `getBoundingClientRect()`, a stable `id`, rich children, and `interactive={false}` when pointer events should pass through. The caller owns visibility and `aria-describedby` for this lower-level API. Both APIs share the same positioning and glass surface.

Style and theme tokens are centralized in `tooltip.css` and `src/palette.css`. Do not add per-feature tooltip shells, native `title` hints or CSS pseudo-element variants. Semantic iframe `title` attributes are unrelated to hover hints.

Validation: the regular Vitest suite covers interactions, product integration and shared-layer boundaries. `npm run test:tooltips` runs an isolated Chromium fixture against the actual component and palette in both themes, including real keyboard focus, disabled hover, clipping and viewport bounds. It uses an installed Chrome/Edge or the browser at `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH`; screenshots go to ignored `e2e-out/shared-tooltips`.
