# openGauss 通用 SQL 节点详解

`openGauss`（内部 name：`openGauss`）是本节点包面向常规数据库操作的通用节点，分类挂在 **Development / Data & Storage**，并开启了 `usableAsTool: true`，可直接作为 AI Agent 的工具使用。它覆盖了从原生 SQL 到表的 CRUD 与表管理共 **6 种 Operation**，是 RAG 灌库前建表、业务系统数据回写、AI Agent 自助查库的首选。

> 节点文件：`nodes/OpenGauss/OpenGauss.node.ts`；图标：`opengauss.svg`；凭证：`openGauss DataVec API`（与向量节点共用）。

---

## 1. 节点概览

| 属性 | 值 |
| --- | --- |
| displayName | `openGauss` |
| name | `openGauss` |
| 分类 | Development / Data & Storage |
| 输入 / 输出 | main / main |
| usableAsTool | `true`（可挂 AI Agent Tools 槽） |
| 凭证 | `openGauss DataVec API` |

### usableAsTool 说明

当一个节点声明 `usableAsTool: true` 时，AI Agent 会把它的所有 Operation 暴露成可调用工具集。Agent 会根据 Operation 名称与字段含义自动生成调用参数。**强烈建议**在工具场景下：

- 用具体的表 / Schema 名（避免让 Agent 误猜库结构）
- 给 Execute Query 留足参数化空间（`$1, $2`），降低注入风险
- 配合 n8n 的 Memory 节点，避免 Agent 反复扫表

---

## 2. 公共参数

所有 Operation 共用 **Options** 折叠组（部分字段按 Operation 显隐）：

| 字段 | 适用 Operation | 说明 |
| --- | --- | --- |
| **Query Parameters** | Execute Query | 逗号分隔；按顺序绑定 `$1, $2, ...`；也支持 JSON 数组 |
| **Output Columns** | Select / Insert / Update / Upsert | 逗号分隔；`*` 返回全部；留空跳过 RETURNING |
| **Skip on Conflict** | Insert | 唯一约束冲突时不报错（`ON CONFLICT DO NOTHING`） |
| **Cascade** | Delete（Truncate / Drop） | 级联删除依赖对象（视图、外键等） |

Schema 默认 `public`，可在每个 Operation 中单独覆盖。

---

## 3. 六种 Operation

### 3.1 Execute Query

**用途**：自由 SQL。DDL、复杂 JOIN、临时报表、`COPY` 都走这里。

**参数**：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| **Query** | SQL 编辑器（PostgreSQL 方言） | 用 `$1, $2` 引用参数 |
| **Options → Query Parameters** | 字符串 | 逗号分隔的值列表 |

**SQL 示例**：

```sql
SELECT id, name, price
FROM product
WHERE quantity > $1 AND category = $2
ORDER BY price DESC
LIMIT 20;
```

**Options → Query Parameters**：`10,electronics`

**输出**：每行一个 item。若 SQL 无返回行（DDL / UPDATE 等），输出单条 `{ "success": true }`。

```json
{ "id": 7, "name": "Switch", "price": "2199.00" }
```

> 参数化是首选防注入手段。绝对不要把用户输入用字符串拼接进 Query。

### 3.2 Insert

**用途**：往表里插入数据。

**参数**：

| 字段 | 说明 |
| --- | --- |
| **Schema / Table** | 目标表 |
| **Data Mode** | `Auto-Map Input Data to Columns` 或 `Map Each Column Manually` |
| **Values to Send** | 仅手动模式：每行一对 column/value |
| **Options → Output Columns** | RETURNING 子句（如 `id,*`） |
| **Options → Skip on Conflict** | 唯一冲突时跳过 |

**SQL（自动生成）**：

```sql
INSERT INTO "public"."product" ("name", "price") VALUES ($1, $2)
ON CONFLICT DO NOTHING
RETURNING "id";
```

**输入示例**（autoMapInputData）：

```json
{ "name": "Mouse", "price": 99 }
```

**输出示例**（设置了 `Output Columns = id`）：

```json
{ "id": 42 }
```

未设 RETURNING 时返回：`{ "success": true, "affectedRows": 1 }`。

### 3.3 Select

**用途**：按条件查询。

**参数**：

| 字段 | 说明 |
| --- | --- |
| **Schema / Table** | 来源表 |
| **Return All** | 关闭则启用 **Limit**（默认 50） |
| **Select Rows** | WHERE 条件列表（fixedCollection） |
| **Combine Conditions** | `AND` / `OR`（多个 WHERE 之间） |
| **Sort** | ORDER BY 列表 |
| **Options → Output Columns** | 投影；`*` 或留空 = `SELECT *` |

**WHERE 操作符**：`=` / `!=` / `LIKE` / `NOT LIKE` / `>` / `<` / `>=` / `<=` / `IS NULL` / `IS NOT NULL`。`IS NULL` / `IS NOT NULL` 会自动隐藏 Value 输入。

**SQL（自动生成）**：

```sql
SELECT "id", "name" FROM "public"."user"
WHERE "status" = $1 AND "name" LIKE $2
ORDER BY "id" DESC
LIMIT $3;
```

**输出**：每行一个 item。

### 3.4 Update

**用途**：按某一列匹配并更新其余字段。

**参数**：

