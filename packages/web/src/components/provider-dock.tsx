'use client';

import { useState } from 'react';
import ProviderPanel, { type ActiveConfig } from './provider-panel';

interface Props {
  initial: ActiveConfig | null;
  /** Open the panel on arrival. Spec §5: the provider interface appears immediately. */
  defaultOpen?: boolean;
}

/**
 * Persistent, unobtrusive AI provider control pinned to the bottom of the working screen.
 * Always reachable so the person can change provider without leaving the current stage.
 */
export default function ProviderDock({ initial, defaultOpen }: Props) {
  const [config, setConfig] = useState<ActiveConfig | null>(initial);
  // `defaultOpen` seeds the initial state rather than being pushed into it by an effect. The
  // panel only ever needs to open itself once, on arrival; an effect that re-ran on the prop
  // would force an extra render pass for no benefit, and would re-open a panel the person had
  // just dismissed if the prop were ever recomputed.
  const [open, setOpen] = useState(Boolean(defaultOpen));

  const failed = Boolean(config?.lastError);

  return (
    <>
      <div className="nx-dock nx-no-print">
        <div className="nx-shell nx-dock__inner">
          <span
            aria-hidden="true"
            className={`nx-dock__dot ${failed ? 'nx-dock__dot--stop' : config ? 'nx-dock__dot--good' : 'nx-dock__dot--warn'}`}
          />
          <div className="min-w-0 flex-1">
            <p className="text-xs font-semibold text-ink-800">
              {config ? `${config.providerName} · ${config.modelName}` : 'No AI configuration yet'}
            </p>
            <p className="nx-help truncate">
              {failed
                ? config?.lastError ?? 'The active configuration is failing.'
                : config
                  ? 'Active for your account. Changing it never affects your information.'
                  : 'Choose a provider and model. Everything else works without it, but AI-assisted steps need one.'}
            </p>
          </div>
          <button type="button" className={`nx-btn nx-btn--sm ${failed ? 'nx-btn--accent' : 'nx-btn--ghost'}`} onClick={() => setOpen(true)}>
            {failed ? 'Fix provider' : config ? 'Change' : 'Choose provider'}
          </button>
        </div>
      </div>
      <ProviderPanel
        active={config}
        open={open}
        onClose={() => setOpen(false)}
        onVerified={(next) => setConfig(next)}
      />
    </>
  );
}