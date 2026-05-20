# openGauss DataVec Store 节点详解

`openGauss DataVec Store`（内部 name：`openGaussDataVec`）是本节点包面向 AI / LangChain 生态的核心节点，分类挂在 **AI / Vector Stores**，同时通过 codex 出现在 **AI Agent 的 Tools** 槽与 **Vector Store Retriever** 槽。本文针对 4 种 **Mode** 给出场景、参数、连接方式与示例工作流，适合需要把 openGauss DataVec 嵌入 RAG / Agent 工作流的开发者。

> 节点文件：`nodes/VectorStoreOpenGauss/VectorStoreOpenGauss.node.ts`；图标：`opengauss.svg`；凭证：`openGauss DataVec API`。

---

## 1. 节点概览

| 属性 | 值 |
| --- | --- |
| displayName | `openGauss DataVec Store` |
| name | `openGaussDataVec` |
| 分类 | AI / Vector Stores（同时出现在 Tools、Root Nodes） |
| 凭证 | `openGauss DataVec API`（共用） |
| 子标题 | 跟随 Mode 自动切换 |

**Mode** 是切换节点行为的唯一开关，决定输入/输出连接类型与可见参数：

| Mode | value | 输入 | 输出 |
| --- | --- | --- | --- |
| Get Many | `load` | main + ai_embedding | main |
| Insert Documents | `insert` | main + ai_embedding | main |
| Retrieve Documents (As Vector Store) | `retrieve` | ai_embedding | `ai_vectorStore` |
| Retrieve Documents (As Tool for AI Agent) | `retrieve-as-tool` | ai_embedding | `ai_tool` |

---

## 2. 公共参数

下列字段在多个 Mode 下复用：

- **Schema**（默认 `public`）和 **Table**（必填）：向量表的 schema 与表名。Insert 模式首次使用时会按 Dimensions 自动建表；其它模式要求表已存在。
- **Distance Strategy**：`L2` / `Cosine` / `Inner Product` / `Manhattan`，默认 `Cosine`。
- **Top K**：返回数量，默认 `10`。仅 `load` / `retrieve` / `retrieve-as-tool` 可见。
- **Metadata Filter**：JSON 对象字符串，按 metadata 字段过滤。仅 `load` / `retrieve` / `retrieve-as-tool` 可见。
- **Dimensions**：向量维度，仅 `insert` 可见，建表时使用。
- **Prompt**：仅 `load` 可见，用户的搜索 query。
- **Tool Description**：仅 `retrieve-as-tool` 可见，给 AI Agent 的工具说明文本。

---

## 3. 四种模式详解

### 3.1 Get Many（`load`）—— 独立向量召回

**场景**：在数据管道里直接做一次向量检索并返回 Top-K 结果，不挂 LangChain Chain。常见于离线 ETL、相似题去重、人工审核辅助等。

**输入连接**：

- Main（上游 trigger / 数据源）
- ai_embedding（接 Embeddings 模型节点）

**输出**：Main，每条结果一个 item：

```json
{
  "pageContent": "openGauss DataVec 是一个高性能向量扩展...",
  "metadata": { "source": "kb/intro.md", "page": 1 },
  "score": 0.1245
}
```

**必填参数**：Schema（默认 `public`）、Table、Prompt、Top K。可选：Distance Strategy、Metadata Filter。

**示例工作流**：

```
[Manual Trigger] --main--> [openGauss DataVec Store: Get Many] --main--> [Set]
                                      ^
                                      | ai_embedding
                              [Embeddings OpenAI]
```

### 3.2 Insert Documents（`insert`）—— 把文档写入向量表

**场景**：批量灌库。上游 Main 输入的每个 item 都被当作一篇文档，节点提取以下字段（按优先级）：`content` → `text` → `pageContent` → 整 JSON 序列化；`metadata` 字段（如果有）会写入 metadata 列。

**输入连接**：

- Main（文档流，**每个 item = 一篇文档**）
- ai_embedding（生成向量）

**输出**：Main，固定一条汇总：

```json
{ "success": true, "insertedCount": 42, "tableName": "public.demo_vectors" }
```

**必填参数**：Schema（默认 `public`）、Table、Dimensions（首次建表必须）、Distance Strategy。

**示例工作流**：

```
[Read PDF] --main--> [Recursive Text Splitter] --main--> [openGauss DataVec Store: Insert Documents] --main--> [Output]
                                                                ^
                                                                | ai_embedding
                                                       [Embeddings OpenAI]
```

> 维度匹配：Dimensions 必须等于上游 Embeddings 模型实际输出维度（OpenAI `text-embedding-3-small` = 1536；`bge-base-zh-v1.5` = 768）。首次写入决定表结构，后续写入须保持一致。

### 3.3 Retrieve Documents (As Vector Store)（`retrieve`）—— 给 Chain / Retriever 用

