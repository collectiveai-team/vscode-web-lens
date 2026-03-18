import * as vscode from 'vscode';
import type { ContextBundle, DeliveryResult } from '../types';
import type { BackendAdapter } from './BackendAdapter';
import { ClipboardAdapter } from './ClipboardAdapter';

export class OpenCodeAdapter implements BackendAdapter {
  readonly name = 'opencode';
  private fallback = new ClipboardAdapter();

  async deliver(bundle: ContextBundle): Promise<DeliveryResult> {
    const available = await this.isAvailable();

    if (!available) {
      const result = await this.fallback.deliver(bundle);
      return {
        success: result.success,
        message: `OpenCode not found — ${result.message.toLowerCase()}`,
      };
    }

    try {
      const context = this.formatForOpenCode(bundle);
      await vscode.commands.executeCommand('opencode.addContext', context);
      return { success: true, message: 'Added to OpenCode chat' };
    } catch (err) {
      // Fallback to clipboard on error
      const result = await this.fallback.deliver(bundle);
      return {
        success: result.success,
        message: `OpenCode error, fell back to clipboard`,
      };
    }
  }

  async isAvailable(): Promise<boolean> {
    try {
      const commands = await vscode.commands.getCommands(true);
      return commands.some((cmd) => cmd.startsWith('opencode.'));
    } catch {
      return false;
    }
  }

  private formatForOpenCode(bundle: ContextBundle): object {
    // Format as context item compatible with OpenCode's VS Code SDK
    // The exact shape will be confirmed during integration testing
    const parts: string[] = [];

    if (bundle.element) {
      parts.push(`URL: ${bundle.url}`);
      parts.push(`Selector: ${bundle.element.ancestorPath}`);

      if (bundle.element.sourceLocation) {
        parts.push(`Source: ${bundle.element.sourceLocation.filePath}:${bundle.element.sourceLocation.line}`);
      }

      parts.push('');
      parts.push('Element HTML:');
      parts.push(bundle.element.html);
      parts.push('');
      parts.push('Parent HTML:');
      parts.push(bundle.element.parentHtml);
    }

    return {
      type: 'file',
      content: parts.join('\n'),
      preview: bundle.element
        ? `${bundle.element.tag}${bundle.element.classes.length ? '.' + bundle.element.classes[0] : ''} from ${bundle.url}`
        : `Screenshot from ${bundle.url}`,
    };
  }
}
