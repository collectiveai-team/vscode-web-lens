import * as vscode from 'vscode';
import type { ContextBundle, DeliveryResult } from '../types';
import type { BackendAdapter } from './BackendAdapter';

export class ClipboardAdapter implements BackendAdapter {
  readonly name = 'clipboard';

  async deliver(bundle: ContextBundle): Promise<DeliveryResult> {
    try {
      const markdown = this.formatAsMarkdown(bundle);
      await vscode.env.clipboard.writeText(markdown);
      return { success: true, message: 'Copied to clipboard' };
    } catch (err) {
      return {
        success: false,
        message: `Failed to copy: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }

  async isAvailable(): Promise<boolean> {
    return true; // Clipboard is always available
  }

  private formatAsMarkdown(bundle: ContextBundle): string {
    const parts: string[] = [];

    parts.push(`**URL:** ${bundle.url}`);
    parts.push('');

    if (bundle.element) {
      if (bundle.element.sourceLocation) {
        const loc = bundle.element.sourceLocation;
        parts.push(`**Source:** \`${loc.filePath}:${loc.line}\``);
        parts.push('');
      }

      parts.push(`**Selector:** \`${bundle.element.ancestorPath}\``);
      parts.push('');

      parts.push('**Element HTML:**');
      parts.push('```html');
      parts.push(bundle.element.html);
      parts.push('```');
      parts.push('');

      parts.push('**Parent HTML:**');
      parts.push('```html');
      parts.push(bundle.element.parentHtml);
      parts.push('```');
    }

    if (bundle.screenshot) {
      parts.push('');
      parts.push('*Screenshot captured (base64 data available in clipboard)*');
    }

    if (bundle.logs && bundle.logs.length > 0) {
      parts.push('');
      parts.push('**Console Logs:**');
      parts.push('```');
      for (const entry of bundle.logs) {
        parts.push(`[${entry.level.toUpperCase()}] ${entry.message}`);
      }
      parts.push('```');
    }

    return parts.join('\n');
  }
}
