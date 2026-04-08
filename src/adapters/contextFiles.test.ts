import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

vi.mock('vscode', () => ({
  workspace: {
    getConfiguration: vi.fn().mockReturnValue({
      get: vi.fn().mockReturnValue('.tmp'),
    }),
    workspaceFolders: [{ uri: { fsPath: '/mock/workspace' } }],
  },
  window: {
    createOutputChannel: vi.fn().mockReturnValue({
      appendLine: vi.fn(),
      show: vi.fn(),
      dispose: vi.fn(),
    }),
  },
}));

import {
  formatContextFile,
  resolveContextDir,
  saveContextFiles,
  cleanupOldFiles,
  buildAtReferences,
} from './contextFiles';
import type { SaveResult } from './contextFiles';
import type { ContextBundle } from '../types';
import * as vscode from 'vscode';

const mockedVscode = vi.mocked(vscode, true);

describe('formatContextFile', () => {
  it('formats element bundle with all fields', () => {
    const bundle: ContextBundle = {
      url: 'http://localhost:3000',
      timestamp: Date.now(),
      element: {
        html: '<div class="banner">Hello</div>',
        parentHtml: '<main><div class="banner">Hello</div></main>',
        ancestorPath: 'body > main > div.banner',
        tag: 'div',
        classes: ['banner'],
        dimensions: { top: 86, left: 252, width: 789, height: 71 },
        accessibility: { role: 'alert' },
        sourceLocation: { filePath: 'src/App.tsx', line: 42 },
        attributes: { class: 'banner', role: 'alert' },
        innerText: 'Hello world',
        computedStyles: { display: 'flex', color: 'rgb(0, 0, 0)' },
      },
    };

    const result = formatContextFile(bundle);

    expect(result).toContain('Web Lens Context from http://localhost:3000');
    expect(result).toContain('Element: div.banner');
    expect(result).toContain('Selector: body > main > div.banner');
    expect(result).toContain('Source: @src/App.tsx#L42');
    expect(result).toContain('Attributes:');
    expect(result).toContain('- class: banner');
    expect(result).toContain('- role: alert');
    expect(result).toContain('Dimensions:');
    expect(result).toContain('- top: 86px');
    expect(result).toContain('- left: 252px');
    expect(result).toContain('- width: 789px');
    expect(result).toContain('- height: 71px');
    expect(result).toContain('Inner Text:');
    expect(result).toContain('Hello world');
    expect(result).toContain('Computed Styles:');
    expect(result).toContain('- display: flex');
    expect(result).toContain('- color: rgb(0, 0, 0)');
    expect(result).toContain('Element HTML:');
    expect(result).toContain('<div class="banner">Hello</div>');
    expect(result).toContain('Parent HTML:');
    expect(result).toContain('<main><div class="banner">Hello</div></main>');
    expect(result.endsWith('\n')).toBe(true);
  });

  it('formats element label with id when present (tag#id)', () => {
    const bundle: ContextBundle = {
      url: 'http://localhost:3000',
      timestamp: Date.now(),
      element: {
        html: '<div id="main-content">Hello</div>',
        parentHtml: '<body><div id="main-content">Hello</div></body>',
        ancestorPath: 'body > div#main-content',
        tag: 'div',
        classes: ['container'],
        id: 'main-content',
        dimensions: { top: 0, left: 0, width: 100, height: 50 },
        accessibility: {},
      },
    };

    const result = formatContextFile(bundle);

    expect(result).toContain('Element: div#main-content');
  });

  it('formats element label with classes (tag.class1.class2)', () => {
    const bundle: ContextBundle = {
      url: 'http://localhost:3000',
      timestamp: Date.now(),
      element: {
        html: '<span class="text bold">Hello</span>',
        parentHtml: '<p><span class="text bold">Hello</span></p>',
        ancestorPath: 'body > p > span.text.bold',
        tag: 'span',
        classes: ['text', 'bold'],
        dimensions: { top: 0, left: 0, width: 100, height: 20 },
        accessibility: {},
      },
    };

    const result = formatContextFile(bundle);

    expect(result).toContain('Element: span.text.bold');
  });

  it('includes source location when available', () => {
    const bundle: ContextBundle = {
      url: 'http://localhost:3000',
      timestamp: Date.now(),
      element: {
        html: '<button>Click</button>',
        parentHtml: '<div><button>Click</button></div>',
        ancestorPath: 'body > div > button',
        tag: 'button',
        classes: [],
        dimensions: { top: 0, left: 0, width: 100, height: 30 },
        accessibility: {},
        sourceLocation: { filePath: 'src/components/Button.tsx', line: 15 },
      },
    };

    const result = formatContextFile(bundle);

    expect(result).toContain('Source: @src/components/Button.tsx#L15');
  });

  it('omits sections when data is missing', () => {
    const bundle: ContextBundle = {
      url: 'http://localhost:3000',
      timestamp: Date.now(),
      element: {
        html: '<div>Hello</div>',
        parentHtml: '<body><div>Hello</div></body>',
        ancestorPath: 'body > div',
        tag: 'div',
        classes: [],
        dimensions: { top: 0, left: 0, width: 100, height: 50 },
        accessibility: {},
        // No attributes, no innerText, no computedStyles, no sourceLocation
      },
    };

    const result = formatContextFile(bundle);

    expect(result).not.toContain('Attributes:');
    expect(result).not.toContain('Inner Text:');
    expect(result).not.toContain('Computed Styles:');
    expect(result).not.toContain('Source:');
    // Should still have core sections
    expect(result).toContain('Element: div');
    expect(result).toContain('Element HTML:');
    expect(result).toContain('Parent HTML:');
    expect(result).toContain('Dimensions:');
  });

  it('includes console logs when present', () => {
    const bundle: ContextBundle = {
      url: 'http://localhost:3000',
      timestamp: Date.now(),
      element: {
        html: '<div>Hello</div>',
        parentHtml: '<body><div>Hello</div></body>',
        ancestorPath: 'body > div',
        tag: 'div',
        classes: [],
        dimensions: { top: 0, left: 0, width: 100, height: 50 },
        accessibility: {},
      },
      logs: [
        { level: 'error', message: 'Something went wrong', timestamp: Date.now() },
        { level: 'warn', message: 'Deprecation warning', timestamp: Date.now() },
      ],
    };

    const result = formatContextFile(bundle);

    expect(result).toContain('Console Logs:');
    expect(result).toContain('[ERROR] Something went wrong');
    expect(result).toContain('[WARN] Deprecation warning');
  });

  it('handles logs-only bundle (no element)', () => {
    const bundle: ContextBundle = {
      url: 'http://localhost:3000',
      timestamp: Date.now(),
      logs: [
        { level: 'error', message: 'Something went wrong', timestamp: Date.now() },
      ],
    };

    const result = formatContextFile(bundle);

    expect(result).toContain('Web Lens Context from http://localhost:3000');
    expect(result).toContain('Console Logs:');
    expect(result).toContain('[ERROR] Something went wrong');
    expect(result).not.toContain('Element:');
    expect(result).not.toContain('Element HTML:');
    expect(result.endsWith('\n')).toBe(true);
  });
});

