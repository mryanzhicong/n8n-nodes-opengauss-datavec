import { VectorStore } from '@langchain/core/vectorstores';
import { Document } from '@langchain/core/documents';
import type { EmbeddingsInterface } from '@langchain/core/embeddings';
import { DataVecClient, type DataVecConfig, type DistanceStrategy } from './datavecClient';

export interface OpenGaussVectorStoreConfig {
  connectionConfig: DataVecConfig;
  tableName: string;
  distanceStrategy?: DistanceStrategy;
  dimensions?: number;
}

export class OpenGaussVectorStore extends VectorStore {
  declare FilterType: Record<string, unknown>;

  private client: DataVecClient;
  private tableName: string;
  private distanceStrategy: DistanceStrategy;
  private dimensions?: number;
  private tableCreated = false;

  constructor(embeddings: EmbeddingsInterface, config: OpenGaussVectorStoreConfig) {
    super(embeddings, {});
    this.client = new DataVecClient(config.connectionConfig);
    this.tableName = config.tableName;
    this.distanceStrategy = config.distanceStrategy ?? 'cosine';
    this.dimensions = config.dimensions;
  }

  _vectorstoreType(): string {
    return 'opengauss_datavec';
  }

  async addVectors(vectors: number[][], documents: Document[]): Promise<void> {
    await this.addVectorsWithCount(vectors, documents);
  }

  async addDocuments(documents: Document[]): Promise<void> {
    await this.addDocumentsWithCount(documents);
  }

  /**
   * Like addVectors but returns the actual number of inserted rows.
   */
  async addVectorsWithCount(vectors: number[][], documents: Document[]): Promise<number> {
    await this.ensureTable(vectors[0]?.length);

    const docs = documents.map((doc, i) => ({
      content: doc.pageContent,
      embedding: vectors[i],
      metadata: doc.metadata as Record<string, unknown> | undefined,
    }));

    return await this.client.insertDocuments({
      tableName: this.tableName,
      documents: docs,
    });
  }

  /**
   * Like addDocuments but returns the actual number of inserted rows.
   */
  async addDocumentsWithCount(documents: Document[]): Promise<number> {
    const texts = documents.map((doc) => doc.pageContent);
    const vectors = await this.embeddings.embedDocuments(texts);
    return await this.addVectorsWithCount(vectors, documents);
  }

  async similaritySearchVectorWithScore(
    query: number[],
    k: number,
    filter?: Record<string, unknown>,
  ): Promise<[Document, number][]> {
    const results = await this.client.similaritySearch({
      tableName: this.tableName,
      queryVector: query,
      limit: k,
      distanceStrategy: this.distanceStrategy,
      filter,
    });

    return results.map((result) => [
      new Document({
        pageContent: result.content,
        metadata: result.metadata ?? {},
      }),
      result.distance,
    ]);
  }

  private async ensureTable(vectorLength?: number): Promise<void> {
    if (this.tableCreated) return;
    const dims = this.dimensions ?? vectorLength;
    if (!dims) {
      throw new Error('Vector dimensions unknown. Set the "dimensions" parameter or ensure the embedding model returns vectors.');
    }

    await this.client.createTable({
      tableName: this.tableName,
      dimensions: dims,
      ifNotExists: true,
    });
    this.tableCreated = true;
  }

  async close(): Promise<void> {
    await this.client.close();
  }

  static async fromConfig(
    embeddings: EmbeddingsInterface,
    config: OpenGaussVectorStoreConfig,
  ): Promise<OpenGaussVectorStore> {
    const store = new OpenGaussVectorStore(embeddings, config);
    return store;
  }
}
