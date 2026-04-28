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
let noteZCounter = 2147483640;

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
const CACHE_PREFIX = 'pzdrk_cache_v4_';
const CACHE_EXPIRY = 7 * 24 * 60 * 60 * 1000;
const DEFAULT_TARGET_MAX_OUTPUT_TOKENS = 8192;
const DEFAULT_MAX_PARALLEL_REQUESTS = 64;
const MAP_REDUCE_THRESHOLD_TOKENS = 4200;
const DIRECT_SUMMARY_INPUT_CHARS = 6000;
const SECTION_ENRICH_INPUT_CHARS = 4800;
const COMMAND_CONTEXT_INPUT_CHARS = 4800;

function clipPromptInput(text, maxChars) {
  const limit = Math.max(0, Math.round(Number(maxChars) || 0));
  return String(text || '').substring(0, limit);
}

function getTaskMaxTokens(settings, desired, floor = 128) {
  const rawTarget = Number(settings?.targetMaxOutputTokens);
  const ceiling = Number.isFinite(rawTarget)
    ? Math.max(floor, Math.min(DEFAULT_TARGET_MAX_OUTPUT_TOKENS, Math.round(rawTarget)))
    : DEFAULT_TARGET_MAX_OUTPUT_TOKENS;
  return Math.max(floor, Math.min(Math.round(Number(desired) || floor), ceiling));
}

function getAdaptiveParallelLimit(settings, desired = DEFAULT_MAX_PARALLEL_REQUESTS, cap = DEFAULT_MAX_PARALLEL_REQUESTS, floor = 1) {
  const configured = Number(settings?.maxParallelRequests);
  const baseline = Number.isFinite(configured)
    ? Math.max(floor, Math.round(configured))
    : Math.max(floor, Math.round(Number(desired) || DEFAULT_MAX_PARALLEL_REQUESTS));
  const hardCap = Math.max(floor, Math.round(Number(cap) || DEFAULT_MAX_PARALLEL_REQUESTS));
  return Math.max(floor, Math.min(baseline, hardCap));
}

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
  try { localStorage.setItem(getCacheKey(url), JSON.stringify({ format, summary, timestamp: Date.now(), url })); } catch (e) { }
}

// ============ MONDAY-STYLE PERSONA (applies to ALL outputs) ============

const MONDAY_PERSONA = `Ты — sharp operator-assistant в духе Monday: умный, сухой, доказательный.
Тон: спокойный, профессиональный, плотный.
Сарказм: максимум 0-1 короткая реплика, только если она повышает ясность.
Запрещено: театральность, истерика, самодовольство, маркетинговый пафос.
Доказательно: отделяй факт от inference, отмечай уверенность и пробелы.
Язык: простой сильный русский без канцелярита.`;

const PRO_REASONING_RULES = `ОПЕРАЦИОННЫЕ ПРАВИЛА:
- Сначала восстанавливай цель пользователя и практический смысл страницы.
- Разделяй: факт / интерпретация / гипотеза / следующее действие.
- Избегай generic-советов; предпочитай конкретику, trade-offs, риски, ограничения.
- Не дублируй одно и то же разными словами; каждый блок должен добавлять новую ценность.
- Если входных данных не хватает, явно укажи пробел и предложи способ проверки.
- Если есть числа, компании, продукты, роли, процессы, архитектурные выборы — вытаскивай их явно.
- Думай как senior analyst / architect / operator, а не как маркетинговый копирайтер.`;

const OUTPUT_EXPANSION_RULES = `ТРЕБОВАНИЯ К ГЛУБИНЕ:
- Лучше layered output, чем короткий пересказ: signal -> mechanics -> risks -> action.
- В каждом крупном ответе ищи second-order effects, failure modes, dependencies и decision criteria.
- Если материал можно применить, обязательно переходи от смысла к implementation path.
- Не заканчивай на "это интересно"; доводи до "что делать с этим прямо сейчас".
- Если тема неоднозначна, показывай competing interpretations и что различает их на практике.`;

const PROMPT_QUALITY_GATES = `КРИТЕРИИ КАЧЕСТВА:
- Каждый ответ должен иметь понятный артефакт: таблица, план, чеклист, матрица, бриф, сценарий, список проверок или готовый текст.
- Для действий указывай owner/следующий шаг/критерий готовности, если это применимо по контексту.
- Отмечай confidence и источник уверенности: прямой факт, inference, гипотеза или внешний пробел.
- Не смешивай summary и recommendation: сначала сигнал, затем вариант решения, затем риск и проверка.`;

const STYLE_RULES = `${MONDAY_PERSONA}

ФОРМАТ:
- Структурно, без воды (лучше глубже и полезнее, чем короче и пустее)
- Оборачивай сущности и термины: [[entity:Название]], [[term:термин]], [[wiki:статья]], [[evidence:факт]], [[action:шаг]]
- Практика и проверяемые утверждения важнее красивостей
- Если чего-то не знаешь — так и скажи, предложи как проверить

${PRO_REASONING_RULES}

${OUTPUT_EXPANSION_RULES}

${PROMPT_QUALITY_GATES}`;

// ============ PROMPTS ============

const PROMPTS = {
  summary: `${STYLE_RULES}

Сделай подробный operator-grade разбор страницы. Нужен не пересказ, а рабочая карта смысла, риска и применения.

КОНТЕКСТ ПОЛЬЗОВАТЕЛЯ:
{browserContext}

ОБЯЗАТЕЛЬНО:
- Используй вкладки + историю + pathway, чтобы понять текущую задачу пользователя и зачем ему это сейчас.
- Не выдумывай факты. Если не уверен — явно помечай как гипотезу / что проверить.
- Важнее: что это меняет, где сильные сигналы, где слабые места, что делать дальше.
- Ответ должен помогать принять решение или продолжить работу.

Требования к объёму:
- 900–1800 слов (если контент большой — ближе к верхней границе)
- Тезисы и действия — конкретные и проверяемые.
- ЛЕВАЯ колонка должна быть написана простым, предметным русским языком.
- Английские термины, оригинальные названия и англицизмы по возможности не тащи в основную левую подачу; выноси их в правые комментарии/термины.

СТРУКТУРА (ровно эти заголовки, в этом порядке):
## ✳️ TL;DR
(2–4 очень коротких пункта: в чём предмет, что главное, зачем это важно прямо сейчас)
## 📌 СУТЬ
(3–6 предложений)
## 🧭 КАРТА
(6–14 пунктов: что тут есть)
## ⚙️ МЕХАНИЗМЫ
(3–6 коротких абзацев: механика, причинно-следственные связи, ограничения, зависимые решения, почему это вообще важно)
## 🧩 ЗАЧЕМ ЭТО ВАЖНО
(4–8 пунктов: последствия, смысл, управленческая/практическая ценность, что это меняет)
## ⚠️ РИСКИ / НЕЯСНОСТИ
(3–8 буллетов: ambiguity, missing context, execution risk, incentives, blind spots)
## 🛠 ПРИМЕНЕНИЕ
(Для чего это нужно, как использовать, как внедрить, реальные сценарии и примеры интеграции; избегай банальных идей)
## 🤖 АВТОМАТИЗАЦИИ
(4–8 конкретных способов автоматизировать работу с этим материалом, процессом или артефактом)
## ❓ ОТКРЫТЫЕ ВОПРОСЫ
(3–8 вопросов, которые ещё нельзя честно закрыть без доп. проверки)
## 🧪 ЧТО ПРОВЕРИТЬ ДАЛЬШЕ
(3–7 пунктов: какие факты, метрики, документы, конкуренты или эксперименты сейчас критичны)
## 💡 ВЫЯСНИЛОСЬ
(4–10 буллетов формата "Выяснилось: ...")
## ⚡ ДЕЙСТВИЯ
(5–10 действий в виде [[action:...]] + 1 строка пояснения под каждым; балансируй quick wins и более сильные следующие шаги)

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
      "key": "tldr",
      "emoji": "✳️",
      "label": "TL;DR",
      "left": ["..."],
      "right": {
        "commentary": ["..."],
        "terms": [{"term": "...", "definition": "...", "category": "Понятия / Методы / Оригинальные названия"}],
        "entities": [{"name": "...", "context": "...", "exaQuery": "...", "category": "Люди / Организации / Проекты / Источники"}],
        "refs": [{"query": "...", "why": "..."}]
      }
    },
    {
      "key": "core",
      "emoji": "📌",
      "label": "СУТЬ",
      "left": ["..."],
      "right": {
        "commentary": ["..."],
        "terms": [],
        "entities": [],
        "refs": []
      }
    }
  ],
  "til": ["Выяснилось: ..."],
  "actions": ["[[action:...]] — ..."],
  "concrete_prompts": [
    { "title": "Короткое имя следующего запроса", "desc": "Зачем этот запрос нужен", "prompt": "Полный конкретный запрос, готовый к копированию и запуску" }
  ]
}

ПРАВИЛА:
- sections: 9–14 (каждая с emoji + label).
- Первые две секции ОБЯЗАНЫ идти так: TL;DR, затем СУТЬ.
- Секции обязаны покрывать: TL;DR, СУТЬ, КАРТА, МЕХАНИЗМЫ, ЗАЧЕМ ЭТО ВАЖНО, ПРИМЕНЕНИЕ, АВТОМАТИЗАЦИИ, ОТКРЫТЫЕ ВОПРОСЫ, ЧТО ПРОВЕРИТЬ ДАЛЬШЕ. Дополнительно можно дать ДЕТАЛИ, СИГНАЛЫ, КОНТЕКСТ, если это реально нужно.
- left: 4–9 пунктов на секцию (строки без "- "). Делай плотные, проверяемые формулировки с отдельной ценностью в каждом пункте.
- left: это основная левая колонка. Пиши по-русски, просто, предметно и без канцелярита. Английские слова не используй, если без них можно обойтись.
- Английские термины, оригинальные названия, продуктовые ярлыки, исходные формулировки и jargon выноси в right.terms и right.commentary, а слева давай понятную русскую формулировку смысла.
- right.commentary: 2–4 коротких абзаца с богатым форматированием: *курсив* для нюансов, **жирное** для решающих сигналов, [[term:...]] и [[entity:...]] для важных опор. Это не повтор left, а углубление: причинно-следственные связи, оговорки, эффекты второго порядка, рамка для решения.
- right.terms: 4–10. Именно сюда уводи англоязычные термины, оригинальные названия, сокращения и спорные формулировки. У каждого термина добавляй category и русскую definition, полезную именно для текущего материала.
- right.entities: 4–8. У каждой сущности добавляй category: Люди, Организации, Проекты, Источники, Методы, Инструменты или Данные. exaQuery должен быть осмысленным поисковым запросом без правки.
- right.refs: 2–5 проверок на секцию. Формулируй так, чтобы интерфейс мог отрисовать нумерованный список "Что проверить": факт/метрика/источник + зачем это проверять.
  - В текстовых полях (left/commentary/definition/context/actions) помечай важное через [[entity:...]], [[term:...]], [[evidence:...]], [[action:...]].
  - concrete_prompts: 6–8. Каждый запрос должен быть самодостаточным, конкретным и готовым к немедленному запуску без переписывания.
  - АВТОМАТИЗАЦИИ должны быть практичными: шаблоны автоматизации, проверки, пайплайны, извлечение данных, контрольные вопросы, повторяемые рутины.
  - Не выдумывай факты. Если не уверен — отметь и предложи как проверить.
- Не делай все секции одинаковыми: каждая должна отвечать на отдельный вопрос пользователя.
- Язык: русский. Тон: Monday (профессионально, доказательно). Сарказм ≤ 1 фраза.

ТЕГИ: {tags}`,

  sectionEnrich: `${STYLE_RULES}

Ты получаешь ОДНУ секцию + контекст страницы. Верни ТОЛЬКО валидный JSON объект (без Markdown code blocks):
{
  "key": "same_key",
  "right": {
    "commentary": ["..."],
    "terms": [{"term": "...", "definition": "...", "category": "..."}],
    "entities": [{"name": "...", "context": "...", "exaQuery": "...", "category": "..."}],
    "refs": [{"query": "...", "why": "..."}]
  }
}

ПРАВИЛА:
- right.commentary: 3–6 коротких абзацев (часть можно *курсивом*). Нужны причинно-следственные связи, сильные/слабые сигналы, практические нюансы и последствия для решения.
- terms/entities: по 4–10, обязательно группируй через поле category.
- refs: 2–5 конкретных проверок; они будут показаны нумерованным списком, поэтому каждая строка должна быть самостоятельным проверочным шагом.
- В commentary/terms специально выноси оригинальные англоязычные термины, названия и jargon, чтобы левая колонка оставалась на нормальном русском языке.
- В commentaries/definitions/contexts активно используй [[entity:...]] / [[term:...]] / [[evidence:...]].
- Не повторяй left буллеты; дополняй, углубляй, добавляй связи/риски/проверки.
- refs должны вести к следующему полезному поиску, а не быть шумом.
- Тон: Monday, без воды.
`,

  generateTitle: `Дай CATCHY заголовок на русском. 2-5 слов. Только заголовок.
Он должен передавать angle материала, а не быть generic-кликбейтом.
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

ПРАВИЛА:
- depth оценивай по интеллектуальной плотности, а не по длине.
- tags должны быть полезны для последующего поиска/группировки.
- explanations пиши конкретно, с опорой на контент.

Контент: {content}`,

  voiceScript: `${MONDAY_PERSONA}

Подготовь текст для ОЗВУЧКИ в формате "guide through content" (120–220 слов).

Требования:
- Никакого театра, вздохов и лишних эмоций.
- Сарказм — сухой и точечный (0–1 фраза).
- Обязательно: (1) главное, (2) зачем это, (3) bullshit или нет + почему, (4) что делать дальше (3 шага), (5) куда углубляться.
- Если не уверен — прямо укажи, что проверить.
- Должно звучать естественно при чтении вслух: короткие фразы, хорошая ритмика, без перегруза.
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

Собери подробную исследовательскую mindmap как НЕ просто outline, а как кластерную knowledge map с группировками, подветками, сигналами и вопросами. Верни ТОЛЬКО JSON:
{
  "title": "Заголовок",
  "nodes": [
    {
      "id": "1",
      "label": "Кластер 1",
      "kind": "cluster",
      "group": "Стратегический слой",
      "description": "Что именно объединяет этот кластер и зачем он важен",
      "insights": ["Ключевая линия"],
      "evidence": ["Факт / пример / сигнал"],
      "questions": ["Что ещё нужно проверить"],
      "children": []
    }
  ],
  "metadata": {
    "domain": "Security",
    "complexity": "high",
    "coverage": "broad",
    "mapStyle": "clustered",
    "nodeCount": 0
  }
}

Требования:
- Это должна быть именно карта исследования: кластеры -> подветки -> конкретные узлы, а не линейное оглавление.
- Все label, group, title и description пиши по-русски. Оригинальные англоязычные термины, product names и jargon уноси в description коротким хвостом в скобках или через [[term:...]].
- 7-10 главных веток уровня 1, и каждая должна быть самостоятельным кластером со своим фокусом.
- У каждой главной ветки 4-6 содержательных детей, причём дети должны смешивать несколько типов узлов.
- Для 5-7 самых важных детей добавь grandchildren уже в initial response; у части веток нужны уже 3 уровня глубины.
- Целевой размер initial response: 40-64 узла суммарно.
- Используй [[entity:]], [[term:]] в description.
- Ветки не должны быть одного типа: смешивай concepts / systems / actors / workflows / risks / tools / evidence / questions / integrations.
- У каждого узла должен быть kind из набора: cluster, mechanism, actor, tool, artifact, evidence, risk, question, workflow, integration.
- group нужен для смысловой группировки. Для top-level cluster он обязателен; для детей тоже старайся задавать осмысленно, чтобы внутри кластера возникали lane-группы.
- label короткий и ясный; description компактный, 1 короткое предложение; insights/evidence/questions по 0-3 и без воды.
- Не делай карту линейной. Внутри кластеров обязательно должны быть разные подтипы узлов: что это, как работает, где применяется, какие риски, что проверить, какие сигналы уже есть.
- Минимум у половины top-level clusters должны быть видимые внутренние подгруппы по смыслу: например "механика", "инструменты", "риски", "сигналы", "следующие проверки".
- Явно подсвечивай связи между ветками: зависимости, конфликты, handoff-узлы, общие артефакты и decision points указывай в description / insights, чтобы карта читалась как сеть, а не как независимые списки.
- Когда есть явная межветочная связь, помечай её маркером [[edge:Название другой ветки]] внутри description или insights.
- Лучше плотная и глубокая карта с короткими формулировками, чем длинные prose-описания.
- Избегай декоративных generic labels вроде "Overview", "Misc", "Other".
- metadata.nodeCount = примерное число узлов в текущем JSON.
- metadata.coverage = narrow | medium | broad.
- metadata.mapStyle = clustered-lanes.
- Без Markdown fences, без пояснений, только JSON.

КОНТЕНТ: {content}
SUMMARY: {summary}`,

  mindmapExpand: `${STYLE_RULES}

Ты — архитектор знаний. РАСШИРЬ ветку mindmap так, чтобы она стала глубже и полезнее как исследовательская карта, а не как outline.
Ветка: "{label}" (Описание: {description})

Уже существующие дети:
{existingChildren}

Твоя задача: сгенерировать ТОЛЬКО JSON массив новых children для этой ветки.
Требования:
- 3-5 новых узлов.
- Все label, group и description пиши по-русски; исходные англоязычные термины выноси короткими комментариями в description.
- Для 2-3 самых важных узлов добавь 2-4 grandchildren, если это делает ветку глубже по существу.
- Каждый узел должен содержать поля: id, label, kind, group, description, insights, evidence, questions, children.
- Добавь конкретные инструменты, библиотеки, людей, статьи ([[entity:...]]).
- Добавь неочевидные связи, зависимости, ограничения, точки принятия решений и "подводные камни".
- Если новый узел зависит от другой ветки карты, добавь маркер [[edge:Название другой ветки]] в description или insights.
- Следи за внутренним разнообразием: если у ветки уже есть только инструменты, не добавляй ещё пять инструментов подряд.
- Новые узлы должны расширять карту по группам: старайся формировать 2-4 осмысленные mini-группы внутри ветки, а не просто россыпь однотипных карточек.
- Хотя бы у 2 узлов должны появиться evidence или questions, чтобы ветка давала траекторию проверки, а не только описание.
- Не дублируй существующие children по смыслу.
- Не плодить искусственные узлы ради количества: каждый узел должен давать новую исследовательскую траекторию.
- Формулировки держи короткими и плотными, чтобы ответ был компактным и быстрым.
- Формат: Array of objects (id, label, kind, group, description, insights, evidence, questions, children).
- Без Markdown fences, без комментариев.

КОНТЕКСТ СТРАНИЦЫ:
{content}

КРАТКАЯ СВОДКА:
{summary}`,

  challenge: `${STYLE_RULES}

Сделай critic / red-team разбор.

Нужно: 7-10 ПРОВОКАЦИОННЫХ вопросов с гипотезами и литературой.
Фокус: assumptions, incentives, market reality, execution failure modes, hidden dependencies, what the author may be missing.

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
Превратить в X/Twitter тред (5-7 твитов по 280 символов). Хук первым. CTA последним.
- Нужен angle, а не пересказ.
- Расставляй evidence и tension.
КОНТЕНТ: {content}`,

  deepdive: `${STYLE_RULES}
Глубокий анализ. Неочевидные связи. [[entity:]], [[term:]], [[action:]].
- Покажи где суть, где скрытая механика, где риск ошибиться.
КОНТЕНТ: {content}
КОНТЕКСТ: {context}`,

  automation: `${STYLE_RULES}
Как автоматизировать. API, n8n, Zapier. Конкретные шаги.
- Дай quick win / robust version / scale version.
КОНТЕНТ: {content}`,

  learning: `${STYLE_RULES}
План изучения на 2 недели. Ресурсы, упражнения, проекты.
- Нужны deliverables и критерии понимания.
КОНТЕНТ: {content}`,

  share: `${STYLE_RULES}
Подготовь для шаринга:
1. Slack (3 предложения)
2. Email subject + 2 абзаца
3. LinkedIn пост
4. Telegram пост
- Для каждого канала адаптируй tone and depth.
КОНТЕНТ: {content}`,

  followUp: `${STYLE_RULES}
Контекст: {history}
Вопрос: {question}
Ответь кратко и профессионально.
- Сначала ответ, потом 1-3 supporting points.
- Если вопрос упирается в пробел в контексте, скажи это прямо и предложи next best question.
Сарказм — максимум 1 короткая фраза.`,

  actionToPrompt: `${STYLE_RULES}

Ты — prompt-инженер. Сгенерируй ОДИН готовый промпт для LLM, чтобы выполнить указанное действие.

Требования:
- Промпт должен быть самодостаточным: цель, входные данные, ограничения, шаги, формат ответа, критерии качества.
- Учитывай текущую страницу + браузерный контекст пользователя.
- Учитывай МЕСТО, где это действие появилось (секция и строка-источник) — это и есть "целеполагание".
- Не выдумывай факты. Если данных не хватает — добавь в промпт 2–4 уточняющих вопроса.
- Промпт должен вести модель к сильному ответу: analysis path, quality bar, anti-slop guardrails, output contract.
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
- prompt должен быть реально полезной командой для работы, а не декоративным "рассказать про тему".
- Если команда зависит от выделения — scope=selection и используй {selection}.

ЗАПРОС ПОЛЬЗОВАТЕЛЯ (описание команды):
{request}`,

  workflowSuggestions: `${STYLE_RULES}

Сгенерируй 10 лучших следующих сценариев работы на основе контента.
Верни JSON:
[
  { "title": "Название", "desc": "Однострочное описание", "prompt": "Полный промпт для выполнения..." },
  ...
]

Требования:
- Дай смесь ролей: исследование, стратегия, продукт, инженерия, критика, операции.
- Каждый сценарий должен вести к конкретному артефакту или решению, а не к абстрактному "подумать".
- Промпты должны быть готовы к немедленному запуску без переписывания.
- Нужна последовательность: быстрое уточнение -> глубокий разбор -> внедрение -> проверка -> распространение результата.
- Избегай дубликатов по смыслу.
- Если контент неоднозначен, часть сценариев должна быть про проверку и поиск противоречий.
- Язык title/desc/prompt: русский. Английские термины допускаются только внутри prompt там, где без оригинального названия теряется смысл.

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
    'mapReduceEnabled',
    'showLeftNavButtons', 'showRightActionButtons',
    'artifactAutoSave',
    'promptOverrides'
  ]);
  const localSettings = await chrome.storage.local.get([
    'telegramEnabled',
    'telegramSendHtml',
    'telegramSendMarkdown'
  ]).catch(() => ({}));

  const maxParallelRaw = Number(settings.maxParallelRequests);
  const maxParallelRequests = Number.isFinite(maxParallelRaw) ? Math.max(1, Math.min(200, Math.round(maxParallelRaw))) : DEFAULT_MAX_PARALLEL_REQUESTS;
  const targetOutRaw = Number(settings.targetMaxOutputTokens);
  const targetMaxOutputTokens = Number.isFinite(targetOutRaw) ? Math.max(64, Math.min(DEFAULT_TARGET_MAX_OUTPUT_TOKENS, Math.round(targetOutRaw))) : DEFAULT_TARGET_MAX_OUTPUT_TOKENS;
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
    mapReduceEnabled: settings.mapReduceEnabled !== false,
    showLeftNavButtons: settings.showLeftNavButtons === true,
    showRightActionButtons: settings.showRightActionButtons === true,
    artifactAutoSave: settings.artifactAutoSave === true,
    promptOverrides: (settings.promptOverrides && typeof settings.promptOverrides === 'object') ? settings.promptOverrides : {},
    telegramEnabled: localSettings.telegramEnabled === true,
    telegramSendHtml: localSettings.telegramSendHtml !== false,
    telegramSendMarkdown: localSettings.telegramSendMarkdown === true
  };
}

function areLeftNavButtonsEnabled(settings = runtimeSettings) {
  return settings?.showLeftNavButtons === true;
}

function areRightActionButtonsEnabled(settings = runtimeSettings) {
  return settings?.showRightActionButtons === true;
}

function getPromptOverride(key, settings = runtimeSettings) {
  const override = String(settings?.promptOverrides?.[key] || '').trim();
  return override || PROMPTS[key] || '';
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
    chrome.runtime.sendMessage({ action: 'getBrowserContext', hours: 1 }, (response) => {
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
  try { if (activeAudio) activeAudio.pause(); } catch (e) { }
  activeAudio = null;
  if (activeAudioUrl) {
    try { URL.revokeObjectURL(activeAudioUrl); } catch (e) { }
    activeAudioUrl = null;
  }
  try { if ('speechSynthesis' in window) window.speechSynthesis.cancel(); } catch (e) { }
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
      try { URL.revokeObjectURL(url); } catch (e) { }
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
      try { s.stop(0); } catch (e) { }
    });
  } catch (e) { }
  xaiRealtimePlaybackSources = [];
  xaiRealtimePlaybackNextTime = 0;
  if (xaiRealtimePlaybackCtx) {
    try { xaiRealtimePlaybackCtx.close(); } catch (e) { }
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
    xaiRealtimePlaybackCtx.resume().catch(() => { });
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
      try { ws.close(); } catch (e) { }
      reject(new Error('Realtime WS timeout'));
    }, timeoutMs);

    ws.onopen = () => {
      clearTimeout(timer);
      resolve(ws);
    };

    ws.onerror = () => {
      clearTimeout(timer);
      try { ws.close(); } catch (e) { }
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
      await xaiRealtimeMicCtx.resume().catch(() => { });
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
    try { xaiRealtimeMicProcessor && (xaiRealtimeMicProcessor.onaudioprocess = null); } catch (e2) { }
    try { xaiRealtimeMicProcessor && xaiRealtimeMicProcessor.disconnect(); } catch (e2) { }
    try { xaiRealtimeMicSource && xaiRealtimeMicSource.disconnect(); } catch (e2) { }
    try { xaiRealtimeMicZeroGain && xaiRealtimeMicZeroGain.disconnect(); } catch (e2) { }
    try { xaiRealtimeMicStream && xaiRealtimeMicStream.getTracks().forEach(t => t.stop()); } catch (e2) { }
    xaiRealtimeMicStream = null;
    xaiRealtimeMicSource = null;
    xaiRealtimeMicProcessor = null;
    xaiRealtimeMicZeroGain = null;
    if (xaiRealtimeMicCtx) {
      try { xaiRealtimeMicCtx.close(); } catch (e2) { }
    }
    xaiRealtimeMicCtx = null;
    throw e;
  }
}

function stopXaiRealtimePushToTalk() {
  if (!xaiRealtimeIsRecording) return;
  xaiRealtimeIsRecording = false;
  setRecordingIndicator(false);

  try { xaiRealtimeMicProcessor && (xaiRealtimeMicProcessor.onaudioprocess = null); } catch (e) { }
  try { xaiRealtimeMicProcessor && xaiRealtimeMicProcessor.disconnect(); } catch (e) { }
  try { xaiRealtimeMicSource && xaiRealtimeMicSource.disconnect(); } catch (e) { }
  try { xaiRealtimeMicZeroGain && xaiRealtimeMicZeroGain.disconnect(); } catch (e) { }
  try { xaiRealtimeMicStream && xaiRealtimeMicStream.getTracks().forEach(t => t.stop()); } catch (e) { }
  xaiRealtimeMicStream = null;
  xaiRealtimeMicSource = null;
  xaiRealtimeMicProcessor = null;
  xaiRealtimeMicZeroGain = null;
  if (xaiRealtimeMicCtx) {
    try { xaiRealtimeMicCtx.close(); } catch (e) { }
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
    try { stream.getTracks().forEach(t => t.stop()); } catch (e2) { }
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
    try { stream.getTracks().forEach(t => t.stop()); } catch (e) { }

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

      const prompt = getPromptOverride('followUp')
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
  const windowLabel = ctx.windowLabel || (ctx.windowHours ? `${ctx.windowHours}h` : `${ctx.windowDays || '?'}d`);
  lines.push(`[BROWSER CONTEXT] window=${windowLabel} • generated=${fmt(ctx.generatedAt)}`);

  if (ctx.workflowGroups?.length) {
    lines.push(`\n[WORKFLOW GROUPS: open tabs + last-hour history]`);
    ctx.workflowGroups.slice(0, 8).forEach(g => {
      const marker = g.active ? 'ACTIVE ' : '';
      const signal = g.signal ? ` • signal=${g.signal}` : '';
      lines.push(`• ${marker}${g.domain} • pages=${g.count || 0}${signal}`);
      (g.pages || []).slice(0, 3).forEach(p => {
        lines.push(`  - ${(p.title || '').substring(0, 70)} — ${p.url}`);
      });
    });
  }

  if (ctx.openTabs?.length) {
    lines.push(`\n[OPEN TABS: ${ctx.openTabs.length}]`);
    ctx.openTabs.slice(0, 12).forEach(t => {
      const flags = `${t.active ? 'ACTIVE ' : ''}${t.pinned ? 'PIN ' : ''}`.trim();
      lines.push(`• ${flags ? `[${flags}] ` : ''}${(t.title || '').substring(0, 70)} — ${t.url}`);
    });
  }

  if (ctx.topDomains?.length) {
    lines.push(`\n[TOP DOMAINS (weighted by visits, ~${windowLabel})]`);
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

  const limit = getAdaptiveParallelLimit(settings, 64, 64);

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
  const maxChars = Number.isFinite(maxCharsRaw) ? Math.max(2000, Math.min(500_000, Math.round(maxCharsRaw))) : 24000;

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
  const re = /(^##\s*💡\s*(?:TIL|ВЫЯСНИЛОСЬ)[^\n]*\n)([\s\S]*?)(?=^##\s|\s*$)/im;
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

Сгенерируй секцию "## 💡 ВЫЯСНИЛОСЬ" заново.

Требования:
- Ровно 4–8 bullet points
- Каждый пункт строго с новой строки и начинается с "- "
- Формат пункта: "Выяснилось: ..."
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
- Формат пункта: "Выяснилось: ..."
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
    .map(x => {
      const clean = x
        .replace(/^today i learned\s*:\s*/i, '')
        .replace(/^выяснилось\s*:\s*/i, '')
        .trim();
      return clean ? `Выяснилось: ${clean}` : '';
    })
    .filter(Boolean)
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

function extractTextCandidate(value, depth = 0) {
  if (value == null) return '';
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }

  if (depth >= 2) return '';

  if (Array.isArray(value)) {
    return value
      .map(item => extractTextCandidate(item, depth + 1))
      .filter(Boolean)
      .join(' — ');
  }

  if (typeof value === 'object') {
    for (const key of ['label', 'title', 'text', 'name', 'summary', 'description', 'definition', 'prompt', 'action', 'task', 'content', 'value', 'question', 'why', 'note', 'context']) {
      const candidate = extractTextCandidate(value[key], depth + 1);
      if (candidate) return candidate;
    }

    const flat = Object.values(value)
      .map(item => extractTextCandidate(item, depth + 1))
      .filter(Boolean);
    if (flat.length) return flat.join(' — ');
  }

  return '';
}

function applyInlineRichMarkup(safe) {
  return String(safe || '')
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
    .replace(/`([^`]+)`/g, '<code>$1</code>');
}

function formatRichInline(text) {
  return applyInlineRichMarkup(escapeHtml(String(text || '')));
}

function isMarkdownTableLine(line) {
  const trimmed = String(line || '').trim();
  return trimmed.startsWith('|') && (trimmed.match(/\|/g) || []).length >= 2;
}

function isMarkdownTableSeparatorLine(line) {
  const trimmed = String(line || '').trim();
  if (!trimmed) return false;
  const cells = trimmed.replace(/^\|/, '').replace(/\|$/, '').split('|').map(cell => cell.trim());
  return cells.length > 1 && cells.every(cell => /^:?-{2,}:?$/.test(cell));
}

function parseMarkdownTableRow(line) {
  return String(line || '')
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map(cell => cell.trim());
}

function detectRichTableVariant(headerRow) {
  const joined = (Array.isArray(headerRow) ? headerRow : [])
    .map(cell => String(cell || '').toLowerCase().replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join(' | ');

  if (!joined) return 'generic';
  if (/вариант/.test(joined) && /(скорость|риск|зависим|что да[её]т|когда подходит|цена|запуск)/.test(joined)) return 'matrix';
  if (/(источник|ссылка)/.test(joined) && /(подтверждает|слабое место|что проверить)/.test(joined)) return 'sources';
  if (/этап/.test(joined) && /(кто вовлеч|последств|уверенность|зависим)/.test(joined)) return 'timeline';
  if (/шаг/.test(joined) && /(что делаем|зачем|зависим|готово, когда|результат)/.test(joined)) return 'opsplan';
  if (/(сущность|параметр|значение|контекст|роль)/.test(joined)) return 'extract';
  return 'generic';
}

function getRichTableVariantLabel(variant) {
  switch (String(variant || '').trim()) {
    case 'matrix': return 'Матрица вариантов';
    case 'sources': return 'Карта источников';
    case 'timeline': return 'Хронология и этапы';
    case 'opsplan': return 'Пошаговый план';
    case 'extract': return 'Сущности и параметры';
    default: return '';
  }
}

function renderRichTable(lines) {
  const rows = (Array.isArray(lines) ? lines : [])
    .map(parseMarkdownTableRow)
    .filter(row => row.some(Boolean));

  if (!rows.length) return '';

  const hasExplicitHeader = lines.length > 1 && isMarkdownTableSeparatorLine(lines[1]);
  const headerRow = rows[0] || [];
  const bodyRows = (hasExplicitHeader ? rows.slice(2) : rows.slice(1))
    .filter(row => row.some(Boolean));
  const colCount = Math.max(
    headerRow.length,
    ...bodyRows.map(row => row.length),
    1
  );
  const variant = detectRichTableVariant(headerRow);

  const normalizeRow = (row) => Array.from({ length: colCount }, (_, index) => row[index] || '');
  const renderHeaderCell = (cell, index) => `<th class="${index === 0 ? 'is-key-col' : ''}" data-col="${index + 1}">${formatRichInline(cell) || '&nbsp;'}</th>`;
  const renderBodyCell = (cell, index) => `<td class="${index === 0 ? 'is-key-col' : ''}" data-col="${index + 1}">${formatRichInline(cell) || '&nbsp;'}</td>`;

  const thead = `<thead><tr>${normalizeRow(headerRow).map(renderHeaderCell).join('')}</tr></thead>`;
  const tbodyRows = bodyRows.length ? bodyRows : [headerRow];
  const tbody = `<tbody>${tbodyRows.map(row => `<tr>${normalizeRow(row).map(renderBodyCell).join('')}</tr>`).join('')}</tbody>`;
  const kicker = getRichTableVariantLabel(variant);

  return `<div class="pzdrk-rich-table-wrap is-${variant}" data-table-variant="${escapeAttr(variant)}">${kicker ? `<div class="pzdrk-rich-table-kicker">${escapeHtml(kicker)}</div>` : ''}<table class="pzdrk-rich-table is-${variant}">${thead}${tbody}</table></div>`;
}

function isPseudoSectionTitleLine(line) {
  const trimmed = String(line || '').trim();
  if (!trimmed) return false;
  if (/^##+\s+/.test(trimmed)) return true;
  const body = trimmed.replace(/^\d+[\.)]?\s+/, '').trim();
  if (body.length < 8 || /[.!?]$/.test(body)) return false;
  const letters = body.match(/[A-Za-zА-Яа-яЁё]/g) || [];
  if (letters.length < 6) return false;
  const upper = body.match(/[A-ZА-ЯЁ]/g) || [];
  return (upper.length / letters.length) >= 0.72;
}

function buildRichSectionTitleHtml(line, headingCounts) {
  const raw = String(line || '').trim();
  const display = raw.replace(/^##+\s+/, '').trim();
  const plain = unescapeBasicHtml(display).trim();
  const slugBase = slugifyForId(plain.replace(/^\d+[\.)]?\s+/, ''));
  const n = (headingCounts.get(slugBase) || 0) + 1;
  headingCounts.set(slugBase, n);
  const id = `pzdrk-sec-${slugBase}${n > 1 ? `-${n}` : ''}`;
  return `<div class="pzdrk-section-title" id="${id}">${formatRichInline(display)}</div>`;
}

function formatRichText(text) {
  const source = String(text || '').replace(/\r\n?/g, '\n').trim();
  if (!source) return '';

  const lines = source.split('\n');
  const headingCounts = new Map();
  const html = [];
  let paragraphBuffer = [];
  let paragraphIndex = 0;
  let listKind = '';
  let listItems = [];

  const flushParagraph = () => {
    if (!paragraphBuffer.length) return;
    const rawLines = paragraphBuffer.map(line => String(line || '').trim()).filter(Boolean);
    paragraphBuffer = [];
    if (!rawLines.length) return;
    const flat = rawLines.join(' ').replace(/\s+/g, ' ').trim();
    const klass = (paragraphIndex === 0 || /^(?:цель|итог|bottom line|tl;dr)\b/i.test(flat))
      ? 'pzdrk-rich-lead'
      : 'pzdrk-rich-paragraph';
    html.push(`<div class="${klass}">${rawLines.map(line => formatRichInline(line)).join('<br>')}</div>`);
    paragraphIndex += 1;
  };

  const flushList = () => {
    if (!listItems.length) return;
    const tag = listKind === 'ol' ? 'ol' : 'ul';
    const klass = tag === 'ol' ? 'pzdrk-olist' : 'pzdrk-list';
    html.push(`<${tag} class="${klass}">${listItems.map(item => `<li>${formatRichInline(item)}</li>`).join('')}</${tag}>`);
    listKind = '';
    listItems = [];
  };

  for (let index = 0; index < lines.length; index += 1) {
    const rawLine = lines[index];
    const trimmed = String(rawLine || '').trim();

    if (!trimmed) {
      flushParagraph();
      flushList();
      continue;
    }

    if (isMarkdownTableLine(trimmed)) {
      flushParagraph();
      flushList();
      const tableLines = [trimmed];
      while (index + 1 < lines.length && isMarkdownTableLine(lines[index + 1])) {
        index += 1;
        tableLines.push(String(lines[index] || '').trim());
      }
      html.push(renderRichTable(tableLines));
      continue;
    }

    if (/^(?:-{3,}|—{3,}|\*{3,})$/.test(trimmed)) {
      flushParagraph();
      flushList();
      html.push('<div class="pzdrk-rich-rule"></div>');
      continue;
    }

    if (isPseudoSectionTitleLine(trimmed)) {
      flushParagraph();
      flushList();
      html.push(buildRichSectionTitleHtml(trimmed, headingCounts));
      continue;
    }

    if (/^[-•]\s+/.test(trimmed)) {
      flushParagraph();
      if (listKind && listKind !== 'ul') flushList();
      listKind = 'ul';
      listItems.push(trimmed.replace(/^[-•]\s+/, '').trim());
      continue;
    }

    if (/^\d+[\.)\]]\s+/.test(trimmed)) {
      flushParagraph();
      if (listKind && listKind !== 'ol') flushList();
      listKind = 'ol';
      listItems.push(trimmed.replace(/^\d+[\.)\]]\s+/, '').trim());
      continue;
    }

    if (listItems.length) {
      listItems[listItems.length - 1] = `${listItems[listItems.length - 1]} ${trimmed}`.replace(/\s+/g, ' ').trim();
      continue;
    }

    paragraphBuffer.push(trimmed);
  }

  flushParagraph();
  flushList();

  return html.join('<div class="pzdrk-par-spacer"></div>');
}

