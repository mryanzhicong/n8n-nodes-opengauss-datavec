import { DataVecClient, type DataVecConfig } from './datavecClient';

// ============================================================
// Mock pg module
// ============================================================

const mockClient = {
  query: jest.fn(),
  release: jest.fn(),
};

const mockPool = {
  query: jest.fn(),
  connect: jest.fn().mockResolvedValue(mockClient),
  end: jest.fn(),
};

jest.mock('pg', () => ({
  Pool: jest.fn(() => mockPool),
}));

// ============================================================
// Helper: create a DataVecClient instance with default config
// ============================================================

const defaultConfig: DataVecConfig = {
  host: 'localhost',
  port: 5432,
  database: 'testdb',
  user: 'testuser',
  password: 'testpass',
};

function createClient(): DataVecClient {
  return new DataVecClient(defaultConfig);
}

// ============================================================
// Reset mocks before each test
// ============================================================

beforeEach(() => {
  jest.clearAllMocks();
  mockPool.connect.mockResolvedValue(mockClient);
  mockPool.query.mockResolvedValue({ rows: [] });
  mockClient.query.mockResolvedValue({ rows: [] });
  mockClient.release.mockResolvedValue(undefined);
  mockPool.end.mockResolvedValue(undefined);
});

// ============================================================
// connect
// ============================================================

describe('DataVecClient - connect', () => {
  it('should successfully connect when SELECT 1 returns ok', async () => {
    mockClient.query.mockResolvedValue({ rows: [{ '?column?': 1 }] });

    const client = createClient();
    await client.connect();

    expect(mockPool.connect).toHaveBeenCalledTimes(1);
    expect(mockClient.query).toHaveBeenCalledWith('SELECT 1');
    expect(mockClient.release).toHaveBeenCalledTimes(1);
  });

  it('should throw an error when connection fails', async () => {
    mockClient.query.mockRejectedValue(new Error('Connection refused'));

    const client = createClient();
    await expect(client.connect()).rejects.toThrow('Connection refused');

    // release should still be called in the finally block
    expect(mockClient.release).toHaveBeenCalledTimes(1);
  });
});

// ============================================================
// createTable
// ============================================================

describe('DataVecClient - createTable', () => {
  it('should generate correct CREATE TABLE SQL with IF NOT EXISTS', async () => {
    const client = createClient();
    await client.createTable({ tableName: 'my_vectors', dimensions: 128, ifNotExists: true });

    expect(mockPool.query).toHaveBeenCalledTimes(1);
    const sql = mockPool.query.mock.calls[0][0] as string;
    expect(sql).toContain('IF NOT EXISTS');
    expect(sql).toContain('"my_vectors"');
    expect(sql).toContain('vector(128)');
    expect(sql).toContain('SERIAL PRIMARY KEY');
    expect(sql).toContain('embedding vector(128) NOT NULL');
  });

  it('should generate CREATE TABLE SQL without IF NOT EXISTS', async () => {
    const client = createClient();
    await client.createTable({ tableName: 'my_vectors', dimensions: 256, ifNotExists: false });

    const sql = mockPool.query.mock.calls[0][0] as string;
    expect(sql).not.toContain('IF NOT EXISTS');
    expect(sql).toContain('vector(256)');
  });

  it('should properly quote table names with special characters', async () => {
    const client = createClient();
    await client.createTable({ tableName: 'my-table', dimensions: 64 });

    const sql = mockPool.query.mock.calls[0][0] as string;
    expect(sql).toContain('"my-table"');
  });

  it('should escape double quotes in table names', async () => {
    const client = createClient();
    await client.createTable({ tableName: 'my"table', dimensions: 64 });

    const sql = mockPool.query.mock.calls[0][0] as string;
    // Double quotes inside identifiers are escaped by doubling
    expect(sql).toContain('"my""table"');
  });
});

// ============================================================
// createIndex
// ============================================================

