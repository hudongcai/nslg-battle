# 三谋战报系统 (nslg-battle) — 项目上下文

启动：`node nslg-backend.js`（或 `./start-local.ps1` / `start-local.bat`）  
截图工具：`C:\AutoScreenshotTool2`（与战报系统配套，截图→分析，一键用 start-local 同时启动）  
访问：http://localhost:8080 | 超管：`13651810449` / `hu6956521`

## 架构

```
前端（GitHub Pages: www.zhenwu.fun）
  └─ cloud-sync.js → API
        ├─ 本地: http://localhost:3000/api
        └─ 生产: https://api.zhenwu.fun/api  ← Cloudflare 隧道

后端: nslg-backend.js (Express, port 3000)
  └─ MySQL: localhost:3306 / nslg_battle（用户: nslg-battle-server / hu6956521）

Cloudflare 隧道: bb55729a → api.zhenwu.fun → 127.0.0.1:3000
hosts文件: 127.0.0.1 api.zhenwu.fun（本机开发绕过）
```

## 数据库

关键表：`users`(含 credit_balance 字段), `roles`, `projects`, `battle_records`(含JSON generals/tactics), `battle_gallery`, `ocr_tasks`  
注意：`user_credits` 表已废弃，积分字段在 `users.credit_balance`。  
`battle_records` 双格式并存：新版 JSON 字段（`left_generals`/`right_generals`/`left_tactics` 等）+ 旧版平铺字段（`left_general_1` 等）。

## 关键文件

| 文件 | 说明 |
|---|---|
| `nslg-backend.js` | 完整后端，含认证、所有API |
| `cloud-sync.js` | 前端云端同步，含 CLOUD_API_BASE 判断 |
| `ocr-system.js` | OCR 前端解析链路 |
| `ocr_paddle_service.py` | PaddleOCR 后端服务 |
| `data-system.js` | 数据管理前端逻辑 |
| `user-system.js` | 用户管理前端逻辑 |

## API 响应格式

所有接口统一：`{ code: 200, data: [...] }`（data 直接是数组，**不是** `data.list`）

## ⚠️ 关键约束（修改前必读）

**OCR 解析**
- 玩家名中的 `|` 是合法分隔符（如"蔷薇|云初月"），**禁止**在任何地方 strip 或 split 它
- 战法列是固定槽位（槽1/槽2/槽3），空槽必须保留位置，**禁止**压缩移位
- OCR 识别到的武将/战法：左右两侧分开处理，右侧武将识别逻辑独立，**不共用**左侧逻辑

**数据同步**
- MySQL 是唯一数据源，IndexedDB 是只读缓存；同步方向永远是 MySQL → IndexedDB，**禁止反向写入**
- 前端渲染优先使用 cloudUsers（MySQL 来源），不绕道 IndexedDB 缓存

**日期处理**
- MySQL 连接必须保持 `dateStrings: true`，否则 DATE/DATETIME 被 JS Date 序列化为 UTC 导致日期偏移
- 前端展示日期统一用 `created_at` 字段，**不用** `battleDate`

**后端**
- 唯一生产后端是 `nslg-backend.js`，`server.js` 是 GitHub 展示用的简化版，**勿用于生产**
- PowerShell 不支持 `<` 文件重定向，执行 SQL 文件用 Bash tool

## 开机自启（Windows 计划任务）

- `nslg-battle-backend`：登录时运行 `node nslg-backend.js`
- `nslg-battle-cloudflared`：登录时运行 cloudflared 隧道

## 发布流程

```bash
git add <修改的文件>
git commit -m "描述"
git push   # 触发 GitHub Actions 自动部署到 GitHub Pages
```

当前版本 V1.7，功能完整。

## 工作规范

**需求确认**
- 收到功能需求后，先与用户确认理解是否正确，再动手实现
- 有歧义或设计选择时，列出方案让用户选择，不自行决定
