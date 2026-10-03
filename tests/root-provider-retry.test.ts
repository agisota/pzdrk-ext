import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { afterEach, describe, expect, it, vi } from 'vitest';

const workerSource = readFileSync(new URL('../background.js', import.meta.url), 'utf8');
type Settings = Record<string, unknown>;
type RequestRecord = { url: string; options: RequestInit };
type ApiResponse = { status: number; body: unknown; headers?: Record<string, string> };

function startWorker(
  settings: Settings,
  respondToApi: (request: RequestRecord) => ApiResponse | Promise<ApiResponse>
) {
  let listener: (request: Settings, sender: Settings, respond: (value: Settings) => void) => boolean | void = () => {};
  const requests: RequestRecord[] = [];
  const storage = {
    get: async (keys: string | string[]) => {
      const names = Array.isArray(keys) ? keys : [keys];
      return Object.fromEntries(names.filter(name => Object.hasOwn(settings, name)).map(name => [name, settings[name]]));
    }
  };
  const chrome = {
    runtime: {
      getURL: (name: string) => `chrome-extension://test/${name}`,
      onInstalled: { addListener() {} },
      onMessage: { addListener(fn: typeof listener) { listener = fn; } }
    },
    storage: { sync: storage, local: storage, onChanged: { addListener() {} } },
    contextMenus: { create() {}, onClicked: { addListener() {} } },
    declarativeNetRequest: { updateEnabledRulesets: async () => {}, onRuleMatchedDebug: { addListener() {} } },
    tabs: { query(_query: Settings, callback: (tabs: Settings[]) => void) { callback([]); }, sendMessage() {} }
  };
  const fetch = async (url: string, options: RequestInit = {}) => {
    if (url.endsWith('/shared-defaults.json')) return Response.json({ groqApiKeys: [] });
    if (url.endsWith('/local-overrides.json')) return new Response(null, { status: 404 });
    const request = { url, options };
    requests.push(request);
    const result = await respondToApi(request);
    return Response.json(result.body, { status: result.status, headers: result.headers });
  };

  runInNewContext(workerSource, { chrome, fetch, Date, AbortController, URL, Response, Blob, FormData, setTimeout, clearTimeout, console });
  const message = (request: Settings) => new Promise<Settings>(resolve => listener(request, {}, resolve));
  return { message, requests };
}

const call = { action: 'callGroq', prompt: 'test prompt', systemPrompt: 'test system' };
const ok = (content = 'provider reply'): ApiResponse => ({
  status: 200,
  body: { choices: [{ message: { content } }] }
});
const failed = (status: number, message: string, headers: Record<string, string> = {}): ApiResponse => ({
  status,
  body: { error: { message } },
  headers
});
const authorization = (request: RequestRecord) => new Headers(request.options.headers).get('Authorization');

afterEach(() => vi.useRealTimers());

