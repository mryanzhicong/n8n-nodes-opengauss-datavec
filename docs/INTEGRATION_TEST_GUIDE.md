# 集成测试指南（双节点本地验证）

本文档面向贡献者 / 发布者，描述在本地用 `N8N_CUSTOM_EXTENSIONS` 加载本包的两个节点（**openGauss DataVec Store** 与 **openGauss**）后，如何端到端验证 UI 注册、凭证、6 个 SQL 操作、4 个向量模式与 AI Agent 工具暴露的完整流程。所有自动化脚本都在 `scripts/` 下。

> 适用版本：`n8n-nodes-opengauss-datavec` v0.2.0。要求 Node.js ≥ 24（与 `package.json` `engines.node` 对齐）。

---

## 1. 环境准备

### 1.1 依赖

- Node.js ≥ 24
- pnpm 或 npm
- 一个可达的 openGauss / DataVec 实例（默认配置见 `scripts/integration-test.js`：`localhost:5432`，user `gaussdb`，password `openGauss@123`）
- n8n 源码 或 `npx n8n@latest`

### 1.2 构建本包

```bash
cd /abs/path/to/n8n-nodes-opengauss-datavec
pnpm install        # 或 npm install --ignore-scripts
pnpm build          # tsc + copyfiles，产物在 dist/
```

构建后必须确认存在：

- `dist/credentials/OpenGaussDataVec.credentials.js`
- `dist/nodes/VectorStoreOpenGauss/VectorStoreOpenGauss.node.js`
- `dist/nodes/VectorStoreOpenGauss/VectorStoreOpenGauss.node.json`
- `dist/nodes/OpenGauss/OpenGauss.node.js`
- `dist/nodes/OpenGauss/OpenGauss.node.json`
- `dist/nodes/**/opengauss.svg`

> `*.node.json`（codex 文件）必须存在，否则 `N8N_CUSTOM_EXTENSIONS` 加载链路会忽略内联 codex，导致节点分类丢失。

### 1.3 启动 n8n

```bash
export N8N_CUSTOM_EXTENSIONS=/abs/path/to/n8n-nodes-opengauss-datavec
# n8n 源码目录
pnpm start
# 或独立运行
npx n8n@latest start
```

> `N8N_CUSTOM_EXTENSIONS` 指向 **项目根**（包含 `package.json` 与 `dist/` 的目录），不要指向 `dist/` 本身。

启动日志里应看到（n8n ≥ 1.x）：

```
Loaded all credentials and nodes from /abs/path/to/n8n-nodes-opengauss-datavec
```

---

## 2. 自动化脚本

### 2.1 节点加载冒烟：`scripts/test-node-load.js`

不需要数据库。仅验证编译产物可被 require、节点 description 字段正常：

```bash
node scripts/test-node-load.js
```

期望输出包含：

```
Node displayName: openGauss DataVec Store
Node name: openGaussDataVec
...
✓ Node and credential modules loaded successfully!
```

失败常见原因：未执行 `pnpm build`、`dist/` 目录缺文件、`*.svg` 没拷过去。

### 2.2 DataVecClient 底层：`scripts/integration-test.js`

需要可连的 openGauss 实例。脚本会创建测试表 `n8n_test_vectors`、跑增/查/删/相似度搜索一整轮，最后清理：

```bash
# 如需改连接参数，编辑 scripts/integration-test.js 顶部的 DB_CONFIG
node scripts/integration-test.js
```

期望末尾：

```
=== Test Summary ===
Passed: N
Failed: 0
```

任意 fail 都意味着 `DataVecClient` 与目标数据库不兼容，应先排查再做 UI 测试。

### 2.3 Jest 单元测试

```bash
pnpm test    # 跑 nodes/VectorStoreOpenGauss/datavecClient.test.ts 等
```

---

## 3. UI 验证清单

在 n8n 画布逐项验证，全部通过才算双节点集成 OK。

### 3.1 节点选择器

- [ ] 在新建节点面板搜 `openGauss`，能同时看到 **openGauss** 与 **openGauss DataVec Store**
- [ ] 两个节点的图标都正常显示（`opengauss.svg`），不是默认占位符

### 3.2 Vector Stores 子分类面板

- [ ] 在 **AI** → **Vector Stores** 分类里能看到 **openGauss DataVec Store**
- [ ] 该面板标题为 *Vector Stores*，节点同时也出现在 *Other Vector Stores* 子组