const NOTE_NAV_MAX_ITEMS = 6;

function getNoteNavHeadings(root) {
  if (!root) return [];
  const seen = new Set();
  return Array.from(root.querySelectorAll('.pzdrk-section-title')).filter((heading) => {
    if (!heading.id) return false;
    const label = String(heading.textContent || '').trim().toLowerCase();
    const key = `${heading.id}::${label}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function buildNoteNav(note) {
  if (!note || !note.isConnected) return;
  const nav = note.querySelector('.pzdrk-note-nav');
  const contentEl = note.querySelector('.pzdrk-note-content');
  if (!nav || !contentEl) return;
  const navEnabled = areLeftNavButtonsEnabled();
  note.dataset.navEnabled = navEnabled ? 'true' : 'false';
  if (!navEnabled) {
    nav.innerHTML = '';
    nav.style.display = 'none';
    return;
  }

  const activePane = getActiveNotePane(note);
  const summaryBody = activePane?.querySelector?.('.pzdrk-summary-body') || note.querySelector('.pzdrk-summary-body');
  const root = summaryBody || activePane || contentEl;
  const allHeadings = getNoteNavHeadings(root);
  if (allHeadings.length < 2) {
    nav.style.display = 'none';
    return;
  }
  const headings = allHeadings.slice(0, NOTE_NAV_MAX_ITEMS);
  const hiddenCount = Math.max(0, allHeadings.length - headings.length);
  nav.dataset.count = String(headings.length);
  nav.dataset.overflow = String(hiddenCount);
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

  if (hiddenCount > 0) {
    const more = document.createElement('div');
    more.className = 'pzdrk-note-nav-more';
    more.textContent = `+${hiddenCount}`;
    more.title = `${hiddenCount} разделов скрыто в компактной навигации`;
    nav.appendChild(more);
  }

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
  if (!nav || !contentEl) return;
  if (!areLeftNavButtonsEnabled()) {
    nav.style.display = 'none';
    return;
  }

  const activePane = getActiveNotePane(note);
  const summaryBody = activePane?.querySelector?.('.pzdrk-summary-body') || note.querySelector('.pzdrk-summary-body');
  const root = summaryBody || activePane || contentEl;
  const headings = getNoteNavHeadings(root).slice(0, NOTE_NAV_MAX_ITEMS);
  const buttons = Array.from(nav.querySelectorAll('.pzdrk-note-nav-item'));
  if (!headings.length || !buttons.length) return;

  const cTop = contentEl.getBoundingClientRect().top + 34;
  let activeId = headings[0].id;
  for (const h of headings) {
    if (h.getBoundingClientRect().top <= cTop) activeId = h.id;
  }

  buttons.forEach(b => b.classList.toggle('is-active', b.dataset.target === activeId));
}

function getNotePaneSelector(tabId) {
  const safe = String(tabId || 'main').replace(/["\\]/g, '\\$&');
  return `.pzdrk-tab-pane[data-tab-id="${safe}"]`;
}

function ensureNoteWorkspace(note) {
  if (!note || !note.isConnected) return null;
  if (note.dataset.layout === 'flyout') return null;
  const contentEl = note.querySelector('.pzdrk-note-content');
  if (!contentEl) return null;

  if (!note.__pzdrkTabMeta) note.__pzdrkTabMeta = new Map();
  if (!Array.isArray(note.__pzdrkTabOrder)) note.__pzdrkTabOrder = [];

  const panes = Array.from(contentEl.children || []).filter(el => el.classList?.contains('pzdrk-tab-pane'));
  if (!panes.length) {
    const pane = document.createElement('div');
    pane.className = 'pzdrk-tab-pane is-active';
    pane.dataset.tabId = 'main';
    while (contentEl.firstChild) pane.appendChild(contentEl.firstChild);
    contentEl.appendChild(pane);
    note.__pzdrkActiveTabId = 'main';
  } else if (!note.__pzdrkActiveTabId) {
    const active = panes.find(pane => pane.classList.contains('is-active')) || panes[0];
    note.__pzdrkActiveTabId = active?.dataset?.tabId || 'main';
  }

  if (!note.__pzdrkTabMeta.has('main')) {
    const title = String(note.querySelector('.pzdrk-note-title')?.textContent || document.title || 'Главная').trim();
    note.__pzdrkTabMeta.set('main', {
      id: 'main',
      title: 'Главная',
      label: title,
      group: 'core',
      kind: 'main',
      cmdId: 'summarize',
      status: 'ready',
      createdAt: Date.now(),
      updatedAt: Date.now()
    });
  }
  if (!note.__pzdrkTabOrder.includes('main')) note.__pzdrkTabOrder.unshift('main');

  contentEl.dataset.workspace = 'tabs';
  note.dataset.workspaceTabs = 'true';
  bindNoteWorkspaceChrome(note);
  return contentEl;
}

function getActiveNotePane(note) {
  if (!note || !note.isConnected) return null;
  const contentEl = ensureNoteWorkspace(note) || note.querySelector?.('.pzdrk-note-content');
  if (!contentEl) return null;
  const activeId = note.__pzdrkActiveTabId || 'main';
  return contentEl.querySelector(getNotePaneSelector(activeId)) ||
    contentEl.querySelector('.pzdrk-tab-pane.is-active') ||
    contentEl.querySelector('.pzdrk-tab-pane') ||
    contentEl;
}

function getNoteTabMeta(note, tabId = 'main') {
  ensureNoteWorkspace(note);
  return note?.__pzdrkTabMeta?.get(String(tabId || 'main')) || null;
}

function getWorkspaceTabIdForCommand(cmd) {
  const id = String(cmd?.id || cmd?.type || cmd?.title || 'tab').trim();
  if (!id || id === 'summarize') return 'main';
  return `cmd-${slugifyForId(id) || simpleHash32(id)}`;
}

const DIRECT_WORKSPACE_COMMAND_IDS = new Set([
  'summarize',
  'translate_page',
  'mindmap',
  'translate_selection',
  'explain_selection'
]);

function isWorkspaceTabCommand(cmd) {
  if (!cmd || !cmd.id) return false;
  return DIRECT_WORKSPACE_COMMAND_IDS.has(cmd.id) || isActionFlyoutCommand(cmd);
}

const WORKSPACE_TAB_PREFETCH_DELAY_MS = 280;
const WORKSPACE_TAB_PREFETCH_CONCURRENCY = 64;

function getWorkspaceCommandStatus(cmd) {
  const needsSelection = cmd?.scope === 'selection' && !getSelectionText();
  return needsSelection ? 'blocked' : 'queued';
}

function getWorkspaceCommandMeta(cmd, status = 'queued') {
  return {
    title: String(cmd?.title || cmd?.id || 'Вкладка').trim(),
    group: getCommandGroup(cmd),
    kind: 'command',
    cmdId: cmd?.id || '',
    status
  };
}

function renderWorkspaceCommandPlaceholder(cmd, status = 'queued') {
  const title = String(cmd?.title || cmd?.id || 'Вкладка').trim();
  if (status === 'blocked') {
    return renderStateCard({
      tone: 'muted',
      icon: cmd?.icon || '?',
      title,
      body: 'Эта вкладка уже закреплена в рабочей панели. Выделите фрагмент на странице, чтобы наполнить ее содержанием.',
      compact: true
    });
  }

  return renderStateCard({
    tone: 'waiting',
    icon: cmd?.icon || '...',
    title,
    body: 'Вкладка создана вместе с рабочей страницей. Контент генерируется фоном, правая кнопка только переключает на эту вкладку.',
    compact: true
  });
}

function ensureWorkspaceCommandPlaceholders(note) {
  if (!note || !note.isConnected || note.dataset.layout === 'flyout') return;
  ensureNoteWorkspace(note);

  getHintCommands()
    .filter(isWorkspaceTabCommand)
    .forEach((cmd) => {
      if (!cmd || cmd.id === 'summarize') return;
      const tabId = getWorkspaceTabIdForCommand(cmd);
      const existingPane = note.querySelector(getNotePaneSelector(tabId));
      const existingMeta = getNoteTabMeta(note, tabId);
      let status = existingMeta?.status || getWorkspaceCommandStatus(cmd);
      if (cmd.scope === 'selection' && status !== 'ready' && status !== 'loading') {
        status = getWorkspaceCommandStatus(cmd);
      }
      const meta = getWorkspaceCommandMeta(cmd, status);

      if (existingPane) {
        if (existingMeta?.status !== status && status !== 'ready' && status !== 'loading') {
          existingPane.innerHTML = renderWorkspaceCommandPlaceholder(cmd, status);
        }
        upsertNoteTabMeta(note, tabId, meta);
        return;
      }

      setNoteTabContent(note, tabId, renderWorkspaceCommandPlaceholder(cmd, status), meta, {
        activate: false,
        scrollTop: false
      });
    });
}

function shouldPrefetchWorkspaceCommand(cmd) {
  if (!isWorkspaceTabCommand(cmd)) return false;
  if (cmd.id === 'summarize') return false;
  if (cmd.scope === 'selection') return false;
  return true;
}

function scheduleWorkspaceTabPrefetch(note) {
  if (!note || !note.isConnected || note.dataset.layout === 'flyout') return;
  ensureWorkspaceCommandPlaceholders(note);
  if (note.dataset.workspacePrefetchStarted === 'true') return;
  note.dataset.workspacePrefetchStarted = 'true';

  window.setTimeout(() => {
    prefetchWorkspaceTabs(note).catch(() => {
      if (!note.isConnected) return;
      note.dataset.workspacePrefetchFailed = 'true';
      syncWorkspaceActionActive(note);
    });
  }, WORKSPACE_TAB_PREFETCH_DELAY_MS);
}

async function prefetchWorkspaceTabs(note) {
  if (!note || !note.isConnected) return;
  const commands = getHintCommands().filter(shouldPrefetchWorkspaceCommand);
  if (!commands.length) {
    note.dataset.workspacePrefetchStarted = 'false';
    autoSaveWorkspaceArtifact(note).catch(() => { });
    return;
  }

  const settings = runtimeSettings || await getSettings().catch(() => ({}));
  const limit = getAdaptiveParallelLimit(
    settings,
    Math.min(WORKSPACE_TAB_PREFETCH_CONCURRENCY, commands.length),
    WORKSPACE_TAB_PREFETCH_CONCURRENCY
  );

  await runWithConcurrency(commands, limit, async (cmd) => {
    if (!note.isConnected) return;
    const tabId = getWorkspaceTabIdForCommand(cmd);
    const meta = getNoteTabMeta(note, tabId);
    if (meta?.status === 'ready' || meta?.status === 'loading') return;
    await openCommandInWorkspaceTab(cmd, note, null, { activate: false });
  });

  if (note.isConnected) {
    note.dataset.workspacePrefetchDone = 'true';
    renderFloatingHints(note);
    syncWorkspaceActionActive(note);
    autoSaveWorkspaceArtifact(note).catch(() => { });
  }
}

function upsertNoteTabMeta(note, tabId, meta = {}) {
  ensureNoteWorkspace(note);
  if (!note?.__pzdrkTabMeta) return null;
  const id = String(tabId || 'main');
  const prev = note.__pzdrkTabMeta.get(id) || { id, createdAt: Date.now() };
  const next = {
    ...prev,
    ...meta,
    id,
    title: String(meta.title || prev.title || 'Вкладка').trim(),
    group: String(meta.group || prev.group || 'analysis').trim(),
    status: String(meta.status || prev.status || 'ready').trim(),
    updatedAt: Date.now()
  };
  note.__pzdrkTabMeta.set(id, next);
  if (!note.__pzdrkTabOrder.includes(id)) note.__pzdrkTabOrder.push(id);
  return next;
}

function getOrCreateNoteTabPane(note, tabId, meta = {}) {
  const contentEl = ensureNoteWorkspace(note);
  if (!contentEl) return null;
  const id = String(tabId || 'main');
  let pane = contentEl.querySelector(getNotePaneSelector(id));
  if (!pane) {
    pane = document.createElement('div');
    pane.className = 'pzdrk-tab-pane';
    pane.dataset.tabId = id;
    pane.hidden = true;
    contentEl.appendChild(pane);
  }
  upsertNoteTabMeta(note, id, meta);
  return pane;
}

function syncWorkspaceActionActive(note) {
  if (!note || !note.isConnected) return;
  const activeId = note.__pzdrkActiveTabId || 'main';
  renderWorkspaceTabStrip(note);
  note.querySelectorAll('.pzdrk-note-action[data-tab-id]').forEach(btn => {
    btn.classList.toggle('is-active', btn.dataset.tabId === activeId);
  });
  const pager = note.querySelector('.pzdrk-tab-pager');
  if (pager) {
    const order = getVisibleNoteTabOrder(note);
    const index = Math.max(0, order.indexOf(activeId));
    const meta = getNoteTabMeta(note, activeId);
    const label = pager.querySelector('.pzdrk-tab-pager-label');
    if (label) label.textContent = `${index + 1}/${Math.max(1, order.length)} • ${meta?.title || 'Вкладка'}`;
    pager.dataset.count = String(order.length);
    pager.querySelectorAll('.pzdrk-tab-round').forEach((btn) => {
      btn.disabled = order.length <= 1;
    });
  }
}

function renderWorkspaceTabStrip(note) {
  if (!note || !note.isConnected || note.dataset.layout === 'flyout') return;
  const strip = note.querySelector('.pzdrk-workspace-tabs');
  if (!strip) return;

  const order = getVisibleNoteTabOrder(note);
  const activeId = note.__pzdrkActiveTabId || 'main';
  strip.dataset.count = String(order.length);
  strip.setAttribute('role', 'tablist');
  strip.innerHTML = order.map((id) => {
    const meta = getNoteTabMeta(note, id) || {};
    const title = meta.title || (id === 'main' ? 'Главная' : 'Вкладка');
    const group = meta.group || '';
    const status = meta.status || 'ready';
    const isActive = id === activeId;
    const canClose = false;
    return `
      <div class="pzdrk-workspace-tab${isActive ? ' is-active' : ''}${status !== 'ready' ? ` is-${escapeAttr(status)}` : ''}" data-status="${escapeAttr(status)}">
        <button class="pzdrk-workspace-tab-hit" type="button" role="tab" aria-selected="${isActive ? 'true' : 'false'}" aria-busy="${status === 'loading' ? 'true' : 'false'}" data-tab-id="${escapeAttr(id)}" title="${escapeAttr(title)}${group ? ` - ${escapeAttr(group)}` : ''}">
          <span class="pzdrk-workspace-tab-label">${escapeHtml(title)}</span>
          ${status === 'loading' || status === 'error' ? `<span class="pzdrk-workspace-tab-dot" aria-label="${status === 'loading' ? 'Загружается' : 'Ошибка'}"></span>` : ''}
        </button>
        ${canClose ? `<button class="pzdrk-workspace-tab-close" type="button" data-tab-close="${escapeAttr(id)}" title="Закрыть вкладку ${escapeAttr(title)}" aria-label="Закрыть вкладку ${escapeAttr(title)}">×</button>` : ''}
      </div>
    `;
  }).join('');

  strip.querySelectorAll('.pzdrk-workspace-tab-hit[data-tab-id]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      activateNoteTab(note, btn.dataset.tabId || 'main');
    });
  });
  strip.querySelectorAll('.pzdrk-workspace-tab-close[data-tab-close]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      closeNoteTab(note, btn.dataset.tabClose || '');
    });
  });

  const activeTab = strip.querySelector('.pzdrk-workspace-tab.is-active');
  activeTab?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
}

function activateNoteTab(note, tabId = 'main', options = {}) {
  const contentEl = ensureNoteWorkspace(note);
  if (!contentEl) return;
  const id = String(tabId || 'main');
  const pane = getOrCreateNoteTabPane(note, id, { title: id === 'main' ? 'Главная' : 'Вкладка' });
  if (!pane) return;

  Array.from(contentEl.querySelectorAll('.pzdrk-tab-pane')).forEach(candidate => {
    const active = candidate === pane;
    candidate.hidden = !active;
    candidate.classList.toggle('is-active', active);
  });
  note.__pzdrkActiveTabId = id;
  note.dataset.activeTabId = id;
  if (options.scrollTop !== false) contentEl.scrollTop = 0;

  buildNoteNav(note);
  setupHoverInteractions(pane);
  bindConcretePromptCards(note);
  syncWorkspaceActionActive(note);
  updateNoteActionsPlacement(note);
}

function closeNoteTab(note, tabId = '') {
  if (!note || !note.isConnected) return false;
  const id = String(tabId || '').trim();
  if (!id || id === 'main') return false;

  const order = getVisibleNoteTabOrder(note);
  const index = order.indexOf(id);
  const pane = note.querySelector(getNotePaneSelector(id));
  if (!pane) return false;

  pane.remove();
  note.__pzdrkTabMeta?.delete(id);
  if (Array.isArray(note.__pzdrkTabOrder)) {
    note.__pzdrkTabOrder = note.__pzdrkTabOrder.filter(candidate => candidate !== id);
  }

  if ((note.__pzdrkActiveTabId || 'main') === id) {
    const next = order[index + 1] || order[index - 1] || 'main';
    activateNoteTab(note, next, { scrollTop: false });
  } else {
    syncWorkspaceActionActive(note);
    updateNoteActionsPlacement(note);
  }

  return true;
}

function setNoteTabContent(note, tabId, html, meta = {}, options = {}) {
  const pane = getOrCreateNoteTabPane(note, tabId, meta);
  if (!pane) return null;
  pane.innerHTML = String(html || '');
  pane.dataset.loaded = meta.status === 'loading' ? 'false' : 'true';
  upsertNoteTabMeta(note, tabId, meta);

  if (options.activate !== false) {
    activateNoteTab(note, tabId, { scrollTop: options.scrollTop !== false });
  } else if ((note.__pzdrkActiveTabId || 'main') === String(tabId || 'main')) {
    buildNoteNav(note);
    setupHoverInteractions(pane);
    bindConcretePromptCards(note);
  }
  syncWorkspaceActionActive(note);
  return pane;
}

function getVisibleNoteTabOrder(note) {
  ensureNoteWorkspace(note);
  const order = Array.isArray(note?.__pzdrkTabOrder) ? note.__pzdrkTabOrder : ['main'];
  return order.filter(id => {
    const pane = note.querySelector(getNotePaneSelector(id));
    return pane && pane.isConnected;
  });
}

function cycleNoteTab(note, direction = 1) {
  const order = getVisibleNoteTabOrder(note);
  if (!order.length) return;
  const active = note.__pzdrkActiveTabId || order[0];
  const index = Math.max(0, order.indexOf(active));
  const next = order[(index + direction + order.length) % order.length];
  activateNoteTab(note, next);
}

function collectNoteTabs(note) {
  ensureNoteWorkspace(note);
  const order = getVisibleNoteTabOrder(note);
  return order.map(id => {
    const pane = note.querySelector(getNotePaneSelector(id));
    const meta = getNoteTabMeta(note, id) || {};
    return {
      id,
      title: meta.title || id,
      group: meta.group || '',
      kind: meta.kind || '',
      text: String(pane?.innerText || '').trim(),
      html: String(pane?.innerHTML || '').trim()
    };
  });
}

function clipArtifactValue(value, maxLen = 120000) {
  const str = String(value || '');
  if (str.length <= maxLen) return str;
  return `${str.slice(0, maxLen)}\n\n<!-- pzdrk export clipped ${str.length - maxLen} chars -->`;
}

function getArtifactBaseTitle(note) {
  return String(note?.querySelector?.('.pzdrk-note-title')?.textContent || document.title || 'pzdrk').trim() || 'pzdrk';
}

function getArtifactFileSlug(note) {
  return slugifyForId(getArtifactBaseTitle(note)) || `pzdrk-${Date.now()}`;
}

function getPzdrkExportCss() {
  return `
    :root {
      color-scheme: dark;
      --bg: #07131f;
      --panel: rgba(12, 25, 38, 0.92);
      --panel-2: rgba(18, 35, 50, 0.86);
      --text: #edf7ff;
      --muted: rgba(237,247,255,0.68);
      --accent: #7dd3fc;
      --accent-2: #bef264;
      --border: rgba(125,211,252,0.18);
      --mono: "SF Mono", "IBM Plex Mono", ui-monospace, monospace;
      font-family: "SF Pro Display", "SF Pro Text", -apple-system, BlinkMacSystemFont, system-ui, sans-serif;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-height: 100vh;
      color: var(--text);
      background:
        radial-gradient(circle at 8% 0%, rgba(125,211,252,0.16), transparent 28%),
        radial-gradient(circle at 92% 6%, rgba(190,242,100,0.12), transparent 24%),
        linear-gradient(145deg, #06101a, #0b1a26 48%, #102434);
      font-size: 14px;
      line-height: 1.52;
    }
    .pzdrk-export-shell { width: min(1200px, calc(100vw - 32px)); margin: 24px auto 48px; }
    .pzdrk-export-header {
      padding: 24px;
      border: 1px solid var(--border);
      border-radius: 20px;
      background: linear-gradient(180deg, rgba(255,255,255,0.07), rgba(255,255,255,0.025)), var(--panel);
      box-shadow: 0 24px 70px rgba(0,0,0,0.32);
    }
    .pzdrk-export-kicker { color: var(--accent); font-size: 11px; font-weight: 800; letter-spacing: .12em; text-transform: uppercase; }
    h1 { margin: 8px 0 10px; font-size: 30px; line-height: 1.1; letter-spacing: 0; }
    .pzdrk-export-meta { display: flex; flex-wrap: wrap; gap: 8px; color: var(--muted); font-size: 12px; }
    .pzdrk-export-meta span, .pzdrk-export-nav a {
      display: inline-flex; align-items: center; min-height: 28px; padding: 6px 10px; border-radius: 999px;
      background: rgba(255,255,255,0.055); border: 1px solid rgba(255,255,255,0.07);
    }
    .pzdrk-export-nav { display: flex; flex-wrap: wrap; gap: 8px; margin: 16px 0 18px; }
    .pzdrk-export-nav a { color: var(--text); text-decoration: none; font-weight: 700; }
    .pzdrk-export-tab {
      margin-top: 14px;
      padding: 20px;
      border-radius: 18px;
      border: 1px solid var(--border);
      background: linear-gradient(180deg, rgba(255,255,255,0.045), rgba(255,255,255,0.018)), var(--panel);
      box-shadow: 0 18px 52px rgba(0,0,0,0.22);
      page-break-inside: avoid;
    }
    .pzdrk-export-tab h2 { margin: 0 0 12px; font-size: 20px; line-height: 1.2; letter-spacing: 0; }
    .pzdrk-export-tab-meta { margin-bottom: 12px; color: var(--muted); font-size: 11px; }
    h1, h2, h3, h4 { color: #fff; }
    a { color: var(--accent); }
    code, pre { font-family: var(--mono); }
    pre, .pzdrk-prewrap {
      white-space: pre-wrap;
      overflow-x: auto;
      padding: 12px;
      border-radius: 12px;
      background: rgba(2, 10, 18, 0.55);
      border: 1px solid rgba(125,211,252,0.12);
    }
    .pzdrk-state-card, .pzdrk-card, .pzdrk-action-card, .pzdrk-prompt-card,
    .pzdrk-section, .pzdrk-two-col, .pzdrk-two-col-left, .pzdrk-two-col-right {
      border-radius: 14px;
      border: 1px solid rgba(125,211,252,0.14);
      background: rgba(255,255,255,0.045);
      padding: 12px;
      margin: 8px 0;
    }
    .pzdrk-rich-table-wrap { overflow-x: auto; border-radius: 14px; border: 1px solid var(--border); background: rgba(8,18,30,0.52); margin: 10px 0; }
    .pzdrk-rich-table { width: 100%; border-collapse: collapse; font-size: 12px; line-height: 1.42; table-layout: auto; }
    .pzdrk-rich-table th, .pzdrk-rich-table td { padding: 8px 9px; border-bottom: 1px solid rgba(125,211,252,0.12); vertical-align: top; }
    .pzdrk-rich-table th { white-space: nowrap; color: #fff; background: rgba(125,211,252,0.12); }
    .pzdrk-rich-table th:first-child, .pzdrk-rich-table td:first-child { width: 1%; min-width: 54px; white-space: nowrap; text-align: center; }
    .pzdrk-term, .pzdrk-evidence { color: var(--accent-2); font-weight: 700; }
    @media print {
      body { background: #0b1622; }
      .pzdrk-export-shell { width: 100%; margin: 0; }
      .pzdrk-export-nav { display: none; }
      .pzdrk-export-tab { break-inside: avoid; box-shadow: none; }
    }
  `;
}

function buildWorkspaceMarkdown(note, tabs = collectNoteTabs(note)) {
  const now = new Date();
  const title = getArtifactBaseTitle(note);
  const lines = [
    `# ${title}`,
    '',
    `URL: ${window.location.href}`,
    `Saved: ${now.toISOString()}`,
    `Tabs: ${tabs.length}`,
    '',
    '## Tabs',
    ...tabs.map((tab, index) => `- ${index + 1}. ${tab.title || tab.id} (${tab.group || 'core'})`),
    ''
  ];

  tabs.forEach((tab, index) => {
    lines.push(`## ${index + 1}. ${tab.title || tab.id}`);
    if (tab.group) lines.push(`Group: ${tab.group}`);
    lines.push('', tab.text || '_Пусто_', '');
  });

  return lines.join('\n');
}

function buildWorkspaceExportHtml(note, artifact = null) {
  const tabs = artifact?.tabs || collectNoteTabs(note);
  const title = artifact?.title || getArtifactBaseTitle(note);
  const savedAt = new Date(artifact?.createdAt || Date.now()).toISOString();
  const url = artifact?.url || window.location.href;
  let sourceHost = 'source';
  try {
    sourceHost = new URL(url).hostname || 'source';
  } catch (e) {
    sourceHost = 'source';
  }
  const activeTabId = artifact?.activeTabId || note?.__pzdrkActiveTabId || 'main';
  const nav = tabs.map((tab, index) => (
    `<a href="#tab-${escapeAttr(tab.id || index)}">${escapeHtml(index + 1)}. ${escapeHtml(tab.title || tab.id || `Вкладка ${index + 1}`)}</a>`
  )).join('');
  const body = tabs.map((tab, index) => `
    <section class="pzdrk-export-tab${tab.id === activeTabId ? ' is-active' : ''}" id="tab-${escapeAttr(tab.id || index)}">
      <h2>${escapeHtml(index + 1)}. ${escapeHtml(tab.title || tab.id || `Вкладка ${index + 1}`)}</h2>
      <div class="pzdrk-export-tab-meta">${escapeHtml(tab.group || 'core')} ${tab.kind ? `• ${escapeHtml(tab.kind)}` : ''}</div>
      <div class="pzdrk-export-tab-body">${clipArtifactValue(tab.html || escapeHtml(tab.text || ''), 140000)}</div>
    </section>
  `).join('');

  return `<!doctype html>
<html lang="ru">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)} - pzdrk export</title>
  <style>${getPzdrkExportCss()}</style>
</head>
<body>
  <main class="pzdrk-export-shell">
    <header class="pzdrk-export-header">
      <div class="pzdrk-export-kicker">pzdrk rendered workspace export</div>
      <h1>${escapeHtml(title)}</h1>
      <div class="pzdrk-export-meta">
        <span>${escapeHtml(sourceHost)}</span>
        <span>${escapeHtml(savedAt)}</span>
        <span>${tabs.length} tabs</span>
      </div>
      <div class="pzdrk-export-meta" style="margin-top:8px;"><span>${escapeHtml(url)}</span></div>
    </header>
    <nav class="pzdrk-export-nav">${nav}</nav>
    ${body}
  </main>
</body>
</html>`;
}

function collectWorkspaceArtifact(note) {
  const tabs = collectNoteTabs(note).map(tab => ({
    id: tab.id,
    title: tab.title,
    group: tab.group,
    kind: tab.kind,
    status: getNoteTabMeta(note, tab.id)?.status || 'ready',
    text: clipArtifactValue(tab.text || '', 90000),
    html: clipArtifactValue(tab.html || '', 140000)
  }));
  const title = getArtifactBaseTitle(note);
  const text = tabs.map(tab => `## ${tab.title}\n${tab.text || ''}`).join('\n\n');
  const contentHash = simpleHash32(`${window.location.href}\n${title}\n${text}`);
  const createdAt = Date.now();
  const base = {
    id: `artifact-${createdAt}-${contentHash}`,
    url: window.location.href,
    canonicalUrl: document.querySelector('link[rel="canonical"]')?.href || window.location.href,
    title,
    domain: location.hostname,
    createdAt,
    updatedAt: createdAt,
      contentHash,
      activeTabId: note?.__pzdrkActiveTabId || 'main',
      tabs,
    markdown: '',
    html: '',
    text: clipArtifactValue(text, 160000),
    settingsSnapshot: {
      maxParallelRequests: runtimeSettings?.maxParallelRequests || DEFAULT_MAX_PARALLEL_REQUESTS,
      artifactAutoSave: runtimeSettings?.artifactAutoSave === true,
      showLeftNavButtons: runtimeSettings?.showLeftNavButtons === true,
      showRightActionButtons: runtimeSettings?.showRightActionButtons === true
    }
  };
  base.markdown = buildWorkspaceMarkdown(note, tabs);
  base.html = buildWorkspaceExportHtml(note, base);
  return base;
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
  setTimeout(() => {
    try { URL.revokeObjectURL(href); } catch (e) { }
  }, 1200);
}

function downloadWorkspaceHtml(note) {
  const artifact = collectWorkspaceArtifact(note);
  downloadTextFile(`${getArtifactFileSlug(note)}--pzdrk.html`, artifact.html, 'text/html;charset=utf-8');
  showToast('HTML-снимок скачан');
  return artifact;
}

function downloadWorkspaceMarkdown(note) {
  const artifact = collectWorkspaceArtifact(note);
  downloadTextFile(`${getArtifactFileSlug(note)}--pzdrk.md`, artifact.markdown, 'text/markdown;charset=utf-8');
  showToast('Markdown-снимок скачан');
  return artifact;
}

async function saveWorkspaceArtifact(note, options = {}) {
  const artifact = collectWorkspaceArtifact(note);
  const result = await sendRuntimeMessage('saveArtifact', { artifact });
  if (!options?.silent) showToast(`Сохранено в архив: ${result?.artifact?.tabCount || artifact.tabs.length} вкладок`);
  return result;
}

async function autoSaveWorkspaceArtifact(note) {
  if (!note || !note.isConnected) return null;
  const settings = runtimeSettings || await getSettings().catch(() => ({}));
  if (settings?.artifactAutoSave !== true) return null;
  if (note.dataset.artifactAutoSaving === 'true') return null;
  note.dataset.artifactAutoSaving = 'true';
  try {
    return await saveWorkspaceArtifact(note, { silent: true });
  } finally {
    if (note.isConnected) note.dataset.artifactAutoSaving = 'false';
  }
}

async function loadImageFromDataUrl(dataUrl) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Не удалось прочитать screenshot'));
    img.src = dataUrl;
  });
}

async function captureWorkspacePng(note) {
  if (!note || !note.isConnected) throw new Error('Нет активной панели');
  const dataUrl = await sendRuntimeMessage('captureVisibleTab');
  const img = await loadImageFromDataUrl(dataUrl);
  const rect = note.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  const sx = Math.max(0, Math.floor(rect.left * dpr));
  const sy = Math.max(0, Math.floor(rect.top * dpr));
  const sw = Math.max(1, Math.min(Math.floor(rect.width * dpr), img.naturalWidth - sx));
  const sh = Math.max(1, Math.min(Math.floor(rect.height * dpr), img.naturalHeight - sy));
  const canvas = document.createElement('canvas');
  canvas.width = sw;
  canvas.height = sh;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);
  const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
  if (!blob) throw new Error('Не удалось собрать PNG');
  const href = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = href;
  a.download = `${getArtifactFileSlug(note)}--pzdrk-visible.png`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(href), 1200);
  showToast('PNG-снимок видимой панели скачан');
}

