// ============ @pzdrk v6.3 - Intelligence Edition ============

let currentNotes = [];
let noteStackY = 60;
let isProcessing = false;
let lastSummaryContent = '';
let lastSummaryData = null;
let activeActions = new Set();
let actionsAnchorNote = null; // main note that owns the right-side action panel
let browserContext = null;
let conversationHistory = [];
let trackersBlocked = 0;
let pageTokenCount = 0;
let summaryTokenCount = 0;
let actionFlyout = null;
let noteResizeObserver = null;
let layoutScheduled = false;

// Cached settings snapshot (best-effort)
let runtimeSettings = null;

// Voice recording for input
let mediaRecorder = null;
let audioChunks = [];
let isRecording = false;
let recordingIndicator = null;

// Voice playback
let activeAudio = null;
let activeAudioUrl = null;

// Per-note chat
const noteChats = new Map();

// UI timers
const collapseTimers = new WeakMap();

// API Keys
const DEFAULT_GROQ_KEY = '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';
const DEFAULT_EXA_KEY = 'bebe84f2-7740-4b67-b9d6-91edbecb080f';
const XAI_VOICE_KEY = 'xai-GIuMtBSOO3KnHNYgmd69NFdzLIDCuo6ZjJ23q3Sbe3fjEtbHLte15KHNaB27k88O5E4v7k3CPSckQMxf';
const SLACK_WEBHOOK = 'https://hooks.slack.com/triggers/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';

const PZDRK_LOGO_URL = chrome.runtime.getURL('icons/pzdrk.png');

const defaultTags = ['#dev', '#llm', '#anduril', '#tana', '#robotics'];

// ============ TOKEN ESTIMATION ============

function estimateTokens(text) {
  // Rough estimate: ~4 chars per token for English, ~2 for Russian
  const cyrillicRatio = (text.match(/[а-яёА-ЯЁ]/g) || []).length / text.length;
  const charsPerToken = cyrillicRatio > 0.3 ? 2 : 4;
  return Math.ceil(text.length / charsPerToken);
}

// ============ CACHE ============

// Bump to invalidate old summaries when prompts/layout change
const CACHE_PREFIX = 'pzdrk_cache_v3_';
const CACHE_EXPIRY = 7 * 24 * 60 * 60 * 1000;

function getCacheKey(url) { return CACHE_PREFIX + btoa(url).substring(0, 50); }

function getCache(url) {
  try {
    const data = localStorage.getItem(getCacheKey(url));
    if (!data) return null;
    const parsed = JSON.parse(data);
    if (Date.now() - parsed.timestamp > CACHE_EXPIRY) { localStorage.removeItem(getCacheKey(url)); return null; }
    if (!parsed.format) parsed.format = 'markdown';
    return parsed;
  } catch (e) { return null; }
}

function setCache(url, summary, format = 'markdown') {
  try { localStorage.setItem(getCacheKey(url), JSON.stringify({ format, summary, timestamp: Date.now(), url })); } catch (e) {}
}

// ============ MONDAY-STYLE PERSONA (applies to ALL outputs) ============

const MONDAY_PERSONA = `Ты — саркастичный AI-комментатор в стиле Monday (умный сухой сарказм).
Тон: спокойный, профессиональный, лаконичный.
Сарказм: точечно (0–1 короткая фраза на ответ), без театра.
Запрещено: "*вздох*", нытьё, истерика, лишние эмоции.
Доказательно: отделяй факты от предположений, отмечай уровень уверенности.
Язык: простой русский.`;

const STYLE_RULES = `${MONDAY_PERSONA}

ФОРМАТ:
- Структурно, без воды (лучше глубже, чем короче)
- Оборачивай сущности и термины: [[entity:Название]], [[term:термин]], [[wiki:статья]], [[evidence:факт]], [[action:шаг]]
- Практика и проверяемые утверждения важнее красивостей
- Если чего-то не знаешь — так и скажи, предложи как проверить`;

// ============ PROMPTS ============

const PROMPTS = {
  summary: `${STYLE_RULES}

Проанализируй страницу. ПОДРОБНЫЙ, консистентный разбор (без воды).

КОНТЕКСТ ПОЛЬЗОВАТЕЛЯ:
{browserContext}

ОБЯЗАТЕЛЬНО:
- Используй вкладки + историю + pathway, чтобы понять текущую задачу пользователя.
- Не выдумывай факты. Если не уверен — отметь это и предложи как проверить.
- Тон: Monday (профессионально, доказательно). Сарказм — максимум 1 короткая фраза.

Требования к объёму:
- 600–1200 слов (если контент большой — ближе к верхней границе)
- Тезисы и действия — конкретные и проверяемые.

СТРУКТУРА (ровно эти заголовки, в этом порядке):
## 📌 СУТЬ
(3–6 предложений)
## 🧭 КАРТА (ToC)
(6–14 пунктов: что тут есть)
## 🎯 КЛЮЧЕВЫЕ ТЕЗИСЫ
(8–16 буллетов; каждый с новой строки; используй [[entity:]], [[term:]], [[evidence:]], [[action:]])
## 🔍 ДЕТАЛИ (что важно)
(2–5 коротких абзацев)
## ⚠️ РИСКИ / НЕЯСНОСТИ
(3–8 буллетов)
## 💡 TIL
(4–10 буллетов формата "Today I learned: ...")
## 🔗 СВЯЗЬ С КОНТЕКСТОМ
(2–4 гипотезы: что пользователь делает + почему (из истории/вкладок))
## ⚡ ДЕЙСТВИЯ
(5–10 действий в виде [[action:...]] + 1 строка пояснения под каждым)

ТЕГИ: {tags}`,

  summaryJson: `${STYLE_RULES}

Верни ТОЛЬКО валидный JSON объект (без Markdown code blocks и без комментариев).

КОНТЕКСТ ПОЛЬЗОВАТЕЛЯ:
{browserContext}

СХЕМА:
{
  "title": "Короткий заголовок",
  "sections": [
    {
      "key": "core", 
      "emoji": "📌",
      "label": "СУТЬ",
      "left": ["..."],
      "right": {
        "commentary": ["..."],
        "terms": [{"term": "...", "definition": "..."}],
        "entities": [{"name": "...", "context": "...", "exaQuery": "..."}],
        "refs": [{"query": "...", "why": "..."}]
      }
    }
  ],
  "til": ["Today I learned: ..."],
  "actions": ["[[action:...]] — ..."]
}

ПРАВИЛА:
- sections: 6–10 (каждая с emoji + label).
- left: 4–9 пунктов на секцию (строки без "- "). Делай плотные, проверяемые формулировки.
- right.commentary: 1–3 коротких абзаца. Комментарии можно выделять *курсивом*.
- right.terms: 3–6 (включай [[term:...]] внутри definition или commentary при уместности).
- right.entities: 3–6 (exaQuery должен быть осмысленным поисковым запросом).
- В текстовых полях (left/commentary/definition/context/actions) помечай важное через [[entity:...]], [[term:...]], [[evidence:...]], [[action:...]].
- Не выдумывай факты. Если не уверен — отметь и предложи как проверить.
- Язык: русский. Тон: Monday (профессионально, доказательно). Сарказм ≤ 1 фраза.

ТЕГИ: {tags}`,

  sectionEnrich: `${STYLE_RULES}

Ты получаешь ОДНУ секцию + контекст страницы. Верни ТОЛЬКО валидный JSON объект (без Markdown code blocks):
{
  "key": "same_key",
  "right": {
    "commentary": ["..."],
    "terms": [{"term": "...", "definition": "..."}],
    "entities": [{"name": "...", "context": "...", "exaQuery": "..."}],
    "refs": [{"query": "...", "why": "..."}]
  }
}

ПРАВИЛА:
- right.commentary: 2–5 коротких абзацев (часть можно *курсивом*).
- terms/entities: по 3–8.
- В commentaries/definitions/contexts активно используй [[entity:...]] / [[term:...]] / [[evidence:...]].
- Не повторяй left буллеты; дополняй, углубляй, добавляй связи/риски/проверки.
- Тон: Monday, без воды.
`,

  generateTitle: `Дай CATCHY заголовок на русском. 2-5 слов. Только заголовок.
Контент: {content}`,

  pageRanking: `Верни ТОЛЬКО JSON (без markdown/комментариев):
{
  "depth": 1-5,
  "depthExplanation": "почему такая глубина (в 1-2 предложениях)",
  "depthPercent": 0-100,
  "domain": "AI/Dev/Business/Science/Other",
  "domainExplanation": "почему именно эта категория",
  "domainConfidence": 0-100,
  "tags": ["#tag1", "#tag2"],
  "tagExplanations": {"#tag1": "почему тег и где в тексте (1 предложение)", "#tag2": "..."},
  "oneLineValue": "5 слов"
}

Контент: {content}`,

  voiceScript: `${MONDAY_PERSONA}

Подготовь текст для ОЗВУЧКИ в формате "guide through content" (120–220 слов).

Требования:
- Никакого театра, вздохов и лишних эмоций.
- Сарказм — сухой и точечный (0–1 фраза).
- Обязательно: (1) главное, (2) зачем это, (3) bullshit или нет + почему, (4) что делать дальше (3 шага), (5) куда углубляться.
- Если не уверен — прямо укажи, что проверить.
- Только обычный текст, без Markdown.

ДАННЫЕ:
URL: {url}
TITLE: {title}
DOMAIN: {domain}
DEPTH: {depth}/5

КОНТЕКСТ ПОЛЬЗОВАТЕЛЯ:
{browserContext}

SUMMARY:
{summary}

TOP LINKS:
{links}

PAGE SNIPPET:
{content}`,

  mindmap: `${STYLE_RULES}

Создай ГЛУБОКИЙ MINDMAP (базовая структура). Верни JSON:
{
  "title": "Заголовок",
  "nodes": [
    {
      "id": "1",
      "label": "Тема 1",
      "description": "Описание",
      "insights": ["Инсайт"],
      "children": []
    }
  ],
  "metadata": {"domain": "AI", "complexity": "high", "nodeCount": 0}
}

Требования:
- Минимум 6-8 главных веток (level 1).
- Глубина каждой ветки минимум 3-4 уровня.
- Всего должно быть минимум 50-60 узлов в сумме.
- Используй [[entity:]], [[term:]] в description.

КОНТЕНТ: {content}
SUMMARY: {summary}`,

  mindmapExpand: `${STYLE_RULES}

Ты — архитектор знаний. РАСШИРЬ ветку mindmap.
Ветка: "{label}" (Описание: {description})

Твоя задача: Сгенерировать JSON массив детей (children) для этой ветки.
Требования:
- 8-12 новых узлов (детей и внуков).
- Добавь конкретные инструменты, библиотеки, людей, статьи ([[entity:...]]).
- Добавь неочевидные связи и "подводные камни".
- Формат: Array of objects (id, label, description, insights, tips, children).

КОНТЕКСТ СТРАНИЦЫ:
{content}`,

  challenge: `${STYLE_RULES}

7-10 ПРОВОКАЦИОННЫХ вопросов с гипотезами и литературой:

**Q1: [Вопрос]**
- H1: [Гипотеза]
- H2: [Гипотеза]
- 📚 [Источник: DOI/URL]

## TOP-5 OBJECTIVES
1. **[Цель]**: [Краткое описание]. Команда: [[action:команда1]]
2. ...

## NEXT BEST PROMPTS (10 идей для exploration)
1. ...
...

КОНТЕНТ: {content}
SUMMARY: {summary}`,

  twitter: `${STYLE_RULES}
Превратить в Twitter тред (5-7 твитов по 280 символов). Хук первым. CTA последним.
КОНТЕНТ: {content}`,

  deepdive: `${STYLE_RULES}
Глубокий анализ. Неочевидные связи. [[entity:]], [[term:]], [[action:]].
КОНТЕНТ: {content}
КОНТЕКСТ: {context}`,

  automation: `${STYLE_RULES}
Как автоматизировать. API, n8n, Zapier. Конкретные шаги.
КОНТЕНТ: {content}`,

  learning: `${STYLE_RULES}
План изучения на 2 недели. Ресурсы, упражнения, проекты.
КОНТЕНТ: {content}`,

  share: `${STYLE_RULES}
Подготовь для шаринга:
1. Slack (3 предложения)
2. Email subject + 2 абзаца
3. LinkedIn пост
4. Telegram пост
КОНТЕНТ: {content}`,

  followUp: `${STYLE_RULES}
Контекст: {history}
Вопрос: {question}
Ответь кратко и профессионально. Сарказм — максимум 1 короткая фраза.`,

  actionToPrompt: `${STYLE_RULES}

Ты — prompt-инженер. Сгенерируй ОДИН готовый промпт для LLM, чтобы выполнить указанное действие.

Требования:
- Промпт должен быть самодостаточным: цель, входные данные, ограничения, шаги, формат ответа, критерии качества.
- Учитывай текущую страницу + браузерный контекст пользователя.
- Учитывай МЕСТО, где это действие появилось (секция и строка-источник) — это и есть "целеполагание".
- Не выдумывай факты. Если данных не хватает — добавь в промпт 2–4 уточняющих вопроса.
- Вывод: только промпт, без пояснений и без Markdown.

ACTION (what to do): {action}

ORIGIN (where this came from):
NOTE_TITLE: {noteTitle}
SECTION: {section}
LINE: {originLine}

PAGE:
URL: {url}
TITLE: {title}

USER BROWSER CONTEXT:
{browserContext}

PAGE SUMMARY:
{summary}

PAGE SNIPPET:
{content}`,

  createCommand: `${STYLE_RULES}

Ты — конструктор команд для расширения pzdrk.

Сгенерируй ОДИН JSON-объект команды (без markdown, без пояснений), строго по схеме:
{
  "id": "snake_case_id",
  "title": "Короткое имя (2-24 символа)",
  "icon": "Один emoji",
  "scope": "page" | "selection" | "global",
  "mode": "note" | "clipboard",
  "prompt": "Полный промпт пользователю (можно много строк). Используй плейсхолдеры: {url} {title} {summary} {content} {browserContext} {selection}",
  "system": "Системный промпт (опционально). Если пусто — будет STYLE_RULES"
}

Требования:
- Никаких лишних полей.
- prompt должен быть самодостаточным: цель, входные данные, формат ответа.
- Если команда зависит от выделения — scope=selection и используй {selection}.

ЗАПРОС ПОЛЬЗОВАТЕЛЯ (описание команды):
{request}`,

  workflowSuggestions: `${STYLE_RULES}

Сгенерируй 8 "Next Best Workflows" (следующих лучших действий) на основе контента.
Верни JSON:
[
  { "title": "Название", "desc": "Однострочное описание", "prompt": "Полный промпт для выполнения..." },
  ...
]

Требования:
- Разные роли (Dev, Product, Strategy, Critic).
- Конкретные, полезные задачи.
- Промпты должны быть готовы к исполнению.

КОНТЕНТ: {content}`
};

// ============ API FUNCTIONS ============

async function getSettings() {
  const settings = await chrome.storage.sync.get([
    'coreProvider',
    'tags', 'summaryPrompt', 'classicMode',
    'autoSummarize', 'privacyEnabled',
    'voiceProvider',
    'voiceChatMode', 'voicePersonality', 'autoSpeakSummary',
    'actionPrompts',
    'twoColumnSummary', 'summaryJsonPrompt', 'sectionEnrichPrompt',
    'maxParallelRequests', 'targetMaxOutputTokens',
    'prefetchOnHover', 'prefetchDelayMs',
    'mapReduceEnabled'
  ]);

  const maxParallelRaw = Number(settings.maxParallelRequests);
  const maxParallelRequests = Number.isFinite(maxParallelRaw) ? Math.max(1, Math.min(200, Math.round(maxParallelRaw))) : 12;
  const targetOutRaw = Number(settings.targetMaxOutputTokens);
  const targetMaxOutputTokens = Number.isFinite(targetOutRaw) ? Math.max(64, Math.min(4096, Math.round(targetOutRaw))) : 500;
  const prefetchDelayRaw = Number(settings.prefetchDelayMs);
  const prefetchDelayMs = Number.isFinite(prefetchDelayRaw) ? Math.max(0, Math.min(2000, Math.round(prefetchDelayRaw))) : 320;

  return {
    ...settings,
    coreProvider: String(settings.coreProvider || 'groq'),
    tags: settings.tags || defaultTags,
    autoSummarize: settings.autoSummarize !== false,
    classicMode: settings.classicMode || false,
    privacyEnabled: settings.privacyEnabled !== false,
    voiceProvider: settings.voiceProvider || 'xai',
    voiceChatMode: String(settings.voiceChatMode || 'off'),
    voicePersonality: String(settings.voicePersonality || 'Ara'),
    autoSpeakSummary: settings.autoSpeakSummary === true,
    actionPrompts: (settings.actionPrompts && typeof settings.actionPrompts === 'object') ? settings.actionPrompts : {},
    twoColumnSummary: settings.twoColumnSummary !== false,
    summaryJsonPrompt: String(settings.summaryJsonPrompt || ''),
    sectionEnrichPrompt: String(settings.sectionEnrichPrompt || ''),
    maxParallelRequests,
    targetMaxOutputTokens,
    prefetchOnHover: settings.prefetchOnHover !== false,
    prefetchDelayMs,
    mapReduceEnabled: settings.mapReduceEnabled !== false
  };
}

async function callGroq(prompt, systemPrompt, options = {}) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage({ action: 'callGroq', prompt, systemPrompt, options }, (response) => {
      if (chrome.runtime.lastError) { reject(new Error(chrome.runtime.lastError.message)); return; }
      if (response?.success) resolve(response.data);
      else reject(new Error(response?.error || 'API Error'));
    });
  });
}

async function callExa(query) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ action: 'searchExa', query }, (response) => {
      if (response?.success) resolve(response.data);
      else resolve([]);
    });
  });
}

async function getXaiRealtimeClientSecret(ttlSeconds = 300) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage({ action: 'xaiRealtimeClientSecret', ttlSeconds }, (response) => {
      if (chrome.runtime.lastError) { reject(new Error(chrome.runtime.lastError.message)); return; }
      if (response?.success) resolve(response.data);
      else reject(new Error(response?.error || 'xAI Realtime Error'));
    });
  });
}

async function getBrowserContext() {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ action: 'getBrowserContext', days: 30 }, (response) => {
      if (response?.success) resolve(response.data);
      else resolve({ openTabs: [], recentHistory: [] });
    });
  });
}

async function fetchUrlMeta(url) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage({ action: 'fetchUrlMeta', url }, (response) => {
      if (chrome.runtime.lastError) { reject(new Error(chrome.runtime.lastError.message)); return; }
      if (response?.success) resolve(response.data);
      else reject(new Error(response?.error || 'Preview Error'));
    });
  });
}

function stopActiveAudio() {
  try { if (activeAudio) activeAudio.pause(); } catch (e) {}
  activeAudio = null;
  if (activeAudioUrl) {
    try { URL.revokeObjectURL(activeAudioUrl); } catch (e) {}
    activeAudioUrl = null;
  }
  try { if ('speechSynthesis' in window) window.speechSynthesis.cancel(); } catch (e) {}
  stopXaiRealtimePlayback();
}

async function playAudioBase64(audioBase64, mime = 'audio/mpeg') {
  const binaryString = atob(audioBase64);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) bytes[i] = binaryString.charCodeAt(i);
  const blob = new Blob([bytes], { type: mime });
  const url = URL.createObjectURL(blob);
  activeAudioUrl = url;
  const audio = new Audio(url);
  activeAudio = audio;
  audio.addEventListener('ended', () => {
    if (activeAudioUrl === url) {
      try { URL.revokeObjectURL(url); } catch (e) {}
      activeAudioUrl = null;
      activeAudio = null;
    }
  });
  await audio.play();
}

function speakWithBrowserTTS(text) {
  if (!('speechSynthesis' in window)) throw new Error('Browser TTS недоступен');
  stopActiveAudio();
  const utter = new SpeechSynthesisUtterance(text);
  utter.lang = 'ru-RU';
  utter.rate = 1.05;
  utter.pitch = 1;
  window.speechSynthesis.speak(utter);
}

async function speakWithGrok(text, { fallbackToBrowser = true } = {}) {
  stopActiveAudio();
  const result = await new Promise((resolve, reject) => {
    chrome.runtime.sendMessage({ action: 'speakGrok', text }, (response) => {
      if (chrome.runtime.lastError) { reject(new Error(chrome.runtime.lastError.message)); return; }
      if (response?.success) resolve(response.data);
      else reject(new Error(response?.error || 'Voice Error'));
    });
  });

  if (result?.audioBase64) {
    await playAudioBase64(result.audioBase64, result.mime);
    return;
  }

  if (fallbackToBrowser) {
    showToast('⚠️ Using Browser Voice (Grok Unavailable)');
    speakWithBrowserTTS(text);
    return;
  }

  throw new Error('Voice: нет аудио в ответе');
}

// ============ XAI REALTIME VOICE (WebSocket) ============

const XAI_REALTIME_WS_URL = 'wss://api.x.ai/v1/realtime';
const XAI_REALTIME_AUDIO_RATE = 48000;

let xaiRealtimeWs = null;
let xaiRealtimeConnectPromise = null;
let xaiRealtimeAssistantTranscript = '';

let xaiRealtimePlaybackCtx = null;
let xaiRealtimePlaybackGain = null;
let xaiRealtimePlaybackNextTime = 0;
let xaiRealtimePlaybackSources = [];

let xaiRealtimeMicStream = null;
let xaiRealtimeMicCtx = null;
let xaiRealtimeMicSource = null;
let xaiRealtimeMicProcessor = null;
let xaiRealtimeMicZeroGain = null;
let xaiRealtimeIsRecording = false;

let xaiRealtimeTranscriptNote = null;
let xaiRealtimeTranscriptLines = [];

function normalizeXaiRealtimeVoice(v) {
  const s = String(v || '').trim().toLowerCase();
  if (s === 'ara') return 'Ara';
  if (s === 'rex') return 'Rex';
  if (s === 'sal') return 'Sal';
  if (s === 'eve') return 'Eve';
  if (s === 'leo') return 'Leo';
  return 'Ara';
}

