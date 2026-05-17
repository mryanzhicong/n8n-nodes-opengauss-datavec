# n8n-nodes-opengauss-datavec 任务全景图

## 项目概要

将 openGauss DataVec 向量数据库适配为 n8n 社区节点，以独立 npm 包形式发布。

---

## 任务依赖图

```
#1 初始化项目 (Lee)
├──► #2 凭据文件 (Taylor) ──┐
└──► #3 核心逻辑 (Felix) ──┼──► #4 节点定义 (Jay) ──┐
                            └──► #5 单元测试 (Robin) ◄┘
                                       │
                                       ▼
                            #6 本地全面测试 (Jimmy)
                                       │
                                       ▼
                            #7 发布 npm 包 [待执行]
                                       │
                                       ▼
                            #8 npm 包集成测试 [待执行]
                                       │
                                       ▼
                            #9 编写使用文档 [待执行]
```

---

## 专家团队

| 编号 | 角色 | 专家名 | 负责任务 |
|------|------|--------|----------|
| 1 | Researcher | Alex | 研究 n8n 向量数据库实现架构 |
| 2 | Researcher | Sam | 调研 DataVec 与 pgvector 语法差异 |
| 3 | Full-Stack Engineer | Lee | 初始化社区节点项目结构 |
| 4 | Full-Stack Engineer | Taylor | 实现凭据文件 |
| 5 | Full-Stack Engineer | Felix | 实现向量存储核心逻辑 |
| 6 | Full-Stack Engineer | Jay | 实现节点定义和 UI 配置 |
| 7 | Full-Stack Engineer | Robin | 编写单元测试 |
| 8 | Full-Stack Engineer | Jimmy | 本地全面测试（含集成测试） |

---

## 任务详情

### Task #1：初始化社区节点项目结构
- **状态**：✅ 已完成
- **负责人**：Lee (Full-Stack Engineer)
- **描述**：在 /root/n8n 工作区下创建 n8n-nodes-opengauss-datavec 项目目录，包含 package.json、tsconfig.json、README.md 和 .github/workflows/publish.yml。package.json 需包含 n8n 社区节点必要配置（keywords 含 n8n-community-node-package，n8n 属性注册凭据和节点）。
- **产出文件**：
  - `package.json` - npm 包配置，含 n8n 社区节点元数据
  - `tsconfig.json` - TypeScript 编译配置
  - `README.md` - 项目说明文档
  - `.github/workflows/publish.yml` - GitHub Actions 发布工作流
- **阻塞关系**：完成后解锁 #2 和 #3

---

### Task #2：实现 OpenGauss DataVec 凭据文件
- **状态**：✅ 已完成
- **负责人**：Taylor (Full-Stack Engineer)
- **描述**：创建 credentials/OpenGaussDataVec.credentials.ts，包含 Host、Port（默认5432）、Database、User（默认gaussdb）、Password、SSL 字段，使用 pg 包连接 openGauss。
- **产出文件**：
  - `credentials/OpenGaussDataVec.credentials.ts` - 凭据类型定义（7个字段）
- **关键设计**：
  - name: `openGaussDataVecApi`
  - 连接测试通过节点中的 `testedBy: 'openGaussConnectionTest'` 实现
  - SSL 支持 Disable/Allow/Require 三种模式
- **阻塞关系**：依赖 #1，完成后解锁 #4

---

### Task #3：实现 DataVec 向量存储核心逻辑
- **状态**：✅ 已完成
- **负责人**：Felix (Full-Stack Engineer)
- **描述**：创建 nodes/VectorStoreOpenGauss/datavecClient.ts，自行实现 SQL 操作（不依赖 LangChain PGVectorStore），使用 DataVec 原生语法。
- **产出文件**：
  - `nodes/VectorStoreOpenGauss/datavecClient.ts` - DataVecClient 类（~300行）
- **核心功能**：
  - `connect()` - 连接测试
  - `createTable()` - 建表（无需 CREATE EXTENSION）
  - `createIndex()` - 建索引（HNSW/IVFFLAT/DISKANN）
  - `insertDocuments()` - 事务批量插入
  - `similaritySearch()` - 相似度搜索（4种距离策略）
  - `executeQuery()` - 自定义 SQL
  - `dropTable()` / `close()`
- **关键差异处理（vs pgvector）**：
  - 查询参数：`SET hnsw_ef_search`（非 `hnsw.ef_search`）
  - 查询参数：`SET ivfflat_probes`（非 `ivfflat.probes`）
  - 无需 CREATE EXTENSION vector
  - 支持 DISKANN 索引算法
- **安全措施**：SQL 标识符转义、参数化查询、metadata key 转义
- **阻塞关系**：依赖 #1，完成后解锁 #4 和 #5

---

### Task #4：实现节点定义和 UI 配置
- **状态**：✅ 已完成
- **负责人**：Jay (Full-Stack Engineer)
- **描述**：创建节点定义文件，支持 4 种操作，含完整的 UI 参数配置。
- **产出文件**：
  - `nodes/VectorStoreOpenGauss/VectorStoreOpenGauss.node.ts` - 节点实现（~737行）
  - `nodes/VectorStoreOpenGauss/VectorStoreOpenGauss.node.json` - Codex 元数据
  - `nodes/VectorStoreOpenGauss/opengauss.svg` - 品牌图标
- **支持的操作**：
  1. **Vector Search** - 相似度搜索（L2/余弦/内积/曼哈顿），支持 efSearch/probes/metadataFilter
  2. **Insert Documents** - 批量插入文档+向量，可自动建表
  3. **Create Index** - 创建索引（HNSW/IVFFLAT/DISKANN），含参数调优
  4. **Execute Query** - 执行自定义 SQL（sqlEditor）
