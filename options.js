document.addEventListener('DOMContentLoaded', async () => {
  const DEFAULT_GROQ_MODEL = 'qwen/qwen3.8-27b';
  const DEFAULT_CEREBRAS_MODEL = 'gpt-oss-120b';
  const LOCAL_OVERRIDES_FILE = 'local-overrides.json';
  const DEFAULT_TARGET_MAX_OUTPUT_TOKENS = 8192;
  const DEFAULT_MAX_PARALLEL_REQUESTS = 64;
  const DEFAULT_PREFETCH_DELAY_MS = 220;
  const LEGACY_ACTION_PROMPT_DEFAULT_MATCHER = globalThis.ROX_PROMPT_DEFAULTS?.isLegacyActionPromptDefault;
  if (typeof LEGACY_ACTION_PROMPT_DEFAULT_MATCHER !== 'function') {
    throw new Error('Shared legacy action prompt matcher is unavailable');
  }
  const REGISTRY_EDITOR_KEYS = [
    'summary', 'summaryJson', 'sectionEnrich', 'generateTitle', 'pageRanking',
    'workflowSuggestions', 'voiceScript', 'mindmap', 'mindmapExpand',
    'followUp', 'actionToPrompt', 'createCommand'
  ];

  const sharedDefaults = await fetch(chrome.runtime.getURL('shared-defaults.json'))
    .then((response) => {
      if (!response.ok) throw new Error('Shared extension defaults unavailable');
      return response.json();
    });
  const storedSettings = await chrome.storage.sync.get([
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
    'twoColumnSummary', 'summaryJsonPrompt', 'sectionEnrichPrompt',
    'artifactAutoSave',
    'promptOverrides'
  ]);
  if (storedSettings.actionPrompts && typeof storedSettings.actionPrompts === 'object') {
    const migratedActionPrompts = { ...storedSettings.actionPrompts };
    let removedLegacyDefaults = false;
    for (const [key, value] of Object.entries(migratedActionPrompts)) {
      if (await LEGACY_ACTION_PROMPT_DEFAULT_MATCHER(key, value)) {
        delete migratedActionPrompts[key];
        removedLegacyDefaults = true;
      }
    }
    if (removedLegacyDefaults) {
      if (Object.keys(migratedActionPrompts).length) {
        await chrome.storage.sync.set({ actionPrompts: migratedActionPrompts });
      } else {
        await chrome.storage.sync.remove('actionPrompts');
      }
      storedSettings.actionPrompts = migratedActionPrompts;
    }
  }
  const localSettings = {
    ...sharedDefaults,
    ...await chrome.storage.local.get([
      'telegramEnabled',
      'telegramBotToken',
      'telegramChatId',
      'telegramSendHtml',
      'telegramSendMarkdown',
      'obsidianBridgeToken'
    ])
  };

  async function loadLocalOverrides() {
    try {
      const response = await fetch(chrome.runtime.getURL(LOCAL_OVERRIDES_FILE), { cache: 'no-store' });
      if (!response.ok) return null;
      const parsed = await response.json().catch(() => null);
      return parsed && typeof parsed === 'object' ? parsed : null;
    } catch (e) {
      return null;
    }
  }

  function parseKeyLines(val) {
    return String(val || '')
      .split(/\r?\n/)
      .map(s => s.trim())
      .filter(Boolean);
  }

  function dedupeStrings(list) {
    return Array.from(new Set((Array.isArray(list) ? list : []).map(s => String(s || '').trim()).filter(Boolean)));
  }

  function sendRuntimeMessage(action, payload = {}) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage({ action, ...payload }, (response) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        if (response?.success) resolve(response.data);
        else reject(new Error(response?.error || `${action} failed`));
      });
    });
  }

  function downloadTextFile(filename, content, mime = 'text/plain;charset=utf-8') {
    const blob = new Blob([String(content || '')], { type: mime });
    const href = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = href;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(href), 1200);
  }

  function safeFilename(value) {
    return String(value || 'Rox Discovery')
      .trim()
      .replace(/[^\wа-яА-ЯёЁ.-]+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 90) || 'Rox-Discovery';
  }

  function applyLocalOverrides(settings, overrides) {
    if (!overrides || typeof overrides !== 'object') return settings;

    const next = { ...settings };
    const groqApiKeys = dedupeStrings(parseKeyLines(overrides.groqApiKeys));
    const cerebrasApiKeys = dedupeStrings(parseKeyLines(overrides.cerebrasApiKeys));

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

    for (const key of ['byokMode', 'prefetchOnHover', 'mapReduceEnabled', 'twoColumnSummary', 'artifactAutoSave']) {
      if (typeof overrides[key] === 'boolean') next[key] = overrides[key];
    }

    if (overrides.promptOverrides && typeof overrides.promptOverrides === 'object') {
      next.promptOverrides = overrides.promptOverrides;
    }

    if (groqApiKeys.length || cerebrasApiKeys.length) next.byokMode = true;

    return next;
  }

  const baseSettings = { ...storedSettings };
  if (!Object.hasOwn(storedSettings, 'groqApiKeys') && !String(storedSettings.groqApiKey || '').trim()) {
    baseSettings.groqApiKeys = sharedDefaults.groqApiKeys;
  }
  const settings = applyLocalOverrides(baseSettings, await loadLocalOverrides());

  function joinKeyLines(list) {
    return dedupeStrings(list)
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

  function isDeprecatedGroqModelId(id) {
    return [
      '',
      'moonshotai/kimi-k2-instruct',
      'moonshotai/kimi-k2-instruct-0905'
    ].includes(String(id || '').trim());
  }

  function getModelForProvider(provider) {
    if (provider === 'cerebras') {
      const explicit = String(settings.modelCerebras || '').trim();
      if (explicit) return explicit;
      const shared = String(settings.model || '').trim();
      return isCerebrasModelId(shared) ? shared : DEFAULT_CEREBRAS_MODEL;
    }

    const explicit = String(settings.modelGroq || '').trim();
    if (explicit && !isDeprecatedGroqModelId(explicit)) return explicit;
    const shared = String(settings.model || '').trim();
    if (!shared || isCerebrasModelId(shared) || isDeprecatedGroqModelId(shared)) {
      return DEFAULT_GROQ_MODEL;
    }
    return shared;
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


  const promptDefaults = globalThis.ROX_PROMPT_DEFAULTS;
  if (!promptDefaults?.prompts || !promptDefaults?.actions) {
    throw new Error('Shared prompt defaults are unavailable');
  }
  const PROMPT_REGISTRY_DEFAULTS = promptDefaults.prompts;
  const DEFAULT_ACTION_PROMPTS = promptDefaults.actions;


  const PROMPT_REGISTRY_LABELS = {
    summary: 'Main Summary',
    summaryJson: 'JSON Summary',
    sectionEnrich: 'Section Enrich',
    generateTitle: 'Title Generator',
    pageRanking: 'Page Ranking',
    workflowSuggestions: 'Workflow Suggestions',
    voiceScript: 'Voice Script',
    mindmap: 'Mindmap',
    mindmapExpand: 'Mindmap Expand',
    followUp: 'Follow-up Q&A',
    actionToPrompt: 'Action → Prompt',
    createCommand: 'Command Builder'
  };

  const promptOverrides = (settings.promptOverrides && typeof settings.promptOverrides === 'object') ? { ...settings.promptOverrides } : {};

  function escapeHtml(value) {
    return String(value || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function formatBytes(value) {
    const bytes = Number(value || 0);
    if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  const LEGACY_PROMPT_SETTINGS = {
    summary: 'summaryPrompt',
    summaryJson: 'summaryJsonPrompt',
    sectionEnrich: 'sectionEnrichPrompt'
  };

  const ROOT_PROMPT_TOKENS = {
    summary: ['tags', 'browserContext'],
    summaryJson: ['tags', 'browserContext'],
    sectionEnrich: [],
    generateTitle: ['content'],
    pageRanking: ['content'],
    workflowSuggestions: ['content'],
    voiceScript: ['url', 'title', 'domain', 'depth', 'browserContext', 'summary', 'links', 'content'],
    mindmap: ['content', 'summary'],
    mindmapExpand: ['label', 'description', 'existingChildren', 'content', 'summary'],
    followUp: ['history', 'question'],
    actionToPrompt: ['action', 'noteTitle', 'section', 'originLine', 'url', 'title', 'browserContext', 'summary', 'content'],
    createCommand: ['request', 'url', 'title', 'summary', 'content', 'browserContext', 'selection']
  };
  const ROOT_PROMPT_TOKEN_SETS = Object.fromEntries(
    Object.entries(ROOT_PROMPT_TOKENS).map(([key, tokens]) => [key, new Set(tokens)])
  );

  function getEffectivePrompt(key) {
    const legacySetting = LEGACY_PROMPT_SETTINGS[key];
    const legacyValue = legacySetting ? String(settings[legacySetting] || '') : '';
    const savedOverride = String(promptOverrides[key] || '');
    return legacyValue || savedOverride || String(PROMPT_REGISTRY_DEFAULTS[key] || '');
  }

  function samplePrompt(text, allowedTokens = null, replaceOnce = false) {
    const unsupported = new Set();
    const substituted = new Set();
    const rendered = String(text || '').replace(/\{([A-Za-z][A-Za-z0-9]*)\}/g, (match, name) => {
      const samples = {
        url: 'https://example.com/article',
        title: 'Пример страницы',
        content: '[Фрагмент страницы]',
        summary: '[Краткое содержание]',
        tags: 'исследование, продукт',
        browserContext: '[Контекст браузера]',
        selection: '[Выделенный фрагмент]',
        history: '[История заметки]',
        question: '[Вопрос пользователя]',
        action: 'анализ',
        noteTitle: 'Пример заметки',
        noteExcerpt: '[Фрагмент заметки]',
        domain: 'Science',
        depth: '3',
        links: '[Ссылки]',
        section: 'Суть',
        originLine: 'Источник',
        label: 'Пример ветки',
        description: 'Описание ветки',
        existingChildren: '[]',
        request: '[Запрос пользователя]'
      };
      if (allowedTokens && !allowedTokens.has(name)) unsupported.add(name);
      if (Object.hasOwn(samples, name) && (!allowedTokens || allowedTokens.has(name))
        && (!replaceOnce || !substituted.has(name))) {
        substituted.add(name);
        return samples[name];
      }
      return match;
    });
    return { rendered, unsupported: Array.from(unsupported) };
  }

  function promptPreviewText(text, key) {
    const sample = samplePrompt(text, ROOT_PROMPT_TOKEN_SETS[key], true);
    return sample.unsupported.length
      ? `${sample.rendered}\n\nНеподдерживаемые переменные остаются без подстановки: ${sample.unsupported.map(name => `{${name}}`).join(', ')}.`
      : sample.rendered;
  }


  function promptVariableDescription(text, key) {
    const supported = ROOT_PROMPT_TOKEN_SETS[key];
    const variables = Array.from(String(text || '').matchAll(/\{([A-Za-z][A-Za-z0-9]*)\}/g), (match) => `{${match[1]}}`)
      .filter((name, index, all) => all.indexOf(name) === index);
    const substituted = variables.filter((name) => supported?.has(name.slice(1, -1)));
    const unsupported = variables.filter((name) => !supported?.has(name.slice(1, -1)));
    return `Переменные: ${substituted.join(', ') || 'нет'}${unsupported.length ? `. Неподдерживаемые переменные остаются литералами: ${unsupported.join(', ')}` : ''}.`;
  }

  function getLegacyDraftPrompt(key, draftValue) {
    return String(draftValue || '') || String(promptOverrides[key] || '') || String(PROMPT_REGISTRY_DEFAULTS[key] || '');
  }

  function getLegacyPromptSource(key, draftValue) {
    if (draftValue) return 'Черновик legacy override';
    if (promptOverrides[key]) return 'Сохранённый registry override';
    return 'Общий runtime default';
  }

  function updateLegacyPromptDraft(key, input) {
    const effective = getLegacyDraftPrompt(key, input.value);
    const preview = document.getElementById(`legacyPromptPreview_${key}`);
    if (preview) preview.textContent = promptPreviewText(effective, key);
    const legacyMeta = document.getElementById(`legacyPromptMeta_${key}`);
    const registryMeta = document.getElementById(`promptRegistryMeta_${key}`);
    const registryPreview = document.getElementById(`promptPreview_${key}`);
    const registryEditor = document.getElementById(`promptOverride_${key}`);
    const variableDescription = promptVariableDescription(effective, key);
    const source = getLegacyPromptSource(key, input.value);
    const branch = key === 'sectionEnrich' ? 'модульное обогащение секции' : 'прямой summary; длинная страница может использовать map-reduce';
    const fallback = input.value ? '' : ' Черновик legacy-поле пусто; используется registry override или общий default.';
    const meta = `${source}.${fallback} Ветка: ${branch}. ${variableDescription}`;
    if (legacyMeta) legacyMeta.textContent = meta;
    if (registryEditor) registryEditor.value = effective;
    if (registryPreview) registryPreview.textContent = promptPreviewText(effective, key);
    if (registryMeta) registryMeta.textContent = `${source}. Ветка: ${branch}. ${variableDescription} Приоритет: legacy > registry override > общий default. Сброс удаляет оба сохранённых значения. Изменения — черновик до «Сохранить».`;
  }

  function renderPromptRegistry() {
    const list = document.getElementById('promptRegistryList');
    if (!list) return;
    list.innerHTML = REGISTRY_EDITOR_KEYS.map((key) => {
      const saved = String(promptOverrides[key] || '');
      const legacy = LEGACY_PROMPT_SETTINGS[key] && String(settings[LEGACY_PROMPT_SETTINGS[key]] || '');
      const source = legacy ? 'Сохранённое legacy-поле — имеет приоритет' : saved ? 'Сохранённый override' : 'Общий runtime default';
      const legacyManaged = Boolean(LEGACY_PROMPT_SETTINGS[key]);
      const effective = getEffectivePrompt(key);
      const branch = key === 'summary' || key === 'summaryJson'
        ? 'Root direct summary; длинный ввод может перейти в map-reduce.'
        : key === 'sectionEnrich' ? 'Root modular enrichment для одной секции.'
          : 'Root prompt registry; отдельный от модульного Vite content.';
      return `
        <div class="prompt-card" data-prompt-card="${escapeHtml(key)}">
          <div class="prompt-card-head">
            <div class="prompt-card-title">${escapeHtml(PROMPT_REGISTRY_LABELS[key] || key)} <code>${escapeHtml(key)}</code></div>
            <button class="btn-mini" data-reset-prompt="${escapeHtml(key)}" type="button">Сбросить</button>
          </div>
          <p class="prompt-meta" id="promptRegistryMeta_${escapeHtml(key)}">${escapeHtml(source)} · ${escapeHtml(branch)} ${escapeHtml(promptVariableDescription(effective, key))} ${legacyManaged ? 'Приоритет: legacy > registry override > общий default. Сброс удаляет оба сохранённых значения.' : 'Приоритет: registry override > общий default. Сброс удаляет сохранённый override.'} Изменения — черновик до «Сохранить»; после сохранения выполните соответствующую генерацию заново.</p>
          <textarea id="promptOverride_${escapeHtml(key)}" spellcheck="false" ${legacyManaged ? 'readonly' : ''}>${escapeHtml(effective)}</textarea>
          <details class="prompt-preview"><summary>Предпросмотр с примером контекста</summary><pre id="promptPreview_${escapeHtml(key)}">${escapeHtml(promptPreviewText(effective, key))}</pre></details>
        </div>
      `;
    }).join('');
    list.querySelectorAll('textarea:not([readonly])').forEach((textarea) => {
      textarea.addEventListener('input', () => {
        const key = textarea.id.replace('promptOverride_', '');
        const preview = document.getElementById(`promptPreview_${key}`);
        const meta = document.getElementById(`promptRegistryMeta_${key}`);
        if (preview) preview.textContent = promptPreviewText(textarea.value, key);
        if (meta) meta.textContent = `Черновик override. ${promptVariableDescription(textarea.value, key)} Приоритет: registry override > общий default.`;
      });
    });
  }


  const resetPromptKeys = new Set();

  function collectPromptOverrides() {
    const next = { ...promptOverrides };
    for (const key of REGISTRY_EDITOR_KEYS) delete next[key];
    for (const key of REGISTRY_EDITOR_KEYS) {
      const el = document.getElementById(`promptOverride_${key}`);
      const value = String(el?.value || '');
      const defaultValue = String(PROMPT_REGISTRY_DEFAULTS[key] || '');
      if (LEGACY_PROMPT_SETTINGS[key]) {
        if (!resetPromptKeys.has(key) && promptOverrides[key]) {
          next[key] = promptOverrides[key];
        }
      } else if (value.trim() && value !== defaultValue) {
        next[key] = value;
      }
    }
    return next;
  }

  function collectActionPromptOverrides() {
    const next = {};
    for (const [key, defaultValue] of Object.entries(DEFAULT_ACTION_PROMPTS)) {
      const value = String(document.getElementById(`actionPrompt_${key}`)?.value || '');
      if (value.trim() && value !== String(defaultValue || '')) next[key] = value;
    }
    return next;
  }

  function setTelegramStatus(message, tone = '') {
    const status = document.getElementById('telegramStatus');
    if (!status) return;
    status.textContent = message || '';
    status.style.color = tone === 'ok' ? '#bbf7d0' : (tone === 'error' ? '#fecaca' : '');
  }

  function renderArtifactList(items) {
    const list = document.getElementById('artifactList');
    if (!list) return;
    const artifacts = Array.isArray(items) ? items : [];
    if (!artifacts.length) {
      list.innerHTML = '<div class="artifact-empty">Архив пока пуст. Нажмите кнопку 💽 на workspace, чтобы сохранить HTML/Markdown-снимок.</div>';
      return;
    }

    list.innerHTML = artifacts.map((item) => {
      const createdAt = item?.createdAt ? new Date(Number(item.createdAt)).toLocaleString() : 'unknown time';
      const title = item?.title || 'Rox Discovery artifact';
      const meta = [
        item?.domain || '',
        createdAt,
        `${Number(item?.tabCount || 0)} вкладок`,
        `HTML ${formatBytes(item?.htmlBytes)}`,
        `MD ${formatBytes(item?.markdownBytes)}`
      ].filter(Boolean).join(' • ');
      return `
        <div class="artifact-item" data-artifact-id="${escapeHtml(item?.id || '')}">
          <div>
            <div class="artifact-title" title="${escapeHtml(title)}">${escapeHtml(title)}</div>
            <div class="artifact-meta">${escapeHtml(meta)}</div>
          </div>
          <div class="artifact-actions">
            <button class="btn-mini" data-artifact-action="html" type="button">HTML</button>
            <button class="btn-mini" data-artifact-action="markdown" type="button">MD</button>
            <button class="btn-mini" data-artifact-action="telegram" type="button">TG</button>
            <button class="btn-mini" data-artifact-action="delete" type="button">Delete</button>
          </div>
        </div>
      `;
    }).join('');
  }

  async function refreshArtifactList() {
    const list = document.getElementById('artifactList');
    if (list) list.innerHTML = '<div class="artifact-empty">Загружаю архив...</div>';
    try {
      const artifacts = await sendRuntimeMessage('listArtifacts');
      renderArtifactList(artifacts);
    } catch (e) {
      if (list) list.innerHTML = `<div class="artifact-empty">Не удалось прочитать архив: ${escapeHtml(e.message)}</div>`;
    }
  }

  renderPromptRegistry();

  // Set values
  const providerEl = document.getElementById('coreProvider');
  if (providerEl) providerEl.value = pickProvider();

  const groqKeysEl = document.getElementById('groqApiKeys');
  if (groqKeysEl) {
    groqKeysEl.value = Object.hasOwn(settings, 'groqApiKeys')
      ? joinKeyLines(settings.groqApiKeys)
      : String(settings.groqApiKey || '').trim();
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

  for (const [key, id] of Object.entries(LEGACY_PROMPT_SETTINGS)) {
    const input = document.getElementById(id);
    const effective = getEffectivePrompt(key);
    const meta = document.createElement('p');
    meta.className = 'prompt-meta';
    meta.id = `legacyPromptMeta_${key}`;
    const branch = key === 'sectionEnrich' ? 'модульное обогащение секции' : 'прямой summary; длинная страница может использовать map-reduce';
    const source = input.value ? 'Сохранённый legacy override' : promptOverrides[key] ? 'Сохранённый registry override' : 'Общий runtime default';
    meta.textContent = `${source}. Ветка: ${branch}. ${promptVariableDescription(effective, key)} Root defaults берутся из общего скрипта; Vite content использует собственные prompts.`;
    const previewDetails = document.createElement('details');
    previewDetails.className = 'prompt-preview';
    const previewSummary = document.createElement('summary');
    previewSummary.textContent = 'Предпросмотр с примером контекста';
    const preview = document.createElement('pre');
    preview.id = `legacyPromptPreview_${key}`;
    preview.textContent = promptPreviewText(effective, key);
    previewDetails.append(previewSummary, preview);
    input.insertAdjacentElement('afterend', meta);
    meta.insertAdjacentElement('afterend', previewDetails);
    input.addEventListener('input', () => updateLegacyPromptDraft(key, input));
  }

  const maxParEl = document.getElementById('maxParallelRequests');
  if (maxParEl) maxParEl.value = String(settings.maxParallelRequests ?? DEFAULT_MAX_PARALLEL_REQUESTS);

  const maxOutEl = document.getElementById('targetMaxOutputTokens');
  if (maxOutEl) maxOutEl.value = String(settings.targetMaxOutputTokens ?? DEFAULT_TARGET_MAX_OUTPUT_TOKENS);

  const prefetchEl = document.getElementById('prefetchOnHover');
  if (prefetchEl) prefetchEl.checked = settings.prefetchOnHover === true;

  const prefetchDelayEl = document.getElementById('prefetchDelayMs');
  if (prefetchDelayEl) prefetchDelayEl.value = String(settings.prefetchDelayMs ?? DEFAULT_PREFETCH_DELAY_MS);

  const mapReduceEl = document.getElementById('mapReduceEnabled');
  if (mapReduceEl) mapReduceEl.checked = settings.mapReduceEnabled !== false;

  const artifactAutoSaveEl = document.getElementById('artifactAutoSave');
  if (artifactAutoSaveEl) artifactAutoSaveEl.checked = settings.artifactAutoSave !== false;

  const telegramEnabledEl = document.getElementById('telegramEnabled');
  if (telegramEnabledEl) telegramEnabledEl.checked = localSettings.telegramEnabled === true;
  const telegramBotTokenEl = document.getElementById('telegramBotToken');
  if (telegramBotTokenEl) telegramBotTokenEl.value = localSettings.telegramBotToken || '';
  const telegramChatIdEl = document.getElementById('telegramChatId');
  if (telegramChatIdEl) telegramChatIdEl.value = localSettings.telegramChatId || '';
  const telegramSendHtmlEl = document.getElementById('telegramSendHtml');
  if (telegramSendHtmlEl) telegramSendHtmlEl.checked = localSettings.telegramSendHtml !== false;
  const telegramSendMarkdownEl = document.getElementById('telegramSendMarkdown');
  if (telegramSendMarkdownEl) telegramSendMarkdownEl.checked = localSettings.telegramSendMarkdown === true;
  const obsidianBridgeTokenEl = document.getElementById('obsidianBridgeToken');
  if (obsidianBridgeTokenEl) obsidianBridgeTokenEl.value = localSettings.obsidianBridgeToken || '';

  document.getElementById('voiceProvider').value = settings.voiceProvider || 'xai';
  document.getElementById('voiceApiKey').value = settings.voiceApiKey || '';

  const vcm = document.getElementById('voiceChatMode');
  if (vcm) vcm.value = settings.voiceChatMode || 'off';
  const vp = document.getElementById('voicePersonality');
  if (vp) vp.value = settings.voicePersonality || 'Ara';
  const ass = document.getElementById('autoSpeakSummary');
  if (ass) ass.checked = settings.autoSpeakSummary === true;

  const actionPrompts = (settings.actionPrompts && typeof settings.actionPrompts === 'object') ? settings.actionPrompts : {};
  for (const [key, defaultValue] of Object.entries(DEFAULT_ACTION_PROMPTS)) {
    const input = document.getElementById(`actionPrompt_${key}`);
    if (input) input.value = Object.hasOwn(actionPrompts, key) ? String(actionPrompts[key]) : defaultValue;
  }

  document.querySelectorAll('textarea[id^="actionPrompt_"]').forEach((textarea) => {
    const key = textarea.id.replace('actionPrompt_', '');
    const source = Object.hasOwn(actionPrompts, key) ? 'Сохранённый override' : 'Общий runtime default';
    const supportedActionTokens = new Set(['url', 'title', 'summary', 'content', 'browserContext', 'noteTitle', 'noteExcerpt', 'selection']);
    const describeActionPreview = (text) => {
      const sample = samplePrompt(text, supportedActionTokens);
      const vars = Array.from(text.matchAll(/\{([A-Za-z][A-Za-z0-9]*)\}/g), (match) => `{${match[1]}}`)
        .filter((name, index, all) => all.indexOf(name) === index);
      const unsupported = sample.unsupported.length
        ? ` Неподдерживаемые renderer-ом переменные: ${sample.unsupported.map((name) => `{${name}}`).join(', ')}.`
        : '';
      return { rendered: sample.rendered, variables: vars.join(', ') || 'нет', unsupported };
    };
    const meta = document.createElement('p');
    meta.className = 'prompt-meta';
    const initial = describeActionPreview(textarea.value);
    meta.textContent = `${source}. Root content вызывает шаблон по действию; страница также используется в Vite, но Vite content применяет собственные промпты. Поддерживаются только {url}, {title}, {summary}, {content}, {browserContext}, {noteTitle}, {noteExcerpt}, {selection}. Обнаружены: ${initial.variables}.${initial.unsupported} Сохраните изменения и запустите действие заново; существующий результат/кэш не пересчитывается.`;
    const previewDetails = document.createElement('details');
    previewDetails.className = 'prompt-preview';
    const previewSummary = document.createElement('summary');
    previewSummary.textContent = 'Предпросмотр промпта с примером контекста';
    const preview = document.createElement('pre');
    preview.textContent = initial.rendered;
    previewDetails.append(previewSummary, preview);
    textarea.insertAdjacentElement('afterend', meta);
    meta.insertAdjacentElement('afterend', previewDetails);
    textarea.addEventListener('input', () => {
      const current = describeActionPreview(textarea.value);
      preview.textContent = current.rendered;
      meta.textContent = `Черновик, ещё не сохранён. Поддерживаются только {url}, {title}, {summary}, {content}, {browserContext}, {noteTitle}, {noteExcerpt}, {selection}. Обнаружены: ${current.variables}.${current.unsupported}`;
    });
  });

  // Prompt reset helpers (UI only; user still clicks Save)
  const resetLegacyPrompt = (key) => {
    const field = LEGACY_PROMPT_SETTINGS[key];
    if (field) {
      document.getElementById(field).value = '';
      settings[field] = '';
    }
    delete promptOverrides[key];
    resetPromptKeys.add(key);
    const editor = document.getElementById(`promptOverride_${key}`);
    const defaultValue = PROMPT_REGISTRY_DEFAULTS[key] || '';
    if (editor) editor.value = defaultValue;
    const preview = document.getElementById(`promptPreview_${key}`);
    if (preview) preview.textContent = promptPreviewText(defaultValue, key);
    const legacyPreview = document.getElementById(`legacyPromptPreview_${key}`);
    if (legacyPreview) legacyPreview.textContent = promptPreviewText(defaultValue, key);
    const source = `Общий runtime default. Сброс удалил сохранённые legacy- и registry-overrides; сохранится после нажатия «Сохранить настройки». ${promptVariableDescription(defaultValue, key)}`;
    const legacyMeta = document.getElementById(`legacyPromptMeta_${key}`);
    if (legacyMeta) legacyMeta.textContent = source;
    const registryMeta = document.getElementById(`promptRegistryMeta_${key}`);
    if (registryMeta) registryMeta.textContent = `${source} Приоритет: legacy > registry override > общий default.`;
  };
  document.getElementById('resetSummaryPromptBtn')?.addEventListener('click', () => resetLegacyPrompt('summary'));
  document.getElementById('resetSummaryJsonPromptBtn')?.addEventListener('click', () => resetLegacyPrompt('summaryJson'));
  document.getElementById('resetSectionEnrichPromptBtn')?.addEventListener('click', () => resetLegacyPrompt('sectionEnrich'));

  document.getElementById('resetAllActionPromptsBtn')?.addEventListener('click', () => {
    for (const [key, value] of Object.entries(DEFAULT_ACTION_PROMPTS)) {
      const el = document.getElementById(`actionPrompt_${key}`);
      if (el) {
        el.value = value;
        el.dispatchEvent(new Event('input', { bubbles: true }));
      }
    }
  });

  document.querySelectorAll('[data-reset-action]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const key = btn.getAttribute('data-reset-action');
      const el = document.getElementById(`actionPrompt_${key}`);
      if (el && typeof DEFAULT_ACTION_PROMPTS[key] === 'string') {
        el.value = DEFAULT_ACTION_PROMPTS[key];
        el.dispatchEvent(new Event('input', { bubbles: true }));
      }
    });
  });

  document.getElementById('resetAllPromptOverridesBtn')?.addEventListener('click', () => {
    for (const key of REGISTRY_EDITOR_KEYS) {
      const el = document.getElementById(`promptOverride_${key}`);
      if (el) el.value = PROMPT_REGISTRY_DEFAULTS[key];
      if (LEGACY_PROMPT_SETTINGS[key]) resetLegacyPrompt(key);
      else {
        delete promptOverrides[key];
        resetPromptKeys.add(key);
        const preview = document.getElementById(`promptPreview_${key}`);
        if (preview) preview.textContent = promptPreviewText(PROMPT_REGISTRY_DEFAULTS[key], key);
        const meta = document.getElementById(`promptRegistryMeta_${key}`);
        if (meta) meta.textContent = `Общий runtime default. Сброс удалил сохранённый registry override; сохранится после нажатия «Сохранить настройки». ${promptVariableDescription(PROMPT_REGISTRY_DEFAULTS[key], key)}`;
      }
    }
  });

  document.querySelectorAll('[data-reset-prompt]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const key = btn.getAttribute('data-reset-prompt');
      const el = key ? document.getElementById(`promptOverride_${key}`) : null;
      if (!REGISTRY_EDITOR_KEYS.includes(key)) return;
      if (LEGACY_PROMPT_SETTINGS[key]) resetLegacyPrompt(key);
      else {
        if (el && typeof PROMPT_REGISTRY_DEFAULTS[key] === 'string') el.value = PROMPT_REGISTRY_DEFAULTS[key];
        delete promptOverrides[key];
        resetPromptKeys.add(key);
        const preview = document.getElementById(`promptPreview_${key}`);
        if (preview) preview.textContent = promptPreviewText(PROMPT_REGISTRY_DEFAULTS[key], key);
        const meta = document.getElementById(`promptRegistryMeta_${key}`);
        if (meta) meta.textContent = `Общий runtime default. Сброс удалил сохранённый registry override; сохранится после нажатия «Сохранить настройки». ${promptVariableDescription(PROMPT_REGISTRY_DEFAULTS[key], key)}`;
      }
    });
  });

  document.getElementById('refreshArtifactsBtn')?.addEventListener('click', () => {
    refreshArtifactList();
  });

  document.getElementById('artifactList')?.addEventListener('click', async (event) => {
    const btn = event.target.closest('[data-artifact-action]');
    const item = event.target.closest('[data-artifact-id]');
    if (!btn || !item) return;

    const id = item.getAttribute('data-artifact-id');
    const action = btn.getAttribute('data-artifact-action');
    if (!id || !action) return;

    const prev = btn.textContent;
    btn.textContent = '...';
    try {
      if (action === 'delete') {
        await sendRuntimeMessage('deleteArtifact', { id });
        await refreshArtifactList();
        return;
      }

      const artifact = await sendRuntimeMessage('getArtifact', { id });
      const filename = safeFilename(artifact?.title || 'Rox Discovery');

      if (action === 'html') {
        downloadTextFile(`${filename}.html`, artifact?.html || '', 'text/html;charset=utf-8');
      } else if (action === 'markdown') {
        downloadTextFile(`${filename}.md`, artifact?.markdown || artifact?.text || '', 'text/markdown;charset=utf-8');
      } else if (action === 'telegram') {
        await sendRuntimeMessage('sendTelegramArtifact', { artifact });
        setTelegramStatus(`Отправлено в Telegram: ${artifact?.title || filename}`, 'ok');
      }
    } catch (e) {
      setTelegramStatus(e.message || 'Artifact action failed', 'error');
    } finally {
      if (btn.isConnected) btn.textContent = prev;
    }
  });

  document.getElementById('testTelegramBtn')?.addEventListener('click', async () => {
    if (!confirm('Отправить тестовое сообщение с уже сохранёнными настройками Telegram? Черновик на этой странице не сохраняется и не отправляется.')) return;
    setTelegramStatus('Отправляю тест сохранённой конфигурации…', '');
    try {
      await sendRuntimeMessage('testTelegram', { message: `Rox Discovery Telegram test: ${new Date().toISOString()}` });
      setTelegramStatus('Тест отправлен через сохранённую конфигурацию Telegram.', 'ok');
    } catch (e) {
      setTelegramStatus(e.message || 'Не удалось отправить тест Telegram', 'error');
    }
  });

  refreshArtifactList();

  // Toggles
  document.getElementById('autoSummarize').checked = settings.autoSummarize !== false;
  document.getElementById('classicMode').checked = settings.classicMode || false;
  document.getElementById('privacyEnabled').checked = settings.privacyEnabled !== false;

  // BYOK mode toggle
  const unlimitedMode = document.getElementById('unlimitedMode');
  const byokMode = document.getElementById('byokMode');
  const coreByok = document.getElementById('coreByok');
  const voiceByok = document.getElementById('voiceByok');
  const hasConfiguredKeys = Boolean(groqKeysEl?.value || joinKeyLines(settings.cerebrasApiKeys));

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

  updateModeUI(settings.byokMode !== false || hasConfiguredKeys);
  const status = document.getElementById('status');
  const markDraft = () => {
    if (!status) return;
    status.textContent = 'Есть несохранённые изменения — нажмите «Сохранить настройки».';
    status.className = 'status show';
  };
  status.textContent = 'Настройки загружены. Изменения сохраняются только кнопкой «Сохранить настройки».';
  status.className = 'status show';
  document.querySelectorAll('input, textarea, select').forEach((field) => {
    field.addEventListener('input', markDraft);
    field.addEventListener('change', markDraft);
  });
  document.querySelectorAll('[data-reset-action], [data-reset-prompt], #resetAllActionPromptsBtn, #resetAllPromptOverridesBtn, #resetSummaryPromptBtn, #resetSummaryJsonPromptBtn, #resetSectionEnrichPromptBtn, #unlimitedMode, #byokMode').forEach((button) => {
    button.addEventListener('click', markDraft);
  });

  // Provider switching: keep last model per provider
  if (providerEl && modelEl) {
    providerEl.addEventListener('change', () => {
      const p = String(providerEl.value || 'groq').toLowerCase();
      const provider = (p === 'cerebras') ? 'cerebras' : 'groq';
      modelEl.value = getModelForProvider(provider);
      setModelOptionsVisibility(provider);
    });
  }

  unlimitedMode.addEventListener('click', () => updateModeUI(false));
  byokMode.addEventListener('click', () => updateModeUI(true));

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

    const groqApiKeys = dedupeStrings(parseKeyLines(document.getElementById('groqApiKeys')?.value));
    const cerebrasApiKeys = dedupeStrings(parseKeyLines(document.getElementById('cerebrasApiKeys')?.value));

    const maxParallelRequestsRaw = Number(document.getElementById('maxParallelRequests')?.value);
    const maxParallelRequests = Number.isFinite(maxParallelRequestsRaw) ? Math.max(1, Math.min(200, Math.round(maxParallelRequestsRaw))) : DEFAULT_MAX_PARALLEL_REQUESTS;

    const targetMaxOutputTokensRaw = Number(document.getElementById('targetMaxOutputTokens')?.value);
    const targetMaxOutputTokens = Number.isFinite(targetMaxOutputTokensRaw) ? Math.max(64, Math.min(DEFAULT_TARGET_MAX_OUTPUT_TOKENS, Math.round(targetMaxOutputTokensRaw))) : DEFAULT_TARGET_MAX_OUTPUT_TOKENS;

    const prefetchOnHover = document.getElementById('prefetchOnHover')?.checked === true;
    const prefetchDelayMsRaw = Number(document.getElementById('prefetchDelayMs')?.value);
    const prefetchDelayMs = Number.isFinite(prefetchDelayMsRaw) ? Math.max(0, Math.min(2000, Math.round(prefetchDelayMsRaw))) : DEFAULT_PREFETCH_DELAY_MS;

    const mapReduceEnabled = document.getElementById('mapReduceEnabled')?.checked !== false;
    const nextPromptOverrides = collectPromptOverrides();
    const nextActionPrompts = collectActionPromptOverrides();

    await Promise.all([
      chrome.storage.sync.set({
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
      byokMode: byokMode.classList.contains('active'),
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
      artifactAutoSave: document.getElementById('artifactAutoSave')?.checked === true,
      promptOverrides: nextPromptOverrides,
      actionPrompts: nextActionPrompts
      }),
      chrome.storage.local.set({
        telegramEnabled: document.getElementById('telegramEnabled')?.checked === true,
        telegramBotToken: document.getElementById('telegramBotToken')?.value || '',
        telegramChatId: document.getElementById('telegramChatId')?.value || '',
        telegramSendHtml: document.getElementById('telegramSendHtml')?.checked !== false,
        telegramSendMarkdown: document.getElementById('telegramSendMarkdown')?.checked === true,
        obsidianBridgeToken: document.getElementById('obsidianBridgeToken')?.value.trim() || ''
      })
    ]);
    
    status.textContent = 'Все изменения сохранены.';
    status.className = 'status show success';
  });

  // Reset
  document.getElementById('resetBtn').addEventListener('click', async () => {
    const confirmed = confirm('Сбросить все настройки из chrome.storage.sync, настройки Telegram и токен локального Obsidian-моста из chrome.storage.local, а также статистику трекеров? Это включает сохранённые API-ключи и prompt overrides. Архив страниц и другие локальные данные не удаляются.');
    if (!confirmed) return;
    await chrome.storage.sync.clear();
    await chrome.storage.local.remove([
      'telegramEnabled',
      'telegramBotToken',
      'telegramChatId',
      'telegramSendHtml',
      'telegramSendMarkdown',
      'obsidianBridgeToken'
    ]);
    try {
      await sendRuntimeMessage('resetTrackerStats');
    } catch (error) {
      // Older/Vite backgrounds may not keep tracker stats; settings reset must still finish.
      console.warn('Tracker statistics could not be reset', error);
    }
    location.reload();
  });
});
