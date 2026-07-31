# WebSocket 双向通信方案 - 实现总结

## ✅ 已完成的功能

### 1. 后端 WebSocket 服务 (nslg-backend.js)

**新增内容：**
- ✅ 本地助手连接管理（`helperConnections` Map）
- ✅ WebSocket 事件处理：
  - `helper-register` - 本地助手注册连接
  - `send-to-helper` - 网页向本地助手发送命令
  - `helper-report` - 本地助手上报状态
  - `helper-online/offline` - 广播本地助手上线/离线事件
- ✅ API 接口：`/api/helpers/online` - 查询在线的本地助手列表
- ✅ 辅助函数：
  - `sendCommandToHelper()` - 向指定本地助手发送命令
  - `getOnlineHelpers()` - 获取在线助手列表

### 2. 本地助手 WebSocket 客户端 (local-helper/local-helper.js)

**新增内容：**
- ✅ Socket.IO 客户端连接
- ✅ 自动连接和重连机制
- ✅ 连接管理函数：
  - `connectWebSocket()` - 建立 WebSocket 连接
  - `disconnectWebSocket()` - 断开连接
  - `handleServerCommand()` - 处理服务器命令
  - `reportToServer()` - 上报状态到服务器
  - `openBrowserOnFirstConnection()` - 首次启动打开浏览器
- ✅ 实时进度上报：文件上传成功/失败时通知服务器

### 3. 网页前端 WebSocket 监听 (ocr-watch-v2.js)

**新增内容：**
- ✅ 监听本地助手事件：
  - `helper-online` - 本地助手上线
  - `helper-offline` - 本地助手离线
  - `helper-status` - 本地助手状态更新
- ✅ UI 更新函数：
  - `updateHelperStatus()` - 更新本地助手状态指示器
  - `handleHelperStatusUpdate()` - 处理状态更新（文件上传、任务绑定等）
  - `showHelperNotification()` - 显示 Toast 通知
- ✅ URL 参数检测：检测 `helperConnected` 参数显示欢迎消息

## 工作流程

### 场景 1：用户启动本地助手

```
1. 用户双击本地助手图标
   ↓
2. 本地助手启动 → 读取配置文件
   ↓
3. 连接 WebSocket: ws://localhost:3000
   ↓
4. 发送注册消息: { helperClientId, deviceId, token }
   ↓
5. 服务器验证并保存连接
   ↓
6. 服务器广播: helper-online 事件
   ↓
7. 网页收到通知 → 显示"✅ 本地助手已连接"
   ↓
8. (仅首次) 自动打开浏览器到: http://localhost:3000/?helperConnected=1
   ↓
9. 网页显示欢迎通知: "🎉 本地助手已成功连接！"
```

### 场景 2：实时文件上传通知

```
1. 本地助手扫描到新截图
   ↓
2. 上传文件到服务器 (HTTP API)
   ↓
3. 上传成功 → 通过 WebSocket 上报:
   reportToServer('file-uploaded', { taskId, fileName })
   ↓
4. 服务器收到 → 广播给网页
   ↓
5. 网页显示通知: "✅ 已上传: screenshot001.png"
   ↓
6. 刷新战报列表
```

### 场景 3：网页控制本地助手（预留功能）

```
1. 网页点击"绑定任务"
   ↓
2. 发送命令到服务器:
   socket.emit('send-to-helper', {
     helperClientId: 1,
     command: 'bind-task',
     payload: { taskId: 123 }
   })
   ↓
3. 服务器转发给本地助手
   ↓
4. 本地助手弹出文件夹选择对话框
   ↓
5. 用户选择文件夹 → 本地助手上报结果
   ↓
6. 网页收到通知 → 显示"✅ 任务绑定成功"
```

## 核心技术点

### 1. WebSocket 协议

- **后端**：使用 Socket.IO (`socket.io`)
- **本地助手**：使用 Socket.IO 客户端 (`socket.io-client`)
- **网页**：已有 Socket.IO 客户端连接

### 2. 连接管理

```javascript
// 后端维护连接映射
const helperConnections = new Map(); // helperClientId -> { socket, deviceId, connectedAt }

// 注册时保存
helperConnections.set(helperClientId, {
  socket: socket,
  deviceId: deviceId,
  connectedAt: new Date(),
  socketId: socket.id
});

// 断开时清理
socket.on('disconnect', () => {
  if (socket.isHelper) {
    helperConnections.delete(socket.helperClientId);
    io.emit('helper-offline', { helperClientId });
  }
});
```

### 3. 首次启动检测

```javascript
// 使用标记文件 .first-run-completed
const firstRunFlagPath = path.join(__dirname, '.first-run-completed');

if (!fs.existsSync(firstRunFlagPath)) {
  // 首次启动 → 打开浏览器
  fs.writeFileSync(firstRunFlagPath, new Date().toISOString());
  openBrowser(webUrl);
}
```

