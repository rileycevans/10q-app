/**
 * Structured logging utility for client-side
 * Matches server-side logStructured pattern for consistent debugging
 */

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

type LogScope = 'auth' | 'quiz' | 'timer' | 'network' | 'storage' | 'ui' | 'league' | 'leaderboard';

interface LogEntry {
  event: string;
  scope: LogScope;
  timestamp: string;
  request_id?: string;
  action_id?: string;
  [key: string]: unknown;
}

interface LoggerConfig {
  level: LogLevel;
  enableDiagnostic: boolean;
  flightRecorderSize: number;
  samplingRate: number;
}

// Default config - can be overridden by environment or query params
const getConfig = (): LoggerConfig => {
  const isDev = process.env.NODE_ENV === 'development';
  const urlParams = typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : null;
  const debugParam = urlParams?.get('debug') === '1';
  
  return {
    level: (process.env.NEXT_PUBLIC_LOG_LEVEL as LogLevel) || (isDev ? 'debug' : 'info'),
    enableDiagnostic: debugParam || process.env.NEXT_PUBLIC_ENABLE_DIAGNOSTIC_LOGS === 'true',
    flightRecorderSize: 1000,
    samplingRate: parseFloat(process.env.NEXT_PUBLIC_DEBUG_LOG_SAMPLING_RATE || '1.0'),
  };
};

// Flight recorder: in-memory ring buffer
class FlightRecorder {
  private buffer: LogEntry[] = [];
  private maxSize: number;
  private bundleId: string | null = null;

  constructor(maxSize: number) {
    this.maxSize = maxSize;
  }

  add(entry: LogEntry): void {
    this.buffer.push(entry);
    if (this.buffer.length > this.maxSize) {
      this.buffer.shift();
    }
  }

