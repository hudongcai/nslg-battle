# OCR队列架构说明

## 一、什么是OCR队列

OCR队列是一个**异步任务处理系统**，用于管理和处理战报图片的OCR识别任务。

### 核心组件

```
┌─────────────────────┐
│  本地助手/手动上传   │ ──→ 上传图片
└─────────────────────┘
           ↓
┌─────────────────────────────────────┐
│  ocr_pending_tasks 数据库表（队列）  │
│  - pending: 等待处理                 │
│  - processing: 处理中                │
│  - completed: 已完成                 │
│  - failed: 失败                      │
└─────────────────────────────────────┘
           ↓
┌─────────────────────┐
│  队列处理器          │ ──→ 持续轮询（每5秒）
│  processOcrQueue()  │
└─────────────────────┘
           ↓
┌─────────────────────┐
│  OCR任务执行         │
│  processOcrTask()   │ ──→ 调用PaddleOCR服务
└─────────────────────┘
           ↓
┌─────────────────────┐
│  保存到 battles 表   │
└─────────────────────┘
```

## 二、数据库表结构

### ocr_pending_tasks（OCR待处理任务队列）

| 字段 | 类型 | 说明 |
|------|------|------|
| id | INT | 主键 |
| user_id | INT | 用户ID |
| project_id | INT | 项目ID |
| image_base64 | LONGTEXT | 图片的Base64编码 |
| image_name | VARCHAR | 图片文件名 |
| status | VARCHAR | 状态：pending/processing/completed/failed |
| helper_task_id | INT | 本地助手任务ID（自动监听模式） |
| label_config | TEXT | OCR方案配置（JSON） |
| battle_date | DATE | 战报日期 |
| error_message | TEXT | 错误信息 |
| created_at | DATETIME | 创建时间 |
| updated_at | DATETIME | 更新时间 |

## 三、工作流程

### 3.1 自动监听模式（本地助手）

```
1. 本地助手扫描文件夹
   ↓
2. 发现新图片 → 上传到后端 /api/battles/ocr-tasks
   ↓
3. 后端插入记录到 ocr_pending_tasks（status=pending）
   ↓
4. 队列处理器自动检测到新任务
   ↓
5. 执行OCR识别
   ↓
6. 保存结果到 battles 表，更新队列状态
```

### 3.2 手动上传模式

```
1. 用户在网页上传图片
   ↓
2. 后端插入记录到 ocr_pending_tasks（status=pending）
   ↓
3. 队列处理器自动检测到新任务
   ↓
4. 执行OCR识别
   ↓
5. 保存结果到 battles 表，更新队列状态
```

## 四、队列处理器（processOcrQueue）

### 位置
`nslg-backend.js` 第1680-1751行

### 工作机制

**持续轮询模式**：
- 启动后进入无限循环 `while(isProcessingQueue)`
- 每5秒查询一次 `ocr_pending_tasks` 表
- 发现 `status='pending'` 的任务就处理
- 没有任务时等待5秒后继续检查

**优先级**：
```sql
ORDER BY
  CASE WHEN helper_task_id IS NOT NULL THEN 0 ELSE 1 END,
  created_at ASC
```
- 有 `helper_task_id` 的任务（自动监听）优先处理
- 同优先级按创建时间排序

**心跳机制**：
- 每次循环更新 `queueProcessorHeartbeat = Date.now()`
- Watchdog每60秒检查一次心跳
- 超过120秒无心跳则判定为无响应，自动重启

**并发控制**：
- 同一时间只有一个队列处理器实例运行
- `isProcessingQueue` 标志防止重复启动
- 每处理完一张图片冷却3秒

## 五、OCR任务执行（processOcrTask）

### 位置
`nslg-backend.js` 第1756-1950行

### 处理步骤

1. **验证图片数据**
   - 检查 Base64 数据是否有效
   - 验证长度 > 100

2. **检查用户积分**
   - 查询 `users.credit_balance`
   - 积分不足则失败

3. **获取字典数据**
   - 武将名字典
   - 战法名字典
   - 玩家名字典
   - 联盟名字典