describe('DataVecClient - createIndex', () => {
  it('should generate correct HNSW index SQL with m and ef_construction', async () => {
    const client = createClient();
    await client.createIndex({
      tableName: 'my_vectors',
      indexType: 'hnsw',
      distanceStrategy: 'l2',
      m: 32,
      efConstruction: 128,
    });

    const sql = mockPool.query.mock.calls[0][0] as string;
    expect(sql).toContain('USING hnsw');
    expect(sql).toContain('vector_l2_ops');
    expect(sql).toContain('m = 32');
    expect(sql).toContain('ef_construction = 128');
    expect(sql).toContain('"my_vectors_embedding_idx"');
  });

  it('should use default HNSW parameters when not specified', async () => {
    const client = createClient();
    await client.createIndex({
      tableName: 'my_vectors',
      indexType: 'hnsw',
      distanceStrategy: 'cosine',
    });

    const sql = mockPool.query.mock.calls[0][0] as string;
    expect(sql).toContain('m = 16');
    expect(sql).toContain('ef_construction = 64');
  });

  it('should generate correct IVFFLAT index SQL with lists parameter', async () => {
    const client = createClient();
    await client.createIndex({
      tableName: 'my_vectors',
      indexType: 'ivfflat',
      distanceStrategy: 'cosine',
      lists: 200,
    });

    const sql = mockPool.query.mock.calls[0][0] as string;
    expect(sql).toContain('USING ivfflat');
    expect(sql).toContain('vector_cosine_ops');
    expect(sql).toContain('lists = 200');
  });

  it('should use default IVFFLAT lists when not specified', async () => {
    const client = createClient();
    await client.createIndex({
      tableName: 'my_vectors',
      indexType: 'ivfflat',
      distanceStrategy: 'l2',
    });

    const sql = mockPool.query.mock.calls[0][0] as string;
    expect(sql).toContain('lists = 100');
  });

  it('should generate correct DISKANN index SQL', async () => {
    const client = createClient();
    await client.createIndex({
      tableName: 'my_vectors',
      indexType: 'diskann',
      distanceStrategy: 'inner_product',
    });

    const sql = mockPool.query.mock.calls[0][0] as string;
    expect(sql).toContain('USING diskann');
    expect(sql).toContain('vector_ip_ops');
    // DISKANN has no WITH parameters
    expect(sql).not.toContain('WITH (');
  });

  it('should map distanceStrategy to correct operator class', async () => {
    const mappings: Array<{ strategy: 'l2' | 'cosine' | 'inner_product' | 'manhattan'; ops: string }> = [
      { strategy: 'l2', ops: 'vector_l2_ops' },
      { strategy: 'cosine', ops: 'vector_cosine_ops' },
      { strategy: 'inner_product', ops: 'vector_ip_ops' },
      { strategy: 'manhattan', ops: 'vector_l1_ops' },
    ];

    for (const { strategy, ops } of mappings) {
      jest.clearAllMocks();
      const client = createClient();
      await client.createIndex({
        tableName: 'test_table',
        indexType: 'hnsw',
        distanceStrategy: strategy,
      });

      const sql = mockPool.query.mock.calls[0][0] as string;
      expect(sql).toContain(ops);
    }
  });

  it('should use custom index name when provided', async () => {
    const client = createClient();
    await client.createIndex({
      tableName: 'my_vectors',
      indexType: 'hnsw',
      distanceStrategy: 'l2',
      indexName: 'custom_idx',
    });

    const sql = mockPool.query.mock.calls[0][0] as string;
    expect(sql).toContain('"custom_idx"');
    expect(sql).not.toContain('"my_vectors_embedding_idx"');
  });
});

// ============================================================
// insertDocuments
// ============================================================

