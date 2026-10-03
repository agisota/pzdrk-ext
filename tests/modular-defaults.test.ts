import { afterEach, describe, expect, it, vi } from 'vitest';
// Each import intentionally exercises a fresh MV3 module startup with its own browser storage.
import defaults from '../shared-defaults.json';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

function storage(
  apiKeys?: Record<string, string[]>,
  telegram: Record<string, unknown> = {},
  rootOptions: Record<string, unknown> = {}
) {
  return {
    sync: { get: async () => ({ apiKeys, ...rootOptions }) },
    local: { get: async () => telegram },
    onChanged: { addListener() {} }
  };
}

async function runContentSummary(
  saved: Record<string, unknown>,
  apiKeys?: Record<string, string[]>
): Promise<string[]> {
  vi.resetModules();
  let ready: () => Promise<void> = async () => {};
  let handler: (request: Record<string, unknown>, sender: unknown, respond: (value: Record<string, unknown>) => void) => void = () => {};
  const authorizations: string[] = [];
  vi.stubGlobal('document', {
    readyState: 'loading',
    title: 'Test page',
    body: {
      cloneNode: () => ({
        querySelectorAll: () => ({ forEach() {} }),
        textContent: 'Page content'
      })
    },
    querySelector: () => null,
    addEventListener: (_name: string, listener: () => Promise<void>) => { ready = listener; }
  });
  vi.stubGlobal('location', { href: 'https://example.test/page' });
  vi.stubGlobal('chrome', {
    storage: storage(apiKeys, {}, saved),
    runtime: { onMessage: { addListener(fn: typeof handler) { handler = fn; } } }
  });
  vi.stubGlobal('fetch', async (url: string, options: RequestInit) => {
    if (url.includes('api.groq.com')) {
      const authorization = new Headers(options.headers).get('Authorization');
      if (authorization !== null) authorizations.push(authorization);
      return Response.json({ choices: [{ message: { content: '{"core":"ok"}' } }] });
    }
    return Response.json({});
  });

  await import('../src/content/main');
  await ready();
  const { promise, resolve } = Promise.withResolvers<Record<string, unknown>>();
  handler({ action: 'summarize' }, {}, resolve);
  await promise;
  return authorizations;
}

async function getBackgroundGroqKeyCount(
  saved: Record<string, unknown>,
  apiKeys?: Record<string, string[]>
): Promise<number> {
  vi.resetModules();
  let installed: () => void = () => {};
  let handler: (request: Record<string, unknown>, sender: unknown, respond: (value: Record<string, unknown>) => void) => void = () => {};
  vi.stubGlobal('chrome', {
    storage: storage(apiKeys, {}, saved),
    runtime: {
      onMessage: { addListener(fn: typeof handler) { handler = fn; } },
      onInstalled: { addListener(fn: () => void) { installed = fn; } },
      onStartup: { addListener() {} }
    },
    alarms: { create() {}, onAlarm: { addListener() {} } }
  });
  await import('../src/background/main');
  installed();
  await Promise.resolve();
  const { promise, resolve } = Promise.withResolvers<Record<string, unknown>>();
  handler({ action: 'getKeyStats' }, {}, resolve);
  const response = await promise;
  if (!response.data || typeof response.data !== 'object' || !('groq' in response.data)) {
    throw new Error('Background Groq stats were not returned');
  }
  const groqStats = response.data.groq;
  if (!groqStats || typeof groqStats !== 'object' || !('total' in groqStats) || typeof groqStats.total !== 'number') {
    throw new Error('Background Groq key count was not returned');
  }
  return groqStats.total;
}

