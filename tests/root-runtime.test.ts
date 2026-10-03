import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';
import { describe, expect, it } from 'vitest';

const promptSource = readFileSync(new URL('../prompt-defaults.js', import.meta.url), 'utf8');
const runtimeSource = readFileSync(new URL('../content.js', import.meta.url), 'utf8');
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

function startRoot(settings: Record<string, unknown> = {}) {
  const scheduled: Array<() => void> = [];
  const context = createContext({
    chrome: {
      runtime: { getURL: (path: string) => `chrome-extension://test/${path}`, onMessage: { addListener() {} } },
      storage: {
        sync: { get: async () => ({ ...settings }) },
        local: { get: async () => ({}) }
      }
    },
    crypto: undefined,
    document: { readyState: 'loading', addEventListener() {} },
    window: { location: { href: 'https://example.test/' }, addEventListener() {}, setTimeout: (callback: () => void) => { scheduled.push(callback); } },
    console,
    clearTimeout,
    setTimeout: (callback: () => void) => { scheduled.push(callback); }
  });
  runInContext(promptSource, context);
  runInContext(runtimeSource, context);
  return { context, scheduled, evaluate: (expression: string) => runInContext(expression, context) };
}

function startDockedPanel() {
  const root = startRoot();
  const handlers = new Map<string, (event?: unknown) => void>();
  const headerHandlers = new Map<string, (event?: unknown) => void>();
  const timers = new Map<number, () => void>();
  const classes = new Set<string>();
  const attributes = new Map<string, string>();
  const header = {
    setAttribute: (name: string, value: string) => attributes.set(name, value),
    addEventListener: (name: string, handler: (event?: unknown) => void) => headerHandlers.set(name, handler)
  };
  const button = { textContent: '', setAttribute: (name: string, value: string) => attributes.set(name, value) };
  const note = {
    dataset: { layout: 'grid', manual: 'false', pinned: 'true' } as Record<string, string>,
    style: { position: 'fixed', left: '100px', top: '8px', right: '', bottom: '', width: '', height: '', maxHeight: '', transform: '' },
    isConnected: true,
    hovered: false,
    focused: false,
    classList: {
      contains: (name: string) => classes.has(name),
      add: (...names: string[]) => names.forEach(name => classes.add(name)),
      remove: (...names: string[]) => names.forEach(name => classes.delete(name))
    },
    matches: (selector: string) => selector === ':hover' ? note.hovered : selector === ':focus-within' && note.focused,
    querySelector: (selector: string) => selector === '.pzdrk-note-header' ? header : button,
    addEventListener: (name: string, handler: (event?: unknown) => void) => handlers.set(name, handler)
  };
  let nextTimer = 0;
  root.context.setTimeout = (callback: () => void) => { timers.set(++nextTimer, callback); return nextTimer; };
  root.context.clearTimeout = (id: number) => timers.delete(id);
  root.context.panel = note;
  root.evaluate('scheduleLayoutNotes = () => {}; bindNoteDockBehavior(panel);');
  return {
    note, attributes, headerHandlers,
    fire: (name: string, event = { target: { closest: () => null } }) => handlers.get(name)?.(event),
    flush: () => { const pending = [...timers.values()]; timers.clear(); pending.forEach(callback => callback()); }
  };
}

