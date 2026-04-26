import { MilvusClient, DataType, FieldType } from '@zilliz/milvus2-sdk-node';
import type { DocumentChunk, SearchOptions, RelevantChunk, SummaryData } from '@shared/types';
import { MILVUS_CONFIG } from '@shared/constants';

export class MilvusVectorStore {
  private client: MilvusClient | null = null;
  private collectionName: string;
  private connected: boolean = false;

  constructor(config?: Partial<typeof MILVUS_CONFIG>) {
    this.collectionName = config?.collection || MILVUS_CONFIG.collection;
  }

  // ===== Connection =====

  async connect(): Promise<boolean> {
    try {
      this.client = new MilvusClient({
        address: `${MILVUS_CONFIG.host}:${MILVUS_CONFIG.port}`,
      });

      // Test connection
      await this.client.checkHealth();
      this.connected = true;

      // Ensure collection exists
      await this.ensureCollection();

      return true;
    } catch (e) {
      console.error('Milvus connection failed:', e);
      this.connected = false;
      return false;
    }
  }

  async disconnect(): Promise<void> {
    this.connected = false;
    this.client = null;
  }

  // ===== Collection Management =====

  private async ensureCollection(): Promise<void> {
    if (!this.client) return;

    const exists = await this.client.hasCollection({
      collection_name: this.collectionName
    });

    if (!exists.value) {
      await this.createCollection();
    }
  }

  private async createCollection(): Promise<void> {
    if (!this.client) return;

    const fields: FieldType[] = [
      {
        name: 'id',
        data_type: DataType.VarChar,
        is_primary_key: true,
        max_length: 128
      },
      {
        name: 'vector',
        data_type: DataType.FloatVector,
        dim: MILVUS_CONFIG.vectorDimension
      },
      {
        name: 'url',
        data_type: DataType.VarChar,
        max_length: 2048
      },
      {
        name: 'title',
        data_type: DataType.VarChar,
        max_length: 512
      },
      {
        name: 'content',
        data_type: DataType.VarChar,
        max_length: 65535
      },
      {
        name: 'domain',
        data_type: DataType.VarChar,
        max_length: 256
      },
      {
        name: 'timestamp',
        data_type: DataType.Int64
      },
      {
        name: 'tags',
        data_type: DataType.VarChar,
        max_length: 1024
      },
      {
        name: 'metadata',
        data_type: DataType.JSON
      }
    ];

    await this.client.createCollection({
      collection_name: this.collectionName,
      fields,
      shards_num: MILVUS_CONFIG.shardNum
    });

    // Create index
    await this.client.createIndex({
      collection_name: this.collectionName,
      field_name: 'vector',
      index_type: MILVUS_CONFIG.indexType,
      metric_type: MILVUS_CONFIG.metricType,
      params: { nlist: 128 }
    });

    // Load collection
    await this.client.loadCollection({
      collection_name: this.collectionName
    });
  }

  // ===== Document Operations =====

  async indexDocument(_summary: SummaryData, chunks: DocumentChunk[]): Promise<void> {
    if (!this.client || !this.connected) {
      throw new Error('Milvus not connected');
    }

    if (chunks.length === 0) return;

    // Prepare data
    const data = chunks.map(chunk => ({
      id: chunk.id,
      vector: chunk.embedding,
      url: chunk.url,
      title: chunk.title,
      content: chunk.content.slice(0, 65535), // Max length
      domain: chunk.metadata.domain,
      timestamp: chunk.metadata.timestamp,
      tags: chunk.metadata.tags.join(','),
      metadata: JSON.stringify(chunk.metadata)
    }));

    // Insert in batches
    const batchSize = 100;
    for (let i = 0; i < data.length; i += batchSize) {
      const batch = data.slice(i, i + batchSize);
      await this.client.insert({
        collection_name: this.collectionName,
        data: batch
      });
    }

    // Flush to ensure persistence
    await this.client.flush({
      collection_names: [this.collectionName]
    });
  }

