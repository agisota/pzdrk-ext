import"./modulepreload-polyfill-B5Qt9EMX.js";document.addEventListener("DOMContentLoaded",async()=>{const me="groq/compound",le="gpt-oss-120b",se="local-overrides.json",i=`Режим: staff operator / research copilot.
- Сначала восстанови цель пользователя, decision surface и рабочий контекст.
- Разделяй: факт / inference / гипотеза / что проверить / next step.
- Предпочитай layered output: сигнал -> как устроено -> риски -> действия.
- Всегда пиши основной ответ по-русски. Если исходник на английском, переводи смысл, а не копируй английские фразы.
- Английский допустим только для точных названий продуктов, API, команд, URL и цитируемых терминов; рядом давай русское объяснение.
- Не пиши generic советы; давай сильные варианты, trade-offs, failure modes и checkpoints.
- Если есть несколько путей, сравни их по скорости внедрения, риску и качеству результата.
- Если данных не хватает, явно фиксируй пробелы и предлагай способ валидации вместо фантазий.
- Если tool-use/поиск реально повышает точность, закладывай это как часть решения.
- Каждый ответ должен возвращать рабочий артефакт: таблицу, план, чеклист, матрицу, бриф, сценарий, список проверок или готовый текст.
- Для action-oriented задач указывай owner/следующий шаг/критерий готовности, если это применимо по контексту.
- Отмечай confidence и источник уверенности: прямой факт, inference, гипотеза или внешний пробел.
- Не смешивай summary и recommendation: сначала сигнал, затем вариант решения, затем риск и проверка.
- Стиль: плотно, профессионально, инженерно, без воды и без маркетингового тона.`,de=await chrome.storage.sync.get(["coreProvider","groqApiKey","groqApiKeys","cerebrasApiKeys","model","modelGroq","modelCerebras","maxParallelRequests","targetMaxOutputTokens","prefetchOnHover","prefetchDelayMs","mapReduceEnabled","summaryPrompt","byokMode","autoSummarize","classicMode","privacyEnabled","voiceProvider","voiceApiKey","voiceChatMode","voicePersonality","autoSpeakSummary","actionPrompts","twoColumnSummary","summaryJsonPrompt","sectionEnrichPrompt","showLeftNavButtons","showRightActionButtons","artifactAutoSave","promptOverrides"]),y=await chrome.storage.local.get(["telegramEnabled","telegramBotToken","telegramChatId","telegramSendHtml","telegramSendMarkdown"]);async function ue(){try{const t=await fetch(chrome.runtime.getURL(se),{cache:"no-store"});if(!t.ok)return null;const e=await t.json().catch(()=>null);return e&&typeof e=="object"?e:null}catch{return null}}function T(t){return String(t||"").split(/\r?\n/).map(e=>e.trim()).filter(Boolean)}function f(t){return Array.from(new Set((Array.isArray(t)?t:[]).map(e=>String(e||"").trim()).filter(Boolean)))}function v(t,e={}){return new Promise((n,o)=>{chrome.runtime.sendMessage({action:t,...e},c=>{if(chrome.runtime.lastError){o(new Error(chrome.runtime.lastError.message));return}c?.success?n(c.data):o(new Error(c?.error||`${t} failed`))})})}function M(t,e,n="text/plain;charset=utf-8"){const o=new Blob([String(e||"")],{type:n}),c=URL.createObjectURL(o),m=document.createElement("a");m.href=c,m.download=t,document.body.appendChild(m),m.click(),m.remove(),setTimeout(()=>URL.revokeObjectURL(c),1200)}function ge(t){return String(t).trim().replace(/[^\wа-яА-ЯёЁ.-]+/g,"-").replace(/-+/g,"-").replace(/^-|-$/g,"").slice(0,90)||"pzdrk"}function pe(t,e){if(!e||typeof e!="object")return t;const n={...t},o=f(T(e.groqApiKeys)),c=f(T(e.cerebrasApiKeys));o.length&&(n.groqApiKeys=o),c.length&&(n.cerebrasApiKeys=c);for(const m of["coreProvider","model","modelGroq","modelCerebras"]){const l=String(e[m]||"").trim();l&&(n[m]=l)}for(const m of["maxParallelRequests","targetMaxOutputTokens","prefetchDelayMs"]){const l=Number(e[m]);Number.isFinite(l)&&(n[m]=l)}for(const m of["byokMode","prefetchOnHover","mapReduceEnabled","twoColumnSummary","showLeftNavButtons","showRightActionButtons","artifactAutoSave"])typeof e[m]=="boolean"&&(n[m]=e[m]);return e.promptOverrides&&typeof e.promptOverrides=="object"&&(n.promptOverrides=e.promptOverrides),(o.length||c.length)&&(n.byokMode=!0),n}const r=pe(de,await ue());function b(t){return f(t).join(`
`)}function A(){return String(r.coreProvider||"groq").trim().toLowerCase()==="cerebras"?"cerebras":"groq"}function h(t){const e=String(t||"").trim();return["gpt-oss-120b","llama3.1-8b","llama-3.3-70b","qwen-3-32b","qwen-3-235b-a22b-instruct-2507","zai-glm-4.6"].includes(e)}function R(t){return["","compound","moonshotai/kimi-k2-instruct","moonshotai/kimi-k2-instruct-0905"].includes(String(t||"").trim())}function p(t){if(t==="cerebras"){const o=String(r.modelCerebras||"").trim();if(o)return o;const c=String(r.model||"").trim();return h(c)?c:le}const e=String(r.modelGroq||"").trim();if(e&&!R(e))return e;const n=String(r.model||"").trim();return!n||h(n)||R(n)?me:n}function w(t){if(!g)return;const e=String(t||"groq").toLowerCase()==="cerebras"?"cerebras":"groq",n=Array.from(g.querySelectorAll("option"));let o=!1;for(const c of n){const l=(String(c.dataset.provider||"").trim().toLowerCase()||(h(c.value)?"cerebras":"groq"))===e;c.hidden=!l,c.disabled=!l,c.value===g.value&&l&&(o=!0)}o||(g.value=p(e))}const a={twitter:`${i}

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
{browserContext}`,deepdive:`${i}

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
{browserContext}`,automation:`${i}

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
{browserContext}`,learning:`${i}

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
{content}`,share:`${i}

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
{summary}`,challenge:`${i}

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
{content}`,timeline:`${i}

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
{browserContext}`,extract:`${i}

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
{browserContext}`,briefing:`${i}

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
{browserContext}`,matrix:`${i}

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
{browserContext}`,sources:`${i}

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
{browserContext}`,opsplan:`${i}

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
{browserContext}`,faq:`${i}

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
{browserContext}`,compare:`${i}

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
{browserContext}`,localization:`${i}

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
{content}`,frontendBuilder:`${i}

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
{content}`,renderHost:`${i}

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
{content}`},u={summary:`${i}

Сделай подробный operator-grade разбор страницы. Не пересказывай текст; собери суть, контур, механику, практический смысл, риски и применение.

Структура: TL;DR, СУТЬ, КОНТУР, КАК УСТРОЕНО, ПРАКТИЧЕСКИЙ СМЫСЛ, РИСКИ, ПРИМЕНЕНИЕ, АВТОМАТИЗАЦИИ, ОТКРЫТЫЕ ВОПРОСЫ, ЧТО ПРОВЕРИТЬ, ДЕЙСТВИЯ.
Пиши по-русски, проверяемо, с явной маркировкой гипотез и пробелов. Английский оставляй только для точных имён, API, команд и URL.

ТЕГИ: {tags}
КОНТЕКСТ: {browserContext}`,summaryJson:`${i}

Верни только валидный JSON для двухколоночной summary: sections[], til[], actions[], concrete_prompts[].
Каждая секция: key, emoji, label, left[], right.commentary[], right.terms[], right.entities[], right.refs[].
Обязательные первые рабочие секции: TL;DR, СУТЬ, КОНТУР, КАК УСТРОЕНО, ПРАКТИЧЕСКИЙ СМЫСЛ.
Левая колонка — простой русский смысл; оригинальные термины и англицизмы — в right. right.commentary тоже пиши по-русски.
СУТЬ = 1-3 главных вывода, а не случайная цитата.
КОНТУР = состав материала и смысловые ветки, а не сырой список заголовков.
КАК УСТРОЕНО = процесс, причинно-следственные связи, ограничения и доказательная механика.
ПРАКТИЧЕСКИЙ СМЫСЛ = что меняется для решения, продукта, исследования или следующего шага.

ТЕГИ: {tags}
КОНТЕКСТ: {browserContext}`,sectionEnrich:`${i}

Обогати одну секцию. Верни только JSON с right.commentary, right.terms, right.entities, right.refs.
Не повторяй left; добавь связи, риски, проверки и практические нюансы. Все комментарии и определения пиши по-русски; английские исходные термины держи как term/name, но объясняй на русском.`,generateTitle:`Дай цепкий русский заголовок 2-5 слов. Только заголовок. Передай angle материала, не generic-кликбейт.
Контент: {content}`,pageRanking:`Верни только JSON: depth, depthExplanation, depthPercent, domain, domainExplanation, domainConfidence, tags, tagExplanations, oneLineValue.
Оцени интеллектуальную плотность, категорию и теги с опорой на контент.
Контент: {content}`,workflowSuggestions:`${i}

Сгенерируй 10 лучших следующих сценариев работы как JSON массив: title, desc, prompt.
Смешай исследование, стратегию, продукт, инженеринг, критику и операции. Каждый prompt должен вести к артефакту.

КОНТЕНТ: {content}`,voiceScript:`${i}

Подготовь текст для озвучки 120-220 слов: главное, зачем это, где риск, что делать дальше, куда углубляться.
Без markdown, короткими фразами.

URL: {url}
TITLE: {title}
SUMMARY: {summary}
PAGE SNIPPET: {content}`,mindmap:`${i}

Собери кластерную исследовательскую mindmap. Верни только JSON: title, nodes[], metadata.
Нужны 7-10 главных веток, 40-64 узла, разные типы узлов, связи [[edge:...]], evidence и questions.

КОНТЕНТ: {content}
SUMMARY: {summary}`,mindmapExpand:`${i}

Расширь ветку mindmap. Верни только JSON массив новых children: 3-5 узлов, у важных узлов 2-4 grandchildren.
Не дублируй существующие children. Добавь связи, risks, evidence, questions.

Ветка: {label}
Описание: {description}
Уже существующие дети: {existingChildren}
КОНТЕКСТ: {content}
SUMMARY: {summary}`,followUp:`${i}

Ответь на вопрос по контексту заметки. Сначала ответ, затем 1-3 supporting points, затем лучший next question если данных не хватает.
Контекст: {history}
Вопрос: {question}`,actionToPrompt:`${i}

Сгенерируй один готовый prompt для LLM по действию пользователя. Нужны цель, входные данные, ограничения, формат ответа и критерии качества.
Верни только prompt.

ACTION: {action}
ORIGIN: {noteTitle} / {section} / {originLine}
URL: {url}
TITLE: {title}
BROWSER CONTEXT: {browserContext}
SUMMARY: {summary}
PAGE SNIPPET: {content}`,createCommand:`${i}

Сгенерируй один JSON объект команды pzdrk: id, title, icon, scope, mode, prompt, system.
Никаких лишних полей. Если команда зависит от выделения — scope=selection и используй {selection}.

ЗАПРОС ПОЛЬЗОВАТЕЛЯ: {request}`},Ee={summary:"Main Summary",summaryJson:"JSON Summary",sectionEnrich:"Section Enrich",generateTitle:"Title Generator",pageRanking:"Page Ranking",workflowSuggestions:"Workflow Suggestions",voiceScript:"Voice Script",mindmap:"Mindmap",mindmapExpand:"Mindmap Expand",followUp:"Follow-up Q&A",actionToPrompt:"Action → Prompt",createCommand:"Command Builder"},ye=r.promptOverrides&&typeof r.promptOverrides=="object"?r.promptOverrides:{};function d(t){return String(t||"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#039;")}function _(t){const e=Number(t||0);return!Number.isFinite(e)||e<=0?"0 B":e<1024?`${e} B`:e<1024*1024?`${(e/1024).toFixed(1)} KB`:`${(e/(1024*1024)).toFixed(1)} MB`}function fe(t,e){const n=String(e||"").toUpperCase();return!n||!["summary","summaryJson","sectionEnrich"].includes(String(t||""))?!1:n.includes("КАРТА")&&n.includes("МЕХАНИЗМ")&&(n.includes("ЗАЧЕМ ВАЖНО")||n.includes("ЗАЧЕМ ЭТО ВАЖНО"))}function ve(t){const e=String(ye[t]||"");return e&&!fe(t,e)?e:u[t]||""}function he(){const t=document.getElementById("promptRegistryList");t&&(t.innerHTML=Object.keys(u).map(e=>`
      <div class="prompt-card" data-prompt-card="${d(e)}">
        <div class="prompt-card-head">
          <div class="prompt-card-title">${d(Ee[e]||e)} <code>${d(e)}</code></div>
          <button class="btn-mini" data-reset-prompt="${d(e)}" type="button">Reset</button>
        </div>
        <textarea id="promptOverride_${d(e)}" spellcheck="false">${d(ve(e))}</textarea>
      </div>
    `).join(""))}function Be(){const t={};for(const e of Object.keys(u)){const n=document.getElementById(`promptOverride_${e}`),o=String(n?.value||"").trim(),c=String(u[e]||"").trim();o&&o!==c&&(t[e]=o)}return t}function B(t,e=""){const n=document.getElementById("telegramStatus");n&&(n.textContent=t||"",n.style.color=e==="ok"?"#bbf7d0":e==="error"?"#fecaca":"")}function Ie(t){const e=document.getElementById("artifactList");if(!e)return;const n=Array.isArray(t)?t:[];if(!n.length){e.innerHTML='<div class="artifact-empty">Архив пока пуст. Нажмите кнопку 💽 на workspace, чтобы сохранить HTML/Markdown-снимок.</div>';return}e.innerHTML=n.map(o=>{const c=o?.createdAt?new Date(Number(o.createdAt)).toLocaleString():"unknown time",m=o?.title||"pzdrk artifact",l=[o?.domain||"",c,`${Number(o?.tabCount||0)} вкладок`,`HTML ${_(o?.htmlBytes)}`,`MD ${_(o?.markdownBytes)}`].filter(Boolean).join(" • ");return`
        <div class="artifact-item" data-artifact-id="${d(o?.id||"")}">
          <div>
            <div class="artifact-title" title="${d(m)}">${d(m)}</div>
            <div class="artifact-meta">${d(l)}</div>
          </div>
          <div class="artifact-actions">
            <button class="btn-mini" data-artifact-action="html" type="button">HTML</button>
            <button class="btn-mini" data-artifact-action="markdown" type="button">MD</button>
            <button class="btn-mini" data-artifact-action="telegram" type="button">TG</button>
            <button class="btn-mini" data-artifact-action="delete" type="button">Delete</button>
          </div>
        </div>
      `}).join("")}async function L(){const t=document.getElementById("artifactList");t&&(t.innerHTML='<div class="artifact-empty">Загружаю архив...</div>');try{const e=await v("listArtifacts");Ie(e)}catch(e){t&&(t.innerHTML=`<div class="artifact-empty">Не удалось прочитать архив: ${d(e.message)}</div>`)}}he();const I=document.getElementById("coreProvider");I&&(I.value=A());const C=document.getElementById("groqApiKeys");if(C){const t=Array.isArray(r.groqApiKeys)?r.groqApiKeys:[],e=String(r.groqApiKey||"").trim();C.value=b(t.length?t:e?[e]:[])}const x=document.getElementById("cerebrasApiKeys");x&&(x.value=b(r.cerebrasApiKeys));const g=document.getElementById("model");g&&(g.value=p(A()),w(A())),document.getElementById("summaryPrompt").value=r.summaryPrompt||"";const O=document.getElementById("twoColumnSummary");O&&(O.checked=r.twoColumnSummary!==!1);const U=document.getElementById("summaryJsonPrompt");U&&(U.value=r.summaryJsonPrompt||"");const N=document.getElementById("sectionEnrichPrompt");N&&(N.value=r.sectionEnrichPrompt||"");const q=document.getElementById("maxParallelRequests");q&&(q.value=String(r.maxParallelRequests??64));const $=document.getElementById("targetMaxOutputTokens");$&&($.value=String(r.targetMaxOutputTokens??8192));const D=document.getElementById("prefetchOnHover");D&&(D.checked=r.prefetchOnHover!==!1);const K=document.getElementById("prefetchDelayMs");K&&(K.value=String(r.prefetchDelayMs??220));const H=document.getElementById("mapReduceEnabled");H&&(H.checked=r.mapReduceEnabled!==!1);const G=document.getElementById("showLeftNavButtons");G&&(G.checked=r.showLeftNavButtons===!0);const F=document.getElementById("showRightActionButtons");F&&(F.checked=r.showRightActionButtons===!0);const j=document.getElementById("artifactAutoSave");j&&(j.checked=r.artifactAutoSave===!0);const Y=document.getElementById("telegramEnabled");Y&&(Y.checked=y.telegramEnabled===!0);const J=document.getElementById("telegramBotToken");J&&(J.value=y.telegramBotToken||"");const X=document.getElementById("telegramChatId");X&&(X.value=y.telegramChatId||"");const z=document.getElementById("telegramSendHtml");z&&(z.checked=y.telegramSendHtml!==!1);const Q=document.getElementById("telegramSendMarkdown");Q&&(Q.checked=y.telegramSendMarkdown===!0),document.getElementById("voiceProvider").value=r.voiceProvider||"xai",document.getElementById("voiceApiKey").value=r.voiceApiKey||"";const V=document.getElementById("voiceChatMode");V&&(V.value=r.voiceChatMode||"off");const W=document.getElementById("voicePersonality");W&&(W.value=r.voicePersonality||"Ara");const Z=document.getElementById("autoSpeakSummary");Z&&(Z.checked=r.autoSpeakSummary===!0);const s=r.actionPrompts&&typeof r.actionPrompts=="object"?r.actionPrompts:{};document.getElementById("actionPrompt_twitter").value=s.twitter||a.twitter,document.getElementById("actionPrompt_deepdive").value=s.deepdive||a.deepdive,document.getElementById("actionPrompt_automation").value=s.automation||a.automation,document.getElementById("actionPrompt_learning").value=s.learning||a.learning,document.getElementById("actionPrompt_share").value=s.share||a.share,document.getElementById("actionPrompt_challenge").value=s.challenge||a.challenge,document.getElementById("actionPrompt_timeline").value=s.timeline||a.timeline,document.getElementById("actionPrompt_extract").value=s.extract||a.extract,document.getElementById("actionPrompt_briefing").value=s.briefing||a.briefing,document.getElementById("actionPrompt_matrix").value=s.matrix||a.matrix,document.getElementById("actionPrompt_sources").value=s.sources||a.sources,document.getElementById("actionPrompt_opsplan").value=s.opsplan||a.opsplan,document.getElementById("actionPrompt_faq").value=s.faq||a.faq,document.getElementById("actionPrompt_compare").value=s.compare||a.compare,document.getElementById("actionPrompt_localization").value=s.localization||a.localization,document.getElementById("actionPrompt_frontendBuilder").value=s.frontendBuilder||a.frontendBuilder,document.getElementById("actionPrompt_renderHost").value=s.renderHost||a.renderHost;const ee=document.getElementById("resetSummaryPromptBtn");ee&&ee.addEventListener("click",()=>{document.getElementById("summaryPrompt").value=""});const te=document.getElementById("resetSummaryJsonPromptBtn");te&&te.addEventListener("click",()=>{const t=document.getElementById("summaryJsonPrompt");t&&(t.value="")});const ne=document.getElementById("resetSectionEnrichPromptBtn");ne&&ne.addEventListener("click",()=>{const t=document.getElementById("sectionEnrichPrompt");t&&(t.value="")});const oe=document.getElementById("resetAllActionPromptsBtn");oe&&oe.addEventListener("click",()=>{document.getElementById("actionPrompt_twitter").value=a.twitter,document.getElementById("actionPrompt_deepdive").value=a.deepdive,document.getElementById("actionPrompt_automation").value=a.automation,document.getElementById("actionPrompt_learning").value=a.learning,document.getElementById("actionPrompt_share").value=a.share,document.getElementById("actionPrompt_challenge").value=a.challenge,document.getElementById("actionPrompt_timeline").value=a.timeline,document.getElementById("actionPrompt_extract").value=a.extract,document.getElementById("actionPrompt_briefing").value=a.briefing,document.getElementById("actionPrompt_matrix").value=a.matrix,document.getElementById("actionPrompt_sources").value=a.sources,document.getElementById("actionPrompt_opsplan").value=a.opsplan,document.getElementById("actionPrompt_faq").value=a.faq,document.getElementById("actionPrompt_compare").value=a.compare,document.getElementById("actionPrompt_localization").value=a.localization,document.getElementById("actionPrompt_frontendBuilder").value=a.frontendBuilder,document.getElementById("actionPrompt_renderHost").value=a.renderHost}),document.querySelectorAll("[data-reset-action]").forEach(t=>{t.addEventListener("click",()=>{const e=t.getAttribute("data-reset-action");if(!e)return;const n=document.getElementById(`actionPrompt_${e}`);if(!n)return;const o=a[e];typeof o=="string"&&(n.value=o)})}),document.getElementById("resetAllPromptOverridesBtn")?.addEventListener("click",()=>{Object.keys(u).forEach(t=>{const e=document.getElementById(`promptOverride_${t}`);e&&(e.value=u[t])})}),document.querySelectorAll("[data-reset-prompt]").forEach(t=>{t.addEventListener("click",()=>{const e=t.getAttribute("data-reset-prompt"),n=e?document.getElementById(`promptOverride_${e}`):null;n&&typeof u[e]=="string"&&(n.value=u[e])})}),document.getElementById("refreshArtifactsBtn")?.addEventListener("click",()=>{L()}),document.getElementById("artifactList")?.addEventListener("click",async t=>{const e=t.target.closest("[data-artifact-action]"),n=t.target.closest("[data-artifact-id]");if(!e||!n)return;const o=n.getAttribute("data-artifact-id"),c=e.getAttribute("data-artifact-action");if(!o||!c)return;const m=e.textContent;e.textContent="...";try{if(c==="delete"){await v("deleteArtifact",{id:o}),await L();return}const l=await v("getArtifact",{id:o}),S=ge(l?.title||"pzdrk");c==="html"?M(`${S}.html`,l?.html||"","text/html;charset=utf-8"):c==="markdown"?M(`${S}.md`,l?.markdown||l?.text||"","text/markdown;charset=utf-8"):c==="telegram"&&(await v("sendTelegramArtifact",{artifact:l}),B(`Отправлено в Telegram: ${l?.title||S}`,"ok"))}catch(l){B(l.message||"Artifact action failed","error")}finally{e.isConnected&&(e.textContent=m)}}),document.getElementById("testTelegramBtn")?.addEventListener("click",async()=>{B("Сохраняю настройки и отправляю тест...","");try{await chrome.storage.local.set({telegramEnabled:document.getElementById("telegramEnabled")?.checked===!0,telegramBotToken:document.getElementById("telegramBotToken")?.value||"",telegramChatId:document.getElementById("telegramChatId")?.value||"",telegramSendHtml:document.getElementById("telegramSendHtml")?.checked!==!1,telegramSendMarkdown:document.getElementById("telegramSendMarkdown")?.checked===!0}),await v("testTelegram",{message:`pzdrk Telegram test: ${new Date().toISOString()}`}),B("Telegram подключён: тестовое сообщение отправлено.","ok")}catch(t){B(t.message||"Telegram test failed","error")}}),L(),document.getElementById("autoSummarize").checked=r.autoSummarize!==!1,document.getElementById("classicMode").checked=r.classicMode||!1,document.getElementById("privacyEnabled").checked=r.privacyEnabled!==!1;const P=document.getElementById("unlimitedMode"),E=document.getElementById("byokMode"),re=document.getElementById("coreByok"),ae=document.getElementById("voiceByok"),Pe=b(r.groqApiKeys).length>0||b(r.cerebrasApiKeys).length>0||String(r.groqApiKey||"").trim().length>0;function k(t){t?(P.classList.remove("active"),P.classList.add("available"),E.classList.add("active"),E.classList.remove("available"),re.classList.add("show"),ae.classList.add("show")):(P.classList.add("active"),P.classList.remove("available"),E.classList.remove("active"),E.classList.add("available"),re.classList.remove("show"),ae.classList.remove("show"))}k(r.byokMode!==!1||Pe),I&&g&&I.addEventListener("change",()=>{const e=String(I.value||"groq").toLowerCase()==="cerebras"?"cerebras":"groq";g.value=p(e),w(e)}),P.addEventListener("click",()=>{k(!1),chrome.storage.sync.set({byokMode:!1})}),E.addEventListener("click",()=>{k(!0),chrome.storage.sync.set({byokMode:!0})}),chrome.runtime.sendMessage({action:"getTrackerStats"},t=>{t?.success&&(document.getElementById("trackerCount").textContent=t.data.blocked||0)}),document.getElementById("saveBtn").addEventListener("click",async()=>{const t=document.getElementById("status"),e=String(document.getElementById("coreProvider")?.value||"groq").toLowerCase(),n=e==="cerebras"?"cerebras":"groq";let o=String(document.getElementById("model")?.value||"").trim();n==="cerebras"&&!h(o)&&(o=p("cerebras")),n==="groq"&&h(o)&&(o=p("groq"));const c=f(T(document.getElementById("groqApiKeys")?.value)),m=f(T(document.getElementById("cerebrasApiKeys")?.value)),l=Number(document.getElementById("maxParallelRequests")?.value),S=Number.isFinite(l)?Math.max(1,Math.min(200,Math.round(l))):64,ce=Number(document.getElementById("targetMaxOutputTokens")?.value),Se=Number.isFinite(ce)?Math.max(64,Math.min(8192,Math.round(ce))):8192,Te=document.getElementById("prefetchOnHover")?.checked!==!1,ie=Number(document.getElementById("prefetchDelayMs")?.value),be=Number.isFinite(ie)?Math.max(0,Math.min(2e3,Math.round(ie))):220,Ae=document.getElementById("mapReduceEnabled")?.checked!==!1,Le=Be(),ke={twitter:document.getElementById("actionPrompt_twitter").value,deepdive:document.getElementById("actionPrompt_deepdive").value,automation:document.getElementById("actionPrompt_automation").value,learning:document.getElementById("actionPrompt_learning").value,share:document.getElementById("actionPrompt_share").value,challenge:document.getElementById("actionPrompt_challenge").value,timeline:document.getElementById("actionPrompt_timeline").value,extract:document.getElementById("actionPrompt_extract").value,briefing:document.getElementById("actionPrompt_briefing").value,matrix:document.getElementById("actionPrompt_matrix").value,sources:document.getElementById("actionPrompt_sources").value,opsplan:document.getElementById("actionPrompt_opsplan").value,faq:document.getElementById("actionPrompt_faq").value,compare:document.getElementById("actionPrompt_compare").value,localization:document.getElementById("actionPrompt_localization").value,frontendBuilder:document.getElementById("actionPrompt_frontendBuilder").value,renderHost:document.getElementById("actionPrompt_renderHost").value};await Promise.all([chrome.storage.sync.set({coreProvider:e,groqApiKeys:c,cerebrasApiKeys:m,model:o,modelGroq:n==="groq"?o:p("groq"),modelCerebras:n==="cerebras"?o:p("cerebras"),maxParallelRequests:S,targetMaxOutputTokens:Se,prefetchOnHover:Te,prefetchDelayMs:be,mapReduceEnabled:Ae,byokMode:E.classList.contains("active"),summaryPrompt:document.getElementById("summaryPrompt").value,twoColumnSummary:document.getElementById("twoColumnSummary")?.checked,summaryJsonPrompt:document.getElementById("summaryJsonPrompt")?.value,sectionEnrichPrompt:document.getElementById("sectionEnrichPrompt")?.value,voiceProvider:document.getElementById("voiceProvider").value,voiceApiKey:document.getElementById("voiceApiKey").value,voiceChatMode:document.getElementById("voiceChatMode")?.value||"off",voicePersonality:document.getElementById("voicePersonality")?.value||"Ara",autoSpeakSummary:document.getElementById("autoSpeakSummary")?.checked===!0,autoSummarize:document.getElementById("autoSummarize").checked,classicMode:document.getElementById("classicMode").checked,privacyEnabled:document.getElementById("privacyEnabled").checked,showLeftNavButtons:document.getElementById("showLeftNavButtons")?.checked===!0,showRightActionButtons:document.getElementById("showRightActionButtons")?.checked===!0,artifactAutoSave:document.getElementById("artifactAutoSave")?.checked===!0,promptOverrides:Le,actionPrompts:ke}),chrome.storage.local.set({telegramEnabled:document.getElementById("telegramEnabled")?.checked===!0,telegramBotToken:document.getElementById("telegramBotToken")?.value||"",telegramChatId:document.getElementById("telegramChatId")?.value||"",telegramSendHtml:document.getElementById("telegramSendHtml")?.checked!==!1,telegramSendMarkdown:document.getElementById("telegramSendMarkdown")?.checked===!0})]),t.textContent="✓ Сохранено",t.className="status show success",setTimeout(()=>t.className="status",2e3)}),document.getElementById("resetBtn").addEventListener("click",async()=>{await chrome.storage.sync.clear(),await chrome.storage.local.remove(["telegramEnabled","telegramBotToken","telegramChatId","telegramSendHtml","telegramSendMarkdown"]),chrome.runtime.sendMessage({action:"resetTrackerStats"}),location.reload()})});
