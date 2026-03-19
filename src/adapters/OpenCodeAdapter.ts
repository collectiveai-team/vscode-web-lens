import * as vscode from 'vscode';
import * as http from 'http';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';
import type { ContextBundle, DeliveryResult } from '../types';
import type { BackendAdapter } from './BackendAdapter';
import { ClipboardAdapter } from './ClipboardAdapter';
import { getOpenCodeAuthHeaders } from './auth';

/**
 * Delivers browser context to OpenCode via its HTTP API.
 *
 * Port discovery (in priority order):
 * 1. opencode-sidebar-tui extension (islee23520): reads port from the
 *    embedded terminal's _EXTENSION_OPENCODE_PORT env var
 * 2. Official opencode extension (anomalyco): same env var on VS Code terminals
 *
 * Context delivery: POST /tui/append-prompt with { "prompt": text }
 *
 * Note: opencodeTui.sendToTerminal command does NOT accept arguments —
 * it reads from the active editor selection. We must use the HTTP API.
 */
export class OpenCodeAdapter implements BackendAdapter {
  readonly name = 'opencode';
  private fallback = new ClipboardAdapter();

  async deliver(bundle: ContextBundle): Promise<DeliveryResult> {
    const port = await this.discoverPort();
    if (!port) {
      const result = await this.fallback.deliver(bundle);
      return {
        success: result.success,
        message: `OpenCode not found — ${result.message.toLowerCase()}`,
      };
    }

    try {
      // Save screenshot to temp file if present
      let screenshotPath = '';
      if (bundle.screenshot?.dataUrl) {
        screenshotPath = path.join(os.tmpdir(), `browser-screenshot-${Date.now()}.png`);
        const base64Data = bundle.screenshot.dataUrl.replace(/^data:image\/\w+;base64,/, '');
        fs.writeFileSync(screenshotPath, Buffer.from(base64Data, 'base64'));
      }

      const text = this.formatContext(bundle, screenshotPath);
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
    const port = await this.discoverPort();
    return port !== null;
  }

  /**
   * Discover the OpenCode HTTP API port.
   * Scans VS Code terminals for _EXTENSION_OPENCODE_PORT env var,
   * then verifies the server is reachable via /health.
   */
  private async discoverPort(): Promise<number | null> {
    // Check terminals for port env var (works for both official and sidebar-tui extensions)
    for (const terminal of vscode.window.terminals) {
      const creationOptions = terminal.creationOptions as vscode.TerminalOptions;
      const env = creationOptions?.env;
      const portStr = env?.['_EXTENSION_OPENCODE_PORT'];
      if (portStr) {
        const port = parseInt(portStr, 10);
        if (port > 0 && await this.isReachable(port)) {
          return port;
        }
      }
    }
    return null;
  }

  private isReachable(port: number): Promise<boolean> {
    return new Promise((resolve) => {
      const req = http.request(
        { hostname: '127.0.0.1', port, path: '/global/health', method: 'GET', timeout: 1500, headers: getOpenCodeAuthHeaders() },
        (res) => { resolve(res.statusCode === 200); res.resume(); }
      );
      req.on('error', () => resolve(false));
      req.on('timeout', () => { req.destroy(); resolve(false); });
      req.end();
    });
  }

  private appendPrompt(port: number, text: string): Promise<void> {
    return new Promise((resolve, reject) => {
      // OpenCode server expects { "text": text }
      const body = JSON.stringify({ text });
      const req = http.request(
        {
          hostname: '127.0.0.1',
          port,
          path: '/tui/append-prompt',
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json',
            'Content-Length': Buffer.byteLength(body),
            ...getOpenCodeAuthHeaders(),
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

  private formatContext(bundle: ContextBundle, screenshotPath?: string): string {
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

    if (screenshotPath) {
      parts.push('');
      parts.push(`Screenshot: ${screenshotPath}`);
    }

    return parts.join('\n');
  }
}
