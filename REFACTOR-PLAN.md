# PZDRK v7.0 — COMPREHENSIVE REFACTOR PLAN

## Executive Summary

На основе глубокого анализа текущей кодовой базы (5,006 строк content.js, монолитная архитектура) предлагается комплексная реорганизация системы для достижения **20-200x ускорения** и централизации данных.

---

## 🎯 Целевые метрики

| Метрика | Текущее | Цель | Как |
|---------|---------|------|-----|
| **Latency (summary)** | 2-8 сек | 0.3-1 сек | Racing execution, caching |
| **Throughput** | 12 req/min | 200+ req/min | Parallel processing, 10+ keys |
| **Availability** | Single provider | 99.9% | 3+ providers, circuit breakers |
| **Data persistence** | Manual download | Auto sync everywhere | Milvus + Obsidian pipeline |
| **Search** | None | Semantic | Vector embeddings |

---

## 🏗️ Архитектура

### Current (Anti-pattern)
```
content.js (5,006 lines)
├── UI rendering
├── API calls
├── Business logic
├── State management
└── Caching
```

### Target (Modular)
```
src/
├── core/
│   ├── api-router/          # Racing, circuit breakers
│   ├── key-manager/         # 10+ keys per provider
│   ├── cache-layer/         # Multi-tier
│   └── vector-store/        # Milvus client
├── content/
│   ├── ui/                  # Notes, palette, mindmap
│   ├── extraction/          # Page scraping
│   └── handlers/            # Message handlers
├── background/
│   ├── service-worker/
│   └── api-proxies/
├── storage/
│   ├── obsidian-sync/
│   ├── milvus-client/
│   └── local-indexeddb/
└── shared/
    ├── types/               # TypeScript
    ├── constants/
    └── utils/

server/                      # Local data hub
├── index.ts                 # Fastify + WS
├── routes/
└── sync/

docker-compose.milvus.yml    # Vector DB
```

---

## ⚡ PHASE 1: Ultra-Performance API Layer

### 1.1 Smart API Router

**Racing Execution** — запускаем запрос на 3 провайдера одновременно:

```typescript
// Было: await callGroq(prompt) — 2-5 сек
// Стало: Promise.race([groq, cerebras, openai]) — 0.5-1 сек

async executeWithRacing(request): Promise<ApiResponse> {
  const candidates = [groq, cerebras, openai];
  const controllers = candidates.map(() => new AbortController());
  
  const promises = candidates.map(async (provider, i) => {
    const result = await this.call(provider, request, controllers[i].signal);
    // Отменяем остальные
    controllers.forEach((c, idx) => idx !== i && c.abort());
    return result;
  });

  return Promise.race(promises);
}
```

**Circuit Breaker** — отключаем "больных" провайдеров:
```typescript
if (failureCount >= 5) {
  breaker.state = 'open';
  setTimeout(() => breaker.state = 'half-open', 30000);
}
```

### 1.2 Key Rotation Engine

**Weighted Selection** — выбираем лучший ключ на основе:
- `remainingQuota` — сколько осталось
- `avgLatency` — историческая скорость
- `failureCount` — недавние ошибки
- `timeSinceUse` — равномерное распределение

```typescript
private calculateKeyWeight(state: KeyState): number {
  const quotaFactor = state.remainingQuota / 10000;
  const latencyFactor = 1000 / (state.avgLatency + 100);
  const healthFactor = 1 / (state.failureCount + 1);
  const recencyFactor = 1 + timeSinceUse / 60000;
  
  return quotaFactor * latencyFactor * healthFactor * recencyFactor;
}
```

**Поддерживаемые провайдеры:**
- Groq (primary) — 10+ ключей
- Cerebras (fallback) — 5+ ключей  
- OpenAI (backup) — 3+ ключей
- Anthropic (optional)
- Google (optional)
- DeepSeek (optional)

---

## 🧠 PHASE 2: Vector Database (Milvus)

### 2.1 Self-Hosted Setup

```yaml
# docker-compose.milvus.yml
services:
  milvus-standalone:
    image: milvusdb/milvus:v2.3.3
    ports:
      - "19530:19530"    # gRPC API
  
  attu:                    # GUI
    image: zilliz/attu:v2.3.5
    ports:
      - "8000:3000"
```

### 2.2 Document Indexing

```typescript
// Auto-chunking с respect for boundaries
const chunks = MilvusVectorStore.smartChunk(content, {
  chunkSize: 512,
  overlap: 128,
  respectBoundaries: true  // Не режем предложения
});

// Generate embeddings (OpenAI text-embedding-3-small)
const embeddings = await Promise.all(
  chunks.map(c => embed(c))
);

// Store in Milvus
await milvus.indexDocument({
  id: `${url}-${i}`,
  vector: embeddings[i],
  metadata: { url, title, timestamp, tags }
});
```

### 2.3 Semantic Search

```typescript
// Найти похожие страницы
const results = await milvus.searchSimilar(query, embedding, {
  topK: 5,
  minScore: 0.7,
  filter: { 
    domains: ['github.com', 'docs.python.org'],
    dateFrom: new Date('2024-01-01')
  }
});
```

---

## 📝 PHASE 3: Obsidian Integration

### 3.1 Two-Way Sync