## 配置文件注意事项

**重要：避免 BOM (Byte Order Mark)**

配置文件 `local-helper.config.json` 必须是 **UTF-8 无 BOM** 格式，否则 Node.js 解析会失败。

生成方式：
```javascript
// 正确方式：用 Node.js 写入
const fs = require('fs');
fs.writeFileSync('config.json', JSON.stringify(config, null, 2), 'utf8');
```

避免：
- ❌ Windows 记事本保存（默认添加 BOM）
- ❌ PowerShell `Out-File`（可能添加 BOM）
- ✅ 使用 VS Code / Node.js 写入

## 测试验证

### 启动本地助手

```powershell
cd C:\nslg-battle\local-helper
node local-helper.js --no-prompt
```

**预期输出：**
```
[调试] 配置已加载: { apiBase: 'http://localhost:3000/api', hasToken: true, helperClientId: 1 }
[WebSocket] 连接到: ws://localhost:3000
🚀 本地助手已启动 v3.0-refactored
   API: http://localhost:3000/api
   配置: 已配置
✅ [WebSocket] 已连接到服务器
✅ [WebSocket] 注册成功: 连接成功
[首次启动] 打开浏览器: http://localhost:3000/?helperConnected=1
```

### 查询在线助手

```javascript
// 浏览器控制台
fetch('http://localhost:3000/api/helpers/online', {
  headers: { 'Authorization': 'Bearer mock-token-13800000000-1' }
})
.then(r => r.json())
.then(d => console.log('在线助手:', d.data));
```

**预期响应：**
```json
{
  "code": 200,
  "data": [
    {
      "helperClientId": 1,
      "deviceId": "device-1785377462977",
      "connectedAt": "2026-07-30T11:35:43.000Z",
      "socketId": "abc123"
    }
  ]
}
```

### 网页监听事件

```javascript
// 浏览器控制台
ocrWatchSocket.on('helper-online', (data) => {
  console.log('本地助手上线:', data);
});

ocrWatchSocket.on('helper-status', (data) => {
  console.log('本地助手状态:', data);
});
```

## 下一步扩展

### 可实现的功能

1. **远程控制本地助手**
   - 网页发送命令：开始/停止监听任务
   - 网页请求选择文件夹（通过本地助手弹出对话框）

2. **更丰富的实时通知**
   - 上传进度条（实时更新百分比）
   - OCR 识别进度
   - 错误详情推送

3. **多设备管理**
   - 在网页上查看所有在线的本地助手
   - 选择特定设备执行任务

4. **心跳保活**
   - 本地助手定期发送心跳
   - 服务器检测超时断线

## 故障排查

### 1. 本地助手无法连接 WebSocket

**检查：**
```powershell
# 后端是否运行
curl http://localhost:3000/api/auth/login

# 配置文件是否正确
node -e "console.log(require('./local-helper.config.json'))"
```

### 2. 配置文件解析失败

**症状：** `Unexpected token '﻿'`

**原因：** 文件有 BOM

**解决：**
```javascript
// 用 Node.js 重新生成
node -e "fs.writeFileSync('local-helper.config.json', JSON.stringify(config, null, 2), 'utf8')"
```

### 3. 浏览器未自动打开

**检查：**
```powershell
# 是否存在首次启动标记
Test-Path local-helper\.first-run-completed

# 删除后重新启动
Remove-Item local-helper\.first-run-completed
```

## 文件清单

### 修改的文件

1. **nslg-backend.js**
   - 添加：本地助手连接管理（约150行）
   - 添加：`/api/helpers/online` 接口

2. **local-helper/local-helper.js**
   - 添加：`socket.io-client` 依赖
   - 添加：WebSocket 连接管理（约150行）
   - 修改：主循环支持配置热更新和 WebSocket 重连
   - 添加：实时上报文件上传进度

3. **ocr-watch-v2.js**
   - 添加：监听本地助手事件（约60行）
   - 添加：状态更新和通知函数
   - 添加：URL 参数检测（首次连接欢迎）

### 新增依赖

```json
{
  "dependencies": {
    "ws": "^8.x",
    "socket.io-client": "^4.x"
  }
}
```

## 总结

✅ **本地助手主动连接网页**的 WebSocket 双向通信方案已完整实现：

1. 本地助手启动时自动连接服务器并注册
2. 首次启动自动打开浏览器
3. 实时双向通信：状态推送、进度通知
4. 网页可查询在线助手并接收实时通知
5. 为远程控制预留了扩展接口

用户体验：**用户只需启动本地助手，浏览器自动打开并显示连接成功，无需手动刷新或轮询检测。**
