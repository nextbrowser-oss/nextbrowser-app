# Shared UI

Import components through `shared/ui` or a component directory's `index.ts`. Shared components must stay independent of product state and Electron. Colors come from the application palette.

Use `glassSurfaceClassName` for the common floating material: smoky dark glass in both themes, white text, borderless surfaces, 18px blur and a restrained shadow. Background, foreground, controls, radius and filter come from palette tokens. Keep size and shape in the consuming component; `shared-scrollbarless` hides a scrollbar without disabling scrolling. Do not add another per-feature glass formula.

- `Tooltip` / `TooltipProvider` / `TooltipContent`: common hint interaction and glass surface. See [usage](tooltip/README.md).
- `IconButton`: circular action with a required accessible `label`, optional `hint`, forwarded native button props/ref, and the shared Tooltip. Pass an icon as children. Optional `text` makes it a labelled pill; `size="small"` gives a compact 28px action. `appearance="glass"` uses the common material; `appearance="embedded"` uses its translucent controls.
- `FileDropArea`: file-only drag feedback around its children, with nested-entry tracking and cleanup on leave/drop/Escape/window blur/drag cancellation. `onFiles` receives dropped files; the caller handles paths, attachments and storage. `disabled` rejects drops and displays `unavailableLabel` instead of silently accepting them. Text dragging is unaffected.
- `Glyph`: a curated monoline Lucide set for navigation with a consistent 1.5px stroke. Pass semantic action names through the surrounding control's accessible label. Reuse `IconButton appearance="plain"` for neutral chrome controls.
- `Popover`: a controlled, non-modal glass dialog anchored to a trigger rendered with its provided native button props/ref. Pass `label`, `open`, `onOpenChange`, `trigger` and content. It portals outside clipping containers, clamps to the viewport, focuses content, dismisses on Escape/outside pointer/focus departure, and restores trigger focus after selection. Use `align="start"` and `boundaryRef` to keep a popup inside its content pane, clear of adjacent navigation. Product lists, forms and actions stay in the caller.
- `CommandList`: a glass listbox above the caller's composer. Pass the composer element as `anchor` to portal outside backdrop/clipping roots and follow its viewport geometry. Pass option IDs, labels/descriptions, the active ID and `onChoose`. It preserves input focus on pointer selection and exposes stable option IDs for `aria-activedescendant`; the caller handles filtering, keyboard navigation and execution.
- `OverlayScrollArea`: scrollable content with an `overlay` slot at the bottom. The measured inset keeps the last item reachable as overlay height changes. Optional `endButtonLabel` enables a centered glass action above the overlay when content is scrolled up. `autoFollow` follows incoming content only while the reader is at the bottom; `resetKey` starts a new document/conversation at the end. The action respects reduced motion. Pass product classes through `contentClassName` and `overlayClassName`; keep send, attachment and other business behavior in the caller.

```tsx
<OverlayScrollArea contentClassName="messages" overlayClassName="message-dock" overlay={
  <div className={glassSurfaceClassName}>
    <textarea aria-label="Message" />
    <IconButton label="Send message" appearance="embedded" onClick={onSend}>
      <SendIcon />
    </IconButton>
  </div>
}>
  {messages}
</OverlayScrollArea>
```

Validation: `npm run test:tooltips` exercises common hints, while `npm run test:composer` mounts the real ChatView with disposable state in Chromium, blocks external traffic and checks overlay scrolling, both themes, draft entry, send/stop, attachments and compact windows. Set `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` if Chrome/Edge is not installed in a standard location. Reports and screenshots go to ignored `e2e-out`.
