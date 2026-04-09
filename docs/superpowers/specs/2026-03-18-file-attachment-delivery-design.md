# File Attachment Delivery for Browser Context

**Date**: 2026-03-18
**Phase**: 1 of 2
**Status**: Approved

## Problem

When a user selects an element in the integrated browser, the context (HTML, selector, screenshot) is delivered to the AI chat as inline text. This produces a wall of text in the chat input instead of proper file attachments. The user expects the screenshot and context to appear as attached files, similar to how `@` file references work in OpenCode and OpenChamber.

## Solution

Save context and screenshots as workspace-relative files, then inject `@` file references into the chat input instead of inline text. Both OpenCode and OpenChamber resolve `@` references into proper file attachments when the user submits.

Validated via spike: `@file` references work in both OpenCode and OpenChamber when injected programmatically.

## Scope

**Phase 1 (this spec)**: File attachment delivery + expanded element data capture (attributes, dimensions, inner text, computed styles).

**Phase 2 (future)**: Matched CSS rules with ancestry and specificity ordering.

---

## Architecture

### Data Flow

```
Webview (capture) → CapturedElementPayload → ContextExtractor → ContextBundle
  → saveContextFiles() → .tmp/browser-context-{ts}.txt + .tmp/browser-screenshot-{ts}.png
  → Adapter injects "@.tmp/browser-context-{ts}.txt @.tmp/browser-screenshot-{ts}.png"
  → AI tool resolves @ references into file parts on submit
```

### Components

1. **Webview capture** — expanded to collect attributes, dimensions, inner text, computed styles
2. **Types** — `CapturedElementPayload` and `ElementContext` gain new fields
3. **ContextExtractor** — maps new payload fields to `ElementContext`
4. **Shared file utilities** (`src/adapters/contextFiles.ts`) — saving, formatting, cleanup
5. **Adapters** — simplified to save files + inject `@` references

---

## New Setting

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `browserChat.contextDirectory` | `string` | `.tmp` | Directory for context files. Relative paths resolve from workspace root. Absolute paths used as-is. |

- Auto-creates directory if missing.
- Auto-adds to `.gitignore` if the path is workspace-relative and not already ignored.

---

## File Naming

Both files share a matching timestamp for correlation:

- `browser-context-{timestamp}.txt`
- `browser-screenshot-{timestamp}.png`

Where `{timestamp}` is `Date.now()` (e.g., `1773884110138`).

---

## Context File Format

Plain text following the structure of the Integrated Browser reference tool. Uses data currently captured plus newly added fields.

```
Browser Chat Context from http://localhost:3000

Element: div.table-header
Selector: body > main.main > div.table-container > div.table-header
Source: @src/components/Table.tsx#L42

Attributes:
- class: table-header
- role: navigation

Dimensions:
- top: 86px
- left: 252px
- width: 789px
- height: 71px

Inner Text:
User Management
All Admin Editor Viewer Export

Computed Styles:
- display: flex
- align-items: center
- gap: 12px
- padding: 12px 16px
- background-color: rgb(239, 246, 255)
- border-radius: 8px
- font-size: 13px
- color: rgb(30, 64, 175)
- width: 789.349px
- height: 50.651px
(... all ~400 computed properties included)

Element HTML:
<div class="table-header">
  <div class="table-title">User Management</div>
  <div class="table-filters">
    <span class="filter-chip active">All</span>
    ...
  </div>
</div>

Parent HTML:
<div class="table-container">
  ...
</div>

Console Logs:
[ERROR] Something went wrong
[WARN] Deprecated API usage
```

Sections are omitted when no data is available (e.g., no console logs, no source location).

**Computed styles**: All ~400 properties from `getComputedStyle()` are included. This matches the Integrated Browser reference format which includes all computed styles. While verbose, LLMs handle long context well and having all styles available prevents follow-up questions about missing properties. The context file may be 5-15KB depending on the element.

**Element label**: The `Element: div.table-header` line is constructed as `tag` + `.` + `classes.join('.')`. If no classes, just `tag` (e.g., `Element: div`). If element has an `id`, format as `tag#id` (e.g., `Element: div#main-header`).

---

## Type Changes

### `CapturedElementPayload` (webview → extension host)

The existing `dimensions` field is widened from `{ width, height }` to `{ top, left, width, height }`. This is a backward-compatible change since the new fields are additive for consumers that only read `width`/`height`.

The same widening applies to `InspectSelectedPayload` which shares the `dimensions` shape — the tooltip flow only reads `width`/`height` and ignores additional fields, so no breakage.