function base64ToUint8Array(base64) {
  const bin = atob(String(base64 || ''));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function uint8ArrayToBase64(bytes) {
  const chunk = 0x8000;
  let binary = '';
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function sendXaiRealtimeEvent(evt) {
  if (!xaiRealtimeWs || xaiRealtimeWs.readyState !== WebSocket.OPEN) return false;
  try {
    xaiRealtimeWs.send(JSON.stringify(evt));
    return true;
  } catch (e) {
    return false;
  }
}

function ensureXaiRealtimeTranscriptNote() {
  if (xaiRealtimeTranscriptNote && xaiRealtimeTranscriptNote.isConnected) return xaiRealtimeTranscriptNote;

  xaiRealtimeTranscriptLines = [];
  const note = createNote({
    title: '🎙️ Voice Chat',
    type: 'qa',
    content: '<pre class="pzdrk-voice-log" style="white-space:pre-wrap;margin:0"></pre>',
    collapsed: false,
    loading: false
  });
  note.dataset.pinned = 'true';
  xaiRealtimeTranscriptNote = note;
  return note;
}

function updateXaiRealtimeTranscriptNote() {
  const note = ensureXaiRealtimeTranscriptNote();
  const pre = note.querySelector('.pzdrk-voice-log');
  if (pre) pre.textContent = xaiRealtimeTranscriptLines.join('\n\n');
}

function pushXaiRealtimeTranscriptLine(prefix, text) {
  const t = String(text || '').trim();
  if (!t) return;
  xaiRealtimeTranscriptLines.push(`${prefix}: ${t}`);
  updateXaiRealtimeTranscriptNote();
}

function stopXaiRealtimePlayback() {
  try {
    xaiRealtimePlaybackSources.forEach(s => {
      try { s.stop(0); } catch (e) {}
    });
  } catch (e) {}
  xaiRealtimePlaybackSources = [];
  xaiRealtimePlaybackNextTime = 0;
  if (xaiRealtimePlaybackCtx) {
    try { xaiRealtimePlaybackCtx.close(); } catch (e) {}
  }
  xaiRealtimePlaybackCtx = null;
  xaiRealtimePlaybackGain = null;
}

function appendXaiRealtimeAudioDelta(deltaBase64, rate = XAI_REALTIME_AUDIO_RATE) {
  const bytes = base64ToUint8Array(deltaBase64);
  if (!bytes.length) return;

  const sampleCount = Math.floor(bytes.byteLength / 2);
  if (sampleCount <= 0) return;

  const int16 = new Int16Array(bytes.buffer, bytes.byteOffset, sampleCount);
  const float32 = new Float32Array(sampleCount);
  for (let i = 0; i < sampleCount; i++) float32[i] = int16[i] / 32768;

  if (!xaiRealtimePlaybackCtx) {
    try {
      xaiRealtimePlaybackCtx = new AudioContext({ sampleRate: rate });
    } catch (e) {
      xaiRealtimePlaybackCtx = new AudioContext();
    }
    xaiRealtimePlaybackGain = xaiRealtimePlaybackCtx.createGain();
    xaiRealtimePlaybackGain.gain.value = 1;
    xaiRealtimePlaybackGain.connect(xaiRealtimePlaybackCtx.destination);
    xaiRealtimePlaybackNextTime = xaiRealtimePlaybackCtx.currentTime;
  }

  if (xaiRealtimePlaybackCtx.state === 'suspended') {
    xaiRealtimePlaybackCtx.resume().catch(() => {});
  }

  const buf = xaiRealtimePlaybackCtx.createBuffer(1, float32.length, xaiRealtimePlaybackCtx.sampleRate);
  buf.getChannelData(0).set(float32);

  const src = xaiRealtimePlaybackCtx.createBufferSource();
  src.buffer = buf;
  src.connect(xaiRealtimePlaybackGain);

  const startAt = Math.max(xaiRealtimePlaybackCtx.currentTime, xaiRealtimePlaybackNextTime);
  src.start(startAt);
  xaiRealtimePlaybackNextTime = startAt + buf.duration;

  xaiRealtimePlaybackSources.push(src);
  src.onended = () => {
    xaiRealtimePlaybackSources = xaiRealtimePlaybackSources.filter(x => x !== src);
  };
}

function buildXaiRealtimeInstructions() {
  const ctxText = formatBrowserContext(browserContext);
  const summaryText = (lastSummaryContent || '').substring(0, 2500);
  return `Ты — голосовой ассистент в браузере. Отвечай по-русски, кратко и по делу.\n\nPAGE: ${window.location.href}\nTITLE: ${document.title}\n\nBROWSER CONTEXT:\n${ctxText}\n\nSUMMARY (may be partial):\n${summaryText}`;
}

function openWebSocketWithTimeout(url, protocols, timeoutMs = 8000) {
  return new Promise((resolve, reject) => {
    let ws;
    try {
      ws = protocols ? new WebSocket(url, protocols) : new WebSocket(url);
    } catch (e) {
      reject(e);
      return;
    }

    const timer = setTimeout(() => {
      try { ws.close(); } catch (e) {}
      reject(new Error('Realtime WS timeout'));
    }, timeoutMs);

    ws.onopen = () => {
      clearTimeout(timer);
      resolve(ws);
    };

    ws.onerror = () => {
      clearTimeout(timer);
      try { ws.close(); } catch (e) {}
      reject(new Error('Realtime WS error'));
    };
  });
}

async function connectXaiRealtimeWebSocket(ephemeralToken) {
  const token = String(ephemeralToken || '').trim();
  if (!token) throw new Error('Realtime: missing token');

  const attempts = [
    { url: XAI_REALTIME_WS_URL, protocols: [token] },
    { url: XAI_REALTIME_WS_URL, protocols: ['realtime', token] },
    { url: XAI_REALTIME_WS_URL, protocols: ['realtime', `xai-ephemeral-token.${token}`] },
    { url: XAI_REALTIME_WS_URL, protocols: ['realtime', `bearer.${token}`] },
    { url: XAI_REALTIME_WS_URL, protocols: ['xai', token] },
    { url: `${XAI_REALTIME_WS_URL}?access_token=${encodeURIComponent(token)}`, protocols: null }
  ];

  let lastErr = null;
  for (const a of attempts) {
    try {
      return await openWebSocketWithTimeout(a.url, a.protocols);
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr || new Error('Realtime: cannot connect');
}

function attachXaiRealtimeHandlers(ws) {
  ws.onmessage = (event) => {
    let msg;
    try {
      msg = JSON.parse(String(event.data || '{}'));
    } catch (e) {
      return;
    }

    const type = String(msg?.type || '');
    if (type === 'response.output_audio.delta') {
      appendXaiRealtimeAudioDelta(msg.delta, XAI_REALTIME_AUDIO_RATE);
      return;
    }

    if (type === 'response.output_audio_transcript.delta') {
      xaiRealtimeAssistantTranscript += String(msg.delta || '');
      return;
    }

    if (type === 'response.output_audio_transcript.done') {
      if (xaiRealtimeAssistantTranscript.trim()) pushXaiRealtimeTranscriptLine('Assistant', xaiRealtimeAssistantTranscript);
      xaiRealtimeAssistantTranscript = '';
      return;
    }

    if (type === 'conversation.item.input_audio_transcription.completed') {
      pushXaiRealtimeTranscriptLine('You', msg.transcript || '');
      return;
    }

    if (type === 'error') {
      const em = msg?.error?.message || msg?.message || 'unknown';
      pushXaiRealtimeTranscriptLine('Error', em);
      return;
    }
  };

  ws.onclose = () => {
    xaiRealtimeWs = null;
    stopXaiRealtimePlayback();
  };
}

async function ensureXaiRealtimeConnected(settings) {
  if (xaiRealtimeWs && xaiRealtimeWs.readyState === WebSocket.OPEN) return xaiRealtimeWs;
  if (xaiRealtimeConnectPromise) return xaiRealtimeConnectPromise;

  xaiRealtimeConnectPromise = (async () => {
    const secret = await getXaiRealtimeClientSecret(300);
    const token = secret?.value;
    const ws = await connectXaiRealtimeWebSocket(token);
    xaiRealtimeWs = ws;
    attachXaiRealtimeHandlers(ws);

    const voice = normalizeXaiRealtimeVoice(settings?.voicePersonality);
    const instructions = buildXaiRealtimeInstructions();

    sendXaiRealtimeEvent({
      type: 'session.update',
      session: {
        instructions,
        voice,
        turn_detection: { type: null },
        audio: {
          input: { format: { type: 'audio/pcm', rate: XAI_REALTIME_AUDIO_RATE } },
          output: { format: { type: 'audio/pcm', rate: XAI_REALTIME_AUDIO_RATE } }
        }
      }
    });

    return ws;
  })();

  try {
    return await xaiRealtimeConnectPromise;
  } finally {
    xaiRealtimeConnectPromise = null;
  }
}

async function xaiRealtimeSpeakText(text, settings) {
  const s = String(text || '').trim();
  if (!s) return;

  stopActiveAudio();
  const ws = await ensureXaiRealtimeConnected(settings);
  if (!ws || ws.readyState !== WebSocket.OPEN) throw new Error('Realtime: not connected');

  sendXaiRealtimeEvent({
    type: 'conversation.item.create',
    item: {
      type: 'message',
      role: 'user',
      content: [{ type: 'input_text', text: s }]
    }
  });
  sendXaiRealtimeEvent({ type: 'response.create', response: { modalities: ['text', 'audio'] } });
}

async function startXaiRealtimePushToTalk() {
  if (xaiRealtimeIsRecording) return;
  xaiRealtimeIsRecording = true;
  setRecordingIndicator(true);

  try {
    const settings = runtimeSettings || await getSettings().catch(() => ({}));
    runtimeSettings = settings;
    if (String(settings.voiceProvider || 'xai').toLowerCase() !== 'xai') {
      throw new Error('Realtime: voiceProvider должен быть xai');
    }

    stopActiveAudio();
    ensureXaiRealtimeTranscriptNote();

    await ensureXaiRealtimeConnected(settings);
    sendXaiRealtimeEvent({ type: 'input_audio_buffer.clear' });

    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (e) {
      throw new Error('Нет доступа к микрофону');
    }
    xaiRealtimeMicStream = stream;
    try {
      xaiRealtimeMicCtx = new AudioContext({ sampleRate: XAI_REALTIME_AUDIO_RATE });
    } catch (e) {
      xaiRealtimeMicCtx = new AudioContext();
    }

    if (xaiRealtimeMicCtx.state === 'suspended') {
      await xaiRealtimeMicCtx.resume().catch(() => {});
    }

    xaiRealtimeMicSource = xaiRealtimeMicCtx.createMediaStreamSource(stream);
    xaiRealtimeMicProcessor = xaiRealtimeMicCtx.createScriptProcessor(4096, 1, 1);
    xaiRealtimeMicZeroGain = xaiRealtimeMicCtx.createGain();
    xaiRealtimeMicZeroGain.gain.value = 0;

    xaiRealtimeMicProcessor.onaudioprocess = (e) => {
      if (!xaiRealtimeIsRecording) return;
      if (!xaiRealtimeWs || xaiRealtimeWs.readyState !== WebSocket.OPEN) return;

      const input = e.inputBuffer.getChannelData(0);
      const pcm = new Int16Array(input.length);
      for (let i = 0; i < input.length; i++) {
        let s = input[i];
        if (s > 1) s = 1;
        else if (s < -1) s = -1;
        pcm[i] = Math.round(s * 32767);
      }

      const b64 = uint8ArrayToBase64(new Uint8Array(pcm.buffer));
      sendXaiRealtimeEvent({ type: 'input_audio_buffer.append', audio: b64 });
    };

    xaiRealtimeMicSource.connect(xaiRealtimeMicProcessor);
    xaiRealtimeMicProcessor.connect(xaiRealtimeMicZeroGain);
    xaiRealtimeMicZeroGain.connect(xaiRealtimeMicCtx.destination);
  } catch (e) {
    xaiRealtimeIsRecording = false;
    setRecordingIndicator(false);
    try { xaiRealtimeMicProcessor && (xaiRealtimeMicProcessor.onaudioprocess = null); } catch (e2) {}
    try { xaiRealtimeMicProcessor && xaiRealtimeMicProcessor.disconnect(); } catch (e2) {}
    try { xaiRealtimeMicSource && xaiRealtimeMicSource.disconnect(); } catch (e2) {}
    try { xaiRealtimeMicZeroGain && xaiRealtimeMicZeroGain.disconnect(); } catch (e2) {}
    try { xaiRealtimeMicStream && xaiRealtimeMicStream.getTracks().forEach(t => t.stop()); } catch (e2) {}
    xaiRealtimeMicStream = null;
    xaiRealtimeMicSource = null;
    xaiRealtimeMicProcessor = null;
    xaiRealtimeMicZeroGain = null;
    if (xaiRealtimeMicCtx) {
      try { xaiRealtimeMicCtx.close(); } catch (e2) {}
    }
    xaiRealtimeMicCtx = null;
    throw e;
  }
}

function stopXaiRealtimePushToTalk() {
  if (!xaiRealtimeIsRecording) return;
  xaiRealtimeIsRecording = false;
  setRecordingIndicator(false);

  try { xaiRealtimeMicProcessor && (xaiRealtimeMicProcessor.onaudioprocess = null); } catch (e) {}
  try { xaiRealtimeMicProcessor && xaiRealtimeMicProcessor.disconnect(); } catch (e) {}
  try { xaiRealtimeMicSource && xaiRealtimeMicSource.disconnect(); } catch (e) {}
  try { xaiRealtimeMicZeroGain && xaiRealtimeMicZeroGain.disconnect(); } catch (e) {}
  try { xaiRealtimeMicStream && xaiRealtimeMicStream.getTracks().forEach(t => t.stop()); } catch (e) {}
  xaiRealtimeMicStream = null;
  xaiRealtimeMicSource = null;
  xaiRealtimeMicProcessor = null;
  xaiRealtimeMicZeroGain = null;
  if (xaiRealtimeMicCtx) {
    try { xaiRealtimeMicCtx.close(); } catch (e) {}
  }
  xaiRealtimeMicCtx = null;

  sendXaiRealtimeEvent({ type: 'input_audio_buffer.commit' });
  sendXaiRealtimeEvent({ type: 'response.create', response: { modalities: ['text', 'audio'] } });
}

async function transcribeAudio(audioBase64) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage({ action: 'transcribeAudio', audioBlob: audioBase64 }, (response) => {
      if (response?.success) resolve(response.data);
      else reject(new Error(response?.error || 'Transcribe Error'));
    });
  });
}

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const dataUrl = String(reader.result || '');
      const base64 = dataUrl.split(',')[1] || '';
      resolve(base64);
    };
    reader.onerror = () => reject(new Error('FileReader error'));
    reader.readAsDataURL(blob);
  });
}

function setRecordingIndicator(on) {
  if (on) {
    if (!recordingIndicator) {
      recordingIndicator = document.createElement('div');
      recordingIndicator.className = 'pzdrk-recording-indicator';
      recordingIndicator.innerHTML = '<span class="dot"></span><span>REC</span>';
      document.body.appendChild(recordingIndicator);
    }
    recordingIndicator.style.display = 'flex';
  } else {
    if (recordingIndicator) recordingIndicator.style.display = 'none';
  }
}

async function startVoiceRecording() {
  if (isRecording) return;
  isRecording = true;
  audioChunks = [];
  setRecordingIndicator(true);

  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch (e) {
    isRecording = false;
    setRecordingIndicator(false);
    throw new Error('Нет доступа к микрофону');
  }

  const preferred = 'audio/webm;codecs=opus';
  const mimeType = (globalThis.MediaRecorder?.isTypeSupported && MediaRecorder.isTypeSupported(preferred))
    ? preferred
    : 'audio/webm';

  try {
    mediaRecorder = new MediaRecorder(stream, { mimeType });
  } catch (e) {
    try { stream.getTracks().forEach(t => t.stop()); } catch (e2) {}
    isRecording = false;
    setRecordingIndicator(false);
    throw new Error('MediaRecorder недоступен');
  }

  mediaRecorder.ondataavailable = (e) => {
    if (e.data && e.data.size > 0) audioChunks.push(e.data);
  };

  mediaRecorder.onerror = () => {
    // will be handled on stop
  };

  mediaRecorder.onstop = async () => {
    setRecordingIndicator(false);
    try { stream.getTracks().forEach(t => t.stop()); } catch (e) {}

    const blob = new Blob(audioChunks, { type: mimeType });
    let base64 = '';
    try {
      base64 = await blobToBase64(blob);
    } catch (e) {
      showToast('Voice: не удалось прочитать аудио');
      return;
    }

    const transcriptNote = createNote({
      title: '🎙️ Transcript',
      type: 'qa',
      content: '<div class="pzdrk-loading"><div class="pzdrk-spinner"></div>Транскрипция…</div>',
      collapsed: false,
      loading: true
    });
    transcriptNote.dataset.pinned = 'true';

    let transcript = '';
    try {
      transcript = await transcribeAudio(base64);
    } catch (err) {
      transcriptNote.querySelector('.pzdrk-note-content').innerHTML = `<div class="pzdrk-error">❌ ${err.message}</div>`;
      transcriptNote.classList.remove('loading');
      return;
    }

    transcriptNote.querySelector('.pzdrk-note-content').innerHTML = `<div class="pzdrk-section-title">🎙️ Вопрос</div>${formatRichText(transcript)}`;
    transcriptNote.classList.remove('loading');
    setupHoverInteractions(transcriptNote);

    // Voice: allow on-the-fly command creation
    const cmdReq = extractCommandRequest(transcript);
    if (cmdReq) {
      const cmdNote = createNote({
        title: '➕ Command',
        type: 'action',
        content: '<div class="pzdrk-loading"><div class="pzdrk-spinner"></div>Создаю команду…</div>',
        collapsed: false,
        loading: true
      });
      cmdNote.dataset.pinned = 'true';

      try {
        const cmd = await createCustomCommandFromRequest(cmdReq);
        cmdNote.querySelector('.pzdrk-note-content').innerHTML = formatRichText(
          `## ✅ Команда добавлена\n- ${cmd.icon} **${cmd.title}**\n- scope: ${cmd.scope}\n- key: ${cmd.key ? cmd.key.toUpperCase() : '—'}\n- id: ${cmd.id}`
        );
        cmdNote.classList.remove('loading');
        setupHoverInteractions(cmdNote);
      } catch (e) {
        cmdNote.querySelector('.pzdrk-note-content').innerHTML = `<div class="pzdrk-error">❌ ${e.message}</div>`;
        cmdNote.classList.remove('loading');
      }
      return;
    }

    const answerNote = createNote({
      title: 'Ответ',
      type: 'qa',
      content: '<div class="pzdrk-loading"><div class="pzdrk-spinner"></div>Думаю…</div>',
      collapsed: false,
      loading: true
    });
    answerNote.dataset.pinned = 'true';

    try {
      const ctxText = formatBrowserContext(browserContext);
      const summaryText = (lastSummaryContent || '').substring(0, 2200);
      const historyText = [
        `PAGE: ${window.location.href}`,
        `TITLE: ${document.title}`,
        `BROWSER_CONTEXT:\n${ctxText}`,
        `SUMMARY:\n${summaryText}`
      ].join('\n');

      const prompt = PROMPTS.followUp
        .replace('{history}', historyText)
        .replace('{question}', transcript);

      const result = await callGroq(prompt, '');
      answerNote.querySelector('.pzdrk-note-content').innerHTML = formatRichText(result);
      answerNote.classList.remove('loading');
      setupHoverInteractions(answerNote);
    } catch (err) {
      answerNote.querySelector('.pzdrk-note-content').innerHTML = `<div class="pzdrk-error">❌ ${err.message}</div>`;
      answerNote.classList.remove('loading');
    }
  };

  mediaRecorder.start();
}

function stopVoiceRecording() {
  if (!isRecording) return;
  isRecording = false;
  try {
    if (mediaRecorder && mediaRecorder.state !== 'inactive') mediaRecorder.stop();
  } catch (e) {
    setRecordingIndicator(false);
  }
}

// Slack ALWAYS sends automatically - no toggle
async function sendToSlack(data) {
  chrome.runtime.sendMessage({ action: 'sendSlack', data });
}

async function getTrackerStats() {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ action: 'getTrackerStats' }, (response) => {
      if (response?.success) resolve(response.data);
      else resolve({ blocked: 0 });
    });
  });
}

// ============ CONTENT EXTRACTION ============

function formatBrowserContext(ctx) {
  if (!ctx || (!ctx.openTabs?.length && !ctx.recentHistory?.length && !ctx.visitTrail?.length)) return 'Контекст: недоступен';

  const fmt = (ms) => {
    if (!ms) return '';
    try {
      const d = new Date(ms);
      return d.toISOString().replace('T', ' ').slice(0, 16);
    } catch (e) {
      return '';
    }
  };

  const lines = [];
  lines.push(`[BROWSER CONTEXT] window=${ctx.windowDays || '?'}d • generated=${fmt(ctx.generatedAt)}`);

  if (ctx.openTabs?.length) {
    lines.push(`\n[OPEN TABS: ${ctx.openTabs.length}]`);
    ctx.openTabs.slice(0, 12).forEach(t => {
      const flags = `${t.active ? 'ACTIVE ' : ''}${t.pinned ? 'PIN ' : ''}`.trim();
      lines.push(`• ${flags ? `[${flags}] ` : ''}${(t.title || '').substring(0, 70)} — ${t.url}`);
    });
  }

  if (ctx.topDomains?.length) {
    lines.push(`\n[TOP DOMAINS (weighted by visits, ~${ctx.windowDays || '?'}d)]`);
    ctx.topDomains.slice(0, 8).forEach(d => {
      lines.push(`• ${d.domain} • visits=${d.visits || 0} • pages=${d.pages || 0} • last=${fmt(d.lastVisitTime)}`);
    });
  }

  if (ctx.visitTrail?.length) {
    lines.push(`\n[RECENT PATHWAY (visits, newest → oldest)]`);
    ctx.visitTrail.slice(0, 22).forEach(v => {
      const t = fmt(v.visitTime);
      const tr = v.transition ? ` • ${v.transition}` : '';
      lines.push(`• ${t}${tr} • ${(v.title || '').substring(0, 70)} — ${v.url}`);
    });
  } else if (ctx.recentHistory?.length) {
    lines.push(`\n[RECENT PAGES (unique URLs, newest → oldest)]`);
    ctx.recentHistory.slice(0, 15).forEach(h => {
      lines.push(`• ${fmt(h.lastVisitTime)} • ${(h.title || '').substring(0, 70)} — ${h.url}`);
    });
  }

  return lines.join('\n');
}

function detectLanguage(text) {
  const sample = text.substring(0, 500);
  const cyr = (sample.match(/[а-яёА-ЯЁ]/g) || []).length;
  const lat = (sample.match(/[a-zA-Z]/g) || []).length;
  return cyr > lat * 0.5 ? 'ru' : 'en';
}

// ============ TRANSLATION (Google translate unofficial) ============

const GOOGLE_TRANSLATE_ENDPOINT = 'https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&dt=t&dj=1';

function chunkTextForTranslate(text, maxLen = 3500, maxChunks = 15) {
  const chunks = [];
  let rest = String(text || '').trim();
  while (rest.length && chunks.length < maxChunks) {
    if (rest.length <= maxLen) {
      chunks.push(rest);
      break;
    }
    let cut = rest.lastIndexOf('\n', maxLen);
    if (cut < maxLen * 0.4) cut = rest.lastIndexOf('. ', maxLen);
    if (cut < maxLen * 0.4) cut = rest.lastIndexOf('! ', maxLen);
    if (cut < maxLen * 0.4) cut = rest.lastIndexOf('? ', maxLen);
    if (cut < maxLen * 0.4) cut = rest.lastIndexOf(' ', maxLen);
    if (cut <= 0) cut = maxLen;

    chunks.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }

  if (rest.length && chunks.length >= maxChunks) {
    chunks[chunks.length - 1] = (chunks[chunks.length - 1] + '\n\n' + rest).trim();
  }

  return chunks.filter(Boolean);
}

async function translateChunk(text, targetLang = 'ru') {
  const langNames = { 'ru': 'русский', 'en': 'английский', 'de': 'немецкий', 'fr': 'французский', 'es': 'испанский', 'zh': 'китайский', 'ja': 'японский' };
  const targetLangName = langNames[targetLang] || targetLang;

  const systemPrompt = `Ты — профессиональный переводчик. Переведи текст на ${targetLangName}.
Правила:
- Сохраняй структуру (заголовки: ##, списки: -, форматирование)
- Не добавляй и не убирай информацию
- Технические термины оставляй в оригинале, если нет общепринятого перевода
- Переводи только текст, без вступлений и комментариев
- Используй Markdown для форматирования (жирный: **текст**, курсив: *текст*)
- Не добавляй HTML теги`;

  const inTokens = estimateTokens(text);
  const maxTokens = Math.max(256, Math.min(2000, Math.round(inTokens * 1.8)));

  try {
    let translated = await callGroq(String(text || ''), systemPrompt, { temperature: 0.2, max_tokens: maxTokens });
    if (!translated || !translated.trim()) {
      const repair = `${systemPrompt}\n\nВажно: верни НЕ пустой перевод. Без комментариев.`;
      translated = await callGroq(String(text || ''), repair, { temperature: 0.2, max_tokens: maxTokens });
    }
    if ((targetLang === 'ru' || targetLang === 'en') && detectLanguage(translated) !== targetLang) {
      const repair = `${systemPrompt}\n\nВажно: переведи строго на ${targetLangName}. Без комментариев.`;
      translated = await callGroq(String(text || ''), repair, { temperature: 0.2, max_tokens: maxTokens });
    }
    if (!translated || !translated.trim()) throw new Error('Получен пустой перевод');
    return translated;
  } catch (e) {
    return `[Ошибка перевода: ${e.message}]\n\n${text}`;
  }
}

