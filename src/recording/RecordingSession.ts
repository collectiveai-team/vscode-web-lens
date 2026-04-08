import * as fs from 'fs';
import * as path from 'path';
import { randomUUID } from 'crypto';
import type { RecordedEvent, RecordOptions } from '../types';

export interface RecordingSessionOptions extends RecordOptions {
  workspaceRoot: string;
  startUrl: string;
  userAgent: string;
}

export class RecordingSession {
  private readonly events: RecordedEvent[] = [];
  private readonly startedAt: Date;
  private readonly id: string;
  private readonly options: RecordingSessionOptions;
  private saved = false;

  constructor(options: RecordingSessionOptions) {
    this.options = options;
    this.startedAt = new Date();
    this.id = randomUUID();
  }

  addEvent(event: RecordedEvent): void {
    this.events.push(event);
  }

  get eventCount(): number {
    return this.events.length;
  }

  async save(): Promise<string> {
    if (this.saved) return '';
    this.saved = true;

    const stoppedAt = new Date();
    const recordingsDir = path.join(this.options.workspaceRoot, '.weblens-recordings');
    fs.mkdirSync(recordingsDir, { recursive: true });

    let hostname = 'unknown';
    try {
      hostname = new URL(this.options.startUrl).hostname;
    } catch {
      // leave unknown
    }

    const timestamp = this.startedAt.toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const sanitized = hostname.replace(/[^a-zA-Z0-9.-]/g, '-');
    const filePath = path.join(recordingsDir, `${timestamp}-${sanitized}.json`);

    const output = {
      version: '1.0',
      session: {
        id: this.id,
        startedAt: this.startedAt.toISOString(),
        stoppedAt: stoppedAt.toISOString(),
        startUrl: this.options.startUrl,
        userAgent: this.options.userAgent,
        capturedOptional: {
          console: this.options.captureConsole,
          scroll: this.options.captureScroll,
          hover: this.options.captureHover,
        },
      },
      events: this.events,
    };

    fs.writeFileSync(filePath, JSON.stringify(output, null, 2), 'utf-8');
    return filePath;
  }

  dispose(): void {
    if (!this.saved) {
      void this.save();
    }
  }
}
