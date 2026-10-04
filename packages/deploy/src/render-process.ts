/**
 * Runs the single static renderer as its own Node process.
 *
 * The public Entity Website is always produced by the same renderer, whether it is being
 * previewed inside the platform or published. If the renderer cannot be started, that is
 * reported honestly — the platform never substitutes placeholder markup for a real render.
 */

import { execFile } from 'node:child_process';
import { accessSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createLogger, NexoraError } from '@nexora/core';

const log = createLogger('deploy:renderer');

const here = path.dirname(fileURLToPath(import.meta.url));
const RENDER_CLI = path.resolve(here, '..', '..', 'entity-site', 'src', 'render-cli.ts');

export interface RenderRequest {
  model: unknown;
  stylesheetText: string;
  jsonLd: unknown[] | null;
  title: string;
  description: string;
  canonicalUrl: string;
  robots: string;
  openGraph: Record<string, string>;
  twitter: Record<string, string>;
  previewBridge?: boolean;
}

function findTsxLoader(): string | null {
  const candidates = [
    path.resolve(here, '..', '..', '..', 'node_modules', 'tsx', 'dist', 'loader.mjs'),
    path.resolve(here, '..', '..', 'node_modules', 'tsx', 'dist', 'loader.mjs'),
  ];
  for (const c of candidates) {
    try {
      accessSync(c);
      return c;
    } catch {
      /* try the next candidate */
    }
  }
  return null;
}

/** Render the entity site to a complete HTML document. */
export function renderEntityHtmlSync(request: RenderRequest): Promise<string> {
  return new Promise((resolve, reject) => {
    const loader = findTsxLoader();
    if (!loader) {
      reject(
        new NexoraError({
          code: 'renderer_unavailable',
          domain: 'system',
          message:
            'The Entity Website renderer could not be started, so nothing was published. Your information is unchanged.',
          detail: 'The tsx loader could not be located. Run npm install in the project root.',
          retryable: true,
          remediation: [{ kind: 'retry', label: 'Try again', primary: true }],
        }),
      );
      return;
    }

    const args = ['--import', 'tsx', RENDER_CLI];
    const child = execFile(
      process.execPath,
      args,
      {
        cwd: path.resolve(here, '..', '..'),
        maxBuffer: 64 * 1024 * 1024,
        env: { ...process.env, NODE_NO_WARNINGS: '1' },
        timeout: 120_000,
      },
      (error, stdout, stderr) => {
        if (error) {
          log.error('static renderer failed', { message: error.message, stderr: stderr.slice(0, 800) });
          reject(
            new NexoraError({
              code: 'renderer_failed',
              domain: 'system',
              message:
                'The Entity Website renderer did not complete, so nothing was published. Your information is unchanged.',
              detail: stderr.slice(0, 1500) || error.message,
              retryable: true,
              remediation: [{ kind: 'retry', label: 'Try again', primary: true }],
              cause: error,
            }),
          );
          return;
        }
        if (!stdout || stdout.length < 200) {
          reject(
            new NexoraError({
              code: 'renderer_empty_output',
              domain: 'system',
              message: 'The Entity Website renderer produced no output, so nothing was published.',
              retryable: true,
              remediation: [{ kind: 'retry', label: 'Try again', primary: true }],
            }),
          );
          return;
        }
        resolve(stdout);
      },
    );

    child.stdin?.end(JSON.stringify({ ...request, previewBridge: request.previewBridge ?? false }));
  });
}