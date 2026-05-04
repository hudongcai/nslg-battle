# 🚀 云端存储功能部署指南

## 概述

本文档描述如何部署"完整云端存储"功能，让项目数据存储在 Cloudflare D1 云端数据库，实现：
- ✅ 清除缓存后数据不丢失
- ✅ 多用户共享（有权限的用户能看到）
- ✅ 换设备也能访问自己的项目

---

## 第一步：创建 Cloudflare D1 数据库

### 1.1 安装 Wrangler CLI（如果还没有）

```bash
npm install -g wrangler
```

### 1.2 登录 Cloudflare

```bash
wrangler login
```

会打开浏览器，完成登录授权。

### 1.3 创建 D1 数据库

在 `nslg-battle-publish` 目录下执行：

```bash
wrangler d1 create nslg-database
```

**执行后会输出类似：**

```
✅ Successfully created database nslg-database
  - name: nslg-database
  - uuid: a1b2c3d4-e5f6-7890-abcd-ef1234567890
```

**⚠️ 重要**：复制 `uuid` 的值（例如：`a1b2c3d4-e5f6-7890-abcd-ef1234567890`）

---

## 第二步：更新 wrangler.toml

打开 `wrangler.toml` 文件，找到：

```toml
[[d1_databases]]
binding = "DB"
database_name = "nslg-database"
database_id = ""  # 创建 D1 数据库后填写 ID
```

**替换为实际的 uuid**：

```toml
[[d1_databases]]
binding = "DB"
database_name = "nslg-database"
database_id = "a1b2c3d4-e5f6-7890-abcd-ef1234567890"  # 替换成实际的 uuid
```

---

## 第三步：执行建表 SQL

创建数据库后，需要执行 `schema.sql` 来创建表结构：

```bash
wrangler d1 execute nslg-database --file schema.sql --remote
```

**预期输出：**

```
🌀 Executing on remote database nslg-database (a1b2c3d4-...):
🚣  To execute on your local machine, run `wrangler d1 execute nslg-database --local --file schema.sql`
```

**验证表是否创建成功：**

```bash
wrangler d1 list
```

应该能看到 `nslg-database` 数据库。

---

## 第四步：部署 Worker

更新代码和配置后，部署到 Cloudflare Workers：

```bash
wrangler deploy
```

**预期输出：**

```
✅ Successfully deployed nslg-ocr-proxy
```

---

## 第五步：测试云端功能

### 5.1 清除浏览器缓存

- 按 `Ctrl + Shift + R`（或 `Ctrl + F5`）
- 或者打开开发者工具（F12）→ 右键点击刷新按钮 → "清空缓存并硬性重新加载"

### 5.2 访问线上环境

打开：`https://www.zhenwu.fun`

### 5.3 登录超管账号

- 手机号：`13651810449`
- 密码：`hu6956521`

### 5.4 测试项目管理

1. **创建项目**：点击"新建项目"，填写信息并保存
2. **检查云端**：打开 Cloudflare Dashboard → D1 → nslg-database → 查询 `SELECT * FROM projects;`
3. **清除缓存测试**：清除浏览器缓存，重新登录，检查项目是否还在
4. **多用户测试**：创建普通用户，分享项目给该用户，检查是否能看到

### 5.5 测试战报管理

1. **上传战报**：在项目中选择战报并上传
2. **检查云端**：查询 `SELECT * FROM records;`
3. **清除缓存测试**：清除缓存后重新登录，检查战报是否还在

---

## 常见问题

### Q1: 执行 `wrangler d1 create` 提示 "Not authenticated"

**A**: 先执行 `wrangler login` 登录 Cloudflare。

### Q2: 执行 `schema.sql` 提示 "database not found"

**A**: 确保已经执行了 `wrangler d1 create nslg-database`，并且已经将 uuid 更新到 `wrangler.toml`。

### Q3: 部署后访问 API 提示 "D1_ERROR ..."

**A**: 检查 `wrangler.toml` 中的 `database_id` 是否正确，然后重新部署：

```bash
wrangler deploy
```

### Q4: 前端提示 "cloudSync is not defined"

