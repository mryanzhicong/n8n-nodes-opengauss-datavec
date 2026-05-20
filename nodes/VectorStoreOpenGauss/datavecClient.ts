import { Pool, PoolConfig, Client } from 'pg';

// ============================================================
// Type Definitions
// ============================================================

export interface DataVecConfig {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
  ssl?: boolean | object;
  maxConnections?: number;
}

export type DistanceStrategy = 'l2' | 'cosine' | 'inner_product' | 'manhattan';
export type IndexType = 'hnsw' | 'ivfflat' | 'diskann';

export interface VectorSearchOptions {
  tableName: string;
  queryVector: number[];
  limit: number;
  distanceStrategy: DistanceStrategy;
  filter?: Record<string, unknown>;
  efSearch?: number;
  probes?: number;
}

export interface InsertDocumentOptions {
  tableName: string;
  documents: Array<{
    content: string;
    embedding: number[];
    metadata?: Record<string, unknown>;
  }>;
}

export interface CreateTableOptions {
  tableName: string;
  dimensions: number;
  ifNotExists?: boolean;
}

export interface CreateIndexOptions {
  tableName: string;
  indexType: IndexType;
  distanceStrategy: DistanceStrategy;
  indexName?: string;
  m?: number;
  efConstruction?: number;
  lists?: number;
}

export interface SearchResult {
  id: number;
  content: string;
  metadata: Record<string, unknown> | null;
  distance: number;
}

// ============================================================
// Constants & Mappings
// ============================================================

const DISTANCE_OPERATOR_MAP: Record<DistanceStrategy, string> = {
  l2: '<->',
  cosine: '<=>',
  inner_product: '<#>',
  manhattan: '<+>',
};

const OPERATOR_CLASS_MAP: Record<DistanceStrategy, string> = {
  l2: 'vector_l2_ops',
  cosine: 'vector_cosine_ops',
  inner_product: 'vector_ip_ops',
  manhattan: 'vector_l1_ops',
};

const DEFAULT_HNSW_M = 16;
const DEFAULT_HNSW_EF_CONSTRUCTION = 64;
const DEFAULT_IVFFLAT_LISTS = 100;

// ============================================================
// DataVecClient
// ============================================================

export class DataVecClient {
  private pool: Pool;

  constructor(config: DataVecConfig) {
    const poolConfig: PoolConfig = {
      host: config.host,
      port: config.port,
      database: config.database,
      user: config.user,
      password: config.password,
      max: config.maxConnections ?? 10,
      ssl: config.ssl,
    };
    this.pool = new Pool(poolConfig);
  }