| 字段 | 说明 |
| --- | --- |
| **Column to Match On** | 匹配列（通常是主键 / 业务唯一键） |
| **Data Mode** | 自动映射或手动 |
| **Value of Column to Match On** | 仅手动模式 |
| **Values to Send** | 仅手动模式：要更新的列/值 |

**SQL（自动生成）**：

```sql
UPDATE "public"."user" SET "name" = $1, "email" = $2
WHERE "id" = $3
RETURNING "id", "name";
```

**输入示例**（autoMapInputData，匹配列 `id`）：

```json
{ "id": 7, "name": "Alice", "email": "alice@example.com" }
```

若 autoMap 模式下输入缺少匹配列字段，会抛 `Column to match on 'id' not found in input item`。

### 3.5 Upsert

**用途**：`INSERT ... ON CONFLICT(unique) DO UPDATE`。

**参数**：与 Update 类似，但匹配列须是表上的唯一约束 / 主键。

**SQL（自动生成）**：

```sql
INSERT INTO "public"."user" ("id", "name", "email") VALUES ($1, $2, $3)
ON CONFLICT ("id") DO UPDATE SET "name" = EXCLUDED."name", "email" = EXCLUDED."email"
RETURNING *;
```

> 输入仅包含匹配列、没有其它字段时会抛 `Add at least one value besides the unique column`。

### 3.6 Delete

**用途**：三种破坏性操作。

**参数**：

| 字段 | 字段键名 | 取值 | 说明 |
| --- | --- | --- | --- |
| **Command** | `deleteCommand` | `truncate` / `delete` / `drop` | 选择三种破坏性操作之一；工作流 JSON 里以该键名落盘 |
| **Schema / Table** | `schema` / `table` | — | 目标表 |

各 Command 取值对应的行为与额外字段：

| `deleteCommand` | 行为 | 额外字段 |
| --- | --- | --- |
| `truncate` | `TRUNCATE TABLE` 清空数据保留结构 | **Restart Sequences**（RESTART IDENTITY）、Options → **Cascade** |
| `delete` | `DELETE FROM ... WHERE` 按条件删除 | **Select Rows** + **Combine Conditions** |
| `drop` | `DROP TABLE IF EXISTS` 删表 | Options → **Cascade** |

**SQL 示例**：

```sql
TRUNCATE TABLE "public"."session" RESTART IDENTITY CASCADE;
DELETE FROM "public"."log" WHERE "created_at" < $1;
DROP TABLE IF EXISTS "public"."tmp_import" CASCADE;
```

**输出**：`{ "success": true, "affectedRows": N }`。Truncate / Drop 的 `affectedRows` 通常为 0。

---

## 4. WHERE 条件构造小结

`Select` 与 `Delete (delete)` 共用同一套 WHERE 构造器：

1. 每条条件包含 **Column / Operator / Value**
2. Operator 支持 10 种（见 3.3）
3. `IS NULL` / `IS NOT NULL` 时 Value 自动隐藏
4. 多条之间用 **Combine Conditions** 选 `AND` / `OR`（一次只能选一种，不支持嵌套）
5. 需要嵌套或子查询，请改用 **Execute Query**

所有列名都会经过 `quoteIdent` 双引号转义；所有值都用参数化 `$N` 绑定。

---

## 5. Execute Query 参数化（`$1, $2`）

n8n 表达式渲染发生在 Query 文本上，但 **强烈推荐**把用户输入放到 **Query Parameters**，而不是直接拼接到 Query 里：

**推荐**：

```
Query: SELECT * FROM "user" WHERE "email" = $1
Query Parameters: {{ $json.email }}
```

**不推荐**（有注入风险）：

```
Query: SELECT * FROM "user" WHERE "email" = '{{ $json.email }}'
```

Query Parameters 支持两种填法：

- 逗号分隔字符串：`alice@example.com,active`
- JSON 数组：`["alice@example.com","active"]`

---

## 6. 常见问题

### Q1：列名 / 表名带大写或空格被报 `column "xxx" does not exist`

openGauss 默认把未加引号的标识符转小写。本节点已对所有 column / table 调用 `quoteIdent` 加双引号，因此 `userName` 会被当作大小写敏感的列查询；若你的表实际是小写 `username`，需保证字段一致。

### Q2：空值如何插入

autoMapInputData 模式下，输入 JSON 字段值为 `null` 会按 `NULL` 写入。手动模式下，把 Value 留空写入的是空字符串 `''`，需要 NULL 时请改用 Execute Query：

```sql
INSERT INTO "user" ("id", "deleted_at") VALUES ($1, NULL);
```

### Q3：Insert 的 `{}` 空对象输入

无字段时节点会生成 `INSERT INTO ... DEFAULT VALUES`，对带默认值的表可用；否则会报 `null value in column ... violates not-null constraint`。

### Q4：返回值缺少字段

默认不带 RETURNING 时仅返回 `{ success, affectedRows }`。需要拿到新行的 id 等，请在 **Options → Output Columns** 填 `id` 或 `*`。

### Q5：作为 AI Agent 工具时 Agent 老是用错表名

在 Tool 节点名（n8n 画布上方的节点名）里写清表名，例如把节点重命名为 `openGauss_query_orders`。Agent 会优先用节点名推断意图。
