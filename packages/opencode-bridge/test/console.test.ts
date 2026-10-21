/**
 * Console transport tests (spec §5, §2).
 *
 * The OpenCode Console is a different bridge from a running `opencode serve` instance, and a
 * Console service-account key is not interchangeable with a serve-server token. These tests pin the
 * transport selection and the workspace-configuration mapping, so the platform reports what
 * OpenCode actually exposes and never a hard-coded list.
 */

import { afterEach, describe, expect, it } from 'vitest';

import { config, resetConfig } from '@nexora/core/config';
import {
  consoleBase,
  inferenceBase,
  isConsoleTransport,
  type ConsoleConfig,
} from '../src/console';

const ORIGINAL = { ...process.env };

afterEach(() => {
  process.env = { ...ORIGINAL };
  resetConfig();
});

function configure(url: string | undefined, inference?: string) {
  if (url === undefined) delete process.env.NEXORA_OPENCODE_URL;
  else process.env.NEXORA_OPENCODE_URL = url;
  if (inference === undefined) delete process.env.NEXORA_OPENCODE_INFERENCE_URL;
  else process.env.NEXORA_OPENCODE_INFERENCE_URL = inference;
  resetConfig();
}

describe('console transport selection', () => {
  it('selects the serve-server transport when no URL is configured', () => {
    configure(undefined);
    expect(isConsoleTransport()).toBe(false);
  });

  it('selects the serve-server transport for a self-hosted bridge', () => {
    configure('https://opencode.internal.example');
    expect(isConsoleTransport()).toBe(false);
  });

  it('selects the serve-server transport for a local bridge', () => {
    configure('http://127.0.0.1:4137');
    expect(isConsoleTransport()).toBe(false);
  });

  it('selects the Console transport for the hosted Console', () => {
    configure('https://opencode.ai/console');
    expect(isConsoleTransport()).toBe(true);
  });

  it('selects the Console transport for the development Console', () => {
    configure('https://dev.opencode.ai/console');
    expect(isConsoleTransport()).toBe(true);
  });

  it('does not select the Console transport for a different host on the same path', () => {
    configure('https://example.com/console');
    expect(isConsoleTransport()).toBe(false);
  });
});

describe('console bases', () => {
  it('uses the configured Console URL without a trailing slash', () => {
    configure('https://opencode.ai/console/');
    expect(consoleBase()).toBe('https://opencode.ai/console');
  });

  it('derives the inference gateway from the Console origin', () => {
    configure('https://opencode.ai/console');
    expect(inferenceBase()).toBe('https://opencode.ai/inference');
  });

  it('allows the inference gateway to be set explicitly', () => {
    configure('https://opencode.ai/console', 'https://gateway.internal.example/v1/');
    expect(inferenceBase()).toBe('https://gateway.internal.example/v1');
  });
});

describe('console configuration shape', () => {
  it('reads the workspace providers and models', () => {
    const workspace: ConsoleConfig = {
      providers: {
        opencode: {
          name: 'Personal / OpenCode',
          headers: { 'x-opencode-org-id': 'org_example' },
          models: {
            'model-a': { package: 'aisdk:@ai-sdk/openai-compatible' },
            'model-b': { disabled: true },
          },
        },
      },
    };
    expect(Object.keys(workspace.providers ?? {})).toEqual(['opencode']);
    expect(workspace.providers?.opencode?.models?.['model-b']?.disabled).toBe(true);
    expect(workspace.providers?.opencode?.headers?.['x-opencode-org-id']).toBe('org_example');
  });
});

describe('config', () => {
  it('exposes the inference gateway setting', () => {
    configure('https://opencode.ai/console', 'https://gateway.internal.example');
    expect(config().opencodeInferenceUrl).toBe('https://gateway.internal.example');
  });
});