  /**
   * Test the connection by executing SELECT 1.
   */
  async connect(): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query('SELECT 1');
    } finally {
      client.release();
    }
  }

  /**
   * Create a vector table. openGauss DataVec does not need CREATE EXTENSION.
   */
  async createTable(options: CreateTableOptions): Promise<void> {
    const ifNotExists = options.ifNotExists ? 'IF NOT EXISTS' : '';
    const sql = `CREATE TABLE ${ifNotExists} ${this.quoteTable(options.tableName)} (
      id SERIAL PRIMARY KEY,
      content TEXT NOT NULL,
      embedding vector(${options.dimensions}) NOT NULL,
      metadata JSONB,
      created_at TIMESTAMP DEFAULT NOW()
    )`;
    await this.pool.query(sql);
  }

  /**
   * Create a vector index (HNSW / IVFFLAT / DISKANN).
   */
  async createIndex(options: CreateIndexOptions): Promise<void> {
    const ops = OPERATOR_CLASS_MAP[options.distanceStrategy];
    const indexName = this.quoteIdent(options.indexName ?? `${options.tableName}_embedding_idx`);
    const tableName = this.quoteTable(options.tableName);

    let sql: string;

    switch (options.indexType) {
      case 'hnsw': {
        const m = options.m ?? DEFAULT_HNSW_M;
        const efConstruction = options.efConstruction ?? DEFAULT_HNSW_EF_CONSTRUCTION;
        sql = `CREATE INDEX ${indexName} ON ${tableName} USING hnsw (embedding ${ops}) WITH (m = ${m}, ef_construction = ${efConstruction})`;
        break;
      }
      case 'ivfflat': {
        const lists = options.lists ?? DEFAULT_IVFFLAT_LISTS;
        sql = `CREATE INDEX ${indexName} ON ${tableName} USING ivfflat (embedding ${ops}) WITH (lists = ${lists})`;
        break;
      }
      case 'diskann': {
        sql = `CREATE INDEX ${indexName} ON ${tableName} USING diskann (embedding ${ops})`;
        break;
      }
      default:
        throw new Error(`Unsupported index type: ${options.indexType}`);
    }

    await this.pool.query(sql);
  }

  /**
   * Insert documents in batch using a transaction. Returns the number of inserted rows.
   */
  async insertDocuments(options: InsertDocumentOptions): Promise<number> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      const sql = `INSERT INTO ${this.quoteTable(options.tableName)} (content, embedding, metadata) VALUES ($1, $2::vector, $3::jsonb)`;

      let count = 0;
      for (const doc of options.documents) {
        const vectorStr = this.vectorToString(doc.embedding);
        const metadata = doc.metadata ?? null;
        const result = await client.query(sql, [doc.content, vectorStr, JSON.stringify(metadata)]);
        count += result.rowCount ?? 0;
      }

      await client.query('COMMIT');
      return count;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Perform a similarity search with optional metadata filtering.
   *
   * IMPORTANT: SET parameters (hnsw_ef_search / ivfflat_probes) must be executed
   * on the same client connection as the search query. This is a key difference
   * from pgvector which uses hnsw.ef_search / ivfflat.probes syntax.
   */
  async similaritySearch(options: VectorSearchOptions): Promise<SearchResult[]> {
    const client = await this.pool.connect();
    try {
      // Set query parameters on the same connection
      if (options.efSearch !== undefined) {
        await client.query(`SET hnsw_ef_search = ${options.efSearch}`);
      }
      if (options.probes !== undefined) {
        await client.query(`SET ivfflat_probes = ${options.probes}`);
      }

      const operator = DISTANCE_OPERATOR_MAP[options.distanceStrategy];
      const tableName = this.quoteTable(options.tableName);
      const vectorStr = this.vectorToString(options.queryVector);

      // Build WHERE clause from metadata filter
      const { whereClause, params } = this.buildWhereClause(options.filter);

      const distanceAlias = 'distance';
      const selectSql = `SELECT id, content, metadata, embedding ${operator} $1::vector AS ${distanceAlias} FROM ${tableName}`;

      let fullSql: string;
      let queryParams: unknown[];

      if (whereClause) {
        fullSql = `${selectSql} WHERE ${whereClause} ORDER BY ${distanceAlias} LIMIT $2`;
        queryParams = [vectorStr, options.limit, ...params];
      } else {
        fullSql = `${selectSql} ORDER BY ${distanceAlias} LIMIT $2`;
        queryParams = [vectorStr, options.limit];
      }

      const result = await client.query(fullSql, queryParams);

      return result.rows.map((row: Record<string, unknown>) => ({
        id: row.id as number,
        content: row.content as string,
        metadata: row.metadata as Record<string, unknown> | null,
        distance: row.distance as number,
      }));
    } finally {
      client.release();
    }
  }

  /**
   * Execute a custom SQL query.
   */
  async executeQuery(sql: string, params?: unknown[]): Promise<unknown[]> {
    const result = await this.pool.query(sql, params);
    return result.rows;
  }

  /**
   * Drop a table if it exists.
   */
  async dropTable(tableName: string): Promise<void> {
    await this.pool.query(`DROP TABLE IF EXISTS ${this.quoteTable(tableName)}`);
  }

  /**
   * Close the connection pool.
   */
  async close(): Promise<void> {
    await this.pool.end();
  }

  // ============================================================
  // Private Helpers
  // ============================================================

  /**
   * Quote a SQL identifier to prevent injection.
   */
  private quoteIdent(name: string): string {
    // Double-quote identifiers, escaping any embedded double quotes
    return `"${name.replace(/"/g, '""')}"`;
  }

  /**
   * Quote a possibly schema-qualified table name (e.g. "public.rag_docs" → "public"."rag_docs").
   */
  private quoteTable(tableName: string): string {
    const parts = tableName.split('.');
    return parts.map((p) => this.quoteIdent(p.trim())).join('.');
  }

  /**
   * Convert a numeric vector array to the string format expected by the vector type.
   */
  private vectorToString(vec: number[]): string {
    return `[${vec.join(',')}]`;
  }

  /**
   * Build a WHERE clause from a metadata filter object.
   * Uses parameterized queries to prevent injection.
   *
   * Example filter: { category: 'science', year: 2023 }
   * Produces: metadata->>'category' = $3 AND metadata->>'year' = $4
   *           params: ['science', '2023']
   *
   * Note: The parameter indices start after the query vector and limit params,
   * so the first filter param will be $3 (after $1 for vector, $2 for limit).
   */
  private buildWhereClause(filter?: Record<string, unknown>): {
    whereClause: string;
    params: unknown[];
  } {
    if (!filter || Object.keys(filter).length === 0) {
      return { whereClause: '', params: [] };
    }

    const conditions: string[] = [];
    const params: unknown[] = [];

    // Guard against NULL or non-object JSONB values (e.g. JSON null scalar)
    // which would cause "cannot call jsonb_object_field_text on a scalar" errors.
    // JSONB null (from JSON.stringify(null)) is NOT SQL NULL, so IS NOT NULL
    // doesn't work. We must check jsonb_typeof to ensure it's an object.
    conditions.push("jsonb_typeof(metadata) = 'object'");

    for (const [key, value] of Object.entries(filter)) {
      conditions.push(`metadata->>'${this.escapeMetaKey(key)}' = $${params.length + 3}`);
      params.push(String(value));
    }

    return {
      whereClause: conditions.join(' AND '),
      params,
    };
  }

  /**
   * Escape a metadata key to prevent injection in the JSON path expression.
   * Single quotes and special characters are handled.
   */
  private escapeMetaKey(key: string): string {
    // Replace single quotes with doubled single quotes (SQL escaping)
    return key.replace(/'/g, "''");
  }
}