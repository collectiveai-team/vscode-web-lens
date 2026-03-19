import * as vscode from 'vscode';
import type { ContextBundle, DeliveryResult } from '../types';
import type { BackendAdapter } from './BackendAdapter';
import { ClipboardAdapter } from './ClipboardAdapter';
import { saveContextFiles, cleanupOldFiles, buildAtReferences, sendViaSelectionCommand } from './contextFiles';

/**
 * Delivers browser context to Codex (openai.chatgpt).
 *
 * Strategy: Write @ file references to a temp file, open it in an editor
 * with all text selected, then call `chatgpt.addToThread` which reads the
 * active editor selection and adds it as context for the current thread.
 *
 * Same pattern as the OpenChamber adapter.
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
      await sendViaSelectionCommand(refs, 'chatgpt.addToThread');
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
}
