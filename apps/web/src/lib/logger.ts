/**
 * Client-side Logger
 * Structured logging for debugging and monitoring
 */

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

interface LogContext {
  event?: string;
  scope?: string;
  request_id?: string;
  [key: string]: unknown;
}

class Logger {
  private isDev = process.env.NODE_ENV === 'development';

  generateRequestId(): string {
    return `req_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
  }

  private log(level: LogLevel, context: LogContext | string) {
    const _timestamp = new Date().toISOString();

    if (this.isDev) {
      const style = this.getStyle(level);
      if (typeof context === 'string') {
        console.log(`%c[${level.toUpperCase()}]`, style, context);
      } else {
        console.log(`%c[${level.toUpperCase()}]`, style, context.event || '', context);
      }
    }
  }

  private getStyle(level: LogLevel): string {
    switch (level) {
      case 'debug': return 'color: gray';
      case 'info': return 'color: blue';
      case 'warn': return 'color: orange';
      case 'error': return 'color: red; font-weight: bold';
    }
  }

  debug(context: LogContext | string) {
    this.log('debug', context);
  }

  info(context: LogContext | string) {
    this.log('info', context);
  }

  warn(context: LogContext | string) {
    this.log('warn', context);
  }

  error(context: LogContext | string) {
    this.log('error', context);
  }
}

export const logger = new Logger();
