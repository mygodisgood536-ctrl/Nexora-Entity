import type { Metadata } from 'next';
import AccountSettings from '@/components/account-settings';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Settings',
  description: 'Your account, your security, and the sessions that can sign in as you.',
};

/**
 * The account screen.
 *
 * Section 30 asks for clear controls for user data and connected accounts. The controls live here
 * rather than behind a hidden menu, so they are findable.
 */
export default function SettingsPage() {
  return (
    <main id="main" className="nx-shell py-8">
      <AccountSettings />
    </main>
  );
}