async function sendWorkspaceToTelegram(note) {
  const artifact = collectWorkspaceArtifact(note);
  await sendRuntimeMessage('saveArtifact', { artifact }).catch(() => null);
  const result = await sendRuntimeMessage('sendTelegramArtifact', { artifact });
  showToast(`Telegram: отправлено ${Array.isArray(result?.sent) ? result.sent.join(', ') : 'ok'}`);
  return result;
}

function findNoteTabByMention(note, mention = '') {
  const needle = String(mention || '').replace(/^@/, '').trim().toLowerCase();
  if (!needle) return null;
  const tabs = collectNoteTabs(note);
  return tabs.find(tab => {
    const keys = [
      tab.id,
      tab.title,
      slugifyForId(tab.title),
      tab.kind,
      tab.group
    ].map(v => String(v || '').toLowerCase()).filter(Boolean);
    return keys.includes(needle) || keys.some(k => k.startsWith(needle));
  }) || null;
}

function buildObsidianMarkdownBundle(note) {
  const tabs = collectNoteTabs(note);
  const now = new Date();
  const date = now.toISOString().slice(0, 10);
  const title = String(note?.querySelector?.('.pzdrk-note-title')?.textContent || document.title || 'pzdrk').trim();
  const slug = slugifyForId(title || document.title) || `pzdrk-${Date.now()}`;
  const vaultPath = `${date}/${slug}/index.md`;
  const browserCtx = formatBrowserContext(browserContext);
  const activePane = getActiveNotePane(note);
  const snapshotHtml = String(activePane?.innerHTML || '').slice(0, 24000);

  const lines = [
    '---',
    `title: "${title.replace(/"/g, '\\"')}"`,
    `date: ${date}`,
    `source: "${window.location.href.replace(/"/g, '\\"')}"`,
    'tags:',
    '  - pzdrk',
    '  - browser-research',
    `pzdrk_vault_path: "${vaultPath}"`,
    '---',
    '',
    `# ${title}`,
    '',
    `Источник: ${window.location.href}`,
    `Дата сохранения: ${now.toISOString()}`,
    `Рекомендуемый путь в Obsidian: \`${vaultPath}\``,
    '',
    '## Вкладки',
    ...tabs.map(tab => `- [[${date}/${slug}/${slugifyForId(tab.title || tab.id) || tab.id}|${tab.title || tab.id}]]`),
    '',
    '## Контекст браузера',
    '',
    '```text',
    browserCtx,
    '```',
    ''
  ];

  tabs.forEach((tab, index) => {
    lines.push(`## ${index + 1}. ${tab.title || tab.id}`);
    if (tab.group) lines.push('', `Группа: ${tab.group}`);
    lines.push('', tab.text || '_Пустая вкладка_', '');
  });

  lines.push('## HTML-снимок активной вкладки', '', '```html', snapshotHtml, '```', '');
  return {
    markdown: lines.join('\n'),
    filename: `${date}--${slug}--obsidian.md`,
    vaultPath
  };
}

function downloadObsidianBundle(note) {
  const bundle = buildObsidianMarkdownBundle(note);
  const blob = new Blob([bundle.markdown], { type: 'text/markdown;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = bundle.filename;
  a.click();
  setTimeout(() => {
    try { URL.revokeObjectURL(a.href); } catch (e) { }
  }, 1000);
  showToast(`Obsidian Markdown готов: ${bundle.vaultPath}`);
}

async function submitNoteQuestion(note) {
  const input = note?.querySelector?.('.pzdrk-note-ask-input');
  const question = String(input?.value || '').trim();
  if (!note || !question) return;
  ensureNoteWorkspace(note);

  const activeId = note.__pzdrkActiveTabId || 'main';
  const activeTab = collectNoteTabs(note).find(tab => tab.id === activeId) || collectNoteTabs(note)[0];
  const mentions = Array.from(question.matchAll(/@([\p{L}\p{N}_-]+)/gu)).map(m => m[1]).filter(Boolean);
  const mentionedTabs = mentions
    .map(name => findNoteTabByMention(note, name))
    .filter(Boolean)
    .filter((tab, index, arr) => arr.findIndex(x => x.id === tab.id) === index);
  const tabsForContext = [activeTab, ...mentionedTabs.filter(tab => tab.id !== activeTab?.id)].filter(Boolean);
  const settings = runtimeSettings || await getSettings().catch(() => ({}));
  const answerId = `answer-${Date.now()}`;
  const loading = renderStateCard({
    tone: 'waiting',
    icon: '...',
    title: 'Готовлю ответ по вкладке',
    body: 'Беру активную вкладку, явные @упоминания и браузерный контекст последнего часа.',
    compact: true
  });

  setNoteTabContent(note, answerId, loading, {
    title: 'Ответ',
    group: 'Вопрос',
    kind: 'answer',
    status: 'loading'
  }, { activate: true });
  renderFloatingHints(note);

  try {
    const tabContext = tabsForContext.map(tab => {
      const body = clipPromptInput(tab.text || '', 4200);
      return `### TAB ${tab.id}: ${tab.title}\n${body || '—'}`;
    }).join('\n\n');
    const prompt = [
      'Ответь на вопрос пользователя по контексту вкладок pzdrk.',
      '',
      `ВОПРОС: ${question}`,
      '',
      'КОНТЕКСТ ВКЛАДОК:',
      tabContext || '—',
      '',
      'КОНТЕКСТ БРАУЗЕРА ЗА ПОСЛЕДНИЙ ЧАС:',
      formatBrowserContext(browserContext),
      '',
      'ТРЕБОВАНИЯ:',
      '1. Пиши по-русски, плотно и проверяемо.',
      '2. Разделяй факт, вывод и гипотезу.',
      '3. Если данных не хватает, назови пробел и лучший следующий вопрос.',
      '4. В конце дай 3 следующих действия или запроса.'
    ].join('\n');
    const result = await callGroq(prompt, STYLE_RULES, {
      temperature: 0.32,
      max_tokens: getTaskMaxTokens(settings, 1800, 320)
    });
    setNoteTabContent(note, answerId, formatRichText(result || '—'), {
      title: question.slice(0, 34) || 'Ответ',
      group: 'Вопрос',
      kind: 'answer',
      status: 'ready'
    }, { activate: true });
    if (input) input.value = '';
    note.querySelector('.pzdrk-note-askbar')?.classList.remove('has-text');
  } catch (e) {
    setNoteTabContent(note, answerId, `<div class="pzdrk-error">Ошибка: ${escapeHtml(e?.message || 'не удалось получить ответ')}</div>`, {
      title: 'Ошибка ответа',
      group: 'Вопрос',
      kind: 'answer',
      status: 'error'
    }, { activate: true });
  } finally {
    renderFloatingHints(note);
  }
}

function bindNoteWorkspaceChrome(note) {
  if (!note || note.dataset.workspaceChromeBound === 'true') return;
  note.dataset.workspaceChromeBound = 'true';
  note.querySelector('.pzdrk-tab-prev')?.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    cycleNoteTab(note, -1);
  });
  note.querySelector('.pzdrk-tab-next')?.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    cycleNoteTab(note, 1);
  });

  const askbar = note.querySelector('.pzdrk-note-askbar');
  const input = note.querySelector('.pzdrk-note-ask-input');
  const send = note.querySelector('.pzdrk-note-ask-send');
  if (input && askbar) {
    input.addEventListener('input', () => {
      const hasText = !!String(input.value || '').trim();
      askbar.classList.toggle('has-text', hasText);
      if (send) send.disabled = !hasText;
    });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey && String(input.value || '').trim()) {
        e.preventDefault();
        submitNoteQuestion(note);
      }
    });
  }
  send?.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    submitNoteQuestion(note);
  });
}

function updateNoteNavPlacement(note) {
  if (!note || !note.isConnected) return;
  const nav = note.querySelector('.pzdrk-note-nav');
  if (!nav) return;
  if (!areLeftNavButtonsEnabled()) {
    nav.style.display = 'none';
    return;
  }
  if (note.classList.contains('docked')) return;

  nav.classList.remove('nav-overlay');
  const margin = 10;
  const noteRect = note.getBoundingClientRect();
  const navWidth = Math.max(nav.offsetWidth || 0, 132);
  const isCramped = noteRect.left < (navWidth + margin + 8) || window.innerWidth < 1340 || noteRect.width < 520;
  if (isCramped) {
    nav.classList.add('nav-overlay');
    return;
  }
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
      if (note.dataset.actionsEnabled === 'true') updateNoteActionsPlacement(note);
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
        if (note.dataset.actionsEnabled === 'true') updateNoteActionsPlacement(note);
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

function bringNoteToFront(note) {
  if (!note || !note.isConnected) return;
  noteZCounter += 1;
  note.style.zIndex = String(noteZCounter);
}

function getActionEnabledNotes() {
  return currentNotes
    .filter(note => note && note.isConnected)
    .filter(note => note.dataset.actionsEnabled === 'true')
    .filter(note => areRightActionButtonsEnabled());
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

  getSettings().then(s => {
    runtimeSettings = s;
    if (s.classicMode) note.classList.add('classic-mode');
    note.dataset.navEnabled = s.showLeftNavButtons === true ? 'true' : 'false';
    note.dataset.actionsEnabled = s.showRightActionButtons === true ? 'true' : 'false';
  });

  note.innerHTML = `
    <div class="pzdrk-resize-n"></div><div class="pzdrk-resize-s"></div>
    <div class="pzdrk-resize-e"></div><div class="pzdrk-resize-w"></div>
    <div class="pzdrk-resize-ne"></div><div class="pzdrk-resize-nw"></div>
    <div class="pzdrk-resize-se"></div><div class="pzdrk-resize-sw"></div>
    <div class="pzdrk-note-surface">
      <div class="pzdrk-note-header">
        <div class="pzdrk-note-header-left">
          <div class="pzdrk-note-header-identity">
            <span class="pzdrk-logo-wrap" aria-label="@pzdrk by pzd.world">
              <img class="pzdrk-note-logo" src="${PZDRK_LOGO_URL}" alt="pzdrk">
              <span class="pzdrk-brand-label">@pzdrk by pzd.world</span>
            </span>
            <span class="pzdrk-note-title">${title}</span>
          </div>
          <div class="pzdrk-note-header-meta">
            <span class="pzdrk-privacy-badge" title="Заблокированные трекеры"><span class="pzdrk-ghost-icon">👻</span><span class="pzdrk-blocked-count">0</span></span>
            ${showTokens ? `<span class="pzdrk-token-badge" title="Размер входного контекста страницы и размер готовой заметки"><span class="pzdrk-emoji">📊</span><span class="pzdrk-token-label">вход</span><span class="pzdrk-page-tokens">${pageTokenCount}</span><span class="pzdrk-token-sep">•</span><span class="pzdrk-token-label">ответ</span><span class="pzdrk-summary-tokens">0</span></span>` : ''}
          </div>
        </div>
        <div class="pzdrk-note-header-right">
          <div class="pzdrk-note-tool-group pzdrk-note-tool-group-primary">
            <button class="pzdrk-btn-icon pzdrk-btn-mindmap" title="Карта (M)">🗺</button>
            <button class="pzdrk-btn-icon pzdrk-btn-speak" title="Озвучить (V)">🔊</button>
            <button class="pzdrk-btn-icon pzdrk-btn-copy" title="Копировать">📋</button>
            <button class="pzdrk-btn-icon pzdrk-btn-save-artifact" title="Сохранить workspace в архив">💽</button>
            <button class="pzdrk-btn-icon pzdrk-btn-download" title="Скачать HTML">💾</button>
            <button class="pzdrk-btn-icon pzdrk-btn-capture" title="Скачать PNG видимой панели">▣</button>
            <button class="pzdrk-btn-icon pzdrk-btn-telegram" title="Отправить HTML/Markdown в Telegram">Tg</button>
            <button class="pzdrk-btn-icon pzdrk-btn-obsidian" title="Сохранить в Obsidian">Ob</button>
          </div>
          <span class="pzdrk-note-tool-divider" aria-hidden="true"></span>
          <div class="pzdrk-note-tool-group pzdrk-note-tool-group-shell">
            <button class="pzdrk-btn-icon pzdrk-btn-dock" title="В угол">⤡</button>
            <button class="pzdrk-btn-icon pzdrk-btn-close" title="Закрыть">✕</button>
          </div>
        </div>
      </div>
      <div class="pzdrk-workspace-tabs" role="tablist" aria-label="Вкладки workspace"></div>
      <div class="pzdrk-note-content">${content}</div>
    </div>
    <div class="pzdrk-note-bottom-dock">
      <div class="pzdrk-tab-pager" aria-label="Переключение вкладок">
        <button class="pzdrk-tab-round pzdrk-tab-prev" type="button" title="Предыдущая вкладка">‹</button>
        <span class="pzdrk-tab-pager-label">1/1 • Главная</span>
        <button class="pzdrk-tab-round pzdrk-tab-next" type="button" title="Следующая вкладка">›</button>
      </div>
      <div class="pzdrk-note-askbar">
        <input class="pzdrk-note-ask-input" type="text" autocomplete="off" placeholder="Задать вопрос по вкладке; @главная или @ответ подтянут контекст" />
        <button class="pzdrk-note-ask-send" type="button" disabled title="Отправить вопрос">Enter</button>
      </div>
    </div>
    <div class="pzdrk-note-nav" aria-label="Navigation"></div>
    <div class="pzdrk-note-actions" aria-label="Actions"></div>
  `;

  document.body.appendChild(note);
  currentNotes.push(note);
  bringNoteToFront(note);
  bindNoteWorkspaceChrome(note);
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
    if (note.dataset.actionsEnabled === 'true') updateNoteActionsPlacement(note);
  };
  makeDraggable(note, note.querySelector('.pzdrk-note-header'), onMove);
  makeResizableAllEdges(note, onMove);

  note.addEventListener('mousedown', () => bringNoteToFront(note), true);

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
    if (actionsAnchorNote === note) actionsAnchorNote = null;
    if (actionFlyout?.anchorEl && !actionFlyout.anchorEl.isConnected) hideActionFlyout(true);
    if (noteResizeObserver) noteResizeObserver.unobserve(note);
    if (note.dataset.layout === 'flyout' && actionFlyout?.note === note) actionFlyout = null;
    scheduleLayoutNotes();
  });

  // Dock to corner (bottom-left tab style)
  note.querySelector('.pzdrk-btn-dock').addEventListener('click', () => {
    if (note.dataset.layout === 'flyout') return;
    toggleDock(note);
    updateNoteNavPlacement(note);
    if (note.dataset.actionsEnabled === 'true') updateNoteActionsPlacement(note);
  });

  // Clicking docked header restores previous position
  note.querySelector('.pzdrk-note-header').addEventListener('click', (e) => {
    if (note.dataset.layout === 'flyout') return;
    if (!note.classList.contains('docked')) return;
    if (e.target.closest('button, input')) return;
    toggleDock(note, { forceUndock: true });
  });

  // Copy
  note.querySelector('.pzdrk-btn-copy').addEventListener('click', async () => {
    try {
      await copyTextToClipboard(note.querySelector('.pzdrk-note-content').innerText);
      showToast('📋 Скопировано');
    } catch (e) {
      showToast('📋 Ошибка копирования: ' + (e?.message || 'ошибка'));
    }
  });

  // Download
  note.querySelector('.pzdrk-btn-save-artifact')?.addEventListener('click', async () => {
    const btn = note.querySelector('.pzdrk-btn-save-artifact');
    const prev = btn?.textContent;
    if (btn) btn.textContent = '...';
    try {
      await saveWorkspaceArtifact(note);
    } catch (e) {
      showToast('Архив: ' + (e?.message || 'ошибка сохранения'));
    } finally {
      if (btn) btn.textContent = prev || '💽';
    }
  });

  note.querySelector('.pzdrk-btn-download')?.addEventListener('click', (e) => {
    try {
      if (e.shiftKey || e.altKey) {
        downloadWorkspaceMarkdown(note);
      } else {
        downloadWorkspaceHtml(note);
      }
    } catch (err) {
      showToast('Экспорт: ' + (err?.message || 'ошибка'));
    }
  });

  note.querySelector('.pzdrk-btn-capture')?.addEventListener('click', async () => {
    const btn = note.querySelector('.pzdrk-btn-capture');
    const prev = btn?.textContent;
    if (btn) btn.textContent = '...';
    try {
      await captureWorkspacePng(note);
    } catch (e) {
      showToast('PNG: ' + (e?.message || 'ошибка снимка'));
    } finally {
      if (btn) btn.textContent = prev || '▣';
    }
  });

  note.querySelector('.pzdrk-btn-telegram')?.addEventListener('click', async () => {
    const btn = note.querySelector('.pzdrk-btn-telegram');
    const prev = btn?.textContent;
    if (btn) btn.textContent = '...';
    try {
      await sendWorkspaceToTelegram(note);
    } catch (e) {
      showToast('Telegram: ' + (e?.message || 'ошибка отправки'));
    } finally {
      if (btn) btn.textContent = prev || 'Tg';
    }
  });

  note.querySelector('.pzdrk-btn-obsidian')?.addEventListener('click', () => {
    try {
      downloadObsidianBundle(note);
    } catch (e) {
      showToast('Obsidian: ' + (e?.message || 'ошибка экспорта'));
    }
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

      const voicePrompt = getPromptOverride('voiceScript', settings)
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

  // MINDMAP button = update map section inside the main tab
  note.querySelector('.pzdrk-btn-mindmap').addEventListener('click', () => generateMindmap(note, { inline: true }));

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
    try { prev = JSON.parse(note.dataset.prevDock || 'null'); } catch (e) { }

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
    if (e.target.closest('button, input')) return;
    markNoteManual(element);
    bringNoteToFront(element);
    element.classList.add('is-dragging');
    dragging = true;
    const rect = element.getBoundingClientRect();
    offset = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    element.style.transform = 'none';
    e.preventDefault();
  });
  document.addEventListener('mousemove', (e) => {
    if (!dragging) return;
    const maxLeft = Math.max(8, window.innerWidth - element.offsetWidth - 8);
    const maxTop = Math.max(8, window.innerHeight - Math.min(element.offsetHeight, window.innerHeight - 16) - 8);
    const nextLeft = Math.max(8, Math.min(e.clientX - offset.x, maxLeft));
    const nextTop = Math.max(8, Math.min(e.clientY - offset.y, maxTop));
    element.style.left = nextLeft + 'px';
    element.style.top = nextTop + 'px';
    if (onMove) onMove();
  });
  document.addEventListener('mouseup', () => {
    if (!dragging) return;
    dragging = false;
    element.classList.remove('is-dragging');
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
      markNoteManual(element);
      bringNoteToFront(element);
      element.classList.add('is-resizing');
      resizing = edge; startRect = element.getBoundingClientRect(); startMouse = { x: e.clientX, y: e.clientY };
      e.preventDefault(); e.stopPropagation();
    });
  });
  document.addEventListener('mousemove', (e) => {
    if (!resizing) return;
    const dx = e.clientX - startMouse.x, dy = e.clientY - startMouse.y;
    let w = startRect.width, h = startRect.height, l = startRect.left, t = startRect.top;
    const maxWidth = Math.max(320, window.innerWidth - 16);
    const maxHeight = Math.max(140, window.innerHeight - 16);
    if (resizing.includes('e')) w = Math.max(280, Math.min(maxWidth, startRect.width + dx));
    if (resizing.includes('w')) {
      w = Math.max(280, Math.min(maxWidth, startRect.width - dx));
      l = Math.max(8, startRect.left + dx);
      w = Math.min(maxWidth, startRect.right - l);
    }
    if (resizing.includes('s')) h = Math.max(100, Math.min(maxHeight, startRect.height + dy));
    if (resizing.includes('n')) {
      h = Math.max(100, Math.min(maxHeight, startRect.height - dy));
      t = Math.max(8, startRect.top + dy);
      h = Math.min(maxHeight, startRect.bottom - t);
    }
    element.style.width = w + 'px'; element.style.height = h + 'px'; element.style.maxHeight = h + 'px';
    if (resizing.includes('w')) element.style.left = l + 'px';
    if (resizing.includes('n')) element.style.top = t + 'px';
    element.style.transform = 'none';
    if (onMove) onMove();
  });
  document.addEventListener('mouseup', () => {
    if (!resizing) return;
    resizing = null;
    element.classList.remove('is-resizing');
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

async function copyTextToClipboard(text) {
  const value = String(text ?? '');
  if (!value) throw new Error('Нет текста для копирования');

  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(value);
      return;
    } catch (_) {
      // Fall back to the legacy copy path when Clipboard API is blocked in page/extension context.
    }
  }

  const textarea = document.createElement('textarea');
  textarea.value = value;
  textarea.setAttribute('readonly', 'readonly');
  textarea.style.position = 'fixed';
  textarea.style.top = '-9999px';
  textarea.style.left = '-9999px';
  textarea.style.opacity = '0';
  textarea.style.pointerEvents = 'none';

  document.body.appendChild(textarea);
  textarea.focus();
  textarea.select();
  textarea.setSelectionRange(0, textarea.value.length);

  let copied = false;
  try {
    copied = document.execCommand('copy');
  } catch (_) {
    copied = false;
  } finally {
    textarea.remove();
  }

  if (!copied) throw new Error('Не удалось скопировать в буфер');
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
      copyTextToClipboard(text).then(() => showToast('📋 Скопировано')).catch(() => { });
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
        copyTextToClipboard(actionText).then(() => showToast('📋 Скопировано')).catch(() => { });
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

        const prompt = getPromptOverride('actionToPrompt')
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

        await copyTextToClipboard(out);
      showToast('⚡ Запрос скопирован');
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
          `<strong>Размер текста</strong><br>Вход: примерно ${escapeHtml(pageTok)} токенов страницы ушло в модель как контекст.<br>Ответ: примерно ${escapeHtml(sumTok)} токенов содержится в готовой заметке.<br><span style="opacity:0.7">Это приблизительные оценки длины входа и выхода, а не лимит и не качество ответа.</span>`
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

function normalizeConcretePromptEntry(item) {
  if (!item) return null;

  if (typeof item === 'string') {
    const clean = normalizeBulletLine(item);
    if (!clean) return null;
    return {
      title: clean.slice(0, 72),
      desc: '',
      prompt: clean
    };
  }

  if (typeof item !== 'object') return null;

  const title = normalizeBulletLine(item.title || item.label || item.name || item.task || item.action || item.prompt);
  const desc = normalizeBulletLine(item.desc || item.description || item.summary || item.why || '');
  const prompt = normalizeBulletLine(item.prompt || item.text || item.content || item.value || '');
  if (!title && !prompt) return null;

  return {
    title: (title || prompt).slice(0, 72),
    desc: desc.slice(0, 180),
    prompt: (prompt || title).slice(0, 900)
  };
}

const SUMMARY_SECTION_PRESETS = [
  { canonicalKey: 'tldr', emoji: '✳️', label: 'TL;DR', aliases: ['tldr', 'tl dr', 'tl;dr', 'главное', 'кратко', 'коротко'] },
  { canonicalKey: 'core', emoji: '📌', label: 'СУТЬ', aliases: ['core', 'summary', 'essence', 'суть', 'главная мысль'] },
  { canonicalKey: 'toc', emoji: '🧭', label: 'КАРТА', aliases: ['toc', 'map', 'outline', 'карта', 'структура', 'содержание'] },
  { canonicalKey: 'mechanics', emoji: '⚙️', label: 'МЕХАНИЗМЫ', aliases: ['mechanics', 'architecture', 'how it works', 'механика', 'механизмы', 'архитектура'] },
  { canonicalKey: 'implications', emoji: '🧩', label: 'ЗАЧЕМ ЭТО ВАЖНО', aliases: ['implications', 'importance', 'why it matters', 'почему это важно', 'зачем это важно', 'последствия'] },
  { canonicalKey: 'usage', emoji: '🛠', label: 'ПРИМЕНЕНИЕ', aliases: ['usage', 'applications', 'use cases', 'use-cases', 'применение', 'сценарии'] },
  { canonicalKey: 'automation', emoji: '🤖', label: 'АВТОМАТИЗАЦИИ', aliases: ['automation', 'automations', 'workflow', 'workflows', 'автоматизация', 'автоматизации'] },
  { canonicalKey: 'open', emoji: '❓', label: 'ОТКРЫТЫЕ ВОПРОСЫ', aliases: ['open questions', 'questions', 'unknowns', 'неясности', 'открытые вопросы', 'что неясно'] },
  { canonicalKey: 'verify', emoji: '🧪', label: 'ЧТО ПРОВЕРИТЬ ДАЛЬШЕ', aliases: ['verify', 'validation', 'next checks', 'что проверить дальше', 'проверить дальше'] },
  { canonicalKey: 'risks', emoji: '⚠️', label: 'РИСКИ / НЕЯСНОСТИ', aliases: ['risks', 'risk', 'risks / questions', 'risks questions', 'риски', 'риски неясности'] },
  { canonicalKey: 'details', emoji: '🔎', label: 'ДЕТАЛИ', aliases: ['details', 'detail', 'details / context', 'детали', 'контекст'] }
];

function normalizeSectionMatchToken(value = '') {
  return String(value || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

function getSummarySectionPreset(section) {
  if (!section || typeof section !== 'object') return null;

  const tokens = [
    normalizeSectionMatchToken(section.key),
    normalizeSectionMatchToken(section.label),
    normalizeSectionMatchToken(section.title)
  ].filter(Boolean);

  for (const preset of SUMMARY_SECTION_PRESETS) {
    for (const alias of preset.aliases) {
      const target = normalizeSectionMatchToken(alias);
      if (!target) continue;
      if (tokens.some(token => token === target || token.includes(target) || target.includes(token))) {
        return preset;
      }
    }
  }

  return null;
}

function normalizeSummaryParagraph(value, maxLen = 420) {
  return extractTextCandidate(value)
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, Math.max(40, Number(maxLen) || 420));
}

function normalizeSummaryTextList(values, limit = 8, maxLen = 420) {
  const input = Array.isArray(values) ? values : (values == null ? [] : [values]);
  const out = [];
  const seen = new Set();

  for (const raw of input) {
    const line = normalizeSummaryParagraph(raw, maxLen);
    const key = line.toLowerCase();
    if (!line || seen.has(key)) continue;
    seen.add(key);
    out.push(line);
    if (out.length >= Math.max(1, Number(limit) || 8)) break;
  }

  return out;
}

function normalizeSummaryRightBlock(right) {
  const r = (right && typeof right === 'object') ? right : {};

  const commentary = normalizeSummaryTextList(r.commentary, 6, 420);

  const terms = (Array.isArray(r.terms) ? r.terms : [])
    .map(item => {
      const category = normalizeSummaryParagraph(item?.category || item?.group || item?.type || '', 80);
      return {
        term: normalizeSummaryParagraph(item?.term || item?.name || item?.label || item, 80),
        definition: normalizeSummaryParagraph(item?.definition || item?.description || item?.meaning || item?.context || item?.value, 260),
        ...(category ? { category } : {})
      };
    })
    .filter(item => item.term || item.definition)
    .slice(0, 10);

  const entities = (Array.isArray(r.entities) ? r.entities : [])
    .map(item => {
      const category = normalizeSummaryParagraph(item?.category || item?.group || item?.type || '', 80);
      return {
        name: normalizeSummaryParagraph(item?.name || item?.title || item?.label || item, 80),
        context: normalizeSummaryParagraph(item?.context || item?.description || item?.role || item?.summary, 220),
        exaQuery: normalizeSummaryParagraph(item?.exaQuery || item?.query || item?.search || item?.lookup, 160),
        ...(category ? { category } : {})
      };
    })
    .filter(item => item.name)
    .slice(0, 12);

  const refs = (Array.isArray(r.refs) ? r.refs : [])
    .map(item => ({
      query: normalizeSummaryParagraph(item?.query || item?.search || item?.title || item, 180),
      why: normalizeSummaryParagraph(item?.why || item?.reason || item?.context || item?.note, 180)
    }))
    .filter(item => item.query)
    .slice(0, 10);

  return { commentary, terms, entities, refs };
}

function normalizeSummarySection(section, index = 0) {
  if (!section || typeof section !== 'object') return null;

  const preset = getSummarySectionPreset(section);
  const fallbackTitle = normalizeSummaryParagraph(section.label || section.title || section.key || `Раздел ${index + 1}`, 64) || `Раздел ${index + 1}`;
  const left = normalizeSummaryTextList(section.left, 12, 320);
  const actions = normalizeSummaryTextList(section.actions, 8, 280);

  return {
    key: preset?.canonicalKey || slugifyForId(section.key || fallbackTitle || `section-${index + 1}`),
    emoji: String(section.emoji || preset?.emoji || '').trim(),
    label: String(preset?.label || fallbackTitle).trim(),
    left,
    actions,
    right: normalizeSummaryRightBlock(section.right)
  };
}

function deriveTldrLinesFromSections(sections) {
  const sourceSections = [
    sections.find(section => section?.key === 'core'),
    sections.find(section => Array.isArray(section?.left) && section.left.length >= 3),
    sections[0]
  ].filter(Boolean);

  for (const section of sourceSections) {
    const lines = normalizeSummaryTextList(section.left, 4, 220);
    if (lines.length) return lines;
  }

  return [];
}

function deriveAutomationBullets(summaryObj) {
  const prompts = ensureConcretePrompts(summaryObj, { title: summaryObj?.title });
  return prompts
    .slice(0, 6)
    .map(item => normalizeBulletLine(`${item.title}${item.desc ? ` — ${item.desc}` : ''}`))
    .filter(Boolean);
}

function deriveVerifyBullets(sections) {
  const list = [];

  for (const section of (Array.isArray(sections) ? sections : [])) {
    const refs = Array.isArray(section?.right?.refs) ? section.right.refs : [];
    refs.forEach(ref => {
      const query = normalizeSummaryParagraph(ref?.query, 180);
      if (!query) return;
      const line = normalizeBulletLine(`Проверить: ${query}${ref?.why ? ` — ${normalizeSummaryParagraph(ref.why, 180)}` : ''}`);
      if (line) list.push(line);
    });

    const entities = Array.isArray(section?.right?.entities) ? section.right.entities : [];
    entities.forEach(entity => {
      const name = normalizeSummaryParagraph(entity?.name, 80);
      if (!name) return;
      const line = normalizeBulletLine(`Уточнить [[entity:${name}]]${entity?.context ? ` — ${normalizeSummaryParagraph(entity.context, 160)}` : ''}`);
      if (line) list.push(line);
    });

    const terms = Array.isArray(section?.right?.terms) ? section.right.terms : [];
    terms.forEach(term => {
      const name = normalizeSummaryParagraph(term?.term, 80);
      if (!name) return;
      const line = normalizeBulletLine(`Уточнить [[term:${name}]]${term?.definition ? ` — ${normalizeSummaryParagraph(term.definition, 180)}` : ''}`);
      if (line) list.push(line);
    });
  }

  return normalizeSummaryTextList(list, 8, 240);
}

function orderSummarySections(summaryObj) {
  if (!summaryObj || typeof summaryObj !== 'object') return [];

  const incoming = Array.isArray(summaryObj.sections) ? summaryObj.sections : [];
  const normalized = incoming
    .map((section, index) => normalizeSummarySection(section, index))
    .filter(Boolean);

  if (!normalized.some(section => section.key === 'tldr')) {
    const tldrLeft = deriveTldrLinesFromSections(normalized);
    if (tldrLeft.length) {
      normalized.unshift({
        key: 'tldr',
        emoji: '✳️',
        label: 'TL;DR',
        left: tldrLeft,
        actions: [],
        right: { commentary: [], terms: [], entities: [], refs: [] }
      });
    }
  }

  if (!normalized.some(section => section.key === 'automation')) {
    const automationLeft = deriveAutomationBullets(summaryObj);
    if (automationLeft.length) {
      normalized.push({
        key: 'automation',
        emoji: '🤖',
        label: 'АВТОМАТИЗАЦИИ',
        left: automationLeft,
        actions: [],
        right: { commentary: [], terms: [], entities: [], refs: [] }
      });
    }
  }

  if (!normalized.some(section => section.key === 'verify')) {
    const verifyLeft = deriveVerifyBullets(normalized);
    if (verifyLeft.length) {
      normalized.push({
        key: 'verify',
        emoji: '🧪',
        label: 'ЧТО ПРОВЕРИТЬ ДАЛЬШЕ',
        left: verifyLeft,
        actions: [],
        right: { commentary: [], terms: [], entities: [], refs: [] }
      });
    }
  }

  const rank = new Map(SUMMARY_SECTION_PRESETS.map((preset, index) => [preset.canonicalKey, index]));

  const ordered = normalized
    .map((section, index) => ({ section, index }))
    .sort((a, b) => {
      const aRank = rank.has(a.section.key) ? rank.get(a.section.key) : 999 + a.index;
      const bRank = rank.has(b.section.key) ? rank.get(b.section.key) : 999 + b.index;
      return aRank - bRank;
    })
    .map(item => item.section);

  summaryObj.sections = ordered;
  return ordered;
}

function buildPromptTitleFromAction(actionLine = '', index = 0) {
  const raw = normalizeBulletLine(actionLine)
    .replace(/\[\[(?:action|entity|term|evidence|wiki):([^\]]+)\]\]/gi, '$1')
    .replace(/\s*[—-]\s+.+$/, '')
    .trim();
  if (raw) return raw.slice(0, 72);

  const words = normalizeBulletLine(actionLine).split(/\s+/).filter(Boolean).slice(0, 6).join(' ');
  return (words || `Запрос ${index + 1}`).slice(0, 72);
}

function collectSummaryActions(summaryObj, limit = 12) {
  if (!summaryObj || typeof summaryObj !== 'object') return [];

  const topLevel = Array.isArray(summaryObj.actions) ? summaryObj.actions : [];
  const sectionLevel = (Array.isArray(summaryObj.sections) ? summaryObj.sections : [])
    .flatMap(section => (Array.isArray(section?.actions) ? section.actions : []));

  const out = [];
  const seen = new Set();
  for (const raw of [...topLevel, ...sectionLevel]) {
    const action = normalizeBulletLine(raw);
    const key = action.toLowerCase();
    if (!action || seen.has(key)) continue;
    seen.add(key);
    out.push(action);
    if (out.length >= Math.max(1, Number(limit) || 12)) break;
  }

  return out;
}

function deriveConcretePromptsFromActions(actions, options = {}) {
  const title = String(options?.title || document.title || 'эта страница').trim().slice(0, 120);
  const til = Array.isArray(options?.til) ? options.til.map(normalizeBulletLine).filter(Boolean).slice(0, 3) : [];
  const out = [];
  const seen = new Set();

  const actionList = Array.isArray(actions) ? actions : [];
  actionList.forEach((actionLine, index) => {
    const cleanAction = normalizeBulletLine(actionLine).replace(/\[\[(?:action|entity|term|evidence|wiki):([^\]]+)\]\]/gi, '$1');
    if (!cleanAction) return;

    const promptTitle = buildPromptTitleFromAction(cleanAction, index);
    const dedupeKey = promptTitle.toLowerCase();
    if (seen.has(dedupeKey)) return;
    seen.add(dedupeKey);

    const tilHints = til.length ? `\nПолезные сигналы из заметки:\n- ${til.join('\n- ')}` : '';
    out.push({
      title: promptTitle,
      desc: cleanAction.slice(0, 180),
      prompt: [
        `ЗАДАЧА: используй summary по странице "${title}" и выполни следующий шаг: ${cleanAction}.`,
        '',
        'КОНТЕКСТ: опирайся на текущую страницу, уже собранную сводку и сигналы ниже. Не добавляй факты, которых нет в материале; если нужен внешний факт, пометь это как проверку.',
        tilHints ? tilHints.trim() : 'Полезные сигналы из заметки: пока нет, начни с самого действия и явно назови недостающие данные.',
        '',
        'ОГРАНИЧЕНИЯ:',
        '- Пиши по-русски, предметно, без generic management prose.',
        '- Разделяй факт, inference, гипотезу и open question.',
        '- Если результат зависит от предположения, назови предположение и способ проверки.',
        '',
        'ВЕРНИ:',
        '1. цель и почему это важно именно сейчас',
        '2. входные данные и недостающий контекст',
        '3. пошаговый план выполнения',
        '4. готовый артефакт / черновик / шаблон, который можно сразу использовать',
        '5. риски, trade-offs и failure modes',
        '6. критерий готовности и быстрый quality check',
        '',
        'КРИТЕРИЙ КАЧЕСТВА: результат должен быть полезен без дополнительной раскачки, с конкретными формулировками, проверками и следующим действием.'
      ].join('\n')
    });
  });

  return out.slice(0, 8);
}

