'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

interface Props {
  entityId: string;
  /** Width of the preview viewport in CSS pixels. */
  width?: number;
  height?: number;
}

/**
 * Live preview of the public Entity Website.
 *
 * Rendered from the same design system and the same composer that publishes, in an iframe so
 * the real cascade, responsive behaviour and imagery treatment are visible. Nothing is
 * fabricated: sections appear only when verified information exists for them.
 */
export default function LivePreview({ entityId, width = 360, height = 620 }: Props) {
  const [scale, setScale] = useState(1);
  const [loading, setLoading] = useState(true);
  const frameRef = useRef<HTMLIFrameElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  const reload = useCallback(() => {
    setLoading(true);
    const url = `/api/preview/${entityId}?t=${Date.now()}`;
    if (frameRef.current) frameRef.current.src = url;
  }, [entityId]);

  useEffect(() => {
    reload();
    const handler = (e: MessageEvent) => {
      const data = e.data as { type?: string; height?: number } | null;
      if (data?.type === 'nexora:entity-preview-height' && typeof data.height === 'number') {
        const el = frameRef.current;
        if (el) el.style.height = `${Math.min(6000, Math.max(320, data.height))}px`;
      }
    };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, [reload]);

  // Fit the fixed-width viewport into the available column.
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const measure = () => {
      const available = el.clientWidth;
      setScale(Math.min(1, Math.max(0.28, available / width)));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [width]);

  return (
    <div className="nx-stack" style={{ gap: '0.5rem' }}>
      <div className="nx-preview">
        <div className="nx-preview__bar">
          <span aria-hidden="true" className="flex gap-1">
            <span className="h-2 w-2 rounded-full bg-ink-200" />
            <span className="h-2 w-2 rounded-full bg-ink-200" />
            <span className="h-2 w-2 rounded-full bg-ink-200" />
          </span>
          <span className="min-w-0 flex-1 truncate">Preview &middot; {width}px viewport</span>
          <button type="button" className="nx-btn nx-btn--quiet nx-btn--sm" onClick={reload}>
            Refresh
          </button>
        </div>
        <div ref={wrapRef} className="relative overflow-hidden" style={{ background: '#fff' }}>
          {loading ? <div className="nx-skeleton" style={{ height: '20rem', borderRadius: 0 }} /> : null}
          <iframe
            ref={frameRef}
            title="Entity Website preview"
            className="nx-preview__frame"
            style={{
              width,
              height,
              transform: `scale(${scale})`,
              transformOrigin: 'top left',
              marginBottom: `${-(1 - scale) * height}px`,
            }}
            sandbox="allow-same-origin"
          />
        </div>
      </div>
    </div>
  );
}