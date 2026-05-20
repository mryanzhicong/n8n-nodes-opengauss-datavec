# openGauss DataVec n8n 节点使用总览

本文档是 `n8n-nodes-opengauss-datavec` 社区节点包 v0.2.0 的入口指南，面向希望在 n8n 工作流里使用 openGauss / openGauss DataVec 的开发者与运维同学。读完本文你会知道：项目提供了哪两个节点、各自适合什么场景、如何安装、如何配置凭证，以及最小可运行的工作流长什么样。

如需深入功能细节，请继续阅读：

- 向量库节点：[VECTOR_STORE_GUIDE.md](./VECTOR_STORE_GUIDE.md)
- 通用 SQL 节点：[SQL_NODE_GUIDE.md](./SQL_NODE_GUIDE.md)
- 5 分钟跑通 RAG：[RAG_QUICKSTART.md](./RAG_QUICKSTART.md)
- 本地集成测试：[INTEGRATION_TEST_GUIDE.md](./INTEGRATION_TEST_GUIDE.md)

---

## 1. 项目简介

本节点包基于 openGauss / openGauss DataVec 向量数据库扩展，提供两个互补的节点：一个面向 LangChain/AI Agent 生态的向量库节点，一个面向传统数据操作的通用 SQL 节点。两者共用同一套 `openGaussDataVecApi` 凭证，可在同一工作流里自由组合（例如：先用 SQL 节点建表，再用向量库节点灌库与检索）。

包含组件：

- **openGauss DataVec Store** — AI Vector Store 节点，4 种模式
- **openGauss** — 通用 SQL 节点，6 种操作，`usableAsTool: true`
- **openGauss DataVec API** — 数据库凭证

---

## 2. 节点选型表

| 场景 | 推荐节点 | 关键模式 / 操作 |
| --- | --- | --- |
| 把文档 + Embedding 写入向量表 | **openGauss DataVec Store** | Insert Documents |
| 在数据管道里独立做向量召回（不接 Chain） | **openGauss DataVec Store** | Get Many |
| 给 Question & Answer Chain / Retriever 提供向量库 | **openGauss DataVec Store** | Retrieve Documents (As Vector Store) |
| 让 AI Agent 把向量检索当作工具调用 | **openGauss DataVec Store** | Retrieve Documents (As Tool for AI Agent) |
| 自由 SQL（DDL / 复杂查询 / 临时报表） | **openGauss** | Execute Query |
| 结构化表的增删改查（业务表 CRUD） | **openGauss** | Insert / Select / Update / Upsert / Delete |
| 让 AI Agent 直接读写业务表 | **openGauss**（usableAsTool） | 任意操作 |

简单记忆：**向量 / RAG → openGauss DataVec Store；普通表 → openGauss**。两个节点都通过同一个凭证连接同一实例，可在一张工作流里串联。

---

## 3. 安装

### 方式一：n8n 社区节点 UI（推荐生产）

1. 进入 n8n → **Settings** → **Community Nodes**
2. 点击 **Install**
3. 在包名输入框填写：`n8n-nodes-opengauss-datavec`
4. 勾选风险确认 → **Install**
5. 安装完成后回到画布，在节点选择器搜索 `openGauss` 即可看到两个节点

> 要求 n8n ≥ 1.0，Node.js ≥ 24（本包 `engines.node` 已显式声明）。

### 方式二：本地开发 / 调试（推荐贡献者）

适合需要修改源码、调试 Mode/Operation 行为、验证 codex 注册的开发者。

```bash
# 1. 克隆并构建
git clone https://github.com/mryanzhicong/n8n-nodes-opengauss-datavec.git
cd n8n-nodes-opengauss-datavec
pnpm install   # 或 npm install --ignore-scripts
pnpm build     # 生成 dist/

# 2. 用 N8N_CUSTOM_EXTENSIONS 启动 n8n
export N8N_CUSTOM_EXTENSIONS=/abs/path/to/n8n-nodes-opengauss-datavec
pnpm dev       # 在 n8n 源码目录执行
```