async function translateLargeText(text, targetLang = 'ru', onProgress) {
  const src = String(text || '').trim();
  if (!src) return '';

  const settings = runtimeSettings || await getSettings().catch(() => ({}));
  runtimeSettings = settings;

  const maxLen = src.length > 15000 ? 1200 : 2000;
  const chunks = chunkTextForTranslate(src, maxLen, 160);

  const langNames = { 'ru': 'русский', 'en': 'английский', 'de': 'немецкий', 'fr': 'французский', 'es': 'испанский', 'zh': 'китайский', 'ja': 'японский' };
  const targetLangName = langNames[targetLang] || targetLang;

  const systemPrompt = `Ты — профессиональный переводчик. Переведи текст на ${targetLangName}.
Правила:
- Сохраняй структуру (заголовки: ##, списки: -, форматирование)
- Не добавляй и не убирай информацию
- Технические термины оставляй в оригинале, если нет общепринятого перевода
- Переводи только текст, без вступлений и комментариев
- Используй Markdown для форматирования (жирный: **текст**, курсив: *текст*)
- Не добавляй HTML теги`;

  const results = new Array(chunks.length).fill('');
  const total = chunks.length;
  let done = 0;
  let nextRenderIdx = 0;
  let rendered = '';
  let lastUi = 0;

  const limit = Number(settings.maxParallelRequests) || 12;

  const maybeUpdate = () => {
    if (typeof onProgress !== 'function') return;
    const now = Date.now();
    if ((now - lastUi) < 250 && done < total) return;
    lastUi = now;
    onProgress({ done, total, rendered, nextRenderIdx });
  };

  await runWithConcurrency(chunks.map((chunk, index) => ({ chunk, index })), limit, async (item) => {
    const out = await translateChunk(item.chunk, targetLang);
    results[item.index] = out;
    done++;

    while (nextRenderIdx < total && results[nextRenderIdx]) {
      rendered += (rendered ? '\n\n' : '') + results[nextRenderIdx];
      nextRenderIdx++;
    }

    maybeUpdate();
  });

  done = total;
  rendered = results.join('\n\n');
  maybeUpdate();

  return rendered;
}

function extractPageContent(opts = {}) {
  const maxCharsRaw = (opts && typeof opts === 'object') ? Number(opts.maxChars) : NaN;
  const maxChars = Number.isFinite(maxCharsRaw) ? Math.max(2000, Math.min(500_000, Math.round(maxCharsRaw))) : 18000;

  const selectors = ['article', 'main', '[role="main"]', '.post-content', '.entry-content', '.content'];
  let container = null;
  for (const sel of selectors) { container = document.querySelector(sel); if (container) break; }
  if (!container) container = document.body;
  const clone = container.cloneNode(true);
  clone.querySelectorAll('script, style, nav, footer, header, aside, .pzdrk-note, [aria-hidden], .ad, .sidebar').forEach(el => el.remove());
  const raw = String(clone.innerText || '');
  const text = raw
    .replace(/\r/g, '')
    .replace(/[ \t\f\v]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .substring(0, maxChars);
  pageTokenCount = estimateTokens(text);
  return text;
}

function extractHeadings() {
  const headings = [];
  const seen = new Set();
  document.querySelectorAll('h1, h2, h3').forEach((h, idx) => {
    const text = h.innerText.trim();
    if (text && !h.closest('.pzdrk-note, nav, header, footer') && !seen.has(text)) {
      seen.add(text);
      const id = h.id || `pzdrk-h-${idx}`;
      if (!h.id) h.id = id;
      headings.push({ level: parseInt(h.tagName[1]), text: text.substring(0, 50), id });
    }
  });
  return headings.slice(0, 10);
}

async function ensureTILBullets(summaryText, pageContent, contextText) {
  const re = /(^##\s*💡\s*TIL[^\n]*\n)([\s\S]*?)(?=^##\s|\s*$)/im;
  const m = summaryText.match(re);
  if (!m) return summaryText;

  const header = m[1];
  const body = (m[2] || '').trim();
  const bullets = body
    .split('\n')
    .map(l => l.trim())
    .filter(l => /^[-•]\s+/.test(l));

  if (bullets.length >= 2 && bullets.length <= 12) return summaryText;

  const tilPrompt = `${STYLE_RULES}

Сгенерируй секцию "## 💡 TIL" заново.

Требования:
- Ровно 4–8 bullet points
- Каждый пункт строго с новой строки и начинается с "- "
- Формат пункта: "Today I learned: ..." (по-русски после двоеточия)
- Только список, без заголовка, без Markdown, без нумерации

КОНТЕКСТ ПОЛЬЗОВАТЕЛЯ:
${contextText}

СТРАНИЦА (кусок):
${pageContent.substring(0, 3500)}`;

  const til = await callGroq(tilPrompt, '', { temperature: 0.25, max_tokens: 900 });
  const cleaned = (til || '')
    .split('\n')
    .map(l => l.trim())
    .filter(Boolean)
    .map(l => {
      const x = l.replace(/^[-•]\s+/, '').trim();
      return x ? `- ${x}` : '';
    })
    .filter(Boolean)
    .slice(0, 10)
    .join('\n');

  if (!cleaned) return summaryText;
  return summaryText.replace(re, `${header}${cleaned}\n`);
}

async function generateTILList(pageContent, contextText) {
  const tilPrompt = `Верни ТОЛЬКО список буллетов (каждый пункт строго с новой строки).

Требования:
- Ровно 4–10 bullet points
- Каждый пункт строго с новой строки и начинается с "- "
- Формат пункта: "Today I learned: ..." (по-русски после двоеточия)
- Только список, без заголовка, без Markdown, без нумерации

КОНТЕКСТ ПОЛЬЗОВАТЕЛЯ:
${contextText}

СТРАНИЦА (кусок):
${String(pageContent || '').substring(0, 3500)}`;

  const til = await callGroq(tilPrompt, '', { temperature: 0.3, max_tokens: 600 });
  return (til || '')
    .split('\n')
    .map(l => l.trim())
    .filter(Boolean)
    .map(l => l.replace(/^[-•]\s+/, '').trim())
    .filter(Boolean)
    .map(x => x.toLowerCase().startsWith('today i learned:') ? x : `Today I learned: ${x.replace(/^today i learned\s*:\s*/i, '')}`)
    .slice(0, 10);
}

// ============ RICH TEXT ============

function escapeHtml(str = '') {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function escapeAttr(str = '') {
  return escapeHtml(str).replace(/\n/g, ' ');
}

function unescapeBasicHtml(str = '') {
  return String(str)
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function slugifyForId(str = '') {
  const s = String(str || '')
    .trim()
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  return s || 'sec';
}

function formatRichText(text) {
  const safe = escapeHtml(String(text || ''));
  const headingCounts = new Map();
  const withHeadings = safe.replace(/^## (.*$)/gm, (_, title) => {
    const plain = unescapeBasicHtml(title).trim();
    const slugBase = slugifyForId(plain);
    const n = (headingCounts.get(slugBase) || 0) + 1;
    headingCounts.set(slugBase, n);
    const id = `pzdrk-sec-${slugBase}${n > 1 ? `-${n}` : ''}`;
    return `<div class="pzdrk-section-title" id="${id}">${title}</div>`;
  });
  return withHeadings
    .replace(/\[\[entity:([^\]]+)\]\]/g, (_, name) => {
      const raw = unescapeBasicHtml(name).trim();
      return `<a class="pzdrk-entity" href="#" data-entity="${escapeAttr(raw)}">${escapeHtml(raw)}</a>`;
    })
    .replace(/\[\[wiki:([^\]]+)\]\]/g, (_, title) => {
      const rawTitle = unescapeBasicHtml(title).trim();
      const href = `https://ru.wikipedia.org/wiki/${encodeURIComponent(rawTitle.replace(/\s+/g, '_'))}`;
      return `<a class="pzdrk-wiki-link" href="${href}" target="_blank" rel="noopener noreferrer">${escapeHtml(rawTitle)}</a>`;
    })
    .replace(/\[\[term:([^\]]+)\]\]/g, (_, term) => {
      const raw = unescapeBasicHtml(term).trim();
      return `<span class="pzdrk-term" data-term="${escapeAttr(raw)}">${escapeHtml(raw)}</span>`;
    })
    .replace(/\[\[evidence:([^\]]+)\]\]/g, (_, ev) => {
      const raw = unescapeBasicHtml(ev).trim();
      return `<span class="pzdrk-evidence" data-evidence="${escapeAttr(raw)}"><span class="pzdrk-emoji">📊</span> ${escapeHtml(raw)}</span>`;
    })
    .replace(/\[\[action:([^\]]+)\]\]/g, (_, act) => {
      const raw = unescapeBasicHtml(act).trim();
      return `<span class="pzdrk-action-inline" data-action="${escapeAttr(raw)}"><span class="pzdrk-emoji">⚡</span> ${escapeHtml(raw)}</span>`;
    })
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\*([^*]+)\*/g, '<em>$1</em>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/^[-•]\s+(.*$)/gm, '<li class="pzdrk-li-ul">$1</li>')
    .replace(/^\d+[\.)\]]\s+(.*$)/gm, '<li class="pzdrk-li-ol">$1</li>')
    .replace(/(<li class="pzdrk-li-ul">[\s\S]*?<\/li>)+/g, '<ul class="pzdrk-list">$&</ul>')
    .replace(/(<li class="pzdrk-li-ol">[\s\S]*?<\/li>)+/g, '<ol class="pzdrk-olist">$&</ol>')
    .replace(/\n{2,}/g, '<div class="pzdrk-par-spacer"></div>')
    .replace(/\n/g, '<br>')
    // Remove <br> injected between list items (keeps lists tight)
    .replace(/<\/li>(?:<br>)+/g, '</li>')
    .replace(/<\/li>(?:<div class="pzdrk-par-spacer"><\/div>)+/g, '</li>')
    .replace(/<ul class="pzdrk-list">(?:<br>)+/g, '<ul class="pzdrk-list">')
    .replace(/<ul class="pzdrk-list">(?:<div class="pzdrk-par-spacer"><\/div>)+/g, '<ul class="pzdrk-list">')
    .replace(/<ol class="pzdrk-olist">(?:<br>)+/g, '<ol class="pzdrk-olist">')
    .replace(/<ol class="pzdrk-olist">(?:<div class="pzdrk-par-spacer"><\/div>)+/g, '<ol class="pzdrk-olist">')
    .replace(/(?:<br>)+<\/ul>/g, '</ul>')
    .replace(/(?:<div class="pzdrk-par-spacer"><\/div>)+<\/ul>/g, '</ul>')
    .replace(/(?:<br>)+<\/ol>/g, '</ol>');
}

function buildNoteNav(note) {
  if (!note || !note.isConnected) return;
  const nav = note.querySelector('.pzdrk-note-nav');
  const summaryBody = note.querySelector('.pzdrk-summary-body');
  const contentEl = note.querySelector('.pzdrk-note-content');
  if (!nav || !contentEl) return;

  const root = summaryBody || contentEl;
  const headings = Array.from(root.querySelectorAll('.pzdrk-section-title')).filter(h => h.id);
  if (headings.length < 2) {
    nav.style.display = 'none';
    return;
  }
  nav.style.display = 'flex';

  nav.innerHTML = '';
  headings.forEach(h => {
    const full = (h.textContent || '').trim();
    const firstToken = full.split(/\s+/)[0] || '';
    const hasLetters = /[A-Za-zА-Яа-я0-9]/.test(firstToken);
    const emoji = (!hasLetters && firstToken.length <= 4) ? firstToken : '';
    const label = (emoji ? full.slice(emoji.length) : full).trim();

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'pzdrk-note-nav-item';
    btn.dataset.target = h.id;
    btn.innerHTML = `${emoji ? `<span class="pzdrk-note-nav-emoji">${escapeHtml(emoji)}</span>` : `<span class="pzdrk-note-nav-emoji">•</span>`}<span class="pzdrk-note-nav-label">${escapeHtml(label)}</span>`;
    btn.title = full;

    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const id = btn.dataset.target;
      if (!id) return;
      const esc = (globalThis.CSS?.escape ? CSS.escape(id) : id);
      const target = root.querySelector(`#${esc}`);
      if (!target) return;
      const cRect = contentEl.getBoundingClientRect();
      const tRect = target.getBoundingClientRect();
      const delta = (tRect.top - cRect.top);
      contentEl.scrollBy({ top: delta - 18, behavior: 'smooth' });
    });

    nav.appendChild(btn);
  });

  // Bind once: keep active section highlighted
  if (note.dataset.navBound !== 'true') {
    note.dataset.navBound = 'true';
    contentEl.addEventListener('scroll', () => {
      if (note.__pzdrkNavRaf) return;
      note.__pzdrkNavRaf = requestAnimationFrame(() => {
        note.__pzdrkNavRaf = null;
        updateNoteNavActive(note);
      });
    }, { passive: true });
  }

  updateNoteNavPlacement(note);
  updateNoteNavActive(note);
}

function updateNoteNavActive(note) {
  if (!note || !note.isConnected) return;
  const nav = note.querySelector('.pzdrk-note-nav');
  const contentEl = note.querySelector('.pzdrk-note-content');
  const summaryBody = note.querySelector('.pzdrk-summary-body');
  if (!nav || !contentEl) return;

  const root = summaryBody || contentEl;
  const headings = Array.from(root.querySelectorAll('.pzdrk-section-title')).filter(h => h.id);
  const buttons = Array.from(nav.querySelectorAll('.pzdrk-note-nav-item'));
  if (!headings.length || !buttons.length) return;

  const cTop = contentEl.getBoundingClientRect().top + 34;
  let activeId = headings[0].id;
  for (const h of headings) {
    if (h.getBoundingClientRect().top <= cTop) activeId = h.id;
  }

  buttons.forEach(b => b.classList.toggle('is-active', b.dataset.target === activeId));
}

function updateNoteNavPlacement(note) {
  if (!note || !note.isConnected) return;
  const nav = note.querySelector('.pzdrk-note-nav');
  if (!nav) return;
  if (note.classList.contains('docked')) return;

  nav.classList.remove('nav-overlay');
  const margin = 10;
  const r = nav.getBoundingClientRect();
  if (r.left < margin) nav.classList.add('nav-overlay');
}

// ============ NOTE GRID LAYOUT ============

const NOTE_GRID = {
  top: 60,
  gapX: 18,
  gapY: 16,
  maxCols: 1,
  minMargin: 12
};

function ensureNoteResizeObserver() {
  if (noteResizeObserver) return noteResizeObserver;
  try {
    noteResizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const note = entry.target;
        if (!note || !note.isConnected) continue;
        if (note.dataset.layout !== 'grid') continue;
        if (note.dataset.manual === 'true') continue;
        if (note.classList.contains('docked')) continue;
        scheduleLayoutNotes();
        break;
      }
    });
  } catch (e) {
    noteResizeObserver = null;
  }
  return noteResizeObserver;
}

function getAutoNotes() {
  return currentNotes
    .filter(n => n && n.isConnected)
    .filter(n => n.dataset.layout !== 'flyout')
    .filter(n => n.dataset.manual !== 'true')
    .filter(n => !n.classList.contains('docked'));
}

function scheduleLayoutNotes() {
  if (layoutScheduled) return;
  layoutScheduled = true;
  requestAnimationFrame(() => {
    layoutScheduled = false;
    layoutNotes();
  });
}

function layoutNotes() {
  const notes = getAutoNotes();
  if (!notes.length) return;

  const sample = notes[0].getBoundingClientRect();
  const noteWidth = Math.max(320, Math.round(sample.width || 520));
  const cols = Math.max(1, NOTE_GRID.maxCols);
  if (cols === 1) {
    let top = NOTE_GRID.top;
    notes.forEach(note => {
      const rect = note.getBoundingClientRect();
      const left = Math.max(NOTE_GRID.minMargin, Math.round((window.innerWidth - rect.width) / 2));
      note.style.left = `${left}px`;
      note.style.top = `${top}px`;
      note.style.transform = 'none';
      updateNoteNavPlacement(note);
      if (actionsAnchorNote === note) updateNoteActionsPlacement(note);
      top += rect.height + NOTE_GRID.gapY;
    });
  } else {
    const totalWidth = cols * noteWidth + (cols - 1) * NOTE_GRID.gapX;
    const leftStart = Math.max(NOTE_GRID.minMargin, Math.round((window.innerWidth - totalWidth) / 2));

    let top = NOTE_GRID.top;
    for (let i = 0; i < notes.length; i += cols) {
      let rowHeight = 0;
      for (let c = 0; c < cols; c++) {
        const note = notes[i + c];
        if (!note) continue;
        note.style.left = `${leftStart + c * (noteWidth + NOTE_GRID.gapX)}px`;
        note.style.top = `${top}px`;
        note.style.transform = 'none';
        updateNoteNavPlacement(note);
        if (actionsAnchorNote === note) updateNoteActionsPlacement(note);
        const rect = note.getBoundingClientRect();
        rowHeight = Math.max(rowHeight, rect.height);
      }
      top += rowHeight + NOTE_GRID.gapY;
    }
  }

  if (actionFlyout?.note && actionFlyout.note.isConnected) positionActionFlyout(actionFlyout.anchorEl);
}

function markNoteManual(note) {
  if (!note) return;
  note.dataset.manual = 'true';
  if (note.dataset.layout !== 'flyout') note.dataset.layout = 'manual';
}

// ============ NOTE CREATION ============

function createNote(options = {}) {
  const { title = 'pzdrk', icon = '✦', type = 'summary', content = '', showTokens = false, collapsed = false, loading = false, layout = 'grid' } = options;

  const note = document.createElement('div');
  note.className = `pzdrk-note pzdrk-note-${type}${collapsed ? ' collapsed' : ''}${loading ? ' loading' : ''}`;
  note.dataset.layout = layout;
  note.dataset.manual = layout === 'flyout' ? 'true' : 'false';
  note.dataset.stickyMode = 'sticky'; // 'sticky' or 'scrolling'
  if (layout === 'flyout') note.classList.add('pzdrk-note-flyout');
  if (layout === 'flyout') {
    note.style.left = '0px';
    note.style.top = '0px';
    note.style.transform = 'none';
    note.style.display = 'none';
  } else {
    // Start in sticky mode - fixed at top
    note.classList.add('pzdrk-sticky');
    note.style.top = '8px';
    note.style.left = '50%';
    note.style.transform = 'translateX(-50%)';
  }

  // Stable id for per-note Q&A
  const noteId = (globalThis.crypto?.randomUUID?.() || `note-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  note.dataset.noteId = noteId;
  noteChats.set(noteId, []);

  // Track if note is "pinned" (clicked to stay open)
  note.dataset.pinned = 'false';

  getSettings().then(s => { if (s.classicMode) note.classList.add('classic-mode'); });

  note.innerHTML = `
    <div class="pzdrk-resize-n"></div><div class="pzdrk-resize-s"></div>
    <div class="pzdrk-resize-e"></div><div class="pzdrk-resize-w"></div>
    <div class="pzdrk-resize-ne"></div><div class="pzdrk-resize-nw"></div>
    <div class="pzdrk-resize-se"></div><div class="pzdrk-resize-sw"></div>
    <div class="pzdrk-note-surface">
      <div class="pzdrk-note-header">
        <div class="pzdrk-note-header-left">
          <span class="pzdrk-logo-wrap" aria-label="@pzdrk by pzd.world">
            <img class="pzdrk-note-logo" src="${PZDRK_LOGO_URL}" alt="pzdrk">
            <span class="pzdrk-brand-label">@pzdrk by pzd.world</span>
          </span>
          <span class="pzdrk-note-title">${title}</span>
          <span class="pzdrk-privacy-badge" title="Trackers blocked"><span class="pzdrk-ghost-icon">👻</span><span class="pzdrk-blocked-count">0</span></span>
          ${showTokens ? `<span class="pzdrk-token-badge"><span class="pzdrk-emoji">📊</span> <span class="pzdrk-page-tokens">${pageTokenCount}</span> / <span class="pzdrk-summary-tokens">0</span></span>` : ''}
        </div>
        <div class="pzdrk-note-header-right">
          <button class="pzdrk-btn-icon pzdrk-btn-mindmap" title="Mindmap (M)">🗺</button>
          <button class="pzdrk-btn-icon pzdrk-btn-speak" title="Озвучить (V)">🔊</button>
          <button class="pzdrk-btn-icon pzdrk-btn-copy" title="Копировать">📋</button>
          <button class="pzdrk-btn-icon pzdrk-btn-download" title="Скачать">💾</button>
          <button class="pzdrk-btn-icon pzdrk-btn-dock" title="В угол">⤡</button>
          <button class="pzdrk-btn-icon pzdrk-btn-close" title="Закрыть">✕</button>
        </div>
      </div>
      <div class="pzdrk-note-content">${content}</div>
    </div>
    <div class="pzdrk-note-nav" aria-label="Navigation"></div>
    <div class="pzdrk-note-actions" aria-label="Actions"></div>
  `;

  document.body.appendChild(note);
  currentNotes.push(note);
  if (layout === 'grid') scheduleLayoutNotes();

  const observer = ensureNoteResizeObserver();
  if (observer && layout === 'grid') observer.observe(note);

  // Logo hover: quick spin + delayed label
  const logoWrap = note.querySelector('.pzdrk-logo-wrap');
  if (logoWrap) {
    let labelTimer = null;
    logoWrap.addEventListener('mouseenter', () => {
      logoWrap.classList.add('pzdrk-hover-spin');
      setTimeout(() => logoWrap.classList.remove('pzdrk-hover-spin'), 700);
      labelTimer = setTimeout(() => logoWrap.classList.add('pzdrk-show-brand'), 1000);
    });
    logoWrap.addEventListener('mouseleave', () => {
      if (labelTimer) clearTimeout(labelTimer);
      logoWrap.classList.remove('pzdrk-show-brand');
    });
  }

  // Specular highlight tracking for glass UI
  note.addEventListener('mousemove', (e) => {
    const r = note.getBoundingClientRect();
    const x = ((e.clientX - r.left) / Math.max(1, r.width)) * 100;
    const y = ((e.clientY - r.top) / Math.max(1, r.height)) * 100;
    note.style.setProperty('--pzdrk-mx', `${x.toFixed(2)}%`);
    note.style.setProperty('--pzdrk-my', `${y.toFixed(2)}%`);
  });

  const onMove = () => {
    updateNoteNavPlacement(note);
    if (actionsAnchorNote === note) updateNoteActionsPlacement(note);
  };
  if (layout !== 'flyout') {
    makeDraggable(note, note.querySelector('.pzdrk-note-header'), onMove);
    makeResizableAllEdges(note, onMove);
  }

  // Track user interaction to avoid collapsing mid-scroll
  const contentEl = note.querySelector('.pzdrk-note-content');
  const markInteracting = () => { note.dataset.lastInteraction = String(Date.now()); };
  if (contentEl) {
    contentEl.addEventListener('scroll', markInteracting, { passive: true });
    contentEl.addEventListener('wheel', markInteracting, { passive: true });
  }

  // HOVER BEHAVIOR: expand on hover, collapse when cursor leaves (unless pinned)
  note.addEventListener('mouseenter', () => {
    if (note.dataset.layout === 'flyout') return;
    const t = collapseTimers.get(note);
    if (t) clearTimeout(t);
    collapseTimers.delete(note);
    if (!note.classList.contains('docked')) note.classList.remove('collapsed');
  });

  note.addEventListener('mouseleave', () => {
    if (note.dataset.layout === 'flyout') return;
    if (note.dataset.pinned !== 'false' || note.classList.contains('docked')) return;
    const t = collapseTimers.get(note);
    if (t) clearTimeout(t);
    const id = setTimeout(() => {
      if (!note.isConnected) return;
      if (note.dataset.pinned !== 'false') return;
      if (note.classList.contains('docked')) return;
      if (note.matches(':hover')) return;
      const last = Number(note.dataset.lastInteraction || 0);
      if (last && (Date.now() - last) < 600) return;
      note.classList.add('collapsed');
    }, 450);
    collapseTimers.set(note, id);
  });

  // CLICK ON NOTE: pin it open
  note.addEventListener('click', (e) => {
    if (note.dataset.layout === 'flyout') return;
    if (!e.target.closest('button, input, a, .pzdrk-term, .pzdrk-evidence, .pzdrk-action-inline') && !note.classList.contains('docked')) {
      note.dataset.pinned = 'true';
      note.classList.remove('collapsed');
      const t = collapseTimers.get(note);
      if (t) clearTimeout(t);
      collapseTimers.delete(note);
      // Switch to scrolling mode - scrolls with page
      if (note.dataset.stickyMode === 'sticky') {
        note.dataset.stickyMode = 'scrolling';
        note.classList.remove('pzdrk-sticky');
        note.classList.add('pzdrk-scrolling');
        // Convert fixed position to absolute
        const rect = note.getBoundingClientRect();
        note.style.top = (window.scrollY + rect.top) + 'px';
        note.style.left = (window.scrollX + rect.left) + 'px';
        note.style.transform = 'none';
      }
    }
  });

  // Close
  note.querySelector('.pzdrk-btn-close').addEventListener('click', () => {
    note.remove();
    currentNotes = currentNotes.filter(n => n !== note);
    if (actionsAnchorNote === note) {
      actionsAnchorNote = null;
      hideActionFlyout(true);
    }
    if (noteResizeObserver) noteResizeObserver.unobserve(note);
    if (note.dataset.layout === 'flyout' && actionFlyout?.note === note) actionFlyout = null;
    scheduleLayoutNotes();
  });

  // Dock to corner (bottom-left tab style)
  note.querySelector('.pzdrk-btn-dock').addEventListener('click', () => {
    if (note.dataset.layout === 'flyout') return;
    toggleDock(note);
    updateNoteNavPlacement(note);
    if (actionsAnchorNote === note) updateNoteActionsPlacement(note);
  });

  // Clicking docked header restores previous position
  note.querySelector('.pzdrk-note-header').addEventListener('click', (e) => {
    if (note.dataset.layout === 'flyout') return;
    if (!note.classList.contains('docked')) return;
    if (e.target.closest('button, input')) return;
    toggleDock(note, { forceUndock: true });
  });

  // Copy
  note.querySelector('.pzdrk-btn-copy').addEventListener('click', () => {
    navigator.clipboard.writeText(note.querySelector('.pzdrk-note-content').innerText);
    showToast('📋 Скопировано');
  });

  // Download
  note.querySelector('.pzdrk-btn-download').addEventListener('click', () => {
    const content = note.querySelector('.pzdrk-note-content').innerText;
    const blob = new Blob([`# ${title}\n\nURL: ${window.location.href}\n\n${content}`], { type: 'text/markdown' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `pzdrk-${Date.now()}.md`; a.click();
    showToast('💾 Скачано');
  });

  // SPEAK button = READ ALOUD the summary using Grok Voice
  note.querySelector('.pzdrk-btn-speak').addEventListener('click', async () => {
    const btn = note.querySelector('.pzdrk-btn-speak');
    btn.textContent = '⏳';
    try {
      const settings = await getSettings();
      const ranking = lastSummaryData?.ranking || { depth: 3, domain: 'Other' };
      const ctxText = formatBrowserContext(browserContext);
      const links = (lastSummaryData?.searchResults || [])
        .slice(0, 4)
        .map(r => `- ${r.title || r.url} — ${r.url}`)
        .join('\n') || '—';
      const summaryText = (lastSummaryContent || note.querySelector('.pzdrk-note-content').innerText || '').substring(0, 2500);
      const pageSnippet = (lastSummaryData?.pageContent || extractPageContent()).substring(0, 3500);

      const voicePrompt = PROMPTS.voiceScript
        .replace('{url}', window.location.href)
        .replace('{title}', document.title)
        .replace('{domain}', ranking.domain || 'Other')
        .replace('{depth}', String(ranking.depth || 3))
        .replace('{browserContext}', ctxText)
        .replace('{summary}', summaryText)
        .replace('{links}', links)
        .replace('{content}', pageSnippet);

      const voiceScript = await callGroq(voicePrompt, 'Только текст для озвучки.');

      if ((settings.voiceProvider || 'xai') === 'browser') {
        speakWithBrowserTTS(voiceScript);
      } else if (String(settings.voiceChatMode || 'off') === 'xai_realtime' && String(settings.voiceProvider || 'xai').toLowerCase() === 'xai') {
        await xaiRealtimeSpeakText(voiceScript, settings);
      } else {
        await speakWithGrok(voiceScript, { fallbackToBrowser: true });
      }
      btn.textContent = '✓';
    } catch (e) {
      btn.textContent = '❌';
      showToast('Voice: ' + e.message);
    }
    setTimeout(() => btn.textContent = '🔊', 3000);
  });

  // MINDMAP button = generate mindmap in NEW note
  note.querySelector('.pzdrk-btn-mindmap').addEventListener('click', () => generateMindmap());

  // Update privacy badge
  getTrackerStats().then(stats => {
    const badge = note.querySelector('.pzdrk-blocked-count');
    if (badge) badge.textContent = stats.blocked || 0;
  });

  return note;
}

