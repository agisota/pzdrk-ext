import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { describe, expect, it } from 'vitest';

type ConcretePrompt = {
  title: string;
  desc: string;
  prompt: string;
};

type SummaryLike = Record<string, unknown>;

type SummaryHelpers = {
  normalizeConcretePromptEntry: (item: unknown) => ConcretePrompt | null;
  normalizeSummaryRightBlock: (right: unknown) => Record<string, unknown>;
  orderSummarySections: (summaryObj: SummaryLike) => Array<Record<string, unknown>>;
  collectSummaryActions: (summaryObj: SummaryLike, limit?: number) => string[];
  deriveConcretePromptsFromActions: (actions: unknown[], options?: Record<string, unknown>) => ConcretePrompt[];
  ensureConcretePrompts: (summaryObj: SummaryLike, options?: Record<string, unknown>) => ConcretePrompt[];
  renderConcretePromptCards: (prompts: unknown[]) => string;
};

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function loadSummaryHelpers(): SummaryHelpers {
  const source = fs.readFileSync(path.resolve(__dirname, '../content.js'), 'utf8');
  const start = source.indexOf('function normalizeConcretePromptEntry');
  const end = source.indexOf('function renderRightBlock');

  if (start < 0 || end <= start) {
    throw new Error('Failed to locate summary helper block in content.js');
  }

  const snippet = source.slice(start, end);
  const factory = new Function(
    'normalizeBulletLine',
    'extractTextCandidate',
    'slugifyForId',
    'escapeAttr',
    'escapeHtml',
    'document',
    `${snippet}
    return {
      normalizeConcretePromptEntry,
      normalizeSummaryRightBlock,
      orderSummarySections,
      collectSummaryActions,
      deriveConcretePromptsFromActions,
      ensureConcretePrompts,
      renderConcretePromptCards
    };`
  ) as (
    normalizeBulletLine: (value: unknown) => string,
    escapeAttr: (value?: string) => string,
    escapeHtml: (value?: string) => string,
    document: { title: string }
  ) => SummaryHelpers;

  const extractTextCandidate = (function build() {
    const walk = (value: unknown, depth = 0): string => {
      if (value == null) return '';
      if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
        return String(value);
      }
      if (depth >= 2) return '';
      if (Array.isArray(value)) {
        return value.map(item => walk(item, depth + 1)).filter(Boolean).join(' — ');
      }
      if (typeof value === 'object') {
        for (const key of ['label', 'title', 'text', 'name', 'summary', 'description', 'definition', 'prompt', 'action', 'task', 'content', 'value', 'question', 'why', 'note', 'context']) {
          const candidate = walk((value as Record<string, unknown>)[key], depth + 1);
          if (candidate) return candidate;
        }
        const flat = Object.values(value as Record<string, unknown>)
          .map(item => walk(item, depth + 1))
          .filter(Boolean);
        if (flat.length) return flat.join(' — ');
      }
      return '';
    };
    return walk;
  })();

  const normalizeBulletLine = (value: unknown) => extractTextCandidate(value)
    .replace(/^[-•]\s+/, '')
    .trim()
    .replace(/\s+/g, ' ')
    .slice(0, 420);

  const escapeHtml = (value = '') => String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

  return factory(
    normalizeBulletLine,
    extractTextCandidate,
    (value = '') => String(value)
      .trim()
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[^\p{L}\p{N}]+/gu, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 48) || 'sec',
    (value = '') => escapeHtml(value).replace(/\n/g, ' '),
    escapeHtml,
    { title: 'Document Fallback' }
  );
}