  getBundle(): { bundleId: string; logs: LogEntry[] } {
    if (!this.bundleId) {
      this.bundleId = `bundle-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    }
    return {
      bundleId: this.bundleId,
      logs: [...this.buffer],
    };
  }

  reset(): void {
    this.buffer = [];
    this.bundleId = null;
  }

  getBundleId(): string | null {
    return this.bundleId;
  }
}

// Redaction: remove sensitive data
function redact(data: Record<string, unknown>): Record<string, unknown> {
  const redacted = { ...data };
  const sensitiveKeys = [
    'access_token',
    'refresh_token',
    'token',
    'authorization',
    'cookie',
    'email',
    'phone',
    'address',
    'password',
  ];

  for (const key of sensitiveKeys) {
    if (key in redacted) {
      if (typeof redacted[key] === 'string') {
        const value = redacted[key] as string;
        redacted[key] = value.length > 0 ? `[REDACTED:${value.length}chars]` : '[REDACTED]';
      } else {
        redacted[key] = '[REDACTED]';
      }
    }
  }

  // Redact nested objects
  for (const [key, value] of Object.entries(redacted)) {
    if (value && typeof value === 'object' && !Array.isArray(value) && !(value instanceof Date)) {
      redacted[key] = redact(value as Record<string, unknown>);
    }
  }

  return redacted;
}

// Hash user ID for privacy
export function hashUserId(userId: string): string {
  // Simple hash for client-side (not cryptographically secure, but sufficient for logging)
  let hash = 0;
  for (let i = 0; i < userId.length; i++) {
    const char = userId.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32-bit integer
  }
  return Math.abs(hash).toString(36).slice(0, 8);
}

class Logger {
  private config: LoggerConfig;
  private flightRecorder: FlightRecorder;
  private logLevels: Record<LogLevel, number> = {
    debug: 0,
    info: 1,
    warn: 2,
    error: 3,
  };

  constructor() {
    this.config = getConfig();
    this.flightRecorder = new FlightRecorder(this.config.flightRecorderSize);
    
    // Log initialization
    if (typeof window !== 'undefined') {
      this.logAppLifecycle();
    }
  }

  private shouldLog(level: LogLevel): boolean {
    const configLevel = this.logLevels[this.config.level];
    const messageLevel = this.logLevels[level];
    
    if (messageLevel < configLevel) {
      return false;
    }

    // Apply sampling for debug logs in production
    if (level === 'debug' && this.config.level !== 'debug' && Math.random() > this.config.samplingRate) {
      return false;
    }

    return true;
  }

  private formatLog(entry: LogEntry): string {
    return JSON.stringify(entry);
  }

  private log(level: LogLevel, entry: LogEntry): void {
    if (!this.shouldLog(level)) {
      return;
    }

    // Redact sensitive data
    const redactedEntry = redact(entry);

    // Add to flight recorder
    this.flightRecorder.add(redactedEntry);

    // Output to console
    const formatted = this.formatLog(redactedEntry);
    
    switch (level) {
      case 'debug':
        console.debug(formatted);
        break;
      case 'info':
        console.log(formatted);
        break;
      case 'warn':
        console.warn(formatted);
        break;
      case 'error':
        console.error(formatted);
        // On error, log bundle ID
        const bundleId = this.flightRecorder.getBundleId();
        if (bundleId) {
          console.error(`Diagnostic bundle id: ${bundleId}`);
        }
        break;
    }
  }

  private logAppLifecycle(): void {
    const buildInfo = {
      environment: process.env.NODE_ENV || 'unknown',
      version: process.env.NEXT_PUBLIC_APP_VERSION || 'unknown',
      commitHash: process.env.NEXT_PUBLIC_COMMIT_HASH || 'unknown',
    };

    const browserInfo = {
      userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : 'unknown',
      platform: typeof navigator !== 'undefined' ? navigator.platform : 'unknown',
      language: typeof navigator !== 'undefined' ? navigator.language : 'unknown',
    };

    this.info({
      event: 'APP_INITIALIZED',
      scope: 'ui',
      ...buildInfo,
      browser_info: browserInfo,
      timestamp: new Date().toISOString(),
    });
  }

  // Public API
  debug(entry: Omit<LogEntry, 'timestamp'>): void {
    this.log('debug', {
      ...entry,
      timestamp: new Date().toISOString(),
    });
  }

  info(entry: Omit<LogEntry, 'timestamp'>): void {
    this.log('info', {
      ...entry,
      timestamp: new Date().toISOString(),
    });
  }

  warn(entry: Omit<LogEntry, 'timestamp'>): void {
    this.log('warn', {
      ...entry,
      timestamp: new Date().toISOString(),
    });
  }

  error(entry: Omit<LogEntry, 'timestamp'>): void {
    this.log('error', {
      ...entry,
      timestamp: new Date().toISOString(),
    });
  }

  // Flight recorder utilities
  getDiagnosticBundle(): { bundleId: string; logs: LogEntry[] } {
    return this.flightRecorder.getBundle();
  }

  copyDiagnosticBundleToClipboard(): Promise<void> {
    const bundle = this.getDiagnosticBundle();
    const json = JSON.stringify(bundle, null, 2);
    return navigator.clipboard.writeText(json);
  }

  resetFlightRecorder(): void {
    this.flightRecorder.reset();
  }

  // Helper to generate action IDs
  generateActionId(): string {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) {
      return crypto.randomUUID();
    }
    // Fallback for environments without crypto.randomUUID
    return `${Date.now()}-${Math.random().toString(36).slice(2, 11)}-${Math.random().toString(36).slice(2, 11)}`;
  }

  // Helper to generate request IDs (matching server pattern)
  generateRequestId(): string {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) {
      return crypto.randomUUID();
    }
    // Fallback for environments without crypto.randomUUID
    return `${Date.now()}-${Math.random().toString(36).slice(2, 11)}-${Math.random().toString(36).slice(2, 11)}`;
  }
}

// Singleton instance
export const logger = new Logger();

// Export types for use in other files
export type { LogEntry, LogScope, LogLevel };
