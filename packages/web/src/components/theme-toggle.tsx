'use client';

import { useEffect, useState } from 'react';

export type ThemeChoice = 'light' | 'dark' | 'system';

const STORAGE_KEY = 'nexora-theme';

interface ThemeToggleProps {
  /** Where the control is rendered, so it can be styled for a dark or light chrome. */
  variant?: 'header' | 'panel';
}

function systemTheme(): 'light' | 'dark' {
  if (typeof window === 'undefined') return 'light';
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function applyTheme(choice: ThemeChoice): 'light' | 'dark' {
  const resolved = choice === 'system' ? systemTheme() : choice;
  document.documentElement.dataset.theme = resolved;
  document.documentElement.style.colorScheme = resolved;
  return resolved;
}

/**
 * Light and dark theme control.
 *
 * The choice is remembered across visits. When the person has not chosen, the platform follows
 * the operating system's preference, so the first visit already looks right without anyone having
 * to find a switch. The control is rendered from a script in the document head, so the theme is
 * applied before the first paint and the page never flashes the wrong one.
 */
export default function ThemeToggle({ variant = 'header' }: ThemeToggleProps) {
  // The stored choice is read during the first render rather than in an effect, so the control
  // never shows the wrong selection and the page does not re-render to correct it.
  const [choice, setChoice] = useState<ThemeChoice>(() => {
    if (typeof window === 'undefined') return 'system';
    const stored = window.localStorage.getItem(STORAGE_KEY) as ThemeChoice | null;
    return stored === 'light' || stored === 'dark' ? stored : 'system';
  });
  const [resolved, setResolved] = useState<'light' | 'dark'>(() => {
    if (typeof window === 'undefined') return 'light';
    const stored = window.localStorage.getItem(STORAGE_KEY) as ThemeChoice | null;
    if (stored === 'light' || stored === 'dark') return stored;
    return systemTheme();
  });

  useEffect(() => {
    // The document script has already applied the theme before the first paint; this keeps the
    // component in step with it in case the stored value changed in another tab.
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => {
      const stored = window.localStorage.getItem(STORAGE_KEY) as ThemeChoice | null;
      if (stored === 'light' || stored === 'dark') return;
      setResolved(applyTheme('system'));
    };
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, []);

  function choose(next: ThemeChoice) {
    setChoice(next);
    setResolved(applyTheme(next));
    if (next === 'system') {
      window.localStorage.removeItem(STORAGE_KEY);
    } else {
      window.localStorage.setItem(STORAGE_KEY, next);
    }
  }

  const options: { value: ThemeChoice; label: string; icon: string }[] = [
    { value: 'light', label: 'Light', icon: '☀' },
    { value: 'dark', label: 'Dark', icon: '☾' },
    { value: 'system', label: 'System', icon: '◐' },
  ];

  return (
    <div
      className="nx-theme-toggle"
      role="radiogroup"
      aria-label="Colour theme"
      data-variant={variant}
    >
      {options.map((option) => {
        const active = choice === option.value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={active}
            title={`${option.label} theme`}
            className="nx-theme-toggle__option"
            data-active={active ? 'true' : 'false'}
            onClick={() => choose(option.value)}
          >
            <span aria-hidden="true">{option.icon}</span>
            <span className="nx-sr-only">{option.label} theme</span>
          </button>
        );
      })}
      <span className="nx-sr-only" aria-live="polite">
        {`${resolved} theme`}
      </span>
    </div>
  );
}
