import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as path from 'path';

vi.mock('fs', () => {
  const mkdirSync = vi.fn();
  const writeFileSync = vi.fn();
  return { default: { mkdirSync, writeFileSync }, mkdirSync, writeFileSync };
});

import * as fs from 'fs';
import { RecordingSession } from './RecordingSession';
import type { RecordedEvent } from '../types';

const BASE_OPTS = {
  workspaceRoot: '/workspace',
  startUrl: 'http://localhost:3000',
  userAgent: 'test-ua/1.0',
  captureConsole: false,
  captureScroll: false,
  captureHover: false,
};

describe('RecordingSession', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.restoreAllMocks());

  it('starts with zero events', () => {
    const session = new RecordingSession(BASE_OPTS);
    expect(session.eventCount).toBe(0);
  });

  it('addEvent increments eventCount', () => {
    const session = new RecordingSession(BASE_OPTS);
    const ev: RecordedEvent = {
      type: 'click',
      timestamp: 1000,
      selector: '[data-testid="btn"]',
      selectorType: 'data-testid',
      text: 'Go',
      position: { x: 10, y: 20 },
    };
    session.addEvent(ev);
    expect(session.eventCount).toBe(1);
  });

  it('save() creates the recordings directory', async () => {
    const session = new RecordingSession(BASE_OPTS);
    await session.save();
    expect(fs.mkdirSync).toHaveBeenCalledWith('/workspace/.weblens-recordings', { recursive: true });
  });

  it('save() writes a JSON file', async () => {
    const session = new RecordingSession(BASE_OPTS);
    const filePath = await session.save();
    expect(fs.writeFileSync).toHaveBeenCalledTimes(1);
    expect(filePath).toMatch(/\.weblens-recordings\/.+\.json$/);
  });

  it('saved JSON contains version and session metadata', async () => {
    const session = new RecordingSession(BASE_OPTS);
    await session.save();
    const [, rawJson] = (fs.writeFileSync as ReturnType<typeof vi.fn>).mock.calls[0] as [string, string];
    const parsed = JSON.parse(rawJson);
    expect(parsed.version).toBe('1.0');
    expect(parsed.session.startUrl).toBe('http://localhost:3000');
    expect(parsed.session.userAgent).toBe('test-ua/1.0');
    expect(parsed.session.id).toBeTruthy();
    expect(parsed.session.startedAt).toBeTruthy();
    expect(parsed.session.stoppedAt).toBeTruthy();
  });

  it('saved JSON includes all buffered events', async () => {
    const session = new RecordingSession(BASE_OPTS);
    session.addEvent({ type: 'navigation', timestamp: 1, url: 'http://localhost:3000/about', trigger: 'pushState' });
    session.addEvent({ type: 'click', timestamp: 2, selector: '#btn', selectorType: 'id', text: 'OK', position: { x: 0, y: 0 } });
    await session.save();
    const [, rawJson] = (fs.writeFileSync as ReturnType<typeof vi.fn>).mock.calls[0] as [string, string];
    const parsed = JSON.parse(rawJson);
    expect(parsed.events).toHaveLength(2);
    expect(parsed.events[0].type).toBe('navigation');
    expect(parsed.events[1].type).toBe('click');
  });

  it('capturedOptional flags appear in session metadata', async () => {
    const session = new RecordingSession({ ...BASE_OPTS, captureConsole: true });
    await session.save();
    const [, rawJson] = (fs.writeFileSync as ReturnType<typeof vi.fn>).mock.calls[0] as [string, string];
    const parsed = JSON.parse(rawJson);
    expect(parsed.session.capturedOptional).toEqual({ console: true, scroll: false, hover: false });
  });

  it('save() is idempotent — second call is a no-op', async () => {
    const session = new RecordingSession(BASE_OPTS);
    await session.save();
    await session.save();
    expect(fs.writeFileSync).toHaveBeenCalledTimes(1);
  });

  it('dispose() auto-saves when not yet saved', async () => {
    const session = new RecordingSession(BASE_OPTS);
    session.dispose();
    await new Promise((r) => setTimeout(r, 0));
    expect(fs.writeFileSync).toHaveBeenCalledTimes(1);
  });

  it('dispose() after save() does not double-save', async () => {
    const session = new RecordingSession(BASE_OPTS);
    await session.save();
    session.dispose();
    await new Promise((r) => setTimeout(r, 0));
    expect(fs.writeFileSync).toHaveBeenCalledTimes(1);
  });

  it('filename contains the hostname from startUrl', async () => {
    const session = new RecordingSession({ ...BASE_OPTS, startUrl: 'http://my-app.local:3000/login' });
    const filePath = await session.save();
    expect(filePath).toContain('my-app.local');
  });

  it('filename contains a timestamp prefix', async () => {
    const session = new RecordingSession(BASE_OPTS);
    const filePath = await session.save();
    expect(path.basename(filePath)).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});