describe('DataVecClient - insertDocuments', () => {
  it('should insert multiple documents using a transaction', async () => {
    const client = createClient();
    const count = await client.insertDocuments({
      tableName: 'my_vectors',
      documents: [
        { content: 'doc1', embedding: [0.1, 0.2, 0.3] },
        { content: 'doc2', embedding: [0.4, 0.5, 0.6], metadata: { key: 'value' } },
      ],
    });

    expect(count).toBe(2);
    // Should call: BEGIN, INSERT, INSERT, COMMIT
    expect(mockClient.query).toHaveBeenCalledWith('BEGIN');
    expect(mockClient.query).toHaveBeenCalledWith('COMMIT');
    expect(mockClient.query).toHaveBeenCalledTimes(4); // BEGIN + 2 INSERTs + COMMIT
    expect(mockClient.release).toHaveBeenCalledTimes(1);
  });

  it('should correctly format vectors as strings', async () => {
    const client = createClient();
    await client.insertDocuments({
      tableName: 'my_vectors',
      documents: [
        { content: 'doc1', embedding: [1.5, 2.3, 3.7] },
      ],
    });

    // Check the INSERT call parameters
    const insertCall = mockClient.query.mock.calls.find(
      (call: unknown[]) => typeof call[0] === 'string' && (call[0] as string).includes('INSERT'),
    );
    expect(insertCall).toBeDefined();
    const params = insertCall![1] as unknown[];
    // Vector should be formatted as [1.5,2.3,3.7]
    expect(params[1]).toBe('[1.5,2.3,3.7]');
  });

  it('should return inserted count', async () => {
    const client = createClient();
    const count = await client.insertDocuments({
      tableName: 'my_vectors',
      documents: [
        { content: 'doc1', embedding: [0.1] },
        { content: 'doc2', embedding: [0.2] },
        { content: 'doc3', embedding: [0.3] },
      ],
    });

    expect(count).toBe(3);
  });

  it('should return 0 for empty documents array', async () => {
    const client = createClient();
    const count = await client.insertDocuments({
      tableName: 'my_vectors',
      documents: [],
    });

    expect(count).toBe(0);
    // Should still BEGIN and COMMIT, but no INSERTs
    expect(mockClient.query).toHaveBeenCalledWith('BEGIN');
    expect(mockClient.query).toHaveBeenCalledWith('COMMIT');
  });

  it('should rollback on insert error and rethrow', async () => {
    mockClient.query.mockImplementation((sql: string) => {
      if (sql.includes('INSERT')) {
        throw new Error('Insert failed');
      }
      return Promise.resolve({ rows: [] });
    });

    const client = createClient();
    await expect(
      client.insertDocuments({
        tableName: 'my_vectors',
        documents: [{ content: 'doc1', embedding: [0.1] }],
      }),
    ).rejects.toThrow('Insert failed');

    expect(mockClient.query).toHaveBeenCalledWith('ROLLBACK');
    expect(mockClient.release).toHaveBeenCalledTimes(1);
  });

  it('should use null metadata when metadata is not provided', async () => {
    const client = createClient();
    await client.insertDocuments({
      tableName: 'my_vectors',
      documents: [
        { content: 'doc1', embedding: [0.1] },
      ],
    });

    const insertCall = mockClient.query.mock.calls.find(
      (call: unknown[]) => typeof call[0] === 'string' && (call[0] as string).includes('INSERT'),
    );
    const params = insertCall![1] as unknown[];
    // metadata param should be JSON string of null
    expect(params[2]).toBe('null');
  });

  it('should stringify metadata object', async () => {
    const client = createClient();
    await client.insertDocuments({
      tableName: 'my_vectors',
      documents: [
        { content: 'doc1', embedding: [0.1], metadata: { category: 'test', year: 2024 } },
      ],
    });

    const insertCall = mockClient.query.mock.calls.find(
      (call: unknown[]) => typeof call[0] === 'string' && (call[0] as string).includes('INSERT'),
    );
    const params = insertCall![1] as unknown[];
    expect(params[2]).toBe('{"category":"test","year":2024}');
  });
});

// ============================================================
// similaritySearch
// ============================================================