function toggleDock(note, { forceUndock = false } = {}) {
  const isDocked = note.classList.contains('docked');
  const shouldDock = !isDocked && !forceUndock;

  if (shouldDock) {
    note.dataset.prevManual = note.dataset.manual || 'false';
    // Save current geometry/styles
    note.dataset.prevDock = JSON.stringify({
      left: note.style.left || '',
      top: note.style.top || '',
      right: note.style.right || '',
      bottom: note.style.bottom || '',
      width: note.style.width || '',
      height: note.style.height || '',
      maxHeight: note.style.maxHeight || '',
      transform: note.style.transform || ''
    });

    note.classList.add('docked');
    note.style.position = 'fixed';
    note.style.left = '10px';
    note.style.bottom = '10px';
    note.style.top = 'auto';
    note.style.right = 'auto';
    note.style.transform = 'none';
    // Let docked CSS control size
    note.style.width = '';
    note.style.height = '';
    note.style.maxHeight = '';
    scheduleLayoutNotes();
  } else {
    note.classList.remove('docked');
    let prev = null;
    try { prev = JSON.parse(note.dataset.prevDock || 'null'); } catch (e) {}

    const wasManual = (note.dataset.prevManual || 'false') === 'true';
    if (prev && wasManual) {
      note.style.left = prev.left;
      note.style.top = prev.top;
      note.style.right = prev.right;
      note.style.bottom = prev.bottom;
      note.style.width = prev.width;
      note.style.height = prev.height;
      note.style.maxHeight = prev.maxHeight;
      note.style.transform = prev.transform;
      note.dataset.manual = 'true';
      note.dataset.layout = 'manual';
    } else {
      note.style.right = 'auto';
      note.style.bottom = 'auto';
      note.style.transform = 'none';
      note.dataset.manual = 'false';
      note.dataset.layout = 'grid';
      scheduleLayoutNotes();
    }
  }
}

// CLICK ON PAGE BODY: collapse all unpinned notes
document.addEventListener('click', (e) => {
  if (!e.target.closest('.pzdrk-note')) {
    if (actionFlyout && !actionFlyout.pinned) hideActionFlyout(false);
    currentNotes.forEach(note => {
      if (note.dataset.layout === 'flyout') return;
      if (note.dataset.pinned === 'false' && !note.classList.contains('docked')) {
        note.classList.add('collapsed');
      }
      // Return to sticky mode when clicking outside
      if (note.dataset.stickyMode === 'scrolling' && !note.classList.contains('docked')) {
        note.dataset.stickyMode = 'sticky';
        note.dataset.pinned = 'false';
        note.classList.remove('pzdrk-scrolling');
        note.classList.add('pzdrk-sticky');
        note.style.top = '8px';
        note.style.left = '50%';
        note.style.transform = 'translateX(-50%)';
        note.classList.add('collapsed');
      }
    });
  }
});

function makeDraggable(element, handle, onMove) {
  let dragging = false, offset = { x: 0, y: 0 };
  handle.addEventListener('mousedown', (e) => {
    if (element.dataset.layout === 'flyout') return;
    if (e.target.closest('button, input')) return;
    markNoteManual(element);
    dragging = true;
    const rect = element.getBoundingClientRect();
    offset = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    element.style.transform = 'none';
    e.preventDefault();
  });
  document.addEventListener('mousemove', (e) => {
    if (!dragging) return;
    element.style.left = Math.max(0, e.clientX - offset.x) + 'px';
    element.style.top = Math.max(0, e.clientY - offset.y) + 'px';
    if (onMove) onMove();
  });
  document.addEventListener('mouseup', () => {
    if (!dragging) return;
    dragging = false;
    if (onMove) onMove();
  });
}

function makeResizableAllEdges(element, onMove) {
  const edges = ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'];
  let resizing = null, startRect = null, startMouse = null;
  edges.forEach(edge => {
    const handle = element.querySelector(`.pzdrk-resize-${edge}`);
    if (!handle) return;
    handle.addEventListener('mousedown', (e) => {
      if (element.dataset.layout === 'flyout') return;
      markNoteManual(element);
      resizing = edge; startRect = element.getBoundingClientRect(); startMouse = { x: e.clientX, y: e.clientY };
      e.preventDefault(); e.stopPropagation();
    });
  });
  document.addEventListener('mousemove', (e) => {
    if (!resizing) return;
    const dx = e.clientX - startMouse.x, dy = e.clientY - startMouse.y;
    let w = startRect.width, h = startRect.height, l = startRect.left, t = startRect.top;
    if (resizing.includes('e')) w = Math.max(280, startRect.width + dx);
    if (resizing.includes('w')) { w = Math.max(280, startRect.width - dx); l = startRect.left + dx; }
    if (resizing.includes('s')) h = Math.max(100, startRect.height + dy);
    if (resizing.includes('n')) { h = Math.max(100, startRect.height - dy); t = startRect.top + dy; }
    element.style.width = w + 'px'; element.style.height = h + 'px'; element.style.maxHeight = h + 'px';
    if (resizing.includes('w')) element.style.left = l + 'px';
    if (resizing.includes('n')) element.style.top = t + 'px';
    element.style.transform = 'none';
    if (onMove) onMove();
  });
  document.addEventListener('mouseup', () => {
    if (!resizing) return;
    resizing = null;
    if (onMove) onMove();
  });
}

function showToast(message) {
  const toast = document.createElement('div');
  toast.className = 'pzdrk-toast';
  toast.textContent = message;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 2500);
}

// ============ HOVER TOOLTIPS + LINK PREVIEWS ============

const hoverCache = new Map();
let pagePreviewEl = null;
let pagePreviewHideTimer = null;

function getTooltipEl() {
  let tooltip = document.querySelector('.pzdrk-tooltip');
  if (!tooltip) {
    tooltip = document.createElement('div');
    tooltip.className = 'pzdrk-tooltip';
    document.body.appendChild(tooltip);
  }
  return tooltip;
}

function showTooltipAt(pageX, pageY, html) {
  const tooltip = getTooltipEl();
  tooltip.innerHTML = html;
  tooltip.style.left = Math.min(pageX, window.scrollX + window.innerWidth - 280) + 'px';
  tooltip.style.top = (pageY + 15) + 'px';
  tooltip.style.display = 'block';
}

function hideTooltip() {
  const tooltip = document.querySelector('.pzdrk-tooltip');
  if (tooltip) tooltip.style.display = 'none';
}

function getPagePreviewEl() {
  if (pagePreviewEl) return pagePreviewEl;
  pagePreviewEl = document.createElement('div');
  pagePreviewEl.className = 'pzdrk-page-preview';
  pagePreviewEl.style.display = 'none';
  pagePreviewEl.addEventListener('mouseenter', () => {
    if (pagePreviewHideTimer) clearTimeout(pagePreviewHideTimer);
  });
  pagePreviewEl.addEventListener('mouseleave', () => {
    hidePagePreview();
  });
  document.body.appendChild(pagePreviewEl);
  return pagePreviewEl;
}

function hidePagePreview() {
  if (pagePreviewHideTimer) clearTimeout(pagePreviewHideTimer);
  const el = getPagePreviewEl();
  el.style.display = 'none';
}

function scheduleHidePagePreview() {
  if (pagePreviewHideTimer) clearTimeout(pagePreviewHideTimer);
  pagePreviewHideTimer = setTimeout(() => hidePagePreview(), 180);
}

function pickBestExaResult(results) {
  const list = Array.isArray(results) ? results : [];
  const bestDeep = list.find(r => {
    try {
      const u = new URL(r.url);
      return u.pathname && u.pathname !== '/' && u.pathname.length > 2;
    } catch (e) { return false; }
  });
  return bestDeep || list[0] || null;
}

async function getTermTooltip(termText) {
  const key = `term:${String(termText).toLowerCase()}`;
  if (hoverCache.has(key)) return hoverCache.get(key);

  const def = await callGroq(
    `Дай определение термина "${termText}" в 2 коротких предложения. Без эмоций. Если неоднозначно — скажи и приведи 2 возможных смысла.`,
    MONDAY_PERSONA
  ).catch(() => 'Недоступно');

  const data = { def };
  hoverCache.set(key, data);
  return data;
}

async function getEntityTooltip(entityText) {
  const key = `entity:${String(entityText).toLowerCase()}`;
  if (hoverCache.has(key)) return hoverCache.get(key);

  const summaryHint = (lastSummaryContent || '').substring(0, 1200);
  const [def, results] = await Promise.all([
    callGroq(
      `В 1–2 предложения: что такое "${entityText}" в контексте этого материала. Если не уверен — укажи что проверить. Контекст (часть):\n${summaryHint}`,
      MONDAY_PERSONA
    ).catch(() => '—'),
    callExa(`${entityText} ${document.title}`)
  ]);

  const best = pickBestExaResult(results);
  const url = best?.url || '';
  const title = best?.title || url;

  const data = { def, url, title };
  hoverCache.set(key, data);
  return data;
}

function setupHoverInteractions(container) {
  // TERMS
  container.querySelectorAll('.pzdrk-term').forEach(term => {
    let timeout = null;
    term.addEventListener('mouseenter', (e) => {
      const termText = term.dataset.term || term.textContent;
      timeout = setTimeout(async () => {
        showTooltipAt(e.pageX, e.pageY, 'Загрузка…');
        const data = await getTermTooltip(termText);
        showTooltipAt(
          e.pageX,
          e.pageY,
          `<strong>${escapeHtml(termText)}</strong><br>${escapeHtml(data.def)}`
        );
      }, 250);
    });
    term.addEventListener('mouseleave', () => {
      clearTimeout(timeout);
      hideTooltip();
    });
  });

  // ENTITIES
  container.querySelectorAll('.pzdrk-entity').forEach(entityEl => {
    let timeout = null;
    entityEl.addEventListener('mouseenter', (e) => {
      const entityText = entityEl.dataset.entity || entityEl.textContent;
      timeout = setTimeout(async () => {
        showTooltipAt(e.pageX, e.pageY, 'Загрузка…');
        const data = await getEntityTooltip(entityText);
        if (data.url) {
          entityEl.setAttribute('href', data.url);
          entityEl.setAttribute('target', '_blank');
          entityEl.setAttribute('rel', 'noopener noreferrer');
        }
        const linkHtml = data.url
          ? `<div style="margin-top:6px;"><a href="${escapeAttr(data.url)}" target="_blank" rel="noopener noreferrer">↗ ${escapeHtml(data.title || data.url)}</a></div>`
          : '';
        showTooltipAt(
          e.pageX,
          e.pageY,
          `<strong>${escapeHtml(entityText)}</strong><br>${escapeHtml(data.def)}${linkHtml}`
        );
      }, 250);
    });
    entityEl.addEventListener('mouseleave', () => {
      clearTimeout(timeout);
      hideTooltip();
    });
    entityEl.addEventListener('click', (e) => {
      const href = entityEl.getAttribute('href');
      if (!href || href === '#') {
        e.preventDefault();
        e.stopPropagation();
        window.open(`https://www.google.com/search?q=${encodeURIComponent(entityEl.textContent)}`, '_blank', 'noopener');
      }
    });
  });

  const noteRoot = container.closest?.('.pzdrk-note') || container;
  const noteContentRoot = noteRoot?.querySelector?.('.pzdrk-note-content') || container;

  function findSectionTitleFor(targetEl) {
    const titles = Array.from(noteContentRoot.querySelectorAll('.pzdrk-section-title'));
    let last = null;
    for (const t of titles) {
      const pos = t.compareDocumentPosition(targetEl);
      if (pos & Node.DOCUMENT_POSITION_FOLLOWING) last = t;
    }
    return (last?.textContent || '').trim();
  }

  function getOriginLineFor(targetEl) {
    const li = targetEl.closest('li');
    if (li) return (li.innerText || '').trim().slice(0, 300);
    const block = targetEl.closest('p, div');
    if (block) return (block.innerText || '').trim().slice(0, 300);
    return (targetEl.textContent || '').trim().slice(0, 200);
  }

  // INLINE: Evidence (click = copy raw)
  container.querySelectorAll('.pzdrk-evidence').forEach(el => {
    let timeout = null;
    el.addEventListener('mouseenter', (e) => {
      const text = (el.dataset.evidence || el.textContent || '').trim();
      timeout = setTimeout(() => {
        showTooltipAt(
          e.pageX,
          e.pageY,
          `<strong>Evidence</strong><br>${escapeHtml(text)}<br><span style="opacity:0.7">Клик: скопировать</span>`
        );
      }, 200);
    });
    el.addEventListener('mouseleave', () => {
      clearTimeout(timeout);
      hideTooltip();
    });
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      const text = (el.dataset.evidence || el.textContent || '').trim();
      navigator.clipboard.writeText(text).then(() => showToast('📋 Скопировано')).catch(() => {});
    });
  });

  // INLINE: Action (click = generate prompt+copy; Shift+Click = copy raw)
  container.querySelectorAll('.pzdrk-action-inline').forEach(el => {
    let timeout = null;
    el.addEventListener('mouseenter', (e) => {
      const text = (el.dataset.action || el.textContent || '').trim();
      timeout = setTimeout(() => {
        showTooltipAt(
          e.pageX,
          e.pageY,
          `<strong>Action</strong><br>${escapeHtml(text)}<br><span style="opacity:0.7">Клик: сгенерировать промпт и скопировать • Shift+клик: скопировать текст</span>`
        );
      }, 200);
    });
    el.addEventListener('mouseleave', () => {
      clearTimeout(timeout);
      hideTooltip();
    });
    el.addEventListener('click', async (e) => {
      e.stopPropagation();

      const actionText = (el.dataset.action || el.textContent || '').trim();
      if (!actionText) return;

      // Raw copy
      if (e.shiftKey) {
        navigator.clipboard.writeText(actionText).then(() => showToast('📋 Скопировано')).catch(() => {});
        return;
      }

      try {
        showToast('⚡ Генерирую промпт...');
        const section = findSectionTitleFor(el);
        const originLine = getOriginLineFor(el);
        const noteTitle = (noteRoot?.querySelector?.('.pzdrk-note-title')?.textContent || '').trim();
        const ctxText = formatBrowserContext(browserContext);
        const summary = (lastSummaryContent || '').substring(0, 2200);
        const pageSnippet = (lastSummaryData?.pageContent || extractPageContent()).substring(0, 3000);

        const prompt = PROMPTS.actionToPrompt
          .replace('{action}', actionText)
          .replace('{noteTitle}', noteTitle)
          .replace('{section}', section || '—')
          .replace('{originLine}', originLine || '—')
          .replace('{url}', window.location.href)
          .replace('{title}', document.title)
          .replace('{browserContext}', ctxText)
          .replace('{summary}', summary)
          .replace('{content}', pageSnippet);

        const generated = await callGroq(prompt, '');
        const out = (generated || '').trim();
        if (!out) throw new Error('Пустой ответ');

        await navigator.clipboard.writeText(out);
        showToast('⚡ Prompt скопирован');
      } catch (err) {
        showToast('⚡ Prompt: ' + (err?.message || 'ошибка'));
      }
    });
  });

  // LINK PREVIEWS
  container.querySelectorAll('a[href]').forEach(link => {
    if (link.classList.contains('pzdrk-entity')) return;
    const href = link.getAttribute('href') || '';
    if (!href || href.startsWith('#') || href.startsWith('javascript:')) return;

    let timeout = null;
    link.addEventListener('mouseenter', () => {
      timeout = setTimeout(async () => {
        const key = `url:${href}`;
        const meta = hoverCache.get(key) || await fetchUrlMeta(href).catch(() => null);
        if (meta) hoverCache.set(key, meta);

        if (!meta) return;
        const el = getPagePreviewEl();
        const title = escapeHtml(meta.title || href);
        const description = escapeHtml(meta.description || '');
        const image = meta.image ? `<img class="pzdrk-preview-image" src="${escapeAttr(meta.image)}" alt="">` : '';

        el.innerHTML = `${image}<div class="pzdrk-page-preview-header">${title}</div><div class="pzdrk-page-preview-content">${description || escapeHtml(href)}</div>`;
        el.style.display = 'block';

        const rect = link.getBoundingClientRect();
        const x0 = rect.left + window.scrollX;
        const y0 = rect.bottom + window.scrollY + 6;
        const maxX = window.scrollX + window.innerWidth - 340;
        el.style.left = Math.max(window.scrollX + 8, Math.min(x0, maxX)) + 'px';
        el.style.top = Math.max(window.scrollY + 8, y0) + 'px';
      }, 450);
    });
    link.addEventListener('mouseleave', () => {
      clearTimeout(timeout);
      scheduleHidePagePreview();
    });
  });

  // META hover: stars/domain/tags
  container.querySelectorAll('.pzdrk-meta-rank').forEach(el => {
    let timeout = null;
    el.addEventListener('mouseenter', (e) => {
      timeout = setTimeout(() => {
        const depth = el.dataset.depth || '';
        const pct = el.dataset.depthPct ? ` (~${el.dataset.depthPct}%)` : '';
        const expl = (el.dataset.depthExpl || '').trim();
        showTooltipAt(
          e.pageX,
          e.pageY,
          `<strong>Глубина</strong><br>${escapeHtml(String(depth))}/5${escapeHtml(pct)}<br>${escapeHtml(expl || '—')}`
        );
      }, 180);
    });
    el.addEventListener('mouseleave', () => {
      clearTimeout(timeout);
      hideTooltip();
    });
  });

  container.querySelectorAll('.pzdrk-meta-domain').forEach(el => {
    let timeout = null;
    el.addEventListener('mouseenter', (e) => {
      timeout = setTimeout(() => {
        const domain = el.dataset.domain || el.textContent || '';
        const conf = el.dataset.domainConf ? ` (${el.dataset.domainConf}%)` : '';
        const expl = (el.dataset.domainExpl || '').trim();
        showTooltipAt(
          e.pageX,
          e.pageY,
          `<strong>Категория</strong><br>${escapeHtml(domain)}${escapeHtml(conf)}<br>${escapeHtml(expl || '—')}`
        );
      }, 180);
    });
    el.addEventListener('mouseleave', () => {
      clearTimeout(timeout);
      hideTooltip();
    });
  });

  container.querySelectorAll('.pzdrk-meta-tag').forEach(el => {
    let timeout = null;
    el.addEventListener('mouseenter', (e) => {
      timeout = setTimeout(() => {
        const tag = el.dataset.tag || el.textContent || '';
        const expl = (el.dataset.tagExpl || '').trim();
        showTooltipAt(
          e.pageX,
          e.pageY,
          `<strong>${escapeHtml(tag)}</strong><br>${escapeHtml(expl || 'Почему тег: —')}`
        );
      }, 180);
    });
    el.addEventListener('mouseleave', () => {
      clearTimeout(timeout);
      hideTooltip();
    });
  });

  // Token badge hover
  container.querySelectorAll('.pzdrk-token-badge').forEach(el => {
    let timeout = null;
    el.addEventListener('mouseenter', (e) => {
      timeout = setTimeout(() => {
        const pageTok = el.querySelector('.pzdrk-page-tokens')?.textContent || '';
        const sumTok = el.querySelector('.pzdrk-summary-tokens')?.textContent || '';
        showTooltipAt(
          e.pageX,
          e.pageY,
          `<strong>Токены</strong><br>Слева: страница ≈ ${escapeHtml(pageTok)}<br>Справа: ответ ≈ ${escapeHtml(sumTok)}<br><span style="opacity:0.7">Оценка приблизительная</span>`
        );
      }, 180);
    });
    el.addEventListener('mouseleave', () => {
      clearTimeout(timeout);
      hideTooltip();
    });
  });

  // Header tooltips (title / badges / buttons)
  const bindTip = (el, htmlFn, delay = 180) => {
    if (!el || el.dataset.pzdrkTipBound === '1') return;
    el.dataset.pzdrkTipBound = '1';
    let timeout = null;
    el.addEventListener('mouseenter', (e) => {
      timeout = setTimeout(() => {
        const html = htmlFn?.(e);
        if (html) showTooltipAt(e.pageX, e.pageY, html);
      }, delay);
    });
    el.addEventListener('mouseleave', () => {
      clearTimeout(timeout);
      hideTooltip();
    });
  };

  container.querySelectorAll('.pzdrk-note-title').forEach(el => {
    bindTip(el, () => {
      const pinned = (noteRoot?.dataset?.pinned === 'true') ? 'pinned' : 'auto';
      const url = window.location.href;
      return `<strong>${escapeHtml((el.textContent || '').trim() || 'pzdrk')}</strong><br><span style="opacity:0.75">${escapeHtml(url)}</span><br><span style="opacity:0.7">Клик по пустому месту: pin • hover: expand • статус: ${escapeHtml(pinned)}</span>`;
    }, 220);
  });

  container.querySelectorAll('.pzdrk-privacy-badge').forEach(el => {
    bindTip(el, () => {
      const blocked = el.querySelector('.pzdrk-blocked-count')?.textContent || '0';
      return `<strong>Privacy</strong><br>Заблокировано трекеров: ${escapeHtml(blocked)}<br><span style="opacity:0.7">Используется declarativeNetRequest ruleset</span>`;
    });
  });

  container.querySelectorAll('.pzdrk-btn-icon').forEach(btn => {
    bindTip(btn, () => {
      const t = (btn.getAttribute('title') || '').trim();
      if (!t) return null;
      return `<strong>${escapeHtml(t)}</strong>`;
    });
  });

  container.querySelectorAll('.pzdrk-note-action').forEach(btn => {
    bindTip(btn, () => {
      const t = (btn.getAttribute('title') || '').trim();
      if (!t) return null;
      return `<strong>${escapeHtml(t)}</strong><br><span style="opacity:0.7">Клик: выполнить</span>`;
    }, 160);
  });

  container.querySelectorAll('.pzdrk-note-nav-item').forEach(btn => {
    bindTip(btn, () => {
      const t = (btn.getAttribute('title') || '').trim();
      if (!t) return null;
      return `<strong>${escapeHtml(t)}</strong><br><span style="opacity:0.7">Клик: перейти к разделу</span>`;
    }, 160);
  });
}

