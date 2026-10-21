/**
 * Behavioural checks for the in-memory double.
 *
 * These assert the semantics the SQL gives in PostgreSQL — especially the ones that protect
 * readiness from being overstated. A mirror that quietly diverged here would let a test pass while
 * the hosted database behaves differently.
 */

import { beforeEach, describe, expect, it } from 'vitest';

import {
  clearSessionCookie,
  countPendingReviewItems,
  createDeployment,
  createEntity,
  createSession,
  decideReviewItem,
  findEntityBySlug,
  findUserByUsername,
  getActiveAiConfiguration,
  getDeployment,
  hashSecurityAnswer,
  insertDomain,
  insertReviewItem,
  insertSource,
  insertUser,
  latestEvidenceMinimums,
  latestReadyRun,
  listClaims,
  listConflicts,
  listDomains,
  listEntitiesForUser,
  listPhotos,
  listReadinessRuns,
  liveDeployment,
  makeDomainPrimary,
  mem,
  memoryTableSizes,
  resolveSession,
  revokeAllSessions,
  revokeSession,
  saveStageProgress,
  sessionCookie,
  stageCounts,
  supersedeDeployments,
  updateDeployment,
  upsertVerifiedAiConfiguration,
  usernameAvailable,
} from '../src/memory-index';

/** Mirrors how the inspect pipeline supplies a source: the URL plus its canonicalised parts. */
const source = (entityId: string, url: string, kind = 'website') =>
  insertSource({
    entityId,
    url,
    canonicalUrl: url,
    registrableDomain: 'example.org',
    host: 'example.org',
    suppliedKind: kind,
  });

/** Creates a user the way the real sign-up route does: hash the answer, then insert. */
const user = () => {
  const { hash, salt } = hashSecurityAnswer('analytical engine');
  return insertUser({
    fullName: 'Ada Lovelace',
    username: 'ada',
    securityQuestion: 'First programming language',
    answerHash: hash,
    answerSalt: salt,
  });
};