> 此项失败通常是 codex 注册问题：确认 `VectorStoreOpenGauss.node.ts` 的 `codex.subcategories` 含 `'Vector Stores': ['Other Vector Stores']`，且对应 `.node.json` 已被构建脚本拷到 dist/。

### 3.3 AI Agent Tools 槽

- [ ] 新建 **AI Agent** 节点，点击 **Tools** 槽 `+`
- [ ] 在工具选择器里能搜到 **openGauss DataVec Store**（前提是该节点 Mode 已设为 `Retrieve Documents (As Tool for AI Agent)`）
- [ ] 也能搜到 **openGauss**（因为它声明了 `usableAsTool: true`）

### 3.4 凭证测试

- [ ] 新建 **openGauss DataVec API** 凭证，填入实例信息
- [ ] 点击 **Test** 返回 `Connection successful!`
- [ ] 故意改错密码，再测应返回 `Error` 与具体错误消息

### 3.5 openGauss 节点 6 个 Operation 各跑一遍

准备一张测试表：

```sql
CREATE TABLE IF NOT EXISTS qa_users (
  id   SERIAL PRIMARY KEY,
  name TEXT UNIQUE NOT NULL,
  age  INT
);
```

依次切换 Operation 并执行（每次确认输出符合预期）：

| # | Operation | 验证点 |
| --- | --- | --- |
| 1 | **Execute Query** | `SELECT 1 AS ok;` 返回 `{ ok: 1 }` |
| 2 | **Insert** | autoMap 输入 `{ name: "alice", age: 30 }`，返回 `success / affectedRows=1` |
| 3 | **Select** | WHERE `name = alice`，返回该行 |
| 4 | **Update** | 匹配列 `name=alice`，更新 `age=31`，返回受影响 |
| 5 | **Upsert** | 唯一列 `name`，同时插入新行和更新已存在行 |
| 6 | **Delete** | 三种 Command：`Delete` 带 WHERE / `Truncate` / `Drop` 各跑一次 |

### 3.6 openGauss DataVec Store 节点 4 种 Mode 各跑一遍

| # | Mode | 验证点 |
| --- | --- | --- |
| 1 | **Insert Documents** | 灌 3 篇文档，返回 `insertedCount=3`；DB 中查 `qa_users` 同库表数据存在 |
| 2 | **Get Many** | 给 prompt，返回 Top K 文档与 score |
| 3 | **Retrieve Documents (As Vector Store)** | 输出口可挂到 Q&A Chain 的 VS 槽 |
| 4 | **Retrieve Documents (As Tool for AI Agent)** | 输出口可挂到 AI Agent 的 Tools 槽，Tool Description 显示在 Agent 工具列表 |

---

## 4. 发布前回归

正式 `npm publish` 前必须依次完成：

1. `pnpm build` 无 TS 错误
2. `node scripts/test-node-load.js` 通过
3. `node scripts/integration-test.js` 全绿（需真实库）
4. `pnpm test` 全绿
5. 本文 §3 UI 清单 100% 勾完
6. `package.json` 的 `version` / `engines.node` / `n8n.nodes` 数组都正确

发布命令（参考）：

```bash
npm publish --access public --provenance
```

> `--access public` 必须显式带；npm granular token 需在控制台开启 *bypass 2FA*，否则首次发布会失败。

---

## 5. 常见问题

| 现象 | 处理 |
| --- | --- |
| n8n 启动日志没有 `Loaded ... custom extensions` | `N8N_CUSTOM_EXTENSIONS` 未生效；确认是绝对路径、指向项目根 |
| 节点选择器只看到 1 个节点 | `package.json` → `n8n.nodes` 数组缺一项；或 `dist/` 对应 `.node.js` 缺失 |
| Vector Stores 面板无此节点 | 缺 `.node.json` codex 外部文件；`pnpm build` 后确认 `dist/.../VectorStoreOpenGauss.node.json` 存在 |
| AI Agent 工具列表里没有向量节点 | Mode 不是 `retrieve-as-tool`；切换后输出类型才会是 `ai_tool` |
| 凭证 Test 报 `password authentication failed` | 检查 openGauss 实例用户、密码、`pg_hba.conf` 是否允许该 host |
| `scripts/integration-test.js` 报 `Cannot find module '../dist/...'` | 没跑 `pnpm build`；或脚本未跟 dist/ 同步 |
