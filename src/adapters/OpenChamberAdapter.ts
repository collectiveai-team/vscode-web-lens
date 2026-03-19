import * as vscode from 'vscode';
import * as http from 'http';
import * as childProcess from 'child_process';
import type { ContextBundle, DeliveryResult } from '../types';
import type { BackendAdapter } from './BackendAdapter';
import { ClipboardAdapter } from './ClipboardAdapter';

/**
 * Delivers browser context to OpenChamber (fedaykindev.openchamber).
 *
 * OpenChamber spawns `opencode serve --port <random>` on a RANDOM port.
 * Port discovery (in priority order):
 * 1. openchamber.apiUrl setting — if user configured an external server
 * 2. Process scan — find `opencode serve --port <N>` processes
 *
 * Context delivery: POST /tui/append-prompt with { "prompt": text }
 */
export class OpenChamberAdapter implements BackendAdapter {
  readonly name = 'openchamber';
  private fallback = new ClipboardAdapter();

  async deliver(bundle: ContextBundle): Promise<DeliveryResult> {
    const server = await this.discoverServer();
    if (!server) {
      const result = await this.fallback.deliver(bundle);
      return {
        success: result.success,
        message: `OpenChamber not available — ${result.message.toLowerCase()}`,
      };
    }

    try {
      const text = this.formatContext(bundle);
      await this.appendPrompt(server.hostname, server.port, text);
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
      const commands = await vscode.commands.getCommands(true);
      if (!commands.some((cmd) => cmd.startsWith('openchamber.'))) return false;
      const server = await this.discoverServer();
      return server !== null;
    } catch {
      return false;
    }
  }

  private async discoverServer(): Promise<{ hostname: string; port: number } | null> {
    // Strategy 1: Read openchamber.apiUrl setting
    const config = vscode.workspace.getConfiguration('openchamber');
    const apiUrl = config.get<string>('apiUrl') || '';
    if (apiUrl) {
      try {
        const url = new URL(apiUrl);
        const hostname = url.hostname || '127.0.0.1';
        const port = parseInt(url.port, 10) || 4096;
        if (await this.isReachable(hostname, port)) {
          return { hostname, port };
        }
      } catch {
        // Invalid URL
      }
    }

    // Strategy 2: Scan for opencode serve processes spawned by OpenChamber
    const port = await this.scanForOpenCodeServePort();
    if (port && await this.isReachable('127.0.0.1', port)) {
      return { hostname: '127.0.0.1', port };
    }

    return null;
  }

  private scanForOpenCodeServePort(): Promise<number | null> {
    return new Promise((resolve) => {
      try {
        const cmd = process.platform === 'win32'
          ? 'wmic process where "name like \'%opencode%\'" get commandline /format:list'
          : 'ps aux | grep "opencode serve" | grep -v grep';

        childProcess.exec(cmd, { timeout: 2000 }, (err, stdout) => {
          if (err || !stdout) {
            resolve(null);
            return;
          }
          // Match --port <number> or --port=<number>
          const match = stdout.match(/--port(?:=|\s+)(\d{2,5})/);
          resolve(match ? parseInt(match[1], 10) : null);
        });
      } catch {
        resolve(null);
      }
    });
  }

  private isReachable(hostname: string, port: number): Promise<boolean> {
    return new Promise((resolve) => {
      const req = http.request(
        { hostname, port, path: '/health', method: 'GET', timeout: 1500 },
        (res) => { resolve(res.statusCode === 200); res.resume(); }
      );
      req.on('error', () => resolve(false));
      req.on('timeout', () => { req.destroy(); resolve(false); });
      req.end();
    });
  }

  private appendPrompt(hostname: string, port: number, text: string): Promise<void> {
    return new Promise((resolve, reject) => {
      // OpenCode expects { "prompt": text }
      const body = JSON.stringify({ prompt: text });
      const req = http.request(
        {
          hostname, port,
          path: '/tui/append-prompt',
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json',
            'Content-Length': Buffer.byteLength(body),
          },
          timeout: 3000,
        },
        (res) => {
          if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
            resolve();
          } else {
            reject(new Error(`Server returned ${res.statusCode}`));
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
