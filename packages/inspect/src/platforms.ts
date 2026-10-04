/**
 * Platform detection and real per-platform connectors.
 *
 * Every connector performs genuine network access using a publicly documented mechanism.
 * When a platform cannot be reached, the connector reports the honest limitation — it never
 * fabricates data and never lets the caller claim a profile was verified.
 *
 * Documented public mechanisms used here:
 *  - GitHub REST API v3        https://docs.github.com/en/rest
 *  - Wikipedia/Wikidata REST   https://www.mediawiki.org/wiki/API
 *  - Reddit public JSON        https://www.reddit.com/dev/api
 *  - YouTube channel page + oEmbed (no key required for public metadata)
 *  - Generic JSON-LD/OpenGraph for everything else
 */

import { fetchJson, fetchUrl } from './http';
import { extractHtml, peopleFromJsonLd, articleFromJsonLd, type HtmlExtraction } from './html';

export type PlatformId =
  | 'linkedin'
  | 'github'
  | 'gitlab'
  | 'youtube'
  | 'instagram'
  | 'tiktok'
  | 'x'
  | 'facebook'
  | 'threads'
  | 'reddit'
  | 'pinterest'
  | 'snapchat'
  | 'mastodon'
  | 'bluesky'
  | 'medium'
  | 'substack'
  | 'devto'
  | 'behance'
  | 'dribbble'
  | 'soundcloud'
  | 'spotify'
  | 'bandcamp'
  | 'kickstarter'
  | 'patreon'
  | 'orcid'
  | 'researchgate'
  | 'wikipedia'
  | 'wikidata'
  | 'stackoverflow'
  | 'producthunt'
  | 'linktree'
  | 'cal'
  | 'notion'
  | 'other';

export interface PlatformDescriptor {
  id: PlatformId;
  name: string;
  /** Host suffixes that identify this platform. */
  hosts: string[];
  category: 'professional' | 'code' | 'social' | 'creator' | 'media' | 'professional_network' | 'reference' | 'link';
  /** How Nexora Entity can read a public profile here. */
  access: {
    /** A documented public mechanism exists and is used. */
    documented: boolean;
    /** Realistic: the platform usually permits reading. */
    reliable: boolean;
    /** Best-effort: often blocked, frequently limited. */
    bestEffort: boolean;
    note: string;
  };
  /** Extract the handle from a profile URL for this platform. */
  handleFromUrl: (url: URL) => string | null;
}

const handleFromPath = (...segments: number[]): ((url: URL) => string | null) => (url) => {
  const parts = url.pathname.split('/').filter(Boolean);
  const seg = segments.length > 0 ? (segments[segments.length - 1] as number) : 0;
  const raw = parts[seg];
  return raw ? decodeURIComponent(raw).replace(/^@/, '') : null;
};