```typescript
// Existing type (both CapturedElementPayload and InspectSelectedPayload):
//   dimensions: { width: number; height: number }
// Widened to:
//   dimensions: { top: number; left: number; width: number; height: number }

// New fields on CapturedElementPayload only:
attributes?: Record<string, string>;    // element.attributes as key-value pairs
innerText?: string;                     // element.innerText
computedStyles?: Record<string, string>; // window.getComputedStyle(element), all properties
```

### `ElementContext` (in `ContextBundle`)

The existing `dimensions` field is widened from `{ width, height }` to `{ top, left, width, height }`, matching the payload change. Populated from `getBoundingClientRect()`.

```typescript
// Widened:
dimensions: { top: number; left: number; width: number; height: number };

// New fields:
attributes?: Record<string, string>;
innerText?: string;
computedStyles?: Record<string, string>;
```

---

## Webview Changes

### Inject script (`inject.ts` / element capture)

In the element capture code (inspect/addElement handlers):

```typescript
const rect = element.getBoundingClientRect();
const computedStyle = window.getComputedStyle(element);

// Collect all attributes
const attributes: Record<string, string> = {};
for (const attr of element.attributes) {
  attributes[attr.name] = attr.value;
}

// Collect all computed styles (all ~400 properties)
const computedStyles: Record<string, string> = {};
for (let i = 0; i < computedStyle.length; i++) {
  const prop = computedStyle[i];
  computedStyles[prop] = computedStyle.getPropertyValue(prop);
}

// Widen dimensions to include position
payload.dimensions = {
  top: Math.round(rect.top),
  left: Math.round(rect.left),
  width: Math.round(rect.width),
  height: Math.round(rect.height),
};
payload.attributes = attributes;
payload.innerText = element.innerText;
payload.computedStyles = computedStyles;
```

### Inspect overlay relay (`inspect-overlay.ts`)

The overlay constructs `CapturedElementPayload` when forwarding messages from the inject script. The new fields must be threaded through the relay code that builds payloads (in the `capturedElement` and `sendToChat` message handlers). Specifically, the relay must pass through:

- `attributes` — forwarded as-is from inject script payload
- `dimensions` — widened shape `{ top, left, width, height }` forwarded from inject script
- `innerText` — forwarded as-is
- `computedStyles` — forwarded as-is

The `inspect:selected` tooltip flow also uses `dimensions`. The widened shape is backward-compatible since the tooltip only reads `width`/`height`. The `bc:elementSelected` handler in the overlay (which constructs `InspectSelectedPayload` for tooltips) does NOT need `attributes`, `innerText`, or `computedStyles` — only the widened `dimensions`.

---

## Shared File Utilities

New module: `src/adapters/contextFiles.ts`

### Workspace Root Resolution

All functions that need `workspaceRoot` obtain it internally via `vscode.workspace.workspaceFolders?.[0]?.uri.fsPath`. This is NOT passed from the caller — each utility resolves it on demand.

**Fallback when no workspace is open:** If `workspaceFolders` is empty (e.g., single file opened), fall back to `os.tmpdir()` regardless of the `contextDirectory` setting. The `@` references will use absolute paths in this case. A warning is logged: `"No workspace open, saving context files to system temp directory."`

### `resolveContextDir()`

Reads `browserChat.contextDirectory` from VS Code config. If relative, resolves against `workspaceRoot`. If absolute, uses as-is. If no workspace, returns `os.tmpdir()`. Returns `{ dir: string, isWorkspaceRelative: boolean }`.

### `saveContextFiles(bundle)`

1. Calls `resolveContextDir()` to get the target directory.
2. Creates directory if it doesn't exist.
3. Adds directory to `.gitignore` if workspace-relative and not already present.
4. Generates timestamp: `Date.now()`.
5. Writes `browser-context-{ts}.txt` with formatted context (via `formatContextFile()`).
6. If `bundle.screenshot?.dataUrl` exists, writes `browser-screenshot-{ts}.png` (base64 decode).
7. Returns `{ contextPath, screenshotPath?, timestamp, isWorkspaceRelative }`.

### `formatContextFile(bundle)`

Produces the plain text content following the format specified above. Handles optional sections gracefully (omits headers when data is missing).

### `cleanupOldFiles(dir, maxAgeMs = 3600000)`

1. Lists all files matching `browser-context-*.txt` and `browser-screenshot-*.png` in `dir`.
2. Extracts timestamp from filename.
3. Deletes files where `Date.now() - timestamp > maxAgeMs`.
4. Errors during cleanup are logged but do not fail delivery.
5. **Fire-and-forget**: Called without `await` by the adapters to avoid adding latency to the delivery path.

### `buildAtReferences(result)`

Takes the return value from `saveContextFiles()`. Produces the `@` reference text to inject into the chat input.

- If `isWorkspaceRelative`, uses relative paths: `@.tmp/browser-screenshot-{ts}.png @.tmp/browser-context-{ts}.txt`
- If not workspace-relative, uses absolute paths: `@/tmp/browser-screenshot-{ts}.png @/tmp/browser-context-{ts}.txt`
- If no screenshot, only includes the context file reference.

