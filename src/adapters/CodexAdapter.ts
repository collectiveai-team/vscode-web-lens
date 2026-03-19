import * as vscode from 'vscode';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';
import type { ContextBundle, DeliveryResult } from '../types';
import type { BackendAdapter } from './BackendAdapter';
import { ClipboardAdapter } from './ClipboardAdapter';
import { saveContextFiles, cleanupOldFiles, buildAtReferences } from './contextFiles';

/**
 * Delivers browser context to Codex (openai.chatgpt).
 *
 * Strategy: Write context to a temp file, open it in an editor with all
 * text selected, then call `chatgpt.addToThread` which reads the
 * active editor selection and passes it to the thread.
 *
 * This is the only reliable way to inject arbitrary text into Codex
 * since it doesn't expose a command that accepts text arguments.
 */
export class CodexAdapter implements BackendAdapter {
  readonly name = 'codex';
  private fallback = new ClipboardAdapter();

  async deliver(bundle: ContextBundle): Promise<DeliveryResult> {
    const hasExtension = await this.isAvailable();
    if (!hasExtension) {
      const result = await this.fallback.deliver(bundle);
      return {
        success: result.success,
        message: `Codex not installed — ${result.message.toLowerCase()}`,
      };
    }

    try {
      const saveResult = await saveContextFiles(bundle);
      cleanupOldFiles(saveResult.dir); // fire-and-forget
      const refs = buildAtReferences(saveResult);
      await this.sendViaAddToThread(refs);
      return { success: true, message: 'Added to Codex thread' };
    } catch (err) {
      const result = await this.fallback.deliver(bundle);
      return {
        success: result.success,
        message: `Codex error, fell back to clipboard`,
      };
    }
  }

  async isAvailable(): Promise<boolean> {
    try {
      const commands = await vscode.commands.getCommands(true);
      return commands.includes('chatgpt.addToThread');
    } catch {
      return false;
    }
  }

  /**
   * Write context to a temp file, open it, select all, call addToThread,
   * then close the temp editor and clean up the file.
   */
  private async sendViaAddToThread(text: string): Promise<void> {
    // Write to temp file
    const tmpDir = os.tmpdir();
    const tmpFile = path.join(tmpDir, `.ref`);
    fs.writeFileSync(tmpFile, text, 'utf8');

    try {
      // Save current active editor to restore later
      const previousEditor = vscode.window.activeTextEditor;

      // Open the temp file
      const doc = await vscode.workspace.openTextDocument(tmpFile);
      const editor = await vscode.window.showTextDocument(doc, {
        viewColumn: vscode.ViewColumn.Active,
        preserveFocus: false,
        preview: true,
      });

      // Select all text
      const fullRange = new vscode.Range(
        doc.positionAt(0),
        doc.positionAt(doc.getText().length)
      );
      editor.selection = new vscode.Selection(fullRange.start, fullRange.end);

      // Call chatgpt.addToThread — it reads the active editor selection
      await vscode.commands.executeCommand('chatgpt.addToThread');

      // Close the temp editor
      await vscode.commands.executeCommand('workbench.action.closeActiveEditor');

      // Restore previous editor if there was one
      if (previousEditor?.document) {
        await vscode.window.showTextDocument(previousEditor.document, {
          viewColumn: previousEditor.viewColumn,
          preserveFocus: false,
        });
      }
    } finally {
      // Clean up temp file
      try {
        fs.unlinkSync(tmpFile);
      } catch {
        // Ignore cleanup errors
      }
    }
  }
}
