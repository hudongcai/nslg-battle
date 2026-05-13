# 三谋战报系统 (nslg-battle) — 项目上下文

## 服务启动

```bash
# 后端（必须先启动）
cd /c/Users/Administrator/nslg-battle
node nslg-backend.js &

# 前端（本地测试用）
/c/Users/Administrator/.workbuddy/binaries/python/versions/3.13.12/python.exe -m http.server 8080 &

# Cloudflare 隧道
cloudflared tunnel --config "C:\Users\Administrator\.cloudflared\config.yml" run &
```

访问：http://localhost:8080  
超管账号：`13651810449` / `hu6956521`

## 架构

```
前端（GitHub Pages: www.zhenwu.fun）
  └─ cloud-sync.js → API
        ├─ 本地: http://localhost:3000/api
        └─ 生产: https://api.zhenwu.fun/api  ← Cloudflare 隧道

后端: nslg-backend.js (Express, port 3000)
  └─ MySQL: localhost:3306 / nslg_battle
        用户: nslg-battle-server / hu6956521

Cloudflare 隧道: bb55729a → api.zhenwu.fun → 127.0.0.1:3000
hosts文件: 127.0.0.1 api.zhenwu.fun (本机开发绕过)
```

## 数据库（9张表，已从15张精简）

| 表 | 说明 |
|---|---|
| `users` | 用户主表，含积分字段 credit_balance/credit_total_earned/credit_total_consumed |
| `roles` | 角色定义（JSON permissions） |
| `projects` | 项目 |
| `project_members` | 项目成员 |
| `battle_records` | 战报（含 JSON 字段：left/right_generals, tactics） |
| `battle_gallery` | 战报图片（OCR溯源用） |
| `ocr_tasks` | OCR任务队列 |
| `credit_logs` | 积分变动日志 |
| `system_logs` | 系统操作日志 |

**注意**：`user_credits` 表已合并进 `users`，不再存在。后端所有积分操作直接读写 `users.credit_balance`。

## 关键文件

| 文件 | 说明 |
|---|---|
| `nslg-backend.js` | 完整后端（917行），含认证、所有API |
| `server.js` | 简化版后端（GitHub上），勿用于生产 |
| `cloud-sync.js` | 前端云端同步模块，含 CLOUD_API_BASE 判断 |
| `user-system.js` | 用户管理前端逻辑 |
| `project-system.js` | 项目管理前端逻辑 |
| `data-system.js` | 数据管理前端逻辑 |

## Token 机制

后端登录返回 `mock-token-{timestamp}`，前端用 `Authorization: Bearer {token}` 携带。  
`/api/auth/profile` 用 `token.split('-').pop()` 取末段当 phone——**这是已知设计问题**，timestamp 不是 phone，该接口实际上无法正常工作，但其他接口不依赖它。

## API 响应格式

大部分接口：`{ code: 200, data: [...] }`  
`/api/users`：`{ code: 200, data: [...] }`（直接数组，**不是** `data.list`）  
`/api/battles`：`{ code: 200, data: [...] }`

## 已修复的 Bug

1. **CORS 错误**：`cloud-sync.js` 中 API 地址从 `http://` 改为 `https://api.zhenwu.fun`
2. **删除用户云端不生效**：旧服务器 DELETE 端点假成功；现已切换到 `nslg-backend.js`
3. **`list.find is not a function`**：`user-system.js` 4处取用户列表，改为兼容写法：
   ```js
   const list = Array.isArray(userData.data) ? userData.data : ((userData.data && userData.data.list) || []);
   ```

## 开机自启（Windows 计划任务）

- `nslg-battle-backend`：登录时自动运行 `node nslg-backend.js`
- `nslg-battle-cloudflared`：登录时自动运行 cloudflared 隧道

## 发布流程

本地测试完成后：
```bash
cd /c/Users/Administrator/nslg-battle
git add <修改的文件>
git commit -m "描述"
git push   # 触发 GitHub Actions 自动部署到 GitHub Pages
```

## 版本状态

当前版本 V1.7，功能完整。  
未实现功能：演武助手存DB、阵型方案存DB（前端有UI，但数据仅存IndexedDB）。  
`/api/stats/storage` 端点不存在，`cloudGetStorageStats()` 是死代码。
