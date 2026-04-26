import { describe, it, expect, beforeEach, vi } from 'vitest';
import { KeyRotationEngine } from '../src/core/key-manager/rotation-engine';
import type { ProviderId } from '../src/shared/types';

describe('KeyRotationEngine', () => {
  let engine: KeyRotationEngine;

  beforeEach(() => {
    engine = new KeyRotationEngine();
    vi.useFakeTimers();
  });

  describe('registerKeys', () => {
    it('should register multiple keys for a provider', () => {
      const keys = ['key1', 'key2', 'key3'];
      engine.registerKeys('groq', keys);
      
      const stats = engine.getStats();
      expect(stats.groq.total).toBe(3);
      expect(stats.groq.available).toBe(3);
    });

    it('should handle empty key list', () => {
      engine.registerKeys('groq', []);
      const stats = engine.getStats();
      expect(stats.groq.total).toBe(0);
    });
  });

  describe('getNextKey', () => {
    it('should return null when no keys registered', () => {
      const key = engine.getNextKey('groq');
      expect(key).toBeNull();
    });

    it('should return a key from registered pool', () => {
      engine.registerKeys('groq', ['key1', 'key2', 'key3']);
      const key = engine.getNextKey('groq');
      
      expect(key).not.toBeNull();
      expect(['key1', 'key2', 'key3']).toContain(key?.key);
    });

    it('should apply cooldown after failure', () => {
      engine.registerKeys('groq', ['key1']);
      
      // Report failure
      engine.reportFailure('key1', new Error('Rate limit'), 429);
      
      // Key should not be available immediately
      const key = engine.getNextKey('groq');
      expect(key?.status).toBe('cooldown');
    });

    it('should prefer keys with lower latency', () => {
      engine.registerKeys('groq', ['fast', 'slow']);
      
      // Simulate usage patterns
      engine.reportSuccess('fast', 200, 100);
      engine.reportSuccess('fast', 250, 100);
      engine.reportSuccess('slow', 800, 100);
      engine.reportSuccess('slow', 900, 100);
      
      // Fast key should be preferred
      const selections: Record<string, number> = { fast: 0, slow: 0 };
      for (let i = 0; i < 100; i++) {
        const key = engine.getNextKey('groq');
        if (key) selections[key.key]++;
      }
      
      expect(selections.fast).toBeGreaterThan(selections.slow);
    });

    it('should respect remaining quota', () => {
      engine.registerKeys('groq', ['nearly-exhausted']);
      
      // Set low remaining quota
      engine.updateQuota('nearly-exhausted', {
        limit: 10000,
        used: 9950,
        remaining: 50,
        resetAt: Date.now() + 3600000
      });
      
      // Should not be available for large requests
      const key = engine.getNextKey('groq', 1000);
      expect(key?.status).toBe('exhausted');
    });
  });

  describe('reportSuccess', () => {
    it('should update usage statistics', () => {
      engine.registerKeys('groq', ['key1']);
      engine.reportSuccess('key1', 500, 1000);
      
      const key = engine.getNextKey('groq');
      expect(key?.usageToday).toBe(1000);
      expect(key?.avgLatency).toBe(500);
    });

    it('should calculate rolling average latency', () => {
      engine.registerKeys('groq', ['key1']);
      
      engine.reportSuccess('key1', 400, 100);
      engine.reportSuccess('key1', 600, 100);
      engine.reportSuccess('key1', 500, 100);
      
      const key = engine.getNextKey('groq');
      expect(key?.avgLatency).toBe(500);
    });
  });

  describe('reportFailure', () => {
    it('should increment failure count', () => {
      engine.registerKeys('groq', ['key1']);
      
      engine.reportFailure('key1', new Error('Timeout'));
      engine.reportFailure('key1', new Error('Timeout'));
      
      const key = engine.getNextKey('groq');
      expect(key?.failureCount).toBe(2);
    });

    it('should set exhausted status after many failures', () => {
      engine.registerKeys('groq', ['key1']);
      
      for (let i = 0; i < 15; i++) {
        engine.reportFailure('key1', new Error('Error'));
      }
      
      const key = engine.getNextKey('groq');
      expect(key?.status).toBe('exhausted');
    });

    it('should apply longer cooldown for auth errors', () => {
      engine.registerKeys('groq', ['key1']);
      
      const error = new Error('Unauthorized') as Error & { statusCode?: number };
      error.statusCode = 401;
      engine.reportFailure('key1', error, 401);
      
      // Should still be in cooldown after 10 seconds
      vi.advanceTimersByTime(10000);
      const key = engine.getNextKey('groq');
      expect(key?.status).not.toBe('healthy');
    });
  });

  describe('getStats', () => {
    it('should return stats for all providers', () => {
      engine.registerKeys('groq', ['g1', 'g2']);
      engine.registerKeys('cerebras', ['c1']);
      
      const stats = engine.getStats();
      
      expect(stats.groq.total).toBe(2);
      expect(stats.cerebras.total).toBe(1);
    });

    it('should track exhausted keys', () => {
      engine.registerKeys('groq', ['key1', 'key2']);
      
      // Exhaust one key
      engine.updateQuota('key1', {
        limit: 1000,
        used: 1000,
        remaining: 0,
        resetAt: Date.now() + 3600000
      });
      
      const stats = engine.getStats();
      expect(stats.groq.exhausted).toBe(1);
      expect(stats.groq.available).toBe(1);
    });
  });

  describe('cleanup', () => {
    it('should remove expired cooldowns', () => {
      engine.registerKeys('groq', ['key1']);
      engine.reportFailure('key1', new Error('Rate limit'), 429);
      
      // Advance past cooldown
      vi.advanceTimersByTime(70000);
      
      const key = engine.getNextKey('groq');
      expect(key?.status).toBe('healthy');
    });
  });
});
