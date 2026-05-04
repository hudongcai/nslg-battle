# Cloudflare D1 数据库设置指南

## 第一步：安装 Wrangler CLI（如果还没有）

```bash
npm install -g wrangler
```

## 第二步：登录 Cloudflare

```bash
wrangler login
```

## 第三步：创建 D1 数据库

在 `nslg-battle-publish` 目录下执行：

```bash
wrangler d1 create nslg-database --config wrangler.toml
```

执行后会输出类似：
```
✅ Successfully created database nslg-database
  - name: nslg-database
  - uuid: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
```

**复制 `uuid` 的值**，然后更新 `wrangler.toml`：

```toml
[[d1_databases]]
binding = "DB"
database_name = "nslg-database"
database_id = "xxxx-xxxx-xxxx-xxxx"  # 替换成实际的 uuid
```

## 第四步：执行建表 SQL

```bash
wrangler d1 execute nslg-database --file schema.sql --remote
```

这会在远程 D1 数据库上执行 `schema.sql` 中的 SQL 语句，创建所有表。

## 第五步：验证数据库

```bash
wrangler d1 list
```

应该能看到 `nslg-database` 数据库。

## 第六步：部署 Worker

```bash
wrangler deploy --config wrangler.toml
```

---

## 常见问题

### Q: 提示 "you need to configure the D1 bindings in wrangler.toml"
A: 确保 `wrangler.toml` 中有 `[[d1_databases]]` 配置，并且 `database_id` 已填写。

### Q: 执行 SQL 时提示 "database not found"
A: 先执行 `wrangler d1 create` 创建数据库，获取 uuid 后再执行 SQL。

### Q: 本地测试怎么做？
A: 使用 wrangler 的本地开发模式：
```bash
wrangler dev --config wrangler.toml
```
这会自动创建本地 SQLite 数据库用于测试。
