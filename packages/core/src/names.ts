/**
 * Names, handles and URLs — deterministic normalisation helpers.
 *
 * Spec §10: exact name matching is explicitly NOT the rule. Legitimate variants include
 * reordered names, dropped middle names, nicknames, professional/stage names, and one-name
 * public identities. These helpers produce comparable tokens for the identity engine.
 */

const DIACRITIC = /[\u0300-\u036f]/g;
const NON_ALNUM = /[^a-z0-9\s]/g;

export function foldDiacritics(input: string): string {
  return input.normalize('NFD').replace(DIACRITIC, '').normalize('NFC');
}

export function normalizeText(input: string): string {
  return foldDiacritics(input).toLowerCase().replace(NON_ALNUM, ' ').replace(/\s+/g, ' ').trim();
}

/** Very small hand-curated list of common English particles that add noise to name tokens. */
const NAME_PARTICLES = new Set(['van', 'von', 'de', 'del', 'della', 'di', 'da', 'dos', 'la', 'le', 'el']);

export interface NameTokens {
  normalized: string;
  tokens: string[];
  /** Tokens excluding particles. */
  substantive: string[];
  first: string | null;
  last: string | null;
}

export function nameTokens(input: string): NameTokens {
  const normalized = normalizeText(input);
  const tokens = normalized.split(' ').filter(Boolean);
  const substantive = tokens.filter((t) => !NAME_PARTICLES.has(t));
  return {
    normalized,
    tokens,
    substantive,
    first: substantive[0] ?? null,
    last: substantive.length > 1 ? (substantive[substantive.length - 1] as string) : null,
  };
}

/** Nicknames and common short forms used only to *check compatibility*, never to assert identity. */
const COMMON_SHORT_FORMS: Record<string, string[]> = {
  chris: ['christopher', 'christian', 'christina'],
  cory: ['cornelius', 'cori'],
  vic: ['victor', 'victoria'],
  tony: ['anthony'],
  mike: ['michael'],
  dave: ['david'],
  steve: ['steven', 'stephen'],
  ben: ['benjamin'],
  sam: ['samuel', 'samantha'],
  alex: ['alexander', 'alexandra'],
  nick: ['nicholas'],
  josh: ['joshua'],
  rob: ['robert'],
  jen: ['jennifer'],
  kate: ['katherine', 'kathryn'],
};

export function shortFormCandidates(token: string): string[] {
  return COMMON_SHORT_FORMS[token.toLowerCase()] ?? [];
}

/** Strip tracking/query noise from a URL and lowercase the host. */
export function canonicalizeUrl(input: string): { ok: true; url: URL; canonical: string } | { ok: false; reason: string } {
  let candidate = input.trim();
  if (!candidate) return { ok: false, reason: 'empty' };
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(candidate)) candidate = `https://${candidate}`;
  let u: URL;
  try {
    u = new URL(candidate);
  } catch {
    return { ok: false, reason: 'unparseable' };
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') {
    return { ok: false, reason: `unsupported protocol ${u.protocol.replace(':', '')}` };
  }
  if (!u.hostname.includes('.')) return { ok: false, reason: 'hostname has no dot' };
  u.hostname = u.hostname.toLowerCase().replace(/^www\./, '');
  u.hash = '';
  for (const key of [...u.searchParams.keys()]) {
    if (/^(utm_|fbclid|gclid|mc_|ref|source|igshid|si$)/i.test(key)) u.searchParams.delete(key);
  }
  u.pathname = u.pathname.replace(/\/+$/, '') || '/';
  const canonical = u.toString();
  return { ok: true, url: u, canonical };
}

/** Registrable-ish host: strips common multi-part public suffixes we know about. */
const MULTI_PART_SUFFIXES = new Set([
  'co.uk', 'org.uk', 'ac.uk', 'gov.uk', 'com.au', 'net.au', 'org.au', 'co.nz', 'co.za',
  'com.br', 'com.ng', 'com.gh', 'co.in', 'com.mx', 'co.jp', 'com.sg', 'com.tr',
]);

export function registrableDomain(input: string): string | null {
  const c = canonicalizeUrl(input);
  if (!c.ok) return null;
  const parts = c.url.hostname.split('.');
  if (parts.length <= 2) return parts.join('.');
  const last2 = parts.slice(-2).join('.');
  if (MULTI_PART_SUFFIXES.has(last2)) return parts.slice(-3).join('.');
  return last2;
}

/** True when both URLs belong to the same registrable domain. */
export function sameSite(a: string, b: string): boolean {
  const da = registrableDomain(a);
  const db = registrableDomain(b);
  return !!da && !!db && da === db;
}

/** Cheap, stable hash used for content fingerprints and duplicate detection. */
export { sha256Hex } from './sha256';

/** Normalise free text for near-duplicate comparison. */
export function textFingerprint(text: string): string[] {
  return normalizeText(text)
    .split(' ')
    .filter((w) => w.length > 3);
}

/** Jaccard similarity over token sets — used for syndicated-content (independence) detection. */
export function jaccard(a: Iterable<string>, b: Iterable<string>): number {
  const sa = new Set(a);
  const sb = new Set(b);
  if (sa.size === 0 && sb.size === 0) return 1;
  if (sa.size === 0 || sb.size === 0) return 0;
  let inter = 0;
  for (const x of sa) if (sb.has(x)) inter += 1;
  return inter / (sa.size + sb.size - inter);
}

/** Dice coefficient over bigrams — sharper for near-duplicate detection than Jaccard. */
export function bigramDice(a: string, b: string): number {
  const bigrams = (s: string) => {
    const n = normalizeText(s);
    const out: string[] = [];
    for (let i = 0; i < n.length - 1; i += 1) out.push(n.slice(i, i + 2));
    return out;
  };
  const A = bigrams(a);
  const B = bigrams(b);
  if (A.length === 0 || B.length === 0) return 0;
  const bag = new Map<string, number>();
  for (const g of A) bag.set(g, (bag.get(g) ?? 0) + 1);
  let hits = 0;
  for (const g of B) {
    const c = bag.get(g) ?? 0;
    if (c > 0) {
      bag.set(g, c - 1);
      hits += 1;
    }
  }
  return (2 * hits) / (A.length + B.length);
}

/** Deterministic slug usable for a public URL segment. */
export function slugify(input: string, fallback = 'entity'): string {
  const base = foldDiacritics(input)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  return base || fallback;
}