- **凭据测试**：`openGaussConnectionTest` 方法验证数据库连接
- **阻塞关系**：依赖 #2 和 #3，完成后解锁 #5

---

### Task #5：编写单元测试
- **状态**：✅ 已完成
- **负责人**：Robin (Full-Stack Engineer)
- **描述**：为 datavecClient 和节点逻辑编写单元测试，验证 SQL 生成正确性、操作符选择、参数处理等。
- **产出文件**：
  - `nodes/VectorStoreOpenGauss/datavecClient.test.ts` - 37 个测试用例
  - `jest.config.js` - Jest 配置
- **测试覆盖**：
  - connect (2 tests)
  - createTable (4 tests)
  - createIndex (7 tests)
  - insertDocuments (6 tests)
  - similaritySearch (9 tests)
  - executeQuery (2 tests)
  - dropTable (2 tests)
  - close (1 test)
  - DataVec vs pgvector 差异验证 (2 tests)
  - **共计 37 个测试，全部通过**
- **阻塞关系**：依赖 #3 和 #4

---

### Task #6：本地全面测试社区节点
- **状态**：✅ 已完成
- **负责人**：Jimmy (Full-Stack Engineer)
- **描述**：在本地进行完整的构建验证、单元测试、集成测试（连接真实 openGauss 数据库）和节点加载测试。
- **产出文件**：
  - `scripts/integration-test.js` - 集成测试脚本
- **测试结果**：
  - 构建：✅ 通过
  - 单元测试：✅ 37/37 通过
  - 集成测试：✅ 19/19 通过（连接真实 openGauss localhost:5432）
  - 节点加载：✅ 通过
- **发现并修复的 Bug**：
  - JSONB null 标量导致 metadata 过滤报错 → 添加 `jsonb_typeof(metadata) = 'object'` 条件
- **openGauss 连接信息**：localhost:5432, gaussdb/openGauss@123, postgres
- **阻塞关系**：完成后解锁 #7

---

### Task #7：发布 npm 包
- **状态**：⏳ 待执行
- **负责人**：待分配
- **描述**：将 n8n-nodes-opengauss-datavec 发布到 npm：
  1. 确认 package.json 中的名称、版本、描述等信息正确
  2. 确保构建产物完整（npm run build）
  3. 配置 npm 账号和 token
  4. 使用 GitHub Actions 或手动发布到 npm（npm publish --provenance）
- **前置条件**：需要 npm 账号和 NPM_TOKEN
- **阻塞关系**：依赖 #6，完成后解锁 #8

---

### Task #8：使用已发布的 npm 包进行集成测试
- **状态**：⏳ 待执行（被 #7 阻塞）
- **负责人**：待分配
- **描述**：从 npm 安装已发布的 n8n-nodes-opengauss-datavec 包，在 n8n 实例中进行完整的端到端测试：
  1. 通过 n8n 社区节点面板安装包
  2. 验证节点加载、凭据配置、向量操作等全流程功能正常
- **阻塞关系**：依赖 #7，完成后解锁 #9

---

### Task #9：编写使用文档
- **状态**：⏳ 待执行（被 #8 阻塞）
- **负责人**：待分配
- **描述**：编写完整使用文档，包括：
  1. 安装方式（社区节点安装 / npm install）
  2. 前提条件（openGauss 7.0+ DataVec）
  3. 凭据配置说明
  4. 各操作的使用教程（Vector Search、Insert Documents、Create Index、Execute Query）
  5. 常见问题和故障排查
  6. 示例工作流

---

## 项目文件结构（最终）

```
n8n-nodes-opengauss-datavec/
├── .github/workflows/
│   └── publish.yml                              # GitHub Actions 发布工作流
├── credentials/
│   └── OpenGaussDataVec.credentials.ts          # 凭据定义
├── nodes/VectorStoreOpenGauss/
│   ├── VectorStoreOpenGauss.node.ts             # 节点实现
│   ├── VectorStoreOpenGauss.node.json           # Codex 元数据
│   ├── datavecClient.ts                         # 核心向量操作逻辑
│   ├── datavecClient.test.ts                    # 单元测试
│   └── opengauss.svg                            # 节点图标
├── scripts/
│   └── integration-test.js                      # 集成测试脚本
├── dist/                                        # 编译产物
├── node_modules/
├── jest.config.js
├── package.json
├── package-lock.json
├── tsconfig.json
└── README.md
```

---

## 技术要点总结

### DataVec 与 pgvector 的关键差异

| 维度 | openGauss DataVec | PostgreSQL pgvector |
|------|-----------------|---------------------|
| 扩展加载 | 内核特性，无需操作 | 需要 `CREATE EXTENSION vector;` |
| 向量维度上限 | 16,000 | 2,000 |
| 索引算法 | HNSW, IVFFLAT, DISKANN, HNSWPQ, IVFPQ | HNSW, IVFFLAT |
| HNSW 查询参数 | `SET hnsw_ef_search = N` | `SET hnsw.ef_search = N` |
| IVFFLAT 查询参数 | `SET ivfflat_probes = N` | `SET ivfflat.probes = N` |
| 距离操作符 | `<->` `<#>` `<=>` `<+>` (相同) | `<->` `<#>` `<=>` `<+>` (相同) |

### 为什么选择独立 npm 社区节点

根据 n8n CONTRIBUTING.md 的明确规定：
- 新节点 PR 会被**自动关闭**（除非 n8n 团队主动要求）
- 官方推荐方式：创建社区节点并发布到 npm
- 包名格式：`n8n-nodes-{name}`
- 必须包含关键词 `n8n-community-node-package`
- 2026 年起要求使用 GitHub Actions + `npm publish --provenance`
