# FractalUI Tree

Adapted from [0nliner/fractalUI Tree](https://github.com/0nliner/fractalUI/blob/5935885bc43e245b5cf11c17288b5908d53d87ba/packages/primitives/src/Tree/Tree.tsx), revision `5935885bc43e245b5cf11c17288b5908d53d87ba`, under the included [MIT license](LICENSE).

The license is also copied to `public/licenses/fractalui-tree.txt` so it ships with the built renderer.

The component's tree, selection, search/facets, keyboard, rename and drag/drop behavior is reused. Its vanilla-extract class bindings are replaced with local CSS using the application palette; no FractalUI theme or package-wide dependency is imported. Local additions: controlled search, accessible labels/levels, a `canDrop` validator used for both feedback and mutation, disabled dragging during search, and F2 scoped to this tree's focus. Product IDs, persistence and move rules stay in the caller.
