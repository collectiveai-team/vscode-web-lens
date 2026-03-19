import * as vscode from 'vscode';
import * as http from 'http';
import type { ContextBundle, DeliveryResult } from '../types';
import type { BackendAdapter } from './BackendAdapter';
import { ClipboardAdapter } from './ClipboardAdapter';
import { getOpenCodeAuthHeaders } from './auth';
import { saveContextFiles, cleanupOldFiles, buildAtReferences } from './contextFiles';

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
      const result = await saveContextFiles(bundle);
      cleanupOldFiles(result.dir); // fire-and-forget
      const refs = buildAtReferences(result);
      await this.appendPrompt(port, refs);
      return { success: true, message: 'Added to OpenCode prompt' };
    } catch (_err) {
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

}
