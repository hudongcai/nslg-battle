# WebSocket 监控页面数据统计修复报告

## 问题描述

WebSocket 监控页面 (http://localhost:3000/websocket-monitor.html) 显示的"待处理"和"已完成"数字与实际情况严重不符。

### 具体表现
- 监控页面显示"已完成: 4"
- 但实际上已经处理了数千个文件
- 数据库 battle_gallery 表中有 2693 条记录

## 问题根源

### 原有逻辑
```javascript
// 只统计 ocr_pending_tasks 表
const [stats] = await pool.query(`
  SELECT
    COUNT(CASE WHEN status = 'pending' THEN 1 END) as pending,
    COUNT(CASE WHEN status = 'done' THEN 1 END) as processed,
    COUNT(CASE WHEN status = 'failed' THEN 1 END) as failed
  FROM ocr_pending_tasks WHERE helper_task_id = ?
`, [id]);
```

### 问题分析
1. **数据清理机制**：ocr_pending_tasks 中的记录处理完成后会被清理或删除
2. **统计范围错误**：只统计队列表，不统计最终存储表
3. **数据不完整**：ocr_pending_tasks 只有 4 条记录，但 battle_gallery 有 2693 条

## 修复方案

### 修改后的逻辑
```javascript
// 1. 队列统计（待处理、失败）
const [stats] = await pool.query(`
  SELECT
    COUNT(CASE WHEN status = 'pending' THEN 1 END) as pending,
    COUNT(CASE WHEN status = 'failed' THEN 1 END) as failed
  FROM ocr_pending_tasks WHERE helper_task_id = ?
`, [id]);

state.pendingCount = stats[0].pending || 0;
state.failedCount = stats[0].failed || 0;

// 2. 图库统计（真实的已完成数）
const [galleryStats] = await pool.query(`
  SELECT COUNT(*) as totalProcessed
  FROM battle_gallery
  WHERE project_id = ? AND uploaded_by = ? AND status = 1
`, [state.projectId, state.userId]);

state.processedCount = galleryStats[0].totalProcessed || 0;
```

### 修改的文件
- `nslg-backend.js` 第 526-548 行（updateTaskState 函数）
- `nslg-backend.js` 第 392-421 行（initializeTaskStates 函数）

## 修复效果

### 修复前
| 任务ID | 待处理 | 已完成 | 失败 |
|--------|--------|--------|------|
| 1      | 0      | 4      | 0    |
| 2      | 0      | 0      | 0    |
| 3      | 0      | 0      | 0    |
| 4      | 0      | 0      | 0    |

### 修复后
| 任务ID | 项目ID | 待处理 | 已完成 | 失败 |
|--------|---------|--------|--------|------|
| 1      | 1778470540662 | 0 | 6 | 0 |
| 2      | 1778470540653 | 0 | 29 | 0 |
| 3      | 1778470540661 | 0 | 1026 | 0 |
| 4      | 1778470540665 | 0 | 0 | 0 |

**总计：1061 个文件已完成**

## 验证步骤

1. 重启后端服务 ✅
2. 打开 http://localhost:3000/websocket-monitor.html
3. 查看"已完成"数字是否显示正确
4. 上传新文件，验证数字是否实时更新

## 技术说明

### 统计逻辑变更
- **待处理 (pendingCount)**：仍然统计 ocr_pending_tasks.status='pending'
- **已完成 (processedCount)**：改为统计 battle_gallery 表的记录总数
- **失败 (failedCount)**：仍然统计 ocr_pending_tasks.status='failed'

### 为什么这样修复？
1. **ocr_pending_tasks** 是临时队列表，记录会被清理
2. **battle_gallery** 是最终存储表，记录持久保存
3. 真实的"已完成"数应该从最终存储统计，而不是从临时队列统计

## 注意事项

1. **项目ID匹配**：统计时使用 project_id 和 user_id 双重过滤，确保数据准确
2. **性能影响**：每次更新都会查询 battle_gallery，对于大量数据可能有性能影响
3. **缓存优化**：后续可考虑添加缓存机制，减少数据库查询

## 完成时间
2026-07-30 22:15

## 相关文件
- nslg-backend.js (已修改)
- websocket-monitor.html (无需修改)