**A**: 确保 `index.html` 中引入了 `cloud-sync.js`，并且它在其他 JS 文件之前加载。

检查 `index.html` 中是否有：

```html
<script src="cloud-sync.js?v=2026050401"></script>
<script src="data-system.js?v=2026050401"></script>
...
```

### Q5: 创建项目后，清除缓存就看不到了

**A**: 检查 `worker-pay.js` 中的 `handleCreateProject()` 函数是否被正确调用。打开开发者工具（F12）→ Network 标签，查看是否有 `/api/projects` 的请求。

如果没有请求，说明 `cloud-sync.js` 没有正确加载或者 `window.cloudSync` 没有定义。

---

## 数据库表结构

### projects（项目表）

| 字段 | 类型 | 说明 |
|------|------|------|
| id | TEXT | 项目 ID（主键） |
| name | TEXT | 项目名称 |
| description | TEXT | 项目描述 |
| creator_phone | TEXT | 创建者手机号 |
| visibility | TEXT | 可见性（public/private） |
| members | TEXT | 成员列表（JSON 数组） |
| battle_record_ids | TEXT | 战报 ID 列表（JSON 数组） |
| created_at | INTEGER | 创建时间（时间戳） |
| updated_at | INTEGER | 更新时间（时间戳） |

### records（战报表）

| 字段 | 类型 | 说明 |
|------|------|------|
| id | TEXT | 战报 ID（主键） |
| project_id | TEXT | 所属项目 ID（外键） |
| user_phone | TEXT | 上传者手机号 |
| data | TEXT | 战报数据（JSON 字符串） |
| created_at | INTEGER | 创建时间（时间戳） |
| updated_at | INTEGER | 更新时间（时间戳） |

### cloud_users（云端用户表）

| 字段 | 类型 | 说明 |
|------|------|------|
| phone | TEXT | 手机号（主键） |
| name | TEXT | 姓名 |
| password | TEXT | 密码（明文，生产环境应加密） |
| role | TEXT | 角色（super_admin/admin/member） |
| points | INTEGER | 积分 |
| created_at | INTEGER | 创建时间（时间戳） |
| updated_at | INTEGER | 更新时间（时间戳） |

### project_permissions（项目权限表）

| 字段 | 类型 | 说明 |
|------|------|------|
| id | TEXT | 权限记录 ID（主键） |
| phone | TEXT | 用户手机号（外键） |
| project_id | TEXT | 项目 ID（外键） |
| can_edit | INTEGER | 是否能编辑（0/1） |
| can_delete | INTEGER | 是否能删除（0/1） |
| granted_by | TEXT | 授权者手机号 |
| granted_at | INTEGER | 授权时间（时间戳） |

---

## 回滚计划

如果部署后出现问题，可以快速回滚：

### 方案 A：仅使用本地 IndexedDB

修改 `project-system.js` 和 `data-system.js`，注释掉云端同步代码：

```javascript
// 同步到云端（暂时禁用）
// if(window.cloudSync){
//   try{
//     await window.cloudSync.createProject(newProj);
//   }catch(e){console.error('[Cloud] 同步失败:', e);}
// }
```

### 方案 B：回滚 Worker 代码

在 Cloudflare Dashboard → Workers & Pages → nslg-ocr-proxy → Settings → Versioning 中，回滚到上一个版本。

---

## 下一步计划

完成部署并测试通过后，可以考虑：

1. **密码加密**：当前 `cloud_users` 表中密码是明文，生产环境应使用 bcrypt 等算法加密
2. **数据迁移**：将现有本地 IndexedDB 中的数据迁移到云端 D1 数据库
3. **离线支持**：当网络不可用时，使用本地缓存，网络恢复后自动同步
4. **冲突解决**：当多个用户同时编辑同一个项目时，需要冲突解决策略

---

## 联系支持

如果遇到问题，可以：
1. 查看 Cloudflare Workers 日志：Dashboard → Workers → nslg-ocr-proxy → Logs
2. 查看浏览器控制台：F12 → Console 标签
3. 联系开发者：hudongcai
