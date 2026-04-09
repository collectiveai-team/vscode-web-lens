# Design: Version Badge in Overflow Menu

**Date:** 2026-04-09  
**Status:** Approved

## Summary

Add a non-interactive version footer at the bottom of the overflow (three-dot) menu in the webview toolbar, displaying the current extension version (e.g. `v0.2.11`).

## Architecture

The version string is injected into the webview JS bundle as a compile-time constant `__EXTENSION_VERSION__` via esbuild's `define` option. The value is read dynamically from `package.json` during the build so it stays in sync automatically with no manual updates required.

No runtime messaging, no webview init message changes, no DOM dataset attributes.

## Files Changed

1. **`esbuild.mjs`** — Add `define: { __EXTENSION_VERSION__: JSON.stringify(pkg.version) }` where `pkg` is the parsed `package.json`. Read `package.json` at the top of the build script.

2. **`src/webview/toolbar.ts`** — Add `declare const __EXTENSION_VERSION__: string;` ambient declaration. Append a version footer element at the bottom of the `#overflow-menu` HTML template.

3. **`webview/main.css`** — Add `.overflow-menu-version` style rule.

## Component

The version footer is a `<div>` (not a `<button>`) so it is non-interactive and will not trigger menu close logic or hover styles.

Structure appended to the end of `#overflow-menu`:

```html
<div class="overflow-menu-separator"></div>
<div class="overflow-menu-version">v__EXTENSION_VERSION__</div>
```

At runtime the constant is replaced by esbuild, e.g.: `v0.2.11`.

The second separator visually separates the storage items from the version footer.

## Styling

```css
.overflow-menu-version {
  padding: 4px 12px;
  font-size: 11px;
  color: var(--vscode-descriptionForeground);
  text-align: center;
  user-select: none;
  cursor: default;
}
```

- Uses `var(--vscode-descriptionForeground)` for a muted, clearly non-actionable appearance.
- Font size 11px — smaller than menu items (13px) to read as metadata.
- `user-select: none` and `cursor: default` reinforce non-interactivity.
- Padding matches the horizontal rhythm of the existing menu items.

## Non-Goals

- No click handler — version is display-only.
- No copy-to-clipboard on click.
- No link to changelog or release notes.
- No dynamic version checking or update indicator.

## Testing

Purely additive DOM and CSS change. No existing behavior is modified. Existing unit tests are unaffected. Verification is visual: open the extension, click the three-dot menu, confirm `v0.2.11` appears at the bottom in muted text.
