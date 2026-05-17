# 在 n8n 中使用 openGauss DataVec 向量数据库

n8n 是一个开源的工作流自动化平台，借助其节点编排能力可以构建从数据集成到 AI 智能体的各类工作流。本文介绍如何在 n8n 中安装并使用社区节点 `n8n-nodes-opengauss-datavec`，将 openGauss DataVec 作为向量数据库用于向量检索和 RAG 等场景。

---

## 1. 概述

`n8n-nodes-opengauss-datavec` 是一个 n8n 社区节点包，封装了 openGauss DataVec 向量引擎的常用操作，向 n8n 工作流提供以下 4 种能力：

| 操作 | 说明 |
|------|------|
| Vector Search | 基于 L2 / Cosine / Inner Product / Manhattan 距离的相似度搜索 |
| Insert Documents | 批量写入文档（content + embedding + metadata） |
| Create Index | 创建 HNSW / IVFFLAT / DISKANN 向量索引 |
| Execute Query | 执行任意自定义 SQL |

底层通过 `pg` 驱动连接 openGauss，支持连接池与 SSL。

---

## 2. 环境准备

### 2.1 软件版本

| 组件 | 要求 |
|------|------|
| openGauss | 7.0+，内核已启用 DataVec 向量引擎 |
| Node.js | ≥ 22.16 |
| pnpm / npm | pnpm ≥ 10、npm ≥ 9 任选 |
| n8n | 1.x 任意版本（自部署或开发环境） |

### 2.2 验证 openGauss DataVec 可用

DataVec 是 openGauss 内核级特性，**无需** `CREATE EXTENSION`。连接数据库后执行：

```sql
-- 验证 vector 类型
SELECT typname FROM pg_type WHERE typname = 'vector';

-- 验证向量操作符
SELECT '[1,2,3]'::vector <-> '[4,5,6]'::vector AS l2_distance;
```

两条语句都成功返回结果，即说明环境就绪。

---

## 3. 安装节点

### 3.1 方式 A：n8n UI 在线安装（推荐生产环境）

1. n8n 启动后访问 `http://your_server_ip:5678`
2. 进入 **Settings → Community Nodes → Install**
3. 输入包名：`n8n-nodes-opengauss-datavec`
4. 勾选「I understand the risks」并点击 **Install**
5. 安装完成后会自动重启，节点出现在画布的节点选择器中

### 3.2 方式 B：本地开发模式（推荐开发调试）

通过 `N8N_CUSTOM_EXTENSIONS` 环境变量加载本地编译好的节点：

```bash
# 1. 克隆并编译节点包
git clone <repo-url> /opt/n8n-nodes-opengauss-datavec
cd /opt/n8n-nodes-opengauss-datavec
pnpm install
pnpm build

# 2. 启动 n8n 时指向该目录
export N8N_CUSTOM_EXTENSIONS="/opt/n8n-nodes-opengauss-datavec"
n8n start
```

启动日志中能看到 `Loaded community package: n8n-nodes-opengauss-datavec` 即加载成功。

### 3.3 验证节点已加载

1. 浏览器访问 `http://your_server_ip:5678`
2. 新建工作流，点击画布中央的 **+** 按钮
3. 搜索 **OpenGauss** 或 **DataVec**
4. 出现 **OpenGauss DataVec** 节点即安装成功

---

## 4. 配置凭据

凭据用于建立到 openGauss 的连接，所有节点共享。

### 4.1 创建凭据

1. 左侧菜单 → **Credentials → Add Credential**
2. 搜索并选择 **OpenGauss DataVec**
3. 填写以下字段：

| 字段 | 默认值 | 说明 |
|------|--------|------|
| Host | `localhost` | openGauss 主机地址 |
| Port | `5432` | openGauss 端口 |
| Database | （必填） | 数据库名，如 `postgres` |
| User | `gaussdb` | 用户名 |
| Password | （必填） | 密码 |
| SSL | `Disable` | 可选 Disable / Allow / Require |
| Max Connections | `10` | 连接池大小，生产建议 20~50 |

