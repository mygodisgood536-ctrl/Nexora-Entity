import Link from 'next/link';
import { PRODUCT_NAME, PRODUCT_TAGLINE } from '@nexora/core';

/** Marketing front door. States plainly what the product does and what it does not promise. */
export default function HomePage() {
  return (
    <main id="main" className="min-h-screen">
      <header className="border-b border-ink-100">
        <div className="nx-shell flex flex-wrap items-center justify-between gap-3 py-4">
          <div className="flex items-center gap-2.5">
            <span
              aria-hidden="true"
              className="grid h-8 w-8 place-items-center rounded-lg bg-gradient-to-br from-ink-900 to-ink-600 text-[0.65rem] font-bold text-white"
            >
              NE
            </span>
            <span className="font-semibold tracking-tight text-ink-900">{PRODUCT_NAME}</span>
          </div>
          <nav className="flex items-center gap-2">
            <Link href="/login" className="nx-btn nx-btn--ghost nx-btn--sm">
              Sign in
            </Link>
            <Link href="/signup" className="nx-btn nx-btn--primary nx-btn--sm">
              Create account
            </Link>
          </nav>
        </div>
      </header>

      <section className="relative overflow-hidden">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0"
          style={{
            background:
              'radial-gradient(1000px 460px at 76% -10%, rgba(37,99,235,0.10), transparent 60%), radial-gradient(700px 380px at 4% 0%, rgba(11,15,20,0.07), transparent 58%)',
          }}
        />
        <div className="nx-shell relative grid gap-12 py-16 md:grid-cols-[1.15fr_0.85fr] md:items-center md:py-24">
          <div className="nx-stack" style={{ gap: '1.25rem' }}>
            <p className="nx-eyebrow">Digital identity, made coherent</p>
            <h1 className="nx-display">{PRODUCT_TAGLINE}</h1>
            <p className="nx-subtitle">
              Nexora Entity collects the information you supply, examines the public and authorised sources you connect,
              resolves legitimate name variations, keeps provenance and evidence for every fact, detects contradictions and
              ambiguity, and refuses to publish until the whole entity passes a complete second-pass review. Only then does
              it compose a beautiful public Entity Website from its pre-designed design system.
            </p>
            <div className="nx-row" style={{ marginTop: '0.5rem' }}>
              <Link href="/signup" className="nx-btn nx-btn--accent">
                Build your entity
              </Link>
              <a href="#how" className="nx-btn nx-btn--ghost">
                How it works
              </a>
            </div>
            <p className="nx-help" style={{ maxWidth: '54ch' }}>
              Account creation asks for four things only: your full name, a username, a security question and a security
              answer. You are never asked technical questions the platform can answer itself.
            </p>
          </div>

          <div className="nx-card nx-card--pad nx-stack">
            <p className="nx-eyebrow">What 100% actually means</p>
            <p className="nx-title" style={{ fontSize: '1.15rem' }}>
              Complete and internally coherent against the Nexora Entity Readiness Standard.
            </p>
            <ul className="nx-stack-sm" style={{ listStyle: 'none', padding: 0, margin: 0 }}>
              {[
                'Every fact keeps where it came from, when it was checked, and how it was verified.',
                'What you tell us stays labelled as yours. What an inspected source says stays labelled as the source’s.',
                'Similar names are never treated as proof that two profiles are the same person.',
                'Four pages copying one press release count once, not four.',
                'Any blocking issue stops publication. Nothing is published at 99%.',
              ].map((line) => (
                <li key={line} className="nx-row items-start gap-2 text-sm leading-relaxed text-ink-600">
                  <span aria-hidden="true" className="mt-1.5 h-1.5 w-1.5 flex-none rounded-full bg-accent-600" />
                  <span>{line}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      <section id="how" className="border-t border-ink-100 bg-ink-50/50">
        <div className="nx-shell py-16 md:py-20">
          <h2 className="nx-title">The guided flow</h2>
          <p className="nx-subtitle" style={{ marginTop: '0.5rem' }}>
            You move through clear stages. The difficult research, cross-checking, identity resolution, source analysis and
            technical work happen behind the scenes.
          </p>
          <ol className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {[
              ['Create your account', 'Four fields, no jargon.'],
              ['Create an entity', 'The AI provider and model panel opens immediately — AI is intrinsic, so there is no “do you want to use AI?” question.'],
              ['Choose and verify a provider', 'Availability comes live from OpenCode. A model is only accepted after a real test call succeeds.'],
              ['Fill the stages you want', 'Skip anything for now. A skip is not a satisfaction — the platform tells you later if something skipped turned out to matter.'],
              ['Let Nexora Entity investigate', 'Sources are fetched for real, identity is resolved across multiple signals, and provenance is recorded.'],
              ['Resolve only what needs you', 'Discovered information, contradictions and ambiguities appear in one review queue.'],
              ['Pass the whole-entity review', 'A complete second pass re-examines everything, not just the field you corrected.'],
              ['Publish', 'At 100% Entity Readiness, the public Entity Website is generated, validated and deployed.'],
            ].map(([title, body], i) => (
              <li key={title} className="nx-card nx-card--pad">
                <div className="nx-row" style={{ gap: '0.5rem', marginBottom: '0.4rem' }}>
                  <span className="nx-rail__letter">{i + 1}</span>
                  <h3 className="text-sm font-semibold text-ink-900">{title}</h3>
                </div>
                <p className="text-sm leading-relaxed text-ink-500">{body}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section className="border-t border-ink-100">
        <div className="nx-shell grid gap-8 py-16 md:grid-cols-2 md:py-20">
          <div className="nx-stack">
            <h2 className="nx-title">About search engines, honestly</h2>
            <p className="text-sm leading-relaxed text-ink-600">
              Nexora Entity is designed to make a person’s online identity more coherent, connected, attributable and
              understandable to search engines. It publishes one clear canonical identity page, accurate Person and
              ProfilePage structured data, legitimate alternate names, accurate sameAs relationships, crawlable images,
              stable URLs and identifiers, and internal links between the person and their work.
            </p>
            <p className="text-sm leading-relaxed text-ink-600">
              Google independently decides what information appears in Search and how its Knowledge Graph and Knowledge
              Panels are created or updated. Nexora Entity has no access to, and makes no claim about, Google’s private
              internal Knowledge Graph state. “Verified” in Nexora Entity always means verified against Nexora Entity’s own
              Entity Readiness Standard — never verification, approval or endorsement by a search engine.
            </p>
          </div>
          <div className="nx-stack">
            <h2 className="nx-title">Evidence minimums</h2>
            <p className="text-sm leading-relaxed text-ink-600">
              Nexora Entity applies its own internal evidence requirements for describing a real person: five qualifying
              live websites, four qualifying press releases, and four qualifying photographs.
            </p>
            <p className="text-sm leading-relaxed text-ink-600">
              These are Nexora Entity’s own requirements. They are not requirements imposed by Google or any other search
              engine. Quality is checked, not just counted: dead links, unrelated pages, duplicates and copies of the same
              source do not satisfy them.
            </p>
            <div className="nx-card nx-card--pad">
              <p className="nx-eyebrow">Where a source cannot be read</p>
              <p className="mt-1 text-sm leading-relaxed text-ink-600">
                Some platforms do not permit automated reading. Nexora Entity records that limitation and says so plainly
                rather than claiming a profile was checked. It never claims a profile belongs to you without evidence, and it
                never claims a source was inspected when it could not be reached.
              </p>
            </div>
          </div>
        </div>
      </section>

      <footer className="border-t border-ink-100 bg-ink-50/50">
        <div className="nx-shell flex flex-wrap items-center justify-between gap-4 py-8 text-xs text-ink-400">
          <span>
            {PRODUCT_NAME} — {PRODUCT_TAGLINE}
          </span>
          <div className="flex flex-wrap gap-4">
            <Link href="/login" className="hover:text-ink-700">
              Sign in
            </Link>
            <Link href="/signup" className="hover:text-ink-700">
              Create account
            </Link>
          </div>
        </div>
      </footer>
    </main>
  );
}