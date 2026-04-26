// ============ @pzdrk v6.3 Background Service Worker ============

// Defaults (built-in). BYOK/local overrides can extend these.
const DEFAULT_EXA_KEY = 'bebe84f2-7740-4b67-b9d6-91edbecb080f';
const XAI_VOICE_KEY = 'xai-GIuMtBSOO3KnHNYgmd69NFdzLIDCuo6ZjJ23q3Sbe3fjEtbHLte15KHNaB27k88O5E4v7k3CPSckQMxf';
const SLACK_WEBHOOK = 'https://hooks.slack.com/triggers/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';
const LOCAL_OVERRIDES_FILE = 'local-overrides.json';
const DEFAULT_GROQ_MODEL = 'groq/compound';
const DEFAULT_CEREBRAS_MODEL = 'gpt-oss-120b';
const MAX_OUTPUT_TOKENS = 8192;
const DEFAULT_REQUEST_MAX_TOKENS = 1800;
const DEFAULT_BATCH_MAX_TOKENS = 1800;
const TRANSIENT_KEY_COOLDOWN_MS = 1500;
const GENERIC_REQUEST_COOLDOWN_MS = 20_000;
const AUTH_KEY_COOLDOWN_MS = 24 * 60 * 60 * 1000;
const BROKEN_KEY_COOLDOWN_MS = 24 * 60 * 60 * 1000;
const MAX_KEY_COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000;

// LLM Providers
const GROQ_CHAT_COMPLETIONS_URL = 'https://api.groq.com/openai/v1/chat/completions';
const CEREBRAS_CHAT_COMPLETIONS_URL = 'https://api.cerebras.ai/v1/chat/completions';

const PROVIDER_STATE = {
  groq: { rrIndex: 0, cooldownUntilByKey: new Map() },
  cerebras: { rrIndex: 0, cooldownUntilByKey: new Map() }
};

const TRACKER_RULESET_ID = 'pzdrk_blocklist';

// Tracker stats
let trackerStats = { blocked: 0, domains: new Set() };
let localOverridesPromise = null;

async function syncPrivacyRuleset() {
  try {
    const settings = await chrome.storage.sync.get(['privacyEnabled']);
    const enabled = settings.privacyEnabled !== false;
    await chrome.declarativeNetRequest.updateEnabledRulesets({
      enableRulesetIds: enabled ? [TRACKER_RULESET_ID] : [],
      disableRulesetIds: enabled ? [] : [TRACKER_RULESET_ID]
    });
  } catch (e) {
    // Best effort
  }
}

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== 'sync') return;
  if (changes.privacyEnabled) syncPrivacyRuleset();
});

// Apply on startup
syncPrivacyRuleset();

chrome.declarativeNetRequest.onRuleMatchedDebug?.addListener((info) => {
  trackerStats.blocked++;
  try { trackerStats.domains.add(new URL(info.request.url).hostname); } catch (e) { }
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (tabs[0]?.id) chrome.tabs.sendMessage(tabs[0].id, { action: 'trackerBlocked' }).catch(() => { });
  });
});

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({ id: 'pzdrkExplain', title: '✦ pzdrk: Объяснить', contexts: ['selection'] });
  chrome.contextMenus.create({ id: 'pzdrkTranslate', title: '✦ pzdrk: Перевести', contexts: ['selection'] });
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  const actions = { 'pzdrkExplain': 'explainSelection', 'pzdrkTranslate': 'translateSelection' };
  if (actions[info.menuItemId]) chrome.tabs.sendMessage(tab.id, { action: actions[info.menuItemId], text: info.selectionText });
});

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  const handlers = {
    'callGroq': () => handleGroqCall(request.prompt, request.systemPrompt, request.options),
    'callGroqBatch': () => handleGroqBatchCall(request.items, request.systemPrompt, request.options),
    'searchExa': () => handleExaSearch(request.query),
    'transcribeAudio': () => handleWhisperTranscription(request.audioBlob),
    'speakGrok': () => handleGrokVoice(request.text),
    'xaiRealtimeClientSecret': () => handleXaiRealtimeClientSecret(request.ttlSeconds),
    'fetchUrlMeta': () => handleFetchUrlMeta(request.url),
    'sendSlack': () => handleSlackSend(request.data),
    'getBrowserContext': () => handleGetBrowserContext({ days: request.days, hours: request.hours }),
    'getTrackerStats': () => Promise.resolve({ blocked: trackerStats.blocked, domains: Array.from(trackerStats.domains).slice(0, 20) }),
    'resetTrackerStats': () => { trackerStats = { blocked: 0, domains: new Set() }; return Promise.resolve(true); }
  };

  const handler = handlers[request.action];
  if (handler) {
    handler()
      .then(result => sendResponse({ success: true, data: result }))
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true;
  }
});

