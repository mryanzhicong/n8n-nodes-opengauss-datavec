# 发布到 npm 操作指南

本文档记录将 `n8n-nodes-opengauss-datavec` 发布到 npm 公共仓库的完整流程，包含手工发布与 GitHub Actions 自动发布两种方式。

---

## 1. 发布前准备（首次发布必检）

### 1.1 完善 `package.json`

补全以下字段，提升包的可信度与可发现性：

```json
{
  "author": "Your Name <you@example.com>",
  "homepage": "https://github.com/<owner>/n8n-nodes-opengauss-datavec#readme",
  "repository": {
    "type": "git",
    "url": "git+https://github.com/<owner>/n8n-nodes-opengauss-datavec.git"
  },
  "bugs": {
    "url": "https://github.com/<owner>/n8n-nodes-opengauss-datavec/issues"
  },
  "engines": {
    "node": ">=20.15"
  }
}
```

### 1.2 确保 SVG 图标随 dist 发布

`tsc` 不会复制非 `.ts` 文件，需手动处理。修改 `build` 脚本：

```json
{
  "scripts": {
    "build": "tsc && cp nodes/VectorStoreOpenGauss/opengauss.svg dist/nodes/VectorStoreOpenGauss/"
  }
}
```

或使用 `copyfiles`：

```bash
pnpm add -D copyfiles
```

```json
{
  "scripts": {
    "build": "tsc && copyfiles -u 1 \"nodes/**/*.svg\" dist/"
  }
}
```

### 1.3 检查包名是否可用

```bash
npm view n8n-nodes-opengauss-datavec
```

- 返回 `404 Not Found` → 名字可用
- 返回包元数据 → 已被占用，需改名（建议使用 scope，如 `@your-org/n8n-nodes-opengauss-datavec`）

### 1.4 验证打包内容

```bash
pnpm build
npm pack --dry-run
```

输出应仅包含 `dist/`、`README.md`、`LICENSE`、`package.json`，不得包含源码、测试、`node_modules`。当前已通过 `package.json` 中的 `"files": ["dist"]` 限定。

### 1.5 n8n 社区节点合规要求

| 要求 | 是否满足 |
|------|---------|
| 包名以 `n8n-nodes-` 开头 | ✅ |
| `keywords` 包含 `n8n-community-node-package` | ✅ |
| `package.json` 含 `n8n.nodes` 与 `n8n.credentials` | ✅ |
| 入口文件指向 `dist/` 下的 `.js` 编译产物 | ✅ |
| `description.icon` 指向 SVG，且 SVG 随 dist 发布 | 见 1.2 |
| README.md 完整 | 建议补充 |
| 公开 Git 仓库 | 必须 |

---

## 2. 注册并登录 npm

```bash
# 1. 在 https://www.npmjs.com 注册账号
# 2. 本地登录
npm login            # 浏览器打开后授权登录
npm whoami           # 验证登录用户
```

> 若包名带 scope（如 `@your-org/...`），首次发布须加 `--access public`，否则 npm 默认按私有包处理并报 402 错误。

---

## 3. 方式 A：手工发布

适合个人快速发布或紧急修复。

```bash
# 1. 升级版本号（语义化版本）
npm version patch    # 0.1.0 → 0.1.1（bug 修复）
npm version minor    # 0.1.0 → 0.2.0（新增功能，向后兼容）
npm version major    # 0.1.0 → 1.0.0（破坏性变更）
# 该命令会自动 git commit + git tag

# 2. 推送代码与 tag
git push --follow-tags

# 3. 发布到 npm（prepublishOnly 钩子会自动跑 build）
npm publish

# 若是 scope 包：
npm publish --access public
```

发布成功后访问 `https://www.npmjs.com/package/n8n-nodes-opengauss-datavec` 验证。

---

## 4. 方式 B：GitHub Actions 自动发布（推荐）

仓库中已包含 `.github/workflows/publish.yml`，触发条件为 `push tag v*`。

### 4.1 在 npm 创建 Automation Token

1. 登录 npmjs.com → 右上角头像 → **Access Tokens**
2. **Generate New Token** → 类型选 **Automation**（CI 专用）或 **Granular**（细粒度）
3. 复制生成的 token（仅显示一次）

### 4.2 在 GitHub 仓库添加 Secret

