# 战报自动化重设计方案 v2.0

## 设计目标
- 极简：一键开始，无复杂配置
- 独立：每个项目完全隔离，互不影响
- 透明：核心数据一目了然

---

## 一、架构概述

```
┌─────────────────────────────────────────────────────────────────┐
│                         网页前端                                  │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐          │
│  │  首次设置    │→ │  任务控制    │→ │  进度展示    │          │
│  └──────────────┘  └──────────────┘  └──────────────┘          │
└─────────────────────────────────────────────────────────────────┘
                              ↓ ↑
┌─────────────────────────────────────────────────────────────────┐
│                       后端 API (Express)                         │
│  - 任务管理接口                                                   │
│  - 进度更新接口                                                   │
│  - OCR 上传接口                                                   │
└─────────────────────────────────────────────────────────────────┘
                              ↓ ↑
┌─────────────────────────────────────────────────────────────────┐
│                  本地助手（纯后台，无UI）                          │
│  local-helper.minimal.js                                         │
│  - 轮询监听文件夹                                                 │
│  - 上传新文件到后端                                               │
│  - 更新进度状态                                                   │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│                       MySQL 数据库                                │
│  ocr_watch_tasks 表                                              │
└─────────────────────────────────────────────────────────────────┘
```

---

## 二、数据库设计

### ocr_watch_tasks 表

```sql
CREATE TABLE ocr_watch_tasks (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  user_id BIGINT NOT NULL,
  project_id BIGINT NOT NULL,
  folder_path VARCHAR(512) NOT NULL DEFAULT '',
  status ENUM('idle','running','paused','error') NOT NULL DEFAULT 'idle',
  pending_count INT DEFAULT 0,
  processed_count INT DEFAULT 0,
  processed_files_json JSON DEFAULT NULL,
  last_error VARCHAR(500) DEFAULT '',
  last_heartbeat DATETIME,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_user_project (user_id, project_id),
  KEY idx_user_project (user_id, project_id)
);
```

**说明：**
- `processed_files_json`：存储已处理文件名列表（JSON数组），用于数据库侧统计和防重复
- 后端定期与本地助手同步此字段（每次进度上报时同步）
- 助手首次启动时从服务器拉取此字段作为初始 processedFiles

**字段说明：**
| 字段 | 说明 |
|------|------|
| user_id | 用户ID（权限隔离） |
| project_id | 项目ID（项目隔离） |
| folder_path | 监听目录路径（未设置时为空字符串） |
| status | idle=空闲, running=运行中, paused=暂停, error=错误 |
| pending_count | 待处理数量（当前扫描到但未上传的文件数） |
| processed_count | 已处理数量（本轮轮询中成功上传的文件总数） |
| last_error | 最后错误信息 |
| last_heartbeat | 最后心跳时间 |

**核心约束：**
- 一个用户 + 一个项目 = 唯一一个任务
- 确保项目完全独立

---

## 三、后端 API 设计

### 1. 获取当前项目任务
```
GET /api/ocr-watch/tasks?projectId=xxx
Authorization: Bearer {token}

Response:
{
  "code": 200,
  "data": {
    "id": 1,
    "projectId": 1778470540663,
    "folderPath": "C:\\Screenshots",  // 未设置时为空字符串 ""
    "status": "running",
    "pendingCount": 5,
    "processedCount": 120,
    "processedFilesJson": ["file1.png", "file2.png"],  // 已处理文件列表
    "lastError": "",
    "lastHeartbeat": "2026-07-06 10:30:00"
  }
}
```

### 2. 创建/更新任务
```
POST /api/ocr-watch/tasks
Authorization: Bearer {token}
Body: {
  "projectId": 1778470540663,
  "folderPath": "C:\\Screenshots"  // 可选，未设置时传空字符串 ""
}

逻辑：
- 如果 user_id + project_id 不存在：创建新任务，status = idle
- 如果已存在：更新 folderPath，status 保持不变

Response:
{
  "code": 200,
  "data": { "id": 1 }
}
```

### 3. 控制任务
```
POST /api/ocr-watch/tasks/:id/control
Authorization: Bearer {token}
Body: {
  "action": "start" | "pause" | "resume" | "stop"
}

Response:
{
  "code": 200,
  "message": "操作成功"
}
```

**状态转换：**
- start/resume → running（从 idle/paused/error 都可以）
- pause → paused
- stop → idle

**特殊情况：**
- `folderPath` 为空时，任何操作都保持 idle，返回错误提示
- error 状态点击"开始"时，清空 lastError，变为 running