// ============ XAI REALTIME (EPHEMERAL TOKEN) ============

let xaiRealtimeSecretCache = { value: '', expiresAt: 0 };

async function handleXaiRealtimeClientSecret(ttlSecondsParam) {
  const settings = await chrome.storage.sync.get(['voiceApiKey', 'voiceProvider', 'byokMode']);
  const provider = String(settings.voiceProvider || 'xai');
  if (provider !== 'xai') throw new Error('Voice provider is not xAI');

  const ttlSecondsRaw = Number(ttlSecondsParam);
  const ttlSeconds = Number.isFinite(ttlSecondsRaw) ? Math.max(30, Math.min(3600, ttlSecondsRaw)) : 300;

  const now = Date.now();
  if (xaiRealtimeSecretCache.value && now < xaiRealtimeSecretCache.expiresAt) {
    return { value: xaiRealtimeSecretCache.value, expires_at_ms: xaiRealtimeSecretCache.expiresAt };
  }

  const apiKey = String((settings.byokMode ? settings.voiceApiKey : '') || XAI_VOICE_KEY || '').trim();
  if (!apiKey) throw new Error('Missing xAI API key');

  const response = await fetchWithTimeout('https://api.x.ai/v1/realtime/client_secrets', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    },
    body: JSON.stringify({ expires_after: { seconds: ttlSeconds } })
  }, 20000);

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    const msg = err?.error?.message || err?.message || `Status ${response.status}`;
    throw new Error(msg);
  }

  const data = await response.json().catch(() => ({}));
  const value = String(data.value || data.token || data.secret || '').trim();
  if (value) {
    xaiRealtimeSecretCache = { value, expiresAt: now + (ttlSeconds * 1000) - 5000 };
    return { ...data, value, expires_at_ms: xaiRealtimeSecretCache.expiresAt };
  }

  // Fallback to returning raw response if schema differs.
  return data;
}

// ============ GROQ LLM API ============

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeKeyList(value) {
  if (Array.isArray(value)) {
    return value.map(v => String(v || '').trim()).filter(Boolean);
  }
  return String(value || '')
    .split(/\r?\n/)
    .map(s => s.trim())
    .filter(Boolean);
}

function dedupeStrings(list) {
  return Array.from(new Set((Array.isArray(list) ? list : []).map(v => String(v || '').trim()).filter(Boolean)));
}

async function loadLocalOverrides() {
  if (!localOverridesPromise) {
    localOverridesPromise = fetch(chrome.runtime.getURL(LOCAL_OVERRIDES_FILE), { cache: 'no-store' })
      .then(async (response) => {
        if (!response.ok) return null;
        const parsed = await response.json().catch(() => null);
        return parsed && typeof parsed === 'object' ? parsed : null;
      })
      .catch(() => null);
  }

  return localOverridesPromise;
}

