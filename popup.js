document.addEventListener('DOMContentLoaded', async () => {
  const settings = await getMergedSettings();

  document.getElementById('autoSummarize').checked = settings.autoSummarize !== false;
  document.getElementById('privacyEnabled').checked = settings.privacyEnabled !== false;
  document.getElementById('activeProvider').textContent = getProvider(settings);
  document.getElementById('activeModel').textContent = getActiveModel(settings);
  document.getElementById('activeTokens').textContent = String(settings.targetMaxOutputTokens || 8192);
  document.getElementById('keyState').textContent = getKeyState(settings);

  // Get tracker stats
  chrome.runtime.sendMessage({ action: 'getTrackerStats' }, (response) => {
    if (response?.success) {
      document.getElementById('trackersBlocked').textContent = response.data.blocked || 0;
    }
  });

  // Toggle handlers
  ['autoSummarize', 'privacyEnabled'].forEach(id => {
    document.getElementById(id).addEventListener('change', async (e) => {
      await chrome.storage.sync.set({ [id]: e.target.checked });
    });
  });

  // Action buttons
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

  try {
    const response = await fetch(chrome.runtime.getURL('local-overrides.json'), { cache: 'no-store' });
    if (!response.ok) return stored;
    const overrides = await response.json().catch(() => null);
    if (!overrides || typeof overrides !== 'object') return stored;

    const merged = { ...stored };
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
    return stored;
  }
}

function normalizeKeyLines(value) {
  if (Array.isArray(value)) return value.map(v => String(v || '').trim()).filter(Boolean);
  return String(value || '')
    .split(/\r?\n/)
    .map(v => v.trim())
    .filter(Boolean);
}

function getProvider(settings) {
  return String(settings.coreProvider || 'groq').trim().toLowerCase() === 'cerebras' ? 'cerebras' : 'groq';
}

function getActiveModel(settings) {
  const provider = getProvider(settings);
  if (provider === 'cerebras') {
    return String(settings.modelCerebras || settings.model || 'gpt-oss-120b').trim();
  }
  return String(settings.modelGroq || settings.model || 'groq/compound').trim();
}

function getKeyState(settings) {
  const provider = getProvider(settings);
  const groqKeys = normalizeKeyLines(settings.groqApiKeys);
  const cerebrasKeys = normalizeKeyLines(settings.cerebrasApiKeys);

  if (provider === 'cerebras') return cerebrasKeys.length ? `pool:${cerebrasKeys.length}` : 'none';
  if (groqKeys.length) return `pool:${groqKeys.length}`;
  return String(settings.groqApiKey || '').trim() ? 'legacy' : 'none';
}
