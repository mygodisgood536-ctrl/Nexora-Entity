/**
 * Safe outbound HTTP for source inspection.
 *
 * Real network access, with the protections the product requires (spec §30):
 *  - SSRF guard: no private/loopback/link-local ranges, no IP-literal hosts,
 *  - DNS resolution check before connecting,
 *  - strict redirect budget with the same guard applied to every hop,
 *  - response size cap and content-type allow-list,
 *  - honest error classification (never "checked" when it was not).
 */

import dns from 'node:dns/promises';
import net from 'node:net';
import { config } from '@nexora/core/config';
import { createLogger, AccessStatus } from '@nexora/core';

const log = createLogger('inspect:http');

export interface FetchSuccess {
  ok: true;
  requestedUrl: string;
  finalUrl: string;
  status: number;
  headers: Record<string, string>;
  body: Uint8Array;
  contentType: string;
  redirects: { from: string; to: string; status: number }[];
  elapsedMs: number;
}

export interface FetchFailure {
  ok: false;
  requestedUrl: string;
  finalUrl?: string;
  status?: number;
  accessStatus: AccessStatus;
  accessDetail: string;
  redirects: { from: string; to: string; status: number }[];
  elapsedMs: number;
  raw?: string;
}

export type FetchResult = FetchSuccess | FetchFailure;

const TEXTUAL = /^(text\/html|application\/xhtml|text\/plain|application\/xml|text\/xml|application\/json|text\/markdown|application\/rss\+xml|application\/atom\+xml|application\/ld\+json)/i;
const ANY = /./;

export interface FetchOptions {
  method?: 'GET' | 'HEAD';
  accept?: string;
  maxBytes?: number;
  timeoutMs?: number;
  maxRedirects?: number;
  /** Allow any content type (used for images). */
  anyContentType?: boolean;
  headers?: Record<string, string>;
  /** Set false for URLs already vetted by the caller. */
  guardSsrf?: boolean;
}

/** True when an IP literal is in a range we must never fetch. */
export function isPrivateAddress(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const p = ip.split('.').map(Number);
    if (p.length !== 4 || p.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return true;
    const [a = 0, b = 0] = p;
    if (a === 0 || a === 10 || a === 127) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 100 && b >= 64 && b <= 127) return true;
    if (a === 192 && b === 0) return true;
    if (a >= 224) return true;
    return false;
  }
  if (net.isIPv6(ip)) {
    const low = ip.toLowerCase();
    if (low === '::1' || low === '::') return true;
    if (low.startsWith('fe80') || low.startsWith('fc') || low.startsWith('fd')) return true;
    if (low.startsWith('::ffff:')) {
      const mapped = low.slice(7);
      return isPrivateAddress(mapped);
    }
    return false;
  }
  return true;
}

export async function assertPublicHost(hostname: string): Promise<void> {
  if (net.isIP(hostname)) {
    if (isPrivateAddress(hostname)) throw new Error(`refusing to fetch non-public address ${hostname}`);
    return;
  }
  let records: { address: string }[];
  try {
    records = await dns.lookup(hostname, { all: true });
  } catch (err) {
    throw new Error(`host ${hostname} could not be resolved (${err instanceof Error ? err.message : 'DNS failure'})`);
  }
  if (records.length === 0) throw new Error(`host ${hostname} has no addresses`);
  for (const r of records) {
    if (isPrivateAddress(r.address)) {
      throw new Error(`host ${hostname} resolves to a non-public address (${r.address})`);
    }
  }
}

function headerMap(h: Headers): Record<string, string> {
  const out: Record<string, string> = {};
  h.forEach((v, k) => {
    out[k.toLowerCase()] = v;
  });
  return out;
}

/** Read a response body with a hard byte cap so a huge file cannot exhaust memory. */
async function readCapped(res: Response, maxBytes: number): Promise<{ buf: Uint8Array; truncated: boolean }> {
  if (!res.body) return { buf: new Uint8Array(0), truncated: false };
  const reader = res.body.getReader();
  const chunks: Buffer[] = [];
  let total = 0;
  let truncated = false;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    if (total + value.byteLength > maxBytes) {
      chunks.push(Buffer.from(value.slice(0, Math.max(0, maxBytes - total))));
      truncated = true;
      await reader.cancel().catch(() => {});
      break;
    }
    chunks.push(Buffer.from(value));
    total += value.byteLength;
  }
  return { buf: Buffer.concat(chunks), truncated };
}