Returns the reference string (screenshot first for visual prominence).

---

## Adapter Changes

### OpenCode Adapter

**Before:**
1. Save screenshot to `/tmp`
2. Format all context as inline text via `formatContext()`
3. `POST /tui/append-prompt` with `{ text: inlineText }`

**After:**
1. `const result = await saveContextFiles(bundle)` (resolves dir internally)
2. `cleanupOldFiles(result.dir)` (fire-and-forget, no await)
3. `const refs = buildAtReferences(result)`
4. `POST /tui/append-prompt` with `{ text: refs }`

`formatContext()` method is removed. Screenshot saving moves to shared utility. The adapter no longer handles file paths or formatting directly.

### OpenChamber Adapter

**Before:**
1. Save screenshot to `/tmp`
2. Format all context as inline text via `formatContext()`
3. Write text to temp file, open in editor, select all, `addToContext`

**After:**
1. `const result = await saveContextFiles(bundle)` (resolves dir internally)
2. `cleanupOldFiles(result.dir)` (fire-and-forget, no await)
3. `const refs = buildAtReferences(result)`
4. Write `refs` to temp file, open in editor, select all, `addToContext`

`formatContext()` method is removed. The temp-file + `addToContext` mechanism is retained but now injects a short `@` reference string instead of a large text block.

### Clipboard Adapter

**Before:** Formats full context as markdown and copies to clipboard via `vscode.env.clipboard.writeText()`.

**After:** Saves files via `saveContextFiles()` and `cleanupOldFiles()` (same as other adapters). Copies a short summary to clipboard with file paths:

```
[Browser Chat] Context saved to:
  Screenshot: .tmp/browser-screenshot-{ts}.png
  Context: .tmp/browser-context-{ts}.txt
```

The full context file is on disk; the clipboard just tells the user where to find it. The `formatAsMarkdown()` method is removed.

---

### Non-Element Delivery Paths

The `deliverContext()` function in `extension.ts` handles three message types:

- `inspect:sendToChat` / `addElement:captured` → element capture (the primary path this spec addresses)
- `action:screenshot` → standalone screenshot (no element context)
- `action:addLogs` → console logs only (no element, no screenshot)

**Standalone screenshot**: `saveContextFiles()` handles this gracefully — it only writes the screenshot PNG (no `.txt` file since there's no element). `buildAtReferences()` returns just the screenshot reference: `@.tmp/browser-screenshot-{ts}.png`.

**Console logs only**: `saveContextFiles()` writes a `.txt` file containing only the console logs section. No screenshot file. `buildAtReferences()` returns just the context file reference.

---

## package.json Changes

Add the new setting to the `contributes.configuration` section:

```json
{
  "browserChat.contextDirectory": {
    "type": "string",
    "default": ".tmp",
    "description": "Directory for context files (screenshots and element data). Relative paths resolve from workspace root. Absolute paths used as-is."
  }
}
```

---

## Testing

### Unit Tests

- `contextFiles.test.ts`: Test `formatContextFile()`, `saveContextFiles()`, `cleanupOldFiles()`, `buildAtReferences()` with various bundles.
- Update `OpenCodeAdapter.test.ts`: Verify adapter calls shared utilities and injects `@` references instead of inline text.
- Update `OpenChamberAdapter.test.ts`: Same verification.
- `ContextExtractor.test.ts`: Test new fields (attributes, dimensions, innerText, computedStyles) are properly mapped.
- Update `ClipboardAdapter.test.ts`: Verify adapter calls shared utilities and copies file paths to clipboard.

### Manual Validation

1. Select an element → verify `.tmp/browser-context-{ts}.txt` and `.tmp/browser-screenshot-{ts}.png` are created.
2. Verify context file content matches expected format.
3. In OpenCode: verify `@` references appear in prompt, resolve on submit, screenshot shows as image.
4. In OpenChamber: verify `@` references appear in chat input, resolve to file attachments.
5. Verify old files are cleaned up after 1 hour.
6. Verify `.gitignore` is updated when using a workspace-relative directory.

---

## Migration / Breaking Changes

- The inline text delivery format is replaced entirely. Users who relied on the specific inline format will see `@` references instead.
- Files are now written to the workspace (`.tmp/` by default) rather than `/tmp`. Users should add `.tmp/` to their `.gitignore` (auto-handled by the extension).
- The `formatContext()` methods on each adapter are removed in favor of the shared `formatContextFile()`.

---

## Out of Scope (Phase 2)

- Matched CSS rules with ancestry grouping (user-agent vs regular, inherited levels)
- CSS specificity ordering
- Full computed CSS from stylesheets
