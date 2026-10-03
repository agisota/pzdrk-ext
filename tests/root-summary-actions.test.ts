import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';
import { describe, expect, it } from 'vitest';

const runtimeSource = readFileSync(new URL('../content.js', import.meta.url), 'utf8');

function startRoot() {
  const context = createContext({
    chrome: {
      runtime: { getURL: (path: string) => `chrome-extension://test/${path}`, onMessage: { addListener() {} } },
      storage: { sync: { get: async () => ({}) }, local: { get: async () => ({}) } }
    },
    document: { readyState: 'loading', title: 'Map summary test', addEventListener() {} },
    window: { location: { href: 'https://example.test/' }, addEventListener() {}, setTimeout() {} },
    console,
    setTimeout() {},
    clearTimeout() {}
  });
  context.ROX_PROMPT_DEFAULTS = { prompts: {}, actions: {} };
  runInContext(runtimeSource, context);
  return {
    context,
    evaluate: (expression: string) => runInContext(expression, context)
  };
}

describe('root long-page map-reduce summary content', () => {
  it('places a linked explanation beside its exact source point after ranking', () => {
    const root = startRoot();
    root.context.chunk = {
      bullets: ['A', 'BB', 'CCC', 'A longer source point'],
      commentary: [{ source_bullet: 'A longer source point', text: 'This explanation concerns the longer point.' }]
    };
    const summary = root.evaluate('buildMapReduceSummaryJson({title:"Source links",merged:mergeMapChunks([normalizeMapChunk(chunk)])})');
    const explained = summary.sections.filter((section: { right: { commentary?: string[] } }) => section.right.commentary?.length);
    expect(explained.map((section: { left: string[] }) => section.left)).toEqual([['A longer source point']]);
    expect(explained[0].right.commentary).toEqual(['This explanation concerns the longer point.']);
  });

  it('omits an explanation if its own source point was discarded even when another point from its chunk survives', () => {
    const root = startRoot();
    root.context.chunk = {
      bullets: [...Array.from({ length: 15 }, (_, i) => `Point ${i}`), 'A much longer discarded source point'],
      commentary: [{ source_bullet: 'A much longer discarded source point', text: 'Only the discarded point supports this.' }]
    };
    const summary = root.evaluate('buildMapReduceSummaryJson({title:"Source links",merged:mergeMapChunks([normalizeMapChunk(chunk)])})');
    expect(summary.sections.flatMap((section: { right: { commentary?: string[] } }) => section.right.commentary || [])).toEqual([]);
  });

  it('keeps a distinct follow-up rather than spending both slots on whitespace variants', () => {
    const root = startRoot();
    root.context.chunks = [
      { bullets: ['A'], concrete_prompts: [{ title: 'First', prompt: 'Inspect the export.\nReturn mismatches.' }] },
      { bullets: ['B'], concrete_prompts: [{ title: 'Duplicate', prompt: 'Inspect the export. Return mismatches.' }, { title: 'Different', prompt: 'Prepare the rollback checklist.' }] }
    ];
    const summary = root.evaluate('buildMapReduceSummaryJson({title:"Export",merged:mergeMapChunks(chunks.map(normalizeMapChunk))})');
    expect(summary.concrete_prompts.map((item: { prompt: string }) => item.prompt)).toEqual([
      'Inspect the export.\nReturn mismatches.', 'Prepare the rollback checklist.'
    ]);
  });

  it('does not attach an explanation when none of its source points survive the compact summary', () => {
    const root = startRoot();
    root.context.chunks = [
      { bullets: ['A detailed long source point about a different migration limitation.'], commentary: ['The migration limitation needs its own source point.'] },
      { bullets: Array.from({ length: 15 }, (_, i) => `Short point ${i}`), commentary: [{ source_bullet: 'Short point 0', text: 'These short points concern the export.' }] }
    ];
    const summary = root.evaluate('buildMapReduceSummaryJson({title:"Compact selection",merged:mergeMapChunks(chunks.map(normalizeMapChunk))})');
    expect(summary.sections.flatMap((section: { right: { commentary?: string[] } }) => section.right.commentary || [])).toEqual([
      'These short points concern the export.'
    ]);
  });

  it('rejects a chunk containing only follow-ups rather than claiming complete source coverage', async () => {
    const root = startRoot();
    root.evaluate('callGroqJsonWithRepair = async () => ({concrete_prompts:[{title:"Question",prompt:"What should be checked?"}]}); generateTILList = async () => [];');
    root.context.note = { isConnected: true, querySelector: () => ({ innerHTML: '' }) };
    await expect(root.evaluate('summarizeMapReduce({note,pageContent:"A supplied source fact.",headings:[],contextText:"",settings:{},ranking:{},cleanTitle:"Source"})')).rejects.toThrow('ни для одного фрагмента');
  });

  it('keeps truncation visible in exported Markdown even if all extracted chunks succeeded', () => {
    const root = startRoot();
    root.context.summary = {
      title: 'Partial page', sections: [{ key: 'tldr', left: ['A supported point'] }],
      coverage: { totalChunks: 1, processedRanges: [{ index: 1, start: 0, end: 20 }], failedRanges: [], truncated: true, partial: true }
    };
    expect(root.evaluate('summaryJsonToMarkdown(summary)')).toContain('остаток страницы');
  });

  it('keeps explanations alongside source points without duplicate sections on a brief extracted chunk', () => {
    const root = startRoot();
    root.context.chunk = {
      bullets: ['A timeout may occur after the server saves a task.'],
      commentary: ['Check the task state before deciding whether to retry.']
    };
    const summary = root.evaluate('buildMapReduceSummaryJson({title:"Timeout handling",merged:mergeMapChunks([normalizeMapChunk(chunk)])})');
    expect(summary.sections.flatMap((section: { left: string[] }) => section.left)).toEqual([
      'A timeout may occur after the server saves a task.'
    ]);
    expect(summary.sections.filter((section: { right: { commentary?: string[] } }) => section.right.commentary?.length).map((section: { left: string[] }) => section.left)).toEqual([
      ['A timeout may occur after the server saves a task.']
    ]);
  });
  it('keeps chunk explanations and full multiline follow-ups in the final summary', () => {
    const root = startRoot();
    root.context.first = {
      bullets: ['The migration preserves existing IDs.'],
      commentary: ['Preserving IDs avoids breaking references held by downstream records.'],
      concrete_prompts: [{
        title: 'Audit migration output',
        desc: 'Compare a concrete artifact before and after the migration.',
        prompt: 'Inspect the exported migration report.\nCompare every source ID with its destination ID.\nReturn a table of mismatches and the exact records to review.'
      }]
    };
    root.context.second = {
      bullets: ['The migration records rejected rows.'],
      commentary: ['Rejected-row records identify which inputs need correction before retry.'],
      concrete_prompts: [{
        title: 'Check rejected rows',
        desc: 'Use the rejection artifact to isolate repairable inputs.',
        prompt: 'Open the rejected-rows CSV.\nGroup failures by validation reason.\nProduce a corrected input file and a count by reason.'
      }]
    };

    const result = root.evaluate(`(() => {
      const normalized = [normalizeMapChunk(first), normalizeMapChunk(second)];
      return buildMapReduceSummaryJson({ title: 'Migration', ranking: {}, headings: [], merged: mergeMapChunks(normalized) });
    })()`);

    expect(result.sections.flatMap((section: { right: { commentary?: string[] } }) => section.right.commentary || [])).toEqual([
      'Preserving IDs avoids breaking references held by downstream records.',
      'Rejected-row records identify which inputs need correction before retry.'
    ]);
    expect(result.concrete_prompts).toHaveLength(2);
    expect(result.concrete_prompts.map((item: { prompt: string }) => item.prompt)).toEqual([
      'Inspect the exported migration report.\nCompare every source ID with its destination ID.\nReturn a table of mismatches and the exact records to review.',
      'Open the rejected-rows CSV.\nGroup failures by validation reason.\nProduce a corrected input file and a count by reason.'
    ]);
  });

  it('deduplicates explanations and follow-ups across chunks without truncating prompt bodies', () => {
    const root = startRoot();
    const repeatedCommentary = 'The export preserves source identifiers for reconciliation.';
    const longPrompt = `Review the complete export artifact.\n${'Compare source and destination identifiers row by row. '.repeat(30)}\nReturn every mismatch with the source row and destination row.`;
    root.context.longPrompt = longPrompt;
    root.context.chunks = [
      { bullets: ['A'], commentary: [repeatedCommentary], concrete_prompts: [{ title: 'Reconcile export', prompt: longPrompt }] },
      { bullets: ['B'], commentary: [repeatedCommentary.toUpperCase()], concrete_prompts: [{ title: 'Duplicate phrasing', prompt: longPrompt }] }
    ];
    const result = root.evaluate(`(() => {
      const merged = mergeMapChunks(chunks.map(normalizeMapChunk));
      return buildMapReduceSummaryJson({ title: 'Export', ranking: {}, headings: [], merged });
    })()`);

    expect(result.sections.flatMap((section: { right: { commentary?: string[] } }) => section.right.commentary || [])).toEqual([repeatedCommentary]);
    expect(result.concrete_prompts).toHaveLength(1);
    expect(result.concrete_prompts[0].prompt).toBe(root.context.longPrompt);
  });

  it('does not attach legacy multi-bullet commentary when its source points land in different sections', () => {
    const root = startRoot();
    root.context.chunk = {
      bullets: [
        'The API exposes a stable identifier.',
        'Retries reuse that identifier after timeout.',
        'A server-side deduplication window prevents duplicate records.',
        'Clients must reconcile the returned status with their local operation log before retrying.'
      ],
      commentary: ['Together these points define safe retry behavior across client and server boundaries.']
    };
    const result = root.evaluate(`(() => {
      const merged = mergeMapChunks([normalizeMapChunk(chunk)]);
      return buildMapReduceSummaryJson({ title: 'Retry behavior', ranking: {}, headings: [], merged });
    })()`);

    expect(result.sections.filter((section: { key: string }) => ['tldr', 'core'].includes(section.key)).map((section: { left: string[] }) => section.left)).toEqual([
      root.context.chunk.bullets.slice(0, 3),
      [root.context.chunk.bullets[3]]
    ]);


    expect(result.sections.flatMap((section: { right: { commentary?: string[] } }) => section.right.commentary || [])).toEqual([]);
  });

  it('keeps legacy chunks valid and ignores malformed optional values instead of stringifying them', () => {
    const root = startRoot();
    root.context.chunks = [
      { bullets: ['A legacy point'], actions: ['Review the source records'] },
      { bullets: ['A modern point'], commentary: [{ text: 'must not become [object Object]' }, 42], concrete_prompts: [{ title: {}, prompt: { body: 'not text' } }, ''], terms: [{ term: {}, definition: 'invalid' }], entities: [{ name: {}, why: 'invalid' }] }
    ];
    const result = root.evaluate(`(() => {
      const normalized = chunks.map(normalizeMapChunk);
      const merged = mergeMapChunks(normalized);
      return { normalized, summary: buildMapReduceSummaryJson({ title: 'Legacy', ranking: {}, headings: [], merged }) };
    })()`);

    expect(result.normalized[0].commentary).toEqual([]);
    expect(result.normalized[0].concrete_prompts).toEqual([]);
    expect(result.normalized[1].commentary).toEqual([]);
    expect(result.normalized[1].concrete_prompts).toEqual([]);
    expect(result.normalized[1].terms).toEqual([]);
    expect(result.normalized[1].entities).toEqual([]);
    expect(result.summary.sections.flatMap((section: { right: { commentary?: string[] } }) => section.right.commentary || [])).toEqual([]);
    expect(result.summary.concrete_prompts).toEqual([]);
    expect(JSON.stringify(result.summary)).not.toContain('[object Object]');
  });
});