function applyLocalOverrides(settings, overrides) {
  if (!overrides || typeof overrides !== 'object') return settings;

  const next = { ...settings };

  const groqApiKeys = dedupeStrings(normalizeKeyList(overrides.groqApiKeys));
  const cerebrasApiKeys = dedupeStrings(normalizeKeyList(overrides.cerebrasApiKeys));

  if (groqApiKeys.length) next.groqApiKeys = groqApiKeys;
  if (cerebrasApiKeys.length) next.cerebrasApiKeys = cerebrasApiKeys;

  for (const key of ['coreProvider', 'model', 'modelGroq', 'modelCerebras']) {
    const value = String(overrides[key] || '').trim();
    if (value) next[key] = value;
  }

  for (const key of ['maxParallelRequests', 'targetMaxOutputTokens', 'prefetchDelayMs']) {
    const value = Number(overrides[key]);
    if (Number.isFinite(value)) next[key] = value;
  }

  for (const key of ['byokMode', 'prefetchOnHover', 'mapReduceEnabled', 'twoColumnSummary']) {
    if (typeof overrides[key] === 'boolean') next[key] = overrides[key];
  }

  if (groqApiKeys.length || cerebrasApiKeys.length) {
    next.byokMode = true;
  }

  return next;
}

async function getMergedSettings(keys) {
  const settings = await chrome.storage.sync.get(keys);
  return applyLocalOverrides(settings, await loadLocalOverrides());
}

function normalizeProvider(p) {
  const s = String(p || '').trim().toLowerCase();
  if (s === 'cerebras') return 'cerebras';
  return 'groq';
}

function isKnownCerebrasModelId(id) {
  const s = String(id || '').trim();
  return [
    'gpt-oss-120b',
    'llama3.1-8b',
    'llama-3.3-70b',
    'qwen-3-32b',
    'qwen-3-235b-a22b-instruct-2507',
    'zai-glm-4.6'
  ].includes(s);
}

function isDeprecatedGroqModelId(id) {
  return [
    '',
    'compound',
    'moonshotai/kimi-k2-instruct',
    'moonshotai/kimi-k2-instruct-0905'
  ].includes(String(id || '').trim());
}

function getModelForProvider(settings, provider) {
  if (provider === 'cerebras') {
    const explicit = String(settings.modelCerebras || '').trim();
    if (explicit) return explicit;
    const shared = String(settings.model || '').trim();
    return isKnownCerebrasModelId(shared) ? shared : DEFAULT_CEREBRAS_MODEL;
  }
  const explicit = String(settings.modelGroq || '').trim();
  if (explicit && !isDeprecatedGroqModelId(explicit)) return explicit;
  const shared = String(settings.model || '').trim();
  if (!shared || isKnownCerebrasModelId(shared) || isDeprecatedGroqModelId(shared)) {
    return DEFAULT_GROQ_MODEL;
  }
  return shared;
}

function getKeysForProvider(settings, provider) {
  if (provider === 'cerebras') {
    return dedupeStrings(normalizeKeyList(settings.cerebrasApiKeys));
  }

  const list = dedupeStrings(normalizeKeyList(settings.groqApiKeys));
  if (list.length) return list;
  const legacy = String(settings.groqApiKey || '').trim();
  return legacy ? [legacy] : [];
}

function parseDurationToMs(raw) {
  const s = String(raw || '').trim();
  if (!s) return 0;
  // Formats seen: "7.66s", "2m59.56s"
  const m = s.match(/^(?:(\d+(?:\.\d+)?)m)?(?:(\d+(?:\.\d+)?)s)?$/i);
  if (m) {
    const mm = Number(m[1] || 0);
    const ss = Number(m[2] || 0);
    const total = (mm * 60 + ss) * 1000;
    return Number.isFinite(total) ? Math.max(0, Math.round(total)) : 0;
  }
  const asNum = Number(s);
  if (Number.isFinite(asNum)) return Math.max(0, Math.round(asNum * 1000));
  return 0;
}

function getRetryAfterMs(response) {
  const ra = response.headers.get('retry-after');
  const raNum = Number(ra);
  if (Number.isFinite(raNum) && raNum > 0) return Math.round(raNum * 1000);
  const cerebrasReset = response.headers.get('x-ratelimit-reset-tokens-minute');
  const cerNum = Number(cerebrasReset);
  if (Number.isFinite(cerNum) && cerNum > 0) return Math.round(cerNum * 1000);
  const groqResetTokens = response.headers.get('x-ratelimit-reset-tokens');
  const ms = parseDurationToMs(groqResetTokens);
  if (ms > 0) return ms;
  return 1200;
}

