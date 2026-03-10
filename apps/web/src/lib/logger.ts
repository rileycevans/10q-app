/**
 * Client-side Logger
 * Structured logging for debugging and monitoring
 */

import * as Sentry from '@sentry/nextjs';

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
    const timestamp = new Date().toISOString();

    // Dev: keep the colorful console output exactly as before
    if (this.isDev) {
      const style = this.getStyle(level);
      if (typeof context === 'string') {
        console.log(`%c[${level.toUpperCase()}]`, style, context);
      } else {
        console.log(`%c[${level.toUpperCase()}]`, style, context.event || '', context);
      }
    }

    // Prod: forward structured logs to Sentry.logger when available
    if (!this.isDev && (Sentry as any).logger) {
      const payload: LogContext & { timestamp: string } =
        typeof context === 'string'
          ? { event: context, scope: 'ui', timestamp }
          : { timestamp, ...context };

      const { event, ...attributes } = payload;
      const message = event || 'LOG';

      const logger = (Sentry as any).logger;
      switch (level) {
        case 'debug':
          logger.debug(message, attributes);
          break;
        case 'info':
          logger.info(message, attributes);
          break;
        case 'warn':
          logger.warn(message, attributes);
          break;
        case 'error':
          logger.error(message, attributes);
          break;
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
