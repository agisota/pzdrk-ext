document.addEventListener('DOMContentLoaded', async () => {
  const DEFAULT_GROQ_MODEL = 'groq/compound';
  const DEFAULT_CEREBRAS_MODEL = 'gpt-oss-120b';
  const LOCAL_OVERRIDES_FILE = 'local-overrides.json';
  const DEFAULT_TARGET_MAX_OUTPUT_TOKENS = 8192;
  const DEFAULT_MAX_PARALLEL_REQUESTS = 64;
  const DEFAULT_PREFETCH_DELAY_MS = 220;
  const PROMPT_OPERATING_SYSTEM = `Режим: staff operator / research copilot.
- Сначала восстанови цель пользователя, decision surface и рабочий контекст.
- Разделяй: факт / inference / гипотеза / что проверить / next step.
- Предпочитай layered output: executive signal -> mechanics -> risks -> actions.
- Не пиши generic советы; давай сильные варианты, trade-offs, failure modes и checkpoints.
- Если есть несколько путей, сравни их по скорости внедрения, риску и качеству результата.
- Если данных не хватает, явно фиксируй пробелы и предлагай способ валидации вместо фантазий.
- Если tool-use/поиск реально повышает точность, закладывай это как часть решения.
- Каждый ответ должен возвращать рабочий артефакт: таблицу, план, чеклист, матрицу, бриф, сценарий, список проверок или готовый текст.
- Для action-oriented задач указывай owner/следующий шаг/критерий готовности, если это применимо по контексту.
- Отмечай confidence и источник уверенности: прямой факт, inference, гипотеза или внешний пробел.
- Не смешивай summary и recommendation: сначала сигнал, затем вариант решения, затем риск и проверка.
- Стиль: плотно, профессионально, инженерно, без воды и без маркетингового тона.`;

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
    'twoColumnSummary', 'summaryJsonPrompt', 'sectionEnrichPrompt'
  ]);

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

    for (const key of ['byokMode', 'prefetchOnHover', 'mapReduceEnabled', 'twoColumnSummary']) {
      if (typeof overrides[key] === 'boolean') next[key] = overrides[key];
    }

    if (groqApiKeys.length || cerebrasApiKeys.length) next.byokMode = true;

    return next;
  }

  const settings = applyLocalOverrides(storedSettings, await loadLocalOverrides());

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
      'compound',
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

  const DEFAULT_ACTION_PROMPTS = {
    twitter: `${PROMPT_OPERATING_SYSTEM}

Сделай X/Twitter-тред уровня operator memo.

Формат:
1. 6-10 твитов.
2. Первый твит = сильный hook + main claim.
3. Средние твиты = тезисы, evidence, контраргументы, practical takeaways.
4. Последний твит = CTA / вопрос / next move.

Требования:
- Каждый твит автономно читается и ведёт к следующему.
- Где есть факты/метрики, помечай через [[evidence:...]].
- Не пиши банальные общие места; нужен angle.
- Если информации мало, честно сузь claim.

URL: {url}
TITLE: {title}

SUMMARY:
{summary}

PAGE SNIPPET:
{content}

USER CONTEXT:
{browserContext}`,

    deepdive: `${PROMPT_OPERATING_SYSTEM}

Сделай глубокий разбор материала как для сильной strategy/engineering review.

Структура:
1. Core thesis
2. Hidden assumptions
3. Non-obvious connections
4. Risks / anti-patterns
5. What is actually actionable now
6. What still needs validation

URL: {url}
TITLE: {title}

SUMMARY:
{summary}

PAGE SNIPPET:
{content}

USER CONTEXT:
{browserContext}`,

    automation: `${PROMPT_OPERATING_SYSTEM}

Предложи план автоматизации как solution architect.

Дай 3 слоя:
1. Quick win: 30-60 минут
2. Solid implementation: 1-2 дня
3. Serious system: 1-2 недели

Для каждого слоя:
- цель
- стек / инструменты / API
- архитектура потока
- узкие места
- шаги внедрения
- критерий готовности

URL: {url}
TITLE: {title}

SUMMARY:
{summary}

PAGE SNIPPET:
{content}

USER CONTEXT:
{browserContext}`,

    learning: `${PROMPT_OPERATING_SYSTEM}

Собери 14-дневный learning sprint.

На каждый день дай:
- цель дня
- что читать/смотреть
- практику
- mini-deliverable
- критерий проверки понимания

В конце:
- 3 capstone mini-projects
- типичные ошибки
- как понять, что тема реально усвоена

URL: {url}
TITLE: {title}

SUMMARY:
{summary}

PAGE SNIPPET:
{content}`,

    share: `${PROMPT_OPERATING_SYSTEM}

Подготовь пакет для распространения материала.

Нужны:
1. Slack update: 3-4 предложения
2. Email: subject + preheader + 2 абзаца
3. LinkedIn post: сильный opening + insight + CTA
4. Telegram post: коротко, плотно, без воды

Требования:
- Тон канала должен отличаться, не просто копипаста.
- Сохраняй реальные claims источника.
- Если есть неопределённость, не раздувай обещания.

URL: {url}
TITLE: {title}

SUMMARY:
{summary}`,

    challenge: `${PROMPT_OPERATING_SYSTEM}

Сделай critic mode.

Нужно:
1. 7-10 сильных неудобных вопросов по материалу.
2. Для каждого: 2 гипотезы, что проверить, где искать сигнал.
3. TOP-5 objectives для дальнейшего исследования/внедрения.
4. 10 next best prompts для следующего шага.

Фокус:
- атакуй слабые места, а не пересказывай содержание;
- ищи missing context, incentives, second-order effects, execution risk.

URL: {url}
TITLE: {title}

SUMMARY:
{summary}

PAGE SNIPPET:
{content}`,

    timeline: `${PROMPT_OPERATING_SYSTEM}

Построй операторскую хронологию по материалу. Пиши по-русски. Английские термины и исходные названия не размазывай по всему тексту: выноси их в отдельный блок комментариев в конце.

Формат ответа:
## TL;DR
- 2-4 коротких вывода по сути: что произошло, где узкое место, что это меняет

## Хронология событий
Сделай НОРМАЛЬНУЮ markdown-таблицу, а не ASCII-псевдографику.
Колонки строго такие:
| № | Этап | Что произошло / должно произойти | Кто вовлечён | Входы / зависимости | Результат / последствия | Уверенность |
|---|---|---|---|---|---|---|

Требования:
- 5-12 строк.
- Ячейки короткие и предметные.
- Если точных дат нет, используй относительный порядок и явно помечай неопределённость.
- Не пиши длинные абзацы внутри таблицы.

## Узкие места
- 3-6 пунктов

## Слепые зоны
- 3-6 пунктов: чего пока не хватает для полной хронологии

## Что проверить дальше
- 4-8 конкретных шагов верификации

## Комментарии к терминам
- Кратко поясни англицизмы / термины справа отдельным блоком.

URL: {url}
TITLE: {title}

SUMMARY:
{summary}

PAGE SNIPPET:
{content}

USER CONTEXT:
{browserContext}`,

    extract: `${PROMPT_OPERATING_SYSTEM}

Сделай structured extraction pack без воды.

Вытащи в отдельных секциях:
1. Key claims
2. Entities / actors
3. Numbers / dates / metrics
4. Tools / APIs / systems
5. Deliverables / outputs
6. Action items
7. Risks / unknowns

Правила:
- Только конкретика из материала или осторожные inference с явной пометкой.
- Не превращай extraction в эссе.
- Где уместно, используй компактные bullet lists.

URL: {url}
TITLE: {title}

SUMMARY:
{summary}

PAGE SNIPPET:
{content}

USER CONTEXT:
{browserContext}`,

    briefing: `${PROMPT_OPERATING_SYSTEM}

Сделай жёсткий briefing для человека, который должен принять решение быстро. Пиши на простом сильном русском. Англоязычные термины и jargon выноси в короткие комментарии в конце.

Формат ответа:
## TL;DR
- 3-5 строк: что происходит, почему это важно сейчас, какой ход лучший

## Что происходит на самом деле
- 1 короткий блок без воды, без пересказа

## Варианты действий
Сделай markdown-таблицу:
| Вариант | Что выигрываем | Цена / риск | Скорость | Когда выбирать |
|---|---|---|---|---|

## Рекомендация сейчас
- Что делать первым
- Почему именно этот путь лучший сейчас
- Что сознательно НЕ делать

## Блокеры и риски
- 4-8 пунктов

## Следующие 24 / 72 часа
- Список конкретных шагов

## Что ещё надо проверить
- Список пробелов и проверок

## Комментарии к терминам
- 3-8 коротких пояснений по терминам / англицизмам / исходным названиям

Требования:
- Сначала вывод, потом детали.
- Учитывай не только смысл, но и execution reality.
- Если материал шумный, отделяй signal от speculation.
- Не пиши generic management prose.
- Если выбор зависит от предположения, явно назови это предположение.

URL: {url}
TITLE: {title}

SUMMARY:
{summary}

PAGE SNIPPET:
{content}

USER CONTEXT:
{browserContext}`,

    matrix: `${PROMPT_OPERATING_SYSTEM}

Собери предметную матрицу решений по материалу. Пиши на русском. Английские термины, jargon и исходные названия выноси в отдельные короткие комментарии в конце, а не размазывай по всей матрице.

Формат ответа:
## TL;DR
- 2-4 жёстких вывода: что брать сейчас, что отложить, где главный риск

## Как читать матрицу
- 2-3 строки: по каким критериям сравниваются варианты и что здесь считается выигрышем

## Матрица вариантов
Сделай markdown-таблицу:
| Вариант | Что даёт на практике | Выигрыш сейчас | Цена / риск | Что нужно для запуска | Когда брать |
|---|---|---|---|---|---|

## Рекомендуемый выбор сейчас
- 3-5 строк: что брать первым и почему

## Запасной вариант
- 2-4 строки: когда он становится лучше основного

## Сигналы к смене решения
- 3-6 конкретных триггеров / условий

## Следующие шаги
- 4-8 конкретных действий

## Комментарии к терминам
- 3-8 коротких пояснений по jargon / англицизмам / исходным названиям

Требования:
- В каждой строке таблицы должен быть реальный trade-off, а не дежурная похвала.
- Если вариантов мало, лучше 3 сильные строки, чем 7 пустых.
- Отделяй подтверждённое от предположений.
- Не пиши общие формулировки вроде "нужен balanced approach" без расшифровки.

URL: {url}
TITLE: {title}

SUMMARY:
{summary}

PAGE SNIPPET:
{content}

USER CONTEXT:
{browserContext}`,

    sources: `${PROMPT_OPERATING_SYSTEM}

Построй карту источников и доказательств. Пиши по-русски. Смысл слева, термины и англицизмы — короткими комментариями в конце.

Формат ответа:
## TL;DR
- что подтверждено, что пока слабо

## Карта источников
Сделай markdown-таблицу:
| Источник / ссылка | Тип | Что реально подтверждает | Слабое место | Что проверить следующим ходом |
|---|---|---|---|---|

## Пробелы в доказательствах
- 4-8 пунктов

## Следующие проверки
- 4-8 конкретных шагов проверки

## Комментарии к терминам
- 3-8 коротких пояснений по jargon / англицизмам / названиям

Требования:
- Не смешивай факт, интерпретацию и пересказ.
- Если источник вторичный или слабый, так и помечай.
- Покажи, где именно цепочка доказательств рвётся.

URL: {url}
TITLE: {title}

SUMMARY:
{summary}

PAGE SNIPPET:
{content}

USER CONTEXT:
{browserContext}`,

    opsplan: `${PROMPT_OPERATING_SYSTEM}

Сделай операционный план выполнения по материалу. Пиши по-русски и без менеджерской воды.

Формат ответа:
## TL;DR
- суть плана в 2-4 строках

## План работ
Сделай markdown-таблицу:
| Шаг | Что делаем | Зачем именно это | Зависимости | Готово, когда |
|---|---|---|---|---|

## Узкие места
- 3-6 пунктов

## Что можно сделать сегодня
- 4-8 конкретных быстрых шагов

## Контрольные точки
- 3-6 checkpoints: что должно стать видно, чтобы считать движение реальным

## Комментарии к терминам
- 3-8 коротких пояснений по jargon / англицизмам / исходным названиям

Требования:
- План должен быть исполнимым, а не описательным.
- В шагах должны быть реальные зависимости и критерий завершения.
- Если часть плана строится на предположении, явно назови его.

URL: {url}
TITLE: {title}

SUMMARY:
{summary}

PAGE SNIPPET:
{content}

USER CONTEXT:
{browserContext}`,

    faq: `${PROMPT_OPERATING_SYSTEM}

Собери FAQ по материалу.

Формат ответа:
## TL;DR
- 2-4 вывода

## FAQ
Сделай 8-12 пар в формате:
**Вопрос:** ...
**Ответ:** ...
**Что ещё проверить:** ...

Правила:
- вопросы должны быть острыми и реальными, а не декоративными;
- ответы короткие, конкретные, без воды.

URL: {url}
TITLE: {title}

SUMMARY:
{summary}

PAGE SNIPPET:
{content}

USER CONTEXT:
{browserContext}`,

    compare: `${PROMPT_OPERATING_SYSTEM}

Сравни основные варианты / подходы, которые следуют из материала.

Формат ответа:
## TL;DR
- 2-4 вывода

## Сравнение
Сделай markdown-таблицу:
| Подход | Плюсы | Минусы | Риск | Сложность | Лучший сценарий |
|---|---|---|---|---|---|

## Практический выбор
- что выбрать сейчас
- когда этот выбор перестанет быть лучшим

URL: {url}
TITLE: {title}

SUMMARY:
{summary}

PAGE SNIPPET:
{content}

USER CONTEXT:
{browserContext}`,

    localization: `${PROMPT_OPERATING_SYSTEM}

Переведи контент страницы на русский язык как technical editor.

Требования:
- Сохрани оригинальную структуру (заголовки, списки, таблицы)
- Переведи ВСЕ текстовые элементы включая alt text, title, placeholder
- Сохрани технические термины на EN если нет устоявшегося перевода
- Добавь [[term:термин(EN)]] для непереведённых терминов
- Если есть код — оставь как есть
- Если есть двусмысленность перевода, помечай её короткой заметкой

Вывод: полностью переведённая страница в Markdown.

URL: {url}
TITLE: {title}

CONTENT:
{content}`,

    frontendBuilder: `${PROMPT_OPERATING_SYSTEM}

Спроектируй frontend на основе контента страницы как staff frontend engineer.

Варианты:
1) Landing page
2) Documentation site
3) Blog post
4) Dashboard
5) Web application

Для выбранного варианта:
- Технологии: React + Tailwind CSS (по умолчанию)
- Структура файлов
- Основные компоненты
- Стили
- Интерактивность
- Состояния loading/empty/error
- Accessibility и responsive behavior
- Что можно отложить во v2

Дай готовый код или структуру для копирования.
URL: {url}
TITLE: {title}

SUMMARY:
{summary}

CONTENT:
{content}`,

    renderHost: `${PROMPT_OPERATING_SYSTEM}

Подготовь продуманную инструкцию для деплоя на Render.com.

Включи:
1) Какой тип сервиса нужен (Web Service, Background Job, etc.)
2) Environment variables
3) Build command
4) Start command
5) План (free tier совместимость)
6) Домен и SSL
7) Логи и мониторинг
8) Cost estimation

Также:
- Discord webhook для деплоя
- GitHub Actions workflow если нужен
- Альтернативы если Render не подходит
- Риски миграции и rollback plan
- Чеклист go-live

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
  if (maxParEl) maxParEl.value = String(settings.maxParallelRequests ?? DEFAULT_MAX_PARALLEL_REQUESTS);

  const maxOutEl = document.getElementById('targetMaxOutputTokens');
  if (maxOutEl) maxOutEl.value = String(settings.targetMaxOutputTokens ?? DEFAULT_TARGET_MAX_OUTPUT_TOKENS);

  const prefetchEl = document.getElementById('prefetchOnHover');
  if (prefetchEl) prefetchEl.checked = settings.prefetchOnHover !== false;

  const prefetchDelayEl = document.getElementById('prefetchDelayMs');
  if (prefetchDelayEl) prefetchDelayEl.value = String(settings.prefetchDelayMs ?? DEFAULT_PREFETCH_DELAY_MS);

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
  document.getElementById('actionPrompt_timeline').value = actionPrompts.timeline || DEFAULT_ACTION_PROMPTS.timeline;
  document.getElementById('actionPrompt_extract').value = actionPrompts.extract || DEFAULT_ACTION_PROMPTS.extract;
  document.getElementById('actionPrompt_briefing').value = actionPrompts.briefing || DEFAULT_ACTION_PROMPTS.briefing;
  document.getElementById('actionPrompt_matrix').value = actionPrompts.matrix || DEFAULT_ACTION_PROMPTS.matrix;
  document.getElementById('actionPrompt_sources').value = actionPrompts.sources || DEFAULT_ACTION_PROMPTS.sources;
  document.getElementById('actionPrompt_opsplan').value = actionPrompts.opsplan || DEFAULT_ACTION_PROMPTS.opsplan;
  document.getElementById('actionPrompt_faq').value = actionPrompts.faq || DEFAULT_ACTION_PROMPTS.faq;
  document.getElementById('actionPrompt_compare').value = actionPrompts.compare || DEFAULT_ACTION_PROMPTS.compare;
  document.getElementById('actionPrompt_localization').value = actionPrompts.localization || DEFAULT_ACTION_PROMPTS.localization;
  document.getElementById('actionPrompt_frontendBuilder').value = actionPrompts.frontendBuilder || DEFAULT_ACTION_PROMPTS.frontendBuilder;
  document.getElementById('actionPrompt_renderHost').value = actionPrompts.renderHost || DEFAULT_ACTION_PROMPTS.renderHost;

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
      document.getElementById('actionPrompt_timeline').value = DEFAULT_ACTION_PROMPTS.timeline;
      document.getElementById('actionPrompt_extract').value = DEFAULT_ACTION_PROMPTS.extract;
      document.getElementById('actionPrompt_briefing').value = DEFAULT_ACTION_PROMPTS.briefing;
      document.getElementById('actionPrompt_matrix').value = DEFAULT_ACTION_PROMPTS.matrix;
      document.getElementById('actionPrompt_sources').value = DEFAULT_ACTION_PROMPTS.sources;
      document.getElementById('actionPrompt_opsplan').value = DEFAULT_ACTION_PROMPTS.opsplan;
      document.getElementById('actionPrompt_faq').value = DEFAULT_ACTION_PROMPTS.faq;
      document.getElementById('actionPrompt_compare').value = DEFAULT_ACTION_PROMPTS.compare;
      document.getElementById('actionPrompt_localization').value = DEFAULT_ACTION_PROMPTS.localization;
      document.getElementById('actionPrompt_frontendBuilder').value = DEFAULT_ACTION_PROMPTS.frontendBuilder;
      document.getElementById('actionPrompt_renderHost').value = DEFAULT_ACTION_PROMPTS.renderHost;
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
  const hasConfiguredKeys = joinKeyLines(settings.groqApiKeys).length > 0 || joinKeyLines(settings.cerebrasApiKeys).length > 0 || String(settings.groqApiKey || '').trim().length > 0;

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

    const groqApiKeys = dedupeStrings(parseKeyLines(document.getElementById('groqApiKeys')?.value));
    const cerebrasApiKeys = dedupeStrings(parseKeyLines(document.getElementById('cerebrasApiKeys')?.value));

    const maxParallelRequestsRaw = Number(document.getElementById('maxParallelRequests')?.value);
    const maxParallelRequests = Number.isFinite(maxParallelRequestsRaw) ? Math.max(1, Math.min(200, Math.round(maxParallelRequestsRaw))) : DEFAULT_MAX_PARALLEL_REQUESTS;

    const targetMaxOutputTokensRaw = Number(document.getElementById('targetMaxOutputTokens')?.value);
    const targetMaxOutputTokens = Number.isFinite(targetMaxOutputTokensRaw) ? Math.max(64, Math.min(DEFAULT_TARGET_MAX_OUTPUT_TOKENS, Math.round(targetMaxOutputTokensRaw))) : DEFAULT_TARGET_MAX_OUTPUT_TOKENS;

    const prefetchOnHover = document.getElementById('prefetchOnHover')?.checked !== false;
    const prefetchDelayMsRaw = Number(document.getElementById('prefetchDelayMs')?.value);
    const prefetchDelayMs = Number.isFinite(prefetchDelayMsRaw) ? Math.max(0, Math.min(2000, Math.round(prefetchDelayMsRaw))) : DEFAULT_PREFETCH_DELAY_MS;

    const mapReduceEnabled = document.getElementById('mapReduceEnabled')?.checked !== false;

    const nextActionPrompts = {
      twitter: document.getElementById('actionPrompt_twitter').value,
      deepdive: document.getElementById('actionPrompt_deepdive').value,
      automation: document.getElementById('actionPrompt_automation').value,
      learning: document.getElementById('actionPrompt_learning').value,
      share: document.getElementById('actionPrompt_share').value,
      challenge: document.getElementById('actionPrompt_challenge').value,
      timeline: document.getElementById('actionPrompt_timeline').value,
      extract: document.getElementById('actionPrompt_extract').value,
      briefing: document.getElementById('actionPrompt_briefing').value,
      matrix: document.getElementById('actionPrompt_matrix').value,
      sources: document.getElementById('actionPrompt_sources').value,
      opsplan: document.getElementById('actionPrompt_opsplan').value,
      faq: document.getElementById('actionPrompt_faq').value,
      compare: document.getElementById('actionPrompt_compare').value,
      localization: document.getElementById('actionPrompt_localization').value,
      frontendBuilder: document.getElementById('actionPrompt_frontendBuilder').value,
      renderHost: document.getElementById('actionPrompt_renderHost').value
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
