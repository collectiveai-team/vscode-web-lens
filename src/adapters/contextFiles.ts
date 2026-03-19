import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import type { ContextBundle } from '../types';

export interface ContextDirInfo {
  dir: string;
  isWorkspaceRelative: boolean;
}

export interface SaveResult extends ContextDirInfo {
  contextPath: string;
  screenshotPath?: string;
  timestamp: number;
  workspaceRoot?: string;
}

/**
 * Build the element label: tag#id if id exists, tag.class1.class2 if classes, else just tag.
 */
function elementLabel(el: { tag: string; id?: string; classes: string[] }): string {
  if (el.id) {
    return `${el.tag}#${el.id}`;
  }
  if (el.classes.length > 0) {
    return `${el.tag}.${el.classes.join('.')}`;
  }
  return el.tag;
}

/**
 * Format a ContextBundle as plain text context file.
 */
export function formatContextFile(bundle: ContextBundle): string {
  const lines: string[] = [];

  lines.push(`Browser Chat Context from ${bundle.url}`);
  lines.push('');

  if (bundle.element) {
    const el = bundle.element;

    lines.push(`Element: ${elementLabel(el)}`);
    lines.push(`Selector: ${el.ancestorPath}`);

    if (el.sourceLocation) {
      lines.push(`Source: @${el.sourceLocation.filePath}#L${el.sourceLocation.line}`);
    }

    if (el.attributes && Object.keys(el.attributes).length > 0) {
      lines.push('');
      lines.push('Attributes:');
      for (const [key, value] of Object.entries(el.attributes)) {
        lines.push(`- ${key}: ${value}`);
      }
    }

    lines.push('');
    lines.push('Dimensions:');
    lines.push(`- top: ${el.dimensions.top}px`);
    lines.push(`- left: ${el.dimensions.left}px`);
    lines.push(`- width: ${el.dimensions.width}px`);
    lines.push(`- height: ${el.dimensions.height}px`);

    if (el.innerText) {
      lines.push('');
      lines.push('Inner Text:');
      lines.push(el.innerText);
    }

    if (el.computedStyles && Object.keys(el.computedStyles).length > 0) {
      lines.push('');
      lines.push('Computed Styles:');
      for (const [key, value] of Object.entries(el.computedStyles)) {
        lines.push(`- ${key}: ${value}`);
      }
    }

    lines.push('');
    lines.push('Element HTML:');
    lines.push(el.html);

    lines.push('');
    lines.push('Parent HTML:');
    lines.push(el.parentHtml);
  }

  if (bundle.logs && bundle.logs.length > 0) {
    lines.push('');
    lines.push('Console Logs:');
    for (const entry of bundle.logs) {
      lines.push(`[${entry.level.toUpperCase()}] ${entry.message}`);
    }
  }

  lines.push('');
  return lines.join('\n');
}

/**
 * Read contextDirectory config and resolve it.
 * Relative paths resolve against workspaceFolders[0].
 * Absolute paths used as-is.
 * Falls back to os.tmpdir() when no workspace is open.
 */
export function resolveContextDir(): ContextDirInfo {
  const config = vscode.workspace.getConfiguration('browserChat');
  const configuredDir = config.get<string>('contextDirectory') || '.tmp';

  if (path.isAbsolute(configuredDir)) {
    return { dir: configuredDir, isWorkspaceRelative: false };
  }

  const folders = vscode.workspace.workspaceFolders;
  if (folders && folders.length > 0) {
    return {
      dir: path.join(folders[0].uri.fsPath, configuredDir),
      isWorkspaceRelative: true,
    };
  }

  return {
    dir: path.join(os.tmpdir(), configuredDir),
    isWorkspaceRelative: false,
  };
}

/**
 * Ensure the directory entry is in .gitignore if it's workspace-relative.
 */
function ensureGitignore(workspaceRoot: string, dirName: string): void {
  const gitignorePath = path.join(workspaceRoot, '.gitignore');
  try {
    let content = '';
    if (fs.existsSync(gitignorePath)) {
      content = fs.readFileSync(gitignorePath, 'utf-8');
    }
    const entry = dirName.startsWith('/') ? dirName : `/${dirName}`;
    if (!content.split('\n').some((line) => line.trim() === entry || line.trim() === dirName)) {
      const separator = content.length > 0 && !content.endsWith('\n') ? '\n' : '';
      fs.writeFileSync(gitignorePath, `${content}${separator}${entry}\n`, 'utf-8');
    }
  } catch {
    // Best effort — don't fail context delivery over .gitignore
  }
}

/**
 * Save context .txt and screenshot .png to the configured directory.
 */