function ensureConcretePrompts(summaryObj, options = {}) {
  if (!summaryObj || typeof summaryObj !== 'object') return [];

  const source = summaryObj.concrete_prompts || summaryObj.concretePrompts || summaryObj.next_best_prompts || [];
  const normalized = (Array.isArray(source) ? source : [])
    .map(normalizeConcretePromptEntry)
    .filter(Boolean);

  const fallback = deriveConcretePromptsFromActions(collectSummaryActions(summaryObj, 12), {
    title: options?.title || summaryObj.title,
    til: summaryObj.til || []
  });

  const combined = [...normalized, ...fallback];
  const out = [];
  const seen = new Set();
  for (const item of combined) {
    const key = String(item?.title || item?.prompt || '').trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(item);
    if (out.length >= 8) break;
  }

  summaryObj.concrete_prompts = out;
  return out;
}

function buildFallbackWorkflowSuggestions(summaryObj, title = '') {
  const sourceTitle = String(title || summaryObj?.title || document.title || 'текущая страница').trim();
  const prompts = ensureConcretePrompts(summaryObj || {}, { title: sourceTitle });
  const fromPrompts = prompts.map(item => ({
    title: item.title,
    desc: item.desc || 'Готовый следующий запрос по материалу.',
    prompt: item.prompt
  }));

  const sections = Array.isArray(summaryObj?.sections) ? orderSummarySections(summaryObj).slice(0, 5) : [];
  const fromSections = sections.map(section => {
    const label = String(section?.label || 'раздел').toLowerCase();
    return {
      title: `Углубить: ${section?.label || 'раздел'}`.slice(0, 72),
      desc: `Собрать рабочий бриф по разделу "${section?.label || label}" с фактами, рисками и действиями.`,
      prompt: [
        `Используй сводку страницы "${sourceTitle}" и углуби раздел "${section?.label || label}".`,
        'Верни: 1) суть, 2) факты, 3) спорные места, 4) что проверить, 5) следующий лучший шаг.',
        'Пиши по-русски, без воды, отделяй факт от вывода.'
      ].join('\n')
    };
  });

  const deterministic = [
    {
      title: 'План проверки',
      desc: 'Собрать короткий список проверок, источников и критериев готовности.',
      prompt: `Составь план проверки по странице "${sourceTitle}": факты, источники, вопросы, критерии готовности и порядок выполнения.`
    },
    {
      title: 'Связать с задачей',
      desc: 'Понять, как материал связан с текущим браузерным workflow.',
      prompt: `Сопоставь страницу "${sourceTitle}" с открытыми вкладками и историей последнего часа. Выдели вероятный рабочий сценарий, зависимости и следующий шаг.`
    },
    {
      title: 'Закладки и чтение',
      desc: 'Собрать, что сохранить, прочитать и использовать дальше.',
      prompt: `По странице "${sourceTitle}" предложи, что добавить в закладки, что изучить дальше, какие запросы выполнить и какие материалы найти.`
    }
  ];

  const out = [];
  const seen = new Set();
  [...fromPrompts, ...fromSections, ...deterministic].forEach(item => {
    const key = String(item.title || item.prompt || '').toLowerCase();
    if (!key || seen.has(key)) return;
    seen.add(key);
    out.push(item);
  });
  return out.slice(0, 12);
}

function buildFallbackRelatedLinks(summaryObj, title = '') {
  const sourceTitle = String(title || summaryObj?.title || document.title || '').trim();
  const terms = (Array.isArray(summaryObj?.sections) ? summaryObj.sections : [])
    .flatMap(section => Array.isArray(section?.right?.terms) ? section.right.terms : [])
    .map(term => term?.term || term?.name || '')
    .filter(Boolean)
    .slice(0, 4);
  const queries = [
    sourceTitle,
    ...terms,
    `${sourceTitle} обзор`,
    `${sourceTitle} критика`
  ].map(q => normalizeSummaryParagraph(q, 120)).filter(Boolean);

  const out = [];
  const seen = new Set();
  queries.forEach(query => {
    const key = query.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    out.push({
      title: `Найти похожее: ${query}`,
      url: `https://www.google.com/search?q=${encodeURIComponent(query)}`,
      fallback: true
    });
  });
  return out.slice(0, 4);
}

function renderConcretePromptCards(prompts) {
  const list = (Array.isArray(prompts) ? prompts : [])
    .map(normalizeConcretePromptEntry)
    .filter(Boolean)
    .slice(0, 8);

  if (!list.length) {
    return renderStateCard({
      tone: 'waiting',
      icon: '⏳',
      title: 'Готовые запросы ещё собираются',
      body: 'Сначала дочитываю ключевые sections и действия, затем соберу прикладные prompt-ы.',
      compact: true
    });
  }

  return `<div class="pzdrk-prompt-grid">${list.map((item, index) => `
    <button class="pzdrk-prompt-card" type="button" data-concrete-prompt="${escapeAttr(item.prompt)}" title="Скопировать запрос ${index + 1}">
      <div class="pzdrk-prompt-card-top">
        <span class="pzdrk-prompt-index">#${index + 1}</span>
        <span class="pzdrk-prompt-badge">готовый запрос</span>
        <span class="pzdrk-prompt-copy">клик — в буфер</span>
      </div>
      <div class="pzdrk-prompt-title">${escapeHtml(item.title)}</div>
      <div class="pzdrk-prompt-desc">${escapeHtml(item.desc || normalizeBulletLine(item.prompt).slice(0, 160))}</div>
      <div class="pzdrk-prompt-footer">
        <span class="pzdrk-prompt-mode">точечный prompt</span>
        <span class="pzdrk-prompt-arrow">↗</span>
      </div>
    </button>
  `).join('')}</div>`;
}

function renderStateCard({ tone = 'neutral', icon = '', title = '', body = '', meta = '', compact = false } = {}) {
  const safeTone = ['neutral', 'waiting', 'error', 'success', 'muted'].includes(String(tone || '').trim())
    ? String(tone || '').trim()
    : 'neutral';
  const safeIcon = String(icon || '').trim();
  const safeTitle = String(title || '').trim();
  const safeBody = String(body || '').trim();
  const safeMeta = String(meta || '').trim();

  return `
    <div class="pzdrk-state-card is-${escapeAttr(safeTone)}${compact ? ' is-compact' : ''}">
      ${(safeIcon || safeTitle) ? `
        <div class="pzdrk-state-card-head">
          ${safeIcon ? `<span class="pzdrk-state-card-icon">${escapeHtml(safeIcon)}</span>` : ''}
          ${safeTitle ? `<div class="pzdrk-state-card-title">${escapeHtml(safeTitle)}</div>` : ''}
        </div>
      ` : ''}
      ${safeBody ? `<div class="pzdrk-state-card-body">${escapeHtml(safeBody)}</div>` : ''}
      ${safeMeta ? `<div class="pzdrk-state-card-meta">${escapeHtml(safeMeta)}</div>` : ''}
    </div>
  `;
}

function renderSummarySidecard(title, bodyHtml, tone = 'neutral') {
  const safeTone = ['neutral', 'waiting', 'error', 'success', 'muted'].includes(String(tone || '').trim())
    ? String(tone || '').trim()
    : 'neutral';
  return `
    <div class="pzdrk-sidecard is-${escapeAttr(safeTone)}">
      <div class="pzdrk-section-subtitle">${escapeHtml(title || 'Комментарий')}</div>
      <div class="pzdrk-sidecard-body">${bodyHtml || ''}</div>
    </div>
  `;
}

function renderSummaryAsidePlaceholder(title, body) {
  return renderStateCard({
    tone: 'muted',
    icon: '·',
    title: title || 'Комментариев пока нет',
    body: body || 'Этот блок уже самодостаточен слева; справа дополнения появятся только если они реально нужны.',
    compact: true
  });
}

function collectSectionBulletsByKeys(summaryObj, keys = [], limit = 4) {
  const wanted = new Set((Array.isArray(keys) ? keys : []).map(key => String(key || '').trim().toLowerCase()).filter(Boolean));
  if (!wanted.size) return [];
  const sections = orderSummarySections(summaryObj);
  const out = [];
  const seen = new Set();

  sections.forEach((section) => {
    const key = String(section?.key || '').trim().toLowerCase();
    if (!wanted.has(key)) return;
    const left = Array.isArray(section?.left) ? section.left : [];
    left.forEach((item) => {
      const line = normalizeBulletLine(item);
      const normalized = line.toLowerCase();
      if (!line || seen.has(normalized)) return;
      seen.add(normalized);
      out.push(line);
    });
  });

  return out.slice(0, Math.max(1, limit));
}

function renderSceneLines(items, emptyText = 'Заполню после следующего прохода') {
  const list = (Array.isArray(items) ? items : []).map(item => normalizeBulletLine(item)).filter(Boolean).slice(0, 4);
  if (!list.length) {
    return `<div class="pzdrk-scene-empty">${escapeHtml(emptyText)}</div>`;
  }
  return `<div class="pzdrk-scene-lines">${list.map(line => `<div class="pzdrk-scene-line">${formatRichInline(line)}</div>`).join('')}</div>`;
}

function renderSummarySceneBoard(summaryObj) {
  if (!summaryObj || typeof summaryObj !== 'object') return '';
  const sections = orderSummarySections(summaryObj);
  const actions = collectSummaryActions(summaryObj, 5);
  const prompts = ensureConcretePrompts(summaryObj, { title: summaryObj.title }).slice(0, 4);
  const useCases = collectSectionBulletsByKeys(summaryObj, ['usage', 'automation'], 4);
  const risks = collectSectionBulletsByKeys(summaryObj, ['risks', 'open', 'verify'], 4);
  const boardStats = [
    { label: 'разделы', value: sections.length || 0 },
    { label: 'действия', value: actions.length || 0 },
    { label: 'запросы', value: prompts.length || 0 },
    { label: 'проверки', value: risks.length || 0 }
  ];
  const clusterCards = sections
    .filter(section => !['tldr', 'actions', 'concrete-prompts'].includes(String(section?.key || '').trim()))
    .slice(0, 4)
    .map((section) => {
      const label = String(section?.label || section?.key || 'Раздел').trim();
      const bullets = (Array.isArray(section?.left) ? section.left : []).slice(0, 2);
      return `
        <button class="pzdrk-scene-cluster-chip" type="button" data-scene-scroll="${escapeAttr(String(section?.key || '').trim())}">
          <span class="pzdrk-scene-cluster-title">${escapeHtml(label)}</span>
          <span class="pzdrk-scene-cluster-sub">${escapeHtml(normalizeBulletLine(bullets[0] || ''))}</span>
        </button>
      `;
    }).join('');

  return `
    <section class="pzdrk-scene-board" data-summary-scene>
      <div class="pzdrk-scene-board-head">
        <div>
          <div class="pzdrk-scene-board-kicker">Рабочая доска</div>
          <div class="pzdrk-scene-board-title">Сводка в работу</div>
          <div class="pzdrk-scene-board-subtitle">Карта темы, действия, запросы и проверки на первом экране.</div>
          <div class="pzdrk-scene-stat-strip">
            ${boardStats.map(item => `
              <span class="pzdrk-scene-stat">
                <strong>${escapeHtml(String(item.value))}</strong>
                <span>${escapeHtml(item.label)}</span>
              </span>
            `).join('')}
          </div>
        </div>
        <div class="pzdrk-scene-board-tools">
          <button class="pzdrk-scene-tool" type="button" data-scene-action="mindmap">Полная карта</button>
          <button class="pzdrk-scene-tool" type="button" data-scene-action="opsplan">План</button>
          <button class="pzdrk-scene-tool" type="button" data-scene-action="challenge">Следующие запросы</button>
          <button class="pzdrk-scene-tool" type="button" data-scene-action="sources">Источники</button>
        </div>
      </div>
      <div class="pzdrk-scene-grid">
        <article class="pzdrk-scene-card pzdrk-scene-card-map" data-scene-card="map">
          <div class="pzdrk-scene-card-head">
            <div class="pzdrk-scene-card-title">Карта темы</div>
            <button class="pzdrk-scene-link" type="button" data-scene-action="mindmap">Развернуть</button>
          </div>
          <div class="pzdrk-scene-card-body">
            <div class="pzdrk-scene-cluster-strip">${clusterCards || '<div class="pzdrk-scene-empty">Секции появятся после сборки сводки.</div>'}</div>
            <div class="pzdrk-scene-mini-map">
              ${renderSceneLines(collectSectionBulletsByKeys(summaryObj, ['tldr', 'core', 'mechanism'], 4), 'Сначала соберу TL;DR и механику.')}
            </div>
          </div>
        </article>
        <article class="pzdrk-scene-card" data-scene-card="actions">
          <div class="pzdrk-scene-card-head">
            <div class="pzdrk-scene-card-title">Следующие действия</div>
            <button class="pzdrk-scene-link" type="button" data-scene-action="automation">Автоматизация</button>
          </div>
          <div class="pzdrk-scene-card-body">${renderSceneLines(actions, 'После синтеза sections появятся конкретные следующие шаги.')}</div>
        </article>
        <article class="pzdrk-scene-card" data-scene-card="prompts">
          <div class="pzdrk-scene-card-head">
            <div class="pzdrk-scene-card-title">Готовые запросы</div>
            <button class="pzdrk-scene-link" type="button" data-scene-copy-prompts>Скопировать всё</button>
          </div>
          <div class="pzdrk-scene-card-body">
            <div class="pzdrk-scene-prompt-stack">
              ${prompts.length
                ? prompts.map((item, index) => `
                    <button class="pzdrk-scene-prompt-pill" type="button" data-scene-prompt="${escapeAttr(item.prompt)}" title="Скопировать запрос #${index + 1}">
                      <span class="pzdrk-scene-prompt-index">#${index + 1}</span>
                      <span class="pzdrk-scene-prompt-text">${escapeHtml(item.title)}</span>
                    </button>
                  `).join('')
                : `<div class="pzdrk-scene-empty">Пакет запросов появится после сборки action-прохода.</div>`}
            </div>
          </div>
        </article>
        <article class="pzdrk-scene-card" data-scene-card="usecases">
          <div class="pzdrk-scene-card-head">
            <div class="pzdrk-scene-card-title">Применимость и сценарии (use cases)</div>
            <button class="pzdrk-scene-link" type="button" data-scene-action="compare">Сравнить</button>
          </div>
          <div class="pzdrk-scene-card-body">${renderSceneLines(useCases.length ? useCases : risks, 'Сценарии применения и ограничения появятся после раскладки секций.')}</div>
        </article>
        <article class="pzdrk-scene-card" data-scene-card="verify">
          <div class="pzdrk-scene-card-head">
            <div class="pzdrk-scene-card-title">Что проверить дальше</div>
            <button class="pzdrk-scene-link" type="button" data-scene-action="sources">Проверки</button>
          </div>
          <div class="pzdrk-scene-card-body">${renderSceneLines(risks, 'Здесь появятся ограничения, спорные места и следующие проверки.')}</div>
        </article>
      </div>
    </section>
  `;
}

function mountSummarySceneBoard(note, summaryObj) {
  if (!note || !note.isConnected || !summaryObj || typeof summaryObj !== 'object') return;
  const summaryBody = note.querySelector('.pzdrk-summary-body');
  if (!summaryBody) return;
  const nextHtml = renderSummarySceneBoard(summaryObj);
  if (!nextHtml) return;

  const existing = summaryBody.querySelector('[data-summary-scene]');
  if (existing) existing.remove();
  summaryBody.insertAdjacentHTML('afterbegin', nextHtml);
}

function bindSummarySceneBoard(note, summaryObj) {
  if (!note || !note.isConnected) return;
  const board = note.querySelector('[data-summary-scene]');
  if (!board) return;

  board.querySelectorAll('[data-scene-prompt]').forEach((btn) => {
    if (btn.dataset.bound === 'true') return;
    btn.dataset.bound = 'true';
    btn.addEventListener('click', async (e) => {
      e.preventDefault();
      e.stopPropagation();
      try {
        await copyTextToClipboard(btn.getAttribute('data-scene-prompt') || '');
        showToast('📋 Запрос скопирован');
      } catch (error) {
        showToast('📋 ' + (error?.message || 'ошибка'));
      }
    });
  });

  const allPrompts = ensureConcretePrompts(summaryObj, { title: summaryObj?.title }).map(item => item.prompt).filter(Boolean).join('\n\n');
  const copyAll = board.querySelector('[data-scene-copy-prompts]');
  if (copyAll && copyAll.dataset.bound !== 'true') {
    copyAll.dataset.bound = 'true';
    copyAll.addEventListener('click', async (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (!allPrompts) return;
      try {
        await copyTextToClipboard(allPrompts);
        showToast('📋 Пакет запросов скопирован');
      } catch (error) {
        showToast('📋 ' + (error?.message || 'ошибка'));
      }
    });
  }

  board.querySelectorAll('[data-scene-scroll]').forEach((btn) => {
    if (btn.dataset.bound === 'true') return;
    btn.dataset.bound = 'true';
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const sec = btn.getAttribute('data-scene-scroll') || '';
      const target = note.querySelector(`.pzdrk-section[data-sec="${(globalThis.CSS?.escape ? CSS.escape(sec) : sec)}"] .pzdrk-section-title`);
      const contentEl = note.querySelector('.pzdrk-note-content');
      if (!target || !contentEl) return;
      const cRect = contentEl.getBoundingClientRect();
      const tRect = target.getBoundingClientRect();
      contentEl.scrollBy({ top: (tRect.top - cRect.top) - 26, behavior: 'smooth' });
    });
  });

  board.querySelectorAll('[data-scene-action]').forEach((btn) => {
    if (btn.dataset.bound === 'true') return;
    btn.dataset.bound = 'true';
    btn.addEventListener('click', async (e) => {
      e.preventDefault();
      e.stopPropagation();
      const actionType = btn.getAttribute('data-scene-action') || '';
      if (actionType === 'mindmap') {
        await generateMindmap(note);
        return;
      }
      const action = getDefaultActions().find(item => item.type === actionType);
      if (!action) return;
      await executeAction(action, { sourceNote: note });
    });
  });
}

function summaryJsonToMarkdown(summaryObj) {
  if (!summaryObj || typeof summaryObj !== 'object') return '';
  const out = [];
  const title = String(summaryObj.title || '').trim();
  if (title) out.push(`# ${title}`);

  const sections = orderSummarySections(summaryObj);
  for (const s of sections) {
    const head = `${String(s.emoji || '').trim()} ${String(s.label || '').trim()}`.trim();
    if (head) out.push(`\n## ${head}`);
    const left = Array.isArray(s.left) ? s.left : [];
    left.slice(0, 24).forEach(b => {
      const line = normalizeBulletLine(b);
      if (line) out.push(`- ${line}`);
    });
    const actions = Array.isArray(s.actions) ? s.actions : [];
    actions.slice(0, 6).forEach(a => {
      const line = normalizeBulletLine(a);
      if (line) out.push(`- ${line}`);
    });
  }

  const til = Array.isArray(summaryObj.til) ? summaryObj.til : [];
  if (til.length) {
    out.push(`\n## 💡 ВЫЯСНИЛОСЬ`);
    til.slice(0, 12).forEach(t => {
      const line = normalizeBulletLine(t);
      if (line) out.push(`- ${line}`);
    });
  }

  const actions = collectSummaryActions(summaryObj, 12);
  if (actions.length) {
    out.push(`\n## ⚡ ДЕЙСТВИЯ`);
    actions.slice(0, 12).forEach(a => {
      const line = String(a || '').trim();
      if (line) out.push(`- ${line}`);
    });
  }

  const prompts = ensureConcretePrompts(summaryObj, { title });
  if (prompts.length) {
    out.push(`\n## 🎯 ГОТОВЫЕ ЗАПРОСЫ`);
    prompts.slice(0, 8).forEach(p => {
      const line = `${p.title}${p.desc ? ` — ${p.desc}` : ''}`;
      if (line) out.push(`- ${line}`);
    });
  }

  return out.join('\n').trim();
}

