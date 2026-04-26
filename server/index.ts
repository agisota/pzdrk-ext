import fastify from 'fastify';
import websocket from '@fastify/websocket';
import cors from '@fastify/cors';
import { MilvusVectorStore } from '../src/storage/milvus-client/index.js';
import { ObsidianSyncManager } from '../src/storage/obsidian-sync/sync-manager.js';
import type { SummaryData } from '../src/shared/types/index.js';

const app = fastify({ logger: true });

// State
type HubSocket = { readyState: number; send(data: string): void };

const connections = new Set<HubSocket>();
let milvus: MilvusVectorStore;
let obsidian: ObsidianSyncManager | null = null;

// ===== Setup =====

async function setup(): Promise<void> {
  // CORS
  await app.register(cors, {
    origin: true,
    credentials: true
  });

  // WebSocket
  await app.register(websocket);

  // Initialize stores
  milvus = new MilvusVectorStore();
  await milvus.connect();

  // Routes
  setupRoutes();
  setupWebSocket();

  // Start server
  await app.listen({ port: 7420, host: '0.0.0.0' });
  console.log('🚀 Pzdrk Data Hub running on http://localhost:7420');
}

// ===== HTTP Routes =====

function setupRoutes(): void {
  // Health check
  app.get('/health', async () => ({ status: 'ok', version: '7.0.0' }));

  // Get all summaries with pagination
  app.get('/api/summaries', async (request) => {
    const { page = '1', limit = '50' } = request.query as Record<string, string>;
    
    return {
      data: [],
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: 0
      }
    };
  });

  // Get single summary
  app.get('/api/summaries/:id', async (request) => {
    const { id } = request.params as { id: string };
    return { id };
  });

  // Create/Update summary
  app.post('/api/summaries', async (request) => {
    const summary = request.body as SummaryData;
    await syncSummary(summary);
    return { success: true, id: summary.id };
  });

  // Search semantic
  app.post('/api/search', async (request) => {
    const { query, topK = 5 } = request.body as { query: string; topK?: number };
    const embedding = await generateEmbedding(query);
    const results = await milvus.searchSimilar(query, embedding, {
      topK,
      minScore: 0.7
    });
    return { results };
  });

  // Get similar pages
  app.get('/api/similar', async (request) => {
    const { url } = request.query as { url: string };
    const results = await milvus.findSimilarPages(url, 5);
    return { results };
  });

  // Stats
  app.get('/api/stats', async () => {
    const stats = await milvus.getStats();
    return stats;
  });

  // Sync status
  app.get('/api/sync/status', async () => {
    return {
      milvus: milvus ? 'connected' : 'disconnected',
      obsidian: obsidian ? 'connected' : 'disconnected'
    };
  });
}

// ===== WebSocket =====

function setupWebSocket(): void {
  app.get('/ws', { websocket: true }, (connection) => {
    connections.add(connection.socket);

    connection.socket.on('message', (message: string) => {
      const data = JSON.parse(message);
      console.log('WS message:', data);
    });

    connection.socket.on('close', () => {
      connections.delete(connection.socket);
    });
  });
}

export function broadcast(event: string, data: unknown): void {
  const message = JSON.stringify({ event, data, timestamp: Date.now() });
  connections.forEach(socket => {
    if (socket.readyState === 1) {
      socket.send(message);
    }
  });
}

// ===== Helpers =====

async function syncSummary(summary: SummaryData): Promise<void> {
  const chunks = MilvusVectorStore.smartChunk(summary.rawContent || '', {
    chunkSize: 512,
    overlap: 128,
    respectBoundaries: true
  });

  const docChunks = chunks.map((content, i) => ({
    id: `${summary.id}-${i}`,
    url: summary.url,
    title: summary.title,
    content,
    embedding: [],
    metadata: {
      timestamp: summary.timestamp,
      domain: summary.domain,
      depth: summary.depth,
      tags: summary.tags,
      summary: summary.summary.core,
      sessionId: ''
    }
  }));

  await milvus.indexDocument(summary, docChunks);

  if (obsidian) {
    await obsidian.saveSummary(summary);
  }

  broadcast('summary:created', summary);
}

async function generateEmbedding(_text: string): Promise<number[]> {
  return new Array(1536).fill(0).map(() => Math.random() - 0.5);
}

// ===== Start =====

setup().catch(err => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
