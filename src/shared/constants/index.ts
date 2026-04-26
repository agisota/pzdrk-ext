// ============ Provider Defaults ============

import type { ProviderConfig } from '@shared/types';

export const DEFAULT_PROVIDERS: Record<string, ProviderConfig> = {
  groq: {
    id: 'groq',
    name: 'Groq',
    keys: [], // User-provided
    models: [
      {
        id: 'groq/compound',
        provider: 'groq',
        maxTokens: 8192,
        supportsJson: true,
        supportsStreaming: true,
        costPer1kInput: 0.00015,
        costPer1kOutput: 0.0006,
        avgLatencyMs: 650
      },
      {
        id: 'llama-3.1-8b-instant',
        provider: 'groq',
        maxTokens: 131072,
        supportsJson: true,
        supportsStreaming: true,
        costPer1kInput: 0.00005,
        costPer1kOutput: 0.00008,
        avgLatencyMs: 250
      }
    ],
    baseUrl: 'https://api.groq.com/openai/v1',
    rateLimits: {
      requestsPerMinute: 30,
      tokensPerMinute: 6000
    },
    priority: 1,
    healthStatus: 'healthy'
  },
  cerebras: {
    id: 'cerebras',
    name: 'Cerebras',
    keys: [],
    models: [
      {
        id: 'gpt-oss-120b',
        provider: 'cerebras',
        maxTokens: 8192,
        supportsJson: true,
        supportsStreaming: true,
        costPer1kInput: 0.0002,
        costPer1kOutput: 0.0004,
        avgLatencyMs: 800
      },
      {
        id: 'llama-3.3-70b',
        provider: 'cerebras',
        maxTokens: 8192,
        supportsJson: true,
        supportsStreaming: true,
        costPer1kInput: 0.00015,
        costPer1kOutput: 0.0003,
        avgLatencyMs: 600
      }
    ],
    baseUrl: 'https://api.cerebras.ai/v1',
    rateLimits: {
      requestsPerMinute: 20,
      tokensPerMinute: 4000
    },
    priority: 2,
    healthStatus: 'healthy'
  },
  openai: {
    id: 'openai',
    name: 'OpenAI',
    keys: [],
    models: [
      {
        id: 'gpt-4o-mini',
        provider: 'openai',
        maxTokens: 16384,
        supportsJson: true,
        supportsStreaming: true,
        costPer1kInput: 0.00015,
        costPer1kOutput: 0.0006,
        avgLatencyMs: 700
      }
    ],
    baseUrl: 'https://api.openai.com/v1',
    rateLimits: {
      requestsPerMinute: 60,
      tokensPerMinute: 20000
    },
    priority: 3,
    healthStatus: 'healthy'
  }
};

// ============ Cache Configuration ============

export const CACHE_CONFIG = {
  prefix: 'pzdrk_v7_',
  ttl: {
    summary: 7 * 24 * 60 * 60 * 1000, // 7 days
    embedding: 30 * 24 * 60 * 60 * 1000, // 30 days
    api: 5 * 60 * 1000, // 5 minutes
    prefetch: 10 * 60 * 1000 // 10 minutes
  },
  maxSize: {
    memory: 100 * 1024 * 1024, // 100MB
    indexedDB: 500 * 1024 * 1024 // 500MB
  }
};

// ============ Vector Store Configuration ============

export const MILVUS_CONFIG = {
  host: 'localhost',
  port: 19530,
  collection: 'pzdrk_documents',
  vectorDimension: 1536, // OpenAI text-embedding-3-small
  indexType: 'IVF_FLAT',
  metricType: 'COSINE',
  shardNum: 2
};

// ============ Sync Configuration ============

export const SYNC_CONFIG = {
  batchSize: 50,
  intervalMs: 5000,
  retryAttempts: 3,
  retryDelayMs: 1000
};

// ============ Performance Constants ============

export const PERF_CONFIG = {
  // Racing strategy
  racing: {
    timeoutMs: 5000,
    maxProviders: 3
  },
  // Batch processing
  batch: {
    defaultConcurrency: 12,
    maxConcurrency: 200,
    chunkSize: 100
  },
  // Streaming
  stream: {
    bufferSize: 1024,
    flushIntervalMs: 50
  },
  // Prefetch
  prefetch: {
    maxPredictions: 5,
    confidenceThreshold: 0.7,
    delayMs: 320
  }
};

// ============ Prompt Templates ============

export const SYSTEM_PROMPTS = {
  mondayPersona: `Ты — саркастичный AI-комментатор в стиле Monday (умный сухой сарказм).
Тон: спокойный, профессиональный, лаконичный.
Сарказм: точечно (0–1 короткая фраза на ответ), без театра.
Запрещено: "*вздох*", нытьё, истерика, лишние эмоции.
Доказательно: отделяй факты от предположений, отмечай уровень уверенности.
Язык: простой русский.`,

  styleRules: `ФОРМАТ:
- Структурно, без воды (лучше глубже, чем короче)
- Оборачивай сущности и термины: [[entity:Название]], [[term:термин]], [[wiki:статья]], [[evidence:факт]], [[action:шаг]]
- Практика и проверяемые утверждения важнее красивостей
- Если чего-то не знаешь — так и скажи, предложи как проверить`,

  jsonValidator: 'Верни ТОЛЬКО валидный JSON без markdown и комментариев.'
};

// ============ UI Constants ============

export const UI_CONFIG = {
  note: {
    defaultWidth: 520,
    minWidth: 320,
    maxHeight: '80vh',
    gapX: 18,
    gapY: 16
  },
  animations: {
    duration: 200,
    easing: 'cubic-bezier(0.4, 0, 0.2, 1)'
  }
};