export const PLATFORMS: PlatformDescriptor[] = [
  {
    id: 'linkedin', name: 'LinkedIn', hosts: ['linkedin.com'], category: 'professional',
    access: { documented: true, reliable: false, bestEffort: true, note: 'LinkedIn blocks automated profile reads. Nexora Entity records the limitation honestly and never claims the profile was verified.' },
    handleFromUrl: (u) => (u.pathname.includes('/in/') ? handleFromPath(1)(u) : u.pathname.split('/').filter(Boolean).slice(-1)[0] ?? null),
  },
  {
    id: 'github', name: 'GitHub', hosts: ['github.com'], category: 'code',
    access: { documented: true, reliable: true, bestEffort: false, note: 'Read through the public GitHub REST API.' },
    handleFromUrl: handleFromPath(0),
  },
  {
    id: 'gitlab', name: 'GitLab', hosts: ['gitlab.com'], category: 'code',
    access: { documented: true, reliable: true, bestEffort: false, note: 'Read through the public GitLab REST API.' },
    handleFromUrl: handleFromPath(0),
  },
  {
    id: 'youtube', name: 'YouTube', hosts: ['youtube.com', 'youtu.be'], category: 'creator',
    access: { documented: true, reliable: false, bestEffort: true, note: 'Public channel/about metadata is readable; individual videos require the Data API for full details.' },
    handleFromUrl: (u) => {
      if (u.pathname.startsWith('/channel/')) return u.pathname.split('/')[2] ?? null;
      if (u.pathname.startsWith('/@')) return u.pathname.slice(1) || null;
      if (u.pathname.startsWith('/c/') || u.pathname.startsWith('/user/')) return u.pathname.split('/')[2] ?? null;
      if (u.hostname === 'youtu.be') return u.pathname.slice(1) || null;
      return null;
    },
  },
  {
    id: 'instagram', name: 'Instagram', hosts: ['instagram.com'], category: 'social',
    access: { documented: false, reliable: false, bestEffort: true, note: 'No public API for arbitrary profile reads; Instagram frequently blocks automated access. Limitations are recorded, not hidden.' },
    handleFromUrl: handleFromPath(0),
  },
  {
    id: 'tiktok', name: 'TikTok', hosts: ['tiktok.com'], category: 'social',
    access: { documented: false, reliable: false, bestEffort: true, note: 'TikTok enforces aggressive bot protection. Nexora Entity records when a profile could not be read.' },
    handleFromUrl: handleFromPath(0),
  },
  {
    id: 'x', name: 'X', hosts: ['x.com', 'twitter.com'], category: 'social',
    access: { documented: false, reliable: false, bestEffort: true, note: 'X requires authentication for profile reads. The limitation is recorded honestly.' },
    handleFromUrl: handleFromPath(0),
  },
  {
    id: 'facebook', name: 'Facebook', hosts: ['facebook.com', 'fb.com'], category: 'social',
    access: { documented: false, reliable: false, bestEffort: true, note: 'Facebook blocks unauthenticated automated reads.' },
    handleFromUrl: handleFromPath(0),
  },
  {
    id: 'threads', name: 'Threads', hosts: ['threads.net'], category: 'social',
    access: { documented: false, reliable: false, bestEffort: true, note: 'No public read mechanism for profiles.' },
    handleFromUrl: (u) => (u.pathname.startsWith('/@') ? u.pathname.slice(1) || null : handleFromPath(0)(u)),
  },
  {
    id: 'reddit', name: 'Reddit', hosts: ['reddit.com'], category: 'social',
    access: { documented: true, reliable: true, bestEffort: false, note: 'Read through Reddit’s public JSON endpoints.' },
    handleFromUrl: handleFromPath(1),
  },
  {
    id: 'pinterest', name: 'Pinterest', hosts: ['pinterest.com'], category: 'social',
    access: { documented: false, reliable: false, bestEffort: true, note: 'Usually blocked for automated access.' },
    handleFromUrl: handleFromPath(0),
  },
  {
    id: 'snapchat', name: 'Snapchat', hosts: ['snapchat.com'], category: 'social',
    access: { documented: false, reliable: false, bestEffort: true, note: 'No public profile read mechanism.' },
    handleFromUrl: handleFromPath(0),
  },
  {
    id: 'mastodon', name: 'Mastodon', hosts: ['mastodon.social', 'mastodon.online', 'fosstodon.org'], category: 'social',
    access: { documented: true, reliable: true, bestEffort: false, note: 'Federated instances expose public profile JSON.' },
    handleFromUrl: handleFromPath(0),
  },
  {
    id: 'bluesky', name: 'Bluesky', hosts: ['bsky.app'], category: 'social',
    access: { documented: true, reliable: true, bestEffort: false, note: 'Read through the public Bluesky AppView API.' },
    handleFromUrl: (u) => (u.pathname.startsWith('/profile/') ? u.pathname.split('/')[2] ?? null : null),
  },
  {
    id: 'medium', name: 'Medium', hosts: ['medium.com'], category: 'media',
    access: { documented: true, reliable: true, bestEffort: false, note: 'Public profiles expose JSON-LD.' },
    handleFromUrl: handleFromPath(0),
  },
  {
    id: 'substack', name: 'Substack', hosts: ['substack.com'], category: 'media',
    access: { documented: false, reliable: true, bestEffort: false, note: 'Publication pages expose JSON-LD and RSS.' },
    handleFromUrl: handleFromPath(0),
  },
  {
    id: 'devto', name: 'DEV Community', hosts: ['dev.to'], category: 'code',
    access: { documented: true, reliable: true, bestEffort: false, note: 'Public API and JSON-LD.' },
    handleFromUrl: handleFromPath(0),
  },
  {
    id: 'behance', name: 'Behance', hosts: ['behance.net'], category: 'creator',
    access: { documented: false, reliable: false, bestEffort: true, note: 'Adobe blocks unauthenticated automated reads.' },
    handleFromUrl: handleFromPath(0),
  },
  {
    id: 'dribbble', name: 'Dribbble', hosts: ['dribbble.com'], category: 'creator',
    access: { documented: false, reliable: false, bestEffort: true, note: 'Usually blocked for automated access.' },
    handleFromUrl: handleFromPath(0),
  },
  {
    id: 'soundcloud', name: 'SoundCloud', hosts: ['soundcloud.com'], category: 'creator',
    access: { documented: false, reliable: false, bestEffort: true, note: 'oEmbed is available for public tracks; profile pages are usually blocked.' },
    handleFromUrl: handleFromPath(0),
  },
  {
    id: 'spotify', name: 'Spotify', hosts: ['spotify.com'], category: 'creator',
    access: { documented: false, reliable: false, bestEffort: true, note: 'Public oEmbed for tracks; profile pages are usually blocked.' },
    handleFromUrl: handleFromPath(0),
  },
  {
    id: 'bandcamp', name: 'Bandcamp', hosts: ['bandcamp.com'], category: 'creator',
    access: { documented: false, reliable: true, bestEffort: false, note: 'Public pages expose metadata tags.' },
    handleFromUrl: handleFromPath(0),
  },
  {
    id: 'kickstarter', name: 'Kickstarter', hosts: ['kickstarter.com'], category: 'creator',
    access: { documented: true, reliable: true, bestEffort: false, note: 'Public project pages expose JSON-LD.' },
    handleFromUrl: handleFromPath(0),
  },
  {
    id: 'patreon', name: 'Patreon', hosts: ['patreon.com'], category: 'creator',
    access: { documented: false, reliable: false, bestEffort: true, note: 'Usually blocked for automated access.' },
    handleFromUrl: handleFromPath(0),
  },
  {
    id: 'orcid', name: 'ORCID', hosts: ['orcid.org'], category: 'professional_network',
    access: { documented: true, reliable: true, bestEffort: false, note: 'Public ORCID record API.' },
    handleFromUrl: handleFromPath(0),
  },
  {
    id: 'researchgate', name: 'ResearchGate', hosts: ['researchgate.net'], category: 'professional_network',
    access: { documented: false, reliable: false, bestEffort: true, note: 'Usually blocked for automated access.' },
    handleFromUrl: handleFromPath(0),
  },
  {
    id: 'wikipedia', name: 'Wikipedia', hosts: ['wikipedia.org'], category: 'reference',
    access: { documented: true, reliable: true, bestEffort: false, note: 'MediaWiki Action/REST API.' },
    handleFromUrl: (u) => u.pathname.split('/').filter(Boolean).slice(-1)[0] ?? null,
  },
  {
    id: 'stackoverflow', name: 'Stack Overflow', hosts: ['stackoverflow.com', 'stackexchange.com'], category: 'code',
    access: { documented: true, reliable: true, bestEffort: false, note: 'Public StackExchange API.' },
    handleFromUrl: (u) => {
      const m = /\/users\/(\d+)/.exec(u.pathname);
      return m?.[1] ?? null;
    },
  },
  {
    id: 'producthunt', name: 'Product Hunt', hosts: ['producthunt.com'], category: 'creator',
    access: { documented: false, reliable: false, bestEffort: true, note: 'Usually blocked for automated access.' },
    handleFromUrl: handleFromPath(0),
  },
  {
    id: 'linktree', name: 'Linktree', hosts: ['linktr.ee'], category: 'link',
    access: { documented: false, reliable: false, bestEffort: true, note: 'Usually blocked for automated access.' },
    handleFromUrl: handleFromPath(0),
  },
  {
    id: 'cal', name: 'Cal.com', hosts: ['cal.com'], category: 'link',
    access: { documented: false, reliable: true, bestEffort: false, note: 'Public booking pages are readable.' },
    handleFromUrl: handleFromPath(0),
  },
];