// ============ MAIN SUMMARY ============
// PARALLEL PIPELINE:
// 1. getBrowserContext() - tabs + history
// 2. callExa() - related search results
// 3. callGroq(generateTitle) - catchy title
// 4. callGroq(pageRanking) - depth, domain, tags
// Then sequentially: callGroq(summary) with all context

function buildMetaHtml(ranking = {}) {
  const depth = Math.max(1, Math.min(5, Number(ranking.depth || 3)));
  const depthPct = Number.isFinite(Number(ranking.depthPercent)) ? Number(ranking.depthPercent) : null;
  const depthExpl = (ranking.depthExplanation || '').toString();
  const domainExpl = (ranking.domainExplanation || '').toString();
  const domainConf = Number.isFinite(Number(ranking.domainConfidence)) ? Number(ranking.domainConfidence) : null;
  const tagExpl = ranking.tagExplanations && typeof ranking.tagExplanations === 'object' ? ranking.tagExplanations : {};

  return `
    <div class="pzdrk-meta">
      <span class="pzdrk-meta-item pzdrk-meta-rank" data-depth="${depth}" data-depth-pct="${depthPct ?? ''}" data-depth-expl="${escapeAttr(depthExpl)}">${'★'.repeat(depth)}${'☆'.repeat(5 - depth)}</span>
      <span class="pzdrk-meta-item pzdrk-meta-domain" data-domain="${escapeAttr(ranking.domain || '')}" data-domain-conf="${domainConf ?? ''}" data-domain-expl="${escapeAttr(domainExpl)}">${escapeHtml(ranking.domain || 'Other')}</span>
      ${(ranking.tags || []).slice(0, 6).map(t => {
        const expl = (tagExpl?.[t] || '').toString();
        return `<span class="pzdrk-meta-item pzdrk-meta-tag" data-tag="${escapeAttr(t)}" data-tag-expl="${escapeAttr(expl)}">${escapeHtml(t)}</span>`;
      }).join('')}
    </div>
  `;
}

function summaryJsonToMarkdown(summaryObj) {
  if (!summaryObj || typeof summaryObj !== 'object') return '';
  const out = [];
  const title = String(summaryObj.title || '').trim();
  if (title) out.push(`# ${title}`);

  const sections = Array.isArray(summaryObj.sections) ? summaryObj.sections : [];
  for (const s of sections) {
    const head = `${String(s.emoji || '').trim()} ${String(s.label || '').trim()}`.trim();
    if (head) out.push(`\n## ${head}`);
    const left = Array.isArray(s.left) ? s.left : [];
    left.slice(0, 24).forEach(b => {
      const line = String(b || '').trim();
      if (line) out.push(`- ${line}`);
    });
    const actions = Array.isArray(s.actions) ? s.actions : [];
    actions.slice(0, 6).forEach(a => {
      const line = String(a || '').trim();
      if (line) out.push(`- ${line}`);
    });
  }

  const til = Array.isArray(summaryObj.til) ? summaryObj.til : [];
  if (til.length) {
    out.push(`\n## 💡 TIL`);
    til.slice(0, 12).forEach(t => {
      const line = String(t || '').trim();
      if (line) out.push(`- ${line}`);
    });
  }

  const actions = Array.isArray(summaryObj.actions) ? summaryObj.actions : [];
  if (actions.length) {
    out.push(`\n## ⚡ ДЕЙСТВИЯ`);
    actions.slice(0, 12).forEach(a => {
      const line = String(a || '').trim();
      if (line) out.push(`- ${line}`);
    });
  }

  return out.join('\n').trim();
}

function renderRightBlock(right) {
  const r = (right && typeof right === 'object') ? right : {};
  const commentary = Array.isArray(r.commentary) ? r.commentary : [];
  const terms = Array.isArray(r.terms) ? r.terms : [];
  const entities = Array.isArray(r.entities) ? r.entities : [];
  const refs = Array.isArray(r.refs) ? r.refs : [];

  let html = '';

  if (commentary.length) {
    html += `<div class="pzdrk-section-subtitle">Комментарий</div>`;
    html += `<div>${formatRichText(commentary.join('\n\n'))}</div>`;
  }

  if (terms.length) {
    html += `<div class="pzdrk-section-subtitle">Термины</div>`;
    const lines = terms.slice(0, 10).map(t => {
      const term = String(t?.term || '').trim();
      const def = String(t?.definition || '').trim();
      if (!term && !def) return '';
      return `- **${term || '—'}**: ${def}`;
    }).filter(Boolean).join('\n');
    html += `<div>${formatRichText(lines)}</div>`;
  }

  if (entities.length) {
    html += `<div class="pzdrk-section-subtitle">Сущности</div>`;
    const lines = entities.slice(0, 12).map(e => {
      const name = String(e?.name || '').trim();
      const ctx = String(e?.context || '').trim();
      const q = String(e?.exaQuery || '').trim();
      if (!name) return '';
      const tag = `[[entity:${name}]]`;
      const hint = ctx ? ` — ${ctx}` : '';
      const qHint = q ? ` *(Exa: ${q})*` : '';
      return `- ${tag}${hint}${qHint}`;
    }).filter(Boolean).join('\n');
    html += `<div>${formatRichText(lines)}</div>`;
  }

  if (refs.length) {
    html += `<div class="pzdrk-section-subtitle">Ссылки / что проверить</div>`;
    const lines = refs.slice(0, 10).map(rf => {
      const q = String(rf?.query || '').trim();
      const why = String(rf?.why || '').trim();
      if (!q) return '';
      return `- ${q}${why ? ` — *${why}*` : ''}`;
    }).filter(Boolean).join('\n');
    html += `<div>${formatRichText(lines)}</div>`;
  }

  return html || `<div style="opacity:0.7">⏳</div>`;
}

function renderSummaryJsonHtml(summaryObj) {
  if (!summaryObj || typeof summaryObj !== 'object') return '';
  const sections = Array.isArray(summaryObj.sections) ? summaryObj.sections : [];
  const til = Array.isArray(summaryObj.til) ? summaryObj.til : [];
  const actions = Array.isArray(summaryObj.actions) ? summaryObj.actions : [];

  let html = '';

  for (const s of sections) {
    const key = String(s.key || '').trim() || slugifyForId(`${s.emoji || ''} ${s.label || ''}`);
    const emoji = String(s.emoji || '').trim();
    const label = String(s.label || '').trim();
    const title = `${emoji ? `${emoji} ` : ''}${label}`.trim() || 'Раздел';
    const secId = `pzdrk-sec-${slugifyForId(key)}`;

    const left = Array.isArray(s.left) ? s.left : [];
    const leftText = left.map(b => `- ${String(b || '').trim()}`).filter(l => l.trim() !== '-').join('\n');
    const rightHtml = renderRightBlock(s.right);

    html += `
      <div class="pzdrk-section" data-sec="${escapeAttr(key)}">
        <div class="pzdrk-section-title" id="${escapeAttr(secId)}">${escapeHtml(title)}</div>
        <div class="pzdrk-two-col">
          <div class="pzdrk-col-left">${formatRichText(leftText)}</div>
          <div class="pzdrk-col-right" data-sec="${escapeAttr(key)}">${rightHtml}</div>
        </div>
      </div>
    `;
  }

  if (til.length) {
    const tilText = til.map(t => `- ${String(t || '').trim()}`).filter(l => l.trim() !== '-').join('\n');
    html += `
      <div class="pzdrk-section" data-sec="til">
        <div class="pzdrk-section-title" id="pzdrk-sec-til">💡 TIL</div>
        <div class="pzdrk-two-col">
          <div class="pzdrk-col-left">${formatRichText(tilText)}</div>
          <div class="pzdrk-col-right" data-sec="til"><div style="opacity:0.7">—</div></div>
        </div>
      </div>
    `;
  }

  if (actions.length) {
    const actText = actions.map(a => `- ${String(a || '').trim()}`).filter(l => l.trim() !== '-').join('\n');
    html += `
      <div class="pzdrk-section" data-sec="actions">
        <div class="pzdrk-section-title" id="pzdrk-sec-actions">⚡ ДЕЙСТВИЯ</div>
        <div class="pzdrk-two-col">
          <div class="pzdrk-col-left">${formatRichText(actText)}</div>
          <div class="pzdrk-col-right" data-sec="actions"><div style="opacity:0.7">—</div></div>
        </div>
      </div>
    `;
  }

  return html;
}

async function runWithConcurrency(items, limit, worker) {
  const list = Array.isArray(items) ? items : [];
  const n = Math.max(1, Math.min(200, Number(limit) || 3));
  let idx = 0;

  const runners = Array.from({ length: Math.min(n, list.length) }, () => (async () => {
    while (idx < list.length) {
      const cur = idx++;
      try {
        await worker(list[cur], cur);
      } catch (e) {
        // best effort
      }
    }
  })());

  await Promise.all(runners);
}

async function enrichSummarySections(note, summaryJson, pageContent, contextText, settings) {
  if (!note || !note.isConnected) return;
  if (!summaryJson || typeof summaryJson !== 'object') return;
  const sections = Array.isArray(summaryJson.sections) ? summaryJson.sections : [];
  if (!sections.length) return;

  const system = String(settings?.sectionEnrichPrompt || PROMPTS.sectionEnrich || '').trim();
  const url = window.location.href;
  const title = document.title;
  const pageSnippet = String(pageContent || '').substring(0, 8000);

  await runWithConcurrency(sections, 3, async (s, i) => {
    if (!note.isConnected) return;

    const key = String(s?.key || '').trim() || slugifyForId(`${s?.emoji || ''} ${s?.label || ''}`);
    const label = `${String(s?.emoji || '').trim()} ${String(s?.label || '').trim()}`.trim();
    const left = Array.isArray(s?.left) ? s.left : [];

    const userPrompt = `URL: ${url}\nTITLE: ${title}\n\n[BROWSER CONTEXT]\n${contextText}\n\n[SECTION]\nkey=${key}\nlabel=${label}\n\n[LEFT BULLETS]\n${left.map(x => `- ${String(x || '').trim()}`).join('\n')}\n\n[PAGE SNIPPET]\n${pageSnippet}`;

    const raw = await callGroq(userPrompt, system, { temperature: 0.35, max_tokens: 1500 });
    const obj = parseJsonObject(raw);
    const right = obj?.right;
    if (!right || typeof right !== 'object') return;

    // Update in-memory object
    if (summaryJson.sections?.[i]) summaryJson.sections[i].right = right;

    // Patch DOM for this section only
    const esc = (globalThis.CSS?.escape ? CSS.escape(key) : key);
    const rightEl = note.querySelector(`.pzdrk-col-right[data-sec="${esc}"]`);
    if (!rightEl) return;
    rightEl.innerHTML = renderRightBlock(right);
    setupHoverInteractions(rightEl);
  });
}

async function maybeAutoSpeakSummary(settings) {
  if (!settings?.autoSpeakSummary) return;
  try {
    const ranking = lastSummaryData?.ranking || { depth: 3, domain: 'Other' };
    const ctxText = formatBrowserContext(browserContext);
    const links = (lastSummaryData?.searchResults || [])
      .slice(0, 4)
      .map(r => `- ${r.title || r.url} — ${r.url}`)
      .join('\n') || '—';
    const summaryText = (lastSummaryContent || '').substring(0, 2500);
    const pageSnippet = (lastSummaryData?.pageContent || extractPageContent()).substring(0, 3500);

    const voicePrompt = PROMPTS.voiceScript
      .replace('{url}', window.location.href)
      .replace('{title}', document.title)
      .replace('{domain}', ranking.domain || 'Other')
      .replace('{depth}', String(ranking.depth || 3))
      .replace('{browserContext}', ctxText)
      .replace('{summary}', summaryText)
      .replace('{links}', links)
      .replace('{content}', pageSnippet);

    const voiceScript = await callGroq(voicePrompt, 'Только текст для озвучки.');

    if ((settings.voiceProvider || 'xai') === 'browser') {
      speakWithBrowserTTS(voiceScript);
    } else if (String(settings.voiceChatMode || 'off') === 'xai_realtime' && String(settings.voiceProvider || 'xai').toLowerCase() === 'xai') {
      await xaiRealtimeSpeakText(voiceScript, settings);
    } else {
      await speakWithGrok(voiceScript, { fallbackToBrowser: true });
    }
  } catch (e) {
    showToast('Auto voice: ' + (e?.message || 'ошибка'));
  }
}

// ============ MAP-REDUCE SUMMARY ============

function chunkTextByTokens(text, targetTokens = 1200, maxChunks = 80) {
  const src = String(text || '').trim();
  if (!src) return [];

  const tgt = Math.max(400, Math.min(3000, Math.round(Number(targetTokens) || 1200)));
  const cap = Math.max(4, Math.min(200, Math.round(Number(maxChunks) || 80)));

  const parts = src.split(/\n{2,}/).map(p => p.trim()).filter(Boolean);
  const chunks = [];
  let cur = '';
  let curTokens = 0;

  const pushCur = () => {
    const v = cur.trim();
    if (v) chunks.push(v);
    cur = '';
    curTokens = 0;
  };

  const splitOversize = (p) => {
    const out = [];
    const maxChars = Math.max(1200, tgt * 4);
    let rest = String(p || '').trim();
    while (rest.length > maxChars) {
      out.push(rest.slice(0, maxChars).trim());
      rest = rest.slice(maxChars).trim();
    }
    if (rest) out.push(rest);
    return out;
  };

  for (let pi = 0; pi < parts.length; pi++) {
    const p = parts[pi];
    const pTok = estimateTokens(p);

    const items = (pTok > (tgt * 1.4)) ? splitOversize(p) : [p];
    for (const piece of items) {
      const t = estimateTokens(piece);
      if (!cur) {
        cur = piece;
        curTokens = t;
        continue;
      }
      if ((curTokens + t) <= (tgt * 1.1)) {
        cur += `\n\n${piece}`;
        curTokens += t;
      } else {
        pushCur();
        cur = piece;
        curTokens = t;
        if (chunks.length >= cap) break;
      }
    }

    if (chunks.length >= cap) break;
  }

  if (chunks.length < cap) {
    pushCur();
  } else {
    const tail = cur.trim();
    if (tail && chunks.length) {
      chunks[chunks.length - 1] = (chunks[chunks.length - 1] + '\n\n' + tail).trim();
    }
  }

  return chunks.filter(Boolean);
}

function normalizeBulletLine(s) {
  return String(s || '')
    .replace(/^[-•]\s+/, '')
    .trim()
    .replace(/\s+/g, ' ')
    .slice(0, 420);
}

function uniqueStrings(list, limit = 60) {
  const out = [];
  const seen = new Set();
  for (const raw of (Array.isArray(list) ? list : [])) {
    const s = normalizeBulletLine(raw);
    const k = s.toLowerCase();
    if (!s || seen.has(k)) continue;
    seen.add(k);
    out.push(s);
    if (out.length >= limit) break;
  }
  return out;
}

function rankAndDedupeBullets(bullets, limit = 60) {
  const freq = new Map();
  const first = new Map();
  for (const b of (Array.isArray(bullets) ? bullets : [])) {
    const s = normalizeBulletLine(b);
    const k = s.toLowerCase();
    if (!s) continue;
    freq.set(k, (freq.get(k) || 0) + 1);
    if (!first.has(k)) first.set(k, s);
  }
  return Array.from(freq.entries())
    .sort((a, b) => (b[1] - a[1]) || (a[0].length - b[0].length))
    .map(([k]) => first.get(k))
    .filter(Boolean)
    .slice(0, limit);
}

function normalizeMapChunk(obj) {
  const o = (obj && typeof obj === 'object') ? obj : {};

  const bulletsRaw = o.bullets || o.summaryBullets || o.key_points || o.keyPoints;
  const actionsRaw = o.actions || o.next_actions || o.nextActions;
  const risksRaw = o.risks || o.questions || o.unknowns;
  const termsRaw = o.terms || o.glossary;
  const entitiesRaw = o.entities || o.people || o.orgs;

  const bullets = uniqueStrings(Array.isArray(bulletsRaw) ? bulletsRaw : [], 16);
  const actions = uniqueStrings(Array.isArray(actionsRaw) ? actionsRaw : [], 10);
  const risks = uniqueStrings(Array.isArray(risksRaw) ? risksRaw : [], 10);

  const terms = (Array.isArray(termsRaw) ? termsRaw : [])
    .map(t => ({
      term: String(t?.term || t?.name || '').trim().slice(0, 80),
      definition: String(t?.definition || t?.def || t?.meaning || '').trim().slice(0, 260)
    }))
    .filter(t => t.term && t.definition)
    .slice(0, 10);

  const entities = (Array.isArray(entitiesRaw) ? entitiesRaw : [])
    .map(e => ({
      name: String(e?.name || '').trim().slice(0, 80),
      context: String(e?.context || e?.role || '').trim().slice(0, 220),
      exaQuery: String(e?.exaQuery || e?.query || '').trim().slice(0, 120)
    }))
    .filter(e => e.name)
    .slice(0, 12);

  return { bullets, terms, entities, actions, risks };
}

async function callGroqJsonWithRepair(userPrompt, systemPrompt, options) {
  const raw = await callGroq(userPrompt, systemPrompt, options);
  const obj = parseJsonObject(raw);
  if (obj && typeof obj === 'object') return obj;

  const repairUser = `Исправь ответ в корректный JSON по схеме. Верни ТОЛЬКО JSON без комментариев.\n\nRAW:\n${raw}`;
  const repaired = await callGroq(repairUser, 'Только JSON.', { temperature: 0.0, max_tokens: Math.max(256, Math.min(1200, Number(options?.max_tokens) || 800)) });
  const obj2 = parseJsonObject(repaired);
  return (obj2 && typeof obj2 === 'object') ? obj2 : null;
}

function mergeMapChunks(chunks) {
  const merged = { bullets: [], terms: [], entities: [], actions: [], risks: [] };

  for (const c of (Array.isArray(chunks) ? chunks : [])) {
    if (!c) continue;
    merged.bullets.push(...(c.bullets || []));
    merged.actions.push(...(c.actions || []));
    merged.risks.push(...(c.risks || []));
    merged.terms.push(...(c.terms || []));
    merged.entities.push(...(c.entities || []));
  }

  // Terms: merge by term
  const termMap = new Map();
  for (const t of merged.terms) {
    const term = String(t?.term || '').trim();
    const key = term.toLowerCase();
    if (!term || termMap.has(key)) continue;
    termMap.set(key, { term, definition: String(t?.definition || '').trim() });
  }

  // Entities: merge by name
  const entMap = new Map();
  for (const e of merged.entities) {
    const name = String(e?.name || '').trim();
    const key = name.toLowerCase();
    if (!name || entMap.has(key)) continue;
    entMap.set(key, {
      name,
      context: String(e?.context || '').trim(),
      exaQuery: String(e?.exaQuery || '').trim()
    });
  }

  return {
    bullets: rankAndDedupeBullets(merged.bullets, 90),
    actions: uniqueStrings(merged.actions, 16),
    risks: uniqueStrings(merged.risks, 18),
    terms: Array.from(termMap.values()).slice(0, 18),
    entities: Array.from(entMap.values()).slice(0, 18)
  };
}

