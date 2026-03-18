import * as vscode from 'vscode';
import type { ContextBundle, DeliveryResult } from '../types';
import type { BackendAdapter } from './BackendAdapter';
import { ClipboardAdapter } from './ClipboardAdapter';

export class OpenChamberAdapter implements BackendAdapter {
  readonly name = 'openchamber';
  private fallback = new ClipboardAdapter();

  async deliver(bundle: ContextBundle): Promise<DeliveryResult> {
    const available = await this.isAvailable();

    if (!available) {
      const result = await this.fallback.deliver(bundle);
      return {
        success: result.success,
        message: `OpenChamber not found — ${result.message.toLowerCase()}`,
      };
    }

    try {
      const context = this.formatForOpenChamber(bundle);
      await vscode.commands.executeCommand('openchamber.addContext', context);
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
      return commands.some((cmd) => cmd.startsWith('openchamber.'));
    } catch {
      return false;
    }
  }

  private formatForOpenChamber(bundle: ContextBundle): object {
    // Format compatible with OpenChamber's VS Code extension API
    // Exact shape to be confirmed during integration
    const parts: string[] = [];

    if (bundle.element) {
      parts.push(`URL: ${bundle.url}`);
      parts.push(`Selector: ${bundle.element.ancestorPath}`);

      if (bundle.element.sourceLocation) {
        parts.push(`Source: ${bundle.element.sourceLocation.filePath}:${bundle.element.sourceLocation.line}`);
      }

      parts.push('');
      parts.push(bundle.element.html);
    }

    if (bundle.logs && bundle.logs.length > 0) {
      parts.push('');
      parts.push('Console:');
      for (const entry of bundle.logs) {
        parts.push(`[${entry.level}] ${entry.message}`);
      }
    }

    return {
      type: 'browser-context',
      content: parts.join('\n'),
      url: bundle.url,
    };
  }
}
