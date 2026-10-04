/**
 * Structured logger with level filtering and secret redaction.
 *
 * Client components log, so this module must stay free of `@nexora/core/config`, which reads the
 * filesystem to resolve storage directories. The level threshold therefore comes from its own
 * env module, which the bundler can inline on both sides.
 */

import { logLevel } from './log-level';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

const SECRET_PATTERNS: { re: RegExp; replace: string }[] = [
  { re: /\b(sk|pk|api)[-_]?(key|token|secret)\b\s*[:=]\s*\S+/gi, replace: '$1: [redacted]' },
  { re: /(Bearer\s+)[A-Za-z0-9._~+/=-]{8,}/g, replace: '$1[redacted]' },
  { re: /("?(?:apiKey|api_key|token|password|secret|authorization)"?\s*[:=]\s*"?)[^"\s,}]{4,}/gi, replace: '$1[redacted]' },
];

/** Remove anything that looks like a credential before it can reach a log sink. */
export function redact(input: string): string {
  let out = input;
  for (const { re, replace } of SECRET_PATTERNS) out = out.replace(re, replace);
  return out;
}

export interface Logger {
  debug(message: string, data?: Record<string, unknown>): void;
  info(message: string, data?: Record<string, unknown>): void;
  warn(message: string, data?: Record<string, unknown>): void;
  error(message: string, data?: Record<string, unknown>): void;
}

/** Namespaced logger. Records are JSON so they can be shipped to any collector unchanged. */
export function createLogger(scope: string): Logger {
  const threshold = ORDER[logLevel()];

  const emit = (level: LogLevel, message: string, data?: Record<string, unknown>): void => {
    if (ORDER[level] < threshold) return;
    const record: Record<string, unknown> = {
      ts: new Date().toISOString(),
      level,
      scope,
      message: redact(message),
    };
    if (data) {
      record.data = Object.fromEntries(
        Object.entries(data).map(([k, v]) => [k, typeof v === 'string' ? redact(v) : v]),
      );
    }
    const line = JSON.stringify(record);
    if (level === 'error') console.error(line);
    else if (level === 'warn') console.warn(line);
    else console.log(line);
  };

  return {
    debug: (message, data) => emit('debug', message, data),
    info: (message, data) => emit('info', message, data),
    warn: (message, data) => emit('warn', message, data),
    error: (message, data) => emit('error', message, data),
  };
}