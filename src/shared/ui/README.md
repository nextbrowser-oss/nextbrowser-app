# Shared UI

Import components through `shared/ui` or a component directory's `index.ts`. Shared components must stay independent of product state and Electron. Colors come from the application palette.

- `Tooltip` / `TooltipProvider` / `TooltipContent`: common hint interaction and glass surface. See [usage](tooltip/README.md).
- `IconButton`: circular action with a required accessible `label`, optional `hint`, forwarded native button props/ref, and the shared Tooltip. Pass an icon as children. Optional `text` makes it a labelled pill; `size="small"` gives a compact 28px action. `appearance="glass"` is standalone; `appearance="embedded"` uses translucent controls inside an inverse glass surface.
- `FileDropArea`: file-only drag feedback around its children, with nested-entry tracking and cleanup on leave/drop/Escape/window blur/drag cancellation. `onFiles` receives dropped files; the caller handles paths, attachments and storage. `disabled` rejects drops and displays `unavailableLabel` instead of silently accepting them. Text dragging is unaffected.
- `Glyph`: a curated monoline Lucide set for navigation with a consistent 1.5px stroke. Pass semantic action names through the surrounding control's accessible label. Reuse `IconButton appearance="plain"` for neutral chrome controls.
- `OverlayScrollArea`: scrollable content with an `overlay` slot at the bottom. The overlay remains above content; a measured inset makes the last item reachable when overlay height changes. It keeps the view at the bottom only if it was already there, preserving a reader's position in older content. Pass product classes through `contentClassName` and `overlayClassName`; keep send, attachment and other business behavior in the caller.

```tsx
<OverlayScrollArea contentClassName="messages" overlayClassName="message-dock" overlay={
  <div className="inverse-glass-panel">
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
