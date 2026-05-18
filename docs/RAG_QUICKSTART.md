# 5 分钟跑通 RAG（openGauss DataVec + n8n）

本文带你用 **openGauss DataVec Store** 的 `Retrieve Documents (As Vector Store)` 模式，配合 n8n 的 **Question and Answer Chain**，在 5 分钟内搭起一条最小可问答的 RAG 工作流。适合刚装好节点、想立刻看到效果的同学。深入解释见 [VECTOR_STORE_GUIDE.md](./VECTOR_STORE_GUIDE.md)。

---

## 0. 前置准备

1. **n8n** 已运行，本包已安装（见 [USAGE_GUIDE.md §3](./USAGE_GUIDE.md)）
2. **openGauss / DataVec** 实例可达，已创建凭证 `openGauss DataVec API`
3. **Embeddings 节点**：任选其一
   - `Embeddings OpenAI`（需 OpenAI Key，`text-embedding-3-small` 维度 1536）
   - `Embeddings Ollama`（本地 `bge-base-zh` 维度 768，或 `nomic-embed-text` 维度 768）
4. **LLM 节点**：任选其一
   - `OpenAI Chat Model`
   - `Ollama Chat Model`（本地 `qwen2.5:7b` 等）

> 维度铁律：灌库的 Embeddings 与检索的 Embeddings **必须是同一个模型**，否则相似度无意义。

---

## 1. 步骤一：建表（用 SQL 节点）

> 可选步骤。如果你直接跑步骤二的 Insert Documents，节点会按 `Dimensions` 自动建表。提前建表的好处是可以加索引、自定义额外列。

新建工作流，拖 **openGauss** 节点：

- **Operation** = `Execute Query`
- **Query**：

```sql
CREATE TABLE IF NOT EXISTS rag_docs (
  id        SERIAL PRIMARY KEY,
  content   TEXT NOT NULL,
  metadata  JSONB,
  embedding VECTOR(1536)
);
```

> 用 Ollama `bge-base-zh` 时把 `VECTOR(1536)` 改成 `VECTOR(768)`。

点击 **Execute step**，看到 `{ "success": true }` 即建表成功。

---

## 2. 步骤二：灌库（Insert Documents 模式）

在同一工作流再画一段：

```
[Manual Trigger]
   │ main
   ▼
[Set: 准备文档]
   │ main
   ▼
[openGauss DataVec Store: Insert Documents]  ◄── ai_embedding ── [Embeddings OpenAI]
   │ main
   ▼
[NoOp]
```

**Set 节点**（准备 3 篇示例文档，每条 item 一篇）：

```json
[
  { "content": "openGauss 是华为开源的关系型数据库", "metadata": { "source": "intro" } },
  { "content": "DataVec 是 openGauss 的向量扩展", "metadata": { "source": "intro" } },
  { "content": "n8n 是基于节点的自动化工作流平台", "metadata": { "source": "intro" } }
]
```

**openGauss DataVec Store** 节点字段：

- **Mode** = `Insert Documents`
- **Table Name** = `rag_docs`
- **Distance Strategy** = `Cosine`
- **Dimensions** = `1536`（与 Embeddings 模型一致）
- Embedding 槽接 **Embeddings OpenAI**（模型选 `text-embedding-3-small`）

点击 **Execute workflow**。成功后输出：

```json
{ "success": true, "insertedCount": 3, "tableName": "rag_docs" }
```

---

## 3. 步骤三：问答（Retrieve 模式 + Q&A Chain）

新建一个工作流（或在原工作流接一段问答链）：

```
[Chat Trigger]
   │ main
   ▼
[Question and Answer Chain] ◄── ai_languageModel ── [OpenAI Chat Model]
                ▲
                │ ai_vectorStore
                │
[openGauss DataVec Store: Retrieve (As Vector Store)] ◄── ai_embedding ── [Embeddings OpenAI]
```

**openGauss DataVec Store** 字段：

- **Mode** = `Retrieve Documents (As Vector Store)`
- **Table Name** = `rag_docs`
- **Distance Strategy** = `Cosine`
- **Top K** = `3`
- 不要填 Dimensions（仅 Insert 模式需要）
- Embedding 槽接同一个 **Embeddings OpenAI**

**Question and Answer Chain**：默认即可，把 LM 槽接 `OpenAI Chat Model`，VS 槽接上面的向量节点。

**Chat Trigger**：直接打开 Test chat。

试问：

```
什么是 DataVec？
```

期望回答包含「openGauss 的向量扩展」字样。打开 **Question and Answer Chain** 的 *Logs*，可以看到召回了 metadata `source=intro` 的文档片段。

---

## 4. 进阶：把 Retrieve 换成 Agent Tool

把上面工作流的 `Retrieve (As Vector Store)` 改成 `Retrieve Documents (As Tool for AI Agent)`，输出类型从 `ai_vectorStore` 变 `ai_tool`，再把它接到 **AI Agent** 节点的 **Tools** 槽。

- **Tool Description**：`Search openGauss / DataVec / n8n internal knowledge base. Use when the user asks about openGauss features, DataVec capabilities, or n8n usage.`

Agent 会在判断需要时主动调用工具，对长对话与多工具混用更合适。详见 [VECTOR_STORE_GUIDE.md §3.4](./VECTOR_STORE_GUIDE.md)。

---

## 5. 排错清单

| 现象 | 排查 |
| --- | --- |
| 灌库报 `relation does not exist` 还失败 | 检查 Insert Documents 是否填了 **Dimensions** |
| 召回结果不相关 | 确认灌库与召回使用同一 Embeddings 模型；调大 Top K；试 `Cosine` |
| Q&A 回答说不知道 | 看 Q&A Chain Logs：是否召回了相关片段？若否，问题表述与文档差异过大 |
| 报 `vector has X dimensions, expected Y` | 模型换过了 —— `DROP TABLE rag_docs;` 后重灌 |
| Chat Trigger 没反应 | 必须打开 *Test chat* 面板，并且工作流处于 Active 状态（或手动 Execute workflow） |

---

## 6. 下一步

- 把 Manual / Set 换成真实数据源（PDF、网页、Notion、数据库）+ Splitter
- 把灌库工作流改成 Cron 定时增量同步
- 用 **openGauss** 节点 Execute Query 做 metadata 复杂过滤（参考 [SQL_NODE_GUIDE.md](./SQL_NODE_GUIDE.md)）
- 调研索引：在 `embedding` 列上建 HNSW / IVFFLAT 索引提升大库召回速度
