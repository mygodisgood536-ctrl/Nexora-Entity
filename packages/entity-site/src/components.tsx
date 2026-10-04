/**
 * Nexora Entity Website Design System — components.
 *
 * These are the only components that ever render a public Entity Website. They are shared by
 * the in-platform live preview and by the deployed site, so what a person sees while building
 * is exactly what gets published.
 */

import type { ReactNode } from 'react';
import type { EntitySiteModel, SiteEntry, SiteImage, SiteLink, SiteSection } from './model';
import { navigationFor } from './compose';

/** Escape for text interpolation into markup. Used only by the static renderer. */
export function esc(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return (parts[0] ?? '?').slice(0, 2).toUpperCase();
  return `${(parts[0] ?? '')[0] ?? ''}${(parts[parts.length - 1] ?? '')[0] ?? ''}`.toUpperCase();
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

function Provenance({ entry }: { entry: SiteEntry }): ReactNode {
  const p = entry.provenance;
  if (p.kind === 'accepted') return null;
  return (
    <p className="nx-provenance">
      <span className="nx-provenance__text">
        <span className="nx-tag">From {p.label}</span>
        {p.url ? (
          <a href={p.url} rel="nofollow noopener" target="_blank">
            source
          </a>
        ) : null}
      </span>
    </p>
  );
}

function EntryCard({ entry, compact }: { entry: SiteEntry; compact: boolean }): ReactNode {
  const Tag = entry.url ? 'a' : 'div';
  return (
    <Tag
      className={`nx-card${entry.url ? ' nx-card--link' : ''}${compact ? ' nx-card--compact' : ''}`}
      {...(entry.url ? { href: entry.url, rel: 'noopener', target: '_blank' } : {})}
    >
      <h4 className="nx-card__title">{entry.title}</h4>
      {entry.detail ? <p className="nx-card__detail">{entry.detail}</p> : null}
      {entry.period || entry.current ? (
        <p className="nx-card__period">
          {entry.current ? <span className="nx-tag nx-tag--accent nx-tag--current">Current</span> : null}
          {entry.period ? <span>{entry.period}</span> : null}
        </p>
      ) : null}
      {entry.tags.length > 0 ? (
        <p className="nx-card__tags">
          {entry.tags.map((t) => (
            <span className="nx-tag" key={t}>
              {t}
            </span>
          ))}
        </p>
      ) : null}
      <Provenance entry={entry} />
    </Tag>
  );
}

function LinkPill({ link }: { link: SiteLink }): ReactNode {
  return (
    <a className="nx-linkpill" href={link.url} rel="noopener" target="_blank">
      <span className="nx-linkpill__label">{link.label}</span>
      <span className="nx-linkpill__host">{link.host || hostOf(link.url)}</span>
      <span className="nx-linkpill__ext" aria-hidden="true">
        &#8599;
      </span>
    </a>
  );
}

function Portrait({ model }: { model: EntitySiteModel }): ReactNode {
  const img = model.primaryImage;
  return (
    <div className="nx-hero__figure">
      {img ? (
        <img
          className="nx-hero__portrait"
          src={img.url}
          alt={img.alt}
          width={img.width ?? undefined}
          height={img.height ?? undefined}
          loading="eager"
          decoding="async"
          fetchPriority="high"
        />
      ) : (
        <div className="nx-hero__initials" aria-hidden="true">
          {initialsOf(model.name)}
        </div>
      )}
    </div>
  );
}

function Hero({ model, nav }: { model: EntitySiteModel; nav: { label: string; href: string }[] }): ReactNode {
  const primaryContact = model.contact?.bookingUrl ?? model.contact?.email ?? null;
  return (
    <header className="nx-hero">
      <div className="nx-shell nx-hero__inner">
        <div className="nx-stack">
          <p className="nx-eyebrow">Public entity</p>
          <h1 className="nx-display">
            <span className="nx-hero__names">
              <span>{model.name}</span>
              {model.alternateNames.length > 0 ? (
                <span className="nx-hero__alt">also {model.alternateNames.join(', ')}</span>
              ) : null}
            </span>
          </h1>
          {model.headline ? <p className="nx-lede">{model.headline}</p> : null}
          {!model.headline && model.summary ? <p className="nx-lede">{model.summary}</p> : null}
          {model.location || model.knownFor ? (
            <p className="nx-hero__meta">
              {model.location ? <span>{model.location}</span> : null}
              {model.knownFor ? <span>{model.knownFor}</span> : null}
            </p>
          ) : null}
          <div className="nx-hero__actions">
            {primaryContact ? (
              <a className="nx-btn nx-btn--accent" href={primaryContact.startsWith('mailto:') ? primaryContact : `mailto:${primaryContact}`}>
                Get in touch
              </a>
            ) : null}
            {nav.length > 0 ? (
              <a className="nx-btn nx-btn--ghost" href={nav[0]?.href}>
                Read more
              </a>
            ) : null}
          </div>
        </div>
        <Portrait model={model} />
      </div>
    </header>
  );
}

function SectionBody({ section }: { section: SiteSection }): ReactNode {
  if (!section.body) return null;
  if (section.id === 'about') {
    return (
      <div className="nx-stack">
        <p className="nx-prose">{section.body}</p>
      </div>
    );
  }
  return <p className="nx-prose">{section.body}</p>;
}

function SectionContent({ section }: { section: SiteSection }): ReactNode {
  const compact = section.emphasis === 'compact';

  if (section.id === 'expertise') {
    return (
      <p className="nx-card__tags">
        {section.entries.map((e) => (
          <span className="nx-tag nx-tag--accent" key={e.id}>
            {e.title}
          </span>
        ))}
      </p>
    );
  }

  if (section.id === 'presence') {
    return (
      <div className="nx-links">
        {section.entries.map((e) => (
          <a className="nx-linkpill" href={e.url ?? '#'} key={e.id} rel="noopener" target="_blank">
            <span className="nx-linkpill__label">{e.title}</span>
            {e.tags[0] ? <span className="nx-linkpill__host">{e.tags[0]}</span> : null}
            <span className="nx-linkpill__ext" aria-hidden="true">
              &#8599;
            </span>
          </a>
        ))}
      </div>
    );
  }

  if (section.id === 'press') {
    return (
      <ol className="nx-timeline">
        {section.entries.map((e) => (
          <li className="nx-timeline__item" key={e.id}>
            <h4 className="nx-card__title">
              {e.url ? (
                <a href={e.url} rel="noopener" target="_blank">
                  {e.title}
                </a>
              ) : (
                e.title
              )}
            </h4>
            {e.detail ? <p className="nx-card__detail">{e.detail}</p> : null}
            {e.tags[0] ? <p className="nx-card__period">{e.tags[0]}</p> : null}
          </li>
        ))}
      </ol>
    );
  }

  if (section.id === 'career' || section.id === 'organizations') {
    return (
      <ol className="nx-timeline">
        {section.entries.map((e) => (
          <li className={`nx-timeline__item${e.current ? ' nx-timeline__item--current' : ''}`} key={e.id}>
            <h4 className="nx-card__title">{e.title}</h4>
            {e.detail ? <p className="nx-card__detail">{e.detail}</p> : null}
            {e.period || e.current ? (
              <p className="nx-card__period">
                {e.current ? <span className="nx-tag nx-tag--accent nx-tag--current">Current</span> : null}
                {e.period ? <span>{e.period}</span> : null}
              </p>
            ) : null}
          </li>
        ))}
      </ol>
    );
  }

  if (section.id === 'contact') {
    return (
      <ul className="nx-links">
        {section.entries.map((e) => (
          <li key={e.id}>
            {e.url ? (
              <a className="nx-linkpill" href={e.url}>
                <span className="nx-linkpill__label">{e.title}</span>
              </a>
            ) : (
              <span className="nx-tag">{e.title}</span>
            )}
          </li>
        ))}
      </ul>
    );
  }

  const tint = section.id === 'achievements';
  return (
    <div className={`nx-grid ${tint ? 'nx-grid--2' : 'nx-grid--3'}`}>
      {section.entries.map((e) => (
        <EntryCard key={e.id} entry={e} compact={compact} />
      ))}
    </div>
  );
}

export function Gallery({ images }: { images: SiteImage[] }): ReactNode {
  if (images.length === 0) return null;
  return (
    <div className="nx-gallery">
      {images.map((img, i) => (
        <figure className={`nx-gallery__item${i === 0 ? ' nx-gallery__item--primary' : ''}`} key={img.url}>
          <img
            src={img.url}
            alt={img.alt}
            width={img.width ?? undefined}
            height={img.height ?? undefined}
            loading={i === 0 ? 'eager' : 'lazy'}
            decoding="async"
          />
          {img.caption ? <figcaption className="nx-gallery__caption">{img.caption}</figcaption> : null}
        </figure>
      ))}
    </div>
  );
}

function Section({ section, index, total }: { section: SiteSection; index: number; total: number }): ReactNode {
  const tint = section.id === 'about' || section.id === 'achievements';
  const Heading = section.headingLevel === 2 ? 'h2' : 'h3';
  return (
    <section
      className={`nx-section${tint ? ' nx-section--tint' : ''}`}
      id={section.anchor}
      aria-labelledby={`${section.anchor}-heading`}
    >
      <div className="nx-shell">
        <div className="nx-section__head">
          <Heading className="nx-h2" id={`${section.anchor}-heading`}>
            {section.title}
          </Heading>
          <span className="nx-section__rule" aria-hidden="true" />
        </div>
        <SectionBody section={section} />
        <div style={{ marginTop: section.body ? 'var(--nx-space-5)' : 0 }}>
          <SectionContent section={section} />
        </div>
        {index === total - 1 ? null : null}
      </div>
    </section>
  );
}

function Masthead({ model, nav }: { model: EntitySiteModel; nav: { label: string; href: string }[] }): ReactNode {
  return (
    <div className="nx-masthead">
      <div className="nx-shell nx-masthead__inner">
        <a className="nx-brand" href="#top">
          <span className="nx-brand__mark" aria-hidden="true">
            {initialsOf(model.name)}
          </span>
          <span className="nx-brand__name">{model.name}</span>
        </a>
        {nav.length > 0 ? (
          <nav className="nx-nav" aria-label="Sections">
            {nav.map((item) => (
              <a className="nx-nav__link" href={item.href} key={item.href}>
                {item.label}
              </a>
            ))}
          </nav>
        ) : null}
      </div>
    </div>
  );
}

function Footer({ model }: { model: EntitySiteModel }): ReactNode {
  return (
    <footer className="nx-footer">
      <div className="nx-shell">
        <p className="nx-footer__notice">{model.standardNotice}</p>
        <div className="nx-footer__meta">
          <span>
            Assembled and checked by Nexora Entity. Last reviewed {new Date(model.lastUpdated).toISOString().slice(0, 10)}.
          </span>
          <span>
            {model.published ? 'Published' : 'Preview'} &middot; canonical:{' '}
            <span className="nx-font-mono">{model.entityUid}</span>
          </span>
        </div>
      </div>
    </footer>
  );
}

/**
 * The Entity Website. Renders whatever the composer decided to show; never adds filler.
 */
export function EntitySite({ model }: { model: EntitySiteModel }): ReactNode {
  const nav = navigationFor(model);
  const photoSection = model.sections.find((s) => s.id === 'photos');

  const sections = model.sections
    .filter((s) => s.id !== 'photos')
    .map((s, i, arr) => (
      <Section key={s.id} section={s} index={i} total={arr.length} />
    ));

  const photosSection = photoSection && (model.primaryImage || model.gallery.length > 0)
    ? (
        <section className="nx-section" id="photos" aria-labelledby="photos-heading">
          <div className="nx-shell">
            <div className="nx-section__head">
              <h2 className="nx-h2" id="photos-heading">
                {photoSection.title}
              </h2>
              <span className="nx-section__rule" aria-hidden="true" />
            </div>
            <Gallery images={[...(model.primaryImage ? [model.primaryImage] : []), ...model.gallery]} />
          </div>
        </section>
      )
    : null;

  return (
    <div id="top">
      <a className="nx-skip" href="#content">
        Skip to content
      </a>
      {model.published ? null : (
        <p className="nx-draftbar" role="status">
          Preview &mdash; this Entity Website is not published yet.
        </p>
      )}
      <Masthead model={model} nav={nav} />
      <Hero model={model} nav={nav} />
      <main id="content">
        {sections}
        {photosSection}
      </main>
      <Footer model={model} />
    </div>
  );
}

export { LinkPill, SectionContent, EntryCard };