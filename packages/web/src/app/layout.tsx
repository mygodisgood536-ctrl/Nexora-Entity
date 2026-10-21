import type { Metadata, Viewport } from 'next';
import { Inter, Fraunces, JetBrains_Mono } from 'next/font/google';
import { PRODUCT_NAME, PRODUCT_TAGLINE } from '@nexora/core';
import './globals.css';

/**
 * The platform's type system follows the mandatory design reference
 * (https://cornelius-adedeji-victor-website.vercel.app): a variable serif for display
 * headlines, Inter for body copy, and a mono face for eyebrows and identifiers.
 *
 * Each family must be *loaded*, not merely named in CSS — naming an unavailable family
 * silently falls back to a system font. Next downloads and self-hosts each file, exposes
 * the CSS variable, and makes no runtime request.
 */
const inter = Inter({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-inter',
});

const fraunces = Fraunces({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-fraunces',
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-jetbrains',
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
  themeColor: '#070a12',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      className={`${inter.variable} ${fraunces.variable} ${jetbrainsMono.variable}`}
    >
      <body>
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-accent-600 focus:px-4 focus:py-2 focus:text-ink-950"
        >
          Skip to content
        </a>
        {children}
      </body>
    </html>
  );
}
