import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('vscode', () => ({
  workspace: {
    getConfiguration: vi.fn().mockReturnValue({
      get: vi.fn().mockReturnValue(false),
    }),
  },
}));

vi.mock('../logging', () => ({
  webLensLogger: {
    info: vi.fn(), warn: vi.fn(), error: vi.fn(), show: vi.fn(), dispose: vi.fn(),
  },
}));

import * as vscode from 'vscode';
import { CookieStore } from './CookieStore';

function makeSecrets(): vscode.SecretStorage {
  const map = new Map<string, string>();
  return {
    get: vi.fn((key: string) => Promise.resolve(map.get(key))),
    store: vi.fn((key: string, value: string) => { map.set(key, value); return Promise.resolve(); }),
    delete: vi.fn((key: string) => { map.delete(key); return Promise.resolve(); }),
    onDidChange: vi.fn() as any,
  };
}

describe('CookieStore', () => {
  let secrets: vscode.SecretStorage;

  beforeEach(() => {
    secrets = makeSecrets();
    vi.mocked(vscode.workspace.getConfiguration).mockReturnValue({
      get: vi.fn().mockReturnValue(false),
    } as any);
  });

  describe('isEnabled', () => {
    it('returns false when storeCookies setting is false', () => {
      const store = new CookieStore(secrets);
      expect(store.isEnabled()).toBe(false);
    });

    it('returns true when storeCookies setting is true', () => {
      vi.mocked(vscode.workspace.getConfiguration).mockReturnValue({
        get: vi.fn().mockReturnValue(true),
      } as any);
      const store = new CookieStore(secrets);
      expect(store.isEnabled()).toBe(true);
    });
  });

  describe('key naming', () => {
    it('uses global key when no workspace folder provided', async () => {
      const store = new CookieStore(secrets);
      await store.merge('http://localhost:3000', { session: 'abc' });
      expect(secrets.store).toHaveBeenCalledWith(
        'web-lens:cookies:global:http://localhost:3000',
        expect.any(String)
      );
    });

    it('uses workspace-scoped key when workspace folder provided', async () => {
      const store = new CookieStore(secrets, 'file:///home/user/myapp');
      await store.merge('http://localhost:3000', { session: 'abc' });
      expect(secrets.store).toHaveBeenCalledWith(
        'web-lens:cookies:ws:file:///home/user/myapp:http://localhost:3000',
        expect.any(String)
      );
    });
  });

  describe('get', () => {
    it('returns empty object when no cookies stored', async () => {
      const store = new CookieStore(secrets);
      expect(await store.get('http://localhost:3000')).toEqual({});
    });

    it('returns stored cookies', async () => {
      const store = new CookieStore(secrets);
      await store.merge('http://localhost:3000', { session: 'abc', csrf: 'xyz' });
      expect(await store.get('http://localhost:3000')).toEqual({ session: 'abc', csrf: 'xyz' });
    });

    it('returns empty object on malformed JSON', async () => {
      vi.mocked(secrets.get).mockResolvedValueOnce('not-valid-json');
      const store = new CookieStore(secrets);
      expect(await store.get('http://localhost:3000')).toEqual({});
    });
  });

  describe('merge', () => {
    it('adds new cookies without removing existing ones', async () => {
      const store = new CookieStore(secrets);
      await store.merge('http://localhost:3000', { session: 'abc' });
      await store.merge('http://localhost:3000', { csrf: 'xyz' });
      expect(await store.get('http://localhost:3000')).toEqual({ session: 'abc', csrf: 'xyz' });
    });

    it('overwrites existing cookie with the same name', async () => {
      const store = new CookieStore(secrets);
      await store.merge('http://localhost:3000', { session: 'old' });
      await store.merge('http://localhost:3000', { session: 'new' });
      expect(await store.get('http://localhost:3000')).toEqual({ session: 'new' });
    });
  });

  describe('remove', () => {
    it('removes specified cookie names', async () => {
      const store = new CookieStore(secrets);
      await store.merge('http://localhost:3000', { session: 'abc', csrf: 'xyz', pref: '1' });
      await store.remove('http://localhost:3000', ['session', 'csrf']);
      expect(await store.get('http://localhost:3000')).toEqual({ pref: '1' });
    });

    it('deletes the key entirely when all cookies removed', async () => {
      const store = new CookieStore(secrets);
      await store.merge('http://localhost:3000', { session: 'abc' });
      await store.remove('http://localhost:3000', ['session']);
      expect(secrets.delete).toHaveBeenCalledWith('web-lens:cookies:global:http://localhost:3000');
    });
  });

  describe('clear', () => {
    it('deletes the key for the given origin', async () => {
      const store = new CookieStore(secrets);
      await store.merge('http://localhost:3000', { session: 'abc' });
      await store.clear('http://localhost:3000');
      expect(await store.get('http://localhost:3000')).toEqual({});
    });
  });

  describe('listNames', () => {
    it('returns empty array when no cookies stored', async () => {
      const store = new CookieStore(secrets);
      expect(await store.listNames('http://localhost:3000')).toEqual([]);
    });

    it('returns cookie names without values', async () => {
      const store = new CookieStore(secrets);
      await store.merge('http://localhost:3000', { session: 'abc', csrf: 'xyz' });
      const names = await store.listNames('http://localhost:3000');
      expect(names.sort()).toEqual(['csrf', 'session']);
    });
  });
});
