
# openGauss DataVec 社区节点适配方案

## 背景

n根据 CONTRIBUTING.md 的明确规定，**新节点 PR 会被自动关闭**（除非 n8n 团队主动要求）。官方推荐的方式是创建社区节点并发布到 npm。因此本方案采用**独立 npm 社区节点包**的形式。

n8n 的向量数据库节点位于 `packages/@n8n/nodes-langchain/nodes/vector_store/`，通过 `createVectorStoreNode` 工厂函数创建。其中 PGVector 节点基于 `@langchain/community` 的 `PGVectorStore` 类，依赖 pgvector 扩展。

openGauss 7.0+ 内置原生向量引擎 DataVec，无需 `CREATE EXTENSION`。虽然 DataVec 与 pgvector 的距离操作符相同（`<->`, `<#>`, `<=>`, `<+>`），但在以下方面存在差异，不能直接复用 PGVector 节点：

## DataVec 与 pgvector 的关键差异

| 维度 | openGauss DataVec | PostgreSQL pgvector |
|------|-----------------|--------------------|
| 扩展加载 | 内核特性，无需操作 | 需要 `CREATE EXTENSION vector;` |
| 向量维度上限 | 16,000 | 2,000（halfvec 4,000） |
| 索引算法 | HNSW, IVFFLAT, **DISKANN, HNSWPQ, IVFPQ** | HNSW, IVFFLAT |
| 查询参数语法 | `SET hnsw_ef_search = N` | `SET hnsw.ef_search = N` |
| 查询参数语法 | `SET ivfflat_probes = N` | `SET ivfflat.probes = N` |
| 并行构建 | `ALTER TABLE SET(parallel_workers=N)` | `SET max_parallel_maintenance_workers=N` |
| 向量函数 | 12+ 函数（含 l2_normalize, subvector 等） | 基础距离计算 |
| 额外向量类型 | bitvector, sparsevector | halfvec, bit, sparsevec |
| 距离操作符 | `<->` `<#>` `<=>` `<+>` (相同) | `<->` `<#>` `<=>` `<+>` (相同) |

---

## 推荐方案：创建独立 npm 社区节点包

包名：`n8n-nodes-opengauss-datavec`

### Task 1：初始化社区节点项目

使用 `npm create @n8n/node` 脚手架创建项目，配置 `package.json`：

```json
{
  "name": "n8n-nodes-opengauss-datavec",
  "version": "0.1.0",
  "keywords": ["n8n", "n8n-community-node-package", "opengauss", "datavec", "vector"],
  "n8n": {
    "credentials": ["dist/credentials/OpenGaussDataVec.credentials.js"],
    "nodes": ["dist/nodes/VectorStoreOpenGauss/VectorStoreOpenGauss.node.js"]
  }
}
```

### Task 2：实现凭据文件

文件：`credentials/OpenGaussDataVec.credentials.ts`

字段：Host、Port（默认 5432）、Database、User（默认 gaussdb）、Password、SSL

使用 `pg` npm 包建立连接（openGauss 兼容 PostgreSQL 协议）。

### Task 3：实现向量存储核心逻辑

文件：`nodes/VectorStoreOpenGauss/datavecClient.ts`

自行实现 SQL 操作（不依赖 LangChain PGVectorStore），使用 DataVec 原生语法：

- **建表**：`CREATE TABLE ... (embedding vector(N))`（无需 CREATE EXTENSION）
- **建索引**：支持 HNSW / IVFFLAT / DISKANN，使用 `vector_cosine_ops` 等操作符
- **插入**：`INSERT INTO ... VALUES ('[x,y,z]')`
- **相似度搜索**：使用 `<->` / `<=>` / `<#>` / `<+>` 操作符
- **查询参数**：使用 `SET hnsw_ef_search` / `SET ivfflat_probes`（注意与 pgvector 的语法差异）

### Task 4：实现节点定义

文件：`nodes/VectorStoreOpenGauss/VectorStoreOpenGauss.node.ts`

支持的操作：
- **Vector Search**：相似度搜索（支持 L2 / 余弦 / 内积 / 曼哈顿四种距离）
- **Insert Documents**：插入文档和向量
- **Create Index**：创建向量索引（HNSW / IVFFLAT / DISKANN）
- **Execute Query**：执行自定义 SQL

可选：如果希望与 n8n LangChain 生态集成（作为 AI Agent 的工具节点），可参考 `createVectorStoreNode` 工厂函数的模式，实现 `retrieve` 和 `retrieve-as-tool` 操作模式。

### Task 5：测试和发布

- 编写单元测试
- 本地 `npm run dev` 测试
- 配置 GitHub Actions 发布工作流（2026 年起社区节点要求使用 `npm publish --provenance`）
- 发布到 npm

---

## 项目目录结构

```
n8n-nodes-opengauss-datavec/
├── credentials/
│   └── OpenGaussDataVec.credentials.ts
├── nodes/
│   └── VectorStoreOpenGauss/
│       ├── VectorStoreOpenGauss.node.ts
│       ├── VectorStoreOpenGauss.node.json
│       ├── datavecClient.ts
│       └── opengauss.svg
├── .github/workflows/
│   └── publish.yml
├── package.json
├── tsconfig.json
└── README.md
```

## 预估工作量

| 任务 | 时间 |
|------|------|
| 项目初始化 + 凭据 | 0.5 天 |
| 向量存储核心逻辑 | 1-2 天 |
| 节点 UI 定义 | 0.5 天 |
| 测试 + 发布配置 | 0.5-1 天 |
| **总计** | **2.5-4 天** |