export function detectPlatform(url: string): { platform: PlatformDescriptor; handle: string | null } | null {
  const c = canonicalHost(url);
  if (!c) return null;
  const host = new URL(c).hostname.toLowerCase();
  for (const p of PLATFORMS) {
    if (p.hosts.some((h) => host === h || host.endsWith(`.${h}`))) {
      try {
        return { platform: p, handle: p.handleFromUrl(new URL(c)) };
      } catch {
        return { platform: p, handle: null };
      }
    }
  }
  return null;
}

export function platformById(id: string): PlatformDescriptor | null {
  return PLATFORMS.find((p) => p.id === id) ?? null;
}

function canonicalHost(url: string): string | null {
  try {
    const u = new URL(url);
    return u.toString();
  } catch {
    return null;
  }
}

export interface PlatformData {
  platform: PlatformId;
  platformName: string;
  handle: string | null;
  /** Structured profile facts actually retrieved. */
  facts: Record<string, unknown>;
  /** Mechanism used, stated plainly. */
  mechanism: string;
}

export interface ConnectorResult {
  ok: boolean;
  data: PlatformData | null;
  /** Why the connector could not read the platform, in plain language. */
  limitation: string | null;
}

/**
 * Platform-specific enrichment using real public mechanisms.
 * Returns `ok:false` with a human-readable limitation when the platform cannot be read.
 */
