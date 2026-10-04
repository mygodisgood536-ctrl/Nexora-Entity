/**
 * Nexora Entity Website Design System — browser-safe entry point.
 *
 * Deliberately does NOT re-export `./render`: that module uses `react-dom/server` and must
 * only ever be imported from a server route. Keeping it out of the barrel means a client
 * component can use the design system and the composer without pulling in a server renderer.
 */

export * from './model';
export * from './compose';
export * from './components';
export * from './meta';