import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { describe, expect, it } from 'vitest';

type ActionDef = {
  key: string;
  title: string;
  type: string;
  icon: string;
  hint?: string;
  group?: string;
  pinned?: boolean;
};

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function loadActionHelpers() {
  const source = fs.readFileSync(path.resolve(__dirname, '../content.js'), 'utf8');

  const adaptiveStart = source.indexOf('function getAdaptiveParallelLimit');
  const adaptiveEnd = source.indexOf('function getCacheKey');
  const actionsStart = source.indexOf('function getDefaultActions()');
  const actionsEnd = source.indexOf('const DEFAULT_ACTION_PROMPTS');

  if (adaptiveStart < 0 || adaptiveEnd <= adaptiveStart || actionsStart < 0 || actionsEnd <= actionsStart) {
    throw new Error('Failed to locate action helper blocks in content.js');
  }

  const adaptiveSnippet = source.slice(adaptiveStart, adaptiveEnd);
  const actionsSnippet = source.slice(actionsStart, actionsEnd);

  const adaptiveFactory = new Function(
    'DEFAULT_MAX_PARALLEL_REQUESTS',
    `${adaptiveSnippet}
    return { getAdaptiveParallelLimit };`
  ) as (DEFAULT_MAX_PARALLEL_REQUESTS: number) => {
    getAdaptiveParallelLimit: (settings?: Record<string, unknown>, desired?: number, cap?: number, floor?: number) => number;
  };

  const actionsFactory = new Function(
    `${actionsSnippet}
    return { getDefaultActions };`
  ) as () => {
    getDefaultActions: () => ActionDef[];
  };

  return {
    ...adaptiveFactory(8),
    ...actionsFactory()
  };
}

describe('content action helpers', () => {
  const helpers = loadActionHelpers();

  it('clamps adaptive parallelism to the safe cap', () => {
    expect(helpers.getAdaptiveParallelLimit({}, 8, 8)).toBe(8);
    expect(helpers.getAdaptiveParallelLimit({ maxParallelRequests: 20 }, 8, 8)).toBe(8);
    expect(helpers.getAdaptiveParallelLimit({ maxParallelRequests: 5 }, 8, 8)).toBe(5);
    expect(helpers.getAdaptiveParallelLimit({ maxParallelRequests: 0 }, 6, 4)).toBe(1);
  });

  it('exposes the expanded action catalog with visibility hints', () => {
    const actions = helpers.getDefaultActions();
    const byType = new Map(actions.map(action => [action.type, action]));

    expect(byType.get('timeline')).toMatchObject({ key: '7', group: 'structure', pinned: true });
    expect(byType.get('extract')).toMatchObject({ key: '8', group: 'structure', pinned: true });
    expect(byType.get('briefing')).toMatchObject({ key: '9', group: 'structure', pinned: true });
    expect(byType.get('matrix')).toMatchObject({ key: '0', group: 'structure', pinned: true });
    expect(byType.get('sources')).toMatchObject({ key: 'Q', group: 'analysis', pinned: true });
    expect(byType.get('opsplan')).toMatchObject({ key: 'A', group: 'ops', pinned: true });
    expect(byType.get('faq')).toMatchObject({ key: 'W', group: 'structure', pinned: true });
    expect(byType.get('compare')).toMatchObject({ key: 'D', group: 'structure', pinned: true });
    expect(byType.get('localization')).toMatchObject({ key: 'L', group: 'build', pinned: false });
    expect(byType.get('frontendBuilder')).toMatchObject({ key: 'F', group: 'build', pinned: false });
    expect(byType.get('renderHost')).toMatchObject({ key: 'R', group: 'ops', pinned: false });
    expect(byType.get('timeline')?.hint).toContain('Фазы');
    expect(byType.get('matrix')?.hint).toContain('Сравнение');
    expect(byType.get('briefing')?.title).toBe('Бриф');
    expect(actions).toHaveLength(18);
  });
});