export async function fetchPlatformData(url: string): Promise<ConnectorResult> {
  const detected = detectPlatform(url);
  if (!detected) {
    return { ok: false, data: null, limitation: 'This address is not a recognised public profile platform, so it is inspected as a general web page.' };
  }
  const { platform, handle } = detected;

  try {
    switch (platform.id) {
      case 'github':
        return await githubConnector(url, handle, platform);
      case 'gitlab':
        return await gitlabConnector(url, handle, platform);
      case 'reddit':
        return await redditConnector(url, handle, platform);
      case 'bluesky':
        return await blueskyConnector(url, handle, platform);
      case 'orcid':
        return await orcidConnector(url, handle, platform);
      case 'wikipedia':
        return await wikipediaConnector(url, platform);
      case 'stackoverflow':
        return await stackoverflowConnector(url, platform);
      case 'youtube':
        return await oembedConnector(url, platform, handle);
      default:
        return { ok: false, data: null, limitation: platform.access.note };
    }
  } catch (err) {
    return {
      ok: false,
      data: null,
      limitation: `${platform.name} could not be read: ${err instanceof Error ? err.message : 'request failed'}. ${platform.access.note}`,
    };
  }
}

async function githubConnector(url: string, handle: string | null, platform: PlatformDescriptor): Promise<ConnectorResult> {
  if (!handle) return { ok: false, data: null, limitation: 'No GitHub username could be read from the address.' };
  const res = await fetchJson<{
    login: string; name: string | null; bio: string | null; company: string | null; location: string | null;
    blog: string | null; email: string | null; twitter_username: string | null;
    public_repos: number; followers: number; created_at: string; avatar_url: string; html_url: string;
  }>(`https://api.github.com/users/${encodeURIComponent(handle)}`, { headers: { 'x-github-api-version': '2022-11-28' } });
  if (!res.ok) {
    return { ok: false, data: null, limitation: `GitHub could not be read for "${handle}": ${res.accessDetail}` };
  }
  const u = res.value;
  const repos = await fetchJson<{ name: string; html_url: string; description: string | null; language: string | null; stargazers_count: number; fork: boolean; created_at: string; updated_at: string; homepage: string | null }[]>(
    `https://api.github.com/users/${encodeURIComponent(handle)}/repos?per_page=30&sort=updated`,
  );
  const repoList = repos.ok ? repos.value.filter((r) => !r.fork) : [];
  if (!u) {
    return { ok: false, data: null, limitation: `GitHub returned no user for "${handle}".` };
  }
  return {
    ok: true,
    limitation: null,
    data: {
      platform: 'github',
      platformName: platform.name,
      handle: u.login,
      mechanism: 'GitHub REST API v3 (public endpoints)',
      facts: {
        login: u.login,
        name: u.name,
        bio: u.bio,
        company: u.company,
        location: u.location,
        website: u.blog,
        publicEmail: u.email,
        twitterUsername: u.twitter_username,
        avatarUrl: u.avatar_url,
        profileUrl: u.html_url,
        publicRepos: u.public_repos,
        followers: u.followers,
        accountCreated: u.created_at,
        repositories: repoList.map((r) => ({
          name: r.name,
          url: r.html_url,
          description: r.description,
          language: r.language,
          stars: r.stargazers_count,
          homepage: r.homepage,
          createdAt: r.created_at,
          updatedAt: r.updated_at,
        })),
      },
    },
  };
}

interface GitLabUser {
  username: string;
  name: string;
  bio: string | null;
  location: string | null;
  organization: string;
  job_title: string | null;
  web_url: string;
  avatar_url: string;
  public_projects: number;
  created_at: string;
}