describe('resolveContextDir', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset to defaults
    (mockedVscode.workspace.getConfiguration as any).mockReturnValue({
      get: vi.fn().mockReturnValue('.tmp'),
    });
    (mockedVscode.workspace as any).workspaceFolders = [
      { uri: { fsPath: '/mock/workspace' } },
    ];
  });

  it('resolves relative path against workspace root', () => {
    const result = resolveContextDir();

    expect(result.dir).toBe(path.join('/mock/workspace', '.tmp'));
    expect(result.isWorkspaceRelative).toBe(true);
  });

  it('uses absolute path as-is', () => {
    (mockedVscode.workspace.getConfiguration as any).mockReturnValue({
      get: vi.fn().mockReturnValue('/absolute/path/to/context'),
    });

    const result = resolveContextDir();

    expect(result.dir).toBe('/absolute/path/to/context');
    expect(result.isWorkspaceRelative).toBe(false);
  });

  it('falls back to tmpdir when no workspace open', () => {
    (mockedVscode.workspace as any).workspaceFolders = undefined;

    const result = resolveContextDir();

    expect(result.dir).toBe(path.join(os.tmpdir(), '.tmp'));
    expect(result.isWorkspaceRelative).toBe(false);
  });
});

describe('saveContextFiles', () => {
  let tempDir: string;

  beforeEach(() => {
    vi.clearAllMocks();
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'context-test-'));
    // Mock resolveContextDir to use our temp dir
    (mockedVscode.workspace.getConfiguration as any).mockReturnValue({
      get: vi.fn().mockReturnValue(tempDir),
    });
    // Use absolute path so it doesn't resolve against workspace
    (mockedVscode.workspace as any).workspaceFolders = [
      { uri: { fsPath: '/mock/workspace' } },
    ];
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('writes context file and screenshot', async () => {
    const bundle: ContextBundle = {
      url: 'http://localhost:3000',
      timestamp: Date.now(),
      element: {
        html: '<div>Hello</div>',
        parentHtml: '<body><div>Hello</div></body>',
        ancestorPath: 'body > div',
        tag: 'div',
        classes: [],
        dimensions: { top: 0, left: 0, width: 100, height: 50 },
        accessibility: {},
      },
      screenshot: {
        dataUrl: 'data:image/png;base64,iVBORw0KGgo=',
        width: 800,
        height: 600,
      },
    };

    const result = await saveContextFiles(bundle);

    expect(result.contextPath).toMatch(/browser-context-\d+\.txt$/);
    expect(result.screenshotPath).toMatch(/browser-screenshot-\d+\.png$/);
    expect(fs.existsSync(result.contextPath)).toBe(true);
    expect(fs.existsSync(result.screenshotPath!)).toBe(true);

    const contextContent = fs.readFileSync(result.contextPath, 'utf-8');
    expect(contextContent).toContain('http://localhost:3000');
  });

  it('writes context file without screenshot when none present', async () => {
    const bundle: ContextBundle = {
      url: 'http://localhost:3000',
      timestamp: Date.now(),
      element: {
        html: '<div>Hello</div>',
        parentHtml: '<body><div>Hello</div></body>',
        ancestorPath: 'body > div',
        tag: 'div',
        classes: [],
        dimensions: { top: 0, left: 0, width: 100, height: 50 },
        accessibility: {},
      },
    };

    const result = await saveContextFiles(bundle);

    expect(result.contextPath).toMatch(/browser-context-\d+\.txt$/);
    expect(result.screenshotPath).toBeUndefined();
    expect(fs.existsSync(result.contextPath)).toBe(true);
  });

  it('both files share the same timestamp', async () => {
    const bundle: ContextBundle = {
      url: 'http://localhost:3000',
      timestamp: Date.now(),
      element: {
        html: '<div>Hello</div>',
        parentHtml: '<body><div>Hello</div></body>',
        ancestorPath: 'body > div',
        tag: 'div',
        classes: [],
        dimensions: { top: 0, left: 0, width: 100, height: 50 },
        accessibility: {},
      },
      screenshot: {
        dataUrl: 'data:image/png;base64,iVBORw0KGgo=',
        width: 800,
        height: 600,
      },
    };

    const result = await saveContextFiles(bundle);

    const contextTs = path.basename(result.contextPath).match(/browser-context-(\d+)\.txt/)![1];
    const screenshotTs = path.basename(result.screenshotPath!).match(/browser-screenshot-(\d+)\.png/)![1];
    expect(contextTs).toBe(screenshotTs);
    expect(result.timestamp).toBe(Number(contextTs));
  });
});

