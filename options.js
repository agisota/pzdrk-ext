document.addEventListener('DOMContentLoaded', async () => {
  const settings = await chrome.storage.sync.get([
    'coreProvider',
    'groqApiKey', 'groqApiKeys',
    'cerebrasApiKeys',
    'model', 'modelGroq', 'modelCerebras',
    'maxParallelRequests', 'targetMaxOutputTokens',
    'prefetchOnHover', 'prefetchDelayMs',
    'mapReduceEnabled',
    'summaryPrompt', 'byokMode',
    'autoSummarize', 'classicMode', 'privacyEnabled',
    'voiceProvider', 'voiceApiKey',
    'voiceChatMode', 'voicePersonality', 'autoSpeakSummary',
    'actionPrompts',
    'twoColumnSummary', 'summaryJsonPrompt', 'sectionEnrichPrompt'
  ]);

  function parseKeyLines(val) {
    return String(val || '')
      .split(/\r?\n/)
      .map(s => s.trim())
      .filter(Boolean);
  }

  function joinKeyLines(list) {
    return (Array.isArray(list) ? list : [])
      .map(s => String(s || '').trim())
      .filter(Boolean)
      .join('\n');
  }

  function pickProvider() {
    const p = String(settings.coreProvider || 'groq').trim().toLowerCase();
    return (p === 'cerebras') ? 'cerebras' : 'groq';
  }

  function isCerebrasModelId(id) {
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

  function getModelForProvider(provider) {
    if (provider === 'cerebras') {
      const explicit = String(settings.modelCerebras || '').trim();
      if (explicit) return explicit;
      const shared = String(settings.model || '').trim();
      return isCerebrasModelId(shared) ? shared : 'gpt-oss-120b';
    }

    const explicit = String(settings.modelGroq || '').trim();
    if (explicit) return explicit;
    const shared = String(settings.model || '').trim();
    return (!shared || isCerebrasModelId(shared)) ? 'moonshotai/kimi-k2-instruct-0905' : shared;
  }

  function setModelOptionsVisibility(provider) {
    if (!modelEl) return;
    const p = (String(provider || 'groq').toLowerCase() === 'cerebras') ? 'cerebras' : 'groq';
    const options = Array.from(modelEl.querySelectorAll('option'));

    let selectedVisible = false;
    for (const opt of options) {
      const optProvider = String(opt.dataset.provider || '').trim().toLowerCase() || (isCerebrasModelId(opt.value) ? 'cerebras' : 'groq');
      const visible = optProvider === p;
      opt.hidden = !visible;
      opt.disabled = !visible;
      if (opt.value === modelEl.value && visible) selectedVisible = true;
    }

    if (!selectedVisible) {
      modelEl.value = getModelForProvider(p);
    }
  }

  const DEFAULT_ACTION_PROMPTS = {
    twitter: `Сделай Twitter-тред (5–9 твитов по 280 символов).
Требования: 1) хук в первом, 2) факты/числа отмечай как [[evidence:...]], 3) CTA последним.

URL: {url}
TITLE: {title}

SUMMARY:
{summary}

PAGE SNIPPET:
{content}

USER CONTEXT:
{browserContext}`,

    deepdive: `Глубокий разбор: неочевидные связи, предположения и что проверить.
Формат: 1) тезис → 2) почему важно → 3) риски/антипаттерны → 4) что делать дальше.

URL: {url}
TITLE: {title}

SUMMARY:
{summary}

PAGE SNIPPET:
{content}

USER CONTEXT:
{browserContext}`,

    automation: `Предложи, как это автоматизировать: инструменты, интеграции, API, конкретные шаги.
Дай 3 уровня: quick win (30 мин), норм (1–2 дня), серьёзно (1–2 недели).

URL: {url}
TITLE: {title}

SUMMARY:
{summary}

PAGE SNIPPET:
{content}

USER CONTEXT:
{browserContext}`,

    learning: `Составь план изучения на 14 дней.
Дай: темы по дням, упражнения, мини-проекты, критерии прогресса и 5 ссылок/ресурсов (если не уверен — скажи что искать).

URL: {url}
TITLE: {title}

SUMMARY:
{summary}

PAGE SNIPPET:
{content}`,

    share: `Подготовь для шаринга:
1) Slack (3 предложения)
2) Email subject + 2 коротких абзаца
3) LinkedIn пост
4) Telegram пост

URL: {url}
TITLE: {title}

SUMMARY:
{summary}`,

    challenge: `Сгенерируй 7–10 провокационных вопросов по теме.
К каждому: 1–2 гипотезы и что проверить/где искать.
Потом: TOP-5 objectives и NEXT BEST PROMPTS (10 идей).

URL: {url}
TITLE: {title}

SUMMARY:
{summary}

PAGE SNIPPET:
{content}`
  };

  // Set values
  const providerEl = document.getElementById('coreProvider');
  if (providerEl) providerEl.value = pickProvider();

  const groqKeysEl = document.getElementById('groqApiKeys');
  if (groqKeysEl) {
    const stored = Array.isArray(settings.groqApiKeys) ? settings.groqApiKeys : [];
    const legacy = String(settings.groqApiKey || '').trim();
    groqKeysEl.value = joinKeyLines(stored.length ? stored : (legacy ? [legacy] : []));
  }

  const cerebrasKeysEl = document.getElementById('cerebrasApiKeys');
  if (cerebrasKeysEl) cerebrasKeysEl.value = joinKeyLines(settings.cerebrasApiKeys);

  const modelEl = document.getElementById('model');
  if (modelEl) {
    modelEl.value = getModelForProvider(pickProvider());
    setModelOptionsVisibility(pickProvider());
  }
  document.getElementById('summaryPrompt').value = settings.summaryPrompt || '';
  const twoColEl = document.getElementById('twoColumnSummary');
  if (twoColEl) twoColEl.checked = settings.twoColumnSummary !== false;
  const sjp = document.getElementById('summaryJsonPrompt');
  if (sjp) sjp.value = settings.summaryJsonPrompt || '';
  const sep = document.getElementById('sectionEnrichPrompt');
  if (sep) sep.value = settings.sectionEnrichPrompt || '';

  const maxParEl = document.getElementById('maxParallelRequests');
  if (maxParEl) maxParEl.value = String(settings.maxParallelRequests ?? 12);

  const maxOutEl = document.getElementById('targetMaxOutputTokens');
  if (maxOutEl) maxOutEl.value = String(settings.targetMaxOutputTokens ?? 500);

  const prefetchEl = document.getElementById('prefetchOnHover');
  if (prefetchEl) prefetchEl.checked = settings.prefetchOnHover !== false;

  const prefetchDelayEl = document.getElementById('prefetchDelayMs');
  if (prefetchDelayEl) prefetchDelayEl.value = String(settings.prefetchDelayMs ?? 320);

  const mapReduceEl = document.getElementById('mapReduceEnabled');
  if (mapReduceEl) mapReduceEl.checked = settings.mapReduceEnabled !== false;
  document.getElementById('voiceProvider').value = settings.voiceProvider || 'xai';
  document.getElementById('voiceApiKey').value = settings.voiceApiKey || '';

  const vcm = document.getElementById('voiceChatMode');
  if (vcm) vcm.value = settings.voiceChatMode || 'off';
  const vp = document.getElementById('voicePersonality');
  if (vp) vp.value = settings.voicePersonality || 'Ara';
  const ass = document.getElementById('autoSpeakSummary');
  if (ass) ass.checked = settings.autoSpeakSummary === true;

  const actionPrompts = (settings.actionPrompts && typeof settings.actionPrompts === 'object') ? settings.actionPrompts : {};
  document.getElementById('actionPrompt_twitter').value = actionPrompts.twitter || DEFAULT_ACTION_PROMPTS.twitter;
  document.getElementById('actionPrompt_deepdive').value = actionPrompts.deepdive || DEFAULT_ACTION_PROMPTS.deepdive;
  document.getElementById('actionPrompt_automation').value = actionPrompts.automation || DEFAULT_ACTION_PROMPTS.automation;
  document.getElementById('actionPrompt_learning').value = actionPrompts.learning || DEFAULT_ACTION_PROMPTS.learning;
  document.getElementById('actionPrompt_share').value = actionPrompts.share || DEFAULT_ACTION_PROMPTS.share;
  document.getElementById('actionPrompt_challenge').value = actionPrompts.challenge || DEFAULT_ACTION_PROMPTS.challenge;

  // Prompt reset helpers (UI only; user still clicks Save)
  const resetSummaryBtn = document.getElementById('resetSummaryPromptBtn');
  if (resetSummaryBtn) {
    resetSummaryBtn.addEventListener('click', () => {
      document.getElementById('summaryPrompt').value = '';
    });
  }

  const resetSummaryJsonBtn = document.getElementById('resetSummaryJsonPromptBtn');
  if (resetSummaryJsonBtn) {
    resetSummaryJsonBtn.addEventListener('click', () => {
      const el = document.getElementById('summaryJsonPrompt');
      if (el) el.value = '';
    });
  }

  const resetSectionEnrichBtn = document.getElementById('resetSectionEnrichPromptBtn');
  if (resetSectionEnrichBtn) {
    resetSectionEnrichBtn.addEventListener('click', () => {
      const el = document.getElementById('sectionEnrichPrompt');
      if (el) el.value = '';
    });
  }

  const resetAllActionPromptsBtn = document.getElementById('resetAllActionPromptsBtn');
  if (resetAllActionPromptsBtn) {
    resetAllActionPromptsBtn.addEventListener('click', () => {
      document.getElementById('actionPrompt_twitter').value = DEFAULT_ACTION_PROMPTS.twitter;
      document.getElementById('actionPrompt_deepdive').value = DEFAULT_ACTION_PROMPTS.deepdive;
      document.getElementById('actionPrompt_automation').value = DEFAULT_ACTION_PROMPTS.automation;
      document.getElementById('actionPrompt_learning').value = DEFAULT_ACTION_PROMPTS.learning;
      document.getElementById('actionPrompt_share').value = DEFAULT_ACTION_PROMPTS.share;
      document.getElementById('actionPrompt_challenge').value = DEFAULT_ACTION_PROMPTS.challenge;
    });
  }

  document.querySelectorAll('[data-reset-action]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const key = btn.getAttribute('data-reset-action');
      if (!key) return;
      const el = document.getElementById(`actionPrompt_${key}`);
      if (!el) return;
      const val = DEFAULT_ACTION_PROMPTS[key];
      if (typeof val === 'string') el.value = val;
    });
  });

  // Toggles
  document.getElementById('autoSummarize').checked = settings.autoSummarize !== false;
  document.getElementById('classicMode').checked = settings.classicMode || false;
  document.getElementById('privacyEnabled').checked = settings.privacyEnabled !== false;

  // BYOK mode toggle
  const unlimitedMode = document.getElementById('unlimitedMode');
  const byokMode = document.getElementById('byokMode');
  const coreByok = document.getElementById('coreByok');
  const voiceByok = document.getElementById('voiceByok');

  function updateModeUI(isByok) {
    if (isByok) {
      unlimitedMode.classList.remove('active');
      unlimitedMode.classList.add('available');
      byokMode.classList.add('active');
      byokMode.classList.remove('available');
      coreByok.classList.add('show');
      voiceByok.classList.add('show');
    } else {
      unlimitedMode.classList.add('active');
      unlimitedMode.classList.remove('available');
      byokMode.classList.remove('active');
      byokMode.classList.add('available');
      coreByok.classList.remove('show');
      voiceByok.classList.remove('show');
    }
  }

  updateModeUI(settings.byokMode || false);

  // Provider switching: keep last model per provider
  if (providerEl && modelEl) {
    providerEl.addEventListener('change', () => {
      const p = String(providerEl.value || 'groq').toLowerCase();
      const provider = (p === 'cerebras') ? 'cerebras' : 'groq';
      modelEl.value = getModelForProvider(provider);
      setModelOptionsVisibility(provider);
    });
  }

  unlimitedMode.addEventListener('click', () => {
    updateModeUI(false);
    chrome.storage.sync.set({ byokMode: false });
  });

  byokMode.addEventListener('click', () => {
    updateModeUI(true);
    chrome.storage.sync.set({ byokMode: true });
  });

  // Tracker stats
  chrome.runtime.sendMessage({ action: 'getTrackerStats' }, (response) => {
    if (response?.success) document.getElementById('trackerCount').textContent = response.data.blocked || 0;
  });

  // Save
  document.getElementById('saveBtn').addEventListener('click', async () => {
    const status = document.getElementById('status');

    const coreProvider = String(document.getElementById('coreProvider')?.value || 'groq').toLowerCase();
    const provider = (coreProvider === 'cerebras') ? 'cerebras' : 'groq';
    let model = String(document.getElementById('model')?.value || '').trim();
    if (provider === 'cerebras' && !isCerebrasModelId(model)) model = getModelForProvider('cerebras');
    if (provider === 'groq' && isCerebrasModelId(model)) model = getModelForProvider('groq');

    const groqApiKeys = parseKeyLines(document.getElementById('groqApiKeys')?.value);
    const cerebrasApiKeys = parseKeyLines(document.getElementById('cerebrasApiKeys')?.value);

    const maxParallelRequestsRaw = Number(document.getElementById('maxParallelRequests')?.value);
    const maxParallelRequests = Number.isFinite(maxParallelRequestsRaw) ? Math.max(1, Math.min(200, Math.round(maxParallelRequestsRaw))) : 12;

    const targetMaxOutputTokensRaw = Number(document.getElementById('targetMaxOutputTokens')?.value);
    const targetMaxOutputTokens = Number.isFinite(targetMaxOutputTokensRaw) ? Math.max(64, Math.min(4096, Math.round(targetMaxOutputTokensRaw))) : 500;

    const prefetchOnHover = document.getElementById('prefetchOnHover')?.checked !== false;
    const prefetchDelayMsRaw = Number(document.getElementById('prefetchDelayMs')?.value);
    const prefetchDelayMs = Number.isFinite(prefetchDelayMsRaw) ? Math.max(0, Math.min(2000, Math.round(prefetchDelayMsRaw))) : 320;

    const mapReduceEnabled = document.getElementById('mapReduceEnabled')?.checked !== false;

    const nextActionPrompts = {
      twitter: document.getElementById('actionPrompt_twitter').value,
      deepdive: document.getElementById('actionPrompt_deepdive').value,
      automation: document.getElementById('actionPrompt_automation').value,
      learning: document.getElementById('actionPrompt_learning').value,
      share: document.getElementById('actionPrompt_share').value,
      challenge: document.getElementById('actionPrompt_challenge').value
    };
    
    await chrome.storage.sync.set({
      coreProvider,
      groqApiKeys,
      cerebrasApiKeys,
      model,
      modelGroq: provider === 'groq' ? model : getModelForProvider('groq'),
      modelCerebras: provider === 'cerebras' ? model : getModelForProvider('cerebras'),
      maxParallelRequests,
      targetMaxOutputTokens,
      prefetchOnHover,
      prefetchDelayMs,
      mapReduceEnabled,
      summaryPrompt: document.getElementById('summaryPrompt').value,
      twoColumnSummary: document.getElementById('twoColumnSummary')?.checked,
      summaryJsonPrompt: document.getElementById('summaryJsonPrompt')?.value,
      sectionEnrichPrompt: document.getElementById('sectionEnrichPrompt')?.value,
      voiceProvider: document.getElementById('voiceProvider').value,
      voiceApiKey: document.getElementById('voiceApiKey').value,
      voiceChatMode: document.getElementById('voiceChatMode')?.value || 'off',
      voicePersonality: document.getElementById('voicePersonality')?.value || 'Ara',
      autoSpeakSummary: document.getElementById('autoSpeakSummary')?.checked === true,
      autoSummarize: document.getElementById('autoSummarize').checked,
      classicMode: document.getElementById('classicMode').checked,
      privacyEnabled: document.getElementById('privacyEnabled').checked,
      actionPrompts: nextActionPrompts
    });
    
    status.textContent = '✓ Сохранено';
    status.className = 'status show success';
    setTimeout(() => status.className = 'status', 2000);
  });

  // Reset
  document.getElementById('resetBtn').addEventListener('click', async () => {
    await chrome.storage.sync.clear();
    chrome.runtime.sendMessage({ action: 'resetTrackerStats' });
    location.reload();
  });
});