> 关键：`N8N_CUSTOM_EXTENSIONS` 必须指向**项目根**（含 `package.json` 与 `dist/` 的目录）。每次改 `.ts` 后需重新 `pnpm build` 并重启 n8n。详见 [INTEGRATION_TEST_GUIDE.md](./INTEGRATION_TEST_GUIDE.md)。

---

## 4. 凭证配置：`openGauss DataVec API`

在 n8n → **Credentials** → **New** → 搜索 `openGauss DataVec` 创建：

| 字段 | 说明 | 示例 |
| --- | --- | --- |
| **Host** | 数据库主机 | `localhost` |
| **Port** | 数据库端口 | `5432` |
| **Database** | 库名 | `postgres` |
| **User** | 用户名 | `gaussdb` |
| **Password** | 密码 | `openGauss@123` |
| **SSL** | 加密模式：`Disable` / `Allow` / `Require` | `Disable` |
| **Max Connections** | 连接池上限（默认 10） | `10` |

点击 **Test** 触发 `openGaussConnectionTest`：实际跑一次 `SELECT 1`，绿色 OK 即可保存。两个节点共用此凭证，无需重复配置。

---

## 5. 最小示例

### 示例 A：用 **openGauss DataVec Store** 灌一条向量

工作流概念图：

```
[Manual Trigger] --main--> [openGauss DataVec Store: Insert Documents] --main--> [Output]
                                       ^
                                       | ai_embedding
                              [Embeddings OpenAI]
```

关键字段：

- 节点选 **openGauss DataVec Store**
- **Mode** = `Insert Documents`
- **Schema** = `public`, **Table** = `demo_vectors`
  - Schema 默认为 `public`，大多数场景无需修改；仅在操作非默认 schema 时手动指定。
- **Distance Strategy** = `Cosine`
- **Dimensions** = `1536`（如表不存在会按此维度自动建表）
- 上游 Main 输入需包含 `content`（或 `text` / `pageContent`）字段，可选 `metadata` 对象
- Embedding 槽接 **Embeddings OpenAI**（或 Ollama 等任意 Embeddings 节点）

执行后，输出：`{ "success": true, "insertedCount": 1, "tableName": "public.demo_vectors" }`。

> 截图占位：在 n8n 画布选中节点，右侧参数面板 Mode 下拉、Schema、Table、Dimensions 自上而下排列。

### 示例 B：用 **openGauss** 跑一条原生 SQL

工作流概念图：

```
[Manual Trigger] --main--> [openGauss: Execute Query] --main--> [Output]
```

关键字段：

- 节点选 **openGauss**
- **Operation** = `Execute Query`
- **Query**：

```sql
SELECT id, name FROM demo_users WHERE created_at > $1 LIMIT 10;
```

- **Options → Query Parameters** = `2025-01-01`

执行后，每行结果都会成为一条独立的 n8n item，可直接接 If / Set / HTTP 等节点。

---

## 6. 常见陷阱速查

- **节点搜不到**：n8n 必须 ≥ 1.0；本地开发需 `pnpm build` 后重启；`N8N_CUSTOM_EXTENSIONS` 必须指向项目根而非 `dist/`。
- **维度不一致**：Insert Documents 首次写入会按 `Dimensions` 建表，后续 Embedding 模型若维度变了会失败 —— 换模型时务必新建表。
- **向量库节点 Vector Stores 面板不显示**：确认包版本 ≥ 0.2.0，且未自行修改 `codex.subcategories`。
- **AI Agent 工具槽看不到节点**：必须把 Mode 切到 `Retrieve Documents (As Tool for AI Agent)`，输出类型才是 `ai_tool`。

---

## 7. 下一步

- 想做 RAG：直接看 [RAG_QUICKSTART.md](./RAG_QUICKSTART.md)
- 想全量了解向量节点 4 种模式：[VECTOR_STORE_GUIDE.md](./VECTOR_STORE_GUIDE.md)
- 想用 openGauss 当业务库 CRUD：[SQL_NODE_GUIDE.md](./SQL_NODE_GUIDE.md)
- 想验证自己的安装是否正确：[INTEGRATION_TEST_GUIDE.md](./INTEGRATION_TEST_GUIDE.md)