describe('DataVecClient - similaritySearch', () => {
  const mockSearchResults = [
    { id: 1, content: 'result1', metadata: { key: 'val1' }, distance: 0.1 },
    { id: 2, content: 'result2', metadata: null, distance: 0.5 },
  ];

  it('should select correct operator based on distanceStrategy', async () => {
    const operatorMap: Array<{ strategy: 'l2' | 'cosine' | 'inner_product' | 'manhattan'; op: string }> = [
      { strategy: 'l2', op: '<->' },
      { strategy: 'cosine', op: '<=>' },
      { strategy: 'inner_product', op: '<#>' },
      { strategy: 'manhattan', op: '<+>' },
    ];

    for (const { strategy, op } of operatorMap) {
      jest.clearAllMocks();
      mockClient.query.mockResolvedValue({ rows: mockSearchResults });

      const client = createClient();
      await client.similaritySearch({
        tableName: 'test_table',
        queryVector: [0.1, 0.2],
        limit: 5,
        distanceStrategy: strategy,
      });

      const searchCall = mockClient.query.mock.calls.find(
        (call: unknown[]) => typeof call[0] === 'string' && (call[0] as string).includes('SELECT'),
      );
      expect(searchCall).toBeDefined();
      const sql = searchCall![0] as string;
      expect(sql).toContain(op);
    }
  });

  it('should set hnsw_ef_search parameter before searching', async () => {
    mockClient.query.mockResolvedValue({ rows: mockSearchResults });

    const client = createClient();
    await client.similaritySearch({
      tableName: 'test_table',
      queryVector: [0.1, 0.2],
      limit: 5,
      distanceStrategy: 'l2',
      efSearch: 200,
    });

    // First call should be SET hnsw_ef_search
    const setCall = mockClient.query.mock.calls[0];
    expect(setCall[0]).toBe('SET hnsw_ef_search = 200');

    // Verify it's NOT the pgvector syntax (hnsw.ef_search)
    expect(setCall[0]).not.toContain('hnsw.ef_search');
  });

  it('should set ivfflat_probes parameter before searching', async () => {
    mockClient.query.mockResolvedValue({ rows: mockSearchResults });

    const client = createClient();
    await client.similaritySearch({
      tableName: 'test_table',
      queryVector: [0.1, 0.2],
      limit: 5,
      distanceStrategy: 'cosine',
      probes: 50,
    });

    // First call should be SET ivfflat_probes
    const setCall = mockClient.query.mock.calls[0];
    expect(setCall[0]).toBe('SET ivfflat_probes = 50');

    // Verify it's NOT the pgvector syntax (ivfflat.probes)
    expect(setCall[0]).not.toContain('ivfflat.probes');
  });

  it('should set both efSearch and probes when both are provided', async () => {
    mockClient.query.mockResolvedValue({ rows: mockSearchResults });

    const client = createClient();
    await client.similaritySearch({
      tableName: 'test_table',
      queryVector: [0.1, 0.2],
      limit: 5,
      distanceStrategy: 'l2',
      efSearch: 300,
      probes: 20,
    });

    // First two calls should be SET statements
    expect(mockClient.query.mock.calls[0][0]).toBe('SET hnsw_ef_search = 300');
    expect(mockClient.query.mock.calls[1][0]).toBe('SET ivfflat_probes = 20');
  });

  it('should not set efSearch or probes when not provided', async () => {
    mockClient.query.mockResolvedValue({ rows: mockSearchResults });

    const client = createClient();
    await client.similaritySearch({
      tableName: 'test_table',
      queryVector: [0.1, 0.2],
      limit: 5,
      distanceStrategy: 'l2',
    });

    // Only the search query should be called, no SET statements
    for (const call of mockClient.query.mock.calls) {
      expect((call[0] as string)).not.toContain('SET ');
    }
  });

  it('should support metadata filtering', async () => {
    mockClient.query.mockResolvedValue({ rows: mockSearchResults });

    const client = createClient();
    await client.similaritySearch({
      tableName: 'test_table',
      queryVector: [0.1, 0.2],
      limit: 5,
      distanceStrategy: 'l2',
      filter: { category: 'science', year: '2023' },
    });

    const searchCall = mockClient.query.mock.calls.find(
      (call: unknown[]) => typeof call[0] === 'string' && (call[0] as string).includes('SELECT'),
    );
    expect(searchCall).toBeDefined();
    const sql = searchCall![0] as string;
    expect(sql).toContain('WHERE');
    expect(sql).toContain("jsonb_typeof(metadata) = 'object'");
    expect(sql).toContain("metadata->>'category'");
    expect(sql).toContain("metadata->>'year'");
    expect(sql).toContain('AND');

    // Check the params include filter values
    const params = searchCall![1] as unknown[];
    expect(params).toContain('science');
    expect(params).toContain('2023');
  });

  it('should correctly build LIMIT clause', async () => {
    mockClient.query.mockResolvedValue({ rows: mockSearchResults });

    const client = createClient();
    await client.similaritySearch({
      tableName: 'test_table',
      queryVector: [0.1, 0.2],
      limit: 20,
      distanceStrategy: 'l2',
    });

    const searchCall = mockClient.query.mock.calls.find(
      (call: unknown[]) => typeof call[0] === 'string' && (call[0] as string).includes('SELECT'),
    );
    const sql = searchCall![0] as string;
    expect(sql).toContain('LIMIT $2');

    const params = searchCall![1] as unknown[];
    expect(params[1]).toBe(20);
  });

  it('should correctly map result rows to SearchResult objects', async () => {
    mockClient.query.mockResolvedValue({ rows: mockSearchResults });

    const client = createClient();
    const results = await client.similaritySearch({
      tableName: 'test_table',
      queryVector: [0.1, 0.2],
      limit: 5,
      distanceStrategy: 'l2',
    });

    expect(results).toHaveLength(2);
    expect(results[0]).toEqual({
      id: 1,
      content: 'result1',
      metadata: { key: 'val1' },
      distance: 0.1,
    });
    expect(results[1]).toEqual({
      id: 2,
      content: 'result2',
      metadata: null,
      distance: 0.5,
    });
  });

  it('should release client even if search throws', async () => {
    mockClient.query.mockRejectedValue(new Error('Search failed'));

    const client = createClient();
    await expect(
      client.similaritySearch({
        tableName: 'test_table',
        queryVector: [0.1, 0.2],
        limit: 5,
        distanceStrategy: 'l2',
      }),
    ).rejects.toThrow('Search failed');

    expect(mockClient.release).toHaveBeenCalledTimes(1);
  });

  it('should format query vector as string in parameters', async () => {
    mockClient.query.mockResolvedValue({ rows: [] });

    const client = createClient();
    await client.similaritySearch({
      tableName: 'test_table',
      queryVector: [1.1, 2.2, 3.3],
      limit: 5,
      distanceStrategy: 'l2',
    });

    const searchCall = mockClient.query.mock.calls.find(
      (call: unknown[]) => typeof call[0] === 'string' && (call[0] as string).includes('SELECT'),
    );
    const params = searchCall![1] as unknown[];
    expect(params[0]).toBe('[1.1,2.2,3.3]');
  });
});

