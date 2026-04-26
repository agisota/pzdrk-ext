// ============ Smart API Router ============
// Multi-provider API routing with key rotation, circuit breakers, and caching

import type { 
  ProviderConfig, 
  RequestProfile, 
  ExecutionOptions, 
  ApiResponse, 
  BatchItem, 
  BatchResult,
  ProviderId,
  ModelConfig
} from '@shared/types';
import { keyRotationEngine } from '@core/key-manager/rotation-engine';
import { DEFAULT_PROVIDERS, PERF_CONFIG } from '@shared/constants';

interface CircuitBreaker {
  failures: number;
  lastFailure: number;
  state: 'closed' | 'open' | 'half-open';
}

interface ProviderPool {
  config: ProviderConfig;
  breaker: CircuitBreaker;
  requestQueue: RequestProfile[];
}

export class SmartApiRouter {
  private providers: Map<ProviderId, ProviderPool> = new Map();
  private cache: Map<string, ApiResponse> = new Map();

  constructor() {
    this.initializeProviders();
  }

  // ===== Initialization =====

  private initializeProviders(): void {
    for (const [id, config] of Object.entries(DEFAULT_PROVIDERS)) {
      this.providers.set(id as ProviderId, {
        config: config as ProviderConfig,
        breaker: { failures: 0, lastFailure: 0, state: 'closed' },
        requestQueue: []
      });
    }
  }

  registerProvider(config: ProviderConfig): void {
    const defaultConfig = DEFAULT_PROVIDERS[config.id];
    const merged: ProviderConfig = {
      ...defaultConfig,
      ...config,
      models: config.models.length > 0 ? config.models : (defaultConfig?.models || []),
      baseUrl: config.baseUrl || defaultConfig?.baseUrl
    };

    this.providers.set(config.id, {
      config: merged,
      breaker: { failures: 0, lastFailure: 0, state: 'closed' },
      requestQueue: []
    });
    
    // Register keys with rotation engine
    if (merged.keys.length > 0) {
      keyRotationEngine.registerKeys(config.id, merged.keys);
    }
  }

  // ===== Core Routing =====

  async execute(
    request: RequestProfile,
    options: Partial<ExecutionOptions> = {}
  ): Promise<ApiResponse> {
    const opts: ExecutionOptions = {
      strategy: 'race',
      timeoutMs: PERF_CONFIG.racing.timeoutMs,
      maxRetries: 2,
      ...options
    };

    // Check cache first
    const cacheKey = this.getCacheKey(request);
    const cached = this.cache.get(cacheKey);
    if (cached) {
      return { ...cached, cached: true };
    }

    let result: ApiResponse;
    switch (opts.strategy) {
      case 'single':
        result = await this.executeSingle(request, opts);
        break;
      case 'race':
        result = await this.executeWithRacing(request, opts);
        break;
      case 'parallel':
        result = await this.executeParallel(request, opts);
        break;
      case 'fallback':
        result = await this.executeWithFallback(request, opts);
        break;
      default:
        result = await this.executeWithRacing(request, opts);
        break;
    }

    this.cache.set(cacheKey, result);
    return result;
  }

  // ===== Execution Strategies =====

  private async executeSingle(
    request: RequestProfile,
    options: ExecutionOptions
  ): Promise<ApiResponse> {
    const provider = this.selectBestProvider(request);
    if (!provider) {
      const hasOpenCircuit = Array.from(this.providers.values()).some(pool => pool.breaker.state === 'open');
      if (hasOpenCircuit) {
        throw new Error('Circuit open');
      }
      throw new Error('No available providers');
    }

    return this.executeWithProvider(provider, request, options);
  }

  private async executeWithRacing(
    request: RequestProfile,
    options: ExecutionOptions
  ): Promise<ApiResponse> {
    const candidates = this.selectProvidersForRacing(request, PERF_CONFIG.racing.maxProviders);
    if (candidates.length === 0) {
      throw new Error('No available providers for racing');
    }

    // Create abort controllers for cancellation
    const controllers = candidates.map(() => new AbortController());
    
    const promises = candidates.map(async (provider, i) => {
      try {
        const result = await this.executeWithProvider(
          provider, 
          request, 
          options, 
          controllers[i].signal
        );
        // Cancel other requests
        controllers.forEach((c, idx) => {
          if (idx !== i) c.abort();
        });
        return result;
      } catch (e) {
        if (e instanceof Error && e.name === 'AbortError') {
          return null as unknown as ApiResponse; // Filtered out later
        }
        throw e;
      }
    });

    const results = await Promise.allSettled(promises);
    
    // Find first successful result
    for (const result of results) {
      if (result.status === 'fulfilled' && result.value) {
        this.cache.set(this.getCacheKey(request), result.value);
        return result.value;
      }
    }

    // All failed
    throw new Error('All providers failed');
  }