### 4. 助手进度上报
```
POST /api/ocr-watch/tasks/:id/progress
Authorization: Bearer {helperToken}
Body: {
  "pendingCount": 5,
  "processedCount": 120,
  "processedFilesJson": ["file1.png", "file2.png"],  // 同步已处理文件列表
  "lastError": "",
  "lastHeartbeat": "2026-07-06 10:30:00"
}

Response:
{
  "code": 200,
  "message": "进度已更新"
}
```

---

## 四、本地助手设计

### 配置文件 local-helper.config.json

```json
{
  "apiBase": "http://127.0.0.1:3000/api",
  "helperToken": "helper-auth-token-here",
  "userId": 12345,
  "tasks": {}
}
```

### tasks 结构（本地缓存）

```json
{
  "1": {
    "projectId": 1778470540663,
    "folderPath": "C:\\Screenshots",  // 可能为空字符串 ""
    "processedFiles": ["screenshot1.png", "screenshot2.png"]
  }
}
```

**说明：**
- `folderPath` 为空时，该任务不参与轮询
- 本地缓存记录已处理的文件名，防止重复上传

### 核心逻辑

```javascript
// 0. 首次启动：同步已处理文件列表
GET /api/ocr-watch/tasks
  → 从响应中获取 processedFilesJson，填充本地 processedFiles

// 1. 定期获取任务列表（每 5 秒）
GET /api/ocr-watch/tasks
  → 获取当前用户所有任务（所有状态都获取，用于状态变化检测）

// 2. 轮询处理
每 5 秒：
  for each task in running tasks:
    // 跳过未设置目录的任务
    if (!task.folderPath || task.folderPath.trim() === '') {
      continue;
    }
    files = 扫描文件夹
    newFiles = files - processedFiles
    pendingCount = newFiles.length
    for each file in newFiles:
      try {
        uploadFile(file)  // POST /api/battles/ocr-upload
        processedFiles.add(file)
      } catch (error) {
        // 上传失败，记录错误但继续处理下一个
        lastError = file + ': ' + error.message
      }
    // 更新进度（包括 pendingCount 和 processedFilesJson）
    updateProgress({
      pendingCount,
      processedCount: processedFiles.size,
      processedFilesJson: Array.from(processedFiles),
      lastError
    })

// 3. 错误处理
捕获上传错误 → 更新 lastError → 继续处理下一个文件
  - 连续 3 次失败 → 标记任务为 error，暂停 60 秒后重试

// 4. 心跳
每次轮询后更新 lastHeartbeat
  - 超过 5 分钟未更新 → 状态标记为 offline（前端显示）

---

## 五、前端界面设计

### UI 布局

```
┌─────────────────────────────────────────────────────────────┐
│  战报自动监听                                                │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  监听目录: [待设置目录]                    [选择目录]       │
│            或: C:\Screenshots                  [选择目录]    │
│                                                             │
│  状态: ✅ 运行中                                              │
│                                                             │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  📊 处理进度                                         │   │
│  │                                                     │   │
│  │    待处理: 5    已处理: 120                         │   │
│  │                                                     │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  [  开始  ]  [  暂停  ]  [  停止  ]                        │
│                                                             │
│  最后更新: 2026-07-06 10:30:00                              │
│  错误信息: 无                                               │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

**说明：**
- `folderPath` 为空字符串时，显示 `[待设置目录]`
- 已设置时显示实际路径
- 未设置目录时，任务状态强制为 `idle`，无法开始

**按钮状态规则：**
| 当前状态 | 开始 | 暂停 | 停止 | 说明 |
|----------|------|------|------|------|
| running | 禁用 | 启用 | 启用 | 运行中不能重复开始 |
| paused | 启用(继续) | 禁用 | 启用 | 暂停后可以继续或停止 |
| idle | 启用 | 禁用 | 禁用 | 空闲状态只能开始 |
| error | 启用(恢复) | 禁用 | 启用 | 错误状态可以恢复或停止 |
| offline | 全禁用 | 全禁用 | 全禁用 | 助手离线，提示用户检查 |

**状态显示规则：**
- running → `✅ 运行中` (绿色)
- paused → `⏸️ 已暂停` (黄色)
- idle → `💤 空闲` (灰色)
- error → `❌ 错误` (红色)
- offline (lastHeartbeat > 5min) → `🔴 助手离线` (暗红色)

