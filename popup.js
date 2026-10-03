document.addEventListener('DOMContentLoaded', async () => {
  const settings = await getMergedSettings();

  document.getElementById('autoSummarize').checked = settings.autoSummarize !== false;
  document.getElementById('privacyEnabled').checked = settings.privacyEnabled !== false;
  document.getElementById('activeProvider').textContent = getProvider(settings) === 'cerebras' ? 'Cerebras' : 'Groq';
  document.getElementById('activeModel').textContent = getActiveModel(settings);
  document.getElementById('activeTokens').textContent = String(settings.targetMaxOutputTokens || 8192);

  const keyState = getKeyState(settings);
  document.getElementById('keyState').textContent = keyState.label;
  const keyGuidance = document.getElementById('keyGuidance');
  if (keyState.guidance) {
    keyGuidance.textContent = keyState.guidance;
    keyGuidance.append(' ');
    const setupLink = document.createElement('a');
    setupLink.href = '#';
    setupLink.id = 'keySetup';
    setupLink.textContent = 'Открыть настройки ключей';
    keyGuidance.append(setupLink, '.');
    keyGuidance.hidden = false;
    setupLink.addEventListener('click', (event) => {
      event.preventDefault();
      chrome.runtime.openOptionsPage();
    });
  }

  chrome.runtime.sendMessage({ action: 'getTrackerStats' }, (response) => {
    const trackersBlocked = document.getElementById('trackersBlocked');
    const blocked = response?.data?.blocked;
    if (response?.success && Number.isFinite(blocked) && blocked >= 0) {
      trackersBlocked.textContent = String(blocked);
    } else {
      trackersBlocked.textContent = 'Нет данных';
    }
  });

  ['autoSummarize', 'privacyEnabled'].forEach(id => {
    document.getElementById(id).addEventListener('change', async (e) => {
      await chrome.storage.sync.set({ [id]: e.target.checked });
    });
  });

  document.getElementById('summarizeBtn').addEventListener('click', () => {
    sendToContent({ action: 'summarize' });
    window.close();
  });

  document.getElementById('translateBtn').addEventListener('click', () => {
    const lang = document.getElementById('translateLang').value;
    sendToContent({ action: 'translatePage', lang });
    window.close();
  });

  document.getElementById('mindmapBtn').addEventListener('click', () => {
    sendToContent({ action: 'generateMindmap' });
    window.close();
  });

  document.getElementById('openOptions').addEventListener('click', (e) => {
    e.preventDefault();
    chrome.runtime.openOptionsPage();
  });
});


function sendToContent(message) {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (tabs[0]?.id) {
      chrome.tabs.sendMessage(tabs[0].id, message);
    }
  });
}

async function getMergedSettings() {
  const stored = await chrome.storage.sync.get([
    'autoSummarize',
    'privacyEnabled',
    'coreProvider',
    'model',
    'modelGroq',
    'modelCerebras',
    'targetMaxOutputTokens',
    'groqApiKey',
    'groqApiKeys',
    'cerebrasApiKeys'
  ]);
  const defaultsResponse = await fetch(chrome.runtime.getURL('shared-defaults.json'));
  if (!defaultsResponse.ok) throw new Error('Shared extension defaults unavailable');
  const defaults = await defaultsResponse.json();
  const merged = { ...stored };
  if (!Object.hasOwn(stored, 'groqApiKeys') && !String(stored.groqApiKey || '').trim()) {
    merged.groqApiKeys = defaults.groqApiKeys;
  }


  try {
    const response = await fetch(chrome.runtime.getURL('local-overrides.json'), { cache: 'no-store' });
    if (!response.ok) return merged;
    const overrides = await response.json().catch(() => null);
    if (!overrides || typeof overrides !== 'object') return merged;
    for (const key of ['coreProvider', 'model', 'modelGroq', 'modelCerebras']) {
      const value = String(overrides[key] || '').trim();
      if (value) merged[key] = value;
    }

    const targetMaxOutputTokens = Number(overrides.targetMaxOutputTokens);
    if (Number.isFinite(targetMaxOutputTokens)) merged.targetMaxOutputTokens = targetMaxOutputTokens;

    const groqApiKeys = normalizeKeyLines(overrides.groqApiKeys);
    const cerebrasApiKeys = normalizeKeyLines(overrides.cerebrasApiKeys);
    if (groqApiKeys.length) merged.groqApiKeys = groqApiKeys;
    if (cerebrasApiKeys.length) merged.cerebrasApiKeys = cerebrasApiKeys;

    return merged;
  } catch (e) {
    return merged;
  }
}

function normalizeKeyLines(value) {
  const keys = Array.isArray(value)
    ? value.map(v => String(v || '').trim()).filter(Boolean)
    : String(value || '')
      .split(/\r?\n/)
      .map(v => v.trim())
      .filter(Boolean);
  return Array.from(new Set(keys));
}

function getProvider(settings) {
  return String(settings.coreProvider || 'groq').trim().toLowerCase() === 'cerebras' ? 'cerebras' : 'groq';
}

function isKnownCerebrasModel(model) {
  return [
    'gpt-oss-120b',
    'llama3.1-8b',
    'llama-3.3-70b',
    'qwen-3-32b',
    'qwen-3-235b-a22b-instruct-2507',
    'zai-glm-4.6'
  ].includes(String(model || '').trim());
}

function isDeprecatedGroqModel(model) {
  return [
    '',
    'moonshotai/kimi-k2-instruct',
    'moonshotai/kimi-k2-instruct-0905'
  ].includes(String(model || '').trim());
}

function getActiveModel(settings) {
  const provider = getProvider(settings);
  if (provider === 'cerebras') {
    const explicit = String(settings.modelCerebras || '').trim();
    if (explicit) return explicit;
    const shared = String(settings.model || '').trim();
    return isKnownCerebrasModel(shared) ? shared : 'gpt-oss-120b';
  }
  const explicit = String(settings.modelGroq || '').trim();
  if (explicit && !isDeprecatedGroqModel(explicit)) return explicit;
  const shared = String(settings.model || '').trim();
  if (!shared || isKnownCerebrasModel(shared) || isDeprecatedGroqModel(shared)) return 'qwen/qwen3.8-27b';
  return shared;
}
function getKeyState(settings) {
  const provider = getProvider(settings);
  const providerName = provider === 'cerebras' ? 'Cerebras' : 'Groq';
  const providerKeys = normalizeKeyLines(
    provider === 'cerebras' ? settings.cerebrasApiKeys : settings.groqApiKeys
  );

  if (providerKeys.length) {
    return { label: `Настроено ключей: ${providerKeys.length}`, guidance: '' };
  }

  if (provider === 'groq' && !Object.hasOwn(settings, 'groqApiKeys') && String(settings.groqApiKey || '').trim()) {
    return { label: 'Один сохранённый ключ', guidance: '' };
  }

  const poolIsExplicitlyEmpty = Object.hasOwn(
    settings,
    provider === 'cerebras' ? 'cerebrasApiKeys' : 'groqApiKeys'
  );
  if (poolIsExplicitlyEmpty) {
    return {
      label: 'Пул намеренно отключён',
      guidance: `Пул ключей ${providerName} сохранён пустым. Этот провайдер пропускается; если у другого провайдера настроен ключ, запрос может быть отправлен ему.`
    };
  }

  return {
    label: 'Ключ не настроен',
    guidance: `Ключи ${providerName} не настроены. Если у другого провайдера настроен ключ, запрос может быть отправлен ему.`
  };
}

