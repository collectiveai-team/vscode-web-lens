import * as vscode from 'vscode';
import * as http from 'http';
import type { ContextBundle, DeliveryResult } from '../types';
import type { BackendAdapter } from './BackendAdapter';
import { ClipboardAdapter } from './ClipboardAdapter';

/**
 * Delivers browser context to OpenChamber.
 *
 * OpenChamber is a desktop/web GUI for OpenCode — it runs an OpenCode server
 * internally. The integration uses the same HTTP API as OpenCodeAdapter
 * but discovers the server differently:
 * - Checks for a configurable port in extension settings
 * - Falls back to the default OpenCode server port (4096)
 */
export class OpenChamberAdapter implements BackendAdapter {
  readonly name = 'openchamber';
  private fallback = new ClipboardAdapter();

  async deliver(bundle: ContextBundle): Promise<DeliveryResult> {
    const port = this.getPort();

    // Check if the server is reachable
    const reachable = await this.isServerReachable(port);
    if (!reachable) {
      const result = await this.fallback.deliver(bundle);
      return {
        success: result.success,
        message: `OpenChamber not reachable on port ${port} — ${result.message.toLowerCase()}`,
      };
    }

    try {
      const text = this.formatContext(bundle);
      await this.appendPrompt(port, text);
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
    const port = this.getPort();
    return this.isServerReachable(port);
  }

  private getPort(): number {
    const config = vscode.workspace.getConfiguration('browserChat');
    // Allow user to configure OpenChamber's port if not using default
    return config.get<number>('openchamberPort') || 4096;
  }

  private isServerReachable(port: number): Promise<boolean> {
    return new Promise((resolve) => {
      const req = http.request(
        {
          hostname: 'localhost',
          port,
          path: '/health',
          method: 'GET',
          timeout: 1500,
        },
        (res) => {
          resolve(res.statusCode === 200);
          res.resume();
        }
      );
      req.on('error', () => resolve(false));
      req.on('timeout', () => {
        req.destroy();
        resolve(false);
      });
      req.end();
    });
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
            reject(new Error(`OpenChamber server returned ${res.statusCode}`));
          }
          res.resume();
        }
      );

      req.on('error', reject);
      req.on('timeout', () => {
        req.destroy();
        reject(new Error('OpenChamber server timeout'));
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
