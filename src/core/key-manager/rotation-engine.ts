import type { KeyState, ProviderId } from '@shared/types';

interface CooldownEntry {
  key: string;
  until: number;
  reason: string;
}

interface QuotaInfo {
  limit: number;
  used: number;
  remaining: number;
  resetAt: number;
}

export class KeyRotationEngine {
  private keyPools: Map<ProviderId, KeyState[]> = new Map();
  private cooldowns: Map<string, CooldownEntry> = new Map();
  private quotaCache: Map<string, QuotaInfo> = new Map();
  private usageStats: Map<string, { count: number; latencySum: number }> = new Map();

  constructor() {
    // Cleanup interval
    setInterval(() => this.cleanup(), 60000);
  }

  // ===== Public API =====

  registerKeys(provider: ProviderId, keys: string[]): void {
    const existing = this.keyPools.get(provider) || [];
    for (const state of existing) {
      this.cooldowns.delete(state.key);
      this.quotaCache.delete(state.key);
      this.usageStats.delete(state.key);
    }

    const states: KeyState[] = keys.map(key => ({
      key,
      provider,
      usageToday: 0,
      remainingQuota: Infinity,
      lastUsed: 0,
      failureCount: 0,
      avgLatency: 500,
      status: 'healthy'
    }));

    this.keyPools.set(provider, states);
  }

  addKey(provider: ProviderId, key: string): void {
    const pool = this.keyPools.get(provider) || [];
    pool.push({
      key,
      provider,
      usageToday: 0,
      remainingQuota: Infinity,
      lastUsed: 0,
      failureCount: 0,
      avgLatency: 500,
      status: 'healthy'
    });
    this.keyPools.set(provider, pool);
  }

  getNextKey(provider: ProviderId, estimatedTokens: number = 1000): KeyState | null {
    const pool = this.keyPools.get(provider);
    if (!pool || pool.length === 0) return null;

    for (const state of pool) {
      state.status = this.getEffectiveStatus(state, estimatedTokens);
    }

    // Filter available keys
    const available = pool.filter(k => this.isKeyAvailable(k));
    if (available.length === 0) {
      // All keys cooling down - return one with shortest cooldown
      const sorted = [...pool].sort((a, b) => {
        const ca = this.cooldowns.get(a.key)?.until || 0;
        const cb = this.cooldowns.get(b.key)?.until || 0;
        return ca - cb;
      });
      const next = sorted[0] || null;
      if (next) next.status = this.getEffectiveStatus(next, estimatedTokens);
      return next;
    }

    // Weighted selection
    const weights = available.map(k => this.calculateKeyWeight(k, estimatedTokens));
    const next = this.weightedRandomSelect(available, weights);
    next.status = this.getEffectiveStatus(next, estimatedTokens);
    return next;
  }

  getAllAvailableKeys(provider: ProviderId): KeyState[] {
    const pool = this.keyPools.get(provider);
    if (!pool) return [];
    return pool.filter(k => this.isKeyAvailable(k));
  }

  // ===== Key State Management =====

  reportSuccess(key: string, latencyMs: number, tokensUsed: number): void {
    const state = this.findKeyState(key);
    if (!state) return;

    state.lastUsed = Date.now();
    state.usageToday += tokensUsed;
    state.failureCount = Math.max(0, state.failureCount - 1);
    
    // Update average latency
    const stats = this.usageStats.get(key) || { count: 0, latencySum: 0 };
    stats.count++;
    stats.latencySum += latencyMs;
    this.usageStats.set(key, stats);
    
    state.avgLatency = stats.latencySum / stats.count;
    
    // Update quota estimate
    state.remainingQuota = Math.max(0, state.remainingQuota - tokensUsed);
  }

  reportFailure(key: string, error: Error, statusCode?: number): void {
    const state = this.findKeyState(key);
    if (!state) return;

    state.failureCount++;
    state.lastUsed = Date.now();

    // Determine cooldown duration based on error
    let cooldownMs = 0;
    let reason = 'generic';

    if (statusCode === 429) {
      // Rate limited
      cooldownMs = this.extractRetryAfter(error.message) || 60000;
      reason = 'rate_limited';
    } else if (statusCode === 401 || statusCode === 403) {
      // Auth error - longer cooldown
      cooldownMs = 300000; // 5 minutes
      reason = 'auth_error';
    } else if (statusCode && statusCode >= 500) {
      // Server error
      cooldownMs = 10000;
      reason = 'server_error';
    } else if (state.failureCount > 5) {
      // Too many failures
      cooldownMs = 60000;
      reason = 'excessive_failures';
    }

    if (cooldownMs > 0) {
      this.cooldowns.set(key, {
        key,
        until: Date.now() + cooldownMs,
        reason
      });
    }

    state.status = this.determineStatus(state);
  }