// ============================================================
// executeQuery
// ============================================================

describe('DataVecClient - executeQuery', () => {
  it('should execute custom SQL and return results', async () => {
    const mockRows = [{ id: 1, name: 'test' }, { id: 2, name: 'test2' }];
    mockPool.query.mockResolvedValue({ rows: mockRows });

    const client = createClient();
    const result = await client.executeQuery('SELECT * FROM my_table WHERE id = $1', [1]);

    expect(mockPool.query).toHaveBeenCalledWith('SELECT * FROM my_table WHERE id = $1', [1]);
    expect(result).toEqual(mockRows);
  });

  it('should execute SQL without params', async () => {
    mockPool.query.mockResolvedValue({ rows: [] });

    const client = createClient();
    const result = await client.executeQuery('SELECT 1');

    expect(mockPool.query).toHaveBeenCalledWith('SELECT 1', undefined);
    expect(result).toEqual([]);
  });
});

// ============================================================
// dropTable
// ============================================================

describe('DataVecClient - dropTable', () => {
  it('should generate correct DROP TABLE IF EXISTS SQL', async () => {
    const client = createClient();
    await client.dropTable('my_vectors');

    expect(mockPool.query).toHaveBeenCalledWith('DROP TABLE IF EXISTS "my_vectors"');
  });

  it('should properly quote table name', async () => {
    const client = createClient();
    await client.dropTable('my-table');

    expect(mockPool.query).toHaveBeenCalledWith('DROP TABLE IF EXISTS "my-table"');
  });
});

// ============================================================
// close
// ============================================================

describe('DataVecClient - close', () => {
  it('should call pool.end()', async () => {
    const client = createClient();
    await client.close();

    expect(mockPool.end).toHaveBeenCalledTimes(1);
  });
});

// ============================================================
// DataVec vs pgvector key differences
// ============================================================

describe('DataVec vs pgvector key differences', () => {
  it('should use hnsw_ef_search (underscore) not hnsw.ef_search (dot) - DataVec syntax', async () => {
    mockClient.query.mockResolvedValue({ rows: [] });

    const client = createClient();
    await client.similaritySearch({
      tableName: 'test',
      queryVector: [0.1],
      limit: 5,
      distanceStrategy: 'l2',
      efSearch: 100,
    });

    const setCall = mockClient.query.mock.calls[0][0] as string;
    // DataVec uses underscore: hnsw_ef_search
    expect(setCall).toBe('SET hnsw_ef_search = 100');
    // pgvector uses dot: hnsw.ef_search - this should NOT appear
    expect(setCall).not.toContain('hnsw.ef_search');
  });

  it('should use ivfflat_probes (underscore) not ivfflat.probes (dot) - DataVec syntax', async () => {
    mockClient.query.mockResolvedValue({ rows: [] });

    const client = createClient();
    await client.similaritySearch({
      tableName: 'test',
      queryVector: [0.1],
      limit: 5,
      distanceStrategy: 'cosine',
      probes: 10,
    });

    const setCall = mockClient.query.mock.calls[0][0] as string;
    // DataVec uses underscore: ivfflat_probes
    expect(setCall).toBe('SET ivfflat_probes = 10');
    // pgvector uses dot: ivfflat.probes - this should NOT appear
    expect(setCall).not.toContain('ivfflat.probes');
  });
});
