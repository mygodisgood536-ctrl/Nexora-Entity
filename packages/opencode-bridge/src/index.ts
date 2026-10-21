/**
 * Public surface for the application.
 *
 * `./supervisor` is deliberately excluded: it spawns a local `opencode serve` process and must
 * not be reachable from the web application. Development scripts import it explicitly as
 * `@nexora/opencode-bridge/supervisor`.
 */
export * from './server';
export * from './discovery';
export * from './ops';
export * from './failure';
// The Console transport is part of the application-facing surface: the platform has to be able to
// report which bridge it is talking to, and the configuration itself decides the transport.
export { isConsoleTransport, consoleBase, inferenceBase } from './console';