function buildMapReduceSummaryJson(params) {
  const title = String(params?.title || '').trim() || document.title.slice(0, 50);
  const ranking = (params?.ranking && typeof params.ranking === 'object') ? params.ranking : { depth: 3, domain: 'Other', tags: [] };
  const headings = Array.isArray(params?.headings) ? params.headings : [];
  const merged = (params?.merged && typeof params.merged === 'object') ? params.merged : { bullets: [], actions: [], risks: [], terms: [], entities: [] };

  const bullets = Array.isArray(merged.bullets) ? merged.bullets : [];
  const core = bullets.slice(0, 10);
  const keyPoints = bullets.slice(10, 34);
  const details = bullets.slice(34, 70);

  const toc = headings
    .slice(0, 14)
    .map(h => {
      const lvl = Math.max(1, Math.min(3, Number(h?.level) || 2));
      const t = String(h?.text || '').trim();
      if (!t) return '';
      const prefix = (lvl === 1) ? '▸' : (lvl === 2) ? '▸▸' : '▸▸▸';
      return `${prefix} ${t}`;
    })
    .filter(Boolean);

  const terms = Array.isArray(merged.terms) ? merged.terms : [];
  const entities = Array.isArray(merged.entities) ? merged.entities : [];

  return {
    title,
    meta: ranking,
    sections: [
      {
        key: 'core',
        emoji: '🧠',
        label: 'СУТЬ',
        left: core,
        right: { commentary: [], terms: terms.slice(0, 8), entities: entities.slice(0, 8), refs: [] }
      },
      {
        key: 'toc',
        emoji: '🧭',
        label: 'КАРТА',
        left: toc.length ? toc : ['—'],
        right: { commentary: [], terms: [], entities: [], refs: [] }
      },
      {
        key: 'points',
        emoji: '🎯',
        label: 'КЛЮЧЕВЫЕ ТЕЗИСЫ',
        left: keyPoints.length ? keyPoints : core,
        right: { commentary: [], terms: terms.slice(8, 14), entities: entities.slice(8, 14), refs: [] }
      },
      {
        key: 'risks',
        emoji: '⚠️',
        label: 'РИСКИ / ВОПРОСЫ',
        left: (merged.risks || []).slice(0, 16),
        right: { commentary: [], terms: [], entities: [], refs: [] }
      },
      {
        key: 'details',
        emoji: '🔎',
        label: 'ДЕТАЛИ',
        left: details.length ? details : keyPoints,
        right: { commentary: [], terms: terms.slice(14, 18), entities: entities.slice(14, 18), refs: [] }
      }
    ],
    til: [],
    actions: (merged.actions || []).slice(0, 14)
  };
}

async function summarizeMapReduce({ note, pageContent, headings, contextText, settings, ranking, cleanTitle }) {
  const contentEl = note?.querySelector?.('.pzdrk-note-content');
  if (!note || !note.isConnected || !contentEl) throw new Error('Note missing');

  const maxOut = Math.max(256, Math.min(1200, Number(settings?.targetMaxOutputTokens) || 500));
  const limit = Math.max(1, Math.min(200, Number(settings?.maxParallelRequests) || 12));

  const chunks = chunkTextByTokens(pageContent, 1200, 80);
  const total = chunks.length;
  const results = new Array(total).fill(null);

  const systemPrompt = `Верни ТОЛЬКО JSON (без Markdown и комментариев):\n\n{\n  \"bullets\": [\"...\"],\n  \"terms\": [{\"term\":\"...\",\"definition\":\"...\"}],\n  \"entities\": [{\"name\":\"...\",\"context\":\"...\",\"exaQuery\":\"...\"}],\n  \"actions\": [\"...\"],\n  \"risks\": [\"...\"]\n}\n\nТребования:\n- bullets: 6–10 строк, без префикса "- "\n- terms: 3–8\n- entities: 3–8\n- actions: 2–6\n- risks: 2–6`;

  let done = 0;
  let lastUi = 0;

  const updateUi = () => {
    if (!note.isConnected) return;
    const now = Date.now();
    if ((now - lastUi) < 250 && done < total) return;
    lastUi = now;

    const merged = mergeMapChunks(results.filter(Boolean));
    const previewBullets = merged.bullets.slice(0, 18).map(b => `- ${b}`).join('\n');
    const pct = total ? Math.round((done / total) * 100) : 0;

    contentEl.innerHTML = `${buildMetaHtml(ranking)}
      <div class="pzdrk-summary-body">
        <div class="pzdrk-section">
          <div class="pzdrk-section-title">⚡ Map‑reduce</div>
          <div style="opacity:0.75">Chunks: ${done}/${total} (${pct}%) • Target out: ${maxOut}</div>
          <div style="margin-top:10px; white-space:pre-wrap;">${escapeHtml(previewBullets || '…')}</div>
        </div>
      </div>`;
  };

  updateUi();

  await runWithConcurrency(chunks.map((chunk, i) => ({ chunk, i })), limit, async (item) => {
    if (!note.isConnected) return;
    const userPrompt = `URL: ${window.location.href}\nTITLE: ${document.title}\nTAGS: ${(settings?.tags || []).join(' ')}\n\nCHUNK ${item.i + 1}/${total}\n\n${item.chunk}`;
    const obj = await callGroqJsonWithRepair(userPrompt, systemPrompt, { temperature: 0.25, max_tokens: maxOut });
    results[item.i] = normalizeMapChunk(obj);
    done++;
    updateUi();
  });

  const merged = mergeMapChunks(results.filter(Boolean));
  const summaryJson = buildMapReduceSummaryJson({ title: cleanTitle, ranking, headings, merged });

  // Fill TIL (best effort, small)
  try {
    summaryJson.til = await generateTILList(pageContent, contextText).catch(() => []);
  } catch (e) {
    summaryJson.til = [];
  }

  return summaryJson;
}

async function summarizePage() {
  if (isProcessing) return;
  isProcessing = true;
  
  const settings = await getSettings();
  const pageContent = extractPageContent({ maxChars: settings.mapReduceEnabled ? 250_000 : 18_000 });
  const headings = extractHeadings();
  const shouldMapReduce = settings.mapReduceEnabled !== false && estimateTokens(pageContent) > 9000;
  
  // Check cache
  const cached = getCache(window.location.href);
  if (cached?.summary) {
    let cachedHtml = '';
    let cachedText = '';
    let cachedJson = null;

    if (cached.format === 'json' && cached.summary && typeof cached.summary === 'object') {
      cachedJson = cached.summary;
      const meta = cachedJson.meta || {};
      cachedHtml = `${buildMetaHtml(meta)}<div class="pzdrk-summary-body">${renderSummaryJsonHtml(cachedJson)}</div>`;
      cachedText = summaryJsonToMarkdown(cachedJson);
    } else {
      cachedHtml = `<div class="pzdrk-summary-body">${formatRichText(cached.summary)}</div>`;
      cachedText = String(cached.summary || '');
    }

    lastSummaryContent = cachedText;
    summaryTokenCount = estimateTokens(lastSummaryContent);
    conversationHistory = [{ role: 'assistant', content: lastSummaryContent }];

    const note = createNote({ title: (cachedJson?.title ? String(cachedJson.title).slice(0, 50) : 'Кэш'), icon: '⚡', type: 'summary', content: cachedHtml, showTokens: true, collapsed: true });
    const tokenBadge = note.querySelector('.pzdrk-summary-tokens');
    if (tokenBadge) tokenBadge.textContent = summaryTokenCount;

    lastSummaryData = { content: lastSummaryContent, headings, searchResults: [], ranking: cachedJson?.meta || {}, pageContent, summaryJson: cachedJson };
    buildNoteNav(note);
    setupHoverInteractions(note);
    createFloatingHints(note);
    maybeAutoSpeakSummary(settings);
    isProcessing = false;
    showToast('⚡ Из кэша');
    return;
  }
  
  // Create note (COLLAPSED by default)
  const note = createNote({
    title: 'Анализирую...',
    type: 'summary',
    content: '<div class="pzdrk-loading"><div class="pzdrk-spinner"></div>Параллельные запросы...</div>',
    showTokens: true,
    collapsed: true,
    loading: true
  });

  // Right-side actions anchored to this note
  createFloatingHints(note);

  try {
    // PARALLEL REQUESTS (fast path)
    const ctxPromise = getBrowserContext();
    const titlePromise = callGroq(PROMPTS.generateTitle.replace('{content}', pageContent.substring(0, 1000)), 'Только заголовок');
    const rankingPromise = callGroq(PROMPTS.pageRanking.replace('{content}', pageContent.substring(0, 2000)), 'Только JSON');

    // Non-blocking (fill later)
    const searchPromise = callExa(document.title).catch(() => []);
    
    const [ctx, titleResult, rankingResult] = await Promise.all([ctxPromise, titlePromise, rankingPromise]);

    browserContext = ctx;
    const contextText = formatBrowserContext(ctx);
    
    // Parse ranking
    let ranking = { depth: 3, domain: 'Other', tags: [] };
    try { const m = rankingResult.match(/\{[\s\S]*\}/); if (m) ranking = JSON.parse(m[0]); } catch (e) {}
    
    // Update title
    const cleanTitle = titleResult.replace(/["\n]/g, '').substring(0, 50);
    note.querySelector('.pzdrk-note-title').textContent = cleanTitle || document.title.substring(0, 30);
    
    // MAIN SUMMARY REQUEST
    let summaryResult = '';
    let summaryJson = null;

    if (settings.twoColumnSummary) {
      if (shouldMapReduce) {
        summaryJson = await summarizeMapReduce({ note, pageContent, headings, contextText, settings, ranking, cleanTitle });
      } else {
      const summaryPrompt = (settings.summaryJsonPrompt || PROMPTS.summaryJson)
        .replace('{tags}', settings.tags.join(' '))
        .replace('{browserContext}', contextText);

      const raw = await callGroq(
        `URL: ${window.location.href}\nЗаголовок: ${document.title}\n\nКонтент:\n${pageContent.substring(0, 14000)}`,
        summaryPrompt,
        { temperature: 0.25 }
      );

      summaryJson = parseJsonObject(raw);

      if (summaryJson && typeof summaryJson === 'object') {
        if (!Array.isArray(summaryJson.sections)) summaryJson.sections = [];
        if (!Array.isArray(summaryJson.til) || summaryJson.til.length < 4) {
          summaryJson.til = await generateTILList(pageContent, contextText).catch(() => summaryJson.til || []);
        }
      }

      // Hard fallback to markdown if JSON parse fails
      if (!summaryJson) {
        const fallbackPrompt = (settings.summaryPrompt || PROMPTS.summary)
          .replace('{tags}', settings.tags.join(' '))
          .replace('{browserContext}', contextText);
        summaryResult = await callGroq(
          `URL: ${window.location.href}\nЗаголовок: ${document.title}\n\nКонтент:\n${pageContent.substring(0, 14000)}`,
          fallbackPrompt
        );
        summaryResult = await ensureTILBullets(summaryResult, pageContent, contextText).catch(() => summaryResult);
      }
      }
    } else {
      if (shouldMapReduce) {
        const tmpJson = await summarizeMapReduce({ note, pageContent, headings, contextText, settings, ranking, cleanTitle });
        summaryResult = summaryJsonToMarkdown(tmpJson);
      } else {
        const summaryPrompt = (settings.summaryPrompt || PROMPTS.summary)
          .replace('{tags}', settings.tags.join(' '))
          .replace('{browserContext}', contextText);

        summaryResult = await callGroq(
          `URL: ${window.location.href}\nЗаголовок: ${document.title}\n\nКонтент:\n${pageContent.substring(0, 14000)}`,
          summaryPrompt
        );

        summaryResult = await ensureTILBullets(summaryResult, pageContent, contextText).catch(() => summaryResult);
      }
    }
    
    // Related/workflows are filled asynchronously to improve perceived speed
    const workflowsPromise = (async () => {
      try {
        const wfResult = await callGroq(PROMPTS.workflowSuggestions.replace('{content}', pageContent.substring(0, 2000)), 'Только JSON');
        const m = wfResult.match(/\[[\s\S]*\]/);
        return m ? JSON.parse(m[0]) : [];
      } catch (e) {
        return [];
      }
    })();

    lastSummaryContent = summaryJson ? summaryJsonToMarkdown(summaryJson) : summaryResult;
    summaryTokenCount = estimateTokens(lastSummaryContent);
    conversationHistory = [{ role: 'assistant', content: lastSummaryContent }];
    
    // Update token badge
    const tokenBadge = note.querySelector('.pzdrk-summary-tokens');
    if (tokenBadge) tokenBadge.textContent = summaryTokenCount;
    
    // Build content
    let html = buildMetaHtml(ranking);

    if (summaryJson) {
      summaryJson.meta = ranking;
      html += `<div class="pzdrk-summary-body">${renderSummaryJsonHtml(summaryJson)}</div>`;
    } else {
      html += `<div class="pzdrk-summary-body">${formatRichText(summaryResult)}</div>`;
    }
    // Related placeholder (filled later)
    const relatedId = `pzdrk-related-${note.dataset.noteId || Date.now()}`;
    html += `<div class="pzdrk-related-section" id="${relatedId}"><div class="pzdrk-section-title">🔗 Похожее & Next Steps</div><div style="opacity:0.7">⏳ Загружаю…</div></div>`;
    
    note.querySelector('.pzdrk-note-content').innerHTML = html;
    note.classList.remove('loading');

    buildNoteNav(note);
    setupHoverInteractions(note);
    
    // Cache
    if (summaryJson) setCache(window.location.href, summaryJson, 'json');
    else setCache(window.location.href, summaryResult, 'markdown');
    
    // Right-side actions (icon + text) anchored to this note
    createFloatingHints(note);
    
    // Store data for mindmap/challenge (searchResults filled later)
    lastSummaryData = { content: lastSummaryContent, headings, searchResults: [], ranking, pageContent, summaryJson };

    // Optional auto-speak (best effort; may be blocked by autoplay policy)
    maybeAutoSpeakSummary(settings);
    
    // ALWAYS send to Slack (no toggle)
    sendToSlack({
      url: window.location.href,
      summarized_note: lastSummaryContent,
      tags: settings.tags.join(', '),
      timestamp: new Date().toISOString(),
      page_tokens: pageTokenCount,
      summary_tokens: summaryTokenCount
    });

    // Progressive enrichment (right column) in background
    if (summaryJson && Array.isArray(summaryJson.sections) && summaryJson.sections.length) {
      enrichSummarySections(note, summaryJson, pageContent, contextText, settings)
        .then(() => {
          if (!note.isConnected) return;
          setCache(window.location.href, summaryJson, 'json');
        })
        .catch(() => {});
    }

    // Fill related/workflows async
    Promise.all([searchPromise, workflowsPromise]).then(([searchResults, workflowSuggestions]) => {
      try {
        if (!note.isConnected) return;
        const esc = (globalThis.CSS?.escape ? CSS.escape(relatedId) : relatedId);
        const relatedEl = note.querySelector(`#${esc}`);
        if (!relatedEl) return;

        // Update lastSummaryData in-place
        if (lastSummaryData) lastSummaryData.searchResults = Array.isArray(searchResults) ? searchResults : [];

        let relHtml = `<div class="pzdrk-section-title">🔗 Похожее & Next Steps</div>`;

        const sr = Array.isArray(searchResults) ? searchResults : [];
        if (sr.length) {
          sr.slice(0, 4).forEach(r => {
            relHtml += `<a href="${escapeAttr(r.url)}" target="_blank" class="pzdrk-related-link">${escapeHtml(r.title || r.url)}</a>`;
          });
        }

        const wf = Array.isArray(workflowSuggestions) ? workflowSuggestions : [];
        if (wf.length) {
          relHtml += `<div class="pzdrk-related-grid">`;
          wf.slice(0, 12).forEach(w => {
            relHtml += `
              <div class="pzdrk-workflow-tile" data-prompt="${escapeAttr(w.prompt || '')}">
                <div class="pzdrk-workflow-title">${escapeHtml(w.title || 'Workflow')}</div>
                <div class="pzdrk-workflow-desc">${escapeHtml(w.desc || '')}</div>
              </div>
            `;
          });
          relHtml += `</div>`;
        }

        if (!sr.length && !wf.length) {
          relHtml += `<div style="opacity:0.7">—</div>`;
        }

        relatedEl.innerHTML = relHtml;

        // Setup workflow tile clicks
        relatedEl.querySelectorAll('.pzdrk-workflow-tile').forEach(tile => {
          tile.addEventListener('click', async () => {
            const prompt = tile.dataset.prompt;
            const newNote = createNote({ title: 'Workflow', type: 'action', content: '<div class="pzdrk-loading"><div class="pzdrk-spinner"></div></div>', collapsed: false, loading: true });
            newNote.dataset.pinned = 'true';
            try {
              const res = await callGroq(prompt, STYLE_RULES);
              newNote.querySelector('.pzdrk-note-content').innerHTML = formatRichText(res);
              newNote.classList.remove('loading');
              setupHoverInteractions(newNote);
            } catch (e) {
              newNote.querySelector('.pzdrk-note-content').innerHTML = `<div class="pzdrk-error">❌ ${e.message}</div>`;
              newNote.classList.remove('loading');
            }
          });
        });

        // Re-bind link previews/tooltips inside updated section
        setupHoverInteractions(note);
      } catch (e) {
        // ignore
      }
    });
    
  } catch (error) {
    note.querySelector('.pzdrk-note-content').innerHTML = `<div class="pzdrk-error">❌ ${error.message}</div>`;
    note.classList.remove('loading');
  }
  
  isProcessing = false;
}

// ============ ACTIONS FROM POPUP / CONTEXT MENU ============

async function translatePage(lang = 'ru') {
  if (isProcessing) {
    showToast('⏳ Подождите, завершаю предыдущую операцию...');
    return;
  }
  isProcessing = true;

  const content = lastSummaryData?.pageContent || extractPageContent();

  if (!content || content.trim().length === 0) {
    showToast('Нет содержимого для перевода');
    isProcessing = false;
    return;
  }

  const langNames = { 'ru': 'Русский', 'en': 'English', 'de': 'Deutsch', 'fr': 'Français', 'es': 'Español', 'zh': '中文', 'ja': '日本語' };
  const langName = langNames[lang] || lang.toUpperCase();

  const loadingMessages = { 'ru': 'Перевожу…', 'en': 'Translating…', 'de': 'Übersetze…', 'fr': 'Traduction…', 'es': 'Traduciendo…', 'zh': '翻译中…', 'ja': '翻訳中…' };
  const loadingMsg = loadingMessages[lang] || 'Translating…';

  const note = createNote({
    title: `🌐 Перевод (${langName})`,
    type: 'translate',
    content: `<div class="pzdrk-loading"><div class="pzdrk-spinner"></div>${loadingMsg}</div>`,
    collapsed: false,
    loading: true
  });
  note.dataset.pinned = 'true';

  const contentEl = note.querySelector('.pzdrk-note-content');
  const renderProgress = (p) => {
    if (!contentEl) return;
    const done = Number(p?.done || 0);
    const total = Number(p?.total || 0);
    const pct = total ? Math.round((done / total) * 100) : 0;
    const raw = String(p?.rendered || '');
    const preview = raw.length > 20000 ? (raw.slice(0, 20000) + '\n\n…') : raw;
    contentEl.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:8px;">
        <div class="pzdrk-loading" style="display:flex;gap:8px;align-items:center;margin:0;">${escapeHtml(loadingMsg)}</div>
        <div style="opacity:0.7;font-size:11px;">${done}/${total} (${pct}%)</div>
      </div>
      <div style="white-space:pre-wrap;line-height:1.35;">${escapeHtml(preview || '')}</div>
    `;
  };

  try {
    renderProgress({ done: 0, total: 0, rendered: '' });
    const translated = await translateLargeText(content, lang, renderProgress);
    note.querySelector('.pzdrk-note-content').innerHTML = formatRichText(translated || '—');
    note.classList.remove('loading');
    setupHoverInteractions(note);
  } catch (e) {
    note.querySelector('.pzdrk-note-content').innerHTML = `<div class="pzdrk-error">❌ ${e.message}\n\n<small>Проверьте API key в настройках или попробуйте снова.</small></div>`;
    note.classList.remove('loading');
  } finally {
    isProcessing = false;
  }
}

async function translateSelection(text, lang = 'ru') {
  const selectionText = String(text || window.getSelection?.()?.toString?.() || '').trim();
  if (!selectionText) {
    showToast('Нет выделения');
    return;
  }

  const langNames = { 'ru': 'Русский', 'en': 'English', 'de': 'Deutsch', 'fr': 'Français', 'es': 'Español', 'zh': '中文', 'ja': '日本語' };
  const langName = langNames[lang] || lang.toUpperCase();

  const loadingMessages = { 'ru': 'Перевожу…', 'en': 'Translating…', 'de': 'Übersetze…', 'fr': 'Traduction…', 'es': 'Traduciendo…', 'zh': '翻译中…', 'ja': '翻訳中…' };
  const loadingMsg = loadingMessages[lang] || 'Translating…';

  const note = createNote({
    title: `🌐 Перевод (${langName})`,
    type: 'translate',
    content: `<div class="pzdrk-loading"><div class="pzdrk-spinner"></div>${loadingMsg}</div>`,
    collapsed: false,
    loading: true
  });
  note.dataset.pinned = 'true';

  try {
    const contentEl = note.querySelector('.pzdrk-note-content');
    const renderProgress = (p) => {
      if (!contentEl) return;
      const done = Number(p?.done || 0);
      const total = Number(p?.total || 0);
      const pct = total ? Math.round((done / total) * 100) : 0;
      const raw = String(p?.rendered || '');
      const preview = raw.length > 20000 ? (raw.slice(0, 20000) + '\n\n…') : raw;
      contentEl.innerHTML = `
        <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:8px;">
          <div class="pzdrk-loading" style="display:flex;gap:8px;align-items:center;margin:0;">${escapeHtml(loadingMsg)}</div>
          <div style="opacity:0.7;font-size:11px;">${done}/${total} (${pct}%)</div>
        </div>
        <div style="white-space:pre-wrap;line-height:1.35;">${escapeHtml(preview || '')}</div>
      `;
    };

    const translated = await translateLargeText(selectionText, lang, renderProgress);
    note.querySelector('.pzdrk-note-content').innerHTML = formatRichText(translated || '—');
    note.classList.remove('loading');
    setupHoverInteractions(note);
  } catch (e) {
    note.querySelector('.pzdrk-note-content').innerHTML = `<div class="pzdrk-error">❌ ${e.message}</div>`;
    note.classList.remove('loading');
  }
}

async function explainSelection(text) {
  const selectionText = String(text || window.getSelection?.()?.toString?.() || '').trim();
  if (!selectionText) {
    showToast('Нет выделения');
    return;
  }

  const note = createNote({
    title: 'ELI5',
    type: 'qa',
    content: '<div class="pzdrk-loading"><div class="pzdrk-spinner"></div>Объясняю…</div>',
    collapsed: false,
    loading: true
  });
  note.dataset.pinned = 'true';

  try {
    const ctxText = formatBrowserContext(browserContext);
    const userPrompt = `Объясни выделенный фрагмент максимально просто (ELI5), но без сюсюканья.

Формат:
## 🧠 Объяснение
## 🧩 Ключевые термины
## ⚠️ Где путают
## ✅ Что сделать дальше

ВЫДЕЛЕНИЕ:
${selectionText}

PAGE:
${window.location.href}
${document.title}

BROWSER CONTEXT:
${ctxText}`;

    const result = await callGroq(userPrompt, STYLE_RULES);
    note.querySelector('.pzdrk-note-content').innerHTML = formatRichText(result || '—');
    note.classList.remove('loading');
    setupHoverInteractions(note);
  } catch (e) {
    note.querySelector('.pzdrk-note-content').innerHTML = `<div class="pzdrk-error">❌ ${e.message}</div>`;
    note.classList.remove('loading');
  }
}

// ============ COMMAND SYSTEM (Adaptive) ============

let commandRailEl = null;
let commandPaletteOverlayEl = null;
let commandPaletteInputEl = null;
let commandPaletteListEl = null;
let commandPaletteSelectedIndex = 0;
let allCommands = [];
let customCommands = [];
let selectionSnapshot = '';
let selectionTimer = null;
let commandSystemInitialized = false;

const CUSTOM_COMMANDS_KEY = 'customCommands';

function normalizeHotkey(k) {
  return String(k || '').trim().toLowerCase();
}

function getSelectionText() {
  try {
    return String(window.getSelection?.()?.toString?.() || '').trim();
  } catch (e) {
    return '';
  }
}

function getCommandContext() {
  const ctxText = formatBrowserContext(browserContext);
  const summary = (lastSummaryContent || '').substring(0, 4000);
  const content = (lastSummaryData?.pageContent || extractPageContent()).substring(0, 8000);
  const selection = getSelectionText();
  return {
    url: window.location.href,
    title: document.title,
    summary,
    content,
    browserContext: ctxText,
    selection
  };
}

function renderTemplate(tpl, ctx) {
  return String(tpl || '')
    .replaceAll('{url}', ctx.url)
    .replaceAll('{title}', ctx.title)
    .replaceAll('{summary}', ctx.summary)
    .replaceAll('{content}', ctx.content)
    .replaceAll('{browserContext}', ctx.browserContext)
    .replaceAll('{selection}', ctx.selection || '');
}

function getBuiltinCommands() {
  const actionByType = (type) => getDefaultActions().find(a => a.type === type);

  return [
    // Not pinned in rail (they have dedicated top buttons), but available in palette.
    { id: 'palette', title: 'Command Palette', icon: '⌘', key: '', scope: 'global', pinned: false, kind: 'builtin', run: () => openCommandPalette('') },
    { id: 'new_command', title: 'Add command', icon: '➕', key: '', scope: 'global', pinned: false, kind: 'builtin', run: () => openCommandPalette('/new ') },

    { id: 'summarize', title: 'Summarize', icon: '✦', key: 's', scope: 'page', pinned: true, kind: 'builtin', run: () => summarizePage() },
    { id: 'translate_page', title: 'Translate page', icon: '🌐', key: 't', scope: 'page', pinned: true, kind: 'builtin', run: () => translatePage() },
    { id: 'mindmap', title: 'Mindmap', icon: '🗺', key: 'm', scope: 'page', pinned: true, kind: 'builtin', run: () => generateMindmap() },

    { id: 'twitter', title: 'Twitter', icon: '🐦', key: '1', scope: 'page', pinned: true, kind: 'builtin', run: () => executeAction(actionByType('twitter')) },
    { id: 'deepdive', title: 'Deep Dive', icon: '🔬', key: '2', scope: 'page', pinned: true, kind: 'builtin', run: () => executeAction(actionByType('deepdive')) },
    { id: 'automation', title: 'Automate', icon: '⚡', key: '3', scope: 'page', pinned: true, kind: 'builtin', run: () => executeAction(actionByType('automation')) },
    { id: 'learning', title: 'Learn', icon: '📚', key: '4', scope: 'page', pinned: true, kind: 'builtin', run: () => executeAction(actionByType('learning')) },
    { id: 'share', title: 'Share', icon: '📤', key: '5', scope: 'page', pinned: true, kind: 'builtin', run: () => executeAction(actionByType('share')) },
    { id: 'challenge', title: 'Challenge', icon: '🎯', key: '6', scope: 'page', pinned: true, kind: 'builtin', run: () => executeAction(actionByType('challenge')) },

    { id: 'explain_selection', title: 'Explain selection (ELI5)', icon: '🧠', key: 'e', scope: 'selection', pinned: true, kind: 'builtin', run: () => explainSelection() },
    { id: 'translate_selection', title: 'Translate selection', icon: '🈂', key: 'r', scope: 'selection', pinned: true, kind: 'builtin', run: () => translateSelection() }
  ];
}

async function loadCustomCommands() {
  const s = await chrome.storage.sync.get([CUSTOM_COMMANDS_KEY]);
  const list = Array.isArray(s[CUSTOM_COMMANDS_KEY]) ? s[CUSTOM_COMMANDS_KEY] : [];
  customCommands = list.filter(Boolean);
  return customCommands;
}

async function saveCustomCommands(next) {
  customCommands = Array.isArray(next) ? next : [];
  await chrome.storage.sync.set({ [CUSTOM_COMMANDS_KEY]: customCommands });
}

async function refreshCommands() {
  const builtins = getBuiltinCommands();
  const customs = await loadCustomCommands();
  allCommands = builtins.concat(
    customs.map(c => ({
      ...c,
      kind: 'custom',
      pinned: c.pinned !== false,
      scope: c.scope || 'page',
      mode: c.mode || 'note'
    }))
  );

  renderFloatingHints();
  if (isCommandPaletteOpen()) renderCommandPaletteList();
}

function ensureCommandRail() {
  if (commandRailEl?.isConnected) return commandRailEl;
  const el = document.createElement('div');
  el.className = 'pzdrk-command-rail';
  el.innerHTML = `
    <div class="pzdrk-rail-top">
      <button class="pzdrk-rail-btn pzdrk-rail-btn-palette" type="button" title="Command Palette (⌘/Ctrl+K)">⌘</button>
      <button class="pzdrk-rail-btn pzdrk-rail-btn-new" type="button" title="Add command (/new …)">➕</button>
    </div>
    <div class="pzdrk-rail-list"></div>
  `;
  document.body.appendChild(el);
  commandRailEl = el;

  el.querySelector('.pzdrk-rail-btn-palette')?.addEventListener('click', () => openCommandPalette(''));
  el.querySelector('.pzdrk-rail-btn-new')?.addEventListener('click', () => openCommandPalette('/new '));

  return el;
}

function renderCommandRail() {
  const el = ensureCommandRail();
  const listEl = el.querySelector('.pzdrk-rail-list');
  if (!listEl) return;

  const sel = getSelectionText();
  selectionSnapshot = sel;
  const hasSel = !!sel;

  const pinned = allCommands.filter(c => c.pinned);
  const globals = pinned.filter(c => c.scope === 'global');
  const selectionCmds = pinned.filter(c => c.scope === 'selection');
  const pageCmds = pinned.filter(c => c.scope === 'page');

  const ordered = hasSel
    ? globals.concat(selectionCmds, pageCmds)
    : globals.concat(pageCmds, selectionCmds);

  const seen = new Set();
  const finalList = ordered.filter(c => {
    if (!c || !c.id) return false;
    if (seen.has(c.id)) return false;
    seen.add(c.id);
    return true;
  });

  listEl.innerHTML = '';
  finalList.forEach(cmd => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `pzdrk-rail-btn pzdrk-rail-cmd ${cmd.scope === 'selection' ? 'is-selection' : ''}`;
    const key = (cmd.key || '').toString().toUpperCase();
    btn.innerHTML = `
      <span class="pzdrk-rail-icon">${escapeHtml(cmd.icon || '⚡')}</span>
      ${key ? `<span class="pzdrk-rail-key">${escapeHtml(key)}</span>` : ''}
    `;
    btn.title = `${cmd.title || cmd.id}${key ? ` (${key})` : ''}`;
    btn.addEventListener('click', async (e) => {
      e.preventDefault();
      e.stopPropagation();
      await runCommand(cmd);
    });
    listEl.appendChild(btn);
  });
}

async function runCommand(cmd) {
  if (!cmd) return;
  try {
    if (cmd.kind === 'builtin') {
      await cmd.run?.();
      return;
    }
    if (cmd.kind === 'custom') {
      await runCustomCommand(cmd);
    }
  } catch (e) {
    showToast('Command: ' + (e?.message || 'ошибка'));
  }
}

async function runCustomCommand(cmd, options = {}) {
  const ctx = getCommandContext();
  if ((cmd.scope || 'page') === 'selection' && !ctx.selection) {
    showToast('Нужно выделение');
    return;
  }

  const prompt = renderTemplate(cmd.prompt, ctx);
  const system = (cmd.system && String(cmd.system).trim()) ? String(cmd.system) : STYLE_RULES;

  if ((cmd.mode || 'note') === 'clipboard') {
    const out = await callGroq(prompt, system);
    await navigator.clipboard.writeText(String(out || '').trim());
    showToast('📋 Скопировано');
    return;
  }

  const targetNote = (options && options.targetNote && options.targetNote.isConnected) ? options.targetNote : null;
  const note = targetNote || createNote({
    title: cmd.title || 'Command',
    type: 'action',
    content: '<div class="pzdrk-loading"><div class="pzdrk-spinner"></div></div>',
    collapsed: false,
    loading: true
  });
  note.dataset.pinned = 'true';
  if (targetNote) {
    const titleEl = note.querySelector('.pzdrk-note-title');
    if (titleEl) titleEl.textContent = cmd.title || 'Command';
    const contentEl = note.querySelector('.pzdrk-note-content');
    if (contentEl && !contentEl.innerHTML.trim()) {
      contentEl.innerHTML = '<div class="pzdrk-loading"><div class="pzdrk-spinner"></div></div>';
    }
    note.classList.add('loading');
  }

  const out = await callGroq(prompt, system);
  if (!note.isConnected) return;
  note.querySelector('.pzdrk-note-content').innerHTML = formatRichText(out || '—');
  note.classList.remove('loading');
  setupHoverInteractions(note);
  positionActionFlyout();
}

function parseJsonObject(text) {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch (e) {
    // try to extract {...}
    try {
      const m = String(text).match(/\{[\s\S]*\}/);
      if (!m) return null;
      return JSON.parse(m[0]);
    } catch (e2) {
      return null;
    }
  }
}

function makeSafeId(id) {
  const base = String(id || '')
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 48);
  return base || `cmd_${Date.now()}`;
}

function pickFreeKey(existingKeys) {
  const used = new Set((existingKeys || []).map(normalizeHotkey).filter(Boolean));
  const candidates = ['7', '8', '9', '0', 'q', 'w', 'a', 'd', 'z', 'x', 'c', 'v'];
  for (const k of candidates) {
    if (!used.has(k)) return k;
  }
  return '';
}

function extractCommandRequest(text) {
  const raw = String(text || '').trim();
  if (!raw) return null;
  const m = raw.match(/^(?:\/new|\/cmd\s+new|\/cmd\s+add|add command|create command|new command|добавь команду|создай команду)\s*[:\-]?\s+([\s\S]{6,})$/i);
  return m ? m[1].trim() : null;
}

async function createCustomCommandFromRequest(requestText) {
  const ctx = getCommandContext();
  const prompt = PROMPTS.createCommand
    .replace('{request}', requestText)
    .replace('{url}', ctx.url)
    .replace('{title}', ctx.title)
    .replace('{summary}', ctx.summary)
    .replace('{content}', ctx.content)
    .replace('{browserContext}', ctx.browserContext)
    .replace('{selection}', ctx.selection || '');

  const raw = await callGroq(prompt, 'Только JSON объект.');
  const obj = parseJsonObject(raw);
  if (!obj) throw new Error('Не удалось распарсить JSON команды');

  const next = {
    id: makeSafeId(obj.id || obj.title),
    title: String(obj.title || 'Command').slice(0, 40),
    icon: String(obj.icon || '⚡').slice(0, 6),
    scope: ['page', 'selection', 'global'].includes(obj.scope) ? obj.scope : 'page',
    mode: ['note', 'clipboard'].includes(obj.mode) ? obj.mode : 'note',
    prompt: String(obj.prompt || '').trim(),
    system: String(obj.system || '').trim(),
    pinned: true
  };

  if (!next.prompt) throw new Error('Команда без prompt');

  // Ensure unique id
  const existing = await loadCustomCommands();
  let uniqueId = next.id;
  const taken = new Set(existing.map(c => c?.id).filter(Boolean));
  let n = 2;
  while (taken.has(uniqueId)) {
    uniqueId = `${next.id}_${n++}`;
  }
  next.id = uniqueId;

  // Assign a key
  const keys = getBuiltinCommands().map(c => c.key).concat(existing.map(c => c.key));
  next.key = pickFreeKey(keys);

  await saveCustomCommands(existing.concat(next));
  await refreshCommands();
  return next;
}

function ensureCommandPalette() {
  if (commandPaletteOverlayEl?.isConnected) return;

  const overlay = document.createElement('div');
  overlay.className = 'pzdrk-palette-overlay';
  overlay.style.display = 'none';
  overlay.innerHTML = `
    <div class="pzdrk-palette" role="dialog" aria-modal="true">
      <div class="pzdrk-palette-head">
        <input class="pzdrk-palette-input" type="text" placeholder="Command… (или /new … чтобы добавить)" />
      </div>
      <div class="pzdrk-palette-list"></div>
      <div class="pzdrk-palette-hint">Enter: run • ↑/↓: navigate • Esc: close • ⌘/Ctrl+K: toggle</div>
    </div>
  `;
  document.body.appendChild(overlay);

  commandPaletteOverlayEl = overlay;
  commandPaletteInputEl = overlay.querySelector('.pzdrk-palette-input');
  commandPaletteListEl = overlay.querySelector('.pzdrk-palette-list');

  overlay.addEventListener('mousedown', (e) => {
    if (e.target === overlay) closeCommandPalette();
  });

  commandPaletteInputEl?.addEventListener('input', () => {
    commandPaletteSelectedIndex = 0;
    renderCommandPaletteList();
  });

  commandPaletteInputEl?.addEventListener('keydown', async (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      closeCommandPalette();
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      commandPaletteSelectedIndex++;
      renderCommandPaletteList();
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      commandPaletteSelectedIndex = Math.max(0, commandPaletteSelectedIndex - 1);
      renderCommandPaletteList();
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      const items = Array.from(commandPaletteListEl?.querySelectorAll?.('.pzdrk-palette-item') || []);
      const target = items[commandPaletteSelectedIndex] || items[0];
      if (!target) return;
      const action = target.dataset.action;
      const cmdId = target.dataset.cmdId;
      const q = String(commandPaletteInputEl?.value || '').trim();

      if (action === 'create') {
        await runCreateCommandFromPalette(q);
        return;
      }

      const cmd = allCommands.find(c => c.id === cmdId);
      closeCommandPalette();
      if (cmd) await runCommand(cmd);
    }
  });
}

function isCommandPaletteOpen() {
  return !!(commandPaletteOverlayEl && commandPaletteOverlayEl.style.display !== 'none');
}

function openCommandPalette(initialText = '') {
  ensureCommandPalette();
  if (!commandPaletteOverlayEl || !commandPaletteInputEl) return;

  commandPaletteOverlayEl.style.display = 'flex';
  commandPaletteInputEl.value = initialText;
  commandPaletteSelectedIndex = 0;
  renderCommandPaletteList();
  setTimeout(() => commandPaletteInputEl?.focus(), 0);
}

function closeCommandPalette() {
  if (!commandPaletteOverlayEl) return;
  commandPaletteOverlayEl.style.display = 'none';
}

function renderCommandPaletteList() {
  if (!commandPaletteListEl || !commandPaletteInputEl) return;

  const q = String(commandPaletteInputEl.value || '').trim();
  const req = extractCommandRequest(q);
  const showCreate = q.startsWith('/new ') || q.startsWith('/cmd') || q.toLowerCase().startsWith('add command') || q.toLowerCase().startsWith('создай команду') || q.toLowerCase().startsWith('добавь команду');

  const list = [];
  if (showCreate && req) {
    list.push({ kind: 'create', title: `Create command: ${req.slice(0, 60)}`, icon: '➕', key: '' });
  }

  const norm = q.toLowerCase();
  const cmds = allCommands
    .filter(c => {
      if (!norm) return true;
      if (showCreate) {
        // when creating, still show matching commands below
      }
      return String(c.title || '').toLowerCase().includes(norm) || String(c.id || '').toLowerCase().includes(norm);
    })
    .slice(0, 24);

  cmds.forEach(c => list.push({ kind: 'cmd', cmd: c }));

  if (!list.length) {
    commandPaletteListEl.innerHTML = '<div class="pzdrk-palette-empty">Ничего не найдено</div>';
    return;
  }

  if (commandPaletteSelectedIndex >= list.length) commandPaletteSelectedIndex = list.length - 1;

  commandPaletteListEl.innerHTML = '';
  list.forEach((row, idx) => {
    const item = document.createElement('div');
    item.className = `pzdrk-palette-item ${idx === commandPaletteSelectedIndex ? 'is-active' : ''}`;

    if (row.kind === 'create') {
      item.dataset.action = 'create';
      item.innerHTML = `
        <div class="pzdrk-palette-item-left"><span class="pzdrk-palette-ico">➕</span><span class="pzdrk-palette-title">${escapeHtml(row.title)}</span></div>
        <div class="pzdrk-palette-meta">/new</div>
      `;
    } else {
      const c = row.cmd;
      item.dataset.cmdId = c.id;
      const key = (c.key || '').toString().toUpperCase();
      item.innerHTML = `
        <div class="pzdrk-palette-item-left"><span class="pzdrk-palette-ico">${escapeHtml(c.icon || '⚡')}</span><span class="pzdrk-palette-title">${escapeHtml(c.title || c.id)}</span></div>
        <div class="pzdrk-palette-meta">${escapeHtml(c.scope || 'page')}${key ? ` • ${escapeHtml(key)}` : ''}</div>
      `;
      item.addEventListener('click', async () => {
        closeCommandPalette();
        await runCommand(c);
      });
    }

    commandPaletteListEl.appendChild(item);
  });
}

async function runCreateCommandFromPalette(rawInput) {
  const req = extractCommandRequest(rawInput);
  if (!req) {
    showToast('Нужно: /new <описание>');
    return;
  }

  closeCommandPalette();

  const note = createNote({
    title: '➕ Command',
    type: 'action',
    content: '<div class="pzdrk-loading"><div class="pzdrk-spinner"></div>Создаю команду…</div>',
    collapsed: false,
    loading: true
  });
  note.dataset.pinned = 'true';

  try {
    const cmd = await createCustomCommandFromRequest(req);
    note.querySelector('.pzdrk-note-content').innerHTML = formatRichText(
      `## ✅ Команда добавлена\n- ${cmd.icon} **${cmd.title}**\n- scope: ${cmd.scope}\n- key: ${cmd.key ? cmd.key.toUpperCase() : '—'}\n- id: ${cmd.id}`
    );
    note.classList.remove('loading');
    setupHoverInteractions(note);
  } catch (e) {
    note.querySelector('.pzdrk-note-content').innerHTML = `<div class="pzdrk-error">❌ ${e.message}</div>`;
    note.classList.remove('loading');
  }
}

function initCommandSystem() {
  if (commandSystemInitialized) return;
  commandSystemInitialized = true;
  // Cleanup removed UI
  document.querySelectorAll('.pzdrk-command-rail').forEach(el => el.remove());
  ensureCommandPalette();
  refreshCommands();

  // Refresh on selection changes (debounced)
  document.addEventListener('selectionchange', () => {
    if (selectionTimer) clearTimeout(selectionTimer);
    selectionTimer = setTimeout(() => renderFloatingHints(), 120);
  });

  // React to storage changes
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== 'sync') return;
    runtimeSettings = null;
    if (changes[CUSTOM_COMMANDS_KEY]) refreshCommands();
  });
}