function pickNextKey(provider, keys) {
  const state = PROVIDER_STATE[provider] || PROVIDER_STATE.groq;
  const now = Date.now();

  if (!keys.length) return { key: '', waitMs: 0 };

  for (let i = 0; i < keys.length; i++) {
    const idx = (state.rrIndex + i) % keys.length;
    const key = keys[idx];
    const until = Number(state.cooldownUntilByKey.get(key) || 0);
    if (!until || until <= now) {
      state.rrIndex = (idx + 1) % keys.length;
      return { key, waitMs: 0 };
    }
  }

  // All keys are cooling down.
  let earliest = Infinity;
  for (const k of keys) {
    const until = Number(state.cooldownUntilByKey.get(k) || 0);
    if (until && until < earliest) earliest = until;
  }

  const waitMs = Number.isFinite(earliest) ? Math.max(0, earliest - now) : 0;
  return { key: '', waitMs };
}

function markKeyCooldown(provider, key, ms) {
  const state = PROVIDER_STATE[provider] || PROVIDER_STATE.groq;
  if (!key) return;
  const until = Date.now() + Math.max(0, Math.min(MAX_KEY_COOLDOWN_MS, Math.round(ms || 0)));
  state.cooldownUntilByKey.set(key, until);
}

function getErrorMessageText(error) {
  return String(error?.message || '').trim();
}

function shouldQuarantineKey(provider, error) {
  const status = Number(error?.status || 0);
  const message = getErrorMessageText(error);

  if (status === 401 || status === 403) return true;
  if (/invalid[_\s-]?api[_\s-]?key|expired[_\s-]?api[_\s-]?key/i.test(message)) return true;
  if (provider === 'groq' && status === 413 && /\blimit\s*1\b/i.test(message)) return true;

  return false;
}

async function callChatCompletions(provider, apiKey, payload, timeoutMs = 90000) {
  const url = provider === 'cerebras' ? CEREBRAS_CHAT_COMPLETIONS_URL : GROQ_CHAT_COMPLETIONS_URL;
  const response = await fetchWithTimeout(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
    body: JSON.stringify(payload)
  }, timeoutMs);

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    const msg = err?.error?.message || err?.message || `API Error: ${response.status}`;
    const e = new Error(msg);
    e.status = response.status;
    if (response.status === 429) e.retryAfterMs = getRetryAfterMs(response);
    throw e;
  }

  const result = await response.json().catch(() => ({}));
  const content = result?.choices?.[0]?.message?.content;
  if (!content) throw new Error('Invalid API response');
  return String(content);
}

async function callLLMWithProvider(settings, provider, messages, temperature, maxTokens) {
  const keys = getKeysForProvider(settings, provider);
  if (!keys.length) throw new Error('No API key configured');
  const model = getModelForProvider(settings, provider);

  const timeoutMs = 90000;
  const attempts = Math.max(2, Math.min(10, keys.length * 2));

  for (let a = 0; a < attempts; a++) {
    const pick = pickNextKey(provider, keys);
    if (!pick.key) {
      if (pick.waitMs > 0) await sleep(Math.min(pick.waitMs, 2000));
      continue;
    }

    const payload = {
      model,
      messages,
      temperature
    };

    if (provider === 'cerebras') {
      if (Number.isFinite(Number(maxTokens))) payload.max_completion_tokens = Math.max(1, Math.min(MAX_OUTPUT_TOKENS, Number(maxTokens)));
    } else {
      if (Number.isFinite(Number(maxTokens))) payload.max_tokens = Math.max(1, Math.min(MAX_OUTPUT_TOKENS, Number(maxTokens)));
    }

    try {
      return await callChatCompletions(provider, pick.key, payload, timeoutMs);
    } catch (e) {
      const message = getErrorMessageText(e);

      if (e?.status === 429) {
        const retry = Number.isFinite(Number(e.retryAfterMs)) ? Number(e.retryAfterMs) : 1200;
        markKeyCooldown(provider, pick.key, retry);
        continue;
      }
      if (shouldQuarantineKey(provider, e)) {
        const quarantineMs = (provider === 'groq' && e?.status === 413 && /\blimit\s*1\b/i.test(message))
          ? BROKEN_KEY_COOLDOWN_MS
          : AUTH_KEY_COOLDOWN_MS;
        markKeyCooldown(provider, pick.key, quarantineMs);
        continue;
      }
      if (e?.status === 413) {
        markKeyCooldown(provider, pick.key, GENERIC_REQUEST_COOLDOWN_MS);
        if (keys.length > 1) continue;
        throw e;
      }
      if (e?.status === 408) {
        markKeyCooldown(provider, pick.key, TRANSIENT_KEY_COOLDOWN_MS);
        continue;
      }
      // Soft cooldown on transient failures
      if (e?.status >= 500 || e?.message === 'Timeout') {
        markKeyCooldown(provider, pick.key, TRANSIENT_KEY_COOLDOWN_MS);
        continue;
      }
      throw e;
    }
  }

  throw new Error('LLM call failed after retries');
}

