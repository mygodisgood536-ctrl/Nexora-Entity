/**
 * Log level resolution, isolated so the logger stays importable from the browser.
 *
 * Server-side `NEXORA_LOG_LEVEL` is the authority. In the browser the value is inlined at build
 * time from `NEXT_PUBLIC_NEXORA_LOG_LEVEL`; without it, client logs stay at `info` so a build
 * never floods a visitor's console.
 */

export type LogLevelName = 'debug' | 'info' | 'warn' | 'error';

const LEVELS: LogLevelName[] = ['debug', 'info', 'warn', 'error'];

function normalise(raw: string | undefined): LogLevelName | null {
  const value = raw?.trim().toLowerCase();
  return value && LEVELS.includes(value as LogLevelName) ? (value as LogLevelName) : null;
}

export function logLevel(): LogLevelName {
  return normalise(process.env.NEXORA_LOG_LEVEL) ?? normalise(process.env.NEXT_PUBLIC_NEXORA_LOG_LEVEL) ?? 'info';
}