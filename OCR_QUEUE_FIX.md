# 自动解析队列修复记录

## 修复时间
2026-07-16 02:40

## 问题描述
**症状**: 自动战报解析列表只显示1个任务，其他7个待处理文件不显示

**用户反馈**:
- 控制台显示 pendingCount=7
- 但 pendingFiles=[] (空数组)
- 队列只显示 currentFile (1个)

## 问题分析

### 数据流追踪

```
监听目录 (C:\nslg-battle\screenshots\5)
    ↓
本地助手发现 8 个文件
    ↓
通过 /api/ocr-watch/tasks/:id/progress 上报
    ↓
存入 ocr_watch_tasks.pending_files_json
    ↓
前端请求 /api/ocr-watch/tasks?projectId=xxx
    ↓
❌ 服务器返回 pendingFiles: [] (硬编码空数组)
    ↓
前端只能显示 currentFile
```

### 根本原因

**文件**: `nslg-backend.js`

**问题1**: SQL查询缺少字段
```javascript
// 第 1876 行 - 原始SQL
SELECT id, user_id, ..., current_file, last_error, ...
// ❌ 没有查询 pending_files_json 字段
```

**问题2**: 硬编码空数组
```javascript
// 第 1924 行 - 原始代码
pendingFiles: [],  // ❌ 直接返回空数组
```

## 修复方案

### 修复1: SQL查询添加字段

**文件**: `nslg-backend.js` 行 1876

**修改前**:
```javascript
let sql = 'SELECT id, user_id, project_id, folder_path, status, 
           pending_count, processed_count, failed_count, current_file, 
           last_error, last_heartbeat, created_at, updated_at, 
           helper_client_id, ... FROM ocr_watch_tasks WHERE user_id = ?';
```

**修改后**:
```javascript
let sql = 'SELECT id, user_id, project_id, folder_path, status, 
           pending_count, processed_count, failed_count, current_file, 
           pending_files_json,  // ✅ 新增字段
           last_error, last_heartbeat, created_at, updated_at, 
           helper_client_id, ... FROM ocr_watch_tasks WHERE user_id = ?';
```

### 修复2: 解析并返回数据

**文件**: `nslg-backend.js` 行 1924

**修改前**:
```javascript
pendingFiles: [],  // ❌ 硬编码
```

**修改后**:
```javascript
pendingFiles: Array.isArray(r.pending_files_json) ? r.pending_files_json :
              (typeof r.pending_files_json === 'string' && r.pending_files_json ?
               JSON.parse(r.pending_files_json) : []),
```

### 修复3: 自动插入任务（附加优化）

**文件**: `nslg-backend.js` 行 2151

虽然前端不读取 `ocr_pending_tasks`，但为了数据完整性，我们也添加了自动插入逻辑：

```javascript
if (Array.isArray(pendingFiles) && pendingFiles.length > 0) {
  // 自动将新文件插入 ocr_pending_tasks 表
  for (const fileName of pendingFiles) {
    if (!existingFileNames.has(fileName)) {
      await pool.query(
        `INSERT INTO ocr_pending_tasks
         (user_id, project_id, image_name, helper_task_id, status)
         VALUES (?, ?, ?, ?, 'pending')`,
        [userId, projectId, fileName, taskId]
      );
    }
  }
}
```

## 完整数据流（修复后）

```
监听目录
    ↓
本地助手发现文件
    ↓
POST /api/ocr-watch/tasks/:id/progress
    {
      pendingFiles: ["file1.png", "file2.png", ...],
      currentFile: "processing.png",
      pendingCount: 7
    }
    ↓
服务器存入 ocr_watch_tasks.pending_files_json
    ↓
服务器同时插入 ocr_pending_tasks (status='pending')
    ↓
前端 GET /api/ocr-watch/tasks?projectId=xxx
    ↓
✅ 服务器返回真实的 pendingFiles 数组
    ↓
前端 renderOCRQueue() 显示:
    - 已完成: 1 个
    - 处理中: 1 个  
    - 等待中: 7 个
    ↓
✅ 用户看到完整队列
```

## 测试验证

### 测试环境
- 服务器: Node.js (PID: 124)
- 项目ID: 1778470540662
- 监听目录: C:\nslg-battle\screenshots\5
- 文件数量: 8个 (1个处理中 + 7个待处理)

### 测试步骤

1. **刷新浏览器** (Ctrl+Shift+R)
2. **进入项目**
3. **恢复监听**: 点击 "▶ 继续"
4. **等待3-5秒** 让助手上报状态
5. **查看队列**: 应该显示所有文件

### 验证命令

浏览器控制台:
```javascript
// 检查任务数据
console.log(window.ocrWatchTask.pendingFiles);
// 应该返回: ["file1.png", "file2.png", ...]

// 检查队列长度
console.log(window.ocrWatchTask.pendingFiles.length);
// 应该返回: 7 (不是 0)
```

## 相关问题

### 渲染进程崩溃

**症状**: "Render process gone"

**可能原因**:
1. 数据量过大导致内存溢出
2. 无限循环渲染
3. 浏览器扩展冲突

**建议**:
- 使用隐身模式测试
- 监控内存使用
- 减少每页显示数量

## 文件修改清单

- ✅ `nslg-backend.js` (2处修改 + 1处新增)
- ✅ `ocr-watch-v2.js` (1处修改 - 字段名兼容)

## 服务器重启记录

- 停止: PID 14272
- 启动: PID 124
- 状态: ✅ 正常运行
- MySQL: ✅ 已连接

## 后续建议

1. **监控**: 观察队列是否正常显示所有文件
2. **性能**: 如果文件数量很大 (>100)，考虑分页
3. **优化**: 可以考虑从 ocr_pending_tasks 表读取（更灵活）
4. **清理**: 定期清理已完成的旧任务

## 备注

- 数据库表诊断报告: `DATABASE_ANALYSIS.md`
- 所有表都在使用中，无冗余表
- 性能优化文档: `PERFORMANCE_OPTIMIZATION.md`
