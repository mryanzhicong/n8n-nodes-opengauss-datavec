# openGauss DataVec 社区节点 — 本地集成测试指南

## 1. 概述

### 1.1 文档目的

本文档为 `n8n-nodes-opengauss-datavec` 社区节点包提供一份完整的本地集成测试指南。用户可按照本文档逐步操作，验证节点在真实 openGauss DataVec 环境中的所有功能是否正常工作。

### 1.2 测试范围

本文档覆盖以下 4 种节点操作：

| 操作 | 说明 |
|------|------|
| `vectorSearch` | 向量相似度搜索（支持 L2、Cosine、Inner Product、Manhattan 距离） |
| `insertDocuments` | 批量插入向量文档（含内容、嵌入向量、元数据） |
| `createIndex` | 创建向量索引（HNSW / IVFFLAT / DISKANN） |
| `executeQuery` | 执行自定义 SQL 查询 |

---

## 2. 测试环境要求

| 组件 | 要求 |
|------|------|
| openGauss | 7.0+ 版本，需支持 DataVec 向量引擎 |
| Node.js | >= 24 |
| pnpm | >= 10.22.0 |
| n8n | 本地开发环境（monorepo 形式，位于 `/root/n8n`） |
| 网络 | 测试机器能连接 openGauss 数据库实例 |

---

## 3. 环境搭建步骤

### 3.1 openGauss 数据库准备

#### 关于 DataVec 扩展

openGauss DataVec 是 openGauss 内核级特性，**无需执行 `CREATE EXTENSION`**。只要使用的 openGauss 版本支持 DataVec（7.0+），向量类型 `vector` 及相关索引类型即开箱可用。

#### 确认 DataVec 可用

连接数据库后执行以下 SQL 验证：

```sql
-- 验证 vector 类型存在
SELECT typname FROM pg_type WHERE typname = 'vector';

-- 验证向量操作符可用
SELECT '[1,2,3]'::vector <-> '[4,5,6]'::vector AS l2_distance;
```

如果以上语句成功执行，说明 DataVec 已启用。

#### 连接信息

确保准备好以下连接参数（后续步骤中会用到）：

| 参数 | 示例值 | 说明 |
|------|--------|------|
| Host | `localhost` | 数据库主机地址 |
| Port | `5432` | 数据库端口 |
| Database | `postgres` | 数据库名 |
| User | `gaussdb` | 数据库用户 |
| Password | `openGauss@123` | 数据库密码 |

### 3.2 编译社区节点包

```bash
# 进入社区节点包目录
cd /root/n8n/n8n-nodes-opengauss-datavec

# 安装依赖
pnpm install

# 编译 TypeScript
pnpm build
```

#### 验证编译产物

```bash
# 检查 dist 目录结构
ls -la dist/nodes/VectorStoreOpenGauss/
ls -la dist/credentials/
```

预期产物：
- `dist/nodes/VectorStoreOpenGauss/VectorStoreOpenGauss.node.js`
- `dist/nodes/VectorStoreOpenGauss/datavecClient.js`
- `dist/credentials/OpenGaussDataVec.credentials.js`

#### 复制 SVG 图标到 dist

```bash
cp nodes/VectorStoreOpenGauss/opengauss.svg dist/nodes/VectorStoreOpenGauss/
```

> **注意**：TypeScript 编译不会复制 `.svg` 文件，需手动复制，否则 n8n 加载节点时会报图标缺失警告。

### 3.3 安装社区节点到本地 n8n

使用 `N8N_CUSTOM_EXTENSIONS` 环境变量将社区节点加载到本地 n8n 开发环境：

```bash
cd /root/n8n
export N8N_CUSTOM_EXTENSIONS="/root/n8n/n8n-nodes-opengauss-datavec"
pnpm dev
```

**原理说明**：
- n8n 启动时会读取 `N8N_CUSTOM_EXTENSIONS` 环境变量指定的目录
- 从该目录下的 `package.json` 中读取 `n8n` 字段，获取节点和凭据的注册路径
- `package.json` 中的 `n8n` 字段如下：
  ```json
  {
    "n8n": {
      "n8nNodesApiVersion": 1,
      "credentials": ["dist/credentials/OpenGaussDataVec.credentials.js"],
      "nodes": ["dist/nodes/VectorStoreOpenGauss/VectorStoreOpenGauss.node.js"]
    }
  }
  ```