```typescript
class ObsidianSyncManager {
  // Save from browser → Obsidian
  async saveSummary(summary: SummaryData): Promise<void> {
    const content = this.renderTemplate(summary);
    await this.atomicWrite(filepath, content);
  }

  // Watch for changes in Obsidian
  startWatcher() {
    chokidar.watch(vaultPath).on('change', (file) => {
      const summary = this.parseNote(file);
      this.emitChange(summary);  // Sync back to extension
    });
  }
}
```

### 3.2 Note Template

```markdown
---
created: 2026-02-12T10:30:00Z
url: https://...
domain: github.com
depth: 4
tags: [#llm, #architecture]
tokens: 2450
---

# {{title}}

> **URL**: [{{url}}]({{url}})
> **Domain**: {{domain}} | **Depth**: {{depth}}/5

## Суть
{{core}}

## Ключевые тезисы
{{keyPoints}}

## TIL
{{til}}

## Действия
{{actions}}

## Сущности
{{entities}}

---
*Generated by pzdrk* [[pzdrk-index]]
```

---

## 🌐 PHASE 4: Local Data Hub

### 4.1 REST API (localhost:7420)

```typescript
// GET /api/summaries?page=1&limit=50&domain=github.com
// GET /api/search (semantic)
// POST /api/summaries (create/update)
// GET /api/stats
// WS /ws (real-time updates)
```

### 4.2 Sync Pipeline

```
Browser Extension
       ↓
   Summary Created
       ↓
  ┌────┴────┐
  ↓         ↓
Milvus   Obsidian
(Vector)  (Files)
  ↓         ↓
  └────┬────┘
       ↓
  WebSocket Broadcast
       ↓
  Dashboard UI
```

---

## 🚀 PHASE 5: Performance Optimizations

### 5.1 Streaming & Incremental Rendering

```typescript
async renderStreaming(stream: ReadableStream, element: HTMLElement) {
  const reader = stream.getReader();
  const parser = new StreamingJsonParser();
  
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    
    const partial = parser.parseIncremental(value);
    this.updateDOM(element, partial);
    await this.frameThrottle();
  }
}
```

### 5.2 Predictive Prefetching

```typescript
class PredictivePrefetchEngine {
  async predictNextPages(currentUrl: string): Promise<Prediction[]> {
    // ML-based prediction на основе:
    // - Истории переходов
    // - Ссылок на странице
    // - Времени дня
    return this.userModel.predictNextUrls(features, 5);
  }

  async startPrefetching() {
    const predictions = await this.predictNextPages(location.href);
    
    for (const pred of predictions) {
      scheduler.postTask(async () => {
        const summary = await this.generateSummary(pred.url);
        this.cache.set(pred.url, summary);
      }, { priority: 'background' });
    }
  }
}
```

---

## 📦 Installation & Setup

### Prerequisites
```bash
# macOS
brew install docker docker-compose node

# Start Docker Desktop
open -a Docker
```

### Quick Start
```bash
# 1. Clone and setup
cd /Users/marklindgreen/Gronxie\ Dropbox/MARK\ HAGGERTY/_DEV/_cli/ext
npm install

# 2. Start Milvus
docker-compose -f docker-compose.milvus.yml up -d

# 3. Configure keys
cat > .env << EOF
GROQ_API_KEYS=gsk_key1,gsk_key2,gsk_key3,gsk_key4,gsk_key5
CEREBRAS_API_KEYS=csk_key1,csk_key2,csk_key3
OPENAI_API_KEY=sk-...
OBSIDIAN_VAULT_PATH=/Users/.../Documents/Obsidian/Main
EOF

# 4. Start data hub
npm run server

# 5. Build extension
npm run build

# 6. Load in Chrome
# chrome://extensions → Developer mode → Load unpacked → dist/
```

---

## 📊 Monitoring & Debugging

### Key Metrics
```typescript
// GET /api/metrics
{
  "providers": {
    "groq": { "availableKeys": 8, "avgLatency": 450, "requestsPerMinute": 45 },
    "cerebras": { "availableKeys": 3, "avgLatency": 720, "requestsPerMinute": 12 }
  },
  "cache": { "hitRate": 0.34, "size": "145MB" },
  "milvus": { "totalDocuments": 1250, "indexSize": "2.3GB" }
}
```

### Attu GUI
Открыть http://localhost:8000 для просмотра:
- Коллекций
- Векторов
- Query performance

---

## 🗓️ Roadmap

| Phase | Duration | Key Deliverables |
|-------|----------|------------------|
| 1 | Week 1-2 | TypeScript + Vite, Smart Router |
| 2 | Week 3-4 | Milvus integration, Key Rotation |
| 3 | Week 5-6 | Obsidian sync, Local API |
| 4 | Week 7-8 | Streaming, Prefetching |
| 5 | Week 9-10 | Dashboard, CLI tools |
| 6 | Week 11-12 | Testing, docs, release |

---

## 🔐 Security Considerations

1. **API Keys** — хранятся в `chrome.storage.sync`, никогда не логируются
2. **Local Milvus** — только localhost, нет external access
3. **Obsidian Vault** — file system access через разрешения пользователя
4. **Data retention** — пользователь контролирует все данные локально

---

## 💡 Future Enhancements

- **Local LLM** — интеграция с Ollama/LM Studio для offline mode
- **Graph RAG** — knowledge graph на базе страниц
- **Collaborative** — sync между устройствами через облако
- **Mobile app** — companion app для iOS/Android

---

*Generated for pzdrk v7.0 Advanced Architecture*
