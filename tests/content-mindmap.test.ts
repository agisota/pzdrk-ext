import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { describe, expect, it } from 'vitest';

type MindmapNode = {
  id: string;
  label: string;
  description: string;
  insights: string[];
  kind?: string;
  group?: string;
  evidence?: string[];
  questions?: string[];
  children: MindmapNode[];
};

type MindmapData = {
  title: string;
  nodes: MindmapNode[];
  metadata: Record<string, unknown>;
};

type MindmapHelpers = {
  parseJsonArray: (text: string) => unknown[] | null;
  normalizeMindmapData: (raw: unknown) => MindmapData | null;
  countMindmapNodes: (nodes: MindmapNode[]) => number;
  countMindmapBranches: (nodes: MindmapNode[]) => number;
  scoreMindmapNodeForExpansion: (node: MindmapNode) => number;
  pickMindmapExpansionTargets: (
    nodes: MindmapNode[],
    maxTargets?: number,
    options?: { minDepth?: number; maxDepth?: number; maxChildren?: number }
  ) => MindmapNode[];
  buildMindmapExpansionPlan: (data: MindmapData) => Array<{
    title: string;
    contentLimit: number;
    maxTokens: number;
    pickTargets: () => MindmapNode[];
  }>;
  buildMindmapEdgeOverview: (data: MindmapData, limit?: number) => Array<{ label: string; text: string; targetId?: string }>;
  getMindmapModesForNode: (node: MindmapNode) => string[];
  buildMindmapOverview: (data: MindmapData, limit?: number) => {
    focusClusters: Array<{ id: string; label: string; group: string; kind: string }>;
    topSignals: Array<{ label: string; text: string }>;
    topQuestions: Array<{ label: string; text: string }>;
    topRisks: Array<{ label: string; text: string }>;
    topTools: Array<{ label: string; text: string }>;
  };
  buildMindmapChecklist: (data: MindmapData) => string;
  groupMindmapNodesByGroup: (nodes: MindmapNode[], depth?: number, fallbackGroup?: string) => Array<{ label: string; items: MindmapNode[] }>;
  buildMindmapMermaid: (data: MindmapData) => string;
  buildMindmapOutline: (data: MindmapData) => string;
  tokenizeMindmapQuery: (query: string) => string[];
  matchesMindmapSearch: (haystack: string, query: string | string[]) => boolean;
};

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function loadMindmapHelpers(): MindmapHelpers {
  const source = fs.readFileSync(path.resolve(__dirname, '../content.js'), 'utf8');
  const start = source.indexOf('function parseJsonObject');
  const end = source.indexOf('function makeSafeId');

  if (start < 0 || end <= start) {
    throw new Error('Failed to locate mindmap helper block in content.js');
  }

  const snippet = source.slice(start, end);
  const factory = new Function(
    'extractTextCandidate',
    'slugifyForId',
    'document',
    `${snippet}
    return {
      parseJsonArray,
      normalizeMindmapData,
      countMindmapNodes,
      countMindmapBranches,
      scoreMindmapNodeForExpansion,
      pickMindmapExpansionTargets,
      buildMindmapExpansionPlan,
      buildMindmapEdgeOverview,
      getMindmapModesForNode,
      buildMindmapOverview,
      buildMindmapChecklist,
      groupMindmapNodesByGroup,
      buildMindmapMermaid,
      buildMindmapOutline,
      tokenizeMindmapQuery,
      matchesMindmapSearch
    };`
  ) as (
    extractTextCandidate: (value: unknown, depth?: number) => string,
    slugifyForId: (value?: string) => string,
    document: { title: string }
  ) => MindmapHelpers;

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
        const flat = Object.values(value as Record<string, unknown>).map(item => walk(item, depth + 1)).filter(Boolean);
        if (flat.length) return flat.join(' — ');
      }
      return '';
    };
    return walk;
  })();

  return factory(
    extractTextCandidate,
    (value = '') => String(value)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 64),
    { title: 'Document Fallback' }
  );
}

