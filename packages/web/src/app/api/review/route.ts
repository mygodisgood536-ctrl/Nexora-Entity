import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { config } from '@nexora/core/config';
import { toActionableError, UserDataError } from '@nexora/core';
import {
  decideReviewItem,
  findEntityForUser,
  getConflict,
  getReviewItem,
  resolveConflict,
  resolveSession,
  updateClaimStatus,
} from '@nexora/db';
import { ClaimStatus } from '@nexora/core';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Apply a review decision.
 *
 * Accepting a contradiction makes the selected facts authoritative inside Nexora Entity and
 * keeps the rejected one with its provenance. Nothing is erased, and the decision is recorded.
 */
export async function POST(request: Request) {
  const store = await cookies();
  const user = await resolveSession(store.get(config().sessionCookieName)?.value);
  if (!user) return NextResponse.json({ ok: false, error: { message: 'Sign in first.' } }, { status: 401 });

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: UserDataError.invalid('body', 'Could not read the request.').toJSON() }, { status: 400 });
  }

  const body = payload as { entityId?: unknown; reviewItemId?: unknown; decision?: unknown };
  if (typeof body.entityId !== 'string' || typeof body.reviewItemId !== 'string') {
    return NextResponse.json({ ok: false, error: UserDataError.invalid('request', 'entityId and reviewItemId are required.').toJSON() }, { status: 400 });
  }
  const decision = body.decision === 'accepted' ? 'accepted' : body.decision === 'rejected' ? 'rejected' : null;
  if (!decision) {
    return NextResponse.json({ ok: false, error: UserDataError.invalid('decision', 'Choose accept or reject.').toJSON() }, { status: 400 });
  }

  const entity = await findEntityForUser(body.entityId, user.id);
  if (!entity) return NextResponse.json({ ok: false, error: UserDataError.invalid('entityId', 'That entity is not yours.').toJSON() }, { status: 403 });

  const item = await getReviewItem(body.reviewItemId);
  if (!item || item.entity_id !== entity.id) {
    return NextResponse.json({ ok: false, error: UserDataError.invalid('reviewItemId', 'That item no longer exists.').toJSON() }, { status: 404 });
  }

  try {
    let note = '';

    if (item.conflict_id) {
      const conflict = await getConflict(item.conflict_id);
      if (conflict) {
        if (decision === 'accepted') {
          // The person confirms this is a real conflict worth resolving: the claims in the
          // conflict are accepted as authoritative within Nexora Entity, with the choice
          // recorded rather than the disagreement erased.
          for (const claimId of conflict.claim_ids) {
            await updateClaimStatus(claimId, { status: ClaimStatus.acceptedAuthoritative, userConfirmed: true });
          }
          await resolveConflict(conflict.id, 'resolved_by_user', 'Confirmed by the person as accurate.');
          note = 'Recorded as accurate in Nexora Entity.';
        } else {
          await resolveConflict(conflict.id, 'dismissed', 'The person did not consider this a genuine contradiction.');
          note = 'Dismissed.';
        }
      }
    }

    if (item.ambiguity_id) {
      const { resolveAmbiguity: resolve } = await import('@nexora/db');
      const { listAmbiguities } = await import('@nexora/db');
      const found = (await listAmbiguities(entity.id, true)).find((a) => a.id === item.ambiguity_id);
      if (found) {
        await resolve(found.id, decision === 'accepted' ? 'resolved' : 'dismissed', 'Decided by the person.');
        note = decision === 'accepted' ? 'Ambiguity resolved by your confirmation.' : 'Marked as not an ambiguity.';
      }
    }

    if (item.kind === 'identity_verdict') {
      const { setIdentityUserDecision } = await import('@nexora/db');
      const { listIdentityLinks } = await import('@nexora/db');
      const links = await listIdentityLinks(entity.id);
      const target = links.find((l) => l.source_id === item.source_id);
      if (target) {
        await setIdentityUserDecision(target.id, decision === 'accepted' ? 'accept' : 'reject');
        note =
          decision === 'accepted'
            ? 'Profile confirmed as yours. It can now count as evidence.'
            : 'Profile rejected. It will not be presented as yours.';
      }
    }

    await decideReviewItem(item.id, decision === 'accepted' ? 'accepted' : 'rejected', note || 'Decided by the person.');

    const updated = await getReviewItem(item.id);
    return NextResponse.json({ ok: true, data: { item: updated, note } });
  } catch (err) {
    const error = toActionableError(err);
    return NextResponse.json({ ok: false, error }, { status: error.status });
  }
}