export async function saveContextFiles(bundle: ContextBundle): Promise<SaveResult> {
  const { dir, isWorkspaceRelative } = resolveContextDir();
  const ts = Date.now();

  // Create directory if missing
  fs.mkdirSync(dir, { recursive: true });

  // Determine workspace root
  const folders = vscode.workspace.workspaceFolders;
  const workspaceRoot = folders && folders.length > 0 ? folders[0].uri.fsPath : undefined;

  // Add to .gitignore if workspace-relative
  if (isWorkspaceRelative && workspaceRoot) {
    const relativeDirName = path.relative(workspaceRoot, dir);
    ensureGitignore(workspaceRoot, relativeDirName);
  }

  // Write context file
  const contextFileName = `browser-context-${ts}.txt`;
  const contextPath = path.join(dir, contextFileName);
  const contextContent = formatContextFile(bundle);
  fs.writeFileSync(contextPath, contextContent, 'utf-8');

  const result: SaveResult = {
    contextPath,
    timestamp: ts,
    dir,
    isWorkspaceRelative,
    workspaceRoot,
  };

  // Write screenshot if present
  if (bundle.screenshot) {
    const screenshotFileName = `browser-screenshot-${ts}.png`;
    const screenshotPath = path.join(dir, screenshotFileName);
    const base64Data = bundle.screenshot.dataUrl.replace(/^data:image\/\w+;base64,/, '');
    fs.writeFileSync(screenshotPath, Buffer.from(base64Data, 'base64'));
    result.screenshotPath = screenshotPath;
  }

  return result;
}

/**
 * Delete files matching browser-context-*.txt and browser-screenshot-*.png
 * older than maxAgeMs (default 1 hour). Fire-and-forget.
 */
export function cleanupOldFiles(dir: string, maxAgeMs: number = 60 * 60 * 1000): void {
  try {
    const now = Date.now();
    const entries = fs.readdirSync(dir);
    const pattern = /^browser-(context-\d+\.txt|screenshot-\d+\.png)$/;

    for (const entry of entries) {
      if (!pattern.test(entry)) continue;

      const filePath = path.join(dir, entry);
      const stat = fs.statSync(filePath);
      if (now - stat.mtimeMs > maxAgeMs) {
        fs.unlinkSync(filePath);
      }
    }
  } catch (err) {
    // Fire-and-forget: log but don't throw
    console.error('cleanupOldFiles error:', err);
  }
}

/**
 * Build @ file references. Screenshot first for visual prominence.
 * Uses result.workspaceRoot for path.relative(), NOT vscode.workspace directly.
 */
export function buildAtReferences(result: SaveResult): string {
  const refs: string[] = [];

  if (result.screenshotPath) {
    const screenshotRef = result.isWorkspaceRelative && result.workspaceRoot
      ? path.relative(result.workspaceRoot, result.screenshotPath)
      : result.screenshotPath;
    refs.push(`@${screenshotRef}`);
  }

  const contextRef = result.isWorkspaceRelative && result.workspaceRoot
    ? path.relative(result.workspaceRoot, result.contextPath)
    : result.contextPath;
  refs.push(`@${contextRef}`);

  return refs.join(' ');
}

/**
 * Write text to a temp file, open it in the editor with all text selected,
 * execute a VS Code command that reads from the active selection, then
 * close the temp editor and clean up.
 *
 * Used by adapters that inject context via selection-reading commands
 * (e.g., openchamber.addToContext, chatgpt.addToThread).
 */
export async function sendViaSelectionCommand(text: string, commandId: string): Promise<void> {
  const tmpDir = os.tmpdir();
  const tmpFile = path.join(tmpDir, `.ref`);
  fs.writeFileSync(tmpFile, text, 'utf8');

  try {
    const previousEditor = vscode.window.activeTextEditor;

    const doc = await vscode.workspace.openTextDocument(tmpFile);
    const editor = await vscode.window.showTextDocument(doc, {
      viewColumn: vscode.ViewColumn.Active,
      preserveFocus: false,
      preview: true,
    });

    const fullRange = new vscode.Range(
      doc.positionAt(0),
      doc.positionAt(doc.getText().length)
    );
    editor.selection = new vscode.Selection(fullRange.start, fullRange.end);

    await vscode.commands.executeCommand(commandId);

    await vscode.commands.executeCommand('workbench.action.closeActiveEditor');

    if (previousEditor?.document) {
      await vscode.window.showTextDocument(previousEditor.document, {
        viewColumn: previousEditor.viewColumn,
        preserveFocus: false,
      });
    }
  } finally {
    try {
      fs.unlinkSync(tmpFile);
    } catch {
      // Ignore cleanup errors
    }
  }
}