- 启动后访问：**http://localhost:5678**

### 3.4 验证节点加载

1. 打开浏览器，访问 `http://localhost:5678`
2. 创建一个新工作流
3. 点击 `+` 添加节点，搜索 **"OpenGauss"** 或 **"DataVec"**
4. 确认 **"OpenGauss DataVec"** 节点出现在搜索结果中
5. 将节点拖入画布，点击节点打开设置面板
6. 确认 **Credentials** 下拉可选择 **"OpenGauss DataVec"** 凭据类型

如果节点未出现，请参考 [第 9 节 故障排查](#9-故障排查)。

---

## 4. 配置凭据

### 4.1 在 n8n UI 中创建凭据

1. 点击节点设置面板中的 **Credential** 下拉 → **Create New**
2. 填写以下字段：

| 字段 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| Host | string | `localhost` | openGauss 数据库主机地址 |
| Port | number | `5432` | openGauss 数据库端口 |
| Database | string | （无） | 数据库名称，如 `postgres` |
| User | string | `gaussdb` | 数据库用户名 |
| Password | string | （无） | 数据库密码 |
| SSL | options | `Disable` | SSL 模式：Disable / Allow / Require |
| Max Connections | number | `10` | 连接池最大连接数 |

### 4.2 测试连接

填写凭据后，点击 **Test** 按钮。节点会执行 `SELECT 1` 验证连接。

- ✅ 成功：显示 "Connection successful!"
- ❌ 失败：显示错误消息（如连接超时、认证失败等）

---

## 5. 测试用例

> **约定**：以下测试使用 3 维向量（维度 = 3）作为示例，实际生产中通常使用 768 或 1536 维。

### 测试用例 1：创建向量表（executeQuery）

**目的**：验证通过自定义 SQL 创建向量表

**操作配置**：
- Operation: `Execute Query`
- Query:

```sql
CREATE TABLE IF NOT EXISTS test_vectors (
  id SERIAL PRIMARY KEY,
  content TEXT NOT NULL,
  embedding vector(3) NOT NULL,
  metadata JSONB,
  created_at TIMESTAMP DEFAULT NOW()
);
```

**预期结果**：
- 执行成功，返回空结果集（DDL 语句无返回行）
- 可通过后续查询验证表存在

**验证 SQL**（可在另一个 executeQuery 节点中执行）：

```sql
SELECT table_name FROM information_schema.tables WHERE table_name = 'test_vectors';
```

---

### 测试用例 2：插入向量文档（insertDocuments）

**目的**：验证批量插入向量文档功能

**操作配置**：
- Operation: `Insert Documents`
- Table Name: `test_vectors`
- Options → Create Table If Not Exists: `true`
- Options → Dimensions: `3`

**文档数据**（在 Documents 区域添加以下 5 条记录）：

| # | Content | Embedding | Metadata |
|---|---------|-----------|----------|
| 1 | `人工智能基础教程` | `[0.1, 0.2, 0.3]` | `{"category": "tech", "source": "textbook"}` |
| 2 | `深度学习与神经网络` | `[0.15, 0.25, 0.35]` | `{"category": "tech", "source": "paper"}` |
| 3 | `数据库系统原理` | `[0.4, 0.5, 0.6]` | `{"category": "tech", "source": "textbook"}` |
| 4 | `春天的故事` | `[0.8, 0.1, 0.1]` | `{"category": "literature", "source": "novel"}` |
| 5 | `经济学原理入门` | `[0.6, 0.7, 0.2]` | `{"category": "economics", "source": "textbook"}` |

**预期结果**：
- 返回 JSON：`{"insertedCount": 5, "tableName": "test_vectors"}`
- 如果测试用例 1 中已创建表，此处 `createTableIfNotExists` 会跳过建表（IF NOT EXISTS 语义）

---

### 测试用例 3：创建 HNSW 索引（createIndex）

**目的**：验证 HNSW 索引创建

**操作配置**：
- Operation: `Create Index`
- Table Name: `test_vectors`
- Index Type: `HNSW`
- Distance Strategy: `Cosine`
- Options → Index Name: `test_vectors_hnsw_cosine_idx`
- Options → M: `16`
- Options → EF Construction: `64`

**预期结果**：
```json
{
  "success": true,
  "tableName": "test_vectors",
  "indexType": "hnsw",
  "distanceStrategy": "cosine",
  "indexName": "test_vectors_hnsw_cosine_idx"
}
```

**验证**（通过 executeQuery 执行）：

```sql
SELECT indexname FROM pg_indexes WHERE tablename = 'test_vectors';
```

---

### 测试用例 4：创建 IVFFLAT 索引（createIndex）

**目的**：验证 IVFFLAT 索引创建

> **前置条件**：先删除已有索引（同一列不能有两个同类型索引），或使用不同的索引名。

**操作配置**：
- Operation: `Create Index`
- Table Name: `test_vectors`
- Index Type: `IVFFLAT`
- Distance Strategy: `L2`
- Options → Index Name: `test_vectors_ivfflat_l2_idx`
- Options → Lists: `100`

**预期结果**：
```json
{
  "success": true,
  "tableName": "test_vectors",
  "indexType": "ivfflat",
  "distanceStrategy": "l2",
  "indexName": "test_vectors_ivfflat_l2_idx"
}
```

> **注意**：如果表中数据量少于 lists 值，openGauss 可能会警告但仍创建成功。生产环境建议 `lists` 值不超过总行数的平方根。

---

### 测试用例 5：向量相似度搜索 — L2 距离（vectorSearch）

**目的**：验证 L2（欧几里得）距离搜索

**操作配置**：
- Operation: `Vector Search`
- Table Name: `test_vectors`
- Query Vector: `[0.1, 0.2, 0.3]`
- Limit: `3`
- Distance Strategy: `L2`

**预期结果**：
- 返回 3 条结果
- 结果按 L2 距离从小到大排列
- 第一条应为"人工智能基础教程"（向量完全匹配，距离 = 0）
- 第二条应为"深度学习与神经网络"（向量 `[0.15, 0.25, 0.35]` 最近）

返回示例：
```json
[
  {"id": 1, "content": "人工智能基础教程", "metadata": {"category": "tech", "source": "textbook"}, "distance": 0},
  {"id": 2, "content": "深度学习与神经网络", "metadata": {"category": "tech", "source": "paper"}, "distance": 0.0866...},
  {"id": 3, "content": "数据库系统原理", "metadata": {"category": "tech", "source": "textbook"}, "distance": 0.5196...}
]
```

---

### 测试用例 6：向量相似度搜索 — 余弦距离（vectorSearch）

**目的**：验证 Cosine 距离搜索

**操作配置**：
- Operation: `Vector Search`
- Table Name: `test_vectors`
- Query Vector: `[0.1, 0.2, 0.3]`
- Limit: `3`
- Distance Strategy: `Cosine`

**预期结果**：
- 返回 3 条结果
- 结果按余弦距离从小到大排列（余弦距离 = 1 - 余弦相似度）
- 第一条应为"人工智能基础教程"（方向完全一致，距离 ≈ 0）
- "深度学习与神经网络"与查询向量方向非常接近，排名靠前

---

### 测试用例 7：向量搜索 + Metadata 过滤（vectorSearch）

**目的**：验证 metadata 过滤功能

**操作配置**：
- Operation: `Vector Search`
- Table Name: `test_vectors`
- Query Vector: `[0.3, 0.4, 0.5]`
- Limit: `10`
- Distance Strategy: `Cosine`
- Options → Metadata Filter: `{"category": "tech"}`

**预期结果**：
- 只返回 `metadata.category == "tech"` 的文档
- 应返回 3 条结果：
  - "人工智能基础教程"
  - "深度学习与神经网络"
  - "数据库系统原理"
- 不会返回"春天的故事"（category=literature）和"经济学原理入门"（category=economics）

---

### 测试用例 8：向量搜索 + 最小分数过滤（vectorSearch）

**目的**：验证通过距离阈值过滤结果

> **说明**：当前节点实现中，距离值直接返回给用户，用户可通过 Limit + 后续节点（如 IF 节点）进行 minScore 过滤。本测试验证距离值的正确性，以便用户自行设置阈值。

**操作配置**：
- Operation: `Vector Search`
- Table Name: `test_vectors`
- Query Vector: `[0.1, 0.2, 0.3]`
- Limit: `10`
- Distance Strategy: `L2`

**预期结果**：
- 返回所有 5 条结果，按距离排序
- 用户可观察距离值，设定阈值（如仅保留 distance < 0.5 的结果）
- 第一条距离为 0（精确匹配）
- 最后一条距离最大（最不相似）

**工作流中实现 minScore 过滤的方法**：
在 vectorSearch 节点之后接一个 **IF** 节点，条件设为 `{{ $json.distance < 0.5 }}`

---

### 测试用例 9：自定义查询（executeQuery）

**目的**：验证自定义 SQL 查询功能

**操作配置**：
- Operation: `Execute Query`
- Query:

```sql
SELECT id, content, metadata FROM test_vectors ORDER BY id LIMIT 5;
```

**预期结果**：
- 返回最多 5 条记录
- 每条记录包含 `id`、`content`、`metadata` 字段
- 数据与之前插入的文档一致

**进阶查询 — 聚合统计**：

```sql
SELECT
  metadata->>'category' AS category,
  COUNT(*) AS doc_count
FROM test_vectors
WHERE jsonb_typeof(metadata) = 'object'
GROUP BY metadata->>'category'
ORDER BY doc_count DESC;
```

预期返回：
| category | doc_count |
|----------|-----------|
| tech | 3 |
| literature | 1 |
| economics | 1 |

---

### 测试用例 10：DataVec 特有参数验证（vectorSearch）

**目的**：验证 DataVec 特有的搜索参数设置（区别于 pgvector）

**关键验证点**：

| 特性 | DataVec 语法 | pgvector 语法（对比） |
|------|-------------|---------------------|
| HNSW 搜索参数 | `SET hnsw_ef_search = 100` | `SET hnsw.ef_search = 100` |
| IVFFLAT 搜索参数 | `SET ivfflat_probes = 10` | `SET ivfflat.probes = 10` |

#### 测试 10a：HNSW efSearch 参数

**操作配置**：
- Operation: `Vector Search`
- Table Name: `test_vectors`
- Query Vector: `[0.1, 0.2, 0.3]`
- Limit: `3`
- Distance Strategy: `Cosine`
- Options → EF Search: `100`

**预期结果**：
- 搜索成功完成，无 SQL 语法错误
- 返回正确的搜索结果
- 如果使用 pgvector 语法（`hnsw.ef_search`）会报错，说明节点正确使用了 DataVec 语法

#### 测试 10b：IVFFLAT probes 参数

**操作配置**：
- Operation: `Vector Search`
- Table Name: `test_vectors`
- Query Vector: `[0.4, 0.5, 0.6]`
- Limit: `5`
- Distance Strategy: `L2`
- Options → Probes: `10`

**预期结果**：
- 搜索成功完成，无 SQL 语法错误
- 返回正确的搜索结果

---

### 测试用例 11：错误处理 — 连接失败

**目的**：验证连接错误时的友好提示

**步骤**：
1. 创建一个新的 OpenGauss DataVec 凭据
2. 填写错误的连接信息：
   - Host: `invalid-host-12345.example.com`
   - Port: `9999`
   - Database: `nonexistent_db`
   - User: `wrong_user`
   - Password: `wrong_password`
3. 点击 **Test** 按钮

**预期结果**：
- 显示 `Error` 状态
- 错误消息包含有意义的信息，如：
  - `getaddrinfo ENOTFOUND invalid-host-12345.example.com`（主机不可达）
  - `connect ECONNREFUSED`（端口拒绝连接）
  - `password authentication failed`（认证失败）

---

### 测试用例 12：错误处理 — 表不存在

**目的**：验证对不存在表的操作时返回有意义的错误信息

**操作配置**：
- Operation: `Vector Search`
- Table Name: `nonexistent_table_xyz`
- Query Vector: `[0.1, 0.2, 0.3]`
- Limit: `5`
- Distance Strategy: `Cosine`

**预期结果**：
- 节点执行失败
- 错误消息包含类似 `relation "nonexistent_table_xyz" does not exist` 的提示
- 如果节点设置了 "Continue On Fail"，则返回包含 `error` 字段的 JSON

---

### 测试用例 13：完整工作流测试

**目的**：模拟真实场景，在一个工作流中串联多个操作

**工作流结构**：

```
Manual Trigger → OpenGauss DataVec (executeQuery: CREATE TABLE)
             → OpenGauss DataVec (insertDocuments)
             → OpenGauss DataVec (createIndex)
             → OpenGauss DataVec (vectorSearch)
```

**步骤**：

1. **创建工作流**：在 n8n 中新建工作流

2. **节点 1 — Manual Trigger**：
   - 无需配置，作为起始触发器

3. **节点 2 — OpenGauss DataVec (创建表)**：
   - Operation: `Execute Query`
   - Query:
   ```sql
   DROP TABLE IF EXISTS workflow_test_vectors;
   CREATE TABLE workflow_test_vectors (
     id SERIAL PRIMARY KEY,
     content TEXT NOT NULL,
     embedding vector(3) NOT NULL,
     metadata JSONB,
     created_at TIMESTAMP DEFAULT NOW()
   );
   ```

4. **节点 3 — OpenGauss DataVec (插入文档)**：
   - Operation: `Insert Documents`
   - Table Name: `workflow_test_vectors`
   - Options → Create Table If Not Exists: `false`（表已存在）
   - Documents:
     - Document 1: Content=`n8n工作流引擎`, Embedding=`[0.2, 0.3, 0.5]`, Metadata=`{"type": "product"}`
     - Document 2: Content=`openGauss数据库`, Embedding=`[0.3, 0.4, 0.6]`, Metadata=`{"type": "product"}`
     - Document 3: Content=`向量搜索技术`, Embedding=`[0.25, 0.35, 0.55]`, Metadata=`{"type": "technology"}`

5. **节点 4 — OpenGauss DataVec (创建索引)**：
   - Operation: `Create Index`
   - Table Name: `workflow_test_vectors`
   - Index Type: `HNSW`
   - Distance Strategy: `Cosine`
   - Options → M: `16`, EF Construction: `64`

6. **节点 5 — OpenGauss DataVec (向量搜索)**：
   - Operation: `Vector Search`
   - Table Name: `workflow_test_vectors`
   - Query Vector: `[0.2, 0.3, 0.5]`
   - Limit: `3`
   - Distance Strategy: `Cosine`

**预期结果**：
- 整个工作流执行成功（所有节点为绿色 ✓）
- 最终搜索结果返回之前插入的文档
- 第一条结果应为 "n8n工作流引擎"（向量精确匹配）
- 返回示例：
```json
[
  {"id": 1, "content": "n8n工作流引擎", "metadata": {"type": "product"}, "distance": 0},
  {"id": 3, "content": "向量搜索技术", "metadata": {"type": "technology"}, "distance": 0.00127...},
  {"id": 2, "content": "openGauss数据库", "metadata": {"type": "product"}, "distance": 0.00256...}
]
```

---

## 6. 测试覆盖矩阵

| 测试用例 | 操作类型 | 参数组合 | 预期结果 |
|---------|----------|---------|---------|
| 1 | executeQuery | CREATE TABLE SQL | 表创建成功 |
| 2 | insertDocuments | 5 条文档，含 metadata | insertedCount=5 |
| 3 | createIndex | HNSW + Cosine + m=16 + ef=64 | 索引创建成功 |
| 4 | createIndex | IVFFLAT + L2 + lists=100 | 索引创建成功 |
| 5 | vectorSearch | L2 距离 + limit=3 | 按距离升序返回结果 |
| 6 | vectorSearch | Cosine 距离 + limit=3 | 按余弦距离升序返回结果 |
| 7 | vectorSearch | Cosine + metadataFilter | 只返回匹配 metadata 的文档 |
| 8 | vectorSearch | L2 + limit=10（距离阈值验证） | 距离值正确，可用于后续过滤 |
| 9 | executeQuery | SELECT + GROUP BY | 正确返回查询结果 |
| 10a | vectorSearch | Cosine + efSearch=100 | HNSW 搜索参数生效 |
| 10b | vectorSearch | L2 + probes=10 | IVFFLAT 搜索参数生效 |
| 11 | 凭据测试 | 错误连接信息 | 返回清晰错误消息 |
| 12 | vectorSearch | 不存在的表名 | 返回表不存在错误 |
| 13 | 完整工作流 | 全部 4 种操作串联 | 工作流完整执行成功 |

---

## 7. DataVec vs pgvector 差异验证要点

openGauss DataVec 是 openGauss 数据库原生的向量引擎，与 PostgreSQL 的 pgvector 扩展在语法上有以下关键差异：

| 差异项 | DataVec (openGauss) | pgvector (PostgreSQL) |
|--------|--------------------|-----------------------|
| 启用方式 | 内核特性，无需操作 | 需 `CREATE EXTENSION vector` |
| HNSW 搜索参数 | `SET hnsw_ef_search = N` | `SET hnsw.ef_search = N` |
| IVFFLAT 搜索参数 | `SET ivfflat_probes = N` | `SET ivfflat.probes = N` |
| DISKANN 索引 | ✅ 支持 | ❌ 不支持 |
| Manhattan 距离操作符 | `<+>` | `<+>`（pgvector 0.7+） |
| 向量类型声明 | `vector(N)` | `vector(N)` |
| 距离操作符 | `<->` (L2), `<=>` (Cosine), `<#>` (IP), `<+>` (Manhattan) | 相同 |

### 验证方法

1. **SET 参数语法验证**：
   - 在 vectorSearch 中设置 efSearch 参数（测试用例 10a），执行成功说明使用了 `SET hnsw_ef_search` 语法
   - 如果错误使用 `SET hnsw.ef_search`，openGauss 会报 `unrecognized configuration parameter` 错误

2. **无需 CREATE EXTENSION 验证**：
   - 测试用例 1 中直接创建包含 `vector(3)` 列的表，无需事先执行 `CREATE EXTENSION`
   - 如果需要 extension 但未创建，会报 `type "vector" does not exist` 错误

3. **DISKANN 索引验证**（可选）：
   ```sql
   -- 通过 executeQuery 执行
   CREATE INDEX test_diskann_idx ON test_vectors USING diskann (embedding vector_cosine_ops);
   ```
   - 成功：说明 DataVec 支持 DISKANN
   - 失败报 `access method "diskann" does not exist`：说明 openGauss 版本不支持

---

## 8. 已知限制和注意事项

### 8.1 openGauss DataVec 特有约束

- **向量维度上限**：openGauss DataVec 向量维度通常支持最大 16000 维（具体取决于版本）
- **不支持稀疏向量**：仅支持稠密向量类型 `vector(N)`
- **索引列唯一性**：同一列上不能创建两个相同类型的索引（如两个 HNSW 索引）
- **IVFFLAT lists 限制**：`lists` 值不应超过表中总行数，否则可能影响性能

### 8.2 不支持的功能

- 不支持跨表联合向量搜索
- 不支持向量字段的 UPDATE（需删除后重新插入）
- 当前节点版本不支持 DISKANN 索引的自定义参数配置

### 8.3 性能注意事项

- **小数据量无需建索引**：少于 1000 条记录时，全表扫描可能比索引更快
- **HNSW vs IVFFLAT 选择**：
  - HNSW：查询性能更好，但构建速度慢、内存占用大
  - IVFFLAT：构建速度快，但查询需要更多 probes 才能保证精度
- **连接池**：生产环境建议 `maxConnections` 设为 20-50，测试时 10 即可
- **批量插入**：`insertDocuments` 使用事务批量插入，单批建议不超过 1000 条

---

## 9. 故障排查

### 9.1 节点未出现在 n8n 中

| 可能原因 | 排查方法 |
|---------|---------|
| 未设置 N8N_CUSTOM_EXTENSIONS | 检查 `echo $N8N_CUSTOM_EXTENSIONS` 是否指向正确路径 |
| dist 目录不存在 | 运行 `ls /root/n8n/n8n-nodes-opengauss-datavec/dist/` |
| 编译失败 | 重新运行 `pnpm build`，检查 TypeScript 错误 |
| SVG 图标缺失 | 运行 `cp nodes/VectorStoreOpenGauss/opengauss.svg dist/nodes/VectorStoreOpenGauss/` |
| n8n 缓存 | 重启 n8n 开发服务器 |
| package.json n8n 字段路径错误 | 检查 `n8n.nodes` 和 `n8n.credentials` 路径是否指向 dist/ 下的 .js 文件 |

**调试命令**：

```bash
# 验证编译产物
node -e "const n = require('/root/n8n/n8n-nodes-opengauss-datavec/dist/nodes/VectorStoreOpenGauss/VectorStoreOpenGauss.node.js'); console.log(Object.keys(n));"

# 预期输出：[ 'VectorStoreOpenGauss' ]
```

### 9.2 连接问题排查

```bash
# 测试网络连通性
nc -zv <host> <port>

# 使用 psql 测试连接（如果可用）
psql -h <host> -p <port> -U <user> -d <database> -c "SELECT 1;"

# 运行自带的集成测试脚本（需先编译）
cd /root/n8n/n8n-nodes-opengauss-datavec
node scripts/integration-test.js
```

### 9.3 编译问题排查

| 错误类型 | 解决方法 |
|---------|---------|
| `Cannot find module 'n8n-workflow'` | 运行 `pnpm install`，确保 peerDependencies 已解析 |
| TypeScript 类型错误 | 确认 `typescript` 版本 >= 5.3，运行 `npx tsc --version` |
| `dist/` 为空 | 删除 dist 目录后重新编译：`rm -rf dist && pnpm build` |

### 9.4 常见错误码说明

| 错误信息 | 原因 | 解决方法 |
|---------|------|---------|
| `relation "xxx" does not exist` | 表名不存在 | 检查表名拼写，确认已创建表 |
| `type "vector" does not exist` | DataVec 未启用 | 确认 openGauss 版本支持 DataVec |
| `invalid input syntax for type vector` | 向量格式错误 | 确认向量为 `[n1, n2, ...]` 格式 |
| `password authentication failed` | 密码错误 | 检查凭据配置 |
| `connection refused` | 端口或主机错误 | 检查 Host 和 Port |
| `column "embedding" does not exist` | 列名不匹配 | 确认表结构包含 `embedding` 列 |
| `index "xxx" already exists` | 索引已存在 | 使用不同索引名，或先删除已有索引 |
| `unrecognized configuration parameter "hnsw.ef_search"` | 使用了 pgvector 语法 | DataVec 应使用 `hnsw_ef_search`（无点号） |

---

## 10. 清理

### 10.1 删除测试数据

在 n8n 中使用 `Execute Query` 操作执行：

```sql
-- 删除测试表（包含索引会一并删除）
DROP TABLE IF EXISTS test_vectors;
DROP TABLE IF EXISTS workflow_test_vectors;
```

或通过命令行：

```bash
cd /root/n8n/n8n-nodes-opengauss-datavec
node -e "
const { DataVecClient } = require('./dist/nodes/VectorStoreOpenGauss/datavecClient');
const client = new DataVecClient({
  host: 'localhost',
  port: 5432,
  database: 'postgres',
  user: 'gaussdb',
  password: 'openGauss@123'
});
(async () => {
  await client.dropTable('test_vectors');
  await client.dropTable('workflow_test_vectors');
  await client.close();
  console.log('✓ 测试表已清理');
})();
"
```

### 10.2 卸载社区节点

1. 停止 n8n 开发服务器（`Ctrl+C`）
2. 取消环境变量：

```bash
unset N8N_CUSTOM_EXTENSIONS
```

3. 重新启动 n8n：

```bash
cd /root/n8n
pnpm dev
```

验证：重新打开 n8n UI，搜索 "OpenGauss"，确认节点不再出现。

### 10.3 清理编译产物

```bash
cd /root/n8n/n8n-nodes-opengauss-datavec
rm -rf dist/
rm -rf node_modules/
```

---

## 附录：快速验证脚本

如果你希望快速运行自动化集成测试（不通过 n8n UI），可以使用内置的测试脚本：

```bash
cd /root/n8n/n8n-nodes-opengauss-datavec

# 先编译
pnpm build

# 运行集成测试（需要 openGauss 数据库已启动）
node scripts/integration-test.js
```

该脚本会自动执行以下测试：
- 连接测试
- 创建表
- 插入文档（含/不含 metadata）
- 多种距离策略的相似度搜索
- Metadata 过滤搜索
- 自定义 SQL 查询
- HNSW 索引创建与验证
- 表删除与清理

如需修改数据库连接参数，编辑 `scripts/integration-test.js` 文件顶部的 `DB_CONFIG` 对象。
