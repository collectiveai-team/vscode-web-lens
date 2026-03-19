import * as vscode from 'vscode';
import type { ContextBundle, DeliveryResult } from '../types';
import type { BackendAdapter } from './BackendAdapter';
import { ClipboardAdapter } from './ClipboardAdapter';
import { saveContextFiles, cleanupOldFiles } from './contextFiles';

/**
 * Delivers browser context to Claude Code (anthropic.claude-code).
 *
 * Strategy: Save context files, then open each file in the editor and call
 * `claude-vscode.insertAtMention` which reads from activeTextEditor and
 * inserts an @-mention of that file into Claude Code's chat input.
 *
 * Screenshot PNG is mentioned first, then the context .txt file.
 * The screenshot mention may fail because activeTextEditor is undefined
 * for image previews — this is caught and we continue.
 */
export class ClaudeCodeAdapter implements BackendAdapter {
  readonly name = 'claudecode';
  private fallback = new ClipboardAdapter();

  async deliver(bundle: ContextBundle): Promise<DeliveryResult> {
    const hasExtension = await this.isAvailable();
    if (!hasExtension) {
      const result = await this.fallback.deliver(bundle);
      return {
        success: result.success,
        message: `Claude Code not installed — ${result.message.toLowerCase()}`,
      };
    }

    try {
      const saveResult = await saveContextFiles(bundle);
      cleanupOldFiles(saveResult.dir); // fire-and-forget

      // Save the current editor to restore later
      const previousEditor = vscode.window.activeTextEditor;

      // Build list of files to mention: screenshot first, then context
      const filesToMention: string[] = [];
      if (saveResult.screenshotPath) {
        filesToMention.push(saveResult.screenshotPath);
      }
      filesToMention.push(saveResult.contextPath);

      let mentionSuccessCount = 0;

      for (const filePath of filesToMention) {
        try {
          // Open the file in editor
          const uri = vscode.Uri.file(filePath);
          await vscode.window.showTextDocument(uri, {
            viewColumn: vscode.ViewColumn.Active,
            preserveFocus: false,
            preview: true,
          });

          // Clear selection — cursor at position 0
          const editor = vscode.window.activeTextEditor;
          if (editor) {
            const pos = new vscode.Position(0, 0);
            editor.selection = new vscode.Selection(pos, pos);
          }

          // Insert @-mention via Claude Code command
          await vscode.commands.executeCommand('claude-vscode.insertAtMention');
          mentionSuccessCount++;

          // Small delay for Claude Code to process
          await new Promise((resolve) => setTimeout(resolve, 100));
        } catch (err) {
          console.warn(`ClaudeCodeAdapter: failed to mention ${filePath}:`, err);
        }
      }

      // Close the preview tab (preview: true means only one tab open)
      await vscode.commands.executeCommand('workbench.action.closeActiveEditor');

      // Restore previous editor if there was one
      if (previousEditor?.document) {
        await vscode.window.showTextDocument(previousEditor.document, {
          viewColumn: previousEditor.viewColumn,
          preserveFocus: false,
        });
      }

      // If no mentions succeeded, throw to trigger clipboard fallback
      if (mentionSuccessCount === 0) {
        throw new Error('All @-mention attempts failed');
      }

      return { success: true, message: 'Added to Claude Code chat' };
    } catch (err) {
      const result = await this.fallback.deliver(bundle);
      return {
        success: result.success,
        message: 'Claude Code error, fell back to clipboard',
      };
    }
  }

  async isAvailable(): Promise<boolean> {
    try {
      const commands = await vscode.commands.getCommands(true);
      return commands.includes('claude-vscode.insertAtMention');
    } catch {
      return false;
    }
  }
}
