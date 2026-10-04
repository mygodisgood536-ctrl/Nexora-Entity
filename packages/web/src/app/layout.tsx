import type { Metadata, Viewport } from 'next';
import { Inter } from 'next/font/google';
import { PRODUCT_NAME, PRODUCT_TAGLINE } from '@nexora/core';
import './globals.css';

/**
 * Inter is the platform's specified typeface (§4.3.3). It must be *loaded*, not merely
 * named in CSS — naming an unavailable family silently falls back to a system font, which
 * is exactly the defect this replaces. Next downloads and self-hosts the file, exposes it
 * as `--font-inter`, and applies no request at runtime.
 */
const inter = Inter({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-inter',
});

export const metadata: Metadata = {
  title: {
    default: `${PRODUCT_NAME} — ${PRODUCT_TAGLINE}`,
    template: `%s · ${PRODUCT_NAME}`,
  },
  description:
    'Nexora Entity collects, connects, inspects, verifies and maintains a coherent public representation of a real person, then publishes a public Entity Website from the information that passes its Entity Readiness Standard.',
  applicationName: PRODUCT_NAME,
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#0b0f14',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={inter.variable}>
      <body>
        <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-ink-900 focus:px-4 focus:py-2 focus:text-white">
          Skip to content
        </a>
        {children}
      </body>
    </html>
  );
}