**前端刷新逻辑：**
- 页面加载时：获取任务数据
- 进入项目时：每 5 秒刷新一次任务状态
- 用户操作后：立即刷新（如点击开始、暂停）
- 错误时：显示错误提示 toast

### 首次设置引导（如果有任务未设置目录）

```
┌─────────────────────────────────────────────────────────────┐
│  ⚙️ 战报自动监听设置                                         │
│                                                             │
│  说明：设置后，助手会自动监听截图文件夹并上传解析。           │
│                                                             │
│  监听目录: [____________________]  [选择目录]               │
│                                                             │
│  [  保存设置  ]                                              │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

**逻辑：**
- 如果 `folderPath` 为空，自动显示此引导弹窗
- 保存后，`folderPath` 更新为实际路径，状态为 `idle`

---

## 六、用户流程

### 首次设置
1. 用户进入某个项目
2. 系统检测到该项目无监听任务
3. 显示"首次设置引导"弹窗
4. 用户选择监听目录，点击保存
5. 后端创建任务，状态为 idle

### 开始监听
1. 用户点击"开始"按钮
2. 前端检查 `folderPath` 是否为空，为空则提示先设置目录
3. 前端调用 API 将状态改为 running
4. 本地助手检测到任务状态变化，开始轮询
5. 助手扫描文件夹，上传新文件，更新进度

### 暂停/继续/停止
1. 用户点击对应按钮
2. 前端调用 API 更新状态
3. 助手根据新状态调整行为（停止/继续轮询）

### 修改设置
1. 用户点击"选择目录"
2. 重新选择目录
3. 前端调用 API 更新 folderPath
4. 如果任务正在运行，助手切换到新目录继续轮询
5. **重要**：切换目录后，清空 processedFiles（避免跨目录重复检测）

### 助手离线检测
1. 前端每 5 秒刷新任务数据
2. 检测 `lastHeartbeat` 是否超过 5 分钟
3. 如果超时，显示"助手离线"提示
4. 提示用户检查本地助手是否运行

---

## 七、状态说明

| 状态 | UI 显示 | 行为 |
|------|---------|------|
| idle | 空闲 (灰色) | 助手不轮询 |
| running | 运行中 (绿色) | 助手每5秒轮询一次 |
| paused | 已暂停 (黄色) | 助手不轮询 |
| error | 错误 (红色) | 助手继续尝试，显示错误信息 |

**状态控制规则：**
- `folderPath` 为空时，强制状态为 `idle`，无法开始，返回错误提示
- 点击"开始" → 状态变为 `running`，清空 `lastError`
- 点击"暂停" → 状态变为 `paused`
- 点击"停止" → 状态变为 `idle`，清空 `pendingCount`
- `lastHeartbeat` 超过 5 分钟 → 前端显示为 offline，但数据库保持原状态

---

## 八、核心数据展示

### 必须展示
- ✅ 待处理数量 (pendingCount)
- ✅ 已处理数量 (processedCount)
- ✅ 当前状态 (status + 颜色指示)
- ✅ 最后更新时间 (lastHeartbeat)
- ✅ 错误信息 (lastError，如有)

### 不展示
- ❌ 发现数量 (与待处理重复)
- ❌ 失败数量 (错误信息已足够)
- ❌ 当前文件 (变化太快，无意义)
- ❌ 上传速率 (非核心指标)

---

## 九、权限隔离

### 数据库层面
- `UNIQUE KEY uk_user_project (user_id, project_id)` 确保唯一性
- 查询时强制过滤 `WHERE user_id = ? AND project_id = ?`

### API 层面
- 所有接口都验证 `user_id` 权限
- 用户只能看到自己项目的任务

### 前端层面
- 当前项目下只显示当前项目的任务
- 切换项目时刷新任务数据

---

## 十、本地助手简化

### 新助手 vs 旧助手对比

| 特性 | 旧助手 | 新助手 |
|------|--------|--------|
| UI窗口 | 有复杂桌面UI | 无UI，纯后台 |
| 连接码 | 需要10分钟有效期连接码 | 直接配置token |
| 协议唤起 | 需要zhenwu-helper://协议 | 无需协议 |
| 启动方式 | 双击桌面图标 | 命令行/后台运行 |
| 状态展示 | 独立UI窗口展示 | 网页前端展示 |
| 目录选择 | 助手窗口选择 | 网页选择 |

### 启动方式

```bash
# 命令行启动
node local-helper.minimal.js

# 后台启动（Windows）
start /B node local-helper.minimal.js > helper.log 2>&1

