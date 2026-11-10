# Shared layer

- Check existing public exports before adding a UI primitive; reuse and extend them before making a duplicate.
- Keep this layer product-independent. Do not import the application store, product types, legacy `components`/`lib`, Electron bridge, or higher FSD layers.
- Publish APIs from a segment or component directory index. Do not create a root `shared/index.ts` barrel. Consumers must not import private implementation files.
- Use relative imports inside a component module to avoid barrel cycles.
- Read theme values from `src/palette.css` tokens. Do not put raw UI colors in component CSS or TSX.
- All hover hints use `ui/tooltip`: `Tooltip` for one native DOM element, `TooltipContent` for a caller-controlled surface. Preserve accessible names, existing refs and event handlers, and disabled state.
- Test actual interaction and boundary behavior when changing a shared interactive primitive.