**场景**：作为 LangChain 风格的 Vector Store 供下游消费，配合 **Question and Answer Chain**、**Vector Store Retriever**、**Agent (LangChain)** 等使用。

**输入连接**：

- ai_embedding（必须）

**输出**：`ai_vectorStore`，挂到下游 Chain / Retriever 的 Vector Store 槽。

**必填参数**：Schema（默认 `public`）、Table。常用：Distance Strategy、Top K、Metadata Filter。

**示例工作流（RAG 问答）**：

```
[Chat Trigger] --main--> [Question and Answer Chain] --main--> [Response]
                                 ^               ^
                                 | ai_languageModel | ai_vectorStore
                            [Chat Model]      [openGauss DataVec Store: Retrieve (Vector Store)]
                                                       ^
                                                       | ai_embedding
                                                  [Embeddings OpenAI]
```

完整步骤参考 [RAG_QUICKSTART.md](./RAG_QUICKSTART.md)。

### 3.4 Retrieve Documents (As Tool for AI Agent)（`retrieve-as-tool`）—— AI Agent 工具

**场景**：让 AI Agent 把"在 openGauss 向量库里检索"当作一个工具调用。Agent 在推理时会自动决定何时调用，并把召回文本拼接后回填到上下文。

**输入连接**：

- ai_embedding（必须）

**输出**：`ai_tool`，直接挂到 AI Agent 节点的 **Tools** 槽。

**必填参数**：Schema（默认 `public`）、Table、Tool Description（**写清楚什么场景该调用**，Agent 靠这段文本决策）。常用：Top K、Metadata Filter。

**Tool Description 撰写要点**：

- 写清楚知识范围，如：「Search internal openGauss documentation, FAQs and release notes」
- 写清楚输入是什么：自然语言查询
- 避免泛化措辞「Search anything」会降低 Agent 调用质量

**示例工作流**：

```
[Chat Trigger] --main--> [AI Agent] --main--> [Response]
                            ^   ^
                            |   | ai_tool
                            |   [openGauss DataVec Store: Retrieve (Tool)]
                            |          ^
                            |          | ai_embedding
                            |          [Embeddings OpenAI]
                            | ai_languageModel
                       [Chat Model]
```

---

## 4. Distance Strategy 选型建议

| 策略 | 适用 | 说明 |
| --- | --- | --- |
| **Cosine**（默认） | 通用语义检索、归一化 Embedding | 对向量模长不敏感，绝大多数 RAG 首选 |
| **Inner Product** | 已归一化向量、推荐系统 | 与 Cosine 等价但少一次归一化运算 |
| **L2** | 欧式空间聚类、图像特征 | 对模长敏感 |
| **Manhattan** | 稀疏特征、L1 正则场景 | 较少用于文本 Embedding |

**注意**：首次 `Insert Documents` 时选定的索引策略会写入表结构。如需切换策略，建议新建表重新灌库。

---

## 5. Metadata Filter JSON 示例

`Metadata Filter` 是单层 JSON，每个 key 必须等于 metadata 列里的某个字段，多个 key 之间为 AND：

```json
{ "source": "kb/faq.md" }
```

```json
{ "lang": "zh", "category": "billing" }
```

不支持范围 / 模糊 / OR。如需复杂过滤，请改用 **openGauss** 节点的 Execute Query 直接写 SQL（`WHERE metadata->>'lang' = 'zh' AND metadata->>'priority' IN ('p0','p1')`）。

填写非法 JSON 会抛错：`Invalid metadata filter format. Expected a JSON object, e.g. {"key": "value"}`。

---

## 6. 常见问题

### Q1：报错 `vector has X dimensions, expected Y`

灌库 Embedding 维度与表定义不一致。检查：

- Insert 时 `Dimensions` 是否等于 Embeddings 模型输出
- 是否切换了 Embeddings 模型（OpenAI ↔ Ollama 维度差异大）
- 解决：新建表或 `DROP TABLE` 后重新灌库

### Q2：报错 `relation "demo_vectors" does not exist`

Retrieve / Get Many 模式不会自动建表。请先用 Insert Documents 灌一条数据，或用 **openGauss** 节点 Execute Query 手动建表。

### Q3：Embedding 槽报错 `No connection to ai_embedding`

任何 Mode 都必须连 Embeddings 节点。哪怕只是 `retrieve-as-tool` 也不能省略，因为 query 也需要 embed。

### Q4：AI Agent 不调用该工具

- 确认 Mode 是 `Retrieve Documents (As Tool for AI Agent)`，输出是 `ai_tool` 而非 `ai_vectorStore`
- 优化 **Tool Description**，明确说明知识范围
- 把 Agent 的 system prompt 改成鼓励"必要时调用工具检索"
