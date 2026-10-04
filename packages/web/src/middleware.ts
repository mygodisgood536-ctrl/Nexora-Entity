import { NextResponse } from 'next/server';
import { NextRequest } from 'next/server';
import { config as appConfig } from '@nexora/core/config';
import { findEntityByDomain, findEntityBySlug } from '@nexora/db';

export const runtime = 'nodejs';

/**
 * Domain routing for the platform's own first-party hosting tier.
 *
 * When a connected custom domain or platform subdomain resolves here, the request is rewritten
 * onto the entity site route so the published Entity Website is served from its own address.
 * One canonical identity URL per person: every alias hostname resolves to the same page, whose
 * canonical link always points at the primary address.
 */
const PLATFORM_ROUTES = new Set([
  '/login',
  '/signup',
  '/app',
  '/api',
  '/media',
  '/_next',
  '/favicon.ico',
  '/robots.txt',
  '/sitemap.xml',
]);

export async function middleware(request: NextRequest) {
  const cfg = appConfig();
  const host = (request.headers.get('host') ?? '').toLowerCase().split(':')[0] ?? '';
  const pathname = request.nextUrl.pathname;

  // The apex and any configured platform hosts serve the application itself.
  const isPlatformHost =
    host === 'localhost' ||
    host === '127.0.0.1' ||
    host === cfg.entityHostSuffix ||
    host === `www.${cfg.entityHostSuffix}` ||
    host === (() => {
      try {
        return new URL(cfg.platformOrigin).hostname.toLowerCase();
      } catch {
        return '';
      }
    })();

  if (isPlatformHost || PLATFORM_ROUTES.has(pathname) || pathname.startsWith('/_next')) {
    return NextResponse.next();
  }

  // A tenant hostname: <slug>.<apex> for platform subdomains, or a connected custom domain.
  let slug: string | null = null;
  if (host.endsWith(`.${cfg.entityHostSuffix}`)) {
    const prefix = host.slice(0, -(cfg.entityHostSuffix.length + 1));
    if (prefix && !prefix.includes('.')) slug = prefix;
  } else {
    const entity = await findEntityByDomain(host);
    if (entity) slug = entity.slug;
  }

  if (!slug) return NextResponse.next();

  const entity = await findEntityBySlug(slug);
  if (!entity) {
    return new NextResponse('This Entity Website is not available.', {
      status: 404,
      headers: { 'content-type': 'text/plain; charset=utf-8', 'x-robots-tag': 'noindex, nofollow' },
    });
  }

  const url = request.nextUrl.clone();
  url.pathname = `/e/${slug}${pathname === '/' ? '' : pathname}`;
  const response = NextResponse.rewrite(url);
  response.headers.set('x-nexora-entity-host', host);
  return response;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};