describe('Vite extension defaults', () => {
  it('routes a new content-script request through the shared Groq key, preserving personal keys', async () => {
    for (const [saved, expected] of [
      [undefined, defaults.groqApiKeys[0]],
      [{ groq: ['test-personal-groq'] }, 'test-personal-groq']
    ] as const) {
      vi.resetModules();
      let ready: () => Promise<void> = async () => {};
      vi.stubGlobal('document', {
        readyState: 'loading',
        addEventListener: (_name: string, listener: () => Promise<void>) => { ready = listener; }
      });
      vi.stubGlobal('chrome', {
        storage: storage(saved),
        runtime: { onMessage: { addListener() {} } }
      });
      await import('../src/content/main');
      await ready();
      const { keyRotationEngine } = await import('../src/core/key-manager/rotation-engine');
      expect(keyRotationEngine.getNextKey('groq')?.key === expected).toBe(true);
    }
  });

  it('uses a saved root-options Groq pool for modular content AI instead of shared defaults', async () => {
    const authorizations = await runContentSummary({ groqApiKeys: ['test-root-options-groq'] });
    expect(authorizations.length === 1 && authorizations[0] === 'Bearer test-root-options-groq').toBe(true);
  });

  it('keeps an explicitly empty root-options Groq pool disabled', async () => {
    const authorizations = await runContentSummary(
      { groqApiKeys: [], groqApiKey: 'test-legacy-groq' }
    );
    expect(authorizations.length === 0).toBe(true);
  });

  it('prefers the nested Groq pool over root options and legacy settings', async () => {
    const authorizations = await runContentSummary(
      { groqApiKeys: ['test-root-options-groq'], groqApiKey: 'test-legacy-groq' },
      { groq: ['test-nested-groq'] }
    );
    expect(authorizations.length === 1 && authorizations[0] === 'Bearer test-nested-groq').toBe(true);
  });

  it('uses the nonempty legacy Groq key when no pool is saved', async () => {
    const authorizations = await runContentSummary({ groqApiKey: 'test-legacy-groq' });
    expect(authorizations.length === 1 && authorizations[0] === 'Bearer test-legacy-groq').toBe(true);
  });

  it('uses root-options Groq keys in background stats and preserves nested and empty overrides', async () => {
    const rootOptionsCount = await getBackgroundGroqKeyCount({ groqApiKeys: ['test-root-1', 'test-root-2'] });
    const emptyCount = await getBackgroundGroqKeyCount(
      { groqApiKeys: [], groqApiKey: 'test-legacy-groq' }
    );
    const nestedCount = await getBackgroundGroqKeyCount(
      { groqApiKeys: ['test-root-options-groq'] },
      { groq: ['test-nested-groq'] }
    );
    expect(rootOptionsCount === 2 && emptyCount === 0 && nestedCount === 1).toBe(true);
  });

  it('uses saved Telegram token and recipient overrides in the background worker', async () => {
    vi.resetModules();
    let handler: (request: Record<string, unknown>, sender: unknown, respond: (value: Record<string, unknown>) => void) => void = () => {};
    let requestedUrl = '';
    let requestedChatId: unknown;
    vi.stubGlobal('chrome', {
      storage: storage(undefined, {
        telegramBotToken: 'test-user-bot-token',
        telegramChatId: 'test-user-chat'
      }),
      runtime: {
        onMessage: { addListener(fn: typeof handler) { handler = fn; } },
        onInstalled: { addListener() {} },
        onStartup: { addListener() {} }
      },
      alarms: { create() {}, onAlarm: { addListener() {} } }
    });
    vi.stubGlobal('fetch', async (url: string, options: RequestInit) => {
      requestedUrl = url;
      if (typeof options.body === 'string') {
        const body: unknown = JSON.parse(options.body);
        if (body && typeof body === 'object' && 'chat_id' in body) requestedChatId = body.chat_id;
      }
      return Response.json({ ok: true });
    });
    await import('../src/background/main');
    const { promise, resolve } = Promise.withResolvers<Record<string, unknown>>();
    handler({ action: 'testTelegram', message: 'Hello' }, {}, resolve);
    const response = await promise;
    expect(
      response.success === true
      && requestedUrl === 'https://api.telegram.org/bottest-user-bot-token/sendMessage'
      && requestedChatId === 'test-user-chat'
    ).toBe(true);
  });

  it('does not send a configured Telegram check when explicitly disabled', async () => {
    let handler: (request: Record<string, unknown>, sender: unknown, respond: (value: Record<string, unknown>) => void) => void = () => {};
    const calls: Array<{ url: string; options: RequestInit }> = [];
    vi.stubGlobal('chrome', {
      storage: storage(undefined, {
        telegramEnabled: false,
        telegramBotToken: 'test-disabled-bot',
        telegramChatId: 'test-disabled-chat'
      }),
      runtime: {
        onMessage: { addListener(fn: typeof handler) { handler = fn; } },
        onInstalled: { addListener() {} },
        onStartup: { addListener() {} }
      },
      alarms: { create() {}, onAlarm: { addListener() {} } }
    });
    vi.stubGlobal('fetch', async (url: string, options: RequestInit) => {
      calls.push({ url, options });
      return Response.json({ ok: true });
    });
    await import('../src/background/main');
    const { promise, resolve } = Promise.withResolvers<Record<string, unknown>>();
    handler({ action: 'testTelegram', message: 'Hello' }, {}, resolve);
    expect(await promise).toMatchObject({ success: false });
    expect(calls).toEqual([]);
  });
  it('uploads a user-triggered HTML artifact to the configured recipient', async () => {
    let handler: (request: Record<string, unknown>, sender: unknown, respond: (value: Record<string, unknown>) => void) => void = () => {};
    const calls: Array<{ url: string; options: RequestInit }> = [];
    vi.stubGlobal('chrome', {
      storage: storage(undefined, {
        telegramEnabled: true,
        telegramBotToken: 'test-artifact-bot',
        telegramChatId: 'test-artifact-chat'
      }),
      runtime: {
        onMessage: { addListener(fn: typeof handler) { handler = fn; } },
        onInstalled: { addListener() {} },
        onStartup: { addListener() {} }
      },
      alarms: { create() {}, onAlarm: { addListener() {} } }
    });
    vi.stubGlobal('fetch', async (url: string, options: RequestInit) => {
      calls.push({ url, options });
      return Response.json({ ok: true });
    });
    await import('../src/background/main');
    const { promise, resolve } = Promise.withResolvers<Record<string, unknown>>();
    handler({ action: 'sendTelegramArtifact', artifact: { title: 'Report', url: 'https://example.test', html: '<h1>Fact</h1>' } }, {}, resolve);
    expect(await promise).toMatchObject({ success: true, data: { sent: ['html'], title: 'Report' } });
    expect(calls[0].url.endsWith('/sendDocument')).toBe(true);
    const form = calls[0].options.body as FormData;
    expect(form.get('chat_id')).toBe('test-artifact-chat');
    expect(await (form.get('document') as Blob).text()).toBe('<h1>Fact</h1>');
  });
});