describe('in-memory repositories', () => {
  beforeEach(() => {
    mem.reset();
  });

  describe('users and sessions', () => {
    it('finds a user again by username, case-insensitively', async () => {
      // The SQL implementation matches on the `username_norm` column. A mirror that inserted the
      // user but not that column would accept sign-up and then reject every login as invalid
      // credentials, with no other symptom.
      const u = await user();

      const found = await findUserByUsername('ada');
      expect(found?.id).toBe(u.id);
      expect(found?.username_norm).toBe('ada');
      expect(await usernameAvailable('ada')).toBe(false);

      // Normalisation must match the database behaviour, not JavaScript's exact string compare.
      expect((await findUserByUsername('  ADA '))?.id).toBe(u.id);
      expect(await usernameAvailable('ada')).toBe(false);
      expect(await usernameAvailable('grace')).toBe(true);
    });

    it('round-trips a real session through the hashed token', async () => {
      const u = await user();
      const { token, expiresAt } = await createSession(u.id);

      expect(expiresAt.getTime()).toBeGreaterThan(Date.now());
      const resolved = await resolveSession(token);
      expect(resolved?.username).toBe('ada');
      expect(resolved?.full_name).toBe('Ada Lovelace');
    });

    it('never returns the same user for a revoked or absent token', async () => {
      const u = await user();
      expect(await resolveSession(undefined)).toBeNull();
      expect(await resolveSession('not-a-token')).toBeNull();

      const { token } = await createSession(u.id);
      await revokeSession(token);
      expect(await resolveSession(token)).toBeNull();
    });

    it('revokes every session for a user at once', async () => {
      const u = await user();
      const a = await createSession(u.id);
      const b = await createSession(u.id);

      await revokeAllSessions(u.id);

      expect(await resolveSession(a.token)).toBeNull();
      expect(await resolveSession(b.token)).toBeNull();
    });

    it('stores answers hashed, never in plaintext', () => {
      const { hash, salt } = hashSecurityAnswer('analytical engine');
      expect(hash).not.toContain('analytical');
      expect(hashSecurityAnswer('analytical engine', salt).hash).toBe(hash);
      // Case and whitespace must not lock a legitimate user out.
      expect(hashSecurityAnswer('  Analytical   Engine ', salt).hash).toBe(hash);
    });

    it('signs a cookie that is HttpOnly and SameSite', () => {
      const cookie = sessionCookie('tok', new Date(), true);
      expect(cookie).toContain('nexora_session=tok');
      expect(cookie).toContain('HttpOnly');
      expect(cookie).toContain('SameSite=Lax');
      expect(cookie).toContain('Secure');
      expect(clearSessionCookie(false)).toContain('Max-Age=0');
    });
  });

  describe('entities and stage progress', () => {
    it('scopes entities to their owner and resolves by slug', async () => {
      const u = await user();
      const e = await createEntity({ userId: u.id, displayName: 'Ada Lovelace' });

      const mine = await listEntitiesForUser(u.id);
      expect(mine.map((x) => x.id)).toContain(e.id);
      expect((await findEntityBySlug(e.slug))?.id).toBe(e.id);
    });

    it('counts a deferred stage as neither complete nor pending', async () => {
      const u = await user();
      const e = await createEntity({ userId: u.id, displayName: 'Ada Lovelace' });

      await saveStageProgress({ entityId: e.id, stageKey: 'A_identity', status: 'complete', data: {} });
      await saveStageProgress({ entityId: e.id, stageKey: 'B_name_variants', status: 'skipped', data: {} });

      const counts = await stageCounts(e.id);
      expect(counts.complete).toBe(1);
      // Amendment §3: choosing not to provide something is not the same as satisfying it.
      expect(counts.skipped).toBe(1);
      expect(counts.complete).not.toBe(counts.complete + counts.skipped);
    });
  });

  describe('review items and readiness', () => {
    it('does not open a second review item for the same conflict', async () => {
      const u = await user();
      const e = await createEntity({ userId: u.id, displayName: 'Ada Lovelace' });
      const args = {
        entityId: e.id,
        kind: 'conflict' as const,
        title: 'Conflicting birth year',
        proposed: {},
        conflictId: 'c-1',
      };

      const first = await insertReviewItem(args);
      const second = await insertReviewItem(args);

      expect(second.id).toBe(first.id);
      expect(await countPendingReviewItems(e.id)).toBe(1);
    });

    it('stops counting an item as pending once decided', async () => {
      const u = await user();
      const e = await createEntity({ userId: u.id, displayName: 'Ada Lovelace' });
      const item = await insertReviewItem({
        entityId: e.id,
        kind: 'conflict',
        title: 'Conflict',
        proposed: {},
      });

      await decideReviewItem(item.id, 'accepted', 'checked the registry');

      expect(await countPendingReviewItems(e.id)).toBe(0);
      expect(await listConflicts(e.id)).toEqual([]);
    });
  });

  describe('sources and domains', () => {
    it('starts every source uninspected and unqualified', async () => {
      const u = await user();
      const e = await createEntity({ userId: u.id, displayName: 'Ada Lovelace' });
      const created = await source(e.id, 'https://example.org/about');

      expect(created.inspection_status).toBe('pending');
      expect(created.inspected_at).toBeNull();
      expect(created.qualifies_websites).toBe(false);
      expect(created.qualifies_press).toBe(false);
    });

    it('keeps at most one primary domain per entity', async () => {
      const u = await user();
      const e = await createEntity({ userId: u.id, displayName: 'Ada Lovelace' });
      const a = { entityId: e.id, kind: 'custom' as const, verificationToken: 't1', dnsRecords: [] };
      const b = { entityId: e.id, kind: 'custom' as const, verificationToken: 't2', dnsRecords: [] };

      const one = await insertDomain({ ...a, hostname: 'a.test' });
      const two = await insertDomain({ ...b, hostname: 'b.test' });

      await makeDomainPrimary(one.id, e.id);
      await makeDomainPrimary(two.id, e.id);

      const domains = await listDomains(e.id);
      expect(domains.filter((d) => d.is_primary).map((d) => d.hostname)).toEqual(['b.test']);
    });
  });

  describe('deployments', () => {
    it('keeps exactly one live deployment and appends log lines', async () => {
      const u = await user();
      const e = await createEntity({ userId: u.id, displayName: 'Ada Lovelace' });

      const first = await createDeployment({ entityId: e.id, target: 'platform_host' });
      await updateDeployment(first.id, { status: 'live' });
      await updateDeployment(first.id, { logAppend: 'built site' });

      const second = await createDeployment({ entityId: e.id, target: 'vercel', attempt: 2 });
      await updateDeployment(second.id, { status: 'live', logAppend: 'rebuilt site' });
      await supersedeDeployments(e.id, second.id);

      const live = await liveDeployment(e.id);
      expect(live?.id).toBe(second.id);
      // Re-read rather than trusting the object returned at creation time, which predates the
      // updates. Appending must preserve every earlier step instead of replacing the log.
      expect((await getDeployment(second.id))?.log).toContain('rebuilt site');
      expect((await getDeployment(first.id))?.log).toContain('built site');
    });
  });

  describe('ai configuration', () => {
    it('replaces rather than stacks, so only one model is ever active', async () => {
      const u = await user();
      const first = await getActiveAiConfiguration(u.id);
      expect(first).toBeNull();

      const a = await upsertVerifiedAiConfiguration({
        userId: u.id,
        providerId: 'p1',
        providerName: 'Provider One',
        modelId: 'm1',
        modelName: 'Model One',
        verification: {},
      });
      const b = await upsertVerifiedAiConfiguration({
        userId: u.id,
        providerId: 'p2',
        providerName: 'Provider Two',
        modelId: 'm2',
        modelName: 'Model Two',
        verification: {},
      });

      expect(b.is_active).toBe(true);
      const active = await getActiveAiConfiguration(u.id);
      expect(active?.id).toBe(b.id);
      expect(active?.id).not.toBe(a.id);
    });
  });

  describe('inspection helpers', () => {
    it('exposes table sizes so a test can prove it wrote something', async () => {
      const u = await user();
      const e = await createEntity({ userId: u.id, displayName: 'Ada Lovelace' });
      await insertSource({
        entityId: e.id,
        url: 'https://example.org',
        canonicalUrl: 'https://example.org',
        registrableDomain: 'example.org',
        host: 'example.org',
        suppliedKind: 'website',
      });

      const sizes = memoryTableSizes();
      expect(sizes.users).toBe(1);
      expect(sizes.entities).toBe(1);
      expect(sizes.sources).toBe(1);
      expect(sizes.claims ?? 0).toBe(0);
    });

    it('returns empty collections instead of throwing for untouched tables', async () => {
      const u = await user();
      const e = await createEntity({ userId: u.id, displayName: 'Ada Lovelace' });
      expect(await listPhotos(e.id)).toEqual([]);
      expect(await listClaims(e.id)).toEqual([]);
      expect(await listReadinessRuns(e.id)).toEqual([]);
      expect(await latestReadyRun(e.id)).toBeNull();
      expect(await latestEvidenceMinimums(e.id)).toBeNull();
    });
  });
});