async function callLLM(settings, messages, temperature, maxTokens) {
  const primary = normalizeProvider(settings.coreProvider);
  const providers = primary === 'groq' ? ['groq', 'cerebras'] : ['cerebras', 'groq'];

  let lastErr = null;
  for (const p of providers) {
    const keys = getKeysForProvider(settings, p);
    if (!keys.length) continue;
    try {
      return await callLLMWithProvider(settings, p, messages, temperature, maxTokens);
    } catch (e) {
      lastErr = e;
    }
  }

  throw lastErr || new Error('No API key configured');
}

async function handleGroqCall(prompt, systemPrompt, options = {}) {
  const settings = await getMergedSettings([
    'byokMode',
    'coreProvider',
    'model', 'modelGroq', 'modelCerebras',
    'groqApiKey', 'groqApiKeys',
    'cerebrasApiKeys'
  ]);

  const tempRaw = (options && typeof options === 'object') ? options.temperature : undefined;
  const maxTokRaw = (options && typeof options === 'object') ? (options.max_tokens ?? options.max_completion_tokens) : undefined;
  const temperature = Number.isFinite(Number(tempRaw)) ? Math.max(0, Math.min(1.5, Number(tempRaw))) : 0.7;
  const max_tokens = Number.isFinite(Number(maxTokRaw)) ? Math.max(1, Math.min(MAX_OUTPUT_TOKENS, Number(maxTokRaw))) : DEFAULT_REQUEST_MAX_TOKENS;

  const messages = [
    { role: 'system', content: systemPrompt || '' },
    { role: 'user', content: prompt }
  ];

  return await callLLM(settings, messages, temperature, max_tokens);
}

// ============ GROQ BATCH TRANSLATE ============

async function handleGroqBatchCall(items, systemPrompt, options = {}) {
  const list = Array.isArray(items) ? items : [];
  if (!list.length) return '';

  const settings = await getMergedSettings([
    'byokMode',
    'coreProvider',
    'model', 'modelGroq', 'modelCerebras',
    'groqApiKey', 'groqApiKeys',
    'cerebrasApiKeys',
    'maxParallelRequests'
  ]);

  const tempRaw = (options && typeof options === 'object') ? options.temperature : undefined;
  const maxTokRaw = (options && typeof options === 'object') ? (options.max_tokens ?? options.max_completion_tokens) : undefined;
  const temperature = Number.isFinite(Number(tempRaw)) ? Math.max(0, Math.min(1.5, Number(tempRaw))) : 0.2;
  const max_tokens = Number.isFinite(Number(maxTokRaw)) ? Math.max(1, Math.min(MAX_OUTPUT_TOKENS, Number(maxTokRaw))) : DEFAULT_BATCH_MAX_TOKENS;

  const maxParallelRaw = Number(settings.maxParallelRequests);
  const maxParallel = Number.isFinite(maxParallelRaw) ? Math.max(1, Math.min(200, Math.round(maxParallelRaw))) : 12;

  const results = [];
  let cursor = 0;

  const runners = Array.from({ length: Math.min(maxParallel, list.length) }, () => (async () => {
    while (true) {
      const i = cursor++;
      if (i >= list.length) return;
      const item = list[i];
      const idx = Number(item?.index);
      const prompt = String(item?.prompt || '');
      try {
        const out = await callLLM(settings, [
          { role: 'system', content: systemPrompt || '' },
          { role: 'user', content: prompt }
        ], temperature, max_tokens);
        results.push({ index: Number.isFinite(idx) ? idx : i, translated: out, success: true });
      } catch (e) {
        results.push({ index: Number.isFinite(idx) ? idx : i, translated: `[Error: ${e.message}]\n\n${prompt}`, success: false });
      }
    }
  })());

  await Promise.all(runners);

  const sorted = results.sort((a, b) => a.index - b.index);
  return sorted.map(r => r.translated).join('\n\n');
}