describe('root extension prompt/runtime behavior', () => {
  it('keeps a full multiline generated prompt copyable while escaping markup', () => {
    const root = startRoot();
    const fullPrompt = `Study <private> evidence.\n${'Check the original source before citing it. '.repeat(40)}\nReturn a decision.`;
    root.context.fullPrompt = fullPrompt;
    const item = root.evaluate('normalizeConcretePromptEntry({ title: "Check evidence", prompt: fullPrompt })');
    expect(item.prompt).toBe(fullPrompt);
    const html: string = root.evaluate('renderConcretePromptCards([{ title: "Check evidence", prompt: fullPrompt }])');
    const encoded = html.match(/data-concrete-prompt="([^"]+)"/)?.[1];
    expect(encoded).toBeDefined();
    expect(decodeURIComponent(encoded!)).toBe(fullPrompt);
    expect(html).not.toContain('<private>');
  });
  it('accepts omitted or empty right-side details but rejects malformed supplied collections', () => {
    const root = startRoot();
    root.context.valid = {
      title: 'Summary',
      sections: [{ key: 'tldr', left: ['A'] }, { key: 'core', left: ['B'], right: {} }]
    };
    expect(root.evaluate('validateSummaryJson(valid)')).not.toBeNull();
    for (const field of ['commentary', 'terms', 'entities', 'refs']) {
      root.context.field = field;
      expect(root.evaluate('validateSummaryJson({ ...valid, sections: [{ ...valid.sections[0], right: { [field]: "invalid" } }, valid.sections[1]] })')).toBeNull();
    }
    expect(root.evaluate('validateSummaryJson({ ...valid, sections: [{ ...valid.sections[0], right: { commentary: [], terms: [], entities: [], refs: [] } }, valid.sections[1]] })')).not.toBeNull();
  });

  it('accepts a brief source without inventing a second section and rejects a malformed supplied section', () => {
    const root = startRoot();
    root.context.brief = { title: 'Brief', sections: [{ key: 'tldr', left: ['One supported fact'] }] };
    expect(root.evaluate('validateSummaryJson(brief)?.sections')).toMatchObject([{ key: 'tldr', left: ['One supported fact'] }]);
    expect(root.evaluate('validateSummaryJson({ ...brief, sections: [...brief.sections, {key:"core",left:["Detail"],right:{terms:"invalid"}}] })')).toBeNull();
  });

  it('preserves supplied term definitions and checkable evidence without executing their markup', () => {
    const root = startRoot();
    const html: string = root.evaluate('renderRightBlock({terms:[{term:"Mulch",definition:"Retains water <script>alert(1)</script>"}],refs:[{query:"Check soil at 3–5 cm",why:"Before watering"}]})');
    expect(html).toContain('Retains water &lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).toContain('Check soil at 3–5 cm');
    expect(html).not.toContain('<script>');
  });

  it('preserves the short def field accepted by summary enrichment and omits empty definition punctuation', () => {
    const root = startRoot();
    const html: string = root.evaluate('renderRightBlock({terms:[{term:"Calibration",def:"Compare against a manual reading."},{term:"Root zone"}]})');
    expect(html).toContain('Compare against a manual reading.');
    expect(html).not.toContain('<strong>Root zone</strong>:');
  });

  it('keeps distinct explanations when repeated source points are deduplicated', () => {
    const root = startRoot();
    root.context.summary = {
      title: 'Water pilot',
      sections: [
        { key: 'tldr', left: ['Check soil at 5 cm'], right: { commentary: ['Surface dryness is not root-zone dryness.'] } },
        { key: 'core', left: ['Check soil at 5 cm'], right: { commentary: ['Calibrate before opening the valve.'] } }
      ]
    };
    const html: string = root.evaluate('renderSummaryJsonHtml(summary)');
    expect(html).toContain('Surface dryness is not root-zone dryness.');
    expect(html).toContain('Calibrate before opening the valve.');
  });

  it('renders rich source text and a complete contextual prompt without executable markup', () => {
    const root = startRoot();
    const fullPrompt = `Create a seven-day log.\n${'Record rain, sensor reading and manual decision. '.repeat(20)}\nDo not invent a water dosage.`;
    root.context.summary = {
      title: 'Pilot',
      sections: [{ key: 'tldr', left: ['**Check** at *5 cm* using `sensor read` and [documentation](https://example.test/guide). <img src=x onerror=alert(1)>'], right: { commentary: ['**Calibration** comes before automatic watering.'] } }],
      concrete_prompts: [{ title: 'Build the pilot log', desc: 'Make the comparison auditable.', prompt: fullPrompt }]
    };
    const html: string = root.evaluate('renderSummaryJsonHtml(summary)');
    expect(html).toContain('<strong>Check</strong>');
    expect(html).toContain('<em>5 cm</em>');
    expect(html).toContain('<code>sensor read</code>');
    expect(html).toContain('href="https://example.test/guide"');
    expect(html).toContain('<strong>Calibration</strong>');
    expect(html).toContain('Make the comparison auditable.');
    expect(html).toContain('Do not invent a water dosage.');
    expect(html).not.toContain('<img');
    const prompt = html.match(/data-followup="([^"]*)"/)?.[1];
    expect(prompt?.replace(/&#10;|&#xA;/gi, '\n')).toBe(fullPrompt);
  });

  it('renders saved and derivable related results according to the opt-in setting', () => {
    const root = startRoot();
    root.context.cachedSummary = {
      related_searches: [{ title: 'Primary source', url: 'https://example.test/source' }],
      workflow_suggestions: [{ title: 'Verify claim', desc: 'Check a primary source', prompt: 'Build an evidence table' }]
    };
    const enabled: string = root.evaluate('renderRelatedSummaryHtml(cachedSummary, true)');
    expect(enabled).toContain('href="https://example.test/source"');
    expect(enabled).toContain('class="pzdrk-workflow-tile"');
    const disabled: string = root.evaluate('renderRelatedSummaryHtml(cachedSummary, false)');
    expect(disabled).not.toContain('class="pzdrk-related-link"');
    expect(disabled).not.toContain('class="pzdrk-workflow-tile"');
    expect(disabled).toContain('is-muted');
    root.context.legacyCachedSummary = {
      title: 'Cached evidence',
      actions: ['Verify the original source'],
      sections: [{ key: 'tldr', label: 'TLDR', left: ['Signal'] }, { key: 'core', label: 'Core', left: ['Details'] }]
    };
    const legacy: string = root.evaluate('renderRelatedSummaryHtml(legacyCachedSummary, true)');
    expect(legacy).toContain('class="pzdrk-related-link"');
    expect(legacy).toContain('class="pzdrk-workflow-tile"');
  });

  it('starts neither related outbound request unless prefetch is opted in', async () => {
    const root = startRoot();
    root.evaluate('searchCalls = 0; workflowCalls = 0; callExa = async () => { searchCalls++; return []; }; callGroq = async () => { workflowCalls++; return "[]"; };');
    await root.evaluate('prefetchRelatedSummary({ prefetchOnHover: false }, "title", "seed")');
    expect(root.context.searchCalls).toBe(0);
    expect(root.context.workflowCalls).toBe(0);
    await root.evaluate('prefetchRelatedSummary({ prefetchOnHover: true }, "title", "seed")');
    expect(root.context.searchCalls).toBe(1);
    expect(root.context.workflowCalls).toBe(1);
  });

  it('rejects blank direct and fallback summary output instead of treating it as ready', () => {
    const root = startRoot();
    expect(root.evaluate('hasUsableSummaryOutput(null, "  \\n ")')).toBe(false);
    expect(root.evaluate('hasUsableSummaryOutput(null, "A useful summary")')).toBe(true);
    expect(root.evaluate('hasUsableSummaryOutput({ title: "x", sections: [{key:"tldr",left:["a"]},{key:"core",left:["b"]}] }, "")')).toBe(true);
    expect(root.evaluate('hasUsableSummaryOutput({ title: 4, sections: [] }, "fallback")')).toBe(false);
    expect(root.evaluate('isCacheableSummary("", "markdown")')).toBe(false);
    expect(root.evaluate('isCacheableSummary("A useful summary", "markdown")')).toBe(true);
    expect(root.evaluate('isCacheableSummary({ title: "x", sections: [] }, "json")')).toBe(false);
  });

  it('keeps custom succinct prompt overrides instead of fuzzy-rejecting their wording', () => {
    const root = startRoot();
    root.evaluate('runtimeSettings = { promptOverrides: { summary: "КАРТА и МЕХАНИЗМ; ЗАЧЕМ ВАЖНО — коротко." } };');
    expect(root.evaluate('getPromptOverride("summary")')).toBe('КАРТА и МЕХАНИЗМ; ЗАЧЕМ ВАЖНО — коротко.');
  });

  it('supports missing WebCrypto without treating custom prompts as legacy defaults', async () => {
    const root = startRoot();
    expect(root.evaluate('typeof crypto')).toBe('undefined');
    expect(typeof root.evaluate('ROX_PROMPT_DEFAULTS.isLegacyActionPromptDefault')).toBe('function');
    expect(await root.evaluate('ROX_PROMPT_DEFAULTS.isLegacyActionPromptDefault("unknown", "user prompt")')).toBe(false);
    expect(await root.evaluate('ROX_PROMPT_DEFAULTS.isLegacyActionPromptDefault("twitter", "user prompt")')).toBe(false);
  });

  it('marks extraction that exceeds its cap as visibly partial', () => {
    const root = startRoot();
    root.context.document = {
      querySelector: () => ({
        cloneNode: () => ({
          querySelectorAll: () => ({ forEach() {} }),
          innerText: 'x'.repeat(250_010)
        })
      }),
      body: {}
    };
    const extracted: string = root.evaluate('extractPageContent({ maxChars: 250000 })');
    root.context.extracted = extracted;
    expect(extracted).toContain('ОСТАТОК СТРАНИЦЫ ОПУЩЕН');
    expect(root.evaluate('isExtractionPartial(extracted)')).toBe(true);
  });
  it('does not fetch tooltips on hover by default and binds related content only once', async () => {
    const root = startRoot();
    const handlers: Record<string, Array<(event: Record<string, unknown>) => void>> = {};
    const term = {
      dataset: { term: 'Example' },
      textContent: 'Example',
      addEventListener(name: string, handler: (event: Record<string, unknown>) => void) {
        (handlers[name] ||= []).push(handler);
      }
    };
    const container = {
      querySelectorAll: (selector: string) => selector === '.pzdrk-term' ? [term] : [],
      querySelector: () => null,
      closest: () => container
    };
    root.context.termContainer = container;
    root.evaluate('runtimeSettings = { prefetchOnHover: false }; tooltipCalls = 0; getTermTooltip = async () => { tooltipCalls++; return { def: "definition" }; }; showTooltipAt = () => {}; hideTooltip = () => {};');
    root.evaluate('setupHoverInteractions(termContainer); setupHoverInteractions(termContainer);');
    expect(handlers.mouseenter).toHaveLength(1);
    expect(handlers.click).toHaveLength(1);
    handlers.mouseenter[0]({ pageX: 1, pageY: 2 });
    expect(root.scheduled).toHaveLength(0);
    expect(root.context.tooltipCalls).toBe(0);
    handlers.click[0]({ pageX: 1, pageY: 2, preventDefault() {}, stopPropagation() {} });
    await Promise.resolve();
    root.scheduled.length = 0;
    root.evaluate('runtimeSettings = { prefetchOnHover: true };');
    handlers.mouseenter[0]({ pageX: 1, pageY: 2 });
    expect(root.scheduled).toHaveLength(1);
    root.scheduled[0]();
    await Promise.resolve();
    expect(root.context.tooltipCalls).toBe(2);
  });
  it('executes a queued workspace pane once and only activates a ready pane', async () => {
    const root = startRoot();
    let executions = 0;
    let activations = 0;
    root.context.commandPane = {};
    root.context.commandMeta = { status: 'queued' };
    root.context.activatePane = () => { activations += 1; };
    root.context.executeCommand = async () => { executions += 1; };
    await root.evaluate('routeWorkspaceCommandClick(commandPane, commandMeta, false, activatePane, executeCommand)');
    expect(executions).toBe(1);
    expect(activations).toBe(0);

    root.context.commandMeta = { status: 'ready' };
    await root.evaluate('routeWorkspaceCommandClick(commandPane, commandMeta, false, activatePane, executeCommand)');
    expect(executions).toBe(1);
    expect(activations).toBe(1);
  });
  it('reveals a failed summary, escapes the provider error and replaces the panel on retry', async () => {
    const root = startRoot();
    const classes = new Set(['loading', 'collapsed']);
    const fields = new Map<string, {
      textContent: string; innerHTML: string;
      addEventListener: (event: string, handler: () => void) => void;
      click: () => void;
    }>();
    const handlers = new Map<string, () => void>();
    const field = (selector: string) => {
      if (!fields.has(selector)) fields.set(selector, {
        textContent: selector === '.pzdrk-note-title' ? 'Анализирую...' : '',
        innerHTML: '',
        addEventListener: (_event, handler) => { handlers.set(selector, handler); },
        click: () => { handlers.get(selector)?.(); }
      });
      return fields.get(selector)!;
    };
    let closed = false;
    let retries = 0;
    const note = {
      dataset: { pinned: 'false' },
      querySelector: field,
      classList: { remove: (...names: string[]) => names.forEach(name => classes.delete(name)) }
    };
    handlers.set('.pzdrk-btn-close', () => { closed = true; });
    root.context.failedNote = note;
    root.evaluate(`
      extractPageContent = () => 'Synthetic page';
      extractHeadings = () => [];
      getCache = () => null;
      createNote = () => failedNote;
      createFloatingHints = () => {};
      getBrowserContext = async () => ({});
      callGroq = async () => { throw new Error('Invalid key <img src=x onerror=alert(1)>'); };
      setNoteTabContent = (note, tabId, html) => { note.querySelector('.pzdrk-note-content').innerHTML = html; return note; };
    `);
    await root.evaluate('summarizePage()');
    expect(classes.has('loading')).toBe(false);
    expect(classes.has('collapsed')).toBe(false);
    expect(field('.pzdrk-note-title').textContent).not.toBe('Анализирую...');
    expect(field('.pzdrk-note-content').innerHTML).not.toContain('<img');
    expect(field('.pzdrk-note-content').innerHTML).toContain('&lt;img');
    expect(root.evaluate('isProcessing')).toBe(false);
    root.context.retrySummary = () => { retries++; };
    root.evaluate('summarizePage = retrySummary;');
    field('.pzdrk-summary-retry').click();
    expect(closed).toBe(true);
    expect(retries).toBe(1);
  });

  it('starts small, previews on hover and returns to the dock after leaving', () => {
    const panel = startDockedPanel();
    expect(panel.note.classList.contains('docked')).toBe(true);
    expect(panel.note.dataset.pinned).toBe('false');
    panel.note.hovered = true;
    panel.fire('mouseenter');
    expect(panel.note.classList.contains('docked')).toBe(false);
    expect(panel.note.dataset.pinned).toBe('false');
    expect(panel.note.style.bottom).toBe('10px');
    panel.note.hovered = false;
    panel.fire('mouseleave');
    panel.flush();
    expect(panel.note.classList.contains('docked')).toBe(true);
    expect(panel.attributes.get('aria-expanded')).toBe('false');
  });

  it('keeps a deliberately opened panel open after the pointer leaves', () => {
    const panel = startDockedPanel();
    expect(panel.note.dataset.pinned).toBe('false');
    panel.fire('mouseenter');
    panel.fire('click');
    panel.fire('mouseleave');
    panel.flush();
    expect(panel.note.classList.contains('docked')).toBe(false);
    expect(panel.note.dataset.pinned).toBe('true');
  });

  it('does not collapse a focused question field or a preview the pointer reentered', () => {
    const panel = startDockedPanel();
    panel.fire('mouseenter');
    panel.fire('mouseleave');
    panel.note.focused = true;
    panel.flush();
    expect(panel.note.classList.contains('docked')).toBe(false);
    panel.note.focused = false;
    panel.fire('focusout');
    panel.fire('mouseenter');
    panel.note.hovered = true;
    panel.flush();
    expect(panel.note.classList.contains('docked')).toBe(false);
    panel.note.hovered = false;
    panel.fire('mouseleave');
    panel.flush();
    expect(panel.note.classList.contains('docked')).toBe(true);
  });

  it('strips the exact legacy learning template without WebCrypto but preserves a customized version', async () => {
    const legacyRoot = startRoot({ actionPrompts: { learning: legacyLearningTemplate } });
    expect(legacyRoot.evaluate('typeof crypto')).toBe('undefined');
    const legacySettings = await legacyRoot.evaluate('getSettings()');
    expect(legacySettings.actionPrompts).toEqual({});

    const customizedTemplate = `${legacyLearningTemplate}\nKeep my added constraint.`;
    const customizedRoot = startRoot({ actionPrompts: { learning: customizedTemplate } });
    expect(customizedRoot.evaluate('typeof crypto')).toBe('undefined');
    const customizedSettings = await customizedRoot.evaluate('getSettings()');
    expect(customizedSettings.actionPrompts).toEqual({ learning: customizedTemplate });
  });
});