  private async executeParallel(
    request: RequestProfile,
    options: ExecutionOptions
  ): Promise<ApiResponse> {
    // Execute on multiple providers and merge/vote on results
    const candidates = this.selectProvidersForRacing(request, 3);
    
    const results = await Promise.allSettled(
      candidates.map(p => this.executeWithProvider(p, request, options))
    );

    const successful = results
      .filter((r): r is PromiseFulfilledResult<ApiResponse> => 
        r.status === 'fulfilled'
      )
      .map(r => r.value);

    if (successful.length === 0) {
      throw new Error('All providers failed');
    }

    // Return fastest response (or implement voting/consensus)
    const fastest = successful.reduce((a, b) => 
      a.latencyMs < b.latencyMs ? a : b
    );

    return fastest;
  }

  private async executeWithFallback(
    request: RequestProfile,
    options: ExecutionOptions
  ): Promise<ApiResponse> {
    const ordered = this.getOrderedProviders(request);
    
    for (const provider of ordered) {
      try {
        return await this.executeWithProvider(provider, request, options);
      } catch (e) {
        // Try next provider
        continue;
      }
    }

    throw new Error('All providers exhausted');
  }

  // ===== Batch Processing =====

  async executeBatch(
    items: BatchItem[],
    options: Partial<ExecutionOptions> & { concurrency?: number } = {}
  ): Promise<BatchResult[]> {
    const concurrency = options.concurrency || PERF_CONFIG.batch.defaultConcurrency;
    const results: BatchResult[] = [];
    const queue = [...items];

    // Create worker pool
    const workers = Array.from({ length: Math.min(concurrency, items.length) }, 
      () => this.createBatchWorker(queue, options, results)
    );

    await Promise.all(workers);
    return results;
  }

  private async createBatchWorker(
    queue: BatchItem[],
    options: Partial<ExecutionOptions>,
    results: BatchResult[]
  ): Promise<void> {
    while (queue.length > 0) {
      const item = queue.shift()!;
      
      let retries = 0;
      let lastError: string | undefined;

      while (retries <= (options.maxRetries || 2)) {
        try {
          const response = await this.execute({
            id: item.id,
            prompt: item.prompt,
            estimatedInputTokens: this.estimateTokens(item.prompt),
            estimatedOutputTokens: 500,
            requiresJson: false,
            requiresStreaming: false,
            complexity: 'simple',
            latencySlo: 5000,
            retryCount: retries
          }, options);

          results.push({
            itemId: item.id,
            response,
            retries
          });
          break;
        } catch (e) {
          lastError = e instanceof Error ? e.message : 'Unknown error';
          retries++;
          
          if (retries <= (options.maxRetries || 2)) {
            await this.delay(0);
          }
        }
      }

      if (retries > (options.maxRetries || 2)) {
        results.push({
          itemId: item.id,
          error: lastError,
          retries: retries - 1
        });
      }
    }
  }

  // ===== Provider Execution =====