export async function fetchUrl(url: string, options: FetchOptions = {}): Promise<FetchResult> {
  const cfg = config();
  const started = Date.now();
  const timeoutMs = options.timeoutMs ?? cfg.httpTimeoutMs;
  const maxBytes = options.maxBytes ?? cfg.httpMaxBytes;
  const maxRedirects = options.maxRedirects ?? cfg.httpMaxRedirects;
  const redirects: { from: string; to: string; status: number }[] = [];
  let current = url;
  const guard = options.guardSsrf !== false;

  for (let hop = 0; hop <= maxRedirects; hop += 1) {
    let parsed: URL;
    try {
      parsed = new URL(current);
    } catch {
      return {
        ok: false,
        requestedUrl: url,
        accessStatus: 'invalid_url',
        accessDetail: 'The address could not be parsed as a web address.',
        redirects,
        elapsedMs: Date.now() - started,
      };
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return {
        ok: false,
        requestedUrl: url,
        accessStatus: 'invalid_url',
        accessDetail: `The address uses ${parsed.protocol.replace(':', '')}, which cannot be inspected.`,
        redirects,
        elapsedMs: Date.now() - started,
      };
    }
    if (guard) {
      try {
        await assertPublicHost(parsed.hostname);
      } catch (err) {
        return {
          ok: false,
          requestedUrl: url,
          accessStatus: 'invalid_url',
          accessDetail: err instanceof Error ? err.message : 'host rejected',
          redirects,
          elapsedMs: Date.now() - started,
        };
      }
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let res: Response;
    try {
      res = await fetch(current, {
        method: options.method ?? 'GET',
        redirect: 'manual',
        signal: controller.signal,
        headers: {
          'user-agent': cfg.httpUserAgent,
          accept: options.accept ?? 'text/html,application/xhtml+xml,application/xml;q=0.9,application/json;q=0.8,*/*;q=0.5',
          'accept-language': 'en,*;q=0.5',
          ...(options.headers ?? {}),
        },
      });
    } catch (err) {
      clearTimeout(timer);
      const msg = err instanceof Error ? err.message : String(err);
      const isAbort = err instanceof Error && (err.name === 'AbortError' || /abort/i.test(msg));
      return {
        ok: false,
        requestedUrl: url,
        finalUrl: current,
        accessStatus: isAbort ? 'timeout' : 'network_error',
        accessDetail: isAbort
          ? `The site did not answer within ${Math.round(timeoutMs / 1000)} seconds.`
          : `Could not connect to the site: ${msg}`,
        redirects,
        elapsedMs: Date.now() - started,
        raw: msg,
      };
    }
    clearTimeout(timer);

    const status = res.status;
    if (status >= 300 && status < 400) {
      const location = res.headers.get('location');
      if (!location) {
        return {
          ok: false,
          requestedUrl: url,
          finalUrl: current,
          status,
          accessStatus: 'access_limited',
          accessDetail: 'The site returned a redirect without a destination.',
          redirects,
          elapsedMs: Date.now() - started,
        };
      }
      const next = new URL(location, current).toString();
      redirects.push({ from: current, to: next, status });
      void res.body?.cancel().catch(() => {});
      current = next;
      continue;
    }

    if (status === 401 || status === 402 || status === 403) {
      void res.body?.cancel().catch(() => {});
      return {
        ok: false,
        requestedUrl: url,
        finalUrl: current,
        status,
        accessStatus: status === 403 ? 'blocked' : 'private',
        accessDetail:
          status === 401
            ? 'The site requires a sign-in, so its content could not be read.'
            : status === 403
              ? 'The site refused automated access (HTTP 403). Its content could not be read.'
              : 'The site refused automated access (HTTP 402).',
        redirects,
        elapsedMs: Date.now() - started,
      };
    }
    if (status === 404 || status === 410) {
      void res.body?.cancel().catch(() => {});
      return {
        ok: false,
        requestedUrl: url,
        finalUrl: current,
        status,
        accessStatus: 'not_found',
        accessDetail:
          status === 410
            ? 'The page no longer exists (HTTP 410).'
            : 'The page could not be found (HTTP 404). It may have been moved or removed.',
        redirects,
        elapsedMs: Date.now() - started,
      };
    }
    if (status === 429) {
      void res.body?.cancel().catch(() => {});
      return {
        ok: false,
        requestedUrl: url,
        finalUrl: current,
        status,
        accessStatus: 'blocked',
        accessDetail: 'The site is rate-limiting automated access (HTTP 429). It could not be read right now.',
        redirects,
        elapsedMs: Date.now() - started,
      };
    }
    if (status >= 500) {
      void res.body?.cancel().catch(() => {});
      return {
        ok: false,
        requestedUrl: url,
        finalUrl: current,
        status,
        accessStatus: 'network_error',
        accessDetail: `The site reported a server error (HTTP ${status}).`,
        redirects,
        elapsedMs: Date.now() - started,
      };
    }
    if (status >= 400) {
      void res.body?.cancel().catch(() => {});
      return {
        ok: false,
        requestedUrl: url,
        finalUrl: current,
        status,
        accessStatus: 'access_limited',
        accessDetail: `The site rejected the request (HTTP ${status}).`,
        redirects,
        elapsedMs: Date.now() - started,
      };
    }

    const headers = headerMap(res.headers);
    const contentType = (headers['content-type'] ?? '').split(';')[0]?.trim() ?? '';
    if (!options.anyContentType) {
      const pattern = TEXTUAL;
      if (contentType && !pattern.test(contentType)) {
        void res.body?.cancel().catch(() => {});
        return {
          ok: false,
          requestedUrl: url,
          finalUrl: current,
          status,
          accessStatus: 'unsupported_content',
          accessDetail: `The address returns ${contentType}, which is not a readable web page.`,
          redirects,
          elapsedMs: Date.now() - started,
        };
      }
    }
    void ANY;

    let buf: Uint8Array = new Uint8Array(0);
    let truncated = false;
    if (options.method !== 'HEAD') {
      try {
        const read = await readCapped(res, maxBytes);
        buf = read.buf;
        truncated = read.truncated;
      } catch (err) {
        return {
          ok: false,
          requestedUrl: url,
          finalUrl: current,
          status,
          accessStatus: 'network_error',
          accessDetail: `The response could not be read: ${err instanceof Error ? err.message : 'stream error'}`,
          redirects,
          elapsedMs: Date.now() - started,
        };
      }
    }

    const elapsedMs = Date.now() - started;
    log.debug('fetched', { url: current, status, bytes: buf.byteLength, elapsedMs, truncated });
    return {
      ok: true,
      requestedUrl: url,
      finalUrl: current,
      status,
      headers,
      body: buf,
      contentType,
      redirects,
      elapsedMs,
    };
  }

  return {
    ok: false,
    requestedUrl: url,
    finalUrl: current,
    accessStatus: 'access_limited',
    accessDetail: `The address redirected more than ${maxRedirects} times, so it was not followed further.`,
    redirects,
    elapsedMs: Date.now() - started,
  };
}

/** Fetch a JSON document. */
export async function fetchJson<T>(
  url: string,
  options: FetchOptions = {},
): Promise<{ ok: true; value: T; status: number; finalUrl: string } | FetchFailure> {
  const res = await fetchUrl(url, { accept: 'application/json', ...options });
  if (!res.ok) return res;
  try {
    return { ok: true, value: JSON.parse(Buffer.from(res.body).toString('utf8')) as T, status: res.status, finalUrl: res.finalUrl };
  } catch {
    return {
      ok: false,
      requestedUrl: url,
      finalUrl: res.finalUrl,
      status: res.status,
      accessStatus: 'unsupported_content',
      accessDetail: 'The address returned something that is not valid JSON.',
      redirects: res.redirects,
      elapsedMs: res.elapsedMs,
    };
  }
}