# 开机自启（Windows计划任务）
# 登录时运行：node C:\nslg-battle\local-helper.minimal.js
```

### 配置方式

```bash
# 首次运行时配置
node local-helper.minimal.js --setup

# 交互式输入配置：
# API地址: http://127.0.0.1:3000/api
# Helper Token: xxx-xxx-xxx
# 用户ID: 12345
```

---

## 十一、清理计划（待实施时删除）

### 需要删除的文件/代码

**后端 (nslg-backend.js):**
- ❌ `local_helper_clients` 表相关代码
- ❌ `local_helper_link_tokens` 表相关代码
- ❌ `/api/local-helper/*` 所有路由（替换为 `/api/ocr-watch/*`）
- ❌ `folder_watch_config.json` 相关代码

**前端 (ocr-system.js):**
- ❌ `helperClientStatus` 变量及相关代码
- ❌ `helperTaskList` 变量及相关代码
- ❌ `connectLocalHelperWithMode` 函数
- ❌ `linkLocalHelperWithFeedback` 函数
- ❌ `generateHelperLinkToken` 函数
- ❌ `waitForLinkTokenConsumed` 函数
- ❌ `openLocalHelperProtocol` 函数
- ❌ `showHelperLinkDialog` 函数
- ❌ 整个 `helper-ui.ps1` 本地助手UI

**保留：**
- ✅ `downloadLocalHelperPackage` 函数（用于下载新助手）
- ✅ OCR 上传和解析逻辑
- ✅ 项目管理逻辑

---

## 十二、实施步骤

### Phase 1: 后端重构
1. 创建新的 `ocr_watch_tasks` 表
2. 删除旧的 helper 表和路由
3. 实现新的 API 接口

### Phase 2: 本地助手重构
1. 删除 `local-helper` 目录（已备份）
2. 创建 `local-helper.minimal.js`
3. 实现纯后台轮询逻辑

### Phase 3: 前端重构
1. 删除 helper 相关 UI 代码
2. 实现新的简洁 UI
3. 实现首次设置引导

### Phase 4: 测试
1. 测试首次设置流程
2. 测试任务控制（开始/暂停/停止）
3. 测试进度展示
4. 测试权限隔离

---

## 十三、后续优化（可选）

1. **Web Worker 前端轮询**：使用 Web Worker 替代 `setInterval` 避免阻塞主线程
2. **增量刷新**：只刷新变化的数据，减少渲染开销
3. **离线提示**：检测助手离线，提示用户检查
4. **批量上传**：一次上传多个文件，减少请求次数

---

## 十四、边界情况与注意事项

### 1. 并发控制
- **问题**：如果用户在网页切换目录的同时，助手正在上传文件，如何处理？
- **解决**：目录变更时，助手立即停止当前轮询，等待下次轮询（5秒后）使用新目录

### 2. 文件删除处理
- **问题**：如果用户在助手上传前删除了文件，如何处理？
- **解决**：助手上传前检查文件是否存在，不存在则跳过

### 3. 助手崩溃恢复
- **问题**：助手崩溃重启后，如何恢复进度？
- **解决**：
  - 助手首次启动时从服务器拉取 `processedFilesJson`
  - 本地缓存 `processedFiles`，每次轮询同步到服务器

### 4. 网络断开处理
- **问题**：网络断开时，助手如何处理？
- **解决**：
  - 上传失败重试 3 次
  - 连续 3 次失败 → 标记任务为 error，暂停 60 秒后重试
  - 恢复后继续未完成的文件

### 5. 大文件处理
- **问题**：如果截图文件过大（>10MB），如何处理？
- **解决**：
  - 限制单文件大小为 5MB
  - 超过限制的文件跳过，记录到 lastError

### 6. 文件名编码问题
- **问题**：如果文件名包含中文或特殊字符，如何处理？
- **解决**：
  - 文件名使用 UTF-8 编码
  - 上传时 URL 编码文件名

### 7. 多用户隔离
- **问题**：确保一个用户看不到另一个用户的任务？
- **解决**：
  - 数据库强制过滤 `WHERE user_id = ?`
  - API 验证 token 对应的 user_id
  - 前端只显示当前用户的项目

### 8. 项目切换
- **问题**：用户在不同项目间切换时，如何保持助手状态？
- **解决**：
  - 每个项目独立任务，助手同时处理多个项目
  - 前端切换项目时只刷新当前项目的任务数据

### 9. 助手更新
- **问题**：如何更新本地助手？
- **解决**：
  - 在网页提供"下载新版本"按钮
  - 用户下载后替换旧文件，重启助手

### 10. 数据库清理
- **问题**：`processed_files_json` 字段可能过大，如何清理？
- **解决**：
  - 定期清理 7 天前的文件名（保留最近处理的 1000 个）
  - 或者只保留文件名哈希（MD5），减少存储空间

---

## 十五、设计自查总结

### 已优化的问题

| 类别 | 问题 | 优化方案 |
|------|------|----------|
| **逻辑** | 创建/更新任务未区分 | API 增加"已存在则更新"逻辑 |
| **逻辑** | error 状态如何恢复 | 开始时清空 lastError |
| **逻辑** | 助手获取任务不完整 | 改为获取所有状态的任务 |
| **数据流** | processedFiles 缓存无备份 | 新增 `processed_files_json` 字段 |
| **数据流** | 切换目录后重复检测 | 切换目录时清空 processedFiles |
| **交互** | 按钮状态不明确 | 增加详细的状态-按钮映射表 |
| **交互** | 状态显示不直观 | 改为带图标的单行显示 |
| **交互** | 离线检测缺失 | 新增 5 分钟心跳超时检测 |
| **体验** | 目录未设置时仍可开始 | 前端和后端双重验证 |
| **体验** | 错误无法清除 | 开始时自动清空错误信息 |
| **体验** | 并发切换目录冲突 | 助手延迟 5 秒生效 |

### 设计确认要点

✅ **核心流程简化**：首次设置 → 选择目录 → 开始，无复杂连接
✅ **项目独立**：一个用户一个项目一个任务，数据库强约束
✅ **UI 极简**：只展示状态、待处理、已处理、错误信息
✅ **无依赖**：助手纯后台，无需 UI 窗口和协议唤起
✅ **可靠性**：processedFiles 双重缓存（本地+数据库），支持崩溃恢复
✅ **可维护**：删除大量旧代码，只保留核心逻辑

### 待确认的问题

1. **Helper Token 获取方式**：首次安装时如何获取？
   - 建议：用户登录网页后，在设置页面生成并显示 token

2. **开机自启**：是否需要默认开机自启？
   - 建议：用户首次运行时询问是否开机自启

3. **多项目支持**：助手是否支持同时监听多个项目？
   - 已设计：支持，助手轮询所有 running 状态的任务

### 1. 并发控制
- **问题**：如果用户在网页切换目录的同时，助手正在上传文件，如何处理？
- **解决**：目录变更时，助手立即停止当前轮询，等待下次轮询（5秒后）使用新目录

### 2. 文件删除处理
- **问题**：如果用户在助手上传前删除了文件，如何处理？
- **解决**：助手上传前检查文件是否存在，不存在则跳过

### 3. 助手崩溃恢复
- **问题**：助手崩溃重启后，如何恢复进度？
- **解决**：
  - 助手首次启动时从服务器拉取 `processedFilesJson`
  - 本地缓存 `processedFiles`，每次轮询同步到服务器

### 4. 网络断开处理
- **问题**：网络断开时，助手如何处理？
- **解决**：
  - 上传失败重试 3 次
  - 连续 3 次失败 → 标记任务为 error，暂停 60 秒后重试
  - 恢复后继续未完成的文件

### 5. 大文件处理
- **问题**：如果截图文件过大（>10MB），如何处理？
- **解决**：
  - 限制单文件大小为 5MB
  - 超过限制的文件跳过，记录到 lastError

### 6. 文件名编码问题
- **问题**：如果文件名包含中文或特殊字符，如何处理？
- **解决**：
  - 文件名使用 UTF-8 编码
  - 上传时 URL 编码文件名

### 7. 多用户隔离
- **问题**：确保一个用户看不到另一个用户的任务？
- **解决**：
  - 数据库强制过滤 `WHERE user_id = ?`
  - API 验证 token 对应的 user_id
  - 前端只显示当前用户的项目

### 8. 项目切换
- **问题**：用户在不同项目间切换时，如何保持助手状态？
- **解决**：
  - 每个项目独立任务，助手同时处理多个项目
  - 前端切换项目时只刷新当前项目的任务数据

### 9. 助手更新
- **问题**：如何更新本地助手？
- **解决**：
  - 在网页提供"下载新版本"按钮
  - 用户下载后替换旧文件，重启助手

### 10. 数据库清理
- **问题**：`processed_files_json` 字段可能过大，如何清理？
- **解决**：
  - 定期清理 7 天前的文件名（保留最近处理的 1000 个）
  - 或者只保留文件名哈希（MD5），减少存储空间