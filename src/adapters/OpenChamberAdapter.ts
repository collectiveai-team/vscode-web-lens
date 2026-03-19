import * as vscode from 'vscode';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';
import type { ContextBundle, DeliveryResult } from '../types';
import type { BackendAdapter } from './BackendAdapter';
import { ClipboardAdapter } from './ClipboardAdapter';

/**
 * Delivers browser context to OpenChamber (fedaykindev.openchamber).
 *
 * Strategy: Write context to a temp file, open it in an editor with all
 * text selected, then call `openchamber.addToContext` which reads the
 * active editor selection and passes it to the ChatViewProvider's
 * `addTextToInput()` method.
 *
 * This is the only reliable way to inject arbitrary text into OpenChamber
 * since it doesn't expose a command that accepts text arguments.
 */
export class OpenChamberAdapter implements BackendAdapter {
  readonly name = 'openchamber';
  private fallback = new ClipboardAdapter();

  async deliver(bundle: ContextBundle): Promise<DeliveryResult> {
    const hasExtension = await this.isAvailable();
    if (!hasExtension) {
      const result = await this.fallback.deliver(bundle);
      return {
        success: result.success,
        message: `OpenChamber not installed — ${result.message.toLowerCase()}`,
      };
    }

    try {
      // Save screenshot to temp file if present
      let screenshotPath = '';
      if (bundle.screenshot?.dataUrl) {
        screenshotPath = path.join(os.tmpdir(), `browser-screenshot-${Date.now()}.png`);
        const base64Data = bundle.screenshot.dataUrl.replace(/^data:image\/\w+;base64,/, '');
        fs.writeFileSync(screenshotPath, Buffer.from(base64Data, 'base64'));
      }

      const text = this.formatContext(bundle, screenshotPath);
      await this.sendViaAddToContext(text);
      return { success: true, message: 'Added to OpenChamber chat' };
    } catch (err) {
      const result = await this.fallback.deliver(bundle);
      return {
        success: result.success,
        message: `OpenChamber error, fell back to clipboard`,
      };
    }
  }

  async isAvailable(): Promise<boolean> {
    try {
      const commands = await vscode.commands.getCommands(true);
      return commands.includes('openchamber.addToContext');
    } catch {
      return false;
    }
  }

  /**
   * Write context to a temp file, open it, select all, call addToContext,
   * then close the temp editor and clean up the file.
   */
  private async sendViaAddToContext(text: string): Promise<void> {
    // Write to temp file
    const tmpDir = os.tmpdir();
    const tmpFile = path.join(tmpDir, `browser-context.html`);
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

      // Call openchamber.addToContext — it reads the active editor selection
      await vscode.commands.executeCommand('openchamber.addToContext');

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

  private formatContext(bundle: ContextBundle, screenshotPath?: string): string {
    const parts: string[] = [];

    parts.push(`[Browser Chat] Context from ${bundle.url}`);
    parts.push('');

    if (bundle.element) {
      if (bundle.element.sourceLocation) {
        parts.push(`Source: @${bundle.element.sourceLocation.filePath}#L${bundle.element.sourceLocation.line}`);
      }
      parts.push(`Selector: ${bundle.element.ancestorPath}`);
      parts.push('');
      parts.push('Element HTML:');
      parts.push('```html');
      parts.push(bundle.element.html);
      parts.push('```');

      if (bundle.element.parentHtml) {
        parts.push('');
        parts.push('Parent HTML:');
        parts.push('```html');
        parts.push(bundle.element.parentHtml);
        parts.push('```');
      }
    }

    if (bundle.logs && bundle.logs.length > 0) {
      parts.push('');
      parts.push('Console logs:');
      parts.push('```');
      for (const entry of bundle.logs) {
        parts.push(`[${entry.level.toUpperCase()}] ${entry.message}`);
      }
      parts.push('```');
    }

    if (screenshotPath) {
      parts.push('');
      parts.push(`Screenshot: ${screenshotPath}`);
    }

    return parts.join('\n');
  }
}