  updateQuota(key: string, quota: QuotaInfo): void {
    this.quotaCache.set(key, quota);
    
    const state = this.findKeyState(key);
    if (state) {
      state.remainingQuota = quota.remaining;
      if (quota.remaining < 1000) {
        state.status = 'exhausted';
      }
    }
  }

  // ===== Private Helpers =====

  private isKeyAvailable(state: KeyState): boolean {
    const effectiveStatus = this.getEffectiveStatus(state);
    state.status = effectiveStatus;
    if (effectiveStatus === 'exhausted') return false;
    
    const cooldown = this.cooldowns.get(state.key);
    if (cooldown && cooldown.until > Date.now()) return false;
    
    if (state.remainingQuota <= 0) return false;
    
    return true;
  }

  private calculateKeyWeight(state: KeyState, estimatedTokens: number): number {
    let weight = 1;

    // Quota factor
    if (state.remainingQuota !== Infinity) {
      const quotaFactor = Math.max(0, state.remainingQuota - estimatedTokens) / 10000;
      weight *= Math.min(1, quotaFactor);
    }

    // Latency factor (prefer faster keys)
    const latencyFactor = 1000 / (state.avgLatency + 100);
    weight *= latencyFactor;

    // Health factor
    const healthFactor = 1 / (state.failureCount + 1);
    weight *= healthFactor;

    // Recency factor (prefer less recently used)
    const timeSinceUse = Date.now() - state.lastUsed;
    const recencyFactor = Math.min(2, 1 + timeSinceUse / 60000);
    weight *= recencyFactor;

    return weight;
  }

  private weightedRandomSelect<T>(items: T[], weights: number[]): T {
    const totalWeight = weights.reduce((a, b) => a + b, 0);
    let random = Math.random() * totalWeight;
    
    for (let i = 0; i < items.length; i++) {
      random -= weights[i];
      if (random <= 0) return items[i];
    }
    
    return items[items.length - 1];
  }

  private findKeyState(key: string): KeyState | null {
    for (const pool of this.keyPools.values()) {
      const found = pool.find(k => k.key === key);
      if (found) return found;
    }
    return null;
  }

  private determineStatus(state: KeyState): KeyState['status'] {
    if (state.remainingQuota <= 0) return 'exhausted';
    if (state.failureCount > 10) return 'exhausted';
    if (state.failureCount > 3) return 'degraded';
    return 'healthy';
  }

  private getEffectiveStatus(state: KeyState, estimatedTokens: number = 0): KeyState['status'] {
    if (state.remainingQuota <= 0) return 'exhausted';
    if (state.failureCount > 10) return 'exhausted';
    if (state.remainingQuota !== Infinity && state.remainingQuota < estimatedTokens) return 'exhausted';

    const cooldown = this.cooldowns.get(state.key);
    if (cooldown && cooldown.until > Date.now()) return 'cooldown';
    return this.determineStatus(state);
  }

  private extractRetryAfter(message: string): number | null {
    const match = message.match(/retry[_-]?after[:\s]*(\d+)/i);
    if (match) return parseInt(match[1]) * 1000;
    return null;
  }

  private cleanup(): void {
    const now = Date.now();
    
    // Remove expired cooldowns
    for (const [key, entry] of this.cooldowns) {
      if (entry.until <= now) {
        this.cooldowns.delete(key);
        const state = this.findKeyState(key);
        if (state) {
          state.status = this.determineStatus(state);
        }
      }
    }

    // Reset daily usage at midnight
    const hour = new Date().getHours();
    if (hour === 0) {
      for (const pool of this.keyPools.values()) {
        for (const state of pool) {
          state.usageToday = 0;
        }
      }
    }
  }

  // ===== Stats & Monitoring =====

  getStats(): Record<ProviderId, { total: number; available: number; exhausted: number }> {
    const stats: Record<string, { total: number; available: number; exhausted: number }> = {};
    
    for (const [provider, pool] of this.keyPools) {
      stats[provider] = {
        total: pool.length,
        available: pool.filter(k => this.isKeyAvailable(k)).length,
        exhausted: pool.filter(k => k.status === 'exhausted').length
      };
    }
    
    return stats;
  }
}

// Singleton instance
export const keyRotationEngine = new KeyRotationEngine();