  async searchSimilar(
    _query: string,
    queryEmbedding: number[],
    options: SearchOptions
  ): Promise<RelevantChunk[]> {
    if (!this.client || !this.connected) {
      throw new Error('Milvus not connected');
    }

    // Build filter expression
    const filters: string[] = [];
    if (options.filter?.domains?.length) {
      filters.push(`domain in [${options.filter.domains.map(d => `"${d}"`).join(',')}]`);
    }
    if (options.filter?.dateFrom) {
      filters.push(`timestamp >= ${options.filter.dateFrom.getTime()}`);
    }
    if (options.filter?.dateTo) {
      filters.push(`timestamp <= ${options.filter.dateTo.getTime()}`);
    }

    const expr = filters.length > 0 ? filters.join(' && ') : undefined;

    const results = await this.client.search({
      collection_name: this.collectionName,
      data: queryEmbedding,
      filter: expr,
      limit: options.topK,
      output_fields: ['url', 'title', 'content', 'domain', 'timestamp', 'tags', 'metadata'],
      metric_type: MILVUS_CONFIG.metricType
    });

    return results.results.map(hit => ({
      id: hit.id as string,
      url: hit.url as string,
      title: hit.title as string,
      content: hit.content as string,
      embedding: [], // Not returned to save bandwidth
      metadata: {
        ...JSON.parse((hit.metadata as string) || '{}'),
        timestamp: hit.timestamp as number,
        domain: hit.domain as string,
        tags: (hit.tags as string)?.split(',') || []
      },
      score: hit.score as number
    }));
  }

  async findSimilarPages(url: string, topK: number = 5): Promise<RelevantChunk[]> {
    if (!this.client || !this.connected) return [];

    // Get embedding for this URL
    const results = await this.client.query({
      collection_name: this.collectionName,
      filter: `url == "${url}"`,
      output_fields: ['vector'],
      limit: 1
    });

    if (results.data.length === 0) return [];

    const vector = (results.data[0] as { vector: number[] }).vector;

    // Search excluding self
    return this.searchSimilar('', vector, {
      topK,
      minScore: 0.7,
      filter: {
        // Exclude exact URL
      }
    });
  }

  async getStats(): Promise<{ total: number; domains: string[]; dateRange: { min: Date; max: Date } }> {
    if (!this.client || !this.connected) {
      return { total: 0, domains: [], dateRange: { min: new Date(), max: new Date() } };
    }

    const stats = await this.client.query({
      collection_name: this.collectionName,
      expr: 'id != ""',
      output_fields: ['count(*)'],
      limit: 1
    });

    const total = parseInt((stats.data[0] as Record<string, unknown>)['count(*)'] as string) || 0;

    // Get unique domains (approximate via aggregation)
    const domains: string[] = [];

    return { total, domains, dateRange: { min: new Date(), max: new Date() } };
  }

  async deleteByUrl(url: string): Promise<void> {
    if (!this.client || !this.connected) return;

    await this.client.delete({
      collection_name: this.collectionName,
      filter: `url == "${url}"`
    });
  }

  // ===== Chunking Utilities =====

  static smartChunk(
    content: string, 
    options: { chunkSize: number; overlap: number; respectBoundaries: boolean }
  ): string[] {
    const { chunkSize, overlap, respectBoundaries } = options;
    const chunks: string[] = [];
    
    if (content.length <= chunkSize) {
      return [content];
    }

    let start = 0;
    while (start < content.length) {
      let end = start + chunkSize;

      if (respectBoundaries && end < content.length) {
        // Try to find sentence or paragraph boundary
        const searchStart = end - overlap;
        const searchEnd = Math.min(end + overlap, content.length);
        const searchText = content.slice(searchStart, searchEnd);

        // Look for sentence end
        const sentenceEnd = searchText.search(/[.!?]\s/);
        if (sentenceEnd !== -1) {
          end = searchStart + sentenceEnd + 2;
        } else {
          // Look for paragraph break
          const paraEnd = searchText.search(/\n\n/);
          if (paraEnd !== -1) {
            end = searchStart + paraEnd + 2;
          } else {
            // Look for word boundary
            const spaceIdx = searchText.lastIndexOf(' ');
            if (spaceIdx !== -1 && spaceIdx > overlap / 2) {
              end = searchStart + spaceIdx;
            }
          }
        }
      }

      chunks.push(content.slice(start, end).trim());
      start = end - overlap;
    }

    return chunks.filter(c => c.length > 50);
  }
}

// Singleton
export const milvusStore = new MilvusVectorStore();
