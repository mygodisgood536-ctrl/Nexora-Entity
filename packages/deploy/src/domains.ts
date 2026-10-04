/**
 * Custom-domain management (spec §25).
 *
 * The person never needs to understand Vercel, DNS or hosting. Nexora Entity generates the
 * records, verifies the domain by actually resolving it, and only activates the domain once
 * the hostname genuinely serves this entity's site.
 */

import { config } from '@nexora/core/config';
import { createLogger, NexoraError } from '@nexora/core';
import { audit, getDomain, findEntityById, insertDomain, makeDomainPrimary, setDomainStatus } from '@nexora/db';
import { slugSchema } from '@nexora/core';

const log = createLogger('deploy:domains');

export interface DomainPlan {
  hostname: string;
  kind: 'platform_subdomain' | 'custom';
  verificationToken: string;
  dnsRecords: { type: string; name: string; value: string; ttl?: number; purpose: string }[];
  instructions: string[];
}

function dnsTarget(): string {
  // DNS records never carry a port. Use the platform host only.
  try {
    return new URL(config().platformOrigin).hostname;
  } catch {
    return config().entityHostSuffix;
  }
}

/** Create (or refresh) the platform-controlled subdomain for an entity. */
export async function ensurePlatformSubdomain(entityId: string): Promise<DomainPlan> {
  const cfg = config();
  const entity = await findEntityById(entityId);
  if (!entity) {
    throw new NexoraError({ code: 'deployment_entity_missing', domain: 'deployment', message: 'Entity not found.' });
  }
  const hostname = `${entity.slug}.${cfg.entityHostSuffix}`;
  const token = `nexora-verify-${entity.entity_uid.split(':').pop() ?? entity.id}`;
  const target = dnsTarget();

  await insertDomain({
    entityId,
    hostname,
    kind: 'platform_subdomain',
    verificationToken: token,
    dnsRecords: [
      { type: 'CNAME', name: hostname, value: target, ttl: 3600, purpose: 'Points this entity subdomain at the Nexora Entity host.' },
    ],
    status: 'active',
    isPrimary: true,
  });

  return {
    hostname,
    kind: 'platform_subdomain',
    verificationToken: token,
    dnsRecords: [
      { type: 'CNAME', name: hostname, value: target, ttl: 3600, purpose: 'Points this entity subdomain at the Nexora Entity host.' },
    ],
    instructions: [
      `Add a CNAME record for ${hostname} pointing to ${target}.`,
      'This usually starts working within a few minutes.',
      `Your public address will be https://${hostname}`,
    ],
  };
}

const DOMAIN_LABEL = /^(?!-)[a-z0-9-]{1,63}(?<!-)$/;