// ============ EXA SEARCH ============

async function handleExaSearch(query) {
  const response = await fetchWithTimeout('https://api.exa.ai/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': DEFAULT_EXA_KEY },
    body: JSON.stringify({ query, num_results: 40, use_autoprompt: true, type: 'neural' })
  }, 30000);

  if (!response.ok) throw new Error(`Exa Error: ${response.status}`);
  return (await response.json()).results || [];
}

// ============ WHISPER TRANSCRIPTION (via Groq) ============

async function handleWhisperTranscription(audioBase64) {
  const settings = await getMergedSettings(['byokMode', 'groqApiKey', 'groqApiKeys']);
  const keys = getKeysForProvider(settings, 'groq');
  const apiKey = String(keys[0] || '').trim();

  if (!apiKey) throw new Error('No API key configured');

  const binaryString = atob(audioBase64);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) bytes[i] = binaryString.charCodeAt(i);

  const audioBlob = new Blob([bytes], { type: 'audio/webm' });
  const formData = new FormData();
  formData.append('file', audioBlob, 'recording.webm');
  formData.append('model', 'whisper-large-v3-turbo');
  formData.append('language', 'ru');

  const response = await fetchWithTimeout('https://api.groq.com/openai/v1/audio/transcriptions', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${apiKey}` },
    body: formData
  }, 45000);

  if (!response.ok) throw new Error(`Transcription Error: ${response.status}`);
  return (await response.json()).text;
}

// ============ GROK VOICE API (xAI) ============
// Real-time voice assistant for reading summary aloud

async function handleGrokVoice(text) {
  const settings = await chrome.storage.sync.get(['voiceApiKey', 'voiceProvider', 'byokMode']);
  const provider = String(settings.voiceProvider || 'xai');
  const apiKey = String((settings.byokMode ? settings.voiceApiKey : '') || XAI_VOICE_KEY || '').trim();

  // Content script usually routes browser TTS locally; keep a safe fallback here.
  if (provider === 'browser') return { fallback: true, reason: 'browser' };
  if (!apiKey) return { fallback: true, reason: 'Missing voice API key' };

  // xAI Grok voice API - text to speech
  // Using OpenAI-compatible endpoint format
  try {
    const response = await fetchWithTimeout('https://api.x.ai/v1/audio/speech', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: 'grok-2-audio',
        input: text.substring(0, 4000),
        voice: 'alloy', // or 'echo', 'fable', 'onyx', 'nova', 'shimmer'
        response_format: 'mp3'
      })
    }, 60000);

    if (!response.ok) {
      const err = await response.json().catch(() => null);
      const msg = err?.error?.message || err?.message || `Status ${response.status}`;
      console.warn('Grok Voice API Error:', msg);
      // Soft fail: return fallback flag so content script uses browser TTS
      return { fallback: true, reason: msg };
    }

    const audioBuffer = await response.arrayBuffer();
    const audioBase64 = arrayBufferToBase64(audioBuffer);
    return { audioBase64, mime: 'audio/mpeg' };
  } catch (e) {
    console.error('Grok Voice Network Error:', e);
    return { fallback: true, reason: e.message };
  }
}

function arrayBufferToBase64(buffer) {
  let binary = '';
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

// ============ URL META (for hover previews) ============

async function handleFetchUrlMeta(url) {
  if (!url || typeof url !== 'string') throw new Error('Invalid URL');
  if (!/^https?:\/\//i.test(url)) throw new Error('Only http(s) URLs supported');

  const response = await fetchWithTimeout(url, { method: 'GET' }, 15000);
  if (!response.ok) throw new Error(`Fetch failed: ${response.status}`);

  const contentType = response.headers.get('content-type') || '';
  if (!contentType.includes('text/html')) {
    return { url, title: url, description: '', image: '' };
  }

  const html = (await response.text()).slice(0, 250_000);

  const title = (html.match(/<title[^>]*>([^<]{1,300})<\/title>/i)?.[1] || '').trim();
  const ogTitle = (html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']{1,300})["'][^>]*>/i)?.[1] || '').trim();
  const description = (
    html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']{1,500})["'][^>]*>/i)?.[1] ||
    html.match(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']{1,500})["'][^>]*>/i)?.[1] ||
    ''
  ).trim();
  const image = (html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']{1,500})["'][^>]*>/i)?.[1] || '').trim();

  return {
    url,
    title: ogTitle || title || url,
    description,
    image
  };
}

// ============ SLACK (ALWAYS sends, no user control) ============

async function handleSlackSend(data) {
  const payload = {
    url: data.url || '',
    summarized_note: data.summarized_note || '',
    tags: data.tags || '',
    timestamp: data.timestamp || new Date().toISOString(),
    page_tokens: data.page_tokens || 0,
    summary_tokens: data.summary_tokens || 0
  };

  try {
    await fetchWithTimeout(SLACK_WEBHOOK, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    }, 10000);
  } catch (e) {
    // Silent fail - Slack is fire-and-forget
  }

  return { success: true };
}

// ============ BROWSER CONTEXT ============

async function handleGetBrowserContext(windowParam = {}) {
  const raw = (windowParam && typeof windowParam === 'object') ? windowParam : { days: windowParam };
  const hoursRaw = Number(raw.hours);
  const hasHours = Number.isFinite(hoursRaw) && hoursRaw > 0;
  const hours = hasHours ? Math.max(0.25, Math.min(24, hoursRaw)) : null;
  const days = Number.isFinite(Number(raw.days)) ? Math.max(1 / 24, Math.min(90, Number(raw.days))) : 30;
  const windowMs = hasHours ? hours * 60 * 60 * 1000 : days * 24 * 60 * 60 * 1000;
  const startTime = Date.now() - windowMs;
  const windowLabel = hasHours
    ? `${Number.isInteger(hours) ? hours : hours.toFixed(2)}h`
    : `${Number.isInteger(days) ? days : days.toFixed(2)}d`;

  const [tabs, historyItems] = await Promise.all([
    chrome.tabs.query({}),
    new Promise((resolve) => {
      chrome.history.search({ text: '', startTime, maxResults: 200 }, (items) => resolve(items || []));
    })
  ]);

  const openTabs = (tabs || [])
    .filter(t => typeof t.url === 'string' && /^https?:\/\//i.test(t.url))
    .map(t => {
      let domain = '';
      try { domain = new URL(t.url).hostname; } catch (e) { domain = ''; }
      return { title: t.title || '', url: t.url, active: !!t.active, pinned: !!t.pinned, domain, windowId: t.windowId || 0 };
    })
    .slice(0, 40);

  const cleanedHistory = (historyItems || [])
    .filter(h => typeof h.url === 'string' && /^https?:\/\//i.test(h.url))
    .sort((a, b) => (b.lastVisitTime || 0) - (a.lastVisitTime || 0));

  // Top domains (weighted by visitCount)
  const domainAgg = new Map();
  for (const h of cleanedHistory) {
    let host = '';
    try { host = new URL(h.url).hostname; } catch (e) { continue; }
    const prev = domainAgg.get(host) || { domain: host, pages: 0, visits: 0, lastVisitTime: 0 };
    prev.pages += 1;
    prev.visits += Number(h.visitCount || 0) || 0;
    prev.lastVisitTime = Math.max(prev.lastVisitTime, Number(h.lastVisitTime || 0) || 0);
    domainAgg.set(host, prev);
  }
  const topDomains = Array.from(domainAgg.values())
    .sort((a, b) => (b.visits || 0) - (a.visits || 0))
    .slice(0, 12);

  const groupRows = (items, urlKey = 'url') => {
    const groups = new Map();
    for (const item of items || []) {
      let host = item.domain || '';
      try { if (!host) host = new URL(item[urlKey]).hostname; } catch (e) { continue; }
      if (!host) continue;
      const prev = groups.get(host) || { domain: host, count: 0, active: false, pinned: false, pages: [] };
      prev.count += 1;
      prev.active = prev.active || !!item.active;
      prev.pinned = prev.pinned || !!item.pinned;
      if (prev.pages.length < 6) {
        prev.pages.push({
          title: item.title || '',
          url: item[urlKey] || '',
          lastVisitTime: item.lastVisitTime || item.visitTime || 0
        });
      }
      groups.set(host, prev);
    }
    return Array.from(groups.values())
      .sort((a, b) => Number(b.active) - Number(a.active) || (b.count - a.count))
      .slice(0, 10);
  };

  const openTabGroups = groupRows(openTabs);

  // Recent pages (unique URLs)
  const recentHistory = cleanedHistory
    .slice(0, 60)
    .map(h => ({
      title: h.title || '',
      url: h.url,
      lastVisitTime: h.lastVisitTime || 0,
      visitCount: h.visitCount || 0,
      typedCount: h.typedCount || 0
    }));

  // "Pathway": approximate trail by stitching per-URL visits for top recent URLs
  const urlsForVisits = recentHistory.slice(0, 12);
  const perUrlVisits = await Promise.all(
    urlsForVisits.map((item) =>
      new Promise((resolve) => {
        chrome.history.getVisits({ url: item.url }, (visits) => {
          const filtered = (visits || [])
            .filter(v => (v.visitTime || 0) >= startTime)
            .sort((a, b) => (b.visitTime || 0) - (a.visitTime || 0))
            .slice(0, 5)
            .map(v => ({ visitTime: v.visitTime || 0, transition: v.transition || '' }));
          resolve({ url: item.url, title: item.title, visits: filtered });
        });
      })
    )
  );

  const visitTrail = [];
  for (const row of perUrlVisits) {
    for (const v of row.visits) {
      visitTrail.push({ visitTime: v.visitTime, transition: v.transition, url: row.url, title: row.title || '' });
    }
  }
  visitTrail.sort((a, b) => (b.visitTime || 0) - (a.visitTime || 0));

  const workflowGroups = groupRows(
    openTabs.concat(recentHistory.map(h => ({
      title: h.title || '',
      url: h.url,
      lastVisitTime: h.lastVisitTime || 0,
      active: false,
      pinned: false
    })))
  ).map(group => ({
    ...group,
    signal: group.active ? 'active-tab-cluster' : (group.count >= 3 ? 'repeated-domain' : 'recent-context')
  }));

  return {
    windowDays: hasHours ? null : days,
    windowHours: hasHours ? hours : null,
    windowLabel,
    generatedAt: Date.now(),
    openTabs,
    openTabGroups,
    topDomains,
    recentHistory,
    visitTrail: visitTrail.slice(0, 60),
    workflowGroups
  };
}

// ============ UTILS ============

async function fetchWithTimeout(url, options, timeout = 30000) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    clearTimeout(id);
    return response;
  } catch (error) {
    clearTimeout(id);
    if (error.name === 'AbortError') throw new Error('Timeout');
    throw error;
  }
}

// Reset tracker stats on navigation
chrome.webNavigation?.onCompleted?.addListener((details) => {
  if (details.frameId === 0) trackerStats = { blocked: 0, domains: new Set() };
});
