# Codex and Claude Code Adapters

**Date**: 2026-03-19
**Status**: Approved

## Problem

The extension supports delivering browser context to OpenCode and OpenChamber via their respective adapters. Users who work with Codex (OpenAI) or Claude Code (Anthropic) have no way to deliver captured element context to those tools.

## Solution

Add two new adapters — `CodexAdapter` and `ClaudeCodeAdapter` — that implement the existing `BackendAdapter` interface. Both use the shared file utilities from `contextFiles.ts` (already implemented) to save context files, then inject `@` file references into their respective tools via VS Code extension commands.

---

## Architecture

### Data Flow

Both adapters follow the established pattern:

```
ContextBundle → saveContextFiles() → .tmp/browser-context-{ts}.txt + .tmp/browser-screenshot-{ts}.png
  → Adapter injects @ references via VS Code command
  → AI tool resolves @ references on submit
```

### Components

1. **CodexAdapter** (`src/adapters/CodexAdapter.ts`) — delivers via `chatgpt.addToThread` command
2. **ClaudeCodeAdapter** (`src/adapters/ClaudeCodeAdapter.ts`) — delivers via `claude-vscode.insertAtMention` command
3. **Registration** — both added to adapter dictionary in `extension.ts` and backend enum in `package.json`

### Shared Utilities (already implemented)

From `src/adapters/contextFiles.ts`:
- `saveContextFiles(bundle)` — saves context `.txt` and screenshot `.png` to configured directory
- `cleanupOldFiles(dir)` — removes files older than 1 hour
- `buildAtReferences(result)` — produces `@` reference string

---

## Codex Adapter

**File**: `src/adapters/CodexAdapter.ts`

**Name**: `codex`

**Target extension**: `openai.chatgpt` (Codex VS Code extension)

**Command used**: `chatgpt.addToThread` — adds selected text range as context for the current thread. Reads from `vscode.window.activeTextEditor` selection.

### Delivery Mechanism

Follows the same temp-file pattern as the OpenChamber adapter:

1. `saveContextFiles(bundle)` — saves files to `.tmp/`
2. `cleanupOldFiles(result.dir)` — fire-and-forget, no await
3. `buildAtReferences(result)` — produces `@.tmp/browser-screenshot-{ts}.png @.tmp/browser-context-{ts}.txt`
4. Write the refs string to a temp file (`browser-context.html`) in `os.tmpdir()`
5. Save current active editor reference
6. Open the temp file via `vscode.workspace.openTextDocument` + `vscode.window.showTextDocument`
7. Select all text in the editor (`editor.selection = new Selection(start, end)`)
8. Execute `vscode.commands.executeCommand('chatgpt.addToThread')`
9. Close the temp editor via `workbench.action.closeActiveEditor`
10. Restore previous active editor if one existed
11. Delete the temp file in a `finally` block

### Availability Check

```typescript
async isAvailable(): Promise<boolean> {
  const commands = await vscode.commands.getCommands(true);
  return commands.includes('chatgpt.addToThread');
}
```

### Fallback

On failure (extension not installed or command error), falls back to `ClipboardAdapter`. Returns message indicating fallback: `"Codex not installed — copied to clipboard"` or `"Codex error, fell back to clipboard"`.

---

## Claude Code Adapter

**File**: `src/adapters/ClaudeCodeAdapter.ts`

**Name**: `claudecode`

**Target extension**: `anthropic.claude-code` (Claude Code VS Code extension)

**Command used**: `claude-vscode.insertAtMention` — inserts an `@` reference to the currently-open file into Claude Code's chat input. Reads from `vscode.window.activeTextEditor` to get file path and selection, then fires an internal EventEmitter that injects the mention into the active Claude Code panel.

### Delivery Mechanism

Opens each saved context file and invokes `insertAtMention` to inject a reference into the current Claude Code session:

1. `saveContextFiles(bundle)` — saves files to `.tmp/`
2. `cleanupOldFiles(result.dir)` — fire-and-forget, no await
3. Save current active editor reference
4. Build list of files to mention: `[screenshotPath, contextPath]` (screenshot first for visual prominence, filtered to only existing paths)
5. For each file:
   a. Open the file via `vscode.workspace.openTextDocument` + `vscode.window.showTextDocument`
   b. Clear any text selection (set cursor to position 0 with empty selection) to avoid line numbers in the reference
   c. Execute `vscode.commands.executeCommand('claude-vscode.insertAtMention')`
   d. Wait ~100ms before processing the next file (allows EventEmitter to fire)
6. Close the temp editor via `workbench.action.closeActiveEditor` — since each `showTextDocument` with `preview: true` replaces the previous preview tab, only one close is needed
7. Restore previous active editor if one existed

### Screenshot Limitation

The `insertAtMention` command reads from `vscode.window.activeTextEditor`. When a PNG file is opened, VS Code shows an image preview — not a text editor. The `activeTextEditor` will be `undefined`, and the mention command will likely fail silently for the screenshot.

**Handling**: The adapter attempts the mention for all files, wrapping each in a try/catch. If the screenshot mention fails (expected for binary files), execution continues with the context `.txt` file, which contains all structural data (HTML, CSS, selectors, dimensions, computed styles). The screenshot is supplementary — the context file is the primary value.

The adapter tracks whether at least one file was successfully mentioned. If no files were mentioned, it falls back to clipboard.

### Availability Check

```typescript
async isAvailable(): Promise<boolean> {
  const commands = await vscode.commands.getCommands(true);
  return commands.includes('claude-vscode.insertAtMention');
}
```

### Fallback

On failure (extension not installed or no mentions succeeded), falls back to `ClipboardAdapter`.

---

## Registration Changes

### `extension.ts`

Add imports and entries to the adapter dictionary:

```typescript
import { CodexAdapter } from './adapters/CodexAdapter';
import { ClaudeCodeAdapter } from './adapters/ClaudeCodeAdapter';

const adapters: Record<string, BackendAdapter> = {
  clipboard: new ClipboardAdapter(),
  opencode: new OpenCodeAdapter(),
  openchamber: new OpenChamberAdapter(),
  codex: new CodexAdapter(),
  claudecode: new ClaudeCodeAdapter(),
};
```

### `package.json`

Extend the `browserChat.backend` enum:

```json
"browserChat.backend": {
  "type": "string",
  "default": "clipboard",
  "enum": ["opencode", "openchamber", "codex", "claudecode", "clipboard"],
  "description": "Active backend for delivering context to AI agent"
}
```

---

## Testing

### Unit Tests

- **`CodexAdapter.test.ts`**: Verify adapter calls `saveContextFiles`, writes temp file, executes `chatgpt.addToThread`, cleans up temp file. Test clipboard fallback when Codex extension is not installed. Test clipboard fallback when command execution throws.

- **`ClaudeCodeAdapter.test.ts`**: Verify adapter calls `saveContextFiles`, opens each file, executes `claude-vscode.insertAtMention` per file. Test that screenshot mention failure doesn't prevent context file mention. Test clipboard fallback when Claude Code is not installed. Test clipboard fallback when all mentions fail.

### Manual Validation

1. With Codex installed: capture element, verify `@` references appear as thread context in Codex sidebar.
2. With Claude Code installed: capture element, verify context file `@` mention appears in Claude Code's input.
3. With Claude Code: verify screenshot mention behavior (expect it may not work for PNG files).
4. Without either installed: verify clipboard fallback works with correct messaging.
5. Backend switching: change `browserChat.backend` setting between `codex`, `claudecode`, and other values — verify correct adapter is used.
6. Availability probe: verify the backend selector in the webview correctly reports availability for new adapters.
