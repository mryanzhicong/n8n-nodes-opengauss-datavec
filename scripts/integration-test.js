// Integration Test for openGauss DataVec Community Node
// Tests all DataVecClient operations against a real openGauss database

const { DataVecClient } = require('../dist/nodes/VectorStoreOpenGauss/datavecClient');

const DB_CONFIG = {
  host: 'localhost',
  port: 5432,
  user: 'gaussdb',
  password: 'openGauss@123',
  database: 'postgres',
};

const TEST_TABLE = 'n8n_test_vectors';
const DIMENSIONS = 3;

let passed = 0;
let failed = 0;
const failures = [];

function log(msg) {
  console.log(msg);
}

function pass(testName) {
  passed++;
  log(`   ✓ ${testName}`);
}

function fail(testName, error) {
  failed++;
  const msg = error instanceof Error ? error.message : String(error);
  failures.push({ testName, error: msg });
  log(`   ✗ ${testName}: ${msg}`);
}

async function main() {
  log('=== openGauss DataVec Integration Tests ===\n');
  log(`Database: ${DB_CONFIG.host}:${DB_CONFIG.port}/${DB_CONFIG.database}`);
  log(`User: ${DB_CONFIG.user}\n`);

  const client = new DataVecClient(DB_CONFIG);

  try {
    // ---- Test 1: Connection ----
    log('1. Testing connection...');
    try {
      await client.connect();
      pass('Connection successful');
    } catch (error) {
      fail('Connection', error);
      log('\n✗ Cannot connect to database, aborting remaining tests.');
      await tryClose(client);
      printSummary();
      process.exit(1);
    }

    // ---- Test 2: Clean up leftover table (if any) ----
    log('2. Cleaning up leftover test table (if any)...');
    try {
      await client.dropTable(TEST_TABLE);
      pass('Cleaned up leftover table');
    } catch (error) {
      fail('Cleanup leftover table', error);
    }

    // ---- Test 3: Create table ----
    log('3. Creating table...');
    try {
      await client.createTable({
        tableName: TEST_TABLE,
        dimensions: DIMENSIONS,
        ifNotExists: true,
      });
      pass('Table created');
    } catch (error) {
      fail('Create table', error);
      log('\n✗ Cannot create table, aborting remaining tests.');
      await tryCleanup(client);
      await tryClose(client);
      printSummary();
      process.exit(1);
    }

    // ---- Test 4: Create table IF NOT EXISTS (idempotent) ----
    log('4. Creating table again with IF NOT EXISTS (idempotent)...');
    try {
      await client.createTable({
        tableName: TEST_TABLE,
        dimensions: DIMENSIONS,
        ifNotExists: true,
      });
      pass('Idempotent CREATE TABLE');
    } catch (error) {
      fail('Idempotent CREATE TABLE', error);
    }

    // ---- Test 5: Insert documents ----
    log('5. Inserting documents...');
    try {
      const count = await client.insertDocuments({
        tableName: TEST_TABLE,
        documents: [
          { content: 'Hello world', embedding: [0.1, 0.2, 0.3], metadata: { source: 'test', category: 'greeting' } },
          { content: 'Foo bar', embedding: [0.4, 0.5, 0.6], metadata: { source: 'test', category: 'misc' } },
          { content: 'Vector search', embedding: [0.7, 0.8, 0.9], metadata: { source: 'demo', category: 'tech' } },
        ],
      });
      if (count === 3) {
        pass(`Inserted ${count} documents`);
      } else {
        fail('Insert documents', `Expected 3, got ${count}`);
      }
    } catch (error) {
      fail('Insert documents', error);
    }

    // ---- Test 6: Insert document without metadata ----
    log('6. Inserting document without metadata...');
    try {
      const count = await client.insertDocuments({
        tableName: TEST_TABLE,
        documents: [
          { content: 'No metadata doc', embedding: [0.15, 0.25, 0.35] },
        ],
      });
      if (count === 1) {
        pass('Inserted document without metadata');
      } else {
        fail('Insert without metadata', `Expected 1, got ${count}`);
      }
    } catch (error) {
      fail('Insert without metadata', error);
    }

    // ---- Test 7: Insert empty documents array ----
    log('7. Inserting empty documents array...');
    try {
      const count = await client.insertDocuments({
        tableName: TEST_TABLE,
        documents: [],
      });
      if (count === 0) {
        pass('Inserted 0 documents (empty array)');
      } else {
        fail('Insert empty array', `Expected 0, got ${count}`);
      }
    } catch (error) {
      fail('Insert empty array', error);
    }

    // ---- Test 8: Similarity search (cosine) ----
    log('8. Similarity search (cosine distance)...');
    try {
      const results = await client.similaritySearch({
        tableName: TEST_TABLE,
        queryVector: [0.1, 0.2, 0.3],
        limit: 5,
        distanceStrategy: 'cosine',
      });
      log(`   Found ${results.length} results:`);
      results.forEach((r, i) => {
        log(`     ${i + 1}. id=${r.id} "${r.content}" (distance: ${r.distance}, metadata: ${JSON.stringify(r.metadata)})`);
      });

      if (results.length > 0) {
        // The closest result to [0.1, 0.2, 0.3] should be "Hello world" with exact same vector
        if (results[0].content === 'Hello world') {
          pass('Cosine search: closest match is "Hello world" (correct)');
        } else {
          fail('Cosine search ordering', `Expected "Hello world" first, got "${results[0].content}"`);
        }
      } else {
        fail('Cosine search', 'No results returned');
      }
    } catch (error) {
      fail('Cosine search', error);
    }

    // ---- Test 9: Similarity search (L2 distance) ----
    log('9. Similarity search (L2 distance)...');
    try {
      const results = await client.similaritySearch({
        tableName: TEST_TABLE,
        queryVector: [0.4, 0.5, 0.6],
        limit: 5,
        distanceStrategy: 'l2',
      });
      log(`   Found ${results.length} results:`);
      results.forEach((r, i) => {
        log(`     ${i + 1}. id=${r.id} "${r.content}" (distance: ${r.distance})`);
      });

      if (results.length > 0 && results[0].content === 'Foo bar') {
        pass('L2 search: closest match is "Foo bar" (correct)');
      } else if (results.length > 0) {
        fail('L2 search ordering', `Expected "Foo bar" first, got "${results[0].content}"`);
      } else {
        fail('L2 search', 'No results returned');
      }
    } catch (error) {
      fail('L2 search', error);
    }

    // ---- Test 10: Similarity search (inner product) ----
    log('10. Similarity search (inner product)...');
    try {
      const results = await client.similaritySearch({
        tableName: TEST_TABLE,
        queryVector: [0.7, 0.8, 0.9],
        limit: 3,
        distanceStrategy: 'inner_product',
      });
      log(`   Found ${results.length} results:`);
      results.forEach((r, i) => {
        log(`     ${i + 1}. id=${r.id} "${r.content}" (distance: ${r.distance})`);
      });
      if (results.length > 0) {
        pass('Inner product search returned results');
      } else {
        fail('Inner product search', 'No results returned');
      }
    } catch (error) {
      fail('Inner product search', error);
    }

    // ---- Test 11: Search with metadata filter ----
    log('11. Search with metadata filter (source=test)...');
    try {
      const filtered = await client.similaritySearch({
        tableName: TEST_TABLE,
        queryVector: [0.5, 0.5, 0.5],
        limit: 10,
        distanceStrategy: 'l2',
        filter: { source: 'test' },
      });
      log(`   Found ${filtered.length} results with filter {source: "test"}:`);
      filtered.forEach((r, i) => {
        log(`     ${i + 1}. id=${r.id} "${r.content}" (metadata: ${JSON.stringify(r.metadata)})`);
      });

      // Should only return docs with source="test" (Hello world, Foo bar)
      const allTest = filtered.every((r) => r.metadata && r.metadata.source === 'test');
      if (filtered.length === 2 && allTest) {
        pass('Metadata filter returned only matching documents');
      } else if (allTest && filtered.length > 0) {
        pass(`Metadata filter returned ${filtered.length} matching documents (all have source=test)`);
      } else {
        fail('Metadata filter', `Expected only source=test documents, got ${filtered.length} results`);
      }
    } catch (error) {
      fail('Metadata filter search', error);
    }

    // ---- Test 12: Search with multi-key metadata filter ----
    log('12. Search with multi-key metadata filter (source=test, category=greeting)...');
    try {
      const filtered = await client.similaritySearch({
        tableName: TEST_TABLE,
        queryVector: [0.1, 0.2, 0.3],
        limit: 10,
        distanceStrategy: 'cosine',
        filter: { source: 'test', category: 'greeting' },
      });
      log(`   Found ${filtered.length} results:`);
      filtered.forEach((r, i) => {
        log(`     ${i + 1}. id=${r.id} "${r.content}" (metadata: ${JSON.stringify(r.metadata)})`);
      });

      if (filtered.length === 1 && filtered[0].content === 'Hello world') {
        pass('Multi-key metadata filter returned correct result');
      } else {
        fail('Multi-key metadata filter', `Expected 1 result "Hello world", got ${filtered.length}`);
      }
    } catch (error) {
      fail('Multi-key metadata filter', error);
    }

    // ---- Test 13: Execute custom query (COUNT) ----
    log('13. Execute custom query (COUNT)...');
    try {
      const rows = await client.executeQuery(`SELECT COUNT(*) as count FROM "${TEST_TABLE}"`);
      log(`   Custom query result: ${JSON.stringify(rows)}`);
      const count = parseInt(rows[0].count, 10);
      if (count === 4) {
        pass(`Custom query: COUNT = ${count} (correct)`);
      } else {
        fail('Custom query COUNT', `Expected 4, got ${count}`);
      }
    } catch (error) {
      fail('Custom query COUNT', error);
    }

    // ---- Test 14: Execute custom query (SELECT with WHERE) ----
    log('14. Execute custom query (SELECT with WHERE)...');
    try {
      const rows = await client.executeQuery(
        `SELECT content, metadata FROM "${TEST_TABLE}" WHERE jsonb_typeof(metadata) = 'object' AND metadata->>'source' = $1`,
        ['demo'],
      );
      log(`   Result: ${JSON.stringify(rows)}`);
      if (rows.length === 1 && rows[0].content === 'Vector search') {
        pass('Custom query with params works correctly');
      } else {
        fail('Custom query with params', `Unexpected result: ${JSON.stringify(rows)}`);
      }
    } catch (error) {
      fail('Custom query with params', error);
    }

    // ---- Test 15: Create HNSW index ----
    log('15. Creating HNSW index...');
    try {
      await client.createIndex({
        tableName: TEST_TABLE,
        indexType: 'hnsw',
        distanceStrategy: 'cosine',
        m: 16,
        efConstruction: 64,
      });
      pass('HNSW index created');
    } catch (error) {
      fail('Create HNSW index', error);
    }

    // ---- Test 16: Search after index created (verify index doesn't break search) ----
    log('16. Similarity search after HNSW index creation...');
    try {
      const results = await client.similaritySearch({
        tableName: TEST_TABLE,
        queryVector: [0.1, 0.2, 0.3],
        limit: 3,
        distanceStrategy: 'cosine',
      });
      if (results.length > 0 && results[0].content === 'Hello world') {
        pass('Search after HNSW index still works correctly');
      } else if (results.length > 0) {
        fail('Search after index', `Expected "Hello world" first, got "${results[0].content}"`);
      } else {
        fail('Search after index', 'No results returned');
      }
    } catch (error) {
      fail('Search after HNSW index', error);
    }

    // ---- Test 17: Drop table ----
    log('17. Dropping test table...');
    try {
      await client.dropTable(TEST_TABLE);
      pass('Table dropped');
    } catch (error) {
      fail('Drop table', error);
    }

    // ---- Test 18: Verify table is gone ----
    log('18. Verify table no longer exists...');
    try {
      const rows = await client.executeQuery(
        `SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = $1) as exists_flag`,
        [TEST_TABLE],
      );
      if (rows[0].exists_flag === false) {
        pass('Table confirmed dropped');
      } else {
        fail('Verify table drop', `Table still exists: ${JSON.stringify(rows)}`);
      }
    } catch (error) {
      fail('Verify table drop', error);
    }

    // ---- Test 19: Drop non-existent table (should not error) ----
    log('19. Drop non-existent table (should be idempotent)...');
    try {
      await client.dropTable('nonexistent_table_12345');
      pass('Drop non-existent table succeeded (IF EXISTS)');
    } catch (error) {
      fail('Drop non-existent table', error);
    }

  } catch (error) {
    log(`\n✗ Unexpected error: ${error instanceof Error ? error.message : String(error)}`);
    if (error instanceof Error) log(error.stack);
    await tryCleanup(client);
  } finally {
    await tryClose(client);
  }

  printSummary();
  process.exit(failed > 0 ? 1 : 0);
}

async function tryCleanup(client) {
  try {
    await client.dropTable(TEST_TABLE);
  } catch (e) {
    // ignore
  }
}

async function tryClose(client) {
  try {
    await client.close();
  } catch (e) {
    // ignore
  }
}

function printSummary() {
  log('\n========================================');
  log(`  TOTAL: ${passed + failed}  |  PASSED: ${passed}  |  FAILED: ${failed}`);
  log('========================================');

  if (failures.length > 0) {
    log('\nFailed tests:');
    failures.forEach((f, i) => {
      log(`  ${i + 1}. ${f.testName}: ${f.error}`);
    });
    log('\n✗ Some tests failed!');
  } else {
    log('\n✓ All integration tests passed!');
  }
}

main();