function renderRightBlock(right) {
  const r = normalizeSummaryRightBlock(right);
  const commentary = Array.isArray(r.commentary) ? r.commentary : [];
  const terms = Array.isArray(r.terms) ? r.terms : [];
  const entities = Array.isArray(r.entities) ? r.entities : [];
  const refs = Array.isArray(r.refs) ? r.refs : [];

  let html = '';

  const inferGroup = (value, fallback = 'Без группы') => {
    const raw = String(value || '').trim();
    if (raw) return raw;
    return fallback;
  };

  const renderGroupedList = (items, groupFn, lineFn) => {
    const groups = new Map();
    items.forEach((item) => {
      const group = inferGroup(groupFn(item));
      if (!groups.has(group)) groups.set(group, []);
      groups.get(group).push(item);
    });

    return Array.from(groups.entries()).map(([group, groupItems]) => {
      const lines = groupItems.map(lineFn).filter(Boolean).join('\n');
      if (!lines) return '';
      return `### ${group}\n${lines}`;
    }).filter(Boolean).join('\n\n');
  };

  if (commentary.length) {
    html += renderSummarySidecard('Комментарий', formatRichText(commentary.join('\n\n')), 'neutral');
  }

  if (terms.length) {
    const lines = renderGroupedList(terms.slice(0, 10), t => t?.category || 'Термины и исходные названия', t => {
      const term = normalizeSummaryParagraph(t?.term, 80);
      const def = normalizeSummaryParagraph(t?.definition, 260);
      if (!term && !def) return '';
      return `- **${term || '—'}**: ${def}`;
    });
    html += renderSummarySidecard('Термины и оригинальные названия', formatRichText(lines), 'neutral');
  }

  if (entities.length) {
    const lines = renderGroupedList(entities.slice(0, 12), e => e?.category || 'Люди, организации и артефакты', e => {
      const name = normalizeSummaryParagraph(e?.name, 80);
      const ctx = normalizeSummaryParagraph(e?.context, 220);
      const q = normalizeSummaryParagraph(e?.exaQuery, 160);
      if (!name) return '';
      const tag = `[[entity:${name}]]`;
      const hint = ctx ? ` — ${ctx}` : '';
      const qHint = q ? ` *(поисковый запрос: ${q})*` : '';
      return `- ${tag}${hint}${qHint}`;
    });
    html += renderSummarySidecard('Сущности и имена', formatRichText(lines), 'neutral');
  }

  if (refs.length) {
    const lines = refs.slice(0, 10).map(rf => {
      const q = normalizeSummaryParagraph(rf?.query, 180);
      const why = normalizeSummaryParagraph(rf?.why, 180);
      if (!q) return '';
      return `${q}${why ? ` — *${why}*` : ''}`;
    }).filter(Boolean).join('\n');
    const ordered = lines
      .split('\n')
      .filter(Boolean)
      .map((line, index) => `${index + 1}. ${line}`)
      .join('\n');
    html += renderSummarySidecard('Что проверить', formatRichText(ordered), refs.length > 2 ? 'waiting' : 'neutral');
  }

  return html || renderStateCard({
    tone: 'waiting',
    icon: '⏳',
    title: 'Правая колонка ещё догружается',
    body: 'Термины, сущности и проверки появятся после добора параллельных проходов.',
    compact: true
  });
}

function renderSummaryJsonHtml(summaryObj) {
  if (!summaryObj || typeof summaryObj !== 'object') return '';
  const sections = orderSummarySections(summaryObj);
  const til = Array.isArray(summaryObj.til) ? summaryObj.til : [];
  const actions = collectSummaryActions(summaryObj, 12);
  const prompts = ensureConcretePrompts(summaryObj, { title: summaryObj.title });

  let html = '';

  for (const s of sections) {
    const key = String(s.key || '').trim() || slugifyForId(`${s.emoji || ''} ${s.label || ''}`);
    const emoji = String(s.emoji || '').trim();
    const label = String(s.label || '').trim();
    const title = `${emoji ? `${emoji} ` : ''}${label}`.trim() || 'Раздел';
    const secId = `pzdrk-sec-${slugifyForId(key)}`;

    const left = Array.isArray(s.left) ? s.left : [];
    const leftText = left.map(b => `- ${normalizeBulletLine(b)}`).filter(l => l.trim() !== '-').join('\n');
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
    const tilText = til.map(t => `- ${normalizeBulletLine(t)}`).filter(l => l.trim() !== '-').join('\n');
    html += `
      <div class="pzdrk-section" data-sec="til">
        <div class="pzdrk-section-title" id="pzdrk-sec-til">💡 ВЫЯСНИЛОСЬ</div>
        <div class="pzdrk-two-col">
          <div class="pzdrk-col-left">${formatRichText(tilText)}</div>
          <div class="pzdrk-col-right" data-sec="til">${renderSummaryAsidePlaceholder('Дополнений справа нет', 'Ключевые наблюдения уже сформулированы в основном списке.')}</div>
        </div>
      </div>
    `;
  }

  if (actions.length) {
    const actText = actions.map(a => `- ${normalizeBulletLine(a)}`).filter(l => l.trim() !== '-').join('\n');
    html += `
      <div class="pzdrk-section" data-sec="actions">
        <div class="pzdrk-section-title" id="pzdrk-sec-actions">⚡ ДЕЙСТВИЯ</div>
        <div class="pzdrk-two-col">
          <div class="pzdrk-col-left">${formatRichText(actText)}</div>
          <div class="pzdrk-col-right" data-sec="actions">${renderSummaryAsidePlaceholder('Можно выполнять как есть', 'Если нужны уточнения, они появятся здесь в виде терминов, рисков или проверок.')}</div>
        </div>
      </div>
    `;
  }

  html += `
    <div class="pzdrk-section" data-sec="concrete-prompts">
      <div class="pzdrk-section-title" id="pzdrk-sec-concrete-prompts">🎯 ГОТОВЫЕ ЗАПРОСЫ</div>
      <div class="pzdrk-section-intro">Восемь конкретных prompt-ов, которые можно сразу копировать и запускать без дополнительной раскачки.</div>
      <div class="pzdrk-concrete-prompts" data-concrete-prompts>
        ${renderConcretePromptCards(prompts)}
      </div>
    </div>
  `;

  return html;
}

function bindConcretePromptCards(container) {
  if (!container) return;
  container.querySelectorAll('.pzdrk-prompt-card').forEach(card => {
    if (card.dataset.bound === 'true') return;
    card.dataset.bound = 'true';

    card.addEventListener('click', async (e) => {
      e.preventDefault();
      e.stopPropagation();
      const prompt = card.getAttribute('data-concrete-prompt') || '';
      if (!prompt) return;
      try {
        await copyTextToClipboard(prompt);
        showToast('📋 Запрос скопирован');
      } catch (err) {
        showToast('📋 Запрос: ' + (err?.message || 'ошибка'));
      }
    });
  });
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

  const system = String(settings?.sectionEnrichPrompt || getPromptOverride('sectionEnrich', settings) || '').trim();
  const url = window.location.href;
  const title = document.title;
  const pageSnippet = clipPromptInput(pageContent, SECTION_ENRICH_INPUT_CHARS);

  await runWithConcurrency(sections, getAdaptiveParallelLimit(settings, Math.min(64, sections.length), 64), async (s, i) => {
    if (!note.isConnected) return;

    const key = String(s?.key || '').trim() || slugifyForId(`${s?.emoji || ''} ${s?.label || ''}`);
    const label = `${String(s?.emoji || '').trim()} ${String(s?.label || '').trim()}`.trim();
    const left = Array.isArray(s?.left) ? s.left : [];

    const userPrompt = `URL: ${url}\nTITLE: ${title}\n\n[BROWSER CONTEXT]\n${contextText}\n\n[SECTION]\nkey=${key}\nlabel=${label}\n\n[LEFT BULLETS]\n${left.map(x => `- ${String(x || '').trim()}`).join('\n')}\n\n[PAGE SNIPPET]\n${pageSnippet}`;

    const raw = await callGroq(userPrompt, system, { temperature: 0.35, max_tokens: getTaskMaxTokens(settings, 1200) });
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

    const voicePrompt = getPromptOverride('voiceScript', settings)
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
  return extractTextCandidate(s)
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
  const tldr = bullets.slice(0, 4);
  const core = bullets.slice(0, 8);
  const mechanics = bullets.slice(8, 18);
  const implications = bullets.slice(18, 28);
  const usage = bullets.slice(28, 38);
  const details = bullets.slice(38, 70);
  const automation = Array.isArray(merged.actions) ? merged.actions.slice(0, 8) : [];
  const risks = Array.isArray(merged.risks) ? merged.risks.slice(0, 16) : [];

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
  const verify = [
    ...entities.slice(0, 4).map(e => normalizeBulletLine(`Проверить [[entity:${e.name}]]${e.context ? ` — ${e.context}` : ''}`)),
    ...terms.slice(0, 4).map(t => normalizeBulletLine(`Уточнить [[term:${t.term}]]${t.definition ? ` — ${t.definition}` : ''}`)),
    ...risks.slice(0, 4).map(item => normalizeBulletLine(`Проверить спорное место: ${item}`))
  ].filter(Boolean).slice(0, 10);

  return {
    title,
    meta: ranking,
    sections: [
      {
        key: 'tldr',
        emoji: '✳️',
        label: 'TL;DR',
        left: tldr.length ? tldr : core.slice(0, 4),
        right: { commentary: [], terms: [], entities: [], refs: [] }
      },
      {
        key: 'core',
        emoji: '📌',
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
        key: 'mechanics',
        emoji: '⚙️',
        label: 'МЕХАНИЗМЫ',
        left: mechanics.length ? mechanics : core,
        right: { commentary: [], terms: terms.slice(8, 14), entities: entities.slice(8, 14), refs: [] }
      },
      {
        key: 'implications',
        emoji: '🧩',
        label: 'ЗАЧЕМ ЭТО ВАЖНО',
        left: implications.length ? implications : mechanics.length ? mechanics.slice(0, 8) : core,
        right: { commentary: [], terms: terms.slice(14, 18), entities: entities.slice(14, 18), refs: [] }
      },
      {
        key: 'usage',
        emoji: '🛠',
        label: 'ПРИМЕНЕНИЕ',
        left: usage.length ? usage : implications.length ? implications.slice(0, 8) : core,
        right: { commentary: [], terms: [], entities: [], refs: [] }
      },
      {
        key: 'automation',
        emoji: '🤖',
        label: 'АВТОМАТИЗАЦИИ',
        left: automation.length ? automation : usage.length ? usage.slice(0, 6) : core.slice(0, 6),
        right: { commentary: [], terms: [], entities: [], refs: [] }
      },
      {
        key: 'open',
        emoji: '❓',
        label: 'ОТКРЫТЫЕ ВОПРОСЫ',
        left: risks,
        right: { commentary: [], terms: [], entities: [], refs: [] }
      },
      {
        key: 'verify',
        emoji: '🧪',
        label: 'ЧТО ПРОВЕРИТЬ ДАЛЬШЕ',
        left: verify.length ? verify : risks.slice(0, 8),
        right: { commentary: [], terms: [], entities: [], refs: [] }
      },
      {
        key: 'risks',
        emoji: '⚠️',
        label: 'РИСКИ / НЕЯСНОСТИ',
        left: risks,
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
    actions: (merged.actions || []).slice(0, 14),
    concrete_prompts: []
  };
}

async function summarizeMapReduce({ note, pageContent, headings, contextText, settings, ranking, cleanTitle }) {
  const contentEl = note?.querySelector?.('.pzdrk-note-content');
  if (!note || !note.isConnected || !contentEl) throw new Error('Note missing');

  const maxOut = getTaskMaxTokens(settings, 1100, 256);
  const limit = getAdaptiveParallelLimit(settings, 64, 64);
  const tilPromise = generateTILList(pageContent, contextText).catch(() => []);

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
          <div style="opacity:0.75">Chunks: ${done}/${total} (${pct}%) • Lanes: ${limit} • Target out: ${maxOut}</div>
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
    summaryJson.til = await tilPromise;
  } catch (e) {
    summaryJson.til = [];
  }

  return summaryJson;
}

async function summarizePage() {
  if (isProcessing) return;
  isProcessing = true;

  const settings = await getSettings();
  const pageContent = extractPageContent({ maxChars: settings.mapReduceEnabled ? 250_000 : 24_000 });
  const headings = extractHeadings();
  const shouldMapReduce = settings.mapReduceEnabled !== false && estimateTokens(pageContent) > MAP_REDUCE_THRESHOLD_TOKENS;
  const titleSeed = clipPromptInput(pageContent, 1200);
  const rankingSeed = clipPromptInput(pageContent, 2200);
  const directSummaryContent = clipPromptInput(pageContent, DIRECT_SUMMARY_INPUT_CHARS);

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
	    if (cachedJson) mountSummarySceneBoard(note, cachedJson);
	    buildNoteNav(note);
	    setupHoverInteractions(note);
	    bindConcretePromptCards(note);
	    bindSummarySceneBoard(note, cachedJson);
	    createFloatingHints(note);
	    scheduleWorkspaceTabPrefetch(note);
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
    const titlePromise = callGroq(
      getPromptOverride('generateTitle', settings).replace('{content}', titleSeed),
      'Только заголовок',
      { temperature: 0.2, max_tokens: getTaskMaxTokens(settings, 96) }
    );
    const rankingPromise = callGroq(
      getPromptOverride('pageRanking', settings).replace('{content}', rankingSeed),
      'Только JSON',
      { temperature: 0.15, max_tokens: getTaskMaxTokens(settings, 220) }
    );

    // Non-blocking (fill later)
    const searchPromise = callExa(document.title).catch(() => []);
    const workflowsPromise = (async () => {
      try {
        const wfResult = await callGroq(
          getPromptOverride('workflowSuggestions', settings).replace('{content}', rankingSeed),
          'Только JSON',
          { temperature: 0.2, max_tokens: getTaskMaxTokens(settings, 1100, 256) }
        );
        const m = wfResult.match(/\[[\s\S]*\]/);
        return m ? JSON.parse(m[0]) : [];
      } catch (e) {
        return [];
      }
    })();

    const [ctx, titleResult, rankingResult] = await Promise.all([ctxPromise, titlePromise, rankingPromise]);

    browserContext = ctx;
    const contextText = formatBrowserContext(ctx);
    const tilPromise = generateTILList(pageContent, contextText).catch(() => []);

    // Parse ranking
    let ranking = { depth: 3, domain: 'Other', tags: [] };
    try { const m = rankingResult.match(/\{[\s\S]*\}/); if (m) ranking = JSON.parse(m[0]); } catch (e) { }

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
        const summaryPrompt = (settings.summaryJsonPrompt || getPromptOverride('summaryJson', settings))
          .replace('{tags}', settings.tags.join(' '))
          .replace('{browserContext}', contextText);

        const raw = await callGroq(
          `URL: ${window.location.href}\nЗаголовок: ${document.title}\n\nКонтент:\n${directSummaryContent}`,
          summaryPrompt,
          { temperature: 0.25, max_tokens: getTaskMaxTokens(settings, 2200, 256) }
        );

        summaryJson = parseJsonObject(raw);

        if (summaryJson && typeof summaryJson === 'object') {
          if (!Array.isArray(summaryJson.sections)) summaryJson.sections = [];
          if (!Array.isArray(summaryJson.til) || summaryJson.til.length < 4) {
            summaryJson.til = await tilPromise.catch(() => summaryJson.til || []);
          }
          ensureConcretePrompts(summaryJson, { title: cleanTitle || document.title });
        }

        // Hard fallback to markdown if JSON parse fails
        if (!summaryJson) {
          const fallbackPrompt = (settings.summaryPrompt || getPromptOverride('summary', settings))
            .replace('{tags}', settings.tags.join(' '))
            .replace('{browserContext}', contextText);
          summaryResult = await callGroq(
            `URL: ${window.location.href}\nЗаголовок: ${document.title}\n\nКонтент:\n${directSummaryContent}`,
            fallbackPrompt,
            { temperature: 0.3, max_tokens: getTaskMaxTokens(settings, 1800, 256) }
          );
          summaryResult = await ensureTILBullets(summaryResult, pageContent, contextText).catch(() => summaryResult);
        }
      }
    } else {
      if (shouldMapReduce) {
        const tmpJson = await summarizeMapReduce({ note, pageContent, headings, contextText, settings, ranking, cleanTitle });
        summaryResult = summaryJsonToMarkdown(tmpJson);
      } else {
        const summaryPrompt = (settings.summaryPrompt || getPromptOverride('summary', settings))
          .replace('{tags}', settings.tags.join(' '))
          .replace('{browserContext}', contextText);

        summaryResult = await callGroq(
          `URL: ${window.location.href}\nЗаголовок: ${document.title}\n\nКонтент:\n${directSummaryContent}`,
          summaryPrompt,
          { temperature: 0.3, max_tokens: getTaskMaxTokens(settings, 1800, 256) }
        );

        summaryResult = await ensureTILBullets(summaryResult, pageContent, contextText).catch(() => summaryResult);
      }
    }

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
      ensureConcretePrompts(summaryJson, { title: cleanTitle || document.title });
      html += `<div class="pzdrk-summary-body">${renderSummaryJsonHtml(summaryJson)}</div>`;
    } else {
      html += `<div class="pzdrk-summary-body">${formatRichText(summaryResult)}</div>`;
    }
    // Related placeholder (filled later)
    const relatedId = `pzdrk-related-${note.dataset.noteId || Date.now()}`;
    html += `<div class="pzdrk-related-section" id="${relatedId}"><div class="pzdrk-section-title">🔗 Похожее & Next Steps</div>${renderStateCard({ tone: 'waiting', icon: '⏳', title: 'Подтягиваю похожие сценарии', body: 'Параллельные lanes собирают workflow-плитки и дополнительные next steps.', compact: true })}</div>`;

    setNoteTabContent(note, 'main', html, {
      title: 'Главная',
      label: cleanTitle || document.title || 'Сводка',
      group: 'core',
      kind: 'main',
      cmdId: 'summarize',
      status: 'ready'
    }, { activate: true });
    note.classList.remove('loading');

    buildNoteNav(note);
    setupHoverInteractions(note);
    bindConcretePromptCards(note);
    if (summaryJson) {
      mountSummarySceneBoard(note, summaryJson);
      bindSummarySceneBoard(note, summaryJson);
    }

    // Cache
    if (summaryJson) setCache(window.location.href, summaryJson, 'json');
    else setCache(window.location.href, summaryResult, 'markdown');

    // Right-side actions (icon + text) anchored to this note
    createFloatingHints(note);

    // Store data for mindmap/challenge (searchResults filled later)
    lastSummaryData = { content: lastSummaryContent, headings, searchResults: [], ranking, pageContent, summaryJson };

    // Build command tabs as part of the workspace instead of opening separate flyouts.
    scheduleWorkspaceTabPrefetch(note);

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
        .catch(() => { });
    }

    // Fill related/workflows progressively so one slow lane does not block the other.
    const relatedState = {
      searchResults: [],
      workflowSuggestions: [],
      searchDone: false,
      workflowsDone: false
    };

    const renderRelatedSection = () => {
      try {
        if (!note.isConnected) return;
        const esc = (globalThis.CSS?.escape ? CSS.escape(relatedId) : relatedId);
        const relatedEl = note.querySelector(`#${esc}`);
        if (!relatedEl) return;

        const fallbackLinks = buildFallbackRelatedLinks(summaryJson, cleanTitle || document.title);
        const fallbackWorkflows = buildFallbackWorkflowSuggestions(summaryJson || {}, cleanTitle || document.title);
        const sr = (Array.isArray(relatedState.searchResults) && relatedState.searchResults.length)
          ? relatedState.searchResults
          : fallbackLinks;
        const wf = (Array.isArray(relatedState.workflowSuggestions) && relatedState.workflowSuggestions.length)
          ? relatedState.workflowSuggestions
          : fallbackWorkflows;

        if (lastSummaryData) lastSummaryData.searchResults = sr;

        let relHtml = `<div class="pzdrk-section-title">🔗 Похожее и следующие шаги</div>`;

        if (sr.length) {
          sr.slice(0, 4).forEach(r => {
            relHtml += `<a href="${escapeAttr(r.url)}" target="_blank" class="pzdrk-related-link">${escapeHtml(r.title || r.url)}</a>`;
          });
        }

        if (summaryJson && wf.length) {
          const normalizedPrompts = wf
            .map(normalizeConcretePromptEntry)
            .filter(Boolean)
            .slice(0, 8);
          if (normalizedPrompts.length) {
            summaryJson.concrete_prompts = normalizedPrompts;
            const promptEl = note.querySelector('[data-concrete-prompts]');
            if (promptEl) {
              promptEl.innerHTML = renderConcretePromptCards(summaryJson.concrete_prompts);
            }
          }
        }

        if (wf.length) {
          relHtml += `<div class="pzdrk-related-grid">`;
          wf.slice(0, 12).forEach(w => {
            relHtml += `
              <div class="pzdrk-workflow-tile" data-prompt="${escapeAttr(w.prompt || '')}">
                <div class="pzdrk-workflow-title">${escapeHtml(w.title || 'Сценарий')}</div>
                <div class="pzdrk-workflow-desc">${escapeHtml(w.desc || '')}</div>
              </div>
            `;
          });
          relHtml += `</div>`;
        }

        if (!sr.length && !wf.length) {
          relHtml += renderStateCard({ tone: 'waiting', icon: '...', title: 'Собираю следующий слой', body: 'Если поиск ничего не вернёт, останется локальный набор следующих действий по текущей сводке.', compact: true });
        }

        relatedEl.innerHTML = relHtml;
        bindConcretePromptCards(note);

        relatedEl.querySelectorAll('.pzdrk-workflow-tile').forEach(tile => {
          tile.addEventListener('click', async () => {
            const prompt = tile.dataset.prompt;
            const tabId = `workflow-${Date.now()}-${Math.random().toString(16).slice(2, 6)}`;
            setNoteTabContent(note, tabId, renderStateCard({ tone: 'waiting', icon: '...', title: 'Запускаю сценарий', body: 'Результат появится как новая вкладка внутри этой карточки.', compact: true }), {
              title: tile.querySelector('.pzdrk-workflow-title')?.textContent || 'Сценарий',
              group: 'Сценарий',
              kind: 'answer',
              status: 'loading'
            }, { activate: true });
            try {
              const res = await callGroq(prompt, STYLE_RULES, { temperature: 0.3, max_tokens: getTaskMaxTokens(settings, 1800, 256) });
              setNoteTabContent(note, tabId, formatRichText(res), {
                title: tile.querySelector('.pzdrk-workflow-title')?.textContent || 'Сценарий',
                group: 'Сценарий',
                kind: 'answer',
                status: 'ready'
              }, { activate: true });
            } catch (e) {
              setNoteTabContent(note, tabId, `<div class="pzdrk-error">Ошибка сценария: ${escapeHtml(e.message)}</div>`, {
                title: 'Ошибка сценария',
                group: 'Сценарий',
                kind: 'answer',
                status: 'error'
              }, { activate: true });
            }
            renderFloatingHints(note);
          });
        });

        if (summaryJson) setCache(window.location.href, summaryJson, 'json');
        setupHoverInteractions(note);
      } catch (e) {
        // ignore
      }
    };

    searchPromise
      .then((searchResults) => {
        relatedState.searchResults = Array.isArray(searchResults) ? searchResults : [];
        relatedState.searchDone = true;
        renderRelatedSection();
      })
      .catch(() => {
        relatedState.searchDone = true;
        renderRelatedSection();
      });

    workflowsPromise
      .then((workflowSuggestions) => {
        relatedState.workflowSuggestions = Array.isArray(workflowSuggestions) ? workflowSuggestions : [];
        relatedState.workflowsDone = true;
        renderRelatedSection();
      })
      .catch(() => {
        relatedState.workflowsDone = true;
        renderRelatedSection();
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

const COMMAND_GROUP_LABELS = {
  core: 'База',
  analysis: 'Анализ',
  structure: 'Структура',
  ops: 'Операции',
  publish: 'Публикация',
  build: 'Сборка',
  selection: 'Выделение',
  custom: 'Свои'
};

function getCommandGroup(cmd) {
  if (!cmd || typeof cmd !== 'object') return 'custom';
  if (cmd.scope === 'selection') return 'selection';
  return String(cmd.group || 'analysis').trim() || 'analysis';
}

function getCommandGroupLabel(group) {
  return COMMAND_GROUP_LABELS[String(group || '').trim()] || 'Действия';
}

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

function extractSourceNoteContext(sourceNote = null) {
  if (!sourceNote || !sourceNote.isConnected) return null;
  const title = String(sourceNote.querySelector('.pzdrk-note-title')?.textContent || '').trim();
  const activePane = getActiveNotePane(sourceNote);
  const rawText = String(activePane?.innerText || sourceNote.querySelector('.pzdrk-note-content')?.innerText || '').trim();
  const excerpt = clipPromptInput(rawText, Math.max(900, Math.min(COMMAND_CONTEXT_INPUT_CHARS - 500, 3200)));
  if (!title && !excerpt) return null;
  return {
    title,
    excerpt,
    summary: clipPromptInput(excerpt || title, 1800)
  };
}

function getCommandContext(sourceNote = null) {
  const ctxText = formatBrowserContext(browserContext);
  const pageSummary = (lastSummaryContent || '').substring(0, 4000);
  const pageContent = clipPromptInput(lastSummaryData?.pageContent || extractPageContent(), COMMAND_CONTEXT_INPUT_CHARS);
  const selection = getSelectionText();
  const noteCtx = extractSourceNoteContext(sourceNote);
  const summary = noteCtx
    ? clipPromptInput(
      `ФОКУС-КАРТОЧКА: ${noteCtx.title || 'текущий результат'}\n${noteCtx.summary || '—'}\n\nСВОДКА СТРАНИЦЫ:\n${pageSummary || '—'}`,
      4000
    )
    : pageSummary;
  const content = noteCtx
    ? clipPromptInput(
      `ФОКУС-КАРТОЧКА: ${noteCtx.title || 'текущий результат'}\n${noteCtx.excerpt || '—'}\n\nКОНТЕНТ СТРАНИЦЫ:\n${pageContent || '—'}`,
      COMMAND_CONTEXT_INPUT_CHARS
    )
    : pageContent;
  const browserContextText = noteCtx
    ? `${ctxText}\nFOCUSED_CARD: ${noteCtx.title || 'текущая карточка'}`
    : ctxText;

  return {
    url: window.location.href,
    title: document.title,
    summary,
    content,
    browserContext: browserContextText,
    selection,
    noteTitle: noteCtx?.title || '',
    noteExcerpt: noteCtx?.excerpt || ''
  };
}

function renderTemplate(tpl, ctx) {
  return String(tpl || '')
    .replaceAll('{url}', ctx.url)
    .replaceAll('{title}', ctx.title)
    .replaceAll('{summary}', ctx.summary)
    .replaceAll('{content}', ctx.content)
    .replaceAll('{browserContext}', ctx.browserContext)
    .replaceAll('{noteTitle}', ctx.noteTitle || '')
    .replaceAll('{noteExcerpt}', ctx.noteExcerpt || '')
    .replaceAll('{selection}', ctx.selection || '');
}

function getBuiltinCommands() {
  const actionByType = (type) => getDefaultActions().find(a => a.type === type);
  const buildPromptCommand = (type) => {
    const action = actionByType(type);
    if (!action) return null;
    return {
      id: type,
      title: action.title,
      icon: action.icon,
      key: String(action.key || '').toLowerCase(),
      hint: action.hint || '',
      group: action.group || 'analysis',
      scope: 'page',
      pinned: action.pinned !== false,
      kind: 'builtin',
      run: (options = {}) => executeAction(action, options)
    };
  };

  return [
    // Not pinned in rail (they have dedicated top buttons), but available in palette.
    { id: 'palette', title: 'Палитра команд', icon: '⌘', key: '', scope: 'global', pinned: false, kind: 'builtin', run: () => openCommandPalette('') },
    { id: 'new_command', title: 'Добавить команду', icon: '➕', key: '', scope: 'global', pinned: false, kind: 'builtin', run: () => openCommandPalette('/new ') },

    { id: 'summarize', title: 'Сводка', icon: '✦', key: 's', hint: 'Быстрая многослойная выжимка', group: 'core', scope: 'page', pinned: true, kind: 'builtin', run: () => summarizePage() },
    { id: 'translate_page', title: 'Перевести страницу', icon: '🌐', key: 't', hint: 'Перевести страницу целиком', group: 'core', scope: 'page', pinned: true, kind: 'builtin', run: () => translatePage() },
    { id: 'mindmap', title: 'Карта', icon: '🗺', key: 'm', hint: 'Структурное дерево темы и экспорт', group: 'core', scope: 'page', pinned: true, kind: 'builtin', run: (options = {}) => generateMindmap(options.sourceNote || null) },

    buildPromptCommand('twitter'),
    buildPromptCommand('deepdive'),
    buildPromptCommand('automation'),
    buildPromptCommand('learning'),
    buildPromptCommand('share'),
    buildPromptCommand('challenge'),
    buildPromptCommand('timeline'),
    buildPromptCommand('extract'),
    buildPromptCommand('briefing'),
    buildPromptCommand('matrix'),
    buildPromptCommand('sources'),
    buildPromptCommand('opsplan'),
    buildPromptCommand('faq'),
    buildPromptCommand('compare'),
    buildPromptCommand('localization'),
    buildPromptCommand('frontendBuilder'),
    buildPromptCommand('renderHost'),

    { id: 'explain_selection', title: 'Объяснить выделение', icon: '🧠', key: 'e', hint: 'Пояснить выделенный фрагмент', group: 'selection', scope: 'selection', pinned: true, kind: 'builtin', run: () => explainSelection() },
    { id: 'translate_selection', title: 'Перевести выделение', icon: '🈂', key: 'r', hint: 'Перевести выделенный фрагмент', group: 'selection', scope: 'selection', pinned: true, kind: 'builtin', run: () => translateSelection() }
  ].filter(Boolean);
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
      group: c.group || 'custom',
      mode: c.mode || 'note'
    }))
  );

  renderFloatingHints();
  if (lastSummaryData?.content) {
    getActionEnabledNotes().forEach(note => scheduleWorkspaceTabPrefetch(note));
  }
  if (isCommandPaletteOpen()) renderCommandPaletteList();
}