async function gitlabConnector(url: string, handle: string | null, platform: PlatformDescriptor): Promise<ConnectorResult> {
  if (!handle) return { ok: false, data: null, limitation: 'No GitLab username could be read from the address.' };
  const res = await fetchJson<GitLabUser[]>(
    `https://gitlab.com/api/v4/users?username=${encodeURIComponent(handle)}`,
  );
  if (!res.ok) {
    return { ok: false, data: null, limitation: `GitLab could not be read for "${handle}": ${res.accessDetail}` };
  }
  const values: GitLabUser[] = Array.isArray(res.value) ? res.value : [];
  if (values.length === 0) {
    return { ok: false, data: null, limitation: `GitLab could not be read for "${handle}": no public user found` };
  }
  const u = values[0];
  if (!u) return { ok: false, data: null, limitation: `No public GitLab user found for "${handle}".` };
  return {
    ok: true,
    limitation: null,
    data: {
      platform: 'gitlab', platformName: platform.name, handle: u.username,
      mechanism: 'GitLab REST API v4 (public endpoints)',
      facts: {
        username: u.username, name: u.name, bio: u.bio, location: u.location,
        organization: u.organization, jobTitle: u.job_title, profileUrl: u.web_url,
        avatarUrl: u.avatar_url, publicProjects: u.public_projects, accountCreated: u.created_at,
      },
    },
  };
}

async function redditConnector(url: string, handle: string | null, platform: PlatformDescriptor): Promise<ConnectorResult> {
  if (!handle) return { ok: false, data: null, limitation: 'No Reddit username could be read from the address.' };
  const res = await fetchJson<{ kind: string; data: Record<string, unknown> }>(
    `https://www.reddit.com/user/${encodeURIComponent(handle)}/about.json`,
    { headers: { accept: 'application/json' } },
  );
  if (!res.ok || res.value?.kind !== 't2') {
    return { ok: false, data: null, limitation: `Reddit could not be read for "${handle}": ${res.ok ? 'account is private or suspended' : res.accessDetail}` };
  }
  const d = res.value.data;
  const subreddit = d['subreddit'];
  const created = typeof d['created_utc'] === 'number' ? d['created_utc'] : Number(d['created_utc'] ?? 0);
  return {
    ok: true,
    limitation: null,
    data: {
      platform: 'reddit', platformName: platform.name, handle: String(d['name'] ?? handle),
      mechanism: 'Reddit public JSON API (/user/{name}/about.json)',
      facts: {
        username: d['name'],
        description: subreddit && typeof subreddit === 'object' ? ((subreddit as Record<string, unknown>)['public_description'] as string | null ?? null) : null,
        createdAt: created > 0 ? new Date(created * 1000).toISOString() : null,
        linkKarma: d['link_karma'] ?? null,
        commentKarma: d['comment_karma'] ?? null,
        isVerified: d['verified'] ?? false,
        profileUrl: `https://www.reddit.com/user/${handle}`,
      },
    },
  };
}

async function blueskyConnector(url: string, handle: string | null, platform: PlatformDescriptor): Promise<ConnectorResult> {
  if (!handle) return { ok: false, data: null, limitation: 'No Bluesky handle could be read from the address.' };
  const res = await fetchJson<Record<string, unknown>>(
    `https://public.api.bsky.app/xrpc/app.bsky.actor.getProfile?actor=${encodeURIComponent(handle)}`,
  );
  if (!res.ok) {
    return { ok: false, data: null, limitation: `Bluesky could not be read for "${handle}": ${res.accessDetail}` };
  }
  const p = res.value;
  return {
    ok: true,
    limitation: null,
    data: {
      platform: 'bluesky', platformName: platform.name, handle: String(p.handle ?? handle),
      mechanism: 'Bluesky public AppView API (app.bsky.actor.getProfile)',
      facts: {
        handle: p.handle, displayName: p.displayName, description: p.description,
        profileUrl: `https://bsky.app/profile/${p.handle}`,
      },
    },
  };
}

