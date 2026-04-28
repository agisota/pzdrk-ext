import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { describe, expect, it } from 'vitest';

type RichTextHelpers = {
  formatRichText: (text: string) => string;
  isMarkdownTableLine: (line: string) => boolean;
  isPseudoSectionTitleLine: (line: string) => boolean;
};

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function loadRichTextHelpers(): RichTextHelpers {
  const source = fs.readFileSync(path.resolve(__dirname, '../content.js'), 'utf8');
  const start = source.indexOf('function applyInlineRichMarkup');
  const end = source.indexOf('function buildNoteNav');

  if (start < 0 || end <= start) {
    throw new Error('Failed to locate rich text helper block in content.js');
  }

  const snippet = source.slice(start, end);
  const factory = new Function(
    'escapeHtml',
    'unescapeBasicHtml',
    'escapeAttr',
    'slugifyForId',
    `${snippet}
    return { formatRichText, isMarkdownTableLine, isPseudoSectionTitleLine };`
  ) as (
    escapeHtml: (value?: string) => string,
    unescapeBasicHtml: (value?: string) => string,
    escapeAttr: (value?: string) => string,
    slugifyForId: (value?: string) => string
  ) => RichTextHelpers;

  const escapeHtml = (value = '') => String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

  return factory(
    escapeHtml,
    (value = '') => String(value)
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, '\'')
      .replace(/&amp;/g, '&'),
    (value = '') => escapeHtml(value).replace(/\n/g, ' '),
    (value = '') => String(value)
      .trim()
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[^\p{L}\p{N}]+/gu, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 48) || 'sec'
  );
}

describe('content rich text helpers', () => {
  const helpers = loadRichTextHelpers();

  it('recognizes markdown tables and uppercase section titles', () => {
    expect(helpers.isMarkdownTableLine('| № | Этап | Кто |')).toBe(true);
    expect(helpers.isPseudoSectionTitleLine('1. ХРОНОЛОГИЯ - КЛЮЧЕВЫЕ ЭТАПЫ')).toBe(true);
    expect(helpers.isPseudoSectionTitleLine('Обычное предложение с точкой.')).toBe(false);
  });

  it('renders lead blocks, section titles, markdown tables, and inline markup', () => {
    const html = helpers.formatRichText(`Цель — собрать timeline по репозиторию.

1. ХРОНОЛОГИЯ - КЛЮЧЕВЫЕ ЭТАПЫ
| № | Этап | Артефакт |
|---|---|---|
| 1 | [[entity:Nim]] | \`nim c -d:danger\` |

- Проверить сборку
- Сопоставить артефакты`);

    expect(html).toContain('class="pzdrk-rich-lead"');
    expect(html).toContain('class="pzdrk-section-title"');
    expect(html).toContain('class="pzdrk-rich-table is-generic"');
    expect(html).toContain('<th class="is-key-col" data-col="1">№</th>');
    expect(html).toContain('data-entity="Nim"');
    expect(html).toContain('<code>nim c -d:danger</code>');
    expect(html).toContain('<ul class="pzdrk-list">');
  });

  it('adds semantic classes for matrix-style tables', () => {
    const html = helpers.formatRichText(`## Матрица вариантов
| Вариант | Что даёт на практике | Выигрыш сейчас | Цена / риск | Что нужно для запуска | Когда брать |
|---|---|---|---|---|---|
| Минимальный | Быстрый старт | Скорость | Ограничения | Доступ к API | Когда нужно проверить гипотезу |`);

    expect(html).toContain('data-table-variant="matrix"');
    expect(html).toContain('class="pzdrk-rich-table is-matrix"');
    expect(html).toContain('class="is-key-col"');
    expect(html).toContain('pzdrk-rich-table-kicker');
    expect(html).toContain('Матрица вариантов');
  });
});