function ensureCommandRail() {
  if (commandRailEl?.isConnected) return commandRailEl;
  const el = document.createElement('div');
  el.className = 'pzdrk-command-rail';
  el.innerHTML = `
    <div class="pzdrk-rail-top">
      <div class="pzdrk-rail-status" data-rail-status title="Активный режим команд">стр.</div>
      <div class="pzdrk-rail-top-buttons">
        <button class="pzdrk-rail-btn pzdrk-rail-btn-palette" type="button" title="Палитра команд (⌘/Ctrl+K)">⌘</button>
        <button class="pzdrk-rail-btn pzdrk-rail-btn-new" type="button" title="Добавить команду (/new …)">➕</button>
      </div>
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
  const statusEl = el.querySelector('[data-rail-status]');
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

  el.dataset.scope = hasSel ? 'selection' : 'page';
  if (statusEl) {
    statusEl.textContent = hasSel ? 'выд.' : 'стр.';
    statusEl.title = hasSel
      ? `Активен режим выделения • команд: ${finalList.length}`
      : `Активен режим страницы • команд: ${finalList.length}`;
  }

  listEl.innerHTML = '';
  finalList.forEach(cmd => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `pzdrk-rail-btn pzdrk-rail-cmd ${cmd.scope === 'selection' ? 'is-selection' : ''}`;
    btn.dataset.group = getCommandGroup(cmd);
    const key = (cmd.key || '').toString().toUpperCase();
    btn.innerHTML = `
      <span class="pzdrk-rail-icon">${escapeHtml(cmd.icon || '⚡')}</span>
      ${key ? `<span class="pzdrk-rail-key">${escapeHtml(key)}</span>` : ''}
    `;
    btn.title = `${cmd.title || cmd.id}${cmd.hint ? ` — ${cmd.hint}` : ''}${key ? ` (${key})` : ''}`;
    btn.addEventListener('click', async (e) => {
      e.preventDefault();
      e.stopPropagation();
      await runCommand(cmd);
    });
    listEl.appendChild(btn);
  });
}

async function runCommand(cmd, options = {}) {
  if (!cmd) return;
  try {
    if (cmd.kind === 'builtin') {
      await cmd.run?.(options);
      return;
    }
    if (cmd.kind === 'custom') {
      await runCustomCommand(cmd, options);
    }
  } catch (e) {
    showToast('Command: ' + (e?.message || 'ошибка'));
  }
}

async function runCustomCommand(cmd, options = {}) {
  const ctx = getCommandContext(options?.sourceNote || null);
  if ((cmd.scope || 'page') === 'selection' && !ctx.selection) {
    showToast('Нужно выделение');
    return;
  }

  const prompt = renderTemplate(cmd.prompt, ctx);
  const system = (cmd.system && String(cmd.system).trim()) ? String(cmd.system) : STYLE_RULES;
  const settings = runtimeSettings || await getSettings().catch(() => null);
  const maxTokens = getTaskMaxTokens(settings, 1800, 256);

  if ((cmd.mode || 'note') === 'clipboard') {
    const out = await callGroq(prompt, system, { temperature: 0.35, max_tokens: maxTokens });
    await copyTextToClipboard(String(out || '').trim());
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
  note.dataset.actionsEnabled = 'true';
  if (options?.sourceNote?.dataset?.noteId) note.dataset.sourceNoteId = options.sourceNote.dataset.noteId;
  if (targetNote) {
    const titleEl = note.querySelector('.pzdrk-note-title');
    if (titleEl) titleEl.textContent = cmd.title || 'Command';
    const contentEl = note.querySelector('.pzdrk-note-content');
    if (contentEl && !contentEl.innerHTML.trim()) {
      contentEl.innerHTML = '<div class="pzdrk-loading"><div class="pzdrk-spinner"></div></div>';
    }
    note.classList.add('loading');
  }

  const out = await callGroq(prompt, system, { temperature: 0.35, max_tokens: maxTokens });
  if (!note.isConnected) return;
  note.querySelector('.pzdrk-note-content').innerHTML = formatRichText(out || '—');
  note.classList.remove('loading');
  setupHoverInteractions(note);
  createFloatingHints(note);
  positionActionFlyout();
}

function parseJsonObject(text) {
  if (!text) return null;
  const source = String(text || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
  try {
    return JSON.parse(source);
  } catch (e) {
    // try to extract {...}
    try {
      const m = source.match(/\{[\s\S]*\}/);
      if (!m) return null;
      return JSON.parse(m[0]);
    } catch (e2) {
      return null;
    }
  }
}

function parseJsonArray(text) {
  if (!text) return null;
  const source = String(text || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
  try {
    const parsed = JSON.parse(source);
    if (Array.isArray(parsed)) return parsed;
    if (parsed && typeof parsed === 'object') return extractMindmapNodeList(parsed);
    return null;
  } catch (e) {
    try {
      const m = source.match(/\[[\s\S]*\]/);
      if (!m) return null;
      const parsed = JSON.parse(m[0]);
      return Array.isArray(parsed) ? parsed : null;
    } catch (e2) {
      const obj = parseJsonObject(source);
      if (obj && typeof obj === 'object') return extractMindmapNodeList(obj);
      return null;
    }
  }
}

function extractMindmapNodeList(raw) {
  if (Array.isArray(raw)) return raw;
  if (!raw || typeof raw !== 'object') return null;

  for (const key of ['children', 'nodes', 'items', 'branches', 'clusters', 'topics', 'groups']) {
    if (Array.isArray(raw[key])) return raw[key];
  }

  for (const key of ['mindmap', 'data', 'result']) {
    if (raw[key] && typeof raw[key] === 'object') {
      const nested = extractMindmapNodeList(raw[key]);
      if (Array.isArray(nested) && nested.length) return nested;
    }
  }

  return null;
}

function unwrapMindmapObject(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;

  for (const key of ['mindmap', 'data', 'result']) {
    if (raw[key] && typeof raw[key] === 'object' && !Array.isArray(raw[key])) {
      const nested = unwrapMindmapObject(raw[key]) || raw[key];
      const nestedNodes = extractMindmapNodeList(nested);
      if (Array.isArray(nestedNodes) && nestedNodes.length) {
        return {
          ...nested,
          title: nested.title || nested.label || raw.title || raw.label,
          metadata: {
            ...((raw.metadata && typeof raw.metadata === 'object') ? raw.metadata : {}),
            ...((nested.metadata && typeof nested.metadata === 'object') ? nested.metadata : {})
          }
        };
      }
    }
  }

  return raw;
}

function normalizeStringList(list, limit = 4, maxLen = 140) {
  const source = Array.isArray(list)
    ? list
    : (typeof list === 'string'
      ? String(list).split(/\r?\n+/)
      : ((list && typeof list === 'object') ? Object.values(list) : []));

  return source
    .map(item => extractTextCandidate(item))
    .map(item => /^\[object Object\]$/i.test(String(item || '').trim()) ? '' : item)
    .map(item => String(item || '').replace(/^[-•▪◦]\s+/, '').trim().replace(/\s+/g, ' ').slice(0, maxLen))
    .filter(Boolean)
    .slice(0, limit);
}

function normalizeMindmapKind(value, depth = 0) {
  const raw = String(value || '').trim().toLowerCase();
  if (!raw) return depth === 0 ? 'cluster' : 'branch';
  if (/(cluster|group|pillar|theme|domain)/.test(raw)) return 'cluster';
  if (/(mechanism|architecture|system|component|pipeline)/.test(raw)) return 'mechanism';
  if (/(actor|person|team|role)/.test(raw)) return 'actor';
  if (/(tool|library|framework|sdk|platform)/.test(raw)) return 'tool';
  if (/(artifact|example|sample|repo|document|output)/.test(raw)) return 'artifact';
  if (/(evidence|signal|benchmark|metric|proof)/.test(raw)) return 'evidence';
  if (/(risk|constraint|pitfall|failure|caveat)/.test(raw)) return 'risk';
  if (/(question|unknown|gap|ambiguity)/.test(raw)) return 'question';
  if (/(workflow|process|playbook|sequence|timeline)/.test(raw)) return 'workflow';
  if (/(integration|bridge|interface|interop)/.test(raw)) return 'integration';
  return depth === 0 ? 'cluster' : raw.replace(/[^\w-]+/g, '').slice(0, 24) || 'branch';
}

function normalizeMindmapGroup(value, fallback = '') {
  return extractTextCandidate(value)
    .replace(/^[-•▪◦]\s+/, '')
    .trim()
    .replace(/\s+/g, ' ')
    .slice(0, 72) || String(fallback || '').trim().slice(0, 72);
}

function mindmapKindLabel(kind, depth = 0) {
  const normalized = normalizeMindmapKind(kind, depth);
  switch (normalized) {
    case 'cluster': return 'кластер';
    case 'mechanism': return 'механизм';
    case 'actor': return 'акторы';
    case 'tool': return 'инструмент';
    case 'artifact': return 'артефакт';
    case 'evidence': return 'сигнал';
    case 'risk': return 'риск';
    case 'question': return 'вопрос';
    case 'workflow': return 'сценарий';
    case 'integration': return 'интеграция';
    default: return depth === 0 ? 'кластер' : 'ветка';
  }
}

const MINDMAP_TREE_MAX_DEPTH = 5;

function normalizeMindmapNodes(list, prefix = 'node_', depth = 0, maxDepth = MINDMAP_TREE_MAX_DEPTH, inheritedGroup = '') {
  const out = [];
  const seen = new Set();

  for (const [index, raw] of (Array.isArray(list) ? list : []).entries()) {
    const rawObject = (raw && typeof raw === 'object') ? raw : null;
    const label = String(rawObject ? (rawObject.label || rawObject.title || rawObject.name || rawObject.text || '') : raw || '')
      .trim()
      .replace(/\s+/g, ' ')
      .replace(/^[-•▪◦]\s+/, '')
      .slice(0, 96);
    if (!label) continue;

    const dedupeKey = `${depth}:${label.toLowerCase()}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);

    const baseId = String(rawObject?.id || '').trim() || slugifyForId(label) || `${prefix}${index + 1}`;
    const description = extractTextCandidate(rawObject?.description || rawObject?.summary || rawObject?.context)
      .replace(/^[-•▪◦]\s+/, '')
      .trim()
      .replace(/\s+/g, ' ')
      .slice(0, 280);
    const kind = normalizeMindmapKind(rawObject?.kind || rawObject?.type || rawObject?.category, depth);
    const group = normalizeMindmapGroup(rawObject?.group || rawObject?.cluster || rawObject?.bucket, depth === 0 ? label : inheritedGroup);
    const childSource = extractMindmapNodeList(rawObject);
    const children = depth >= maxDepth ? [] : normalizeMindmapNodes(childSource, `${baseId}_`, depth + 1, maxDepth, group || inheritedGroup);

    out.push({
      id: baseId.slice(0, 64),
      label,
      kind,
      group,
      description,
      insights: normalizeStringList(rawObject?.insights || rawObject?.tips || rawObject?.notes || rawObject?.takeaways, 4, 140),
      evidence: normalizeStringList(rawObject?.evidence || rawObject?.signals || rawObject?.examples || rawObject?.proofs, 4, 140),
      questions: normalizeStringList(rawObject?.questions || rawObject?.unknowns || rawObject?.gaps || rawObject?.risks, 4, 140),
      children
    });
  }

  return out;
}

function mergeMindmapChildren(existing, incoming, options = {}) {
  const prefix = String(options?.prefix || 'node_');
  const depth = Math.max(0, Number(options?.depth) || 1);
  const maxDepth = Number.isFinite(Number(options?.maxDepth)) ? Number(options.maxDepth) : MINDMAP_TREE_MAX_DEPTH;
  const inheritedGroup = normalizeMindmapGroup(options?.inheritedGroup || '', '');
  const merged = normalizeMindmapNodes(
    [...(Array.isArray(existing) ? existing : []), ...(Array.isArray(incoming) ? incoming : [])],
    prefix,
    depth,
    maxDepth,
    inheritedGroup
  );
  return merged;
}

function countMindmapLeaves(nodes) {
  return (Array.isArray(nodes) ? nodes : []).reduce((sum, node) => {
    const children = Array.isArray(node?.children) ? node.children : [];
    if (!children.length) return sum + 1;
    return sum + countMindmapLeaves(children);
  }, 0);
}

function getMindmapMaxDepth(nodes, depth = 0) {
  let maxDepth = depth;
  for (const node of (Array.isArray(nodes) ? nodes : [])) {
    const childDepth = getMindmapMaxDepth(node?.children || [], depth + 1);
    if (childDepth > maxDepth) maxDepth = childDepth;
  }
  return maxDepth;
}

function countMindmapNodes(nodes) {
  return (Array.isArray(nodes) ? nodes : []).reduce((sum, node) => sum + 1 + countMindmapNodes(node?.children || []), 0);
}

function countMindmapBranches(nodes) {
  return (Array.isArray(nodes) ? nodes : []).reduce((sum, node) => sum + ((node?.children?.length || 0) > 0 ? 1 : 0) + countMindmapBranches(node?.children || []), 0);
}

function stripMindmapEdgeMarkup(value = '') {
  return String(value || '')
    .replace(/\s*\[\[edge:([^\]]+)\]\]/gi, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function extractMindmapEdgeRefs(...values) {
  const refs = [];
  const seen = new Set();

  const pushRef = (raw) => {
    const normalized = normalizeMindmapGroup(raw, '').trim();
    if (!normalized) return;
    const key = normalized.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    refs.push(normalized);
  };

  values.flat().forEach((value) => {
    const text = extractTextCandidate(value);
    if (!text) return;
    const matches = text.matchAll(/\[\[edge:([^\]]+)\]\]/gi);
    for (const match of matches) {
      pushRef(match[1] || '');
    }
  });

  return refs;
}

function extractContextWindow(text, query = '', radius = 480) {
  const source = String(text || '').trim();
  if (!source) return '';
  const limit = Math.max(220, Math.round(Number(radius) || 480));
  const needle = String(query || '').trim().toLowerCase();
  if (!needle) return source.slice(0, limit * 2);
  const index = source.toLowerCase().indexOf(needle);
  if (index < 0) return source.slice(0, limit * 2);
  const start = Math.max(0, index - limit);
  const end = Math.min(source.length, index + needle.length + limit);
  return source.slice(start, end).trim();
}

function buildMindmapExpansionContext(content, summary, node, contentLimit = 1400) {
  const clip = (value, limit) => String(value || '').slice(0, Math.max(0, Math.round(Number(limit) || 0)));
  const nodeLabel = String(node?.label || '').trim();
  const description = stripMindmapEdgeMarkup(extractTextCandidate(node?.description || '')).slice(0, 220);
  const hints = normalizeStringList([
    ...(Array.isArray(node?.insights) ? node.insights : []),
    ...(Array.isArray(node?.evidence) ? node.evidence : []),
    ...(Array.isArray(node?.questions) ? node.questions : [])
  ], 5, 110);
  const localWindow = extractContextWindow(content, nodeLabel || description, Math.min(560, Math.max(260, Math.floor(contentLimit / 2.4))));
  return clip(
    `ФОКУС-ВЕТКА: ${nodeLabel || 'ветка'}
ОПИСАНИЕ: ${description || '—'}
УЖЕ ЕСТЬ: ${hints.join(' | ') || '—'}

КРАТКАЯ СВОДКА:
${clip(summary || '—', 620)}

ЛОКАЛЬНЫЙ ФРАГМЕНТ:
${localWindow || clip(content || '', contentLimit)}`,
    contentLimit
  );
}

function scoreMindmapNodeForExpansion(node, depth = 0) {
  const childCount = Array.isArray(node?.children) ? node.children.length : 0;
  const insightCount = Array.isArray(node?.insights) ? node.insights.length : 0;
  const evidenceCount = Array.isArray(node?.evidence) ? node.evidence.length : 0;
  const questionCount = Array.isArray(node?.questions) ? node.questions.length : 0;
  const descScore = node?.description ? Math.min(2, Math.ceil(String(node.description).length / 90)) : 0;
  const scarcityScore = Math.max(0, 5 - childCount) * 3;
  const insightScore = Math.min(2, insightCount);
  const evidenceScore = Math.min(2, evidenceCount);
  const questionScore = Math.min(2, questionCount + (String(node?.kind || '') === 'question' ? 1 : 0));
  const labelScore = Math.min(2, Math.ceil(String(node?.label || '').trim().length / 12));
  const clusterScore = String(node?.kind || '') === 'cluster' ? 2 : 0;
  const laneDiversityScore = Math.min(3, Number(insightCount > 0) + Number(evidenceCount > 0) + Number(questionCount > 0));
  const depthScore = depth === 0 ? 3 : depth === 1 ? 4 : depth === 2 ? 3 : 1;
  const leafBoost = childCount === 0 && depth >= 1 ? 2 : 0;
  return scarcityScore + descScore + insightScore + evidenceScore + questionScore + labelScore + clusterScore + laneDiversityScore + depthScore + leafBoost;
}

function flattenMindmapNodes(nodes, depth = 0, out = []) {
  for (const node of (Array.isArray(nodes) ? nodes : [])) {
    out.push({ node, depth });
    if (node?.children?.length) flattenMindmapNodes(node.children, depth + 1, out);
  }
  return out;
}

function pickMindmapExpansionTargets(nodes, maxTargets = 4, options = {}) {
  const minDepth = Math.max(0, Number(options?.minDepth) || 0);
  const maxDepth = Number.isFinite(Number(options?.maxDepth)) ? Number(options.maxDepth) : minDepth;
  const maxChildren = Number.isFinite(Number(options?.maxChildren)) ? Number(options.maxChildren) : 8;

  return flattenMindmapNodes(nodes)
    .filter(entry => entry.depth >= minDepth && entry.depth <= maxDepth)
    .filter(entry => Array.isArray(entry.node?.children) ? entry.node.children.length < maxChildren : true)
    .map((entry, index) => ({ node: entry.node, depth: entry.depth, index, score: scoreMindmapNodeForExpansion(entry.node, entry.depth) }))
    .sort((a, b) => (b.score - a.score) || (a.index - b.index))
    .slice(0, Math.max(0, maxTargets))
    .map(entry => entry.node);
}

function buildMindmapExpansionPlan(data) {
  const nodeCount = countMindmapNodes(data?.nodes || []);
  const maxDepth = getMindmapMaxDepth(data?.nodes || []);
  const leafRatio = countMindmapLeaves(data?.nodes || []) / Math.max(nodeCount, 1);

  const waves = [
    {
      title: 'Углубляю главные кластеры…',
      contentLimit: 1700,
      maxTokens: 980,
      pickTargets: () => pickMindmapExpansionTargets(data?.nodes || [], 4, { minDepth: 0, maxDepth: 0, maxChildren: 7 })
    },
    {
      title: 'Раскрываю механики, сигналы и линии…',
      contentLimit: 1350,
      maxTokens: 760,
      pickTargets: () => pickMindmapExpansionTargets(data?.nodes || [], 6, { minDepth: 1, maxDepth: 1, maxChildren: 6 })
    }
  ];

  if (maxDepth < 3 || nodeCount < 48 || leafRatio > 0.56) {
    waves.push({
      title: 'Добираю глубокие ветки и развилки…',
      contentLimit: 1050,
      maxTokens: 620,
      pickTargets: () => pickMindmapExpansionTargets(data?.nodes || [], leafRatio > 0.62 ? 4 : 3, { minDepth: 2, maxDepth: 2, maxChildren: 4 })
    });
  }

  if (maxDepth < 4 && leafRatio > 0.62) {
    waves.push({
      title: 'Подсвечиваю edge-связи и проверки…',
      contentLimit: 920,
      maxTokens: 520,
      pickTargets: () => pickMindmapExpansionTargets(data?.nodes || [], 2, { minDepth: 1, maxDepth: 2, maxChildren: 3 })
    });
  }

  return waves;
}

function normalizeMindmapData(raw) {
  const obj = unwrapMindmapObject((raw && typeof raw === 'object' && !Array.isArray(raw)) ? raw : parseJsonObject(raw));
  if (!obj || typeof obj !== 'object') return null;

  const nodes = normalizeMindmapNodes(extractMindmapNodeList(obj) || [], 'node_', 0, MINDMAP_TREE_MAX_DEPTH);
  if (!nodes.length) return null;

  const metadata = (obj.metadata && typeof obj.metadata === 'object') ? { ...obj.metadata } : {};
  metadata.nodeCount = countMindmapNodes(nodes);
  metadata.leafCount = countMindmapLeaves(nodes);
  metadata.clusterCount = nodes.length;
  metadata.maxDepth = getMindmapMaxDepth(nodes);
  metadata.mapStyle = String(metadata.mapStyle || 'clustered').trim().slice(0, 24) || 'clustered';
  metadata.coverage = String(metadata.coverage || (nodes.length >= 6 ? 'broad' : 'medium')).trim().slice(0, 24) || 'medium';

  return {
    title: String(obj.title || obj.label || document.title || 'Карта').trim().slice(0, 80),
    nodes,
    metadata
  };
}

function sanitizeMermaidMindmapLabel(label) {
  return String(label || '')
    .replace(/\[\[(?:entity|term|wiki|evidence|action):([^\]]+)\]\]/gi, '$1')
    .replace(/[()"]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120) || 'Node';
}

function buildMindmapMermaid(data) {
  const title = sanitizeMermaidMindmapLabel(data?.title || 'Карта');
  let mm = `mindmap\n  root((${title}))\n`;
  const traverse = (nodes, indent) => {
    for (const node of (Array.isArray(nodes) ? nodes : [])) {
      mm += `${indent}${sanitizeMermaidMindmapLabel(node?.label)}\n`;
      if (node?.children?.length) traverse(node.children, `${indent}  `);
    }
  };
  traverse(data?.nodes || [], '    ');
  return mm;
}

function buildMindmapOutline(data) {
  const lines = [`# ${String(data?.title || 'Карта').trim() || 'Карта'}`];
  const walk = (nodes, depth = 0) => {
    for (const node of (Array.isArray(nodes) ? nodes : [])) {
      const prefix = `${'  '.repeat(Math.max(0, depth))}- `;
      lines.push(`${prefix}${node.label}`);
      if (node.kind) lines.push(`${'  '.repeat(depth + 1)}тип: ${mindmapKindLabel(node.kind, depth)}`);
      if (node.group && node.group !== node.label) lines.push(`${'  '.repeat(depth + 1)}группа: ${node.group}`);
      if (node.description) lines.push(`${'  '.repeat(depth + 1)}${node.description}`);
      for (const insight of normalizeStringList(node.insights || [], 4, 180)) {
        lines.push(`${'  '.repeat(depth + 1)}• линия: ${insight}`);
      }
      for (const evidence of normalizeStringList(node.evidence || [], 4, 180)) {
        lines.push(`${'  '.repeat(depth + 1)}• сигнал: ${evidence}`);
      }
      for (const question of normalizeStringList(node.questions || [], 4, 180)) {
        lines.push(`${'  '.repeat(depth + 1)}• проверить: ${question}`);
      }
      if (node.children?.length) walk(node.children, depth + 1);
    }
  };
  walk(data?.nodes || [], 0);
  return lines.join('\n').trim();
}

function countMindmapSignals(node) {
  return normalizeStringList(node?.insights || [], 6, 180).length
    + normalizeStringList(node?.evidence || [], 6, 180).length
    + normalizeStringList(node?.questions || [], 6, 180).length;
}

function summarizeMindmapNode(node, maxLen = 160) {
  const label = String(node?.label || '').trim();
  const description = stripMindmapEdgeMarkup(extractTextCandidate(node?.description || ''))
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLen);
  if (label && description) return `${label}: ${description}`;
  return label || description || '';
}

function getMindmapModesForNode(node) {
  const modes = new Set(['all']);
  const kind = normalizeMindmapKind(node?.kind, 1);
  const insightCount = normalizeStringList(node?.insights || [], 6, 180).length;
  const evidenceCount = normalizeStringList(node?.evidence || [], 6, 180).length;
  const questionCount = normalizeStringList(node?.questions || [], 6, 180).length;

  if (kind === 'risk') modes.add('risks');
  if (kind === 'question' || questionCount > 0) modes.add('questions');
  if (kind === 'evidence' || insightCount > 0 || evidenceCount > 0) modes.add('signals');
  if (['tool', 'artifact', 'integration'].includes(kind)) modes.add('tools');
  if (['workflow', 'mechanism', 'integration'].includes(kind)) modes.add('flows');

  return Array.from(modes);
}

function buildMindmapOverview(data, limit = 4) {
  const entries = flattenMindmapNodes(data?.nodes || []);
  const signals = [];
  const questions = [];
  const risks = [];
  const tools = [];

  const pushUnique = (bucket, item) => {
    if (!item?.text) return;
    const dedupeKey = `${String(item.label || '').toLowerCase()}::${String(item.text || '').toLowerCase()}`;
    if (bucket.some(existing => existing.key === dedupeKey)) return;
    bucket.push({ ...item, key: dedupeKey });
  };

  for (const { node, depth } of entries) {
    const baseScore = Math.max(1, 8 - depth);
    const label = String(node?.label || '').trim();
    const group = normalizeMindmapGroup(node?.group || '', '');
    const summary = summarizeMindmapNode(node, 150);
    const kind = normalizeMindmapKind(node?.kind, depth);

    normalizeStringList(node?.evidence || [], 4, 180).forEach((text, index) => {
      pushUnique(signals, { label, group, text: stripMindmapEdgeMarkup(text), score: baseScore * 10 - index, kind });
    });
    normalizeStringList(node?.insights || [], 4, 180).forEach((text, index) => {
      pushUnique(signals, { label, group, text: stripMindmapEdgeMarkup(text), score: baseScore * 8 - index, kind });
    });
    normalizeStringList(node?.questions || [], 4, 180).forEach((text, index) => {
      pushUnique(questions, { label, group, text: stripMindmapEdgeMarkup(text), score: baseScore * 10 - index, kind });
      if (kind === 'risk') {
        pushUnique(risks, { label, group, text: stripMindmapEdgeMarkup(text), score: baseScore * 9 - index, kind });
      }
    });

    if (kind === 'risk') {
      pushUnique(risks, { label, group, text: summary || label, score: baseScore * 11, kind });
    }
    if (['tool', 'artifact', 'integration'].includes(kind)) {
      pushUnique(tools, { label, group, text: summary || label, score: baseScore * 9, kind });
    }
  }

  const finalize = (bucket) => bucket
    .sort((a, b) => (b.score - a.score) || a.label.localeCompare(b.label, 'ru'))
    .slice(0, Math.max(1, limit))
    .map(({ key, ...item }) => item);

  return {
    focusClusters: (Array.isArray(data?.nodes) ? data.nodes : []).slice(0, 7).map(node => ({
      id: String(node?.id || ''),
      label: String(node?.label || '').trim(),
      group: normalizeMindmapGroup(node?.group || '', ''),
      kind: normalizeMindmapKind(node?.kind, 0)
    })),
    topSignals: finalize(signals),
    topQuestions: finalize(questions),
    topRisks: finalize(risks),
    topTools: finalize(tools)
  };
}

function buildMindmapEdgeOverview(data, limit = 5) {
  const entries = flattenMindmapNodes(data?.nodes || []);
  const dedupe = new Set();
  const edges = [];

  const buildLookupKey = (value) => stripMindmapEdgeMarkup(extractTextCandidate(value))
    .trim()
    .toLowerCase();
  const labelLookup = new Map();
  for (const { node } of entries) {
    const key = buildLookupKey(node?.label || '');
    if (key && !labelLookup.has(key)) labelLookup.set(key, node);
  }

  const findTarget = (ref) => {
    const needle = buildLookupKey(ref);
    if (!needle) return null;
    if (labelLookup.has(needle)) return labelLookup.get(needle) || null;
    for (const [labelKey, node] of labelLookup.entries()) {
      if (labelKey.includes(needle) || needle.includes(labelKey)) return node;
    }
    return null;
  };

  for (const { node, depth } of entries) {
    const refs = extractMindmapEdgeRefs(node?.description, node?.insights, node?.evidence, node?.questions);
    if (!refs.length) continue;
    const sourceLabel = String(node?.label || '').trim();
    const snippet = stripMindmapEdgeMarkup(
      extractTextCandidate(node?.description || '')
      || normalizeStringList(node?.insights || [], 1, 180)[0]
      || normalizeStringList(node?.evidence || [], 1, 180)[0]
      || ''
    ).slice(0, 180);

    refs.forEach((ref, index) => {
      const targetNode = findTarget(ref);
      const targetLabel = String(targetNode?.label || ref).trim();
      if (!sourceLabel || !targetLabel || sourceLabel === targetLabel) return;
      const key = `${sourceLabel.toLowerCase()}::${targetLabel.toLowerCase()}`;
      if (dedupe.has(key)) return;
      dedupe.add(key);
      edges.push({
        label: `${sourceLabel} → ${targetLabel}`,
        text: snippet || `Связь с веткой ${targetLabel}`,
        sourceId: String(node?.id || ''),
        targetId: String(targetNode?.id || ''),
        score: Math.max(1, 10 - depth) * 10 - index
      });
    });
  }

  return edges
    .sort((a, b) => (b.score - a.score) || a.label.localeCompare(b.label, 'ru'))
    .slice(0, Math.max(1, limit))
    .map(({ score, ...item }) => item);
}

function buildMindmapChecklist(data) {
  const overview = buildMindmapOverview(data, 5);
  const lines = [`# ${String(data?.title || 'Карта').trim() || 'Карта'} — checklist`];

  if (overview.topQuestions.length) {
    lines.push('', '## Что проверить');
    overview.topQuestions.forEach(item => {
      lines.push(`- [ ] ${item.label}: ${item.text}`);
    });
  }

  if (overview.topRisks.length) {
    lines.push('', '## Риски и ограничения');
    overview.topRisks.forEach(item => {
      lines.push(`- [ ] ${item.label}: ${item.text}`);
    });
  }

  if (overview.topSignals.length) {
    lines.push('', '## Сигналы для подтверждения');
    overview.topSignals.forEach(item => {
      lines.push(`- [ ] ${item.label}: ${item.text}`);
    });
  }

  if (overview.topTools.length) {
    lines.push('', '## Инструменты / артефакты');
    overview.topTools.forEach(item => {
      lines.push(`- [ ] ${item.label}: ${item.text}`);
    });
  }

  return lines.join('\n').trim();
}

function groupMindmapNodesByGroup(nodes, depth = 0, fallbackGroup = '') {
  const groups = [];
  const seen = new Map();

  for (const node of (Array.isArray(nodes) ? nodes : [])) {
    const normalizedGroup = normalizeMindmapGroup(
      node?.group || '',
      normalizeMindmapGroup(fallbackGroup, '') || mindmapKindLabel(node?.kind, depth + 1)
    ) || 'Доп. линия';
    const groupKey = normalizedGroup.toLowerCase();
    let bucket = seen.get(groupKey);
    if (!bucket) {
      bucket = { label: normalizedGroup, items: [] };
      seen.set(groupKey, bucket);
      groups.push(bucket);
    }
    bucket.items.push(node);
  }

  return groups;
}

function getMindmapSearchText(node) {
  return [
    node?.label || '',
    node?.kind || '',
    node?.group || '',
    stripMindmapEdgeMarkup(node?.description || ''),
    ...normalizeStringList(node?.insights || [], 6, 180).map(stripMindmapEdgeMarkup),
    ...normalizeStringList(node?.evidence || [], 6, 180).map(stripMindmapEdgeMarkup),
    ...normalizeStringList(node?.questions || [], 6, 180).map(stripMindmapEdgeMarkup),
    ...extractMindmapEdgeRefs(node?.description, node?.insights, node?.evidence, node?.questions)
  ].join(' ').toLowerCase();
}

function tokenizeMindmapQuery(query = '') {
  const tokens = [];
  const source = String(query || '').trim().toLowerCase();
  if (!source) return tokens;

  const matches = source.matchAll(/"([^"]+)"|(\S+)/g);
  for (const match of matches) {
    const token = String(match[1] || match[2] || '').trim().replace(/\s+/g, ' ');
    if (token) tokens.push(token);
  }
  return tokens;
}

function matchesMindmapSearch(haystack = '', query = '') {
  const text = String(haystack || '').toLowerCase();
  const tokens = Array.isArray(query) ? query : tokenizeMindmapQuery(query);
  if (!tokens.length) return false;
  return tokens.every(token => text.includes(token));
}

function applyMindmapCollapseState(root, collapseFromLevel = 2) {
  if (!root) return;
  root.querySelectorAll('.pzdrk-mm-node').forEach((nodeEl) => {
    const level = Number(nodeEl.getAttribute('data-level') || 0);
    const hasChildren = !!nodeEl.querySelector(':scope > .pzdrk-mm-children');
    if (!hasChildren) {
      nodeEl.classList.remove('collapsed');
      return;
    }
    nodeEl.classList.toggle('collapsed', level >= collapseFromLevel);
  });
}

function applyMindmapExpandToLevel(root, expandToLevel = 1) {
  if (!root) return;
  root.querySelectorAll('.pzdrk-mm-node').forEach((nodeEl) => {
    const level = Number(nodeEl.getAttribute('data-level') || 0);
    const hasChildren = !!nodeEl.querySelector(':scope > .pzdrk-mm-children');
    if (!hasChildren) {
      nodeEl.classList.remove('collapsed');
      return;
    }
    nodeEl.classList.toggle('collapsed', level >= Math.max(0, Number(expandToLevel) || 1));
  });
}

function refreshMindmapGroupTitleVisibility(root) {
  if (!root) return;
  root.querySelectorAll('.pzdrk-mm-children').forEach((container) => {
    const titles = Array.from(container.querySelectorAll(':scope > [data-mm-group-title]'));
    titles.forEach((titleEl) => {
      let next = titleEl.nextElementSibling;
      let hasVisibleNode = false;
      while (next && !next.matches('[data-mm-group-title]')) {
        if (next.matches('.pzdrk-mm-node') && !next.classList.contains('pzdrk-mm-hidden')) {
          hasVisibleNode = true;
          break;
        }
        next = next.nextElementSibling;
      }
      titleEl.hidden = !hasVisibleNode;
    });
  });
}