describe('root background provider retry behavior', () => {
  it('rotates away from a key with an unusable token quota', async () => {
    const worker = startWorker({ coreProvider: 'groq', groqApiKeys: ['quota-key', 'valid-key'] }, request =>
      authorization(request) === 'Bearer quota-key' ? failed(413, 'Token quota limit 1 exceeded') : ok('valid quota reply')
    );
    expect(await worker.message(call)).toEqual({ success: true, data: 'valid quota reply' });
    expect(worker.requests.map(authorization)).toEqual(['Bearer quota-key', 'Bearer valid-key']);
  });

  it.each([
    ['explicitly selected', { model: 'groq/compound', modelGroq: 'groq/compound' }, 'groq/compound']
  ])('sends the %s Compound model unchanged and returns its API error', async (_selection, modelSettings, expectedModel) => {
    const worker = startWorker({
      coreProvider: 'groq',
      groqApiKeys: ['groq-key'],
      cerebrasApiKeys: ['cerebras-key'],
      ...modelSettings
    }, request => {
      const payload = JSON.parse(String(request.options.body));
      expect(payload.model).toBe(expectedModel);
      expect(payload.messages).toEqual([
        { role: 'system', content: 'test system' },
        { role: 'user', content: 'test prompt' }
      ]);
      return failed(404, 'Model is no longer available');
    });

    expect(await worker.message(call)).toEqual({ success: false, error: 'Model is no longer available' });
    expect(worker.requests.map(request => request.url)).toEqual([
      'https://api.groq.com/openai/v1/chat/completions'
    ]);
  });

  it('does not replace Compound with Cerebras after an authorization failure', async () => {
    const worker = startWorker({ coreProvider: 'groq', modelGroq: 'groq/compound', groqApiKeys: ['rejected'], cerebrasApiKeys: ['other-provider'] },
      request => request.url.includes('api.groq.com') ? failed(401, 'Invalid Groq key') : ok('unexpected replacement'));
    expect(await worker.message(call)).toEqual({ success: false, error: 'Invalid Groq key' });
    expect(worker.requests.every(request => request.url.includes('api.groq.com'))).toBe(true);
  });

  it('returns the provider unauthorized error when the only key is rejected', async () => {
    vi.useFakeTimers();
    const worker = startWorker({ coreProvider: 'groq', groqApiKeys: ['rejected-key'] }, () => failed(401, 'Invalid API key'));

    const resultPromise = worker.message(call);
    await vi.runAllTimersAsync();
    const result = await resultPromise;

    expect(result).toMatchObject({ success: false, error: 'Invalid API key' });
    expect(worker.requests).toHaveLength(1);
    expect(authorization(worker.requests[0])).toBe('Bearer rejected-key');
  });

  it('preserves the provider rate-limit reason after exhausting retry attempts', async () => {
    vi.useFakeTimers();
    const reason = 'Rate limit reached for this organization; retry after quota reset';
    const worker = startWorker({ coreProvider: 'groq', groqApiKeys: ['limited-key'] }, () => failed(429, reason, { 'retry-after': '30' }));

    const resultPromise = worker.message(call);
    await vi.runAllTimersAsync();
    const result = await resultPromise;

    expect(result).toMatchObject({ success: false, error: reason });
    expect(worker.requests).toHaveLength(1);
  });

  it('retries after a brief rate-limit cooldown without spending an HTTP attempt on the wait', async () => {
    vi.useFakeTimers();
    let attempts = 0;
    const worker = startWorker({ coreProvider: 'groq', groqApiKeys: ['briefly-limited-key'] }, () => {
      attempts++;
      return attempts === 1 ? failed(429, 'Brief rate limit', { 'retry-after': '0.1' }) : ok('recovered');
    });

    const resultPromise = worker.message(call);
    await vi.runAllTimersAsync();
    const result = await resultPromise;

    expect(result).toEqual({ success: true, data: 'recovered' });
    expect(worker.requests).toHaveLength(2);
    expect(worker.requests.map(authorization)).toEqual(['Bearer briefly-limited-key', 'Bearer briefly-limited-key']);
  });

  it('rotates from an unauthorized key to the next valid key', async () => {
    vi.useFakeTimers();
    const worker = startWorker({ coreProvider: 'groq', groqApiKeys: ['rejected-key', 'valid-key'] }, request =>
      authorization(request) === 'Bearer rejected-key' ? failed(401, 'Invalid API key') : ok('second key worked')
    );

    const result = await worker.message(call);

    expect(result).toEqual({ success: true, data: 'second key worked' });
    expect(worker.requests.map(authorization)).toEqual(['Bearer rejected-key', 'Bearer valid-key']);
  });

  it('falls back to Cerebras when Groq cannot complete the request', async () => {
    vi.useFakeTimers();
    const worker = startWorker({
      coreProvider: 'groq',
      modelGroq: 'llama-3.3-70b-versatile',
      groqApiKeys: ['groq-key'],
      cerebrasApiKeys: ['cerebras-key']
    }, request => request.url.includes('api.groq.com')
      ? failed(503, 'Groq temporarily unavailable')
      : ok('Cerebras fallback worked'));

    const resultPromise = worker.message(call);
    await vi.runAllTimersAsync();
    const result = await resultPromise;

    expect(result).toEqual({ success: true, data: 'Cerebras fallback worked' });
    expect(worker.requests.map(request => request.url)).toEqual([
      'https://api.groq.com/openai/v1/chat/completions',
      'https://api.groq.com/openai/v1/chat/completions',
      'https://api.cerebras.ai/v1/chat/completions'
    ]);
    expect(worker.requests.map(authorization)).toEqual(['Bearer groq-key', 'Bearer groq-key', 'Bearer cerebras-key']);
  });

  it('returns retry guidance promptly when every key is cooling down', async () => {
    vi.useFakeTimers();
    const worker = startWorker({ coreProvider: 'groq', groqApiKeys: ['cooling-key'] }, () =>
      failed(429, 'Provider quota is exhausted', { 'retry-after': '60' })
    );

    const firstRequest = worker.message(call);
    await vi.runAllTimersAsync();
    await firstRequest;
    const callsBeforeCooldownRequest = worker.requests.length;
    const start = Date.now();
    let resolvedAt: number | null = null;
    let hasResolved = false;
    const coolingRequest = worker.message(call).then(result => {
      hasResolved = true;
      resolvedAt = Date.now();
      return result;
    });
    await vi.advanceTimersByTimeAsync(0);
    if (!hasResolved) await vi.runAllTimersAsync();
    const result = await coolingRequest;

    expect(resolvedAt).not.toBeNull();
    expect((resolvedAt as number) - start).toBeLessThan(1000);
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/cool|retry|60|quota/i);
    expect(worker.requests).toHaveLength(callsBeforeCooldownRequest);

  });
});