describe('cleanupOldFiles', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cleanup-test-'));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('deletes files older than maxAge', () => {
    const oldFile = path.join(tempDir, 'browser-context-1000.txt');
    const oldScreenshot = path.join(tempDir, 'browser-screenshot-1000.png');
    fs.writeFileSync(oldFile, 'old context');
    fs.writeFileSync(oldScreenshot, 'old screenshot');

    // Set mtime to 2 hours ago
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
    fs.utimesSync(oldFile, twoHoursAgo, twoHoursAgo);
    fs.utimesSync(oldScreenshot, twoHoursAgo, twoHoursAgo);

    cleanupOldFiles(tempDir, 60 * 60 * 1000); // 1 hour

    expect(fs.existsSync(oldFile)).toBe(false);
    expect(fs.existsSync(oldScreenshot)).toBe(false);
  });

  it('does not delete recent files', () => {
    const recentFile = path.join(tempDir, 'browser-context-9999.txt');
    const recentScreenshot = path.join(tempDir, 'browser-screenshot-9999.png');
    fs.writeFileSync(recentFile, 'recent context');
    fs.writeFileSync(recentScreenshot, 'recent screenshot');

    cleanupOldFiles(tempDir, 60 * 60 * 1000); // 1 hour

    expect(fs.existsSync(recentFile)).toBe(true);
    expect(fs.existsSync(recentScreenshot)).toBe(true);
  });

  it('does not throw on errors', () => {
    expect(() => cleanupOldFiles('/nonexistent/path/that/does/not/exist')).not.toThrow();
  });
});

describe('buildAtReferences', () => {
  it('builds workspace-relative references', () => {
    const result: SaveResult = {
      contextPath: '/mock/workspace/.tmp/browser-context-12345.txt',
      screenshotPath: '/mock/workspace/.tmp/browser-screenshot-12345.png',
      timestamp: 12345,
      dir: '/mock/workspace/.tmp',
      isWorkspaceRelative: true,
      workspaceRoot: '/mock/workspace',
    };

    const refs = buildAtReferences(result);

    expect(refs).toBe('@.tmp/browser-screenshot-12345.png @.tmp/browser-context-12345.txt');
  });

  it('builds absolute references when not workspace-relative', () => {
    const result: SaveResult = {
      contextPath: '/tmp/browser-context-12345.txt',
      timestamp: 12345,
      dir: '/tmp',
      isWorkspaceRelative: false,
    };

    const refs = buildAtReferences(result);

    expect(refs).toBe('@/tmp/browser-context-12345.txt');
  });

  it('omits screenshot reference when no screenshot', () => {
    const result: SaveResult = {
      contextPath: '/mock/workspace/.tmp/browser-context-12345.txt',
      timestamp: 12345,
      dir: '/mock/workspace/.tmp',
      isWorkspaceRelative: true,
      workspaceRoot: '/mock/workspace',
    };

    const refs = buildAtReferences(result);

    expect(refs).not.toContain('screenshot');
    expect(refs).toBe('@.tmp/browser-context-12345.txt');
  });
});