### 4.2 测试连接

填写完毕后点击底部 **Test** 按钮，节点会执行 `SELECT 1` 验证连通性：

- ✅ 显示 `Connection successful!` —— 凭据可用
- ❌ 显示错误消息 —— 检查网络、账号或 SSL 模式

### 4.3 安全建议

- 生产环境建议为 n8n 创建专用数据库账号，仅授予业务表的最小权限（`SELECT/INSERT/UPDATE/DELETE`）
- SSL 选 `Require` 强制加密通道
- 凭据中的密码使用 n8n 内置加密存储，可结合 Vault 等外部密钥管理系统

---

## 5. AI 服务集成

### 5.1 准备 Embedding 模型

向量检索需要一个 Embedding 模型把文本转为向量。常见选择：

| 模型 | 维度 | 凭据节点 |
|------|------|---------|
| OpenAI text-embedding-3-small | 1536 | n8n 内置 OpenAI 凭据 |
| OpenAI text-embedding-3-large | 3072 | 同上 |
| BGE-base-zh | 768 | 通过 HTTP Request 节点调用 |
| 本地 Ollama | 视模型而定 | n8n 内置 Ollama 凭据 |

> 选定模型后，**openGauss 中表的 `vector(N)` 必须与模型维度一致**，否则插入会报维度不匹配错误。

### 5.2 创建向量表

在 n8n 中新建一条工作流，加入 **OpenGauss DataVec** 节点，操作设为 `Execute Query`，运行下面的 SQL（一次性执行）：

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

---

## 6. 使用示例

下文以 OpenAI Embedding + GPT-4o-mini + 自建知识库为例，展示 4 种典型用法。

### 6.1 写入文档（Insert Documents）

**节点链**：

```
Manual Trigger → Edit Fields(Set) → Embeddings OpenAI → OpenGauss DataVec
```

**OpenGauss DataVec 节点配置**：

| 字段 | 值 |
|------|-----|
| Operation | `Insert Documents` |
| Table Name | `kb_docs` |
| Documents → Content | `={{ $json.content }}` |
| Documents → Embedding | `={{ $json.embedding }}` |
| Documents → Metadata | `={{ $json.metadata }}`（可空） |
| Options → Create Table If Not Exists | `false` |

**返回示例**：

```json
{ "insertedCount": 3, "tableName": "kb_docs" }
```

### 6.2 向量搜索（Vector Search）

**节点链**：

```
Webhook → Embeddings OpenAI → OpenGauss DataVec → ... LLM
```

**节点配置**：

| 字段 | 值 |
|------|-----|
| Operation | `Vector Search` |
| Table Name | `kb_docs` |
| Query Vector | `={{ $json.embedding }}` |
| Limit | `5` |
| Distance Strategy | `Cosine` |
| Options → Metadata Filter | `={{ {"category":"tech"} }}`（可选） |
| Options → EF Search | `100`（可选，HNSW 搜索精度参数） |
| Options → Probes | `10`（可选，IVFFLAT 搜索参数） |

**返回示例**：

```json
[
  { "id": 1, "content": "openGauss DataVec 支持 HNSW 索引",
    "metadata": { "category": "tech" }, "distance": 0.0123 },
  { "id": 5, "content": "向量检索基于余弦距离比较",
    "metadata": { "category": "tech" }, "distance": 0.0876 }
]
```

### 6.3 创建索引（Create Index）

数据量超过 1 万行时建议建索引，提升检索速度。

| 字段 | 值 |
|------|-----|
| Operation | `Create Index` |
| Table Name | `kb_docs` |
| Index Type | `HNSW` |
| Distance Strategy | `Cosine` |
| Options → Index Name | `kb_docs_hnsw_idx`（可选） |
| Options → M | `16`（HNSW 邻居数） |
| Options → EF Construction | `64`（HNSW 构建质量） |

