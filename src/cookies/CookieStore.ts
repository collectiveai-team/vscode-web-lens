import * as vscode from 'vscode';
import { webLensLogger } from '../logging';

/**
 * Persists cookies in VS Code's encrypted SecretStorage.
 *
 * Scope is determined at construction: if a workspaceFolderUri is provided,
 * cookies are stored per-workspace (isolated per project). Otherwise global.
 *
 * All public methods are fire-and-forget safe: they catch and log errors
 * instead of throwing, so proxy requests are never blocked by storage failures.
 */
export class CookieStore {
  constructor(
    private readonly secrets: vscode.SecretStorage,
    private readonly workspaceFolderUri?: string,
  ) {}

  /** Returns true if the webLens.storeCookies setting is enabled. */
  isEnabled(): boolean {
    return vscode.workspace
      .getConfiguration('webLens')
      .get<boolean>('storeCookies', false);
  }

  private buildKey(origin: string): string {
    if (this.workspaceFolderUri) {
      return `web-lens:cookies:ws:${this.workspaceFolderUri}:${origin}`;
    }
    return `web-lens:cookies:global:${origin}`;
  }

  /** Read stored cookies for an origin. Returns {} on any error. */
  async get(origin: string): Promise<Record<string, string>> {
    try {
      const raw = await this.secrets.get(this.buildKey(origin));
      if (!raw) return {};
      return JSON.parse(raw) as Record<string, string>;
    } catch (err) {
      webLensLogger.warn('CookieStore: failed to read cookies', String(err));
      return {};
    }
  }

  /** Merge new cookies into existing storage for an origin. */
  async merge(origin: string, cookies: Record<string, string>): Promise<void> {
    try {
      const existing = await this.get(origin);
      const merged = { ...existing, ...cookies };
      await this.secrets.store(this.buildKey(origin), JSON.stringify(merged));
    } catch (err) {
      webLensLogger.warn('CookieStore: failed to save cookies', String(err));
    }
  }

  /** Remove specific cookie names for an origin. */
  async remove(origin: string, names: string[]): Promise<void> {
    try {
      const existing = await this.get(origin);
      for (const name of names) {
        delete existing[name];
      }
      if (Object.keys(existing).length === 0) {
        await this.secrets.delete(this.buildKey(origin));
      } else {
        await this.secrets.store(this.buildKey(origin), JSON.stringify(existing));
      }
    } catch (err) {
      webLensLogger.warn('CookieStore: failed to remove cookies', String(err));
    }
  }

  /** Delete all cookies for an origin. */
  async clear(origin: string): Promise<void> {
    try {
      await this.secrets.delete(this.buildKey(origin));
    } catch (err) {
      webLensLogger.warn('CookieStore: failed to clear cookies', String(err));
    }
  }

  /** List stored cookie names (not values) for an origin. */
  async listNames(origin: string): Promise<string[]> {
    const cookies = await this.get(origin);
    return Object.keys(cookies);
  }
}
