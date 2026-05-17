# 基于 openGauss DataVec 搭建简单 RAG 工作流（n8n 快速上手）

本文档记录在 n8n 中使用本社区节点 `n8n-nodes-opengauss-datavec` 搭建最小 RAG（入库 + 问答）工作流的完整步骤。

## 1. 总览

共 3 条独立工作流，通过共享同一张表 `kb_docs` 串联：

| 序号 | 工作流 | 触发方式 | 频率 |
|------|--------|----------|------|
| 1 | `init-kb-table` | Manual Trigger | 仅运行一次（部署时） |
| 2 | `rag-ingest` | Manual / Schedule / Webhook | 有新文档时 |
| 3 | `rag-ask` | Webhook | 每次用户提问 |

**关系**：工作流之间不直接连接，靠数据库共享数据。`rag-ingest` 写完表后，`rag-ask` 下次查询自然读到新数据。

```
[1] init-kb-table  ── 一次性建表
        │
        ├──→ [2] rag-ingest ── 写入 kb_docs
        │
        └──→ [3] rag-ask    ── 读取 kb_docs，调用 LLM 返回答案
```

---

## 2. 准备工作

1. 打开 n8n：`http://localhost:5678`
2. 配置两个凭据：
   - **OpenGauss DataVec**：Host=`localhost`，Port=`5432`，Database=`postgres`，User=`gaussdb`，Password=`openGauss@123`，建好后点 **Test** 验证连通性
   - **OpenAI**：粘贴 API Key
3. 确认 openGauss 7.0+ 已启动且支持 DataVec

---

## 3. 工作流 1：`init-kb-table`（一次性建表）

**节点链**：Manual Trigger → OpenGauss DataVec

**OpenGauss DataVec 节点配置**：
- Credential：OpenGauss DataVec
- Operation：`Execute Query`
- Query：

```sql
CREATE TABLE IF NOT EXISTS kb_docs (
  id SERIAL PRIMARY KEY,
  content TEXT NOT NULL,
  embedding vector(1536) NOT NULL,
  metadata JSONB
);

CREATE INDEX IF NOT EXISTS kb_docs_hnsw
  ON kb_docs USING hnsw (embedding vector_cosine_ops);
```

> **维度说明**：按 embedding 模型的输出维度修改 `vector(N)`：
> - OpenAI `text-embedding-3-small` → 1536
> - OpenAI `text-embedding-3-large` → 3072
> - BGE-base → 768

**操作**：点击节点右上角 ▶️ Execute Node，看到绿色 ✓ 即建表成功。这条工作流跑完即可关闭，无需再动。

---

## 4. 工作流 2：`rag-ingest`（入库）

**节点链**：Manual Trigger → Edit Fields (Set) → Embeddings OpenAI → OpenGauss DataVec

### 节点配置

#### 节点 1：Manual Trigger
无需配置。

#### 节点 2：Edit Fields (Set)
- Mode：Manual Mapping
- 添加字段：
  - Name：`content`
  - Value：`openGauss DataVec 支持 HNSW、IVFFLAT、DISKANN 三种向量索引`
- 多条记录可继续 **Add Field**，或改用 **Code** 节点输出数组

#### 节点 3：Embeddings OpenAI
- Credential：OpenAI
- Model：`text-embedding-3-small`
- Input：`={{ $json.content }}`

#### 节点 4：OpenGauss DataVec
- Credential：OpenGauss DataVec
- Operation：`Insert Documents`
- Table Name：`kb_docs`
- Documents（点 **Add Document**）：
  - Content：`={{ $json.content }}`
  - Embedding：`={{ $json.embedding }}`
  - Metadata：留空或 `={{ {} }}`

**操作**：点顶部 **Execute Workflow**，节点全绿即入库成功。

---

## 5. 工作流 3：`rag-ask`（问答）

**节点链**：Webhook → Embeddings OpenAI → OpenGauss DataVec → Code → OpenAI Chat → Respond to Webhook

### 节点配置

#### 节点 1：Webhook
- HTTP Method：`POST`
- Path：`ask`
- Respond：`Using Respond to Webhook Node`

#### 节点 2：Embeddings OpenAI
- Credential：OpenAI
- Model：`text-embedding-3-small`
- Input：`={{ $json.body.question }}`

#### 节点 3：OpenGauss DataVec
- Credential：OpenGauss DataVec
- Operation：`Vector Search`
- Table Name：`kb_docs`
- Query Vector：`={{ $json.embedding }}`
- Limit：`5`
- Distance Strategy：`Cosine`

#### 节点 4：Code（拼 context）
- Mode：**Run Once for All Items**
- 代码：

```javascript
const ctx = items.map(i => i.json.content).join('\n---\n');
return [{ json: { context: ctx } }];
```

#### 节点 5：OpenAI Chat（Message a Model）
- Credential：OpenAI
- Model：`gpt-4o-mini`
- Messages：
  - **System**：`你是知识库助手，只根据提供的资料回答，不知道就说不知道`
  - **User**：

```
资料:
{{ $json.context }}

问题: {{ $('Webhook').item.json.body.question }}
```

#### 节点 6：Respond to Webhook
- Response Body：`={{ $json.message.content }}`

---

## 6. 启用与测试

1. 在 `init-kb-table` 中执行一次（部署时一次性操作）
2. 在 `rag-ingest` 中填入文本，点 **Execute Workflow** 入库
3. 将 `rag-ask` 工作流右上角切换到 **Active**
4. 终端测试：

```bash
curl -X POST http://localhost:5678/webhook/ask \
  -H "Content-Type: application/json" \
  -d '{"question":"openGauss DataVec 支持哪些索引？"}'
```

返回内容应为 LLM 基于已入库知识给出的中文回答。

---

## 7. 简化建议

如果不希望维护 3 条工作流，可将 `init-kb-table` 合并进 `rag-ingest`：在 `rag-ingest` 链路最前面加一个 OpenGauss DataVec 的 Execute Query 节点，执行 `CREATE TABLE IF NOT EXISTS ...`（幂等，每次跑都安全）。

合并后只剩 2 条工作流：
- `rag-ingest`：建表 + 入库
- `rag-ask`：问答

---

## 8. 常见排错

| 现象 | 排查 |
|------|------|
| 节点连不上 openGauss | 凭据 **Test** 是否通过；检查 Host/Port/账号密码 |
| Embeddings 节点报错 | 检查 OpenAI Key 余额、网络代理 |
| Vector Search 返回空 | 先回 `rag-ingest` 入库再查；确认查询的 `tableName` 一致 |
| 维度报错 `expected N dimensions, got M` | embedding 模型维度与表 `vector(N)` 不一致，对齐建表语句 |
| Webhook 触发 404 | 工作流未切到 **Active**；URL 用 Production URL 不是 Test URL |
| `type "vector" does not exist` | openGauss 版本不支持 DataVec，升级到 7.0+ |

---

## 9. 后续可扩展方向（按需）

- **多租户**：在 `kb_docs` 加 `tenant_id` 字段，Vector Search 用 `metadataFilter` 过滤
- **去重**：入库前用 `content_hash` 查询是否已存在
- **Rerank**：在 Vector Search 后接 BGE/Cohere 重排
- **缓存**：在 `rag-ask` 入口加 Redis 节点缓存高频问题
- **审计**：每次入库/查询写入 `kb_operations_log` 表，便于排查

更详细的功能验证请参考 [INTEGRATION_TEST_GUIDE.md](./INTEGRATION_TEST_GUIDE.md)。