1. 仓库页面 → **Settings → Secrets and variables → Actions**
2. **New repository secret**
3. Name：`NPM_TOKEN`，Value：上一步复制的 token

### 4.3 推 tag 触发发布

```bash
npm version patch              # 升版本号 + 自动打 tag
git push --follow-tags         # 推送代码与 tag
```

GitHub Actions 自动执行：

```
checkout → setup-node → npm install → npm run build → npm publish --provenance
```

### 4.4 关于 `--provenance`

`publish.yml` 中已启用供应链安全特性 `--provenance`，会在 npm 包页面展示「构建于哪个 GitHub commit」的可信证明。前提：

- `permissions.id-token: write` 已配置 ✅
- 仓库为公共仓库（私有仓库需要付费 npm 账户支持）

---

## 5. 安装验证

发布完成后在干净目录测试：

```bash
mkdir /tmp/test-install && cd /tmp/test-install
npm init -y
npm install n8n-nodes-opengauss-datavec

# 验证产物
ls node_modules/n8n-nodes-opengauss-datavec/dist
node -e "require('n8n-nodes-opengauss-datavec/dist/nodes/VectorStoreOpenGauss/VectorStoreOpenGauss.node.js')"
```

也可以在 n8n UI **Settings → Community Nodes → Install** 中输入包名验证用户安装路径。

---

## 6. 维护与撤回

| 场景 | 操作 |
|------|------|
| 修了 bug | `npm version patch` → push tag |
| 加了功能 | `npm version minor` → push tag |
| 破坏性变更 | `npm version major` + README 加迁移指南 |
| 撤回错误版本（72h 内） | `npm unpublish n8n-nodes-opengauss-datavec@<version>` |
| 标记弃用（推荐） | `npm deprecate n8n-nodes-opengauss-datavec@<version> "reason"` |

> npm 不鼓励 `unpublish`，会影响依赖该包的下游项目；优先使用 `deprecate` + 发新版本。

---

## 7. 首次发布清单

按顺序勾选确认：

- [ ] 检查包名是否可用：`npm view n8n-nodes-opengauss-datavec`
- [ ] 补全 `package.json` 的 author / repository / bugs / engines
- [ ] build 脚本中加上 SVG 复制
- [ ] 本地跑 `pnpm build` 通过，`dist/` 含 SVG
- [ ] `npm pack --dry-run` 确认包内容干净
- [ ] README.md 内容完整（功能、安装、使用、Issue 链接）
- [ ] 在 npm 创建 Automation Token
- [ ] 将 token 添加到 GitHub Secret `NPM_TOKEN`
- [ ] `npm version <patch|minor|major>` 升版本
- [ ] `git push --follow-tags` 推送 tag 触发 CI
- [ ] 在 GitHub Actions 页面查看发布结果
- [ ] 在新目录 `npm install` 验证可用
- [ ] 在 n8n UI 通过 Community Nodes 安装验证

---

## 8. 常见问题

| 现象 | 原因与解决 |
|------|-----------|
| `403 Forbidden - You do not have permission to publish` | 包名被占用，改名或加 scope |
| `402 Payment Required` | scope 包未加 `--access public` |
| `E401 Unauthorized` | 未登录或 token 过期，重新 `npm login` 或更新 `NPM_TOKEN` |
| `prepublishOnly` 失败 | 编译报错，先在本地修复 `pnpm build` |
| n8n 安装后节点不显示 | dist 中缺 SVG / 路径不对，对照 `n8n.nodes` 字段排查 |
| `version already exists` | 同版本号无法重发，须先 `npm version` 升号 |
| GitHub Actions 卡在 `npm publish` | 检查 `NPM_TOKEN` 是否过期；Token 类型必须为 Automation 或写权限的 Granular |

---

## 9. 参考资料

- npm 官方发布文档：<https://docs.npmjs.com/cli/v10/commands/npm-publish>
- npm Provenance：<https://docs.npmjs.com/generating-provenance-statements>
- 语义化版本规范：<https://semver.org/lang/zh-CN/>
- n8n 社区节点指南：<https://docs.n8n.io/integrations/creating-nodes/deploy/install-community-nodes/>
- 项目使用指南：[USAGE_GUIDE.md](./USAGE_GUIDE.md)
- RAG 快速上手：[RAG_QUICKSTART.md](./RAG_QUICKSTART.md)
