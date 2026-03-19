import * as vscode from 'vscode';
import type { ContextBundle, DeliveryResult } from '../types';
import type { BackendAdapter } from './BackendAdapter';
import { ClipboardAdapter } from './ClipboardAdapter';
import { saveContextFiles, cleanupOldFiles, buildAtReferences, sendViaSelectionCommand } from './contextFiles';

/**
 * Delivers browser context to OpenChamber (fedaykindev.openchamber).
 *
 * Strategy: Write @ file references to a temp file, open it in an editor
 * with all text selected, then call `openchamber.addToContext` which reads
 * the active editor selection and passes it to the ChatViewProvider's
 * `addTextToInput()` method.
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
      const saveResult = await saveContextFiles(bundle);
      cleanupOldFiles(saveResult.dir); // fire-and-forget
      const refs = buildAtReferences(saveResult);
      await sendViaSelectionCommand(refs, 'openchamber.addToContext');
      return { success: true, message: 'Added to OpenChamber chat' };
    } catch (_err) {
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
}