// ============ FLOATING ACTION HINTS ============
// These appear as separate floating rectangles with keyboard shortcuts

const FLYOUT_ACTION_IDS = new Set(['twitter', 'deepdive', 'automation', 'learning', 'share', 'challenge']);
const ACTION_FLYOUT_MARGIN = 12;
const ACTION_FLYOUT_HIDE_DELAY = 140;

const flyoutPrefetchCache = new Map();
const FLYOUT_PREFETCH_CACHE_LIMIT = 60;

function pruneFlyoutPrefetchCache(limit = FLYOUT_PREFETCH_CACHE_LIMIT) {
  const lim = Math.max(10, Math.min(500, Number(limit) || FLYOUT_PREFETCH_CACHE_LIMIT));
  if (flyoutPrefetchCache.size <= lim) return;

  const entries = Array.from(flyoutPrefetchCache.entries()).map(([k, v]) => ({
    k,
    t: Number(v?.finishedAt || v?.startedAt || 0)
  }));

  entries.sort((a, b) => (a.t - b.t));
  const removeCount = Math.max(1, flyoutPrefetchCache.size - lim);
  for (let i = 0; i < removeCount && i < entries.length; i++) {
    flyoutPrefetchCache.delete(entries[i].k);
  }
}

function simpleHash32(str) {
  const s = String(str || '');
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16);
}

function getFlyoutCacheKey(cmd) {
  const id = String(cmd?.id || '').trim();
  const scope = String(cmd?.scope || 'page');
  const url = window.location.href;
  if (!id) return `${url}::(unknown)`;
  if (scope === 'selection') {
    const sel = getSelectionText() || '';
    return `${url}::${id}::sel:${simpleHash32(sel).slice(0, 8)}`;
  }
  return `${url}::${id}`;
}

function isActionFlyoutCommand(cmd) {
  if (!cmd || !cmd.id) return false;
  if (cmd.kind === 'custom') return (cmd.mode || 'note') === 'note';
  if (cmd.kind === 'builtin') return FLYOUT_ACTION_IDS.has(cmd.id);
  return false;
}

function ensureActionFlyoutNote() {
  if (actionFlyout?.note && actionFlyout.note.isConnected) return actionFlyout.note;

  const note = createNote({
    title: '',
    type: 'action',
    content: '',
    collapsed: false,
    loading: false,
    layout: 'flyout'
  });
  note.dataset.pinned = 'false';
  note.style.display = 'none';

  actionFlyout = {
    note,
    pinned: false,
    cmdId: null,
    anchorEl: null,
    hideTimer: null,
    prefetchTimer: null,
    prefetchKey: null
  };

  note.addEventListener('mouseenter', () => {
    if (actionFlyout?.hideTimer) clearTimeout(actionFlyout.hideTimer);
  });
  note.addEventListener('mouseleave', () => {
    if (!actionFlyout?.pinned) scheduleHideActionFlyout();
  });

  return note;
}

function scheduleHideActionFlyout() {
  if (!actionFlyout?.note) return;
  if (actionFlyout.hideTimer) clearTimeout(actionFlyout.hideTimer);
  actionFlyout.hideTimer = setTimeout(() => {
    hideActionFlyout(false);
  }, ACTION_FLYOUT_HIDE_DELAY);
}

function hideActionFlyout(force = false) {
  if (!actionFlyout?.note) return;
  if (actionFlyout.pinned && !force) return;
  if (actionFlyout.hideTimer) clearTimeout(actionFlyout.hideTimer);
  if (actionFlyout.prefetchTimer) clearTimeout(actionFlyout.prefetchTimer);
  actionFlyout.hideTimer = null;
  actionFlyout.prefetchTimer = null;
  actionFlyout.prefetchKey = null;
  actionFlyout.pinned = false;
  actionFlyout.cmdId = null;
  actionFlyout.anchorEl = null;
  actionFlyout.note.dataset.pinned = 'false';
  actionFlyout.note.classList.remove('loading');
  actionFlyout.note.style.display = 'none';
}

function setFlyoutContent(note, title, html, loading = false) {
  const titleEl = note.querySelector('.pzdrk-note-title');
  if (titleEl) titleEl.textContent = title || 'Action';
  const contentEl = note.querySelector('.pzdrk-note-content');
  if (contentEl) contentEl.innerHTML = html || '';
  note.classList.toggle('loading', !!loading);
}

function positionActionFlyout(anchorEl = actionFlyout?.anchorEl) {
  if (!actionFlyout?.note) return;
  let anchor = anchorEl;

  if (!anchor || !anchor.isConnected) {
    const cmdId = String(actionFlyout?.cmdId || '').trim();
    if (actionFlyout?.pinned && cmdId && actionsAnchorNote && actionsAnchorNote.isConnected) {
      const esc = (globalThis.CSS?.escape ? CSS.escape(cmdId) : cmdId);
      const fresh = actionsAnchorNote.querySelector(`.pzdrk-note-actions .pzdrk-note-action[data-cmd="${esc}"]`);
      if (fresh) {
        actionFlyout.anchorEl = fresh;
        anchor = fresh;
      }
    }
  }

  if (!anchor || !anchor.isConnected) {
    if (!actionFlyout?.pinned) hideActionFlyout(true);
    return;
  }
  const note = actionFlyout.note;
  if (!note.isConnected || note.style.display === 'none') return;

  const rect = anchor.getBoundingClientRect();
  note.style.transform = 'none';

  const noteRect = note.getBoundingClientRect();
  let left = rect.right + ACTION_FLYOUT_MARGIN;
  if ((left + noteRect.width) > (window.innerWidth - 8)) {
    left = rect.left - noteRect.width - ACTION_FLYOUT_MARGIN;
  }
  left = Math.max(8, Math.min(left, window.innerWidth - noteRect.width - 8));

  let top = rect.top - 6;
  top = Math.max(8, Math.min(top, window.innerHeight - noteRect.height - 8));

  note.style.left = `${left}px`;
  note.style.top = `${top}px`;
}

