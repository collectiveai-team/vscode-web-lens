import { describe, expect, it } from 'vitest';
import { createToolbarDiagnostic, getInstructionBannerHtml } from './toolbarDiagnostics';

describe('toolbarDiagnostics', () => {
  it('creates info diagnostics for toolbar actions', () => {
    expect(createToolbarDiagnostic('Inspect toggled on')).toEqual({
      type: 'diagnostic:log',
      payload: {
        source: 'webview.toolbar',
        level: 'info',
        message: 'Inspect toggled on',
      },
    });
  });

  it('shows inspect mode instructions when inspect is active', () => {
    expect(getInstructionBannerHtml({ inspectActive: true, addElementActive: false }))
      .toContain('Inspect mode active');
  });

  it('shows add-element instructions when add-element mode is active', () => {
    expect(getInstructionBannerHtml({ inspectActive: false, addElementActive: true }))
      .toContain('Click any element to add it to chat');
  });

  it('includes the escape shortcut in active mode instructions', () => {
    expect(getInstructionBannerHtml({ inspectActive: true, addElementActive: false }))
      .toContain('<kbd>ESC</kbd>');
  });

  it('returns empty html when no selection mode is active', () => {
    expect(getInstructionBannerHtml({ inspectActive: false, addElementActive: false })).toBe('');
  });
});
