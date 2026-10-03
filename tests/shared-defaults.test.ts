import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { webcrypto } from 'node:crypto';
import { createContext, runInContext, runInNewContext } from 'node:vm';

const workerSource = readFileSync(new URL('../background.js', import.meta.url), 'utf8');
const optionsSource = readFileSync(new URL('../options.js', import.meta.url), 'utf8');
const popupSource = readFileSync(new URL('../popup.js', import.meta.url), 'utf8');
const promptDefaultsSource = readFileSync(new URL('../prompt-defaults.js', import.meta.url), 'utf8');
const defaults = {
  groqApiKeys: ['test-shared-groq'],
  telegramEnabled: true,
  telegramBotToken: '123456:test-shared-bot',
  telegramChatId: '96570013'
};

// Exact nonsecret template formerly saved by an untouched options form.
const legacyLearningTemplate = `Режим: staff operator / research copilot.
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
- Стиль: плотно, профессионально, инженерно, без воды и без маркетингового тона.

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
{content}`;

type Storage = Record<string, unknown>;

function startWorker(syncSettings: Storage = {}, localSettings: Storage = {}) {
  let listener: (request: Storage, sender: Storage, respond: (value: Storage) => void) => boolean | void = () => {};
  let trackerMatched: (info: { request: { url: string } }) => void = () => {};
  const requests: Array<{ url: string; options: RequestInit }> = [];
  const readStorage = (settings: Storage) => ({
    get: async (keys: string | string[]) => {
      const names = Array.isArray(keys) ? keys : [keys];
      return Object.fromEntries(names.filter(name => Object.hasOwn(settings, name)).map(name => [name, settings[name]]));
    }
  });
  const chrome = {
    runtime: {
      getURL: (name: string) => `chrome-extension://test/${name}`,
      onInstalled: { addListener() {} },
      onMessage: { addListener(fn: typeof listener) { listener = fn; } }
    },
    storage: {
      sync: readStorage(syncSettings),
      local: readStorage(localSettings),
      onChanged: { addListener() {} }
    },
    contextMenus: { create() {}, onClicked: { addListener() {} } },
    declarativeNetRequest: { updateEnabledRulesets: async () => {}, onRuleMatchedDebug: { addListener(fn: typeof trackerMatched) { trackerMatched = fn; } } },
    tabs: { query(_query: Storage, callback: (tabs: Storage[]) => void) { callback([]); }, sendMessage() {} }
  };
  const fetch = async (url: string, options: RequestInit = {}) => {
    if (url.endsWith('/shared-defaults.json')) return Response.json(defaults);
    if (url.endsWith('/local-overrides.json')) return new Response(null, { status: 404 });
    requests.push({ url, options });
    if (url.includes('api.groq.com')) return Response.json({ choices: [{ message: { content: 'model reply' } }] });
    if (url.includes('api.telegram.org')) return Response.json({ ok: true });
    throw new Error(`Unexpected request: ${url}`);
  };
  runInNewContext(workerSource, { chrome, fetch, AbortController, URL, Response, Blob, FormData, setTimeout, clearTimeout, console });
  const message = (request: Storage) => new Promise<Storage>((resolve) => listener(request, {}, resolve));
  return { message, requests, dispatch: (request: Storage) => listener(request, {}, () => {}), track: (url: string) => trackerMatched({ request: { url } }) };
}