function applyMindmapFilter(root, query = '', mode = 'all') {
  if (!root) return { matched: 0, visible: 0 };

  const tokens = tokenizeMindmapQuery(query);
  const normalizedMode = String(mode || 'all').trim().toLowerCase() || 'all';
  const topNodes = Array.from(root.querySelectorAll(':scope > .pzdrk-mm-node'));

  const visitNode = (nodeEl) => {
    const ownText = String(nodeEl.getAttribute('data-search') || '');
    const ownModes = String(nodeEl.getAttribute('data-modes') || 'all').split(/\s+/).filter(Boolean);
    const childNodes = Array.from(nodeEl.querySelectorAll(':scope > .pzdrk-mm-children > .pzdrk-mm-node'));
    const childMatch = childNodes.some(child => visitNode(child));
    const ownMatch = tokens.length ? matchesMindmapSearch(ownText, tokens) : false;
    const ownModeMatch = normalizedMode === 'all' || ownModes.includes(normalizedMode);
    const visible = (((!tokens.length && ownModeMatch) || (ownMatch && ownModeMatch)) || childMatch);

    nodeEl.classList.toggle('pzdrk-mm-hidden', !visible);
    nodeEl.classList.toggle('pzdrk-mm-match', visible && ((tokens.length > 0 && ownMatch) || (normalizedMode !== 'all' && ownModeMatch)));

    if ((tokens.length || normalizedMode !== 'all') && visible && childNodes.length) {
      nodeEl.classList.remove('collapsed');
    }

    return visible;
  };

  topNodes.forEach(visitNode);
  refreshMindmapGroupTitleVisibility(root);

  return {
    matched: root.querySelectorAll('.pzdrk-mm-match').length,
    visible: root.querySelectorAll('.pzdrk-mm-node:not(.pzdrk-mm-hidden)').length
  };
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
  const ctx = getCommandContext(options?.sourceNote || null);
  const prompt = getPromptOverride('createCommand')
    .replace('{request}', requestText)
    .replace('{url}', ctx.url)
    .replace('{title}', ctx.title)
    .replace('{summary}', ctx.summary)
    .replace('{content}', ctx.content)
    .replace('{browserContext}', ctx.browserContext)
    .replace('{selection}', ctx.selection || '');

  const raw = await callGroq(prompt, 'Только JSON объект.', { temperature: 0.2, max_tokens: getTaskMaxTokens(runtimeSettings, 1100, 256) });
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
    if (areaName !== 'sync' && areaName !== 'local') return;
    runtimeSettings = null;
    if (changes[CUSTOM_COMMANDS_KEY]) refreshCommands();
    getSettings().then((settings) => {
      runtimeSettings = settings;
      currentNotes.forEach((note) => {
        if (!note || !note.isConnected) return;
        note.dataset.navEnabled = settings.showLeftNavButtons === true ? 'true' : 'false';
        note.dataset.actionsEnabled = settings.showRightActionButtons === true ? 'true' : 'false';
        buildNoteNav(note);
        renderFloatingHints(note);
        updateNoteActionsPlacement(note);
      });
    }).catch(() => {});
  });
}

// ============ FLOATING ACTION HINTS ============
// These appear as separate floating rectangles with keyboard shortcuts

const FLYOUT_ACTION_IDS = new Set([
  'twitter',
  'deepdive',
  'automation',
  'learning',
  'share',
  'challenge',
  'timeline',
  'extract',
  'briefing',
  'matrix',
  'sources',
  'opsplan',
  'faq',
  'compare',
  'localization',
  'frontendBuilder',
  'renderHost'
]);
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

function getFlyoutCacheKey(cmd, sourceNote = null) {
  const id = String(cmd?.id || '').trim();
  const scope = String(cmd?.scope || 'page');
  const url = window.location.href;
  const noteId = String(sourceNote?.dataset?.noteId || '').trim();
  const ownerPart = noteId ? `::note:${noteId}` : '';
  if (!id) return `${url}::(unknown)`;
  if (scope === 'selection') {
    const sel = getSelectionText() || '';
    return `${url}::${id}${ownerPart}::sel:${simpleHash32(sel).slice(0, 8)}`;
  }
  return `${url}::${id}${ownerPart}`;
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

function positionFloatingNote(note, anchorEl, margin = ACTION_FLYOUT_MARGIN) {
  if (!note || !anchorEl || !anchorEl.isConnected) return;
  note.style.transform = 'none';
  const rect = anchorEl.getBoundingClientRect();
  const noteRect = note.getBoundingClientRect();
  const stackIndex = Math.max(0, Math.min(5, Number(note.dataset.stackIndex || 0) || 0));

  let left = rect.right + margin;
  let side = 'right';
  if ((left + noteRect.width) > (window.innerWidth - 8)) {
    left = rect.left - noteRect.width - margin;
    side = 'left';
  }
  if (stackIndex) left += (side === 'right' ? 1 : -1) * (stackIndex * 22);
  left = Math.max(8, Math.min(left, window.innerWidth - noteRect.width - 8));

  let top = rect.top - 6 + (stackIndex * 18);
  top = Math.max(8, Math.min(top, window.innerHeight - noteRect.height - 8));

  note.style.left = `${left}px`;
  note.style.top = `${top}px`;
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
  positionFloatingNote(note, anchor, ACTION_FLYOUT_MARGIN);
}

function showActionFlyoutPreview(cmd, anchorEl, sourceNote = null) {
  if (actionFlyout?.pinned) return;
  const note = ensureActionFlyoutNote();
  if (actionFlyout.hideTimer) clearTimeout(actionFlyout.hideTimer);

  const cacheKey = getFlyoutCacheKey(cmd, sourceNote);
  const cached = flyoutPrefetchCache.get(cacheKey);

  const safeTitle = escapeHtml(cmd?.title || cmd?.id || 'Action');
  let preview = `<div class="pzdrk-action-preview">${safeTitle}<br>Нажмите, чтобы выполнить</div>`;
  let loading = false;

  if (cached?.status === 'done' && cached.html) {
    preview = String(cached.html);
  } else if (cached?.status === 'pending') {
    preview = renderStateCard({ tone: 'waiting', icon: '⏳', title: 'Подогреваю ответ', body: 'Предпросмотр уже собирается в фоне, чтобы flyout открылся быстрее.', compact: true });
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
      renderStateCard({ tone: 'waiting', icon: '⏳', title: 'Генерирую ответ', body: 'Собираю результат для этой команды и сразу упаковываю его в читаемый формат.', compact: true }),
      true
    );
  }
  positionActionFlyout(anchorEl);
  return note;
}

function createActionCardNote(cmd, anchorEl, sourceNote = null) {
  const note = createNote({
    title: cmd?.title || cmd?.id || 'Карточка',
    type: 'action',
    content: renderStateCard({
      tone: 'waiting',
      icon: '⏳',
      title: 'Генерирую карточку',
      body: 'Собираю отдельный результат, который можно двигать, масштабировать и держать рядом с основным экраном.',
      compact: true
    }),
    collapsed: false,
    loading: true,
    layout: 'flyout'
  });
  note.dataset.pinned = 'true';
  note.dataset.actionsEnabled = 'true';
  note.dataset.stackGroup = String(sourceNote?.dataset?.noteId || 'page-root');
  const siblingsInStack = currentNotes.filter((candidate) => (
    candidate &&
    candidate !== note &&
    candidate.isConnected &&
    candidate.dataset?.layout === 'flyout' &&
    candidate.dataset?.stackGroup === note.dataset.stackGroup &&
    candidate.style.display !== 'none'
  ));
  note.dataset.stackIndex = String(Math.min(5, siblingsInStack.length));
  note.style.display = 'flex';
  note.style.width = 'min(540px, calc(100vw - 32px))';
  note.style.maxWidth = 'min(620px, calc(100vw - 24px))';
  note.style.maxHeight = '78vh';
  positionFloatingNote(note, anchorEl, ACTION_FLYOUT_MARGIN);
  if (sourceNote?.dataset?.noteId) note.dataset.sourceNoteId = sourceNote.dataset.noteId;
  createFloatingHints(note);
  bringNoteToFront(note);
  return note;
}

async function buildFlyoutOutput(cmd, settings, sourceNote = null) {
  if (!cmd) throw new Error('No command');
  const ctx = getCommandContext(sourceNote);
  const maxTokens = getTaskMaxTokens(settings, 1800, 256);

  if (cmd.kind === 'custom') {
    if ((cmd.scope || 'page') === 'selection' && !ctx.selection) throw new Error('Нужно выделение');
    const prompt = renderTemplate(cmd.prompt, ctx);
    const system = (cmd.system && String(cmd.system).trim()) ? String(cmd.system) : STYLE_RULES;
    return await callGroq(prompt, system, { temperature: 0.35, max_tokens: maxTokens });
  }

  if (cmd.kind === 'builtin' && FLYOUT_ACTION_IDS.has(cmd.id)) {
    const actionType = cmd.id;
    const override = String(settings?.actionPrompts?.[actionType] || '').trim();
    const tpl = override || DEFAULT_ACTION_PROMPTS[actionType];
    if (!tpl) throw new Error('Нет промпта для действия: ' + actionType);
    const prompt = renderTemplate(tpl, ctx);
    return await callGroq(prompt, STYLE_RULES, { temperature: 0.35, max_tokens: maxTokens });
  }

  throw new Error('Unsupported flyout command');
}

async function maybeScheduleFlyoutPrefetch(cmd, anchorEl, sourceNote = null) {
  if (!cmd || !anchorEl) return;
  if (actionFlyout?.pinned) return;

  const settings = runtimeSettings || await getSettings().catch(() => null);
  if (settings) runtimeSettings = settings;
  if (!settings?.prefetchOnHover) return;

  const delay = Number.isFinite(Number(settings.prefetchDelayMs)) ? Number(settings.prefetchDelayMs) : 320;
  const cacheKey = getFlyoutCacheKey(cmd, sourceNote);

  if (actionFlyout?.prefetchTimer) clearTimeout(actionFlyout.prefetchTimer);
  actionFlyout.prefetchKey = cacheKey;

  actionFlyout.prefetchTimer = setTimeout(() => {
    startFlyoutPrefetch(cmd, anchorEl, cacheKey, settings, sourceNote);
  }, Math.max(0, Math.min(2000, delay)));
}