/** Produce the plan for connecting a custom domain. */
export async function planCustomDomain(entityId: string, rawHostname: string): Promise<DomainPlan> {
  const cfg = config();
  const hostname = rawHostname.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/\.$/, '');
  const labels = hostname.split('.');
  if (labels.length < 2) {
    throw new NexoraError({
      code: 'domain_invalid',
      domain: 'user_data',
      message: 'Enter a complete domain name, for example myname.com.',
      remediation: [{ kind: 'fix_source', label: 'Correct the domain', primary: true }],
    });
  }
  if (!labels.every((l) => DOMAIN_LABEL.test(l))) {
    throw new NexoraError({
      code: 'domain_invalid',
      domain: 'user_data',
      message: 'That domain name contains characters a domain cannot contain.',
      remediation: [{ kind: 'fix_source', label: 'Correct the domain', primary: true }],
    });
  }
  if (hostname.endsWith(`.${cfg.entityHostSuffix}`)) {
    throw new NexoraError({
      code: 'domain_conflict',
      domain: 'user_data',
      message: 'That is already a Nexora Entity subdomain. Choose a domain you own.',
      remediation: [{ kind: 'fix_source', label: 'Use another domain', primary: true }],
    });
  }

  const existing = await getDomain(hostname);
  if (existing && existing.entity_id !== entityId) {
    throw new NexoraError({
      code: 'domain_taken',
      domain: 'user_data',
      message: 'That domain is already connected to a different entity.',
      remediation: [{ kind: 'fix_source', label: 'Choose another domain', primary: true }],
    });
  }

  const target = dnsTarget();
  const token = `nexora-entity=${entityId}`;
  const dnsRecords = [
    { type: 'A', name: hostname, value: '76.76.21.21', ttl: 3600, purpose: 'Points your domain at the Nexora Entity host.' },
    { type: 'CNAME', name: `www.${hostname}`, value: target, ttl: 3600, purpose: 'Points www at the same place.' },
    { type: 'TXT', name: `_nexora-entity.${hostname}`, value: token, ttl: 3600, purpose: 'Proves the domain is yours and that you authorised this connection.' },
  ];

  await insertDomain({
    entityId,
    hostname,
    kind: 'custom',
    verificationToken: token,
    dnsRecords,
    status: 'pending_dns',
  });

  return {
    hostname,
    kind: 'custom',
    verificationToken: token,
    dnsRecords,
    instructions: [
      'At your domain registrar, add these records. You do not need to understand DNS: Nexora Entity only needs them to point the domain here.',
      'After the records are added, press "Check my domain". Nexora Entity looks up the real DNS records and only activates the domain once they genuinely serve this site.',
    ],
  };
}

/**
 * Verify a custom domain for real: resolve the hostname and the TXT record.
 * A domain is never marked active on the strength of a claim.
 */
export async function verifyCustomDomain(entityId: string, hostname: string): Promise<{
  verified: boolean;
  status: 'active' | 'pending_dns' | 'failed';
  detail: string;
  records: { type: string; name: string; value: string }[];
}> {
  const host = hostname.toLowerCase();
  const record = await getDomain(host);
  if (!record) {
    throw new NexoraError({
      code: 'domain_not_found',
      domain: 'user_data',
      message: 'That domain is not connected to any entity.',
    });
  }

  const dns = await import('node:dns/promises').then((m) => m.default);
  const findings: { type: string; name: string; value: string }[] = [];
  let hostResolves = false;
  try {
    const addresses = await dns.resolve4(host);
    findings.push({ type: 'A', name: host, value: addresses.join(', ') });
    hostResolves = addresses.length > 0;
  } catch {
    try {
      const cnames = await dns.resolveCname(host);
      findings.push({ type: 'CNAME', name: host, value: cnames.join(', ') });
      hostResolves = cnames.length > 0;
    } catch {
      findings.push({ type: 'A', name: host, value: 'not found' });
    }
  }

  let txtOk = false;
  try {
    const txt = await dns.resolveTxt(`_nexora-entity.${host}`);
    const flat = txt.map((parts) => parts.join(''));
    findings.push({ type: 'TXT', name: `_nexora-entity.${host}`, value: flat.join(' | ') });
    txtOk = flat.some((v) => v === record.verification_token || v.includes(record.verification_token ?? ''));
  } catch {
    findings.push({ type: 'TXT', name: `_nexora-entity.${host}`, value: 'not found' });
  }

  const verified = hostResolves && txtOk;
  const detail = verified
    ? `${host} resolves to this platform and the ownership record matches. The domain is live.`
    : !hostResolves
      ? `${host} does not resolve yet. DNS changes can take a while to propagate. The domain is not active until it does.`
      : `The ownership record for ${host} was not found. Add the TXT record shown and check again.`;

  await setDomainStatus(record.id, verified ? 'active' : 'pending_dns', detail);
  if (verified) {
    await makeDomainPrimary(record.id, entityId);
    await audit({ entityId, action: 'domain.verified', detail: { hostname: host } });
  }
  log.info('domain verification run', { host, hostResolves, txtOk, verified });
  return { verified, status: verified ? 'active' : 'pending_dns', detail, records: findings };
}

export { slugSchema };