4. **调用 PaddleOCR 服务**
   ```javascript
   POST http://localhost:8866/ocr
   {
     image: "base64...",
     heroNames: [...],
     tacticNames: [...],
     playerNames: [...],
     allianceNames: [...],
     labelConfig: {...}  // OCR方案配置
   }
   ```

5. **保存识别结果**
   - 插入到 `battles` 表
   - 保存原始OCR结果到 `battle_ocr_raw` 表
   - 扣除用户积分
   - 更新队列状态为 `completed`

6. **错误处理**
   - 任何步骤失败都标记为 `failed`
   - 记录错误信息到 `error_message` 字段

## 六、关键设计改进

### 6.1 解耦架构（2026-07-30）

**问题**：之前上传API会触发队列处理
```javascript
// ❌ 旧设计
setImmediate(() => processOcrQueue());
```

**解决**：移除触发，队列处理器独立轮询
```javascript
// ✅ 新设计
// 队列处理器会自动轮询处理，无需手动触发
```

### 6.2 持续运行（2026-07-30）

**问题**：之前处理器在队列为空时会退出
```javascript
// ❌ 旧设计
if (!tasks.length) break;
```

**解决**：改为无限循环，空闲时等待
```javascript
// ✅ 新设计
if (!tasks.length) {
  await new Promise(r => setTimeout(r, 5000));
  continue;
}
```

### 6.3 心跳健壮性（2026-07-30）

**问题**：错误处理catch块中缺少心跳更新

**解决**：在所有等待点都更新心跳
```javascript
} catch (loopErr) {
  console.error('[OCR-Queue] 循环内部错误:', loopErr.message);
  await new Promise(r => setTimeout(r, 5000));
  queueProcessorHeartbeat = Date.now();  // ✅ 添加心跳
}
```

## 七、监控工具

### 7.1 查看队列状态（一次性）
```batch
查看OCR队列状态.bat
```
显示当前待处理、处理中任务数量，以及最近10条任务记录。

### 7.2 实时监控（持续）
```batch
监控OCR队列.bat
```
每10秒刷新一次队列状态，显示各状态任务数量和最后更新时间。

### 7.3 查看后端日志
队列处理器的运行日志会输出到控制台：
```
[OCR-Queue] 队列处理器开始持续轮询...
[OCR-Queue] 任务 3897 处理失败: 积分不足
[OCR-Queue] 处理器无响应，重启...
```

## 八、故障排查

### 8.1 队列任务一直是 pending 状态

**原因**：
- 队列处理器未启动
- 队列处理器崩溃
- 心跳超时被watchdog杀死

**检查**：
```bash
# 查看后端日志是否有 "[OCR-Queue] 队列处理器开始持续轮询..."
# 查看是否有 "处理器无响应" 警告
```

### 8.2 任务变成 failed 状态

**常见原因**：
- 积分不足
- PaddleOCR服务未启动（8866端口）
- 图片格式错误
- 数据库连接失败

**检查**：
```bash
# 查看 error_message 字段
node check-ocr-queue.js
```

### 8.3 队列处理器频繁重启

**原因**：
- 心跳更新失败
- 处理任务时发生阻塞
- 数据库查询超时

**检查**：
```bash
# 查看日志中 "处理器无响应，重启..." 的频率
# 检查数据库连接状态
```

## 九、性能参数

| 参数 | 值 | 说明 |
|------|------|------|
| 轮询间隔 | 5秒 | 队列为空时的等待时间 |
| 处理冷却 | 3秒 | 每处理完一张图片的等待时间 |
| 心跳超时 | 120秒 | watchdog判定无响应的阈值 |
| 检查间隔 | 60秒 | watchdog检查心跳的频率 |
| 任务超时 | 10分钟 | processing状态任务会被重置为pending |

## 十、未来优化方向

1. **并发处理**：支持多个队列处理器并行处理任务
2. **优先级队列**：支持紧急任务插队
3. **失败重试**：自动重试失败任务（带指数退避）
4. **统计监控**：队列长度、处理耗时、成功率等指标
5. **任务分片**：大批量上传时自动分批处理