async function startFlyoutPrefetch(cmd, anchorEl, cacheKey, settings, sourceNote = null) {
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
  setFlyoutContent(note, cmd?.title || cmd?.id || 'Action', renderStateCard({ tone: 'waiting', icon: '⏳', title: 'Делаю prefetch', body: 'Черновик готовится заранее, пока вы только смотрите на карточку.', compact: true }), true);
  positionActionFlyout(anchorEl);

  entry.promise = (async () => {
    try {
      const out = await buildFlyoutOutput(cmd, settings, sourceNote);
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

async function runFlyoutCommand(cmd, note, anchorEl, sourceNote = null) {
  if (!cmd) return;
  if (cmd.kind === 'custom') return runCustomCommand(cmd, { targetNote: note, anchorEl, sourceNote });
  if (cmd.kind === 'builtin' && FLYOUT_ACTION_IDS.has(cmd.id)) {
    const action = getDefaultActions().find(a => a.type === cmd.id);
    return executeAction(action, { targetNote: note, anchorEl, sourceNote });
  }
  return runCommand(cmd, { sourceNote });
}

function getDefaultActions() {
  return [
    { key: 'M', title: 'Карта', type: 'mindmap', icon: '🗺', hint: 'Структурная карта темы', group: 'core', pinned: true },
    { key: '1', title: 'Тред', type: 'twitter', icon: '🐦', hint: 'Готовая нить для публикации', group: 'publish', pinned: true },
    { key: '2', title: 'Разбор', type: 'deepdive', icon: '🔬', hint: 'Допущения, риски, последствия', group: 'analysis', pinned: true },
    { key: '3', title: 'Автоматизация', type: 'automation', icon: '⚡', hint: 'От быстрого хода к системе', group: 'ops', pinned: true },
    { key: '4', title: 'Обучение', type: 'learning', icon: '📚', hint: '14-дневный план и упражнения', group: 'analysis', pinned: true },
    { key: '5', title: 'Поделиться', type: 'share', icon: '📤', hint: 'Пакет для разных каналов', group: 'publish', pinned: true },
    { key: '6', title: 'Оспорить', type: 'challenge', icon: '🎯', hint: 'Проверка на слабые места', group: 'analysis', pinned: true },
    { key: '7', title: 'Хронология', type: 'timeline', icon: '⏱', hint: 'Фазы, этапы, зависимости', group: 'structure', pinned: true },
    { key: '8', title: 'Извлечь', type: 'extract', icon: '📦', hint: 'Факты, числа, сущности, задачи', group: 'structure', pinned: true },
    { key: '9', title: 'Бриф', type: 'briefing', icon: '🧾', hint: 'Краткая записка и рекомендация', group: 'structure', pinned: true },
    { key: '0', title: 'Матрица', type: 'matrix', icon: '🧮', hint: 'Сравнение вариантов по критериям', group: 'structure', pinned: true },
    { key: 'Q', title: 'Источники', type: 'sources', icon: '🧷', hint: 'Карта доказательств и проверок', group: 'analysis', pinned: true },
    { key: 'A', title: 'План', type: 'opsplan', icon: '🛠', hint: 'Пошаговый план выполнения', group: 'ops', pinned: true },
    { key: 'W', title: 'FAQ', type: 'faq', icon: '❓', hint: '10 ключевых вопросов и ответов', group: 'structure', pinned: true },
    { key: 'D', title: 'Сравнить', type: 'compare', icon: '⚖️', hint: 'Варианты, trade-offs, выбор', group: 'structure', pinned: true },
    { key: 'L', title: 'Локализация', type: 'localization', icon: '🔤', hint: 'Перевод без потери смысла', group: 'build', pinned: false },
    { key: 'F', title: 'Интерфейс', type: 'frontendBuilder', icon: '💻', hint: 'Превратить материал в UI-концепт', group: 'build', pinned: false },
    { key: 'R', title: 'Деплой', type: 'renderHost', icon: '🚀', hint: 'План выкладки на Render.com', group: 'ops', pinned: false },
  ];
}

const DEFAULT_ACTION_PROMPTS = {
  twitter: `${STYLE_RULES}

Сделай X/Twitter-тред уровня operator memo.

Формат:
1. 7–11 твитов.
2. Первый твит = сильный hook + claim + stakes.
3. Средние твиты = evidence, mechanisms, counterpoints, practical implications.
4. Последний твит = CTA / вопрос / next move.

Требования:
- Каждый твит автономен и тянет к следующему.
- Где есть факты/числа, помечай [[evidence:...]].
- Не делай generic hot take; нужен angle, который реально стоит репостить.

URL: {url}
TITLE: {title}

SUMMARY:
{summary}

PAGE SNIPPET:
{content}

USER CONTEXT:
{browserContext}`,

  deepdive: `${STYLE_RULES}

Сделай глубокий strategy/engineering review.

Структура:
1. Core thesis
2. Mechanism / why it works
3. Hidden assumptions
4. Risks / anti-patterns / blind spots
5. Non-obvious implications
6. What to do next
7. What still needs validation

URL: {url}
TITLE: {title}

SUMMARY:
{summary}

PAGE SNIPPET:
{content}

USER CONTEXT:
{browserContext}`,

  automation: `${STYLE_RULES}

Предложи план автоматизации как solution architect.

Дай 3 слоя:
1. Quick win: 30–60 минут
2. Solid implementation: 1–2 дня
3. Serious system: 1–2 недели

Для каждого слоя:
- цель
- стек / интеграции / API
- архитектура потока
- узкие места и failure modes
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

  learning: `${STYLE_RULES}

Собери 14-дневный learning sprint.

На каждый день дай:
- цель дня
- что изучить
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

  share: `${STYLE_RULES}

Подготовь пакет для распространения материала.

Нужны:
1. Slack update: 3-4 предложения
2. Email: subject + preview line + 2 коротких абзаца
3. LinkedIn пост: 1 сильный angle + practical takeaway
4. Telegram пост: компактно, punchy, без воды
5. One-line positioning: зачем это вообще пересылать

URL: {url}
TITLE: {title}

SUMMARY:
{summary}`,

  challenge: `${STYLE_RULES}

Сделай critical challenge pack.

Нужны:
1. 8–12 провокационных вопросов
2. На каждый вопрос: 1–2 гипотезы + что проверить/где искать
3. TOP-5 objectives для дальнейшего копания
4. NEXT BEST PROMPTS: 10 сильных follow-up запросов
5. Где автор/материал может быть слишком уверен

URL: {url}
TITLE: {title}

SUMMARY:
{summary}

PAGE SNIPPET:
{content}`,

  timeline: `${STYLE_RULES}

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

  extract: `${STYLE_RULES}

Сделай extraction pack без воды и без простыней.

Формат ответа:
## TL;DR
- 2-4 вывода

## Ключевые тезисы
- 5-10 предметных тезисов

## Сущности и акторы
Сделай markdown-таблицу:
| Сущность | Тип | Роль / почему важна |
|---|---|---|

## Числа, даты, метрики
Сделай markdown-таблицу:
| Параметр | Значение | Контекст |
|---|---|---|

## Инструменты / системы / артефакты
- Компактный список

## Задачи и следующие шаги
- 4-8 конкретных действий

## Риски / пробелы
- 4-8 пунктов

Правила:
- Только конкретика из материала или осторожные inference с явной пометкой.
- Не превращай extraction в эссе.
- Если данных нет, так и напиши.

URL: {url}
TITLE: {title}

SUMMARY:
{summary}

PAGE SNIPPET:
{content}

USER CONTEXT:
{browserContext}`,

  briefing: `${STYLE_RULES}

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

  matrix: `${STYLE_RULES}

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

  sources: `${STYLE_RULES}

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

  opsplan: `${STYLE_RULES}

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

  faq: `${STYLE_RULES}

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

  compare: `${STYLE_RULES}

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

  localization: `${STYLE_RULES}

Переведи и локализуй контент страницы на русский язык.

Требования:
- Сохрани оригинальную структуру (заголовки, списки, таблицы)
- Переведи ВСЕ текстовые элементы включая alt text, title, placeholder
- Сохрани технические термины на EN если нет устоявшегося перевода
- Добавь [[term:термин(EN)]] для непереведённых терминов
- Если есть продуктовый copywriting или UI copy, адаптируй тон, а не только слова
- Если есть код — оставь как есть

Вывод: полностью переведённая страница в Markdown.

URL: {url}
TITLE: {title}

CONTENT:
{content}`,

  frontendBuilder: `${STYLE_RULES}

Создай сильную frontend-концепцию на основе контента страницы.

Дай:
1. Лучший формат интерфейса для этого материала
2. IA / page structure
3. Design direction: typography, palette, motion, density
4. Component tree
5. State / interactions
6. File structure
7. Skeleton implementation на React + Tailwind CSS

Требования:
- Не делай generic SaaS-лендинг.
- Нужен intentional visual direction и продуманная иерархия.
- Укажи, что должно быть выше fold и почему.

URL: {url}
TITLE: {title}

SUMMARY:
{summary}

CONTENT:
{content}`,

  renderHost: `${STYLE_RULES}

Подготовь production-grade инструкцию для деплоя на Render.com.

Включи:
1. Тип сервиса и почему
2. Environment variables
3. Build/start commands
4. Persistent storage / cron / worker split при необходимости
5. Логи, health checks, monitoring, rollback
6. SSL / домен / preview environments
7. Cost estimation и ограничения free tier
8. GitHub Actions / webhook / post-deploy checks
9. Альтернативы, если Render — не лучший выбор

URL: {url}
TITLE: {title}

SUMMARY:
{summary}`
};

// Back-compat name: this now attaches the action controller to a note workspace.
function createFloatingHints(noteElement) {
  if (!noteElement || !noteElement.isConnected) return;
  ensureNoteWorkspace(noteElement);
  const actionsVisible = areRightActionButtonsEnabled();
  noteElement.dataset.actionsEnabled = actionsVisible ? 'true' : 'false';
  if (actionsVisible) actionsAnchorNote = noteElement;

  // Ensure container exists
  let container = noteElement.querySelector('.pzdrk-note-actions');
  if (!container) {
    container = document.createElement('div');
    container.className = 'pzdrk-note-actions';
    noteElement.appendChild(container);
  }

  ensureWorkspaceCommandPlaceholders(noteElement);
  renderFloatingHints(noteElement);
  if (actionsVisible) updateNoteActionsPlacement(noteElement);
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

async function translatePageIntoWorkspaceTab(note, tabId, lang = 'ru') {
  const content = lastSummaryData?.pageContent || extractPageContent();
  if (!content || content.trim().length === 0) throw new Error('Нет содержимого для перевода');

  const langNames = { 'ru': 'Русский', 'en': 'English', 'de': 'Deutsch', 'fr': 'Français', 'es': 'Español', 'zh': '中文', 'ja': '日本語' };
  const langName = langNames[lang] || lang.toUpperCase();
  const loadingMsg = lang === 'ru' ? 'Перевожу страницу' : 'Translating page';
  const renderProgress = (p) => {
    const done = Number(p?.done || 0);
    const total = Number(p?.total || 0);
    const pct = total ? Math.round((done / total) * 100) : 0;
    const raw = String(p?.rendered || '');
    const preview = raw.length > 18000 ? `${raw.slice(0, 18000)}\n\n...` : raw;
    setNoteTabContent(note, tabId, `
      <div class="pzdrk-tab-progress">
        <div class="pzdrk-loading"><div class="pzdrk-spinner"></div>${escapeHtml(loadingMsg)}</div>
        <div class="pzdrk-tab-progress-count">${done}/${total || '?'}${total ? ` • ${pct}%` : ''}</div>
      </div>
      <div class="pzdrk-prewrap">${escapeHtml(preview || '')}</div>
    `, {
      title: `Перевод (${langName})`,
      group: 'core',
      kind: 'command',
      cmdId: 'translate_page',
      status: 'loading'
    }, { activate: false, scrollTop: false });
  };

  renderProgress({ done: 0, total: 0, rendered: '' });
  const translated = await translateLargeText(content, lang, renderProgress);
  return formatRichText(translated || '—');
}

async function openCommandInWorkspaceTab(cmd, sourceNote, anchorEl = null, options = {}) {
  if (!cmd || !sourceNote || !sourceNote.isConnected) return runCommand(cmd, { sourceNote });
  ensureNoteWorkspace(sourceNote);
  const shouldActivate = options.activate !== false;
  const forceRefresh = !!options.force || anchorEl?.classList?.contains('force-refresh');

  if (cmd.id === 'summarize') {
    if (shouldActivate) activateNoteTab(sourceNote, 'main');
    return;
  }

  if (cmd.id === 'mindmap') {
    const tabId = getWorkspaceTabIdForCommand(cmd);
    const existingMeta = getNoteTabMeta(sourceNote, tabId);
    const existingPane = sourceNote.querySelector(getNotePaneSelector(tabId));
    if (existingPane && existingMeta?.status === 'loading' && !forceRefresh) {
      if (shouldActivate) activateNoteTab(sourceNote, tabId);
      return;
    }
    if (existingPane && existingMeta?.status === 'ready' && !forceRefresh) {
      if (shouldActivate) activateNoteTab(sourceNote, tabId);
      return;
    }
    setNoteTabContent(sourceNote, tabId, renderStateCard({
      tone: 'waiting',
      icon: '...',
      title: 'Собираю карту',
      body: 'Карта откроется как отдельная вкладка внутри текущей страницы.',
      compact: true
    }), {
      title: 'Карта',
      group: 'core',
      kind: 'command',
      cmdId: 'mindmap',
      status: 'loading'
    }, { activate: shouldActivate, scrollTop: shouldActivate });
    await generateMindmap(sourceNote, { inline: true, inlineTabId: tabId, sourceTabId: 'main', activate: shouldActivate });
    return;
  }

  const tabId = getWorkspaceTabIdForCommand(cmd);
  const title = String(cmd.title || cmd.id || 'Вкладка').trim();
  const group = getCommandGroup(cmd);
  const meta = {
    title,
    group,
    kind: 'command',
    cmdId: cmd.id || tabId,
    status: 'loading'
  };
  const existingMeta = getNoteTabMeta(sourceNote, tabId);
  const existingPane = sourceNote.querySelector(getNotePaneSelector(tabId));

  if (existingPane && existingMeta?.status === 'loading' && !forceRefresh) {
    if (shouldActivate) activateNoteTab(sourceNote, tabId);
    return;
  }

  if (existingPane && existingMeta?.status === 'ready' && !forceRefresh) {
    if (shouldActivate) activateNoteTab(sourceNote, tabId);
    return;
  }

  setNoteTabContent(sourceNote, tabId, renderStateCard({
    tone: 'waiting',
    icon: '...',
    title: `Генерирую вкладку "${title}"`,
    body: 'Команда выполняется внутри текущей страницы, без отдельного всплывающего окна.',
    compact: true
  }), meta, { activate: shouldActivate, scrollTop: shouldActivate });

  try {
    const settings = runtimeSettings || await getSettings().catch(() => ({}));
    let html = '';

    if (cmd.id === 'translate_page') {
      html = await translatePageIntoWorkspaceTab(sourceNote, tabId, 'ru');
    } else if (cmd.id === 'translate_selection') {
      const selectionText = getSelectionText();
      if (!selectionText) throw new Error('Нет выделения');
      const renderProgress = (p) => {
        const done = Number(p?.done || 0);
        const total = Number(p?.total || 0);
        const pct = total ? Math.round((done / total) * 100) : 0;
        const raw = String(p?.rendered || '');
        const preview = raw.length > 18000 ? `${raw.slice(0, 18000)}\n\n...` : raw;
        setNoteTabContent(sourceNote, tabId, `
          <div class="pzdrk-tab-progress">
            <div class="pzdrk-loading"><div class="pzdrk-spinner"></div>Перевожу выделение</div>
            <div class="pzdrk-tab-progress-count">${done}/${total || '?'}${total ? ` • ${pct}%` : ''}</div>
          </div>
          <div class="pzdrk-prewrap">${escapeHtml(preview || '')}</div>
        `, meta, { activate: false, scrollTop: false });
      };
      renderProgress({ done: 0, total: 0, rendered: '' });
      const translated = await translateLargeText(selectionText, 'ru', renderProgress);
      html = formatRichText(translated || '—');
    } else if (cmd.id === 'explain_selection') {
      const selectionText = getSelectionText();
      if (!selectionText) throw new Error('Нет выделения');
      const ctxText = formatBrowserContext(browserContext);
      const userPrompt = `Объясни выделенный фрагмент максимально просто, но без упрощения до потери смысла.

Формат:
## Объяснение
## Ключевые термины
## Где путают
## Что сделать дальше

ВЫДЕЛЕНИЕ:
${selectionText}

PAGE:
${window.location.href}
${document.title}

BROWSER CONTEXT:
${ctxText}`;
      const result = await callGroq(userPrompt, STYLE_RULES, {
        temperature: 0.32,
        max_tokens: getTaskMaxTokens(settings, 1600, 320)
      });
      html = formatRichText(result || '—');
    } else if (isActionFlyoutCommand(cmd)) {
      const cacheKey = getFlyoutCacheKey(cmd, sourceNote);
      const cached = flyoutPrefetchCache.get(cacheKey);
      if (cached?.status === 'done' && cached.html) {
        html = String(cached.html);
      } else {
        const output = await buildFlyoutOutput(cmd, settings, sourceNote);
        html = formatRichText(output || '—');
        flyoutPrefetchCache.set(cacheKey, {
          status: 'done',
          html,
          text: String(output || ''),
          error: '',
          startedAt: Date.now(),
          finishedAt: Date.now(),
          promise: null
        });
        pruneFlyoutPrefetchCache();
      }
    } else {
      await runCommand(cmd, { sourceNote });
      return;
    }

    setNoteTabContent(sourceNote, tabId, html, {
      ...meta,
      status: 'ready'
    }, { activate: shouldActivate, scrollTop: shouldActivate });
  } catch (e) {
    setNoteTabContent(sourceNote, tabId, `<div class="pzdrk-error">Ошибка команды: ${escapeHtml(e?.message || 'не удалось выполнить')}</div>`, {
      ...meta,
      status: 'error'
    }, { activate: shouldActivate, scrollTop: shouldActivate });
  } finally {
    renderFloatingHints(sourceNote);
    updateNoteActionsPlacement(sourceNote);
  }
}

function renderFloatingHints(noteElement = null) {
  const hasSelection = !!getSelectionText();
  const cmds = getHintCommands();
  const notes = noteElement ? [noteElement] : getActionEnabledNotes();

  notes.forEach((note) => {
    if (!note || !note.isConnected) return;
    ensureWorkspaceCommandPlaceholders(note);
    const container = note.querySelector('.pzdrk-note-actions');
    if (!container) return;
    const actionsVisible = areRightActionButtonsEnabled();
    note.dataset.actionsEnabled = actionsVisible ? 'true' : 'false';
    if (!actionsVisible) {
      container.innerHTML = '';
      container.dataset.count = '0';
      container.style.display = 'none';
      return;
    }
    container.style.display = '';

    const btnById = new Map();
    container.innerHTML = '';
    container.dataset.count = String(cmds.length);
    container.classList.toggle('has-selection', hasSelection);

    let currentGroup = '';
    cmds.forEach(cmd => {
      const group = getCommandGroup(cmd);
      if (group !== currentGroup) {
        currentGroup = group;
        const groupEl = document.createElement('div');
        groupEl.className = 'pzdrk-note-actions-group';
        groupEl.dataset.group = group;
        groupEl.textContent = getCommandGroupLabel(group);
        container.appendChild(groupEl);
      }

      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = `pzdrk-note-action${cmd.scope === 'selection' ? ' is-selection' : ''}`;
      btn.setAttribute('data-cmd', cmd.id);
      btn.dataset.group = group;
      btn.dataset.tabId = getWorkspaceTabIdForCommand(cmd);

      const key = (cmd.key || '').toString().toUpperCase();
      const disabled = (cmd.scope === 'selection') && !hasSelection;
      if (disabled) btn.disabled = true;

      btn.innerHTML = `
        <span class="pzdrk-note-action-icon">${escapeHtml(cmd.icon || '⚡')}</span>
        <span class="pzdrk-note-action-main">
          <span class="pzdrk-note-action-text">${escapeHtml(cmd.title || cmd.id)}</span>
          ${cmd.hint ? `<span class="pzdrk-note-action-hint">${escapeHtml(cmd.hint)}</span>` : ''}
        </span>
        ${key ? `<span class="pzdrk-note-action-key">${escapeHtml(key)}</span>` : ''}
      `;
      btn.title = `${cmd.title || cmd.id}${cmd.hint ? ` — ${cmd.hint}` : ''}${key ? ` (${key})` : ''}`;

      btn.classList.toggle('is-workspace-tab', isWorkspaceTabCommand(cmd));

      btn.addEventListener('click', async (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (btn.disabled) return;

        try {
          if (isWorkspaceTabCommand(cmd)) {
            const tabId = getWorkspaceTabIdForCommand(cmd);
            const meta = getNoteTabMeta(note, tabId);
            const pane = note.querySelector(getNotePaneSelector(tabId));
            const canFillSelectionTab = cmd.scope === 'selection' && hasSelection && meta?.status !== 'ready' && meta?.status !== 'loading';

            if (pane && !canFillSelectionTab) {
              activateNoteTab(note, tabId);
              return;
            }

            const keyEl = btn.querySelector('.pzdrk-note-action-key');
            if (keyEl) keyEl.textContent = '...';
            btn.disabled = true;
            btn.classList.add('is-loading');
            await openCommandInWorkspaceTab(cmd, note, btn, { activate: true });
          } else {
            const keyEl = btn.querySelector('.pzdrk-note-action-key');
            if (keyEl) keyEl.textContent = '...';
            btn.disabled = true;
            btn.classList.add('is-loading');
            await runCommand(cmd, { sourceNote: note });
          }
        } finally {
          btn.classList.remove('is-loading');
          renderFloatingHints(note);
          updateNoteActionsPlacement(note);
        }
      });

      container.appendChild(btn);
      btnById.set(cmd.id, btn);
    });

    syncWorkspaceActionActive(note);

    updateNoteActionsPlacement(note);

    if (actionFlyout?.pinned && actionFlyout.cmdId) {
      const pinnedBtn = btnById.get(actionFlyout.cmdId);
      if (pinnedBtn) {
        actionFlyout.anchorEl = pinnedBtn;
        positionActionFlyout(pinnedBtn);
      }
    }
  });
}

function updateNoteActionsPlacement(noteElement = actionsAnchorNote) {
  const note = noteElement;
  if (!note || !note.isConnected) return;
  const container = note.querySelector('.pzdrk-note-actions');
  if (!container) return;
  if (!areRightActionButtonsEnabled() || note.dataset.actionsEnabled !== 'true') {
    container.style.display = 'none';
    return;
  }
  container.style.display = '';

  if (note.classList.contains('docked')) {
    hideActionFlyout(true);
    return;
  }

  container.classList.remove('actions-left', 'actions-overlay');

  const margin = 12;
  const noteRect = note.getBoundingClientRect();
  const containerWidth = Math.max(container.offsetWidth || 0, parseFloat(getComputedStyle(container).width) || 0, 156);
  const nav = note.querySelector('.pzdrk-note-nav');
  const navPenalty = nav && !nav.classList.contains('nav-overlay') ? ((nav.offsetWidth || 0) + 12) : 0;
  const rightSpace = window.innerWidth - noteRect.right - margin;
  const leftSpace = noteRect.left - margin - navPenalty;
  const preferOverlay = window.innerWidth < 1380 || noteRect.width < 540;

  if (!preferOverlay && rightSpace >= containerWidth) {
    // keep default right-side placement
  } else if (!preferOverlay && leftSpace >= containerWidth) {
    container.classList.add('actions-left');
  } else {
    container.classList.add('actions-overlay');
  }

  if (actionFlyout?.note && actionFlyout.note.isConnected) positionActionFlyout(actionFlyout.anchorEl);
}

window.addEventListener('resize', () => {
  getActionEnabledNotes().forEach(note => updateNoteActionsPlacement(note));
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
      await generateMindmap(options?.sourceNote || null);
      return;
    }

    const settings = await getSettings().catch(() => ({ actionPrompts: {} }));
    const ctx = getCommandContext(options?.sourceNote || null);
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
    note.dataset.actionsEnabled = 'true';
    if (options?.sourceNote?.dataset?.noteId) note.dataset.sourceNoteId = options.sourceNote.dataset.noteId;
    if (targetNote) {
      const titleEl = note.querySelector('.pzdrk-note-title');
      if (titleEl) titleEl.textContent = action.title || 'Action';
      const contentEl = note.querySelector('.pzdrk-note-content');
      if (contentEl && !contentEl.innerHTML.trim()) {
        contentEl.innerHTML = '<div class="pzdrk-loading"><div class="pzdrk-spinner"></div></div>';
      }
      note.classList.add('loading');
    }

    const result = await callGroq(prompt, STYLE_RULES, { temperature: 0.35, max_tokens: getTaskMaxTokens(settings, 1800, 256) });
    note.querySelector('.pzdrk-note-content').innerHTML = formatRichText(result);
    note.classList.remove('loading');
    setupHoverInteractions(note);
    createFloatingHints(note);
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

function ensureInlineMindmapTarget(note, tabId = 'main') {
  if (!note || !note.isConnected) return null;
  ensureNoteWorkspace(note);
  const targetTabId = String(tabId || 'main');
  const isMainTab = targetTabId === 'main';
  const pane = getOrCreateNoteTabPane(note, targetTabId, {
    title: isMainTab ? 'Главная' : 'Карта',
    group: 'core',
    kind: isMainTab ? 'main' : 'command',
    cmdId: isMainTab ? 'summarize' : 'mindmap',
    status: isMainTab ? 'ready' : 'loading'
  });
  if (!pane) return null;

  let section = pane.querySelector('[data-pzdrk-inline-mindmap]');
  if (!section) {
    if (!isMainTab) pane.innerHTML = '';
    section = document.createElement('div');
    section.className = 'pzdrk-section pzdrk-inline-map-section';
    section.dataset.sec = 'workspace-map';
    section.setAttribute('data-pzdrk-inline-mindmap', 'true');
    const titleId = isMainTab ? 'pzdrk-sec-workspace-map' : `pzdrk-sec-workspace-map-${slugifyForId(targetTabId) || simpleHash32(targetTabId)}`;
    const intro = isMainTab
      ? 'Кластерная карта этой страницы встроена в главную вкладку, чтобы не разносить смысл по отдельным окнам.'
      : 'Кластерная карта открыта как вкладка этой страницы, без отдельного всплывающего окна.';
    section.innerHTML = `
      <div class="pzdrk-section-title" id="${titleId}">Карта</div>
      <div class="pzdrk-section-intro">${intro}</div>
      <div class="pzdrk-inline-map-body"></div>
    `;
    const related = pane.querySelector('.pzdrk-related-section');
    if (related?.parentElement === pane) pane.insertBefore(section, related);
    else pane.appendChild(section);
  }
  return section.querySelector('.pzdrk-inline-map-body') || section;
}

async function generateMindmap(sourceNote = null, options = {}) {
  const settings = runtimeSettings || await getSettings().catch(() => ({}));
  const rawPageContent = lastSummaryData?.pageContent || extractPageContent();
  const inlineTabId = String(options.inlineTabId || options.tabId || 'main');
  const sourceTabId = String(options.sourceTabId || (inlineTabId !== 'main' ? 'main' : '') || '');
  const sourcePane = sourceTabId
    ? sourceNote?.querySelector?.(getNotePaneSelector(sourceTabId))
    : getActiveNotePane(sourceNote);
  const sourceText = String(sourcePane?.innerText || sourceNote?.querySelector?.('.pzdrk-note-content')?.innerText || '').trim();
  const sourceTitle = String(sourceNote?.querySelector?.('.pzdrk-note-title')?.textContent || '').trim();
  const content = clipPromptInput(
    sourceText
      ? `ФОКУС-КАРТОЧКА: ${sourceTitle || 'текущий результат'}\n${sourceText}\n\nКОНТЕНТ СТРАНИЦЫ:\n${rawPageContent}`
      : rawPageContent,
    3200
  );
  const summary = clipPromptInput(
    sourceText
      ? `ФОКУС-КАРТОЧКА: ${sourceTitle || 'текущий результат'}\n${sourceText.slice(0, 1400)}\n\nСВОДКА СТРАНИЦЫ:\n${lastSummaryContent || ''}`
      : (lastSummaryContent || ''),
    1600
  );

  const inlineMode = !!options.inline && sourceNote && sourceNote.isConnected && sourceNote.dataset.layout !== 'flyout';
  const note = inlineMode ? sourceNote : createNote({
    title: 'Карта',
    type: 'mindmap',
    content: '<div class="pzdrk-loading"><div class="pzdrk-spinner"></div>Собираю карту темы…</div>',
    collapsed: false,
    loading: true
  });
  note.dataset.pinned = 'true';
  note.dataset.actionsEnabled = 'true';
  if (!inlineMode) {
    note.style.width = 'min(1040px, calc(100vw - 56px))';
    note.style.maxWidth = 'min(1040px, calc(100vw - 32px))';
    note.style.maxHeight = '82vh';
  }

  try {
    const contentEl = inlineMode ? ensureInlineMindmapTarget(note, inlineTabId) : note.querySelector('.pzdrk-note-content');
    const setMindmapStage = (title, detail = '') => {
      if (!contentEl) return;
      contentEl.innerHTML = renderStateCard({
        tone: 'waiting',
        icon: '🗺',
        title,
        body: detail || 'Сначала собираю каркас, затем расширяю кластеры, сигналы и вопросы.',
        compact: true
      });
    };

    const repairMindmapObject = async (raw) => {
      const repaired = await callGroq(
        `Исправь ответ в корректный JSON объект mindmap. Верни ТОЛЬКО JSON без Markdown и комментариев.\n\nRAW:\n${String(raw || '').slice(0, 12000)}`,
        'Только JSON объект.',
        { temperature: 0.0, max_tokens: getTaskMaxTokens(settings, 2400, 700) }
      );
      return normalizeMindmapData(repaired);
    };

    const repairMindmapArray = async (raw) => {
      const repaired = await callGroq(
        `Исправь ответ в корректный JSON массив children. Верни ТОЛЬКО JSON массив без Markdown и комментариев.\n\nRAW:\n${String(raw || '').slice(0, 8000)}`,
        'Только JSON массив.',
        { temperature: 0.0, max_tokens: getTaskMaxTokens(settings, 1200, 300) }
      );
      return parseJsonArray(repaired);
    };

    // 1. Initial scaffold
    setMindmapStage('Собираю глубокий каркас карты…', 'Сначала плотный каркас с кластерами и подветками, потом точечно углубляю развилки.');
    const prompt = getPromptOverride('mindmap', settings)
      .replace('{content}', content)
      .replace('{summary}', summary || '—');
    const result = await callGroq(prompt, 'Только JSON объект.', { temperature: 0.22, max_tokens: getTaskMaxTokens(settings, 2600, 820) });

    let data = normalizeMindmapData(result);
    if (!data) data = await repairMindmapObject(result).catch(() => null);
    if (!data) throw new Error('JSON карты невалиден');

    const expandedIds = new Set();
    const expandMindmapTargets = async (targets, stageTitle, contentLimit = 2200, outputBudget = 760) => {
      const uniqueTargets = (Array.isArray(targets) ? targets : []).filter((node) => {
        const nodeId = String(node?.id || '').trim();
        if (!nodeId || expandedIds.has(nodeId)) return false;
        expandedIds.add(nodeId);
        return true;
      });
      if (!uniqueTargets.length) return;

      let completed = 0;
      setMindmapStage(stageTitle, `${completed}/${uniqueTargets.length}`);

      await runWithConcurrency(uniqueTargets, getAdaptiveParallelLimit(settings, Math.min(64, Math.max(4, uniqueTargets.length)), 64, 2), async (node) => {
        const existingChildren = (node.children || []).map(child => `- ${child.label}`).join('\n') || '—';
        const flatten = flattenMindmapNodes(data.nodes);
        const nodeDepth = flatten.find(entry => entry.node === node)?.depth ?? 0;
        const inheritedGroup = normalizeMindmapGroup(node.group || '', node.label || '');
        const expandPrompt = getPromptOverride('mindmapExpand', settings)
          .replace('{label}', node.label)
          .replace('{description}', node.description || '—')
          .replace('{existingChildren}', existingChildren)
          .replace('{content}', buildMindmapExpansionContext(content, summary, node, contentLimit))
          .replace('{summary}', summary || '—');

        const rawChildren = await callGroq(expandPrompt, 'Только JSON массив.', {
          temperature: 0.24,
          max_tokens: getTaskMaxTokens(settings, outputBudget, 280)
        }).catch(() => '');

        let parsedChildren = parseJsonArray(rawChildren);
        if (!parsedChildren) parsedChildren = await repairMindmapArray(rawChildren).catch(() => null);

        if (parsedChildren) {
          const normalizedChildren = normalizeMindmapNodes(parsedChildren, `${node.id}_`, nodeDepth + 1, MINDMAP_TREE_MAX_DEPTH, inheritedGroup);
          if (normalizedChildren.length) {
            node.children = mergeMindmapChildren(node.children || [], normalizedChildren, {
              prefix: `${node.id}_`,
              depth: nodeDepth + 1,
              maxDepth: MINDMAP_TREE_MAX_DEPTH,
              inheritedGroup
            });
          }
        }

        completed++;
        setMindmapStage(stageTitle, `${completed}/${uniqueTargets.length}`);
      });
    };

    // 2. Adaptive multi-wave expansion: deeper map, smaller/faster payloads per wave
    for (const wave of buildMindmapExpansionPlan(data)) {
      const pickedTargets = wave.pickTargets?.();
      const targets = Array.isArray(pickedTargets) ? pickedTargets : [];
      if (!targets.length) continue;
      await expandMindmapTargets(targets, wave.title, wave.contentLimit, wave.maxTokens);
    }

    data.metadata = {
      ...(data.metadata || {}),
      nodeCount: countMindmapNodes(data.nodes),
      leafCount: countMindmapLeaves(data.nodes),
      clusterCount: data.nodes.length,
      maxDepth: getMindmapMaxDepth(data.nodes),
      branchCount: countMindmapBranches(data.nodes),
      mapStyle: String(data.metadata?.mapStyle || 'clustered-lanes').trim().slice(0, 24) || 'clustered-lanes'
    };
    const allEdgeLinks = buildMindmapEdgeOverview(data, 200);
    data.metadata.edgeCount = allEdgeLinks.length;
    const edgeTargetLookup = new Map();
    allEdgeLinks
      .filter(item => item?.targetId)
      .forEach((item) => {
        const label = String(item.label || '').trim();
        const targetId = String(item.targetId || '').trim();
        if (!targetId) return;
        const targetLabel = label.includes('→') ? label.split('→').pop() : label;
        const targetKey = String(targetLabel || '').trim().toLowerCase();
        if (targetKey && !edgeTargetLookup.has(targetKey)) edgeTargetLookup.set(targetKey, targetId);
      });

    // Render Mindmap
    const renderLane = (title, items, variant, icon) => {
      const list = normalizeStringList(items || [], 4, 180);
      if (!list.length) return '';
      return `<div class="pzdrk-mm-lane pzdrk-mm-lane-${variant}">
        <div class="pzdrk-mm-lane-title"><span class="pzdrk-mm-lane-icon">${icon}</span>${escapeHtml(title)}</div>
        <div class="pzdrk-mm-lane-items">
          ${list.map(item => `<div class="pzdrk-mm-lane-item">${formatRichInline(stripMindmapEdgeMarkup(item))}</div>`).join('')}
        </div>
      </div>`;
    };

    const renderEdgeLane = (refs = []) => {
      const list = Array.from(new Set((Array.isArray(refs) ? refs : []).map(ref => normalizeMindmapGroup(ref, '')).filter(Boolean))).slice(0, 4);
      if (!list.length) return '';
      return `<div class="pzdrk-mm-lane pzdrk-mm-lane-edge">
        <div class="pzdrk-mm-lane-title"><span class="pzdrk-mm-lane-icon">↔</span>Связи</div>
        <div class="pzdrk-mm-lane-items">
          ${list.map((ref) => {
            const targetId = edgeTargetLookup.get(String(ref).toLowerCase()) || '';
            const body = escapeHtml(`Связь с ${ref}`);
            if (targetId) {
              return `<button class="pzdrk-mm-lane-item pzdrk-mm-lane-item-link" type="button" data-mm-jump="${escapeAttr(targetId)}">${body}</button>`;
            }
            return `<div class="pzdrk-mm-lane-item">${body}</div>`;
          }).join('')}
        </div>
      </div>`;
    };

    const renderOverviewCard = (title, items, tone, icon) => {
      const list = Array.isArray(items) ? items : [];
      if (!list.length) return '';
      return `<div class="pzdrk-mm-focus-card pzdrk-mm-focus-card-${tone}">
        <div class="pzdrk-mm-focus-title"><span class="pzdrk-mm-focus-icon">${icon}</span>${escapeHtml(title)}</div>
        <div class="pzdrk-mm-focus-items">
          ${list.map(item => {
            const targetId = String(item?.targetId || '').trim();
            const tag = targetId ? 'button' : 'div';
            const attrs = targetId ? ` type="button" class="pzdrk-mm-focus-item pzdrk-mm-focus-item-link" data-mm-jump="${escapeAttr(targetId)}"` : ` class="pzdrk-mm-focus-item"`;
            return `<${tag}${attrs}>
              <div class="pzdrk-mm-focus-item-label">${escapeHtml(item.label || 'Узел')}</div>
              <div class="pzdrk-mm-focus-item-text">${formatRichInline(item.text || '')}</div>
            </${tag}>`;
          }).join('')}
        </div>
      </div>`;
    };

    const renderNode = (node, level = 0, parentGroup = '') => {
      const hasChildren = Array.isArray(node?.children) && node.children.length > 0;
      const normalizedKind = normalizeMindmapKind(node?.kind, level);
      const kindLabel = mindmapKindLabel(normalizedKind, level);
      const groupLabel = normalizeMindmapGroup(node?.group || '', parentGroup);
      const childCount = countMindmapNodes(node.children || []);
      const signalCount = countMindmapSignals(node);
      const edgeRefs = extractMindmapEdgeRefs(node?.description, node?.insights, node?.evidence, node?.questions);
      const edgeCount = edgeRefs.length;
      const searchText = escapeAttr(getMindmapSearchText(node));
      const nodeModes = escapeAttr(getMindmapModesForNode(node).join(' '));
      const classes = ['pzdrk-mm-node', `pzdrk-mm-level-${Math.min(level, 4)}`, `pzdrk-mm-kind-${normalizedKind}`];
      if (level === 0) classes.push('pzdrk-mm-cluster');
      if (hasChildren) classes.push('pzdrk-mm-branch');
      if (hasChildren && level >= 2) classes.push('collapsed');

      let html = `<div class="${classes.join(' ')}" data-level="${level}" data-search="${searchText}" data-kind="${escapeAttr(normalizedKind)}" data-modes="${nodeModes}" data-node-id="${escapeAttr(node.id || '')}">`;
      html += `<div class="pzdrk-mm-header">
        <div class="pzdrk-mm-header-main">
          ${hasChildren ? '<span class="pzdrk-mm-toggle">▼</span>' : '<span class="pzdrk-mm-bullet">●</span>'}
          <div class="pzdrk-mm-title-wrap">
            <div class="pzdrk-mm-label">${escapeHtml(node.label)}</div>
          </div>
        </div>
        <div class="pzdrk-mm-badges">
          <span class="pzdrk-mm-badge pzdrk-mm-badge-kind">${escapeHtml(kindLabel)}</span>
          ${groupLabel && groupLabel !== node.label ? `<span class="pzdrk-mm-badge pzdrk-mm-badge-group">${escapeHtml(groupLabel)}</span>` : ''}
          ${signalCount ? `<span class="pzdrk-mm-badge pzdrk-mm-badge-signals">${signalCount} линий</span>` : ''}
          ${edgeCount ? `<span class="pzdrk-mm-badge pzdrk-mm-badge-edges">${edgeCount} связи</span>` : ''}
          ${hasChildren ? `<span class="pzdrk-mm-count">${childCount}</span>` : ''}
        </div>
      </div>`;

      if (node.description) {
        html += `<div class="pzdrk-mm-desc">${formatRichText(stripMindmapEdgeMarkup(node.description))}</div>`;
      }

      const lanes = [
        renderLane('Линии', node.insights || [], 'insight', '✦'),
        renderLane('Сигналы', node.evidence || [], 'evidence', '◦'),
        renderLane('Проверить', node.questions || [], 'question', '?'),
        renderEdgeLane(edgeRefs)
      ].filter(Boolean);
      if (lanes.length) {
        html += `<div class="pzdrk-mm-lanes">${lanes.join('')}</div>`;
      }

      if (hasChildren) {
        const groupedChildren = groupMindmapNodesByGroup(node.children, level + 1, groupLabel || node.label);
        const showGroupTitles = groupedChildren.length > 1 || (
          groupedChildren.length === 1
          && groupedChildren[0].label
          && groupedChildren[0].label !== (groupLabel || node.label)
        );
        html += `<div class="pzdrk-mm-children${level === 0 ? ' pzdrk-mm-children-top' : ''}">`;
        groupedChildren.forEach((group) => {
          if (showGroupTitles && group.label) {
            html += `<div class="pzdrk-mm-group-title" data-mm-group-title>${escapeHtml(group.label)}</div>`;
          }
          group.items.forEach((child) => {
            html += renderNode(child, level + 1, group.label || groupLabel || node.label);
          });
        });
        html += `</div>`;
      }

      html += `</div>`;
      return html;
    };

    const meta = data.metadata || {};
    const localizeMetaValue = (key, value) => {
      const raw = String(value || '').trim();
      if (!raw) return '—';
      const normalized = raw.toLowerCase();
      if (key === 'complexity') {
        if (normalized === 'high') return 'высокая';
        if (normalized === 'medium') return 'средняя';
        if (normalized === 'low') return 'низкая';
      }
      if (key === 'coverage') {
        if (normalized === 'broad') return 'широкое';
        if (normalized === 'medium') return 'среднее';
        if (normalized === 'narrow') return 'узкое';
      }
      if (key === 'mapStyle') {
        if (normalized === 'clustered-lanes' || normalized === 'clustered') return 'кластерный';
      }
      return raw;
    };
    const overview = buildMindmapOverview(data, 4);
    const edgeOverview = allEdgeLinks.slice(0, 5);
    const searchStatusDefault = 'Поиск по названиям, группам, описаниям, сигналам и вопросам';
    let activeMode = 'all';
    const modeLabels = {
      all: 'все узлы',
      risks: 'риски',
      signals: 'сигналы',
      questions: 'вопросы',
      tools: 'инструменты'
    };

    let html = `<div class="pzdrk-mm-toolbar">
      <div class="pzdrk-mm-search-wrap">
        <input class="pzdrk-mm-search" type="search" data-mm-search placeholder="Фильтр по кластерам, группам, сигналам и вопросам…" />
        <button class="pzdrk-mm-tool" data-mm-action="clear-filter">Сбросить</button>
      </div>
      <div class="pzdrk-mm-modebar">
        <button class="pzdrk-mm-tool is-active" data-mm-mode="all">Все</button>
        <button class="pzdrk-mm-tool" data-mm-mode="risks">Риски</button>
        <button class="pzdrk-mm-tool" data-mm-mode="signals">Сигналы</button>
        <button class="pzdrk-mm-tool" data-mm-mode="questions">Вопросы</button>
        <button class="pzdrk-mm-tool" data-mm-mode="tools">Инструменты</button>
      </div>
      <button class="pzdrk-mm-tool" data-mm-action="clusters-only">Только кластеры</button>
      <button class="pzdrk-mm-tool" data-mm-action="expand-3">3 уровня</button>
      <button class="pzdrk-mm-tool" data-mm-action="expand-all">Раскрыть всё</button>
      <button class="pzdrk-mm-tool" data-mm-action="copy-outline">Скопировать план</button>
      <button class="pzdrk-mm-tool" data-mm-action="copy-checklist">Чеклист</button>
      <button class="pzdrk-mm-tool" data-mm-action="copy-mermaid">Скопировать Mermaid</button>
      <div class="pzdrk-mm-search-status" data-mm-search-status>${searchStatusDefault}</div>
    </div>`;

    html += `<div class="pzdrk-mm-overview">
      <div class="pzdrk-mm-overview-title">Кластерная карта</div>
      <div class="pzdrk-mm-overview-subtitle">Разложено по смысловым веткам, сигналам, ограничениям и следующим точкам проверки.</div>
      <div class="pzdrk-mm-overview-pills">
        <span class="pzdrk-mm-overview-pill">домен: ${escapeHtml(meta.domain || '—')}</span>
        <span class="pzdrk-mm-overview-pill">сложность: ${escapeHtml(localizeMetaValue('complexity', meta.complexity))}</span>
        <span class="pzdrk-mm-overview-pill">покрытие: ${escapeHtml(localizeMetaValue('coverage', meta.coverage || 'medium'))}</span>
        <span class="pzdrk-mm-overview-pill">стиль: ${escapeHtml(localizeMetaValue('mapStyle', meta.mapStyle || 'clustered-lanes'))}</span>
      </div>
      ${overview.focusClusters.length ? `<div class="pzdrk-mm-focus-strip">
        ${overview.focusClusters.map(cluster => `<button class="pzdrk-mm-focus-chip" data-mm-focus="${escapeAttr(cluster.id)}">${escapeHtml(cluster.label)}</button>`).join('')}
      </div>` : ''}
    </div>`;

    html += `<div class="pzdrk-mm-focus-grid">
      ${renderOverviewCard('Сильные сигналы', overview.topSignals, 'signal', '◦')}
      ${renderOverviewCard('Связи между ветками', edgeOverview, 'edge', '↔')}
      ${renderOverviewCard('Риски и ограничения', overview.topRisks, 'risk', '!')}
      ${renderOverviewCard('Что проверить', overview.topQuestions, 'question', '?')}
      ${renderOverviewCard('Инструменты и артефакты', overview.topTools, 'tool', '⌘')}
    </div>`;

    html += `<div class="pzdrk-mm-empty" data-mm-empty hidden>По этому фильтру узлы не найдены.</div>`;
    html += `<div class="pzdrk-mindmap">`;
    data.nodes.forEach(node => { html += renderNode(node, 0); });

    html += `<div class="pzdrk-mm-metadata">
      <div class="pzdrk-mm-meta-item">Кластеров: ${escapeHtml(meta.clusterCount || data.nodes.length)}</div>
      <div class="pzdrk-mm-meta-item">Узлов: ${escapeHtml(meta.nodeCount || countMindmapNodes(data.nodes))}</div>
      <div class="pzdrk-mm-meta-item">Листьев: ${escapeHtml(meta.leafCount || countMindmapLeaves(data.nodes))}</div>
      <div class="pzdrk-mm-meta-item">Веток: ${escapeHtml(meta.branchCount || countMindmapBranches(data.nodes))}</div>
      <div class="pzdrk-mm-meta-item">Глубина: ${escapeHtml(meta.maxDepth || getMindmapMaxDepth(data.nodes))}</div>
      <div class="pzdrk-mm-meta-item">Связей: ${escapeHtml(meta.edgeCount || allEdgeLinks.length)}</div>
    </div>`;

    html += `</div>`;

    contentEl.innerHTML = html;
    note.classList.remove('loading');
    if (inlineMode) {
      upsertNoteTabMeta(note, inlineTabId, { status: 'ready', updatedAt: Date.now() });
      if (options.activate !== false) {
        activateNoteTab(note, inlineTabId, { scrollTop: false });
        const section = note.querySelector(`${getNotePaneSelector(inlineTabId)} [data-pzdrk-inline-mindmap]`) || note.querySelector('[data-pzdrk-inline-mindmap]');
        section?.scrollIntoView({ behavior: 'smooth', block: 'start', inline: 'nearest' });
      } else {
        syncWorkspaceActionActive(note);
      }
    }
    const titleEl = note.querySelector('.pzdrk-note-title');
    if (titleEl && !inlineMode) titleEl.textContent = String(data.title || 'Карта').slice(0, 60);
    const mindmapRoot = inlineMode ? contentEl : note;
    const treeEl = mindmapRoot.querySelector('.pzdrk-mindmap');
    const searchInput = mindmapRoot.querySelector('[data-mm-search]');
    const searchStatus = mindmapRoot.querySelector('[data-mm-search-status]');
    const emptyState = mindmapRoot.querySelector('[data-mm-empty]');
    const modeButtons = Array.from(mindmapRoot.querySelectorAll('[data-mm-mode]'));
    applyMindmapExpandToLevel(treeEl, 3);
    refreshMindmapGroupTitleVisibility(treeEl);

    const jumpToMindmapNode = (targetId) => {
      if (!targetId || !treeEl) return;
      if (searchInput?.value) {
        searchInput.value = '';
      }
      const selectorId = (typeof CSS !== 'undefined' && typeof CSS.escape === 'function')
        ? CSS.escape(String(targetId))
        : String(targetId).replace(/["\\]/g, '\\$&');
      const target = treeEl.querySelector(`[data-node-id="${selectorId}"]`);
      if (!target) return;
      let parent = target.parentElement;
      while (parent) {
        if (parent.classList?.contains('pzdrk-mm-node')) {
          parent.classList.remove('collapsed');
        }
        parent = parent.parentElement;
      }
      updateMindmapFilter('');
      target.classList.remove('pzdrk-mm-flash');
      void target.offsetWidth;
      target.classList.add('pzdrk-mm-flash');
      target.scrollIntoView({ behavior: 'smooth', block: 'start', inline: 'nearest' });
    };

    const updateMindmapFilter = (value = '') => {
      const term = String(value || '').trim();
      if (!treeEl) return;
      if (!term) {
        treeEl.querySelectorAll('.pzdrk-mm-hidden, .pzdrk-mm-match').forEach(nodeEl => {
          nodeEl.classList.remove('pzdrk-mm-hidden', 'pzdrk-mm-match');
        });
        if (activeMode === 'all') applyMindmapExpandToLevel(treeEl, 3);
        refreshMindmapGroupTitleVisibility(treeEl);
        if (emptyState) emptyState.hidden = true;
      } else {
        const stats = applyMindmapFilter(treeEl, term, activeMode);
        if (emptyState) emptyState.hidden = stats.visible > 0;
        if (searchStatus) {
          const modeLine = activeMode === 'all' ? '' : ` • режим: ${modeLabels[activeMode] || activeMode}`;
          searchStatus.textContent = stats.visible > 0
            ? `Совпадений: ${stats.matched} • Видимых узлов: ${stats.visible}${modeLine}`
            : 'Совпадений не найдено';
        }
        return;
      }

      const stats = applyMindmapFilter(treeEl, '', activeMode);
      if (emptyState) emptyState.hidden = stats.visible > 0;
      if (searchStatus) {
        searchStatus.textContent = stats.visible > 0
          ? (activeMode === 'all'
            ? searchStatusDefault
            : `Режим: ${modeLabels[activeMode] || activeMode} • Видимых узлов: ${stats.visible}`)
          : 'Совпадений не найдено';
      }
    };

    const setMindmapMode = (mode = 'all') => {
      activeMode = String(mode || 'all').trim().toLowerCase() || 'all';
      modeButtons.forEach((btn) => {
        btn.classList.toggle('is-active', btn.getAttribute('data-mm-mode') === activeMode);
      });
      updateMindmapFilter(searchInput?.value || '');
    };

    if (searchInput) {
      searchInput.addEventListener('input', () => updateMindmapFilter(searchInput.value));
      searchInput.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
          e.preventDefault();
          searchInput.value = '';
          updateMindmapFilter('');
          searchInput.blur();
        }
      });
    }

    modeButtons.forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        setMindmapMode(btn.getAttribute('data-mm-mode') || 'all');
      });
    });

    // Toggle behavior
    mindmapRoot.querySelectorAll('.pzdrk-mm-header').forEach(header => {
      header.addEventListener('click', (e) => {
        e.stopPropagation();
        const nodeEl = header.parentElement;
        if (!nodeEl?.querySelector(':scope > .pzdrk-mm-children')) return;
        nodeEl.classList.toggle('collapsed');
      });
    });

    mindmapRoot.querySelectorAll('[data-mm-action]').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.preventDefault();
        e.stopPropagation();
        const action = btn.getAttribute('data-mm-action');
        if (!treeEl) return;

        if (action === 'clear-filter') {
          if (searchInput) searchInput.value = '';
          updateMindmapFilter('');
          showToast('🔎 Фильтр очищен');
          return;
        }
        if (action === 'clusters-only') {
          setMindmapMode('all');
          treeEl.querySelectorAll(':scope > .pzdrk-mm-node').forEach(nodeEl => nodeEl.classList.add('collapsed'));
          showToast('🧩 Оставил только главные кластеры');
          return;
        }
        if (action === 'expand-3') {
          applyMindmapExpandToLevel(treeEl, 3);
          showToast('🗂 Раскрыто до 3 уровней');
          return;
        }
        if (action === 'expand-all') {
          treeEl.querySelectorAll('.pzdrk-mm-node.collapsed').forEach(nodeEl => nodeEl.classList.remove('collapsed'));
          showToast('🧭 Все ветки раскрыты');
          return;
        }
        if (action === 'copy-outline') {
          await copyTextToClipboard(buildMindmapOutline(data));
          showToast('📋 План скопирован');
          return;
        }
        if (action === 'copy-checklist') {
          await copyTextToClipboard(buildMindmapChecklist(data));
          showToast('📋 Чеклист скопирован');
          return;
        }
        if (action === 'copy-mermaid') {
          await copyTextToClipboard(buildMindmapMermaid(data));
          showToast('📋 Mermaid скопирован');
        }
      });
    });

    mindmapRoot.querySelectorAll('[data-mm-focus]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        jumpToMindmapNode(btn.getAttribute('data-mm-focus'));
      });
    });

    mindmapRoot.querySelectorAll('[data-mm-jump]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        jumpToMindmapNode(btn.getAttribute('data-mm-jump'));
      });
    });

    setupHoverInteractions(note);
    createFloatingHints(note);

  } catch (error) {
    const contentEl = inlineMode ? ensureInlineMindmapTarget(note, inlineTabId) : note.querySelector('.pzdrk-note-content');
    if (contentEl) contentEl.innerHTML = `<div class="pzdrk-error">Ошибка карты: ${escapeHtml(error.message)}</div>`;
    if (inlineMode) upsertNoteTabMeta(note, inlineTabId, { status: 'error', updatedAt: Date.now() });
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
    try { sendResponse?.({ success: true }); } catch (e) { }
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
