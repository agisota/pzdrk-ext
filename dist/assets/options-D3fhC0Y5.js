import"./modulepreload-polyfill-B5Qt9EMX.js";document.addEventListener("DOMContentLoaded",async()=>{const X="groq/compound",$="gpt-oss-120b",j="local-overrides.json",c=`Режим: staff operator / research copilot.
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
- Стиль: плотно, профессионально, инженерно, без воды и без маркетингового тона.`,z=await chrome.storage.sync.get(["coreProvider","groqApiKey","groqApiKeys","cerebrasApiKeys","model","modelGroq","modelCerebras","maxParallelRequests","targetMaxOutputTokens","prefetchOnHover","prefetchDelayMs","mapReduceEnabled","summaryPrompt","byokMode","autoSummarize","classicMode","privacyEnabled","voiceProvider","voiceApiKey","voiceChatMode","voicePersonality","autoSpeakSummary","actionPrompts","twoColumnSummary","summaryJsonPrompt","sectionEnrichPrompt"]);async function J(){try{const e=await fetch(chrome.runtime.getURL(j),{cache:"no-store"});if(!e.ok)return null;const t=await e.json().catch(()=>null);return t&&typeof t=="object"?t:null}catch{return null}}function P(e){return String(e||"").split(/\r?\n/).map(t=>t.trim()).filter(Boolean)}function p(e){return Array.from(new Set((Array.isArray(e)?e:[]).map(t=>String(t||"").trim()).filter(Boolean)))}function Q(e,t){if(!t||typeof t!="object")return e;const r={...e},a=p(P(t.groqApiKeys)),m=p(P(t.cerebrasApiKeys));a.length&&(r.groqApiKeys=a),m.length&&(r.cerebrasApiKeys=m);for(const l of["coreProvider","model","modelGroq","modelCerebras"]){const s=String(t[l]||"").trim();s&&(r[l]=s)}for(const l of["maxParallelRequests","targetMaxOutputTokens","prefetchDelayMs"]){const s=Number(t[l]);Number.isFinite(s)&&(r[l]=s)}for(const l of["byokMode","prefetchOnHover","mapReduceEnabled","twoColumnSummary"])typeof t[l]=="boolean"&&(r[l]=t[l]);return(a.length||m.length)&&(r.byokMode=!0),r}const n=Q(z,await J());function I(e){return p(e).join(`
`)}function f(){return String(n.coreProvider||"groq").trim().toLowerCase()==="cerebras"?"cerebras":"groq"}function y(e){const t=String(e||"").trim();return["gpt-oss-120b","llama3.1-8b","llama-3.3-70b","qwen-3-32b","qwen-3-235b-a22b-instruct-2507","zai-glm-4.6"].includes(t)}function B(e){return["","compound","moonshotai/kimi-k2-instruct","moonshotai/kimi-k2-instruct-0905"].includes(String(e||"").trim())}function u(e){if(e==="cerebras"){const a=String(n.modelCerebras||"").trim();if(a)return a;const m=String(n.model||"").trim();return y(m)?m:$}const t=String(n.modelGroq||"").trim();if(t&&!B(t))return t;const r=String(n.model||"").trim();return!r||y(r)||B(r)?X:r}function S(e){if(!d)return;const t=String(e||"groq").toLowerCase()==="cerebras"?"cerebras":"groq",r=Array.from(d.querySelectorAll("option"));let a=!1;for(const m of r){const s=(String(m.dataset.provider||"").trim().toLowerCase()||(y(m.value)?"cerebras":"groq"))===t;m.hidden=!s,m.disabled=!s,m.value===d.value&&s&&(a=!0)}a||(d.value=u(t))}const o={twitter:`${c}

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
{browserContext}`,deepdive:`${c}

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
{browserContext}`,automation:`${c}

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
{browserContext}`,learning:`${c}

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
{content}`,share:`${c}

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
{summary}`,challenge:`${c}

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
{content}`,timeline:`${c}

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
{browserContext}`,extract:`${c}

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
{browserContext}`,briefing:`${c}

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
{browserContext}`,matrix:`${c}

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
{browserContext}`,sources:`${c}

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
{browserContext}`,opsplan:`${c}

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
{browserContext}`,faq:`${c}

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
{browserContext}`,compare:`${c}

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
{browserContext}`,localization:`${c}

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
{content}`,frontendBuilder:`${c}

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
{content}`,renderHost:`${c}

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
{content}`},g=document.getElementById("coreProvider");g&&(g.value=f());const A=document.getElementById("groqApiKeys");if(A){const e=Array.isArray(n.groqApiKeys)?n.groqApiKeys:[],t=String(n.groqApiKey||"").trim();A.value=I(e.length?e:t?[t]:[])}const b=document.getElementById("cerebrasApiKeys");b&&(b.value=I(n.cerebrasApiKeys));const d=document.getElementById("model");d&&(d.value=u(f()),S(f())),document.getElementById("summaryPrompt").value=n.summaryPrompt||"";const h=document.getElementById("twoColumnSummary");h&&(h.checked=n.twoColumnSummary!==!1);const L=document.getElementById("summaryJsonPrompt");L&&(L.value=n.summaryJsonPrompt||"");const M=document.getElementById("sectionEnrichPrompt");M&&(M.value=n.sectionEnrichPrompt||"");const _=document.getElementById("maxParallelRequests");_&&(_.value=String(n.maxParallelRequests??12));const R=document.getElementById("targetMaxOutputTokens");R&&(R.value=String(n.targetMaxOutputTokens??8192));const k=document.getElementById("prefetchOnHover");k&&(k.checked=n.prefetchOnHover!==!1);const U=document.getElementById("prefetchDelayMs");U&&(U.value=String(n.prefetchDelayMs??220));const w=document.getElementById("mapReduceEnabled");w&&(w.checked=n.mapReduceEnabled!==!1),document.getElementById("voiceProvider").value=n.voiceProvider||"xai",document.getElementById("voiceApiKey").value=n.voiceApiKey||"";const x=document.getElementById("voiceChatMode");x&&(x.value=n.voiceChatMode||"off");const C=document.getElementById("voicePersonality");C&&(C.value=n.voicePersonality||"Ara");const q=document.getElementById("autoSpeakSummary");q&&(q.checked=n.autoSpeakSummary===!0);const i=n.actionPrompts&&typeof n.actionPrompts=="object"?n.actionPrompts:{};document.getElementById("actionPrompt_twitter").value=i.twitter||o.twitter,document.getElementById("actionPrompt_deepdive").value=i.deepdive||o.deepdive,document.getElementById("actionPrompt_automation").value=i.automation||o.automation,document.getElementById("actionPrompt_learning").value=i.learning||o.learning,document.getElementById("actionPrompt_share").value=i.share||o.share,document.getElementById("actionPrompt_challenge").value=i.challenge||o.challenge,document.getElementById("actionPrompt_timeline").value=i.timeline||o.timeline,document.getElementById("actionPrompt_extract").value=i.extract||o.extract,document.getElementById("actionPrompt_briefing").value=i.briefing||o.briefing,document.getElementById("actionPrompt_matrix").value=i.matrix||o.matrix,document.getElementById("actionPrompt_sources").value=i.sources||o.sources,document.getElementById("actionPrompt_opsplan").value=i.opsplan||o.opsplan,document.getElementById("actionPrompt_faq").value=i.faq||o.faq,document.getElementById("actionPrompt_compare").value=i.compare||o.compare,document.getElementById("actionPrompt_localization").value=i.localization||o.localization,document.getElementById("actionPrompt_frontendBuilder").value=i.frontendBuilder||o.frontendBuilder,document.getElementById("actionPrompt_renderHost").value=i.renderHost||o.renderHost;const N=document.getElementById("resetSummaryPromptBtn");N&&N.addEventListener("click",()=>{document.getElementById("summaryPrompt").value=""});const O=document.getElementById("resetSummaryJsonPromptBtn");O&&O.addEventListener("click",()=>{const e=document.getElementById("summaryJsonPrompt");e&&(e.value="")});const D=document.getElementById("resetSectionEnrichPromptBtn");D&&D.addEventListener("click",()=>{const e=document.getElementById("sectionEnrichPrompt");e&&(e.value="")});const K=document.getElementById("resetAllActionPromptsBtn");K&&K.addEventListener("click",()=>{document.getElementById("actionPrompt_twitter").value=o.twitter,document.getElementById("actionPrompt_deepdive").value=o.deepdive,document.getElementById("actionPrompt_automation").value=o.automation,document.getElementById("actionPrompt_learning").value=o.learning,document.getElementById("actionPrompt_share").value=o.share,document.getElementById("actionPrompt_challenge").value=o.challenge,document.getElementById("actionPrompt_timeline").value=o.timeline,document.getElementById("actionPrompt_extract").value=o.extract,document.getElementById("actionPrompt_briefing").value=o.briefing,document.getElementById("actionPrompt_matrix").value=o.matrix,document.getElementById("actionPrompt_sources").value=o.sources,document.getElementById("actionPrompt_opsplan").value=o.opsplan,document.getElementById("actionPrompt_faq").value=o.faq,document.getElementById("actionPrompt_compare").value=o.compare,document.getElementById("actionPrompt_localization").value=o.localization,document.getElementById("actionPrompt_frontendBuilder").value=o.frontendBuilder,document.getElementById("actionPrompt_renderHost").value=o.renderHost}),document.querySelectorAll("[data-reset-action]").forEach(e=>{e.addEventListener("click",()=>{const t=e.getAttribute("data-reset-action");if(!t)return;const r=document.getElementById(`actionPrompt_${t}`);if(!r)return;const a=o[t];typeof a=="string"&&(r.value=a)})}),document.getElementById("autoSummarize").checked=n.autoSummarize!==!1,document.getElementById("classicMode").checked=n.classicMode||!1,document.getElementById("privacyEnabled").checked=n.privacyEnabled!==!1;const v=document.getElementById("unlimitedMode"),E=document.getElementById("byokMode"),G=document.getElementById("coreByok"),F=document.getElementById("voiceByok"),W=I(n.groqApiKeys).length>0||I(n.cerebrasApiKeys).length>0||String(n.groqApiKey||"").trim().length>0;function T(e){e?(v.classList.remove("active"),v.classList.add("available"),E.classList.add("active"),E.classList.remove("available"),G.classList.add("show"),F.classList.add("show")):(v.classList.add("active"),v.classList.remove("available"),E.classList.remove("active"),E.classList.add("available"),G.classList.remove("show"),F.classList.remove("show"))}T(n.byokMode!==!1||W),g&&d&&g.addEventListener("change",()=>{const t=String(g.value||"groq").toLowerCase()==="cerebras"?"cerebras":"groq";d.value=u(t),S(t)}),v.addEventListener("click",()=>{T(!1),chrome.storage.sync.set({byokMode:!1})}),E.addEventListener("click",()=>{T(!0),chrome.storage.sync.set({byokMode:!0})}),chrome.runtime.sendMessage({action:"getTrackerStats"},e=>{e?.success&&(document.getElementById("trackerCount").textContent=e.data.blocked||0)}),document.getElementById("saveBtn").addEventListener("click",async()=>{const e=document.getElementById("status"),t=String(document.getElementById("coreProvider")?.value||"groq").toLowerCase(),r=t==="cerebras"?"cerebras":"groq";let a=String(document.getElementById("model")?.value||"").trim();r==="cerebras"&&!y(a)&&(a=u("cerebras")),r==="groq"&&y(a)&&(a=u("groq"));const m=p(P(document.getElementById("groqApiKeys")?.value)),l=p(P(document.getElementById("cerebrasApiKeys")?.value)),s=Number(document.getElementById("maxParallelRequests")?.value),V=Number.isFinite(s)?Math.max(1,Math.min(200,Math.round(s))):12,Y=Number(document.getElementById("targetMaxOutputTokens")?.value),Z=Number.isFinite(Y)?Math.max(64,Math.min(8192,Math.round(Y))):8192,ee=document.getElementById("prefetchOnHover")?.checked!==!1,H=Number(document.getElementById("prefetchDelayMs")?.value),te=Number.isFinite(H)?Math.max(0,Math.min(2e3,Math.round(H))):220,oe=document.getElementById("mapReduceEnabled")?.checked!==!1,ne={twitter:document.getElementById("actionPrompt_twitter").value,deepdive:document.getElementById("actionPrompt_deepdive").value,automation:document.getElementById("actionPrompt_automation").value,learning:document.getElementById("actionPrompt_learning").value,share:document.getElementById("actionPrompt_share").value,challenge:document.getElementById("actionPrompt_challenge").value,timeline:document.getElementById("actionPrompt_timeline").value,extract:document.getElementById("actionPrompt_extract").value,briefing:document.getElementById("actionPrompt_briefing").value,matrix:document.getElementById("actionPrompt_matrix").value,sources:document.getElementById("actionPrompt_sources").value,opsplan:document.getElementById("actionPrompt_opsplan").value,faq:document.getElementById("actionPrompt_faq").value,compare:document.getElementById("actionPrompt_compare").value,localization:document.getElementById("actionPrompt_localization").value,frontendBuilder:document.getElementById("actionPrompt_frontendBuilder").value,renderHost:document.getElementById("actionPrompt_renderHost").value};await chrome.storage.sync.set({coreProvider:t,groqApiKeys:m,cerebrasApiKeys:l,model:a,modelGroq:r==="groq"?a:u("groq"),modelCerebras:r==="cerebras"?a:u("cerebras"),maxParallelRequests:V,targetMaxOutputTokens:Z,prefetchOnHover:ee,prefetchDelayMs:te,mapReduceEnabled:oe,byokMode:E.classList.contains("active"),summaryPrompt:document.getElementById("summaryPrompt").value,twoColumnSummary:document.getElementById("twoColumnSummary")?.checked,summaryJsonPrompt:document.getElementById("summaryJsonPrompt")?.value,sectionEnrichPrompt:document.getElementById("sectionEnrichPrompt")?.value,voiceProvider:document.getElementById("voiceProvider").value,voiceApiKey:document.getElementById("voiceApiKey").value,voiceChatMode:document.getElementById("voiceChatMode")?.value||"off",voicePersonality:document.getElementById("voicePersonality")?.value||"Ara",autoSpeakSummary:document.getElementById("autoSpeakSummary")?.checked===!0,autoSummarize:document.getElementById("autoSummarize").checked,classicMode:document.getElementById("classicMode").checked,privacyEnabled:document.getElementById("privacyEnabled").checked,actionPrompts:ne}),e.textContent="✓ Сохранено",e.className="status show success",setTimeout(()=>e.className="status",2e3)}),document.getElementById("resetBtn").addEventListener("click",async()=>{await chrome.storage.sync.clear(),chrome.runtime.sendMessage({action:"resetTrackerStats"}),location.reload()})});