describe('content summary helpers', () => {
  const helpers = loadSummaryHelpers();

  it('collects top-level and section-level actions without duplicates', () => {
    const actions = helpers.collectSummaryActions({
      actions: [
        'Draft FOIA request',
        { task: 'Build source timeline' }
      ],
      sections: [
        { actions: ['Draft FOIA request', { action: 'Contact archive desk' }] },
        { actions: [{ prompt: 'Create verification checklist' }] }
      ]
    });

    expect(actions).toEqual([
      'Draft FOIA request',
      'Build source timeline',
      'Contact archive desk',
      'Create verification checklist'
    ]);
  });

  it('derives concrete prompts from section actions when top-level actions are missing', () => {
    const summaryObj: SummaryLike = {
      title: 'Stargate review',
      til: ['FOIA status matters', 'Need primary-source validation'],
      sections: [
        { actions: ['File FOIA request with exact tape identifiers'] },
        { actions: [{ task: 'Build evidence matrix by source reliability' }] }
      ]
    };

    const prompts = helpers.ensureConcretePrompts(summaryObj, { title: 'Stargate review' });

    expect(prompts).toHaveLength(2);
    expect(prompts[0].title).toBe('File FOIA request with exact tape identifiers');
    expect(prompts[0].prompt).toContain('используй summary по странице "Stargate review"');
    expect(prompts[0].prompt).toContain('Полезные сигналы из заметки');
    expect(prompts[0].prompt).toContain('ВЕРНИ:');
    expect(prompts[0].prompt).toContain('КРИТЕРИЙ КАЧЕСТВА');
    expect(prompts[0].prompt).toContain('Разделяй факт, inference, гипотезу');
    expect(prompts[1].title).toBe('Build evidence matrix by source reliability');
    expect(summaryObj.concrete_prompts).toEqual(prompts);
  });

  it('normalizes object-like prompt entries into readable cards', () => {
    const entry = helpers.normalizeConcretePromptEntry({
      task: 'Pressure-test the claim',
      why: 'Focus on missing evidence',
      content: 'List the weakest assumptions and how to verify them'
    });

    expect(entry).toEqual({
      title: 'Pressure-test the claim',
      desc: 'Focus on missing evidence',
      prompt: 'List the weakest assumptions and how to verify them'
    });
  });

  it('renders escaped prompt cards and caps the list at eight entries', () => {
    const html = helpers.renderConcretePromptCards(Array.from({ length: 10 }, (_, index) => ({
      title: `Prompt <${index + 1}>`,
      desc: `Description ${index + 1}`,
      prompt: `Do <step ${index + 1}>`
    })));

    expect(html).toContain('Prompt &lt;1&gt;');
    expect(html).toContain('data-concrete-prompt="Do &lt;step 1&gt;"');
    expect((html.match(/class="pzdrk-prompt-card"/g) || [])).toHaveLength(8);
    expect(html).not.toContain('Prompt &lt;9&gt;');
    expect(html).toContain('готовый запрос');
    expect(html).toContain('точечный prompt');
  });

  it('renders a waiting state when prompt cards are not ready yet', () => {
    const html = helpers.renderConcretePromptCards([]);

    expect(html).toContain('class="pzdrk-state-card is-waiting is-compact"');
    expect(html).toContain('Готовые запросы ещё собираются');
  });

  it('orders sections, injects TL;DR first, and synthesizes automation section', () => {
    const summaryObj: SummaryLike = {
      title: 'Signal review',
      actions: ['Собрать таблицу сигналов по источникам'],
      sections: [
        { key: 'usage', label: 'ПРИМЕНЕНИЕ И USE-CASES', left: ['Использовать материал как основу для проверки гипотез'] },
        { key: 'core', label: 'СУТЬ', left: ['Материал описывает эксперимент и ожидаемые эффекты', 'Есть методика, но часть подтверждений косвенная'] }
      ]
    };

    const sections = helpers.orderSummarySections(summaryObj);

    expect(sections[0].key).toBe('tldr');
    expect(sections[0].label).toBe('TL;DR');
    expect(sections[1].key).toBe('core');
    expect(sections.some(section => section.key === 'automation')).toBe(true);
    expect(summaryObj.concrete_prompts).toBeDefined();
  });

  it('normalizes nested object-like right-side content into readable text', () => {
    const right = helpers.normalizeSummaryRightBlock({
      commentary: [{ text: 'Главный вывод', note: 'через nested object' }],
      terms: [{ term: { label: 'remote viewing' }, definition: { text: 'Термин для практики удалённого восприятия' } }],
      entities: [{ name: { title: 'CIA' }, context: { description: 'архив и программа наблюдений' }, exaQuery: { value: 'CIA Stargate archive' } }],
      refs: [{ query: { text: 'CIA Stargate archive FOIA' }, why: { note: 'проверить первоисточники' } }]
    });

    expect(right).toEqual({
      commentary: ['Главный вывод'],
      terms: [{ term: 'remote viewing', definition: 'Термин для практики удалённого восприятия' }],
      entities: [{ name: 'CIA', context: 'архив и программа наблюдений', exaQuery: 'CIA Stargate archive' }],
      refs: [{ query: 'CIA Stargate archive FOIA', why: 'проверить первоисточники' }]
    });
  });
});
