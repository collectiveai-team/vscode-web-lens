import * as vscode from 'vscode';
import * as http from 'http';
import type { ContextBundle, DeliveryResult } from '../types';
import type { BackendAdapter } from './BackendAdapter';
import { ClipboardAdapter } from './ClipboardAdapter';

/**
 * Delivers browser context to OpenCode.
 *
 * Supports two VS Code extensions:
 * 1. Official OpenCode extension (anomalyco.opencode) — discovers port
 *    from terminal env `_EXTENSION_OPENCODE_PORT`
 * 2. OpenCode Sidebar TUI (islee23520.opencode-sidebar-tui) — uses the
 *    `opencodeTui.sendToTerminal` command to send text, or HTTP API
 *    if `opencodeTui.enableHttpApi` is enabled
 *
 * Both use the OpenCode server's /tui/append-prompt HTTP endpoint.
 */
export class OpenCodeAdapter implements BackendAdapter {
  readonly name = 'opencode';
  private fallback = new ClipboardAdapter();

  async deliver(bundle: ContextBundle): Promise<DeliveryResult> {
    const text = this.formatContext(bundle);

    // Strategy 1: Try sending via opencodeTui.sendToTerminal command
    const hasSidebarTui = await this.hasSidebarTuiExtension();
    if (hasSidebarTui) {
      try {
        await vscode.commands.executeCommand('opencodeTui.sendToTerminal', text);
        return { success: true, message: 'Sent to OpenCode' };
      } catch {
        // Fall through to HTTP API
      }
    }

    // Strategy 2: Try HTTP API via terminal port discovery
    const port = this.findOpenCodePort();
    if (port) {
      try {
        await this.appendPrompt(port, text);
        return { success: true, message: 'Added to OpenCode prompt' };
      } catch {
        // Fall through to clipboard
      }
    }

    // Strategy 3: Clipboard fallback
    const result = await this.fallback.deliver(bundle);
    return {
      success: result.success,
      message: `OpenCode not found — ${result.message.toLowerCase()}`,
    };
  }

  async isAvailable(): Promise<boolean> {
    // Check for sidebar TUI extension
    if (await this.hasSidebarTuiExtension()) return true;
    // Check for official extension terminal
    if (this.findOpenCodePort() !== null) return true;
    return false;
  }

  private async hasSidebarTuiExtension(): Promise<boolean> {
    try {
      const commands = await vscode.commands.getCommands(true);
      return commands.includes('opencodeTui.sendToTerminal');
    } catch {
      return false;
    }
  }

  private findOpenCodePort(): number | null {
    for (const terminal of vscode.window.terminals) {
      const creationOptions = terminal.creationOptions as vscode.TerminalOptions;
      const env = creationOptions?.env;
      if (env?.['_EXTENSION_OPENCODE_PORT']) {
        return parseInt(env['_EXTENSION_OPENCODE_PORT'], 10);
      }
    }
    return null;
  }

  private appendPrompt(port: number, text: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const body = JSON.stringify({ text });
      const req = http.request(
        {
          hostname: 'localhost',
          port,
          path: '/tui/append-prompt',
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(body),
          },
          timeout: 3000,
        },
        (res) => {
          if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
            resolve();
          } else {
            reject(new Error(`OpenCode server returned ${res.statusCode}`));
          }
          res.resume();
        }
      );
      req.on('error', reject);
      req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
      req.write(body);
      req.end();
    });
  }

  private formatContext(bundle: ContextBundle): string {
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

    return parts.join('\n');
  }
}