describe('content mindmap helpers', () => {
  const helpers = loadMindmapHelpers();

  it('unwraps nested arrays from dirty JSON payloads', () => {
    const parsed = helpers.parseJsonArray('```json\n{"data":{"items":["Basics",{"label":"Grammar"}]}}\n```');

    expect(parsed).toEqual(['Basics', { label: 'Grammar' }]);
  });

  it('normalizes wrapped mindmap objects and string children', () => {
    const data = helpers.normalizeMindmapData({
      title: 'Gateway',
      metadata: { complexity: 'medium' },
      mindmap: {
        metadata: { domain: 'ESL' },
        items: [
          {
            label: 'Grammar',
            description: { text: 'Rules and patterns' },
            children: [
              'Tenses',
              { title: 'Voice', insights: [{ prompt: 'Passive voice' }, 'Active voice'] }
            ]
          },
          'Vocabulary'
        ]
      }
    });

    expect(data?.title).toBe('Gateway');
    expect(data?.metadata.domain).toBe('ESL');
    expect(data?.metadata.complexity).toBe('medium');
    expect(data?.nodes.map(node => node.label)).toEqual(['Grammar', 'Vocabulary']);
    expect(data?.nodes[0].description).toBe('Rules and patterns');
    expect(data?.nodes[0].kind).toBe('cluster');
    expect(data?.nodes[0].group).toBe('Grammar');
    expect(data?.nodes[0].children.map(node => node.label)).toEqual(['Tenses', 'Voice']);
    expect(data?.nodes[0].children[1].insights).toEqual(['Passive voice', 'Active voice']);
    expect(helpers.countMindmapNodes(data?.nodes || [])).toBe(4);
    expect(helpers.countMindmapBranches(data?.nodes || [])).toBe(1);
  });

  it('falls back to document title when the model omits a title', () => {
    const data = helpers.normalizeMindmapData({
      items: ['Listening', 'Reading']
    });

    expect(data?.title).toBe('Document Fallback');
    expect(data?.nodes.map(node => node.label)).toEqual(['Listening', 'Reading']);
  });

  it('builds sanitized mermaid output', () => {
    const mermaid = helpers.buildMindmapMermaid({
      title: '[[entity:Acids]] "Workbook"',
      nodes: [
        {
          id: 'n1',
          label: '[[wiki:Tenses]] "Intro"',
          description: '',
          insights: [],
          children: []
        }
      ],
      metadata: {}
    });

    expect(mermaid).toContain('root((Acids Workbook))');
    expect(mermaid).toContain('Tenses Intro');
    expect(mermaid).not.toContain('[[');
    expect(mermaid).not.toContain('"');
  });

  it('builds outline output with descriptions and insights', () => {
    const outline = helpers.buildMindmapOutline({
      title: 'Gateway',
      nodes: [
        {
          id: 'n1',
          label: 'Grammar',
          description: 'Core sentence patterns',
          insights: ['Prioritize tense contrast'],
          children: [
            {
              id: 'n2',
              label: 'Tenses',
              description: '',
              insights: [],
              children: []
            }
          ]
        }
      ],
      metadata: {}
    });

    expect(outline).toContain('# Gateway');
    expect(outline).toContain('- Grammar');
    expect(outline).toContain('Core sentence patterns');
    expect(outline).toContain('• линия: Prioritize tense contrast');
    expect(outline).toContain('  - Tenses');
  });

  it('supports multi-term and quoted search tokens', () => {
    expect(helpers.tokenizeMindmapQuery('grammar "passive voice" tense')).toEqual([
      'grammar',
      'passive voice',
      'tense'
    ]);

    expect(helpers.matchesMindmapSearch(
      'grammar passive voice drill and tense contrast',
      'grammar "passive voice" tense'
    )).toBe(true);

    expect(helpers.matchesMindmapSearch(
      'grammar active voice drill and tense contrast',
      'grammar "passive voice" tense'
    )).toBe(false);
  });

  it('prefers sparse but informative branches for expansion', () => {
    const denseNode: MindmapNode = {
      id: 'dense',
      label: 'Dense',
      description: '',
      insights: [],
      children: Array.from({ length: 4 }, (_, i) => ({
        id: `dense_${i}`,
        label: `Child ${i}`,
        description: '',
        insights: [],
        children: []
      }))
    };
    const sparseNode: MindmapNode = {
      id: 'sparse',
      label: 'Grammar Strategy',
      description: 'Needs more examples and deeper branching.',
      insights: ['Contrast forms'],
      children: []
    };
    const mediumNode: MindmapNode = {
      id: 'medium',
      label: 'Vocabulary',
      description: 'Useful supporting branch.',
      insights: [],
      children: [{ id: 'm1', label: 'Phrases', description: '', insights: [], children: [] }]
    };

    expect(helpers.scoreMindmapNodeForExpansion(sparseNode)).toBeGreaterThan(
      helpers.scoreMindmapNodeForExpansion(denseNode)
    );

    expect(helpers.pickMindmapExpansionTargets([denseNode, mediumNode, sparseNode], 2).map(node => node.id)).toEqual([
      'sparse',
      'medium'
    ]);
  });

  it('respects depth filters when selecting expansion targets', () => {
    const nodes: MindmapNode[] = [
      {
        id: 'cluster',
        label: 'Cluster',
        kind: 'cluster',
        group: 'Стратегия',
        description: 'Top level',
        insights: [],
        evidence: [],
        questions: [],
        children: [
          {
            id: 'branch_1',
            label: 'Branch 1',
            kind: 'mechanism',
            group: 'Механика',
            description: 'Needs more detail',
            insights: ['detail'],
            evidence: [],
            questions: [],
            children: []
          },
          {
            id: 'branch_2',
            label: 'Branch 2',
            kind: 'risk',
            group: 'Риски',
            description: 'Second layer',
            insights: [],
            evidence: [],
            questions: ['verify'],
            children: []
          }
        ]
      }
    ];

    expect(helpers.pickMindmapExpansionTargets(nodes, 5, { minDepth: 0, maxDepth: 0 }).map(node => node.id)).toEqual(['cluster']);
    expect(helpers.pickMindmapExpansionTargets(nodes, 5, { minDepth: 1, maxDepth: 1 }).map(node => node.id)).toEqual([
      'branch_1',
      'branch_2'
    ]);
  });

  it('groups children by semantic group labels while preserving order', () => {
    const groups = helpers.groupMindmapNodesByGroup([
      {
        id: 'a',
        label: 'Mingw',
        description: '',
        kind: 'tool',
        group: 'Инструменты',
        insights: [],
        evidence: [],
        questions: [],
        children: []
      },
      {
        id: 'b',
        label: 'Nim',
        description: '',
        kind: 'tool',
        group: 'Инструменты',
        insights: [],
        evidence: [],
        questions: [],
        children: []
      },
      {
        id: 'c',
        label: 'Detection risk',
        description: '',
        kind: 'risk',
        group: 'Риски',
        insights: [],
        evidence: [],
        questions: [],
        children: []
      }
    ], 1, 'Ветка');

    expect(groups.map(group => group.label)).toEqual(['Инструменты', 'Риски']);
    expect(groups[0].items.map(item => item.id)).toEqual(['a', 'b']);
    expect(groups[1].items.map(item => item.id)).toEqual(['c']);
  });

  it('derives overview cards and checklist from signals, risks, questions and tools', () => {
    const data: MindmapData = {
      title: 'OffensiveNim',
      metadata: {},
      nodes: [
        {
          id: 'cluster_1',
          label: 'Compilation',
          description: 'Build and cross-compile Nim payloads',
          kind: 'cluster',
          group: 'Workflow',
          insights: ['Cross-compilation shortens delivery path'],
          evidence: ['Uses mingw-w64 for Windows builds'],
          questions: ['Verify which flags reduce footprint'],
          children: [
            {
              id: 'tool_1',
              label: 'mingw-w64',
              description: 'Cross-compiler toolchain',
              kind: 'tool',
              group: 'Инструменты',
              insights: [],
              evidence: [],
              questions: [],
              children: []
            },
            {
              id: 'risk_1',
              label: 'Detection surface',
              description: 'Compilation flags can alter AV signatures',
              kind: 'risk',
              group: 'Риски',
              insights: [],
              evidence: ['Artifact size changes per flag set'],
              questions: ['Test AV response across builds'],
              children: []
            }
          ]
        }
      ]
    };

    const overview = helpers.buildMindmapOverview(data, 4);
    const checklist = helpers.buildMindmapChecklist(data);

    expect(overview.focusClusters.map(item => item.label)).toEqual(['Compilation']);
    expect(overview.topSignals.some(item => item.text.includes('mingw-w64'))).toBe(true);
    expect(overview.topRisks.some(item => item.label.includes('Detection surface'))).toBe(true);
    expect(overview.topQuestions.some(item => item.text.includes('Verify which flags'))).toBe(true);
    expect(overview.topTools.some(item => item.label.includes('mingw-w64'))).toBe(true);
    expect(checklist).toContain('## Что проверить');
    expect(checklist).toContain('## Риски и ограничения');
    expect(checklist).toContain('## Инструменты / артефакты');
  });

  it('derives mode memberships from node kind and annotations', () => {
    expect(helpers.getMindmapModesForNode({
      id: 'r1',
      label: 'Risk node',
      description: '',
      kind: 'risk',
      insights: [],
      evidence: [],
      questions: ['Check it'],
      children: []
    })).toEqual(expect.arrayContaining(['all', 'risks', 'questions']));

    expect(helpers.getMindmapModesForNode({
      id: 't1',
      label: 'Tool node',
      description: '',
      kind: 'tool',
      insights: ['Useful'],
      evidence: [],
      questions: [],
      children: []
    })).toEqual(expect.arrayContaining(['all', 'tools', 'signals']));
  });

  it('builds a deeper expansion plan when the map is still shallow', () => {
    const data: MindmapData = {
      title: 'OmniRoute',
      metadata: {},
      nodes: [
        {
          id: 'cluster_1',
          label: 'Провайдеры',
          description: 'Точка интеграции разных LLM-провайдеров',
          kind: 'cluster',
          group: 'Платформа',
          insights: ['Есть маршрутизация'],
          evidence: [],
          questions: [],
          children: [
            {
              id: 'child_1',
              label: 'OpenAI',
              description: 'Один из провайдеров',
              kind: 'integration',
              group: 'Интеграции',
              insights: [],
              evidence: [],
              questions: [],
              children: []
            }
          ]
        },
        {
          id: 'cluster_2',
          label: 'Наблюдаемость',
          description: 'Метрики и алерты',
          kind: 'cluster',
          group: 'Операции',
          insights: [],
          evidence: ['Есть Grafana'],
          questions: ['Какие SLO?'],
          children: []
        }
      ]
    };

    const plan = helpers.buildMindmapExpansionPlan(data);

    expect(plan.length).toBeGreaterThanOrEqual(3);
    expect(plan[0].title).toContain('главные кластеры');
    expect(plan[1].title).toContain('механики');
    expect(plan.some(step => step.title.includes('глубокие ветки'))).toBe(true);
    expect(plan[0].pickTargets().map(node => node.id)).toContain('cluster_2');
  });

  it('extracts explicit edge links between branches', () => {
    const data: MindmapData = {
      title: 'OmniRoute',
      metadata: {},
      nodes: [
        {
          id: 'cluster_1',
          label: 'Провайдеры',
          description: 'Слой подключения моделей [[edge:Наблюдаемость]]',
          kind: 'cluster',
          group: 'Платформа',
          insights: ['Маршрутизация зависит от метрик [[edge:Наблюдаемость]]'],
          evidence: [],
          questions: [],
          children: []
        },
        {
          id: 'cluster_2',
          label: 'Наблюдаемость',
          description: 'Метрики и алерты',
          kind: 'cluster',
          group: 'Операции',
          insights: [],
          evidence: [],
          questions: [],
          children: []
        }
      ]
    };

    const edges = helpers.buildMindmapEdgeOverview(data, 5);

    expect(edges).toEqual(expect.arrayContaining([
      expect.objectContaining({
        label: 'Провайдеры → Наблюдаемость',
        targetId: 'cluster_2'
      })
    ]));
    expect(edges[0].text).not.toContain('[[edge:');
  });
});
