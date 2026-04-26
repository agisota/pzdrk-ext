import { describe, it, expect, beforeEach, vi } from 'vitest';
import { MilvusVectorStore } from '../src/storage/milvus-client';

// Mock the Milvus SDK
vi.mock('@zilliz/milvus2-sdk-node', () => ({
  MilvusClient: vi.fn().mockImplementation(() => ({
    checkHealth: vi.fn().mockResolvedValue({}),
    hasCollection: vi.fn().mockResolvedValue({ value: false }),
    createCollection: vi.fn().mockResolvedValue({}),
    createIndex: vi.fn().mockResolvedValue({}),
    loadCollection: vi.fn().mockResolvedValue({}),
    insert: vi.fn().mockResolvedValue({}),
    flush: vi.fn().mockResolvedValue({}),
    search: vi.fn().mockResolvedValue({ results: [] }),
    query: vi.fn().mockResolvedValue({ data: [] }),
    delete: vi.fn().mockResolvedValue({})
  })),
  DataType: {
    VarChar: 'VarChar',
    FloatVector: 'FloatVector',
    Int64: 'Int64',
    JSON: 'JSON'
  }
}));

describe('MilvusVectorStore', () => {
  let store: MilvusVectorStore;

  beforeEach(() => {
    store = new MilvusVectorStore();
  });

  describe('connect', () => {
    it('should connect successfully', async () => {
      const result = await store.connect();
      expect(result).toBe(true);
    });

    it('should handle connection failure', async () => {
      const { MilvusClient } = await import('@zilliz/milvus2-sdk-node');
      vi.mocked(MilvusClient).mockImplementationOnce(() => {
        throw new Error('Connection failed');
      });

      const result = await store.connect();
      expect(result).toBe(false);
    });
  });

  describe('smartChunk', () => {
    it('should return single chunk for short text', () => {
      const text = 'Short text';
      const chunks = MilvusVectorStore.smartChunk(text, {
        chunkSize: 100,
        overlap: 20,
        respectBoundaries: true
      });

      expect(chunks).toHaveLength(1);
      expect(chunks[0]).toBe(text);
    });

    it('should split long text into multiple chunks', () => {
      const text = 'A'.repeat(1000);
      const chunks = MilvusVectorStore.smartChunk(text, {
        chunkSize: 300,
        overlap: 50,
        respectBoundaries: true
      });

      expect(chunks.length).toBeGreaterThan(1);
    });

    it('should respect sentence boundaries when configured', () => {
      const text = 'First sentence. Second sentence. Third sentence. Fourth sentence.';
      const chunks = MilvusVectorStore.smartChunk(text, {
        chunkSize: 50,
        overlap: 10,
        respectBoundaries: true
      });

      // Each chunk should end at sentence boundary
      chunks.forEach(chunk => {
        expect(chunk.endsWith('.') || chunk.endsWith(' ')).toBe(true);
      });
    });

    it('should apply overlap between chunks', () => {
      const text = 'Word '.repeat(100);
      const chunks = MilvusVectorStore.smartChunk(text, {
        chunkSize: 200,
        overlap: 50,
        respectBoundaries: false
      });

      // Check that consecutive chunks have overlap
      if (chunks.length > 1) {
        const firstChunkEnd = chunks[0].slice(-20);
        const secondChunkStart = chunks[1].slice(0, 20);
        expect(firstChunkEnd).toContain(secondChunkStart.trim());
      }
    });

    it('should filter out very short chunks', () => {
      const text = 'A'.repeat(1000);
      const chunks = MilvusVectorStore.smartChunk(text, {
        chunkSize: 500,
        overlap: 450,
        respectBoundaries: false
      });

      // All chunks should be meaningful size
      chunks.forEach(chunk => {
        expect(chunk.length).toBeGreaterThan(50);
      });
    });
  });

  describe('indexDocument', () => {
    it('should insert chunks into Milvus', async () => {
      await store.connect();

      const summary = {
        id: 'test-123',
        url: 'https://example.com',
        title: 'Test Page',
        timestamp: Date.now(),
        domain: 'example.com',
        depth: 3,
        tags: ['test'],
        tokenCount: 1000,
        summary: {
          core: 'Test summary',
          keyPoints: [],
          til: [],
          actions: [],
          entities: [],
          terms: []
        }
      };

      const chunks = [
        {
          id: 'test-123-0',
          url: 'https://example.com',
          title: 'Test Page',
          content: 'Chunk 1 content',
          embedding: new Array(1536).fill(0.1),
          metadata: {
            timestamp: Date.now(),
            domain: 'example.com',
            depth: 3,
            tags: ['test'],
            summary: 'Test',
            sessionId: ''
          }
        }
      ];

      // Should not throw
      await expect(store.indexDocument(summary, chunks)).resolves.not.toThrow();
    });

    it('should handle empty chunks gracefully', async () => {
      await store.connect();

      const summary = {
        id: 'test-empty',
        url: 'https://example.com',
        title: 'Empty',
        timestamp: Date.now(),
        domain: 'example.com',
        depth: 3,
        tags: [],
        tokenCount: 0,
        summary: {
          core: '',
          keyPoints: [],
          til: [],
          actions: [],
          entities: [],
          terms: []
        }
      };

      await expect(store.indexDocument(summary, [])).resolves.not.toThrow();
    });
  });

  describe('searchSimilar', () => {
    it('should return relevant chunks', async () => {
      const { MilvusClient } = await import('@zilliz/milvus2-sdk-node');
      
      vi.mocked(MilvusClient).mockImplementationOnce(() => ({
        checkHealth: vi.fn().mockResolvedValue({}),
        hasCollection: vi.fn().mockResolvedValue({ value: true }),
        search: vi.fn().mockResolvedValue({
          results: [
            {
              id: 'chunk-1',
              url: 'https://example.com/page1',
              title: 'Page 1',
              content: 'Relevant content',
              domain: 'example.com',
              timestamp: Date.now(),
              tags: 'tag1,tag2',
              metadata: JSON.stringify({ summary: 'Summary' }),
              score: 0.95
            }
          ]
        })
      } as unknown as any));

      const store = new MilvusVectorStore();
      await store.connect();

      const results = await store.searchSimilar(
        'test query',
        new Array(1536).fill(0.1),
        { topK: 5, minScore: 0.7 }
      );

      expect(results).toHaveLength(1);
      expect(results[0].score).toBe(0.95);
      expect(results[0].url).toBe('https://example.com/page1');
    });

    it('should apply filters correctly', async () => {
      const { MilvusClient } = await import('@zilliz/milvus2-sdk-node');
      const searchMock = vi.fn().mockResolvedValue({ results: [] });
      
      vi.mocked(MilvusClient).mockImplementationOnce(() => ({
        checkHealth: vi.fn().mockResolvedValue({}),
        hasCollection: vi.fn().mockResolvedValue({ value: true }),
        search: searchMock
      } as unknown as any));

      const store = new MilvusVectorStore();
      await store.connect();

      await store.searchSimilar(
        'query',
        new Array(1536).fill(0.1),
        {
          topK: 5,
          minScore: 0.7,
          filter: {
            domains: ['example.com'],
            dateFrom: new Date('2024-01-01'),
            dateTo: new Date('2024-12-31')
          }
        }
      );

      const searchCall = searchMock.mock.calls[0][0];
      expect(searchCall.filter).toContain('domain');
      expect(searchCall.filter).toContain('timestamp');
    });
  });

  describe('findSimilarPages', () => {
    it('should return similar pages', async () => {
      const { MilvusClient } = await import('@zilliz/milvus2-sdk-node');
      
      vi.mocked(MilvusClient).mockImplementationOnce(() => ({
        checkHealth: vi.fn().mockResolvedValue({}),
        hasCollection: vi.fn().mockResolvedValue({ value: true }),
        query: vi.fn().mockResolvedValue({
          data: [{ vector: new Array(1536).fill(0.1) }]
        }),
        search: vi.fn().mockResolvedValue({
          results: [
            { id: 'similar-1', score: 0.9 },
            { id: 'similar-2', score: 0.85 }
          ]
        })
      } as unknown as any));

      const store = new MilvusVectorStore();
      await store.connect();

      const results = await store.findSimilarPages('https://example.com/page', 5);

      expect(results).toHaveLength(2);
    });

    it('should return empty array if page not found', async () => {
      const { MilvusClient } = await import('@zilliz/milvus2-sdk-node');
      
      vi.mocked(MilvusClient).mockImplementationOnce(() => ({
        checkHealth: vi.fn().mockResolvedValue({}),
        hasCollection: vi.fn().mockResolvedValue({ value: true }),
        query: vi.fn().mockResolvedValue({ data: [] })
      } as unknown as any));

      const store = new MilvusVectorStore();
      await store.connect();

      const results = await store.findSimilarPages('https://unknown.com', 5);

      expect(results).toHaveLength(0);
    });
  });
});