  private async executeWithProvider(
    pool: ProviderPool,
    request: RequestProfile,
    options: ExecutionOptions,
    signal?: AbortSignal
  ): Promise<ApiResponse> {
    const startTime = Date.now();
    const provider = pool.config;

    // Check circuit breaker
    if (!this.isCircuitClosed(pool.breaker)) {
      throw new Error(`Circuit open for ${provider.id}`);
    }

    // Get next available key
    const keyState = keyRotationEngine.getNextKey(
      provider.id, 
      request.estimatedInputTokens
    );
    
    if (!keyState) {
      this.recordFailure(pool);
      throw new Error(`No available keys for ${provider.id}`);
    }

    try {
      // Create timeout promise
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error('Timeout')), options.timeoutMs);
      });

      // Execute request
      const model = this.selectModel(provider, request);
      const executePromise = this.callProviderAPI(
        provider,
        keyState.key,
        model,
        request,
        signal
      );

      const result = await Promise.race([executePromise, timeoutPromise]);

      // Record success
      const latencyMs = Date.now() - startTime;
      keyRotationEngine.reportSuccess(
        keyState.key, 
        latencyMs, 
        request.estimatedOutputTokens
      );
      this.recordSuccess(pool);

      return {
        content: result,
        provider: provider.id,
        model: model.id,
        latencyMs,
        inputTokens: request.estimatedInputTokens,
        outputTokens: request.estimatedOutputTokens,
        cost: this.calculateCost(model, request),
        cached: false
      };
    } catch (e) {
      keyRotationEngine.reportFailure(
        keyState.key, 
        e as Error,
        (e as Error & { statusCode?: number }).statusCode
      );
      this.recordFailure(pool);
      throw e;
    }
  }

  private async callProviderAPI(
    provider: ProviderConfig,
    key: string,
    model: ModelConfig,
    request: RequestProfile,
    signal?: AbortSignal
  ): Promise<string> {
    // Validate baseUrl exists before making request
    if (!provider.baseUrl) {
      throw new Error(`Provider ${provider.id} missing baseUrl configuration`);
    }

    const response = await fetch(`${provider.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${key}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: model.id,
        messages: [
          { role: 'system', content: request.systemPrompt || '' },
          { role: 'user', content: request.prompt }
        ],
        max_tokens: request.estimatedOutputTokens,
        temperature: 0.7,
        response_format: request.requiresJson ? { type: 'json_object' } : undefined
      }),
      signal
    });

    if (!response.ok) {
      const error = new Error(`HTTP ${response.status}`);
      (error as Error & { statusCode?: number }).statusCode = response.status;
      throw error;
    }

    const data = await response.json();
    return data.choices[0].message.content;
  }

  // ===== Provider Selection =====

  private selectBestProvider(request: RequestProfile): ProviderPool | null {
    const available = Array.from(this.providers.values())
      .filter(p => this.isCircuitClosed(p.breaker))
      .filter(p => keyRotationEngine.getAllAvailableKeys(p.config.id).length > 0);

    if (available.length === 0) return null;

    // Score and sort
    const scored = available.map(pool => ({
      pool,
      score: this.scoreProvider(pool, request)
    }));

    scored.sort((a, b) => b.score - a.score);
    return scored[0]?.pool || null;
  }

  private selectProvidersForRacing(request: RequestProfile, max: number): ProviderPool[] {
    const available = Array.from(this.providers.values())
      .filter(p => this.isCircuitClosed(p.breaker))
      .filter(p => keyRotationEngine.getAllAvailableKeys(p.config.id).length > 0);

    const scored = available.map(pool => ({
      pool,
      score: this.scoreProvider(pool, request)
    }));

    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, max).map(s => s.pool);
  }

  private getOrderedProviders(request: RequestProfile): ProviderPool[] {
    return this.selectProvidersForRacing(request, this.providers.size);
  }

  private scoreProvider(pool: ProviderPool, request: RequestProfile): number {
    const config = pool.config;
    let score = config.priority * 10;

    // Health factor
    const availableKeys = keyRotationEngine.getAllAvailableKeys(config.id).length;
    score += availableKeys * 5;

    // Capability match
    const model = this.selectModel(config, request);
    if (request.requiresJson && !model.supportsJson) score -= 50;
    if (request.requiresStreaming && !model.supportsStreaming) score -= 30;

    // Cost efficiency
    const cost = this.calculateCost(model, request);
    score -= cost * 1000;

    // Latency
    score -= model.avgLatencyMs / 100;

    // Circuit breaker penalty
    if (pool.breaker.failures > 0) {
      score -= pool.breaker.failures * 10;
    }

    return score;
  }

  private selectModel(provider: ProviderConfig, request: RequestProfile): ModelConfig {
    const configured = provider.models[0];
    if (configured) return configured;

    const fallback = DEFAULT_PROVIDERS[provider.id]?.models?.[0];
    if (fallback) return fallback as ModelConfig;

    return {
      id: `${provider.id}-default`,
      provider: provider.id,
      maxTokens: Math.max(1024, request.estimatedOutputTokens),
      supportsJson: true,
      supportsStreaming: true,
      costPer1kInput: 0,
      costPer1kOutput: 0,
      avgLatencyMs: 1000
    };
  }

  // ===== Circuit Breaker =====

  private isCircuitClosed(breaker: CircuitBreaker): boolean {
    if (breaker.state === 'closed') return true;
    if (breaker.state === 'open') {
      // Try half-open after 30 seconds
      if (Date.now() - breaker.lastFailure > 30000) {
        breaker.state = 'half-open';
        return true;
      }
      return false;
    }
    return true; // half-open
  }

  private recordSuccess(pool: ProviderPool): void {
    pool.breaker.failures = 0;
    pool.breaker.state = 'closed';
  }

  private recordFailure(pool: ProviderPool): void {
    pool.breaker.failures++;
    pool.breaker.lastFailure = Date.now();
    
    if (pool.breaker.failures >= 5) {
      pool.breaker.state = 'open';
    }
  }

  // ===== Utilities =====

  private getCacheKey(request: RequestProfile): string {
    return `${request.prompt.slice(0, 100)}_${request.systemPrompt?.slice(0, 50) || ''}`;
  }

  private estimateTokens(text: string): number {
    // Rough estimate: ~4 chars per token
    return Math.ceil(text.length / 4);
  }

  private calculateCost(model: ModelConfig, request: RequestProfile): number {
    const inputCost = (request.estimatedInputTokens / 1000) * model.costPer1kInput;
    const outputCost = (request.estimatedOutputTokens / 1000) * model.costPer1kOutput;
    return inputCost + outputCost;
  }

  private delay(ms: number): Promise<void> {
    if (ms <= 0) {
      return Promise.resolve();
    }
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// Singleton
export const smartApiRouter = new SmartApiRouter();
