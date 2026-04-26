// ============ Core Types ============

export type ProviderId = 'groq' | 'cerebras' | 'openai' | 'anthropic' | 'google' | 'deepseek';

export interface ModelConfig {
  id: string;
  provider: ProviderId;
  maxTokens: number;
  supportsJson: boolean;
  supportsStreaming: boolean;
  costPer1kInput: number;
  costPer1kOutput: number;
  avgLatencyMs: number;
}

export interface ProviderConfig {
  id: ProviderId;
  name: string;
  keys: string[];
  models: ModelConfig[];
  baseUrl?: string;
  rateLimits: {
    requestsPerMinute: number;
    tokensPerMinute: number;
  };
  priority: number;
  healthStatus: 'healthy' | 'degraded' | 'down';
}

export interface KeyState {
  key: string;
  provider: ProviderId;
  usageToday: number;
  remainingQuota: number;
  lastUsed: number;
  failureCount: number;
  avgLatency: number;
  status: 'healthy' | 'degraded' | 'cooldown' | 'exhausted';
  cooldownUntil?: number;
}

// ============ Request Types ============

export interface RequestProfile {
  id: string;
  prompt: string;
  systemPrompt?: string;
  estimatedInputTokens: number;
  estimatedOutputTokens: number;
  requiresJson: boolean;
  requiresStreaming: boolean;
  complexity: 'simple' | 'medium' | 'complex';
  latencySlo: number;
  retryCount: number;
}

export interface ExecutionOptions {
  strategy: 'single' | 'race' | 'parallel' | 'fallback';
  timeoutMs: number;
  maxRetries: number;
  preferredProviders?: ProviderId[];
}

export interface ApiResponse {
  content: string;
  provider: ProviderId;
  model: string;
  latencyMs: number;
  inputTokens: number;
  outputTokens: number;
  cost: number;
  cached: boolean;
}

export interface BatchItem {
  id: string;
  prompt: string;
  priority: number;
}

export interface BatchResult {
  itemId: string;
  response?: ApiResponse;
  error?: string;
  retries: number;
}

// ============ Vector Store Types ============

export interface DocumentChunk {
  id: string;
  url: string;
  title: string;
  content: string;
  embedding: number[];
  metadata: {
    timestamp: number;
    domain: string;
    depth: number;
    tags: string[];
    summary: string;
    sessionId: string;
  };
}

export interface SearchOptions {
  topK: number;
  minScore: number;
  filter?: {
    domains?: string[];
    tags?: string[];
    dateFrom?: Date;
    dateTo?: Date;
  };
}

export interface RelevantChunk extends DocumentChunk {
  score: number;
}

// ============ Sync Types ============

export interface SummaryData {
  id: string;
  url: string;
  title: string;
  timestamp: number;
  domain: string;
  depth: number;
  tags: string[];
  tokenCount: number;
  summary: {
    core: string;
    keyPoints: string[];
    til: string[];
    actions: string[];
    entities: string[];
    terms: Array<{term: string; definition: string}>;
  };
  rawContent?: string;
  fullEmbedding?: number[];
}

export interface SyncConfig {
  obsidian: {
    enabled: boolean;
    vaultPath: string;
    noteFolder: string;
    template: string;
    twoWaySync: boolean;
  };
  milvus: {
    enabled: boolean;
    host: string;
    port: number;
    collection: string;
  };
  local: {
    enabled: boolean;
    dbPath: string;
  };
}

// ============ Event Types ============

export type PzdrkEvent = 
  | { type: 'summary:created'; data: SummaryData }
  | { type: 'summary:updated'; data: SummaryData }
  | { type: 'page:indexed'; data: { url: string; chunks: number } }
  | { type: 'sync:started'; data: { destination: string } }
  | { type: 'sync:completed'; data: { destination: string; count: number } }
  | { type: 'api:error'; data: { provider: ProviderId; error: string } }
  | { type: 'key:exhausted'; data: { provider: ProviderId; key: string } };

export type EventHandler<T extends PzdrkEvent['type']> = 
  (event: Extract<PzdrkEvent, { type: T }>) => void;
