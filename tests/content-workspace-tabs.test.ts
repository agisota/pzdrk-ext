import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { describe, expect, it } from 'vitest';

type WorkspaceTitleHelpers = {
  getWorkspaceCommandTitle: (cmd?: Record<string, unknown>, fallback?: string) => string;
  isGenericWorkspaceTabTitle: (value?: unknown) => boolean;
  resolveWorkspaceTabTitle: (tabId?: string, incomingTitle?: string, previousTitle?: string) => string;
};

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function loadWorkspaceTitleHelpers(): WorkspaceTitleHelpers {
  const source = fs.readFileSync(path.resolve(__dirname, '../content.js'), 'utf8');
  const start = source.indexOf('const WORKSPACE_COMMAND_TITLE_FALLBACKS');
  const end = source.indexOf('const WORKSPACE_TAB_PREFETCH_DELAY_MS');

  if (start < 0 || end <= start) {
    throw new Error('Failed to locate workspace title helper block in content.js');
  }

  const snippet = source.slice(start, end);
  const factory = new Function(
    `${snippet}
    return {
      getWorkspaceCommandTitle,
      isGenericWorkspaceTabTitle,
      resolveWorkspaceTabTitle
    };`
  ) as () => WorkspaceTitleHelpers;

  return factory();
}

describe('workspace tab title helpers', () => {
  const helpers = loadWorkspaceTitleHelpers();

  it('keeps a previous readable title when activation sends a generic fallback', () => {
    expect(helpers.resolveWorkspaceTabTitle('cmd-deepdive', 'Вкладка', 'Разбор')).toBe('Разбор');
    expect(helpers.resolveWorkspaceTabTitle('cmd-opsplan', 'tab', 'План')).toBe('План');
  });

  it('derives readable Russian titles for built-in workspace commands', () => {
    expect(helpers.getWorkspaceCommandTitle({ id: 'translate_page', title: 'Вкладка' })).toBe('Перевести страницу');
    expect(helpers.getWorkspaceCommandTitle({ id: 'twitter' })).toBe('Тред');
    expect(helpers.resolveWorkspaceTabTitle('cmd-translate-page', 'Вкладка', '')).toBe('Перевести страницу');
    expect(helpers.resolveWorkspaceTabTitle('cmd-frontendbuilder', 'Вкладка', '')).toBe('Интерфейс');
    expect(helpers.resolveWorkspaceTabTitle('cmd-sources', 'Вкладка', '')).toBe('Источники');
  });

  it('preserves custom non-generic tab titles', () => {
    expect(helpers.isGenericWorkspaceTabTitle('Вкладка')).toBe(true);
    expect(helpers.isGenericWorkspaceTabTitle('Карта')).toBe(false);
    expect(helpers.getWorkspaceCommandTitle({ id: 'custom', title: 'Свой анализ' })).toBe('Свой анализ');
  });
});
