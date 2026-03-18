import * as vscode from 'vscode';
import * as http from 'http';
import type { ContextBundle, DeliveryResult } from '../types';
import type { BackendAdapter } from './BackendAdapter';
import { ClipboardAdapter } from './ClipboardAdapter';

/**
 * Delivers browser context to OpenCode by appending it to the active
 * OpenCode terminal's prompt via the OpenCode HTTP server API.
 *
 * Discovery: OpenCode's VS Code extension runs `opencode --port <port>`
 * in a terminal and stores the port in `_EXTENSION_OPENCODE_PORT` env var.
 * We find that terminal, extract the port, and POST to `/tui/append-prompt`.
 */
export class OpenCodeAdapter implements BackendAdapter {
  readonly name = 'opencode';
  private fallback = new ClipboardAdapter();

  async deliver(bundle: ContextBundle): Promise<DeliveryResult> {
    const port = this.findOpenCodePort();

    if (!port) {
      const result = await this.fallback.deliver(bundle);
      return {
        success: result.success,
        message: `OpenCode terminal not found — ${result.message.toLowerCase()}`,
      };
    }

    try {
      const text = this.formatContext(bundle);
      await this.appendPrompt(port, text);
      return { success: true, message: 'Added to OpenCode prompt' };
    } catch (err) {
      const result = await this.fallback.deliver(bundle);
      return {
        success: result.success,
        message: `OpenCode error, fell back to clipboard`,
      };
    }
  }

  async isAvailable(): Promise<boolean> {
    return this.findOpenCodePort() !== null;
  }

  private findOpenCodePort(): number | null {
    for (const terminal of vscode.window.terminals) {
      // OpenCode's VS Code extension stores the port in the terminal's env
      const creationOptions = terminal.creationOptions as vscode.TerminalOptions;
      const env = creationOptions?.env;
      if (env?.['_EXTENSION_OPENCODE_PORT']) {
        return parseInt(env['_EXTENSION_OPENCODE_PORT'], 10);
      }
      // Also check by terminal name as fallback
      if (terminal.name === 'opencode') {
        // If we can't get the port from env, try the default
        return null;
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
          res.resume(); // drain response
        }
      );

      req.on('error', reject);
      req.on('timeout', () => {
        req.destroy();
        reject(new Error('OpenCode server timeout'));
      });
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
