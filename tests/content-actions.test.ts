import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { describe, expect, it } from 'vitest';


const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function loadAdaptiveParallelLimit() {
  const source = fs.readFileSync(path.resolve(__dirname, '../content.js'), 'utf8');
  const start = source.indexOf('function getAdaptiveParallelLimit');
  const end = source.indexOf('function getCacheKey');
  if (start < 0 || end <= start) throw new Error('Failed to load root action limit');

  const factory = new Function(
    'DEFAULT_MAX_PARALLEL_REQUESTS',
    `${source.slice(start, end)}
    return getAdaptiveParallelLimit;`
  ) as (defaultLimit: number) => (
    settings?: Record<string, unknown>, desired?: number, cap?: number, floor?: number
  ) => number;
  return factory(8);
}

describe('content action limits', () => {
  const getAdaptiveParallelLimit = loadAdaptiveParallelLimit();

  it('clamps adaptive parallelism to the safe cap', () => {
    expect(getAdaptiveParallelLimit({}, 8, 8)).toBe(8);
    expect(getAdaptiveParallelLimit({ maxParallelRequests: 20 }, 8, 8)).toBe(8);
    expect(getAdaptiveParallelLimit({ maxParallelRequests: 5 }, 8, 8)).toBe(5);
    expect(getAdaptiveParallelLimit({ maxParallelRequests: 0 }, 6, 4)).toBe(1);
  });
});