async function orcidConnector(url: string, handle: string | null, platform: PlatformDescriptor): Promise<ConnectorResult> {
  if (!handle) return { ok: false, data: null, limitation: 'No ORCID identifier could be read from the address.' };
  const id = handle.replace(/[^0-9X]/g, '');
  const res = await fetchJson<{
    person?: {
      'given-names'?: { value?: string };
      'family-names'?: { value?: string };
      'credit-name'?: { value?: string };
      biography?: { content?: string };
      'other-names'?: { 'other-name'?: { content?: string }[] };
    };
    'activities-summary'?: Record<string, unknown>;
  }>(`https://pub.orcid.org/v3.0/${id}/record`, { headers: { accept: 'application/json' } });
  if (!res.ok) {
    return { ok: false, data: null, limitation: `ORCID could not be read for "${handle}": ${res.accessDetail}` };
  }
  const rec = res.value;
  const person = rec.person ?? {};
  return {
    ok: true,
    limitation: null,
    data: {
      platform: 'orcid', platformName: platform.name, handle: id,
      mechanism: 'ORCID public record API v3',
      facts: {
        givenNames: person['given-names']?.value ?? null,
        familyNames: person['family-names']?.value ?? null,
        creditName: person['credit-name']?.value ?? null,
        otherNames: (person['other-names']?.['other-name'] ?? []).map((n) => n.content).filter(Boolean),
        biography: person.biography?.content ?? null,
        profileUrl: `https://orcid.org/${id}`,
      },
    },
  };
}

async function wikipediaConnector(url: string, platform: PlatformDescriptor): Promise<ConnectorResult> {
  const m = /\/wiki\/([^/]+)/.exec(new URL(url).pathname);
  const title = m?.[1] ? decodeURIComponent(m[1]).replace(/_/g, ' ') : null;
  if (!title) return { ok: false, data: null, limitation: 'No article title could be read from the address.' };
  const host = new URL(url).hostname;
  const res = await fetchJson<{
    type?: string; title?: string; extract?: string;
    content_urls?: { desktop?: { page?: string } };
  }>(`https://${host}/api/rest_v1/page/summary/${encodeURIComponent(title.replace(/\s/g, '_'))}`);
  if (!res.ok) {
    return { ok: false, data: null, limitation: `Wikipedia could not be read: ${res.accessDetail}` };
  }
  return {
    ok: true,
    limitation: null,
    data: {
      platform: 'wikipedia', platformName: platform.name, handle: res.value.title ?? title,
      mechanism: 'MediaWiki REST summary API',
      facts: {
        title: res.value.title, extract: res.value.extract,
        pageUrl: res.value.content_urls?.desktop?.page ?? url,
      },
    },
  };
}

async function stackoverflowConnector(url: string, platform: PlatformDescriptor): Promise<ConnectorResult> {
  const m = /\/users\/(\d+)/.exec(new URL(url).pathname);
  if (!m?.[1]) return { ok: false, data: null, limitation: 'No Stack Overflow user id could be read from the address.' };
  const res = await fetchJson<{ items: { display_name: string; link: string; reputation: number; about_me?: string; location?: string; website_url?: string }[] }>(
    `https://api.stackexchange.com/2.3/users/${m[1]}?site=stackoverflow&filter=withbody`,
  );
  const u = res.ok ? res.value.items[0] : undefined;
  if (!u) return { ok: false, data: null, limitation: 'Stack Overflow user could not be read.' };
  return {
    ok: true,
    limitation: null,
    data: {
      platform: 'stackoverflow', platformName: platform.name, handle: String(m[1]),
      mechanism: 'StackExchange API v2.3',
      facts: { displayName: u.display_name, reputation: u.reputation, about: u.about_me ?? null, location: u.location ?? null, website: u.website_url ?? null, profileUrl: u.link },
    },
  };
}

/** YouTube and other oEmbed-capable platforms: real public metadata, no key required. */
async function oembedConnector(url: string, platform: PlatformDescriptor, handle: string | null): Promise<ConnectorResult> {
  const res = await fetchJson<{ title?: string; author_name?: string; author_url?: string; thumbnail_url?: string; provider_name?: string }>(
    `https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(url)}`,
  );
  if (!res.ok) {
    return { ok: false, data: null, limitation: `${platform.name} oEmbed did not return metadata: ${res.accessDetail}. ${platform.access.note}` };
  }
  return {
    ok: true,
    limitation: null,
    data: {
      platform: platform.id, platformName: platform.name, handle: handle ?? res.value.author_name ?? null,
      mechanism: 'YouTube oEmbed (public, no API key)',
      facts: {
        title: res.value.title, author: res.value.author_name, authorUrl: res.value.author_url,
        thumbnail: res.value.thumbnail_url, provider: res.value.provider_name,
      },
    },
  };
}

export type { HtmlExtraction };
export { extractHtml, peopleFromJsonLd, articleFromJsonLd };
export { fetchUrl };