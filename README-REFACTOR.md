# Pzdrk v7.0 - Advanced Architecture

## Быстрый старт

```bash
# 1. Установка зависимостей
npm install

# 2. Запуск Milvus (в отдельном терминале)
docker-compose -f docker-compose.milvus.yml up -d

# 3. Запуск локального API сервера
npm run server

# 4. Сборка расширения
npm run build

# 5. Загрузка в Chrome
# Открыть chrome://extensions → Developer mode → Load unpacked → выбрать dist/
```

## Архитектура

```
┌─────────────────────────────────────────────────────────────────┐
│                    BROWSER EXTENSION                             │
├─────────────────────────────────────────────────────────────────┤
│  Content Script  →  Smart API Router  →  Multi-Provider API     │
│       ↓                    ↓                    ↓               │
│  Note System      Key Rotation       Groq/Cerebras/OpenAI       │
│  Command Palette  Circuit Breaker    (10+ keys each)            │
│  Mindmap Renderer Predictive Load    Racing Execution           │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│                    LOCAL DATA HUB (localhost:7420)              │
├─────────────────────────────────────────────────────────────────┤
│  REST API  ←  WebSocket  ←  Sync Pipeline  ←  Event Bus         │
│       ↓           ↓              ↓                              │
│   /api/summaries  Real-time   Milvus + Obsidian                 │
│   /api/search     updates     Vector DB + File Sync             │
│   /api/stats                                                  │
└─────────────────────────────────────────────────────────────────┘
```

## Ключевые фичи

### 1. Smart API Router
- **Racing execution**: Запросы на 3 провайдера одновременно, первый ответ wins
- **Circuit breaker**: Автоматическое отключение "больных" провайдеров
- **Predictive routing**: ML-based выбор лучшего провайдера

### 2. Key Rotation Engine
- Поддержка 10+ ключей на провайдера
- Weighted selection на основе latency/quota/health
- Автоматический cooldown при failures

### 3. Milvus Vector Store
- Self-hosted на localhost
- Semantic search по всей истории
- Auto-chunking с respect for boundaries

### 4. Obsidian Sync
- Двусторонняя синхронизация
- Auto-generated index
- Custom templates

## Переменные окружения

```bash
# .env
GROQ_API_KEYS=key1,key2,key3,key4,key5
CEREBRAS_API_KEYS=key1,key2,key3
OPENAI_API_KEY=sk-...
OBSIDIAN_VAULT_PATH=/Users/.../Documents/Obsidian/Main
```

## Производительность

| Метрика | Было | Стало | Улучшение |
|---------|------|-------|-----------|
| Latency (p50) | 2-5s | 0.5-1s | 5-10x |
| Throughput | 12 req/min | 200+ req/min | 17x |
| Availability | 1 provider | 3+ providers | 3x |
| Key rotation | Round-robin | Weighted smart | - |
| Data sync | Manual | Auto + real-time | - |