function showActionFlyoutPreview(cmd, anchorEl) {
  if (actionFlyout?.pinned) return;
  const note = ensureActionFlyoutNote();
  if (actionFlyout.hideTimer) clearTimeout(actionFlyout.hideTimer);

  const cacheKey = getFlyoutCacheKey(cmd);
  const cached = flyoutPrefetchCache.get(cacheKey);

  const safeTitle = escapeHtml(cmd?.title || cmd?.id || 'Action');
  let preview = `<div class="pzdrk-action-preview">${safeTitle}<br>Нажмите, чтобы выполнить</div>`;
  let loading = false;

  if (cached?.status === 'done' && cached.html) {
    preview = String(cached.html);
  } else if (cached?.status === 'pending') {
    preview = '<div class="pzdrk-loading"><div class="pzdrk-spinner"></div>Prefetch…</div>';
    loading = true;
  } else if (cached?.status === 'error') {
    preview = `<div class="pzdrk-error">❌ ${escapeHtml(cached.error || 'ошибка')}</div>`;
  }

  actionFlyout.pinned = false;
  actionFlyout.cmdId = cmd?.id || null;
  actionFlyout.anchorEl = anchorEl || null;
  actionFlyout.prefetchKey = cacheKey;
  note.dataset.pinned = 'false';
  note.style.display = 'flex';
  setFlyoutContent(note, cmd?.title || cmd?.id || 'Action', preview, loading);
  setupHoverInteractions(note);
  positionActionFlyout(anchorEl);
}

function openActionFlyoutPinned(cmd, anchorEl, opts = {}) {
  const note = ensureActionFlyoutNote();
  if (actionFlyout.hideTimer) clearTimeout(actionFlyout.hideTimer);
  if (actionFlyout.prefetchTimer) clearTimeout(actionFlyout.prefetchTimer);
  actionFlyout.prefetchTimer = null;
  actionFlyout.pinned = true;
  actionFlyout.cmdId = cmd?.id || null;
  actionFlyout.anchorEl = anchorEl || null;
  note.dataset.pinned = 'true';
  note.style.display = 'flex';

  const preserve = !!opts.preserveContent;
  if (!preserve) {
    setFlyoutContent(
      note,
      cmd?.title || cmd?.id || 'Action',
      '<div class="pzdrk-loading"><div class="pzdrk-spinner"></div>Генерирую…</div>',
      true
    );
  }
  positionActionFlyout(anchorEl);
  return note;
}

async function buildFlyoutOutput(cmd, settings) {
  if (!cmd) throw new Error('No command');
  const ctx = getCommandContext();

  if (cmd.kind === 'custom') {
    if ((cmd.scope || 'page') === 'selection' && !ctx.selection) throw new Error('Нужно выделение');
    const prompt = renderTemplate(cmd.prompt, ctx);
    const system = (cmd.system && String(cmd.system).trim()) ? String(cmd.system) : STYLE_RULES;
    return await callGroq(prompt, system, { temperature: 0.35, max_tokens: Math.max(256, Number(settings?.targetMaxOutputTokens) || 500) });
  }

  if (cmd.kind === 'builtin' && FLYOUT_ACTION_IDS.has(cmd.id)) {
    const actionType = cmd.id;
    const override = String(settings?.actionPrompts?.[actionType] || '').trim();
    const tpl = override || DEFAULT_ACTION_PROMPTS[actionType];
    if (!tpl) throw new Error('Нет промпта для действия: ' + actionType);
    const prompt = renderTemplate(tpl, ctx);
    return await callGroq(prompt, STYLE_RULES, { temperature: 0.35, max_tokens: Math.max(256, Number(settings?.targetMaxOutputTokens) || 500) });
  }

  throw new Error('Unsupported flyout command');
}

async function maybeScheduleFlyoutPrefetch(cmd, anchorEl) {
  if (!cmd || !anchorEl) return;
  if (actionFlyout?.pinned) return;

  const settings = runtimeSettings || await getSettings().catch(() => null);
  if (settings) runtimeSettings = settings;
  if (!settings?.prefetchOnHover) return;

  const delay = Number.isFinite(Number(settings.prefetchDelayMs)) ? Number(settings.prefetchDelayMs) : 320;
  const cacheKey = getFlyoutCacheKey(cmd);

  if (actionFlyout?.prefetchTimer) clearTimeout(actionFlyout.prefetchTimer);
  actionFlyout.prefetchKey = cacheKey;

  actionFlyout.prefetchTimer = setTimeout(() => {
    startFlyoutPrefetch(cmd, anchorEl, cacheKey, settings);
  }, Math.max(0, Math.min(2000, delay)));
}

async function startFlyoutPrefetch(cmd, anchorEl, cacheKey, settings) {
  if (!cmd || !cacheKey) return;
  if (actionFlyout?.pinned) return;
  if (String(actionFlyout?.cmdId || '') !== String(cmd.id || '')) return;
  if (String(actionFlyout?.prefetchKey || '') !== String(cacheKey)) return;

  const note = ensureActionFlyoutNote();
  const cached = flyoutPrefetchCache.get(cacheKey);
  if (cached?.status === 'done' || cached?.status === 'pending') return;

  const entry = { status: 'pending', html: '', text: '', error: '', startedAt: Date.now(), finishedAt: 0, promise: null };
  flyoutPrefetchCache.set(cacheKey, entry);
  pruneFlyoutPrefetchCache();

  note.style.display = 'flex';
  setFlyoutContent(note, cmd?.title || cmd?.id || 'Action', '<div class="pzdrk-loading"><div class="pzdrk-spinner"></div>Prefetch…</div>', true);
  positionActionFlyout(anchorEl);

  entry.promise = (async () => {
    try {
      const out = await buildFlyoutOutput(cmd, settings);
      entry.status = 'done';
      entry.text = String(out || '');
      entry.html = formatRichText(entry.text || '—');
      entry.finishedAt = Date.now();
    } catch (e) {
      entry.status = 'error';
      entry.error = String(e?.message || 'ошибка');
      entry.html = `<div class="pzdrk-error">❌ ${escapeHtml(entry.error)}</div>`;
      entry.finishedAt = Date.now();
    }

    // Update UI even if flyout is currently hidden.
    if (!note.isConnected) return;
    setFlyoutContent(note, cmd?.title || cmd?.id || 'Action', entry.html || '', entry.status === 'pending');
    note.classList.toggle('loading', entry.status === 'pending');
    setupHoverInteractions(note);
    positionActionFlyout();
  })();
}

async function runFlyoutCommand(cmd, note, anchorEl) {
  if (!cmd) return;
  if (cmd.kind === 'custom') return runCustomCommand(cmd, { targetNote: note, anchorEl });
  if (cmd.kind === 'builtin' && FLYOUT_ACTION_IDS.has(cmd.id)) {
    const action = getDefaultActions().find(a => a.type === cmd.id);
    return executeAction(action, { targetNote: note, anchorEl });
  }
  return runCommand(cmd);
}

function getDefaultActions() {
  return [
    { key: 'M', title: 'Mindmap', type: 'mindmap', icon: '🗺' },
    { key: '1', title: 'Twitter', type: 'twitter', icon: '🐦' },
    { key: '2', title: 'Deep Dive', type: 'deepdive', icon: '🔬' },
    { key: '3', title: 'Automate', type: 'automation', icon: '⚡' },
    { key: '4', title: 'Learn', type: 'learning', icon: '📚' },
    { key: '5', title: 'Share', type: 'share', icon: '📤' },
    { key: '6', title: 'Challenge', type: 'challenge', icon: '🎯' },
  ];
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

// Back-compat name: this now attaches the action panel *inside* a note.
function createFloatingHints(noteElement) {
  if (!noteElement || !noteElement.isConnected) return;

  // Keep only one attached panel (latest summary note)
  if (actionsAnchorNote && actionsAnchorNote !== noteElement) {
    try { actionsAnchorNote.querySelector('.pzdrk-note-actions')?.remove(); } catch (e) {}
    hideActionFlyout(true);
  }
  actionsAnchorNote = noteElement;

  // Ensure container exists
  let container = noteElement.querySelector('.pzdrk-note-actions');
  if (!container) {
    container = document.createElement('div');
    container.className = 'pzdrk-note-actions';
    noteElement.appendChild(container);
  }

  renderFloatingHints();
  updateNoteActionsPlacement(noteElement);
}

function getHintCommands() {
  const sel = getSelectionText();
  const hasSel = !!sel;

  const pinned = allCommands
    .filter(c => c && c.pinned)
    .filter(c => c.id !== 'palette' && c.id !== 'new_command');

  const globals = pinned.filter(c => c.scope === 'global');
  const selectionCmds = pinned.filter(c => c.scope === 'selection');
  const pageCmds = pinned.filter(c => c.scope === 'page');

  const ordered = hasSel
    ? globals.concat(selectionCmds, pageCmds)
    : globals.concat(pageCmds, selectionCmds);

  const seen = new Set();
  return ordered.filter(c => {
    if (!c || !c.id) return false;
    if (seen.has(c.id)) return false;
    seen.add(c.id);
    return true;
  });
}

function renderFloatingHints() {
  const note = actionsAnchorNote;
  if (!note || !note.isConnected) return;
  const container = note.querySelector('.pzdrk-note-actions');
  if (!container) return;

  const hasSelection = !!getSelectionText();
  const cmds = getHintCommands();
  const btnById = new Map();

  container.innerHTML = '';
  cmds.forEach(cmd => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'pzdrk-note-action';
    btn.setAttribute('data-cmd', cmd.id);

    const key = (cmd.key || '').toString().toUpperCase();
    const disabled = (cmd.scope === 'selection') && !hasSelection;
    if (disabled) btn.disabled = true;

    btn.innerHTML = `
      <span class="pzdrk-note-action-icon">${escapeHtml(cmd.icon || '⚡')}</span>
      <span class="pzdrk-note-action-text">${escapeHtml(cmd.title || cmd.id)}</span>
      ${key ? `<span class="pzdrk-note-action-key">${escapeHtml(key)}</span>` : ''}
    `;
    btn.title = `${cmd.title || cmd.id}${key ? ` (${key})` : ''}`;

    const isFlyout = isActionFlyoutCommand(cmd);
    if (isFlyout) {
      btn.addEventListener('mouseenter', () => {
        if (btn.disabled) return;
        showActionFlyoutPreview(cmd, btn);
        maybeScheduleFlyoutPrefetch(cmd, btn);
      });
      btn.addEventListener('mouseleave', () => {
        if (actionFlyout?.prefetchTimer) {
          clearTimeout(actionFlyout.prefetchTimer);
          actionFlyout.prefetchTimer = null;
        }
        if (actionFlyout?.pinned) return;
        scheduleHideActionFlyout();
      });
    }

    btn.addEventListener('click', async (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (btn.disabled) return;

      const keyEl = btn.querySelector('.pzdrk-note-action-key');
      if (keyEl) keyEl.textContent = '⏳';
      btn.disabled = true;

      try {
        if (isFlyout) {
          const cacheKey = getFlyoutCacheKey(cmd);
          const cached = flyoutPrefetchCache.get(cacheKey);

          // If hover-prefetch already started (or finished), just pin and reuse.
          if (cached?.status === 'pending' || cached?.status === 'done' || cached?.status === 'error') {
            const flyoutNote = openActionFlyoutPinned(cmd, btn, { preserveContent: true });
            if (cached.status === 'pending') {
              setFlyoutContent(flyoutNote, cmd?.title || cmd?.id || 'Action', '<div class="pzdrk-loading"><div class="pzdrk-spinner"></div>Генерирую…</div>', true);
            } else if (cached.status === 'done' && cached.html) {
              setFlyoutContent(flyoutNote, cmd?.title || cmd?.id || 'Action', String(cached.html), false);
            } else if (cached.status === 'error') {
              setFlyoutContent(flyoutNote, cmd?.title || cmd?.id || 'Action', `<div class="pzdrk-error">❌ ${escapeHtml(cached.error || 'ошибка')}</div>`, false);
            }
            setupHoverInteractions(flyoutNote);
            positionActionFlyout(btn);
            return;
          }

          // No cache yet: run normally and store result for instant next hover.
          flyoutPrefetchCache.set(cacheKey, { status: 'pending', html: '', text: '', error: '', startedAt: Date.now(), finishedAt: 0, promise: null });
          pruneFlyoutPrefetchCache();
          const flyoutNote = openActionFlyoutPinned(cmd, btn);
          await runFlyoutCommand(cmd, flyoutNote, btn);
          positionActionFlyout(btn);

          const html = flyoutNote.querySelector('.pzdrk-note-content')?.innerHTML || '';
          const text = flyoutNote.querySelector('.pzdrk-note-content')?.innerText || '';
          flyoutPrefetchCache.set(cacheKey, { status: 'done', html, text, error: '', startedAt: Date.now(), finishedAt: Date.now(), promise: null });
          pruneFlyoutPrefetchCache();
        } else {
          await runCommand(cmd);
        }
      } finally {
        // Re-render to restore disabled state (selection) + keycaps
        renderFloatingHints();
        updateNoteActionsPlacement(note);
      }
    });

    container.appendChild(btn);
    btnById.set(cmd.id, btn);
  });

  updateNoteActionsPlacement(note);

  if (actionFlyout?.pinned && actionFlyout.cmdId) {
    const pinnedBtn = btnById.get(actionFlyout.cmdId);
    if (pinnedBtn) {
      actionFlyout.anchorEl = pinnedBtn;
      positionActionFlyout(pinnedBtn);
    } else {
      hideActionFlyout(true);
    }
  }
}

function updateNoteActionsPlacement(noteElement = actionsAnchorNote) {
  const note = noteElement;
  if (!note || !note.isConnected) return;
  const container = note.querySelector('.pzdrk-note-actions');
  if (!container) return;

  if (note.classList.contains('docked')) {
    hideActionFlyout(true);
    return;
  }

  container.classList.remove('actions-left', 'actions-overlay');

  // Default: right side; if it overflows, flip left; if still overflows, overlay inside note
  const margin = 12;
  let r = container.getBoundingClientRect();
  if (r.right > (window.innerWidth - margin)) {
    container.classList.add('actions-left');
    r = container.getBoundingClientRect();
    if (r.left < margin) {
      container.classList.remove('actions-left');
      container.classList.add('actions-overlay');
    }
  }

  if (actionFlyout?.note && actionFlyout.note.isConnected) positionActionFlyout(actionFlyout.anchorEl);
}

window.addEventListener('resize', () => {
  updateNoteActionsPlacement();
  document.querySelectorAll('.pzdrk-note').forEach(n => updateNoteNavPlacement(n));
  scheduleLayoutNotes();
});

async function executeAction(action, options = {}) {
  if (!action || !action.type) return;
  if (activeActions.has(action.type)) return;
  activeActions.add(action.type);

  let note = null;
  const targetNote = (options && options.targetNote && options.targetNote.isConnected) ? options.targetNote : null;

  try {
    if (action.type === 'mindmap') {
      await generateMindmap();
      return;
    }

    const settings = await getSettings().catch(() => ({ actionPrompts: {} }));
    const ctx = getCommandContext();
    const override = String(settings.actionPrompts?.[action.type] || '').trim();
    const tpl = override || DEFAULT_ACTION_PROMPTS[action.type];
    if (!tpl) throw new Error('Нет промпта для действия: ' + action.type);

    const prompt = renderTemplate(tpl, ctx);

    note = targetNote || createNote({
      title: action.title,
      type: 'action',
      content: '<div class="pzdrk-loading"><div class="pzdrk-spinner"></div></div>',
      collapsed: false,
      loading: true
    });
    note.dataset.pinned = 'true';
    if (targetNote) {
      const titleEl = note.querySelector('.pzdrk-note-title');
      if (titleEl) titleEl.textContent = action.title || 'Action';
      const contentEl = note.querySelector('.pzdrk-note-content');
      if (contentEl && !contentEl.innerHTML.trim()) {
        contentEl.innerHTML = '<div class="pzdrk-loading"><div class="pzdrk-spinner"></div></div>';
      }
      note.classList.add('loading');
    }

    const result = await callGroq(prompt, STYLE_RULES);
    note.querySelector('.pzdrk-note-content').innerHTML = formatRichText(result);
    note.classList.remove('loading');
    setupHoverInteractions(note);
    positionActionFlyout();
  } catch (e) {
    if (note && note.isConnected) {
      note.querySelector('.pzdrk-note-content').innerHTML = `<div class="pzdrk-error">❌ ${(e && e.message) ? e.message : 'ошибка'}</div>`;
      note.classList.remove('loading');
      positionActionFlyout();
    } else {
      showToast('Action: ' + ((e && e.message) ? e.message : 'ошибка'));
    }
  } finally {
    activeActions.delete(action.type);
  }
}

// ============ MINDMAP v2 (Deep Parallel) ============

async function generateMindmap() {
  const content = lastSummaryData?.pageContent || extractPageContent();
  const summary = lastSummaryContent || '';
  
  const note = createNote({
    title: 'Mindmap v2',
    type: 'mindmap',
    content: '<div class="pzdrk-loading"><div class="pzdrk-spinner"></div>Генерация (6 потоков)...</div>',
    collapsed: false,
    loading: true
  });
  note.dataset.pinned = 'true';
  note.style.width = '550px';
  note.style.maxHeight = '75vh';

  try {
    // 1. Initial Skeleton
    const prompt = PROMPTS.mindmap
      .replace('{content}', content.substring(0, 4000))
      .replace('{summary}', summary.substring(0, 1500));
    const result = await callGroq(prompt, 'Только JSON');
    
    let data;
    try { const m = result.match(/\{[\s\S]*\}/); data = JSON.parse(m[0]); } catch (e) { throw new Error('JSON 1 failed'); }

    if (!data.nodes) data.nodes = [];

    // 2. Parallel Expansion (6 top branches)
    const expansionTargets = data.nodes.slice(0, 6);
    if (expansionTargets.length > 0) {
      const updates = await Promise.all(expansionTargets.map(node => 
        callGroq(
          PROMPTS.mindmapExpand.replace('{label}', node.label).replace('{description}', node.description || '').replace('{content}', content.substring(0, 2000)),
          'Только JSON массив'
        ).then(res => {
          try {
            const m = res.match(/\[[\s\S]*\]/);
            return m ? JSON.parse(m[0]) : [];
          } catch (e) { return []; }
        }).catch(() => [])
      ));

      // Merge children
      expansionTargets.forEach((node, i) => {
        if (updates[i] && updates[i].length) {
          node.children = (node.children || []).concat(updates[i]);
        }
      });
    }

    // Render Mindmap
    const renderNode = (node, level = 0) => {
      const hasChildren = node.children && node.children.length > 0;
      let html = `<div class="pzdrk-mm-node pzdrk-mm-level-${level}" data-level="${level}">`;
      
      html += `<div class="pzdrk-mm-header">
        ${hasChildren ? '<span class="pzdrk-mm-toggle">▼</span>' : '<span class="pzdrk-mm-bullet">●</span>'}
        <span class="pzdrk-mm-label">${escapeHtml(node.label)}</span>
      </div>`;
      
      if (node.description) {
        html += `<div class="pzdrk-mm-desc">${formatRichText(node.description)}</div>`;
      }
      
      if (node.insights && node.insights.length) {
        html += `<div class="pzdrk-mm-insights">${node.insights.map(i => `<span class="pzdrk-mm-insight">💡 ${escapeHtml(i)}</span>`).join('')}</div>`;
      }

      if (hasChildren) {
        html += `<div class="pzdrk-mm-children">`;
        node.children.forEach(child => { html += renderNode(child, level + 1); });
        html += `</div>`;
      }
      
      html += `</div>`;
      return html;
    };

    let html = `<div class="pzdrk-mindmap">`;
    data.nodes.forEach(node => { html += renderNode(node, 0); });
    
    // Metadata footer
    const meta = data.metadata || {};
    html += `<div class="pzdrk-mm-metadata">
      <div class="pzdrk-mm-meta-item">Domain: ${escapeHtml(meta.domain || 'N/A')}</div>
      <div class="pzdrk-mm-meta-item">Complexity: ${escapeHtml(meta.complexity || 'N/A')}</div>
      <div class="pzdrk-mm-meta-item">Nodes: ${data.nodes.reduce((acc, n) => acc + 1 + (n.children?.length||0), 0)}+</div>
    </div>`;
    
    html += `</div>`;
    
    // Mermaid Export
    html += `<button class="pzdrk-mermaid-btn">Export to Mermaid</button>`;

    note.querySelector('.pzdrk-note-content').innerHTML = html;
    note.classList.remove('loading');
    
    // Toggle behavior
    note.querySelectorAll('.pzdrk-mm-header').forEach(header => {
      header.addEventListener('click', (e) => {
        e.stopPropagation();
        const nodeEl = header.parentElement;
        nodeEl.classList.toggle('collapsed');
      });
    });

    // Mermaid Export handler
    note.querySelector('.pzdrk-mermaid-btn').addEventListener('click', () => {
      let mm = 'mindmap\n  root((' + (data.title || 'Mindmap') + '))\n';
      const traverse = (nodes, indent) => {
        nodes.forEach(n => {
          mm += `${indent}${n.label.replace(/[()]/g, '')}\n`;
          if (n.children) traverse(n.children, indent + '  ');
        });
      };
      traverse(data.nodes, '    ');
      navigator.clipboard.writeText(mm);
      showToast('📋 Mermaid скопирован');
    });

    setupHoverInteractions(note);

  } catch (error) {
    note.querySelector('.pzdrk-note-content').innerHTML = `<div class="pzdrk-error">❌ ${error.message}</div>`;
    note.classList.remove('loading');
  }
}

// ============ MESSAGING (Popup / Background / Context Menu) ============

async function refreshTrackerBadges() {
  const stats = await getTrackerStats().catch(() => ({ blocked: 0 }));
  document.querySelectorAll('.pzdrk-blocked-count').forEach(el => {
    el.textContent = String(stats.blocked || 0);
  });
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  const action = request?.action;
  if (!action) return;

  if (action === 'trackerBlocked') {
    trackersBlocked++;
    refreshTrackerBadges();
    try { sendResponse?.({ success: true }); } catch (e) {}
    return;
  }

  const run = async () => {
    if (action === 'summarize') return summarizePage();
    if (action === 'generateMindmap') return generateMindmap();
    if (action === 'translatePage') return translatePage(request.lang || 'ru');
    if (action === 'translateSelection') return translateSelection(request.text, request.lang || 'ru');
    if (action === 'explainSelection') return explainSelection(request.text);
  };

  if (['summarize', 'generateMindmap', 'translatePage', 'translateSelection', 'explainSelection'].includes(action)) {
    run()
      .then(() => sendResponse({ success: true }))
      .catch((e) => sendResponse({ success: false, error: e.message }));
    return true;
  }
});

// ============ INIT ============

async function scheduleAutoSummarize() {
  const settings = await getSettings().catch(() => ({ autoSummarize: true }));
  runtimeSettings = settings;
  initCommandSystem();
  if (!settings.autoSummarize) return;
  setTimeout(summarizePage, 1000);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => scheduleAutoSummarize());
} else {
  scheduleAutoSummarize();
}

function pickCommandByKey(key, hasSelection) {
  const k = normalizeHotkey(key);
  if (!k) return null;
  const matches = allCommands.filter(c => normalizeHotkey(c.key) === k);
  if (!matches.length) return null;
  if (matches.length === 1) return matches[0];

  // Prefer selection-scoped when selection exists
  if (hasSelection) {
    const sel = matches.find(c => c.scope === 'selection');
    if (sel) return sel;
  }
  const page = matches.find(c => c.scope === 'page');
  if (page) return page;
  return matches[0];
}

// Shortcuts + palette
// All keyboard shortcuts removed
