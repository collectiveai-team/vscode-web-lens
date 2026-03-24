import * as vscode from 'vscode';

type LogLevel = 'info' | 'warn' | 'error';
const OUTPUT_CHANNEL_NAME = 'Web Lens Debug';

let outputChannel: vscode.OutputChannel | undefined;

function getOutputChannel(): vscode.OutputChannel {
  if (!outputChannel) {
    outputChannel = vscode.window.createOutputChannel(OUTPUT_CHANNEL_NAME);
  }

  return outputChannel;
}

function formatMetadata(metadata: unknown): string {
  if (metadata === undefined) {
    return '';
  }

  if (metadata instanceof Error) {
    return metadata.stack || metadata.message;
  }

  if (typeof metadata === 'string') {
    return metadata;
  }

  try {
    return JSON.stringify(metadata);
  } catch {
    return String(metadata);
  }
}

function write(level: LogLevel, message: string, metadata?: unknown) {
  const timestamp = new Date().toISOString();
  const suffix = formatMetadata(metadata);
  const line = suffix
    ? `[${timestamp}] [${level}] ${message} ${suffix}`
    : `[${timestamp}] [${level}] ${message}`;

  getOutputChannel().appendLine(line);
}

export const webLensLogger = {
  info(message: string, metadata?: unknown) {
    write('info', message, metadata);
  },

  warn(message: string, metadata?: unknown) {
    write('warn', message, metadata);
  },

  error(message: string, metadata?: unknown) {
    write('error', message, metadata);
  },

  show() {
    getOutputChannel().show(true);
  },

  dispose() {
    outputChannel?.dispose();
    outputChannel = undefined;
  },
};
