import * as vscode from 'vscode';
import type { ContextBundle, DeliveryResult } from '../types';
import type { BackendAdapter } from './BackendAdapter';
import { saveContextFiles, cleanupOldFiles } from './contextFiles';

export class ClipboardAdapter implements BackendAdapter {
  readonly name = 'clipboard';

  async deliver(bundle: ContextBundle): Promise<DeliveryResult> {
    try {
      const result = await saveContextFiles(bundle);
      cleanupOldFiles(result.dir); // fire-and-forget

      const lines = ['[Web Lens] Context saved to:'];
      if (result.screenshotPath) {
        lines.push(`  Screenshot: ${result.screenshotPath}`);
      }
      lines.push(`  Context: ${result.contextPath}`);

      await vscode.env.clipboard.writeText(lines.join('\n'));
      return { success: true, message: 'File paths copied to clipboard' };
    } catch (_err) {
      return { success: false, message: 'Failed to save context files' };
    }
  }

  async isAvailable(): Promise<boolean> {
    return true; // Clipboard is always available
  }
}