function startPage(source: string, syncSettings: Storage, confirmActions = true, runtimeMessageSuccess = false, localSettings: Storage = {}) {
  const fields = new Map<string, {
    value: string;
    checked: boolean;
    textContent: string;
    innerHTML: string;
    className: string;
    style: Record<string, string>;
    hidden: boolean;
    href: string;
    id: string;
    dispatchEvent: (event: unknown) => boolean;
    getAttribute: (name: string) => string | null;
    append: (...items: Array<string | { textContent: string }>) => void;
    insertAdjacentElement: (position: string, element: unknown) => void;
    classList: { add: (name: string) => void; remove: (name: string) => void; contains: (name: string) => boolean };
    addEventListener: (name: string, callback: () => Promise<void> | void) => void;
    querySelectorAll: (selector: string) => unknown[];
  }>();
  const listeners = new Map<string, Array<() => Promise<void> | void>>();
  let ready: () => Promise<void> = async () => {};
  const messages: Storage[] = [];
  const localWrites: Storage[] = [];
  const localSaved: Storage = { ...localSettings };
  const saved: Storage = { ...syncSettings };
  const syncWrites: Storage[] = [];
  const syncRemovals: string[] = [];
  const syncClears: number[] = [];
  const localRemovals: string[][] = [];
  const reloads: number[] = [];
  const insertedElements: Array<{ after: string; element: { id: string; textContent: string } }> = [];
  const field = (id: string) => {
    let element = fields.get(id);
    if (!element) {
      const classes = new Set<string>();
      let html = '';
      element = {
        value: '', checked: false, textContent: '', innerHTML: '', className: '', style: {}, hidden: true, href: '', id,
        classList: {
          add: (name) => { classes.add(name); },
          remove: (name) => { classes.delete(name); },
          contains: (name) => classes.has(name)
        },
        dispatchEvent: (event) => {
          for (const handler of listeners.get(`${element!.id}:${(event as Event).type}`) || []) handler();
          return true;
        },
        getAttribute: (name) => name === 'data-reset-prompt' && id.startsWith('__reset_prompt_')
          ? id.slice('__reset_prompt_'.length) : null,
        append: (...items) => {
          for (const item of items) {
            element!.textContent += typeof item === 'string' ? item : item.textContent;
            if (typeof item === 'object' && 'id' in item && typeof item.id === 'string') fields.set(item.id, item as typeof element);
          }
        },
        insertAdjacentElement: (_position, adjacent) => {
          const inserted = adjacent as typeof element;
          insertedElements.push({ after: id, element: inserted });
          fields.set(inserted.id, inserted);
        },
        addEventListener: (name, callback) => {
          const key = `${element!.id}:${name}`;
          listeners.set(key, [...(listeners.get(key) || []), callback]);
        },
        querySelectorAll: (selector) => id === 'promptRegistryList' && selector === 'textarea:not([readonly])'
          ? Array.from(fields.values()).filter(item => item.id.startsWith('promptOverride_') && !['summary', 'summaryJson', 'sectionEnrich'].includes(item.id.slice(15)))
          : []
      };
      fields.set(id, element);
      if (id === 'promptRegistryList') {
        Object.defineProperty(element, 'innerHTML', {
          get: () => html,
          set: (value: string) => {
            html = value;
            const unescape = (text: string) => text.replace(/&lt;|&gt;|&quot;|&#39;|&amp;/g, entity =>
              ({ '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&amp;': '&' })[entity] || entity);
            for (const [, tag, name, body] of value.matchAll(/<(textarea|pre|p)\b[^>]*\bid="([^"]+)"[^>]*>([\s\S]*?)<\/\1>/g)) {
              if (!/^(promptOverride_|promptPreview_|promptRegistryMeta_)/.test(name)) continue;
              if (tag === 'textarea') field(name).value = unescape(body);
              else field(name).textContent = unescape(body);
            }
            for (const [, key] of value.matchAll(/data-reset-prompt="([^"]+)"/g)) field(`__reset_prompt_${key}`);
          }
        });
      }
    }
    return element;
  };
  const document = {
    addEventListener: (name: string, callback: () => Promise<void>) => {
      if (name === 'DOMContentLoaded') ready = callback;
    },
    getElementById: field,
    querySelectorAll: (selector: string) => selector.startsWith('textarea[id^="actionPrompt_"]')
      ? Array.from(fields.values()).filter((element) => element.id.startsWith('actionPrompt_'))
      : selector === '[data-reset-prompt]' ? Array.from(fields.values()).filter(element => element.id.startsWith('__reset_prompt_'))
        : selector === 'input, textarea, select' ? Array.from(fields.values()) : [],
    createElement: (() => {
      let created = 0;
      return () => field(`__created${++created}`);
    })(),
  };
  const chrome = {
    runtime: {
      getURL: (name: string) => `chrome-extension://test/${name}`,
      sendMessage: (message: Storage, callback?: (value: Storage) => void) => {
        messages.push(message);
        callback?.(message.action === 'getTrackerStats'
          ? { success: true, data: { blocked: 0 } }
          : { success: runtimeMessageSuccess, error: runtimeMessageSuccess ? undefined : 'Unknown action' });
      }
    },
    storage: {
      sync: {
        get: async (keys: string[]) => Object.fromEntries(keys.filter(key => Object.hasOwn(saved, key)).map(key => [key, saved[key]])),
        clear: async () => { syncClears.push(1); for (const key of Object.keys(saved)) delete saved[key]; },
        set: async (changes: Storage) => { syncWrites.push(changes); Object.assign(saved, changes); },
        remove: async (key: string) => { syncRemovals.push(key); delete saved[key]; }
      },
      local: {
        get: async () => ({ ...localSaved }),
        set: async (changes: Storage) => { localWrites.push(changes); Object.assign(localSaved, changes); },
        remove: async (keys: string[]) => { localRemovals.push(keys); keys.forEach((key) => delete localSaved[key]); }
      }
    }
  };
  const fetch = async (url: string) => url.endsWith('/shared-defaults.json')
    ? Response.json(defaults)
    : new Response(null, { status: 404 });
  const context = createContext({ document, chrome, fetch, crypto: webcrypto, TextEncoder, Event, setTimeout: () => 0, confirm: () => confirmActions, location: { reload: () => reloads.push(1) }, console: { warn() {} } });
  if (source === optionsSource) runInContext(promptDefaultsSource, context);
  runInContext(source, context);
  return {
    field,
    saved,
    localSaved,
    syncWrites,
    syncRemovals,
    localWrites,
    syncClears,
    localRemovals,
    messages,
    insertedElements,
    reloads,
    ready: () => ready(),
    click: async (id: string) => {
      const handlers = listeners.get(`${id}:click`);
      if (!handlers?.length) throw new Error(`Missing click handler: ${id}`);
      for (const handler of handlers) await handler();
    }
  };
}

