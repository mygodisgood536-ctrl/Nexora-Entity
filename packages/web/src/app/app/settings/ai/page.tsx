import type { Metadata } from 'next';
import { getActiveAiConfiguration } from '@nexora/db';
import { requireUser } from '@/lib/server';
import ProviderModelSelector from '@/components/provider-model-selector';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'AI Provider and Model',
  description: 'Choose the free model, provider, key and model that power your account.',
};

/**
 * The provider and model page.
 *
 * The same component the panel uses, so the two can never drift apart. The panel is what appears
 * the moment an entity is created; this page is where the choice can be revisited later without
 * leaving the working screen.
 */
export default async function AiSettingsPage() {
  const user = await requireUser('/app/settings/ai');
  const active = await getActiveAiConfiguration(user.id);

  return (
    <main id="main" className="nx-shell py-8">
      <div className="nx-stack nx-stack--loose">
        <div>
          <p className="nx-eyebrow">AI configuration</p>
          <h1 className="nx-title">Your AI Provider and Model</h1>
          <p className="nx-subtitle">
            The model you verify here becomes your account&rsquo;s active AI configuration and powers every AI-assisted
            step until you change it.
          </p>
        </div>

        <ProviderModelSelector active={active ? { providerId: active.provider_id, modelId: active.model_id } : null} />
      </div>
    </main>
  );
}
