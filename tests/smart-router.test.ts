import { describe, it, expect, beforeEach, vi } from 'vitest';
import { SmartApiRouter } from '../src/core/api-router/smart-router';
import type { RequestProfile, ExecutionOptions } from '../src/shared/types';

describe('SmartApiRouter', () => {
  let router: SmartApiRouter;

  beforeEach(() => {
    router = new SmartApiRouter();
    vi.useFakeTimers();
  });

  describe('registerProvider', () => {
    it('should register a new provider', () => {
      router.registerProvider({
        id: 'groq',
        name: 'Groq',
        keys: ['test-key'],
        models: [],
        rateLimits: { requestsPerMinute: 30, tokensPerMinute: 6000 },
        priority: 1,
        healthStatus: 'healthy'
      });

      // Provider should be available for selection
      const request: RequestProfile = {
        id: 'test-1',
        prompt: 'Test',
        estimatedInputTokens: 100,
        estimatedOutputTokens: 100,
        requiresJson: false,
        requiresStreaming: false,
        complexity: 'simple',
        latencySlo: 5000,
        retryCount: 0
      };

      // Should not throw
      expect(() => router.execute(request, { strategy: 'single' })).not.toThrow();
    });
  });

  describe('execute strategies', () => {
    it('should support single strategy', async () => {
      // Mock the fetch for testing
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          choices: [{ message: { content: 'Test response' } }]
        })
      });

      router.registerProvider({
        id: 'groq',
        name: 'Groq',
        keys: ['test-key'],
        models: [{
          id: 'test-model',
          provider: 'groq',
          maxTokens: 1000,
          supportsJson: true,
          supportsStreaming: false,
          costPer1kInput: 0.001,
          costPer1kOutput: 0.002,
          avgLatencyMs: 500
        }],
        baseUrl: 'https://api.test.com',
        rateLimits: { requestsPerMinute: 30, tokensPerMinute: 6000 },
        priority: 1,
        healthStatus: 'healthy'
      });

      const request: RequestProfile = {
        id: 'test-1',
        prompt: 'Hello',
        systemPrompt: 'Be helpful',
        estimatedInputTokens: 10,
        estimatedOutputTokens: 50,
        requiresJson: false,
        requiresStreaming: false,
        complexity: 'simple',
        latencySlo: 5000,
        retryCount: 0
      };

      const result = await router.execute(request, { 
        strategy: 'single',
        timeoutMs: 10000,
        maxRetries: 0
      });

      expect(result).toHaveProperty('content');
      expect(result).toHaveProperty('provider');
      expect(result).toHaveProperty('latencyMs');
    });

    it('should calculate costs correctly', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          choices: [{ message: { content: 'Test' } }]
        })
      });

      router.registerProvider({
        id: 'groq',
        name: 'Groq',
        keys: ['test-key'],
        models: [{
          id: 'test-model',
          provider: 'groq',
          maxTokens: 1000,
          supportsJson: true,
          supportsStreaming: false,
          costPer1kInput: 0.01,
          costPer1kOutput: 0.02,
          avgLatencyMs: 500
        }],
        baseUrl: 'https://api.test.com',
        rateLimits: { requestsPerMinute: 30, tokensPerMinute: 6000 },
        priority: 1,
        healthStatus: 'healthy'
      });

      const request: RequestProfile = {
        id: 'test-cost',
        prompt: 'Test',
        estimatedInputTokens: 1000,
        estimatedOutputTokens: 500,
        requiresJson: false,
        requiresStreaming: false,
        complexity: 'simple',
        latencySlo: 5000,
        retryCount: 0
      };

      const result = await router.execute(request, {
        strategy: 'single',
        timeoutMs: 10000,
        maxRetries: 0
      });

      // Cost: (1000/1000 * 0.01) + (500/1000 * 0.02) = 0.01 + 0.01 = 0.02
      expect(result.cost).toBeCloseTo(0.02, 2);
    });
  });

  describe('executeBatch', () => {
    it('should process items in parallel', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          choices: [{ message: { content: 'Result' } }]
        })
      });

      router.registerProvider({
        id: 'groq',
        name: 'Groq',
        keys: ['key1', 'key2', 'key3'],
        models: [{
          id: 'test-model',
          provider: 'groq',
          maxTokens: 1000,
          supportsJson: false,
          supportsStreaming: false,
          costPer1kInput: 0.001,
          costPer1kOutput: 0.002,
          avgLatencyMs: 500
        }],
        baseUrl: 'https://api.test.com',
        rateLimits: { requestsPerMinute: 100, tokensPerMinute: 100000 },
        priority: 1,
        healthStatus: 'healthy'
      });

      const items = Array.from({ length: 10 }, (_, i) => ({
        id: `item-${i}`,
        prompt: `Test ${i}`,
        priority: 1
      }));

      const results = await router.executeBatch(items, {
        concurrency: 5,
        maxRetries: 0
      });

      expect(results).toHaveLength(10);
      expect(results.every(r => r.response || r.error)).toBe(true);
    });

    it('should handle failures with retry', async () => {
      let callCount = 0;
      global.fetch = vi.fn().mockImplementation(() => {
        callCount++;
        if (callCount <= 2) {
          return Promise.reject(new Error('Network error'));
        }
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            choices: [{ message: { content: 'Success' } }]
          })
        });
      });

      router.registerProvider({
        id: 'groq',
        name: 'Groq',
        keys: ['key1', 'key2'],
        models: [{
          id: 'test-model',
          provider: 'groq',
          maxTokens: 1000,
          supportsJson: false,
          supportsStreaming: false,
          costPer1kInput: 0.001,
          costPer1kOutput: 0.002,
          avgLatencyMs: 500
        }],
        baseUrl: 'https://api.test.com',
        rateLimits: { requestsPerMinute: 100, tokensPerMinute: 100000 },
        priority: 1,
        healthStatus: 'healthy'
      });

      const items = [{ id: 'item-1', prompt: 'Test', priority: 1 }];

      const results = await router.executeBatch(items, {
        concurrency: 1,
        maxRetries: 2
      });

      // Should succeed after retries
      expect(results[0].retries).toBeGreaterThan(0);
    });
  });

  describe('circuit breaker', () => {
    it('should open circuit after multiple failures', async () => {
      global.fetch = vi.fn().mockRejectedValue(new Error('Service unavailable'));

      router.registerProvider({
        id: 'groq',
        name: 'Groq',
        keys: ['key1'],
        models: [{
          id: 'test-model',
          provider: 'groq',
          maxTokens: 1000,
          supportsJson: false,
          supportsStreaming: false,
          costPer1kInput: 0.001,
          costPer1kOutput: 0.002,
          avgLatencyMs: 500
        }],
        baseUrl: 'https://api.test.com',
        rateLimits: { requestsPerMinute: 100, tokensPerMinute: 100000 },
        priority: 1,
        healthStatus: 'healthy'
      });

      const request: RequestProfile = {
        id: 'test',
        prompt: 'Test',
        estimatedInputTokens: 100,
        estimatedOutputTokens: 100,
        requiresJson: false,
        requiresStreaming: false,
        complexity: 'simple',
        latencySlo: 5000,
        retryCount: 0
      };

      // Multiple failures should open circuit
      for (let i = 0; i < 6; i++) {
        try {
          await router.execute(request, { strategy: 'single', timeoutMs: 1000, maxRetries: 0 });
        } catch (e) {
          // Expected
        }
      }

      // Circuit should be open now
      await expect(router.execute(request, { strategy: 'single', timeoutMs: 1000, maxRetries: 0 }))
        .rejects.toThrow('Circuit open');
    });
  });

  describe('caching', () => {
    it('should cache identical requests', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          choices: [{ message: { content: 'Cached response' } }]
        })
      });

      router.registerProvider({
        id: 'groq',
        name: 'Groq',
        keys: ['key1'],
        models: [{
          id: 'test-model',
          provider: 'groq',
          maxTokens: 1000,
          supportsJson: false,
          supportsStreaming: false,
          costPer1kInput: 0.001,
          costPer1kOutput: 0.002,
          avgLatencyMs: 500
        }],
        baseUrl: 'https://api.test.com',
        rateLimits: { requestsPerMinute: 100, tokensPerMinute: 100000 },
        priority: 1,
        healthStatus: 'healthy'
      });

      const request: RequestProfile = {
        id: 'test-cache',
        prompt: 'Same prompt',
        estimatedInputTokens: 100,
        estimatedOutputTokens: 100,
        requiresJson: false,
        requiresStreaming: false,
        complexity: 'simple',
        latencySlo: 5000,
        retryCount: 0
      };

      const result1 = await router.execute(request, { strategy: 'single', timeoutMs: 10000, maxRetries: 0 });
      const result2 = await router.execute(request, { strategy: 'single', timeoutMs: 10000, maxRetries: 0 });

      expect(result2.cached).toBe(true);
      expect(fetch).toHaveBeenCalledTimes(1); // Only one actual API call
    });
  });
});