describe('shared extension defaults at the actual background message boundary', () => {
  it('keeps all 18 shared defaults while exposing only the 12 consumed registry editor keys', async () => {
    const page = startPage(optionsSource, {});
    await page.ready();
    const promptDefaultsContext = createContext({});
    runInContext(promptDefaultsSource, promptDefaultsContext);
    expect(runInContext('Object.keys(globalThis.ROX_PROMPT_DEFAULTS.prompts).length', promptDefaultsContext)).toBe(18);
    const rendered = page.field('promptRegistryList').innerHTML;
    for (const key of [
      'summary', 'summaryJson', 'sectionEnrich', 'generateTitle', 'pageRanking',
      'workflowSuggestions', 'voiceScript', 'mindmap', 'mindmapExpand',
      'followUp', 'actionToPrompt', 'createCommand'
    ]) expect(rendered).toContain(`data-prompt-card="${key}"`);
    for (const key of ['challenge', 'twitter', 'deepdive', 'automation', 'learning', 'share']) {
      expect(rendered).not.toContain(`data-prompt-card="${key}"`);
    }
  });

  it('clears live tracker statistics through the root background reset action', async () => {
    const worker = startWorker();
    worker.track('https://tracker.example/script.js');
    expect(await worker.message({ action: 'getTrackerStats' })).toMatchObject({
      success: true,
      data: { blocked: 1, domains: ['tracker.example'] }
    });
    expect(await worker.message({ action: 'resetTrackerStats' })).toMatchObject({ success: true, data: true });
    expect(await worker.message({ action: 'getTrackerStats' })).toMatchObject({
      success: true,
      data: { blocked: 0, domains: [] }
    });
  });

  it('uses a shared Groq key for a new user and prefers a saved personal key', async () => {
    const fresh = startWorker();
    expect(await fresh.message({ action: 'callGroq', prompt: 'Hello' })).toMatchObject({ success: true, data: 'model reply' });
    expect(fresh.requests[0].options.headers).toMatchObject({ Authorization: 'Bearer test-shared-groq' });

    const personal = startWorker({ groqApiKeys: ['test-personal-groq'] });
    expect(await personal.message({ action: 'callGroq', prompt: 'Hello' })).toMatchObject({ success: true });
    expect(personal.requests[0].options.headers).toMatchObject({ Authorization: 'Bearer test-personal-groq' });
  });

  it('keeps an explicitly cleared Groq pool disabled instead of resurrecting the shared key', async () => {
    const worker = startWorker({ groqApiKeys: [] });
    expect(await worker.message({ action: 'callGroq', prompt: 'Hello' })).toMatchObject({ success: false, error: 'No API key configured' });
    expect(worker.requests).toEqual([]);
  });
  it('has no implicit Slack export endpoint for page data', () => {
    const worker = startWorker();
    expect(worker.dispatch({ action: 'sendSlack', data: { url: 'https://private.example/', summarized_note: 'Private note' } })).not.toBe(true);
    expect(worker.requests).toEqual([]);
  });


  it('sends user-triggered Telegram delivery to the shared user only when not overridden', async () => {
    const fresh = startWorker();
    expect(await fresh.message({ action: 'testTelegram', message: 'Hello' })).toMatchObject({ success: true });
    expect(fresh.requests[0].url).toBe('https://api.telegram.org/bot123456:test-shared-bot/sendMessage');
    expect(JSON.parse(fresh.requests[0].options.body as string)).toMatchObject({ chat_id: '96570013', text: 'Hello' });

    const personal = startWorker({}, { telegramBotToken: '654321:test-personal-bot', telegramChatId: '42' });
    expect(await personal.message({ action: 'testTelegram', message: 'Hello' })).toMatchObject({ success: true });
    expect(personal.requests[0].url).toBe('https://api.telegram.org/bot654321:test-personal-bot/sendMessage');
    expect(JSON.parse(personal.requests[0].options.body as string).chat_id).toBe('42');
  });

  it('does not send Telegram data when a user explicitly disables delivery', async () => {
    const worker = startWorker({}, { telegramEnabled: false });
    expect(await worker.message({ action: 'testTelegram', message: 'Hello' })).toMatchObject({ success: false, error: 'Telegram выключен в настройках' });
    expect(worker.requests).toEqual([]);
  });
  it('does not replace an explicitly cleared Telegram token with the shared token', async () => {
    const worker = startWorker({}, { telegramBotToken: '' });
    expect(await worker.message({ action: 'testTelegram', message: 'Hello' })).toMatchObject({
      success: false,
      error: 'Укажите Telegram bot token и chat id в настройках'
    });
    expect(worker.requests).toEqual([]);
  });
  it('does not re-enable an explicitly cleared Groq pool when settings are reopened and saved', async () => {
    const page = startPage(optionsSource, { groqApiKeys: [], groqApiKey: 'test-legacy-groq', byokMode: false });
    await page.ready();
    expect(page.field('groqApiKeys').value).toBe('');
    expect(page.field('byokMode').classList.contains('active')).toBe(false);
    await page.click('saveBtn');
    expect(page.saved.groqApiKeys).toEqual([]);
    const worker = startWorker(page.saved);
    expect(await worker.message({ action: 'callGroq', prompt: 'Hello' })).toMatchObject({
      success: false,
      error: 'No API key configured'
    });
    expect(worker.requests).toEqual([]);
  });

  it('shows an explicitly disabled Groq pool and setup guidance instead of a stale legacy key', async () => {
    const page = startPage(popupSource, { groqApiKeys: [], groqApiKey: 'test-legacy-groq' });
    await page.ready();
    expect(page.field('keyState').textContent).toBe('Пул намеренно отключён');
    expect(page.field('keyGuidance').textContent).toContain('Пул ключей Groq сохранён пустым');
  });

  it('continues to show a legacy key when no saved pool supersedes it', async () => {
    const options = startPage(optionsSource, { groqApiKey: 'test-legacy-groq', byokMode: false });
    await options.ready();
    expect(options.field('groqApiKeys').value).toBe('test-legacy-groq');
    expect(options.field('byokMode').classList.contains('active')).toBe(true);

    const popup = startPage(popupSource, { groqApiKey: 'test-legacy-groq' });
    await popup.ready();
    expect(popup.field('keyState').textContent).toBe('Один сохранённый ключ');
  });

  it('renders only supported action tokens and visibly flags unsupported placeholders', async () => {
    const page = startPage(optionsSource, {
      actionPrompts: { twitter: 'Open {url}; summarize {noteExcerpt}; keep {tags}.' }
    });
    await page.ready();
    const metadata = page.insertedElements.find((entry) => entry.after === 'actionPrompt_twitter')?.element;
    expect(metadata?.textContent).toContain('{tags}');
    expect(metadata?.textContent).toContain('Неподдерживаемые renderer-ом переменные');
    const preview = metadata && page.insertedElements.find((entry) => entry.after === metadata.id)?.element;
    expect(preview?.textContent).toContain('https://example.com/article');
    expect(preview?.textContent).toContain('[Фрагмент заметки]');
    expect(preview?.textContent).toContain('{tags}');
  });

  it('renders and previews the registry fallback when a saved legacy prompt is cleared', async () => {
    const page = startPage(optionsSource, {
      summaryPrompt: 'Legacy A {tags}',
      promptOverrides: { summary: 'Registry B {tags}' }
    });
    await page.ready();
    const legacyPreview = page.field('legacyPromptPreview_summary');
    const registryPreview = page.field('promptPreview_summary');
    expect(legacyPreview.textContent).toContain('Legacy A исследование, продукт');
    expect(legacyPreview.textContent).not.toContain('[object Object]');

    page.field('summaryPrompt').value = '';
    page.field('summaryPrompt').dispatchEvent(new Event('input', { bubbles: true }));
    expect(legacyPreview.textContent).toContain('Registry B исследование, продукт');
    expect(page.field('legacyPromptMeta_summary').textContent).toContain('Сохранённый registry override');
    expect(page.field('promptOverride_summary').value).toBe('Registry B {tags}');
    expect(registryPreview.textContent).toContain('Registry B исследование, продукт');
    expect(page.field('promptRegistryMeta_summary').textContent).toContain('Сохранённый registry override');

    await page.click('saveBtn');
    expect(page.saved.summaryPrompt).toBe('');
    expect((page.saved.promptOverrides as Storage).summary).toBe('Registry B {tags}');
  });

  it('keeps unsupported registry placeholders literal and flags them in card preview and metadata', async () => {
    const page = startPage(optionsSource, {
      promptOverrides: { generateTitle: 'Use {content}, then {content}; {tags} is unsupported.' }
    });
    await page.ready();
    const metadata = page.field('promptRegistryMeta_generateTitle').textContent;
    const preview = page.field('promptPreview_generateTitle').textContent;
    expect(preview).toContain('[Фрагмент страницы]');
    expect(preview).toContain('{content}');
    expect(preview).toContain('{tags}');
    expect(metadata).toContain('Неподдерживаемые переменные');
    expect(metadata).toContain('{tags}');
  });

  it('renders legacy JSON and section-enrich previews as substituted text on load and draft input', async () => {
    const page = startPage(optionsSource, {
      summaryJsonPrompt: 'JSON {tags} {browserContext}',
      sectionEnrichPrompt: 'Enrich {section} {content}'
    });
    await page.ready();
    const jsonPreview = page.field('legacyPromptPreview_summaryJson');
    const enrichPreview = page.field('legacyPromptPreview_sectionEnrich');
    expect(jsonPreview.textContent).toBe('JSON исследование, продукт [Контекст браузера]');
    expect(enrichPreview.textContent).toContain('Enrich {section} {content}');
    expect(enrichPreview.textContent).toContain('Неподдерживаемые переменные остаются без подстановки');

    page.field('summaryJsonPrompt').value = 'Draft {tags}';
    page.field('summaryJsonPrompt').dispatchEvent(new Event('input', { bubbles: true }));
    expect(jsonPreview.textContent).toBe('Draft исследование, продукт');
    expect(jsonPreview.textContent).not.toContain('[object Object]');
    page.field('sectionEnrichPrompt').value = 'Draft enrich {content}';
    page.field('sectionEnrichPrompt').dispatchEvent(new Event('input', { bubbles: true }));
    expect(enrichPreview.textContent).toContain('Draft enrich {content}');
    expect(enrichPreview.textContent).toContain('Неподдерживаемые переменные остаются без подстановки');
  });

  it('saves only customized action templates rather than all displayed defaults', async () => {
    const page = startPage(optionsSource, { actionPrompts: { twitter: 'Write my own concise thread.' } });
    await page.ready();
    expect(page.field('actionPrompt_twitter').value).toBe('Write my own concise thread.');
    await page.click('saveBtn');
    expect(Object.keys(page.saved.actionPrompts as Storage)).toEqual(['twitter']);
    expect((page.saved.actionPrompts as Storage).twitter).toBe('Write my own concise thread.');

    const fresh = startPage(optionsSource, {});
    await fresh.ready();
    await fresh.click('saveBtn');
    expect(Object.keys(fresh.saved.actionPrompts as Storage)).toEqual([]);
  });

  it('removes only exact old auto-saved action defaults, keeping an edited prompt', async () => {
    const previous = startPage(optionsSource, {
      actionPrompts: { learning: legacyLearningTemplate, twitter: 'My different thread.' }
    });
    await previous.ready();
    expect(Object.keys(previous.saved.actionPrompts as Storage)).toEqual(['twitter']);
    expect((previous.saved.actionPrompts as Storage).twitter).toBe('My different thread.');
    expect(previous.field('actionPrompt_learning').value).not.toBe(legacyLearningTemplate);
    expect(previous.syncWrites).toHaveLength(1);

    const customized = startPage(optionsSource, {
      actionPrompts: { learning: `${legacyLearningTemplate}\nMy personal instruction.` }
    });
    await customized.ready();
    expect((customized.saved.actionPrompts as Storage).learning).toContain('My personal instruction.');
    expect(customized.syncWrites).toEqual([]);
  });

  it('resets registry previews and source labels to the shared default, clearing both legacy and registry overrides', async () => {
    const page = startPage(optionsSource, {
      summaryPrompt: 'Legacy customized summary',
      promptOverrides: {
        summary: 'Registry customized summary',
        createCommand: 'Registry customized command'
      }
    });
    await page.ready();
    const preview = page.field('legacyPromptPreview_summary');
    const registryPreview = page.field('promptPreview_summary');
    const legacySource = page.field('legacyPromptMeta_summary');
    const registrySource = page.field('promptRegistryMeta_summary');
    preview.textContent = 'old legacy preview';
    registryPreview.textContent = 'old registry preview';
    legacySource.textContent = 'legacy override';
    registrySource.textContent = 'legacy > registry > default';
    page.field('promptOverride_summary').value = 'Registry customized summary';
    page.field('promptOverride_createCommand').value = 'Registry customized command';
    page.field('promptPreview_createCommand').textContent = 'old command preview';
    page.field('promptRegistryMeta_createCommand').textContent = 'registry override';

    await page.click('resetSummaryPromptBtn');
    expect(page.field('summaryPrompt').value).toBe('');
    expect(preview.textContent).not.toBe('old legacy preview');
    expect(registryPreview.textContent).not.toBe('old registry preview');
    expect(legacySource.textContent).toContain('runtime default');
    expect(registrySource.textContent).toContain('registry-overrides');

    await page.click('resetAllPromptOverridesBtn');
    expect(page.field('promptOverride_createCommand').value).not.toBe('Registry customized command');
    expect(page.field('promptPreview_createCommand').textContent).not.toBe('old command preview');
    expect(page.field('promptRegistryMeta_createCommand').textContent).toContain('runtime default');
    expect(page.saved.summaryPrompt).toBe('Legacy customized summary');
    expect((page.saved.promptOverrides as Storage).summary).toBe('Registry customized summary');
    await page.click('saveBtn');
    expect(page.saved.summaryPrompt).toBe('');
    expect((page.saved.promptOverrides as Storage).summary).toBeUndefined();
    expect((page.saved.promptOverrides as Storage).createCommand).toBeUndefined();
  });

  it('completes shared global reset whether tracker reset is supported or unknown, preserving the artifact archive', async () => {
    for (const runtimeMessageSuccess of [true, false]) {
      const page = startPage(
        optionsSource,
        { groqApiKeys: ['synthetic-key'], promptOverrides: { summary: 'saved' } },
        true,
        runtimeMessageSuccess,
        { artifactArchive: [{ id: 'kept' }], telegramBotToken: 'saved-token' }
      );
      await page.ready();
      await page.click('resetBtn');
      expect(page.syncClears).toHaveLength(1);
      expect(page.messages.some((message) => message.action === 'resetTrackerStats')).toBe(true);
      expect(page.reloads).toHaveLength(1);
      expect(page.localSaved.artifactArchive).toEqual([{ id: 'kept' }]);
      expect(page.localSaved.telegramBotToken).toBeUndefined();
    }
  });

  it('tests only saved Telegram configuration and rejects a cancelled reset without writes', async () => {
    const page = startPage(optionsSource, { groqApiKeys: ['synthetic-key'] });
    await page.ready();
    page.field('telegramBotToken').value = 'unsaved-draft-token';
    await page.click('testTelegramBtn');
    expect(page.messages.filter(message => message.action === 'testTelegram')).toHaveLength(1);
    expect(page.syncWrites).toEqual([]);
    expect(page.localWrites).toEqual([]);
    expect(page.saved.telegramBotToken).toBeUndefined();

    const cancelled = startPage(optionsSource, {}, false);
    await cancelled.ready();
    await cancelled.click('resetBtn');
    expect(cancelled.syncWrites).toEqual([]);
    expect(cancelled.localWrites).toEqual([]);
  });
});
