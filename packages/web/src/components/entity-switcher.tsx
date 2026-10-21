'use client';

import { useRouter } from 'next/navigation';
import { useTransition } from 'react';

interface EntityOption {
  id: string;
  displayName: string | null;
}

/**
 * Studio-wide active-entity switcher.
 *
 * The chosen entity is stored in a first-party cookie the server reads when rendering, so the
 * selection survives navigation across every studio screen. When there is exactly one entity the
 * control is not rendered — the switcher only appears when a choice actually exists.
 */
export default function EntitySwitcher({ entities, activeId }: { entities: EntityOption[]; activeId?: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  if (entities.length <= 1) return null;
  const value = activeId && entities.some((e) => e.id === activeId) ? activeId : entities[0]!.id;

  function pick(id: string) {
    document.cookie = `nexora_active_entity=${encodeURIComponent(id)};path=/;max-age=31536000;samesite=lax`;
    startTransition(() => router.refresh());
  }

  return (
    <label className="flex items-center gap-2 text-xs text-ink-400">
      <span className="hidden sm:inline">Entity</span>
      <select
        className="nx-select w-auto py-1.5 text-[0.8125rem]"
        value={value}
        disabled={pending}
        aria-label="Active entity"
        onChange={(e) => pick(e.target.value)}
      >
        {entities.map((entity) => (
          <option key={entity.id} value={entity.id}>
            {entity.displayName ?? 'Untitled entity'}
          </option>
        ))}
      </select>
    </label>
  );
}