> IVFFLAT 索引使用 Lists 参数；DISKANN 索引无需额外参数。

### 6.4 自定义查询（Execute Query）

对于复杂 SQL（聚合、JOIN、删除等），用此操作直接执行：

```sql
-- 按 category 统计文档数量
SELECT metadata->>'category' AS category, COUNT(*) AS cnt
FROM kb_docs
GROUP BY metadata->>'category'
ORDER BY cnt DESC;
```

支持参数化查询，避免 SQL 注入：

| 字段 | 值 |
|------|-----|
| Operation | `Execute Query` |
| Query | `SELECT * FROM kb_docs WHERE metadata->>'category' = $1` |
| Parameters | `["tech"]` |

---

## 7. 端到端示例：构建一个 RAG 问答接口

整体架构：

```
[入库工作流]
  Trigger → 切片 → Embedding → OpenGauss DataVec(Insert)

[问答工作流]
  Webhook(POST /ask) → Embedding(query)
                     → OpenGauss DataVec(Vector Search)
                     → Code(拼 context)
                     → OpenAI Chat
                     → Respond to Webhook
```

完整步骤参见同目录下的 [RAG_QUICKSTART.md](./RAG_QUICKSTART.md)。

调用示例：

```bash
curl -X POST http://localhost:5678/webhook/ask \
  -H "Content-Type: application/json" \
  -d '{"question":"openGauss DataVec 支持哪些索引？"}'
```

返回内容由 LLM 基于已入库的知识库语料生成。

---

## 8. DataVec 与 pgvector 的语法差异

本节点已自动适配 DataVec 语法，但在 `Execute Query` 中手写 SQL 时需要注意：

| 项 | DataVec（openGauss） | pgvector（PostgreSQL） |
|----|---------------------|------------------------|
| 启用方式 | 内核特性，开箱即用 | 需 `CREATE EXTENSION vector` |
| HNSW 搜索参数 | `SET hnsw_ef_search = N` | `SET hnsw.ef_search = N` |
| IVFFLAT 搜索参数 | `SET ivfflat_probes = N` | `SET ivfflat.probes = N` |
| DISKANN 索引 | ✅ 支持 | ❌ 不支持 |
| 距离操作符 | `<->` `<=>` `<#>` `<+>` | 同上 |

---

## 9. 常见问题

| 现象 | 原因与解决 |
|------|-----------|
| 节点未出现在 n8n 中 | 检查 `N8N_CUSTOM_EXTENSIONS` 路径或重启 n8n；确认 `dist/` 已编译 |
| Test 凭据失败 `ECONNREFUSED` | 检查 openGauss 是否启动、端口是否放通 |
| Test 凭据失败 `password authentication failed` | 检查账号密码、`pg_hba.conf` 是否允许该 IP |
| `type "vector" does not exist` | openGauss 版本不支持 DataVec，升级到 7.0+ |
| `expected N dimensions, got M` | embedding 模型维度与 `vector(N)` 不一致，对齐建表 SQL |
| 搜索很慢 | 数据量大时建索引；HNSW 调大 `EF Search`、IVFFLAT 调大 `Probes` |
| `unrecognized configuration parameter "hnsw.ef_search"` | 你在 Execute Query 用了 pgvector 语法，DataVec 应使用 `hnsw_ef_search`（无点号） |

---

## 10. 参考资料

- openGauss 官方文档：<https://docs.opengauss.org/>
- openGauss DataVec：<https://docs.opengauss.org/zh/docs/latest/datavec/>
- n8n 社区节点开发：<https://docs.n8n.io/integrations/creating-nodes/>
- 本项目集成测试指南：[INTEGRATION_TEST_GUIDE.md](./INTEGRATION_TEST_GUIDE.md)
- 本项目 RAG 快速上手：[RAG_QUICKSTART.md](./RAG_QUICKSTART.md)
