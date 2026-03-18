import * as vscode from 'vscode';
import * as http from 'http';
import type { ContextBundle, DeliveryResult } from '../types';
import type { BackendAdapter } from './BackendAdapter';
import { ClipboardAdapter } from './ClipboardAdapter';

/**
 * Delivers browser context to OpenChamber (fedaykindev.openchamber).
 *
 * OpenChamber manages an OpenCode server internally. We discover the
 * server URL from the `openchamber.apiUrl` setting, or try the default
 * port (4096). Context is delivered via POST /tui/append-prompt.
 *
 * Availability is checked by looking for the `openchamber.addToContext`
 * command (registered by the OpenChamber extension) + server reachability.
 */
export class OpenChamberAdapter implements BackendAdapter {
  readonly name = 'openchamber';
  private fallback = new ClipboardAdapter();

  async deliver(bundle: ContextBundle): Promise<DeliveryResult> {
    const available = await this.isAvailable();
    if (!available) {
      const result = await this.fallback.deliver(bundle);
      return {
        success: result.success,
        message: `OpenChamber not available — ${result.message.toLowerCase()}`,
      };
    }

    try {
      const { hostname, port } = this.getServerAddress();
      const text = this.formatContext(bundle);
      await this.appendPrompt(hostname, port, text);
      return { success: true, message: 'Added to OpenChamber prompt' };
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
      // Check if the OpenChamber extension is installed
      const commands = await vscode.commands.getCommands(true);
      const hasExtension = commands.some((cmd) => cmd.startsWith('openchamber.'));
      if (!hasExtension) return false;

      // Check if the server is reachable
      const { hostname, port } = this.getServerAddress();
      return await this.isServerReachable(hostname, port);
    } catch {
      return false;
    }
  }

  private getServerAddress(): { hostname: string; port: number } {
    // Read OpenChamber's own apiUrl setting
    const config = vscode.workspace.getConfiguration('openchamber');
    const apiUrl = config.get<string>('apiUrl') || '';

    if (apiUrl) {
      try {
        const url = new URL(apiUrl);
        return {
          hostname: url.hostname || 'localhost',
          port: parseInt(url.port, 10) || 4096,
        };
      } catch {
        // Invalid URL, fall through to default
      }
    }

    return { hostname: 'localhost', port: 4096 };
  }

  private isServerReachable(hostname: string, port: number): Promise<boolean> {
    return new Promise((resolve) => {
      const req = http.request(
        { hostname, port, path: '/health', method: 'GET', timeout: 1500 },
        (res) => {
          resolve(res.statusCode === 200);
          res.resume();
        }
      );
      req.on('error', () => resolve(false));
      req.on('timeout', () => { req.destroy(); resolve(false); });
      req.end();
    });
  }

  private appendPrompt(hostname: string, port: number, text: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const body = JSON.stringify({ text });
      const req = http.request(
        {
          hostname, port,
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
            reject(new Error(`OpenChamber server returned ${res.statusCode}`));
          }
          res.resume();
        }
      );
      req.on('error', reject);
      req.on('timeout', () => { req.destroy(); reject(new Error('OpenChamber server timeout')); });
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
