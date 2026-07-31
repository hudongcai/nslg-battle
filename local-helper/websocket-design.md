# 本地助手与网页 WebSocket 连接方案

## 架构设计

```
┌──────────────┐                    ┌─────────────────┐
│   网页前端    │ ←─── WebSocket ──→ │   后端服务器     │
│  (浏览器)     │                    │  (nslg-backend)  │
└──────────────┘                    └─────────────────┘
                                            ↑
                                      WebSocket
                                            ↓
                                    ┌─────────────────┐
                                    │   本地助手       │
                                    │ local-helper.js │
                                    └─────────────────┘
```

## 工作流程

### 1. 本地助手启动时

```javascript
// local-helper.js 启动时
async function connectToBackend(config) {
  const ws = new WebSocket(`ws://localhost:3000/helper-ws`);
  
  ws.on('open', () => {
    // 注册设备
    ws.send(JSON.stringify({
      type: 'register',
      helperClientId: config.helperClientId,
      deviceId: config.deviceId,
      token: config.helperToken
    }));
    
    console.log('✅ 已连接到服务器');
    
    // 打开网页
    const url = `http://localhost:3000/?helperConnected=${config.helperClientId}`;
    require('child_process').exec(`start ${url}`);
  });
  
  ws.on('message', (data) => {
    const msg = JSON.parse(data);
    handleServerCommand(msg);
  });
}

function handleServerCommand(msg) {
  switch (msg.type) {
    case 'bind-task':
      // 服务器通知：网页创建了新任务，请绑定文件夹
      showFolderPicker(msg.taskId);
      break;
    case 'start-task':
      // 开始监听任务
      startWatchingTask(msg.taskId);
      break;
    case 'stop-task':
      // 停止任务
      stopWatchingTask(msg.taskId);
      break;
  }
}
```

### 2. 后端服务器中继

```javascript
// nslg-backend.js
const wss = new WebSocketServer({ noServer: true });
const helperConnections = new Map(); // helperClientId -> WebSocket
const webConnections = new Map();    // sessionId -> WebSocket

// 本地助手连接
app.ws('/helper-ws', (ws, req) => {
  ws.on('message', (data) => {
    const msg = JSON.parse(data);
    
    if (msg.type === 'register') {
      helperConnections.set(msg.helperClientId, ws);
      
      // 通知所有网页：本地助手已上线
      broadcastToWeb({
        type: 'helper-online',
        helperClientId: msg.helperClientId
      });
    }
  });
  
  ws.on('close', () => {
    // 清理连接
    for (let [id, socket] of helperConnections) {
      if (socket === ws) {
        helperConnections.delete(id);
        
        // 通知网页：本地助手已离线
        broadcastToWeb({
          type: 'helper-offline',
          helperClientId: id
        });
      }
    }
  });
});

// 网页连接
app.ws('/web-ws', (ws, req) => {
  const sessionId = req.session.id;
  webConnections.set(sessionId, ws);
  
  ws.on('message', (data) => {
    const msg = JSON.parse(data);
    
    if (msg.type === 'bind-task') {
      // 网页请求绑定任务 → 转发给本地助手
      const helperWs = helperConnections.get(msg.helperClientId);
      if (helperWs) {
        helperWs.send(JSON.stringify({
          type: 'bind-task',
          taskId: msg.taskId
        }));
      }
    }
  });
});
```

### 3. 网页前端接收

```javascript
// ocr-watch-v2.js
let webWs = null;

function connectWebSocket() {
  webWs = new WebSocket('ws://localhost:3000/web-ws');
  
  webWs.onmessage = (event) => {
    const msg = JSON.parse(event.data);
    
    switch (msg.type) {
      case 'helper-online':
        // 本地助手上线
        showHelperStatus('已连接', 'online');
        enableMonitoringFeatures();
        break;
        
      case 'helper-offline':
        // 本地助手离线
        showHelperStatus('未连接', 'offline');
        disableMonitoringFeatures();
        break;
        
      case 'task-bound':
        // 本地助手已绑定任务
        showNotification('任务绑定成功');
        refreshTaskList();
        break;
        
      case 'file-uploaded':
        // 本地助手上传了新文件
        addFileToList(msg.fileName);
        updateProgress(msg.count);
        break;
    }
  };
}

// 页面加载时检测URL参数
window.addEventListener('DOMContentLoaded', () => {
  const params = new URLSearchParams(window.location.search);
  if (params.get('helperConnected')) {
    // 本地助手刚启动，显示欢迎提示
    showNotification('✅ 本地助手已连接');
  }
  
  connectWebSocket();
});
```

## 优势

1. **实时双向通信**：无需轮询，服务器推送
2. **用户体验好**：启动本地助手 → 自动打开网页 → 自动连接
3. **状态同步**：网页实时显示本地助手状态
4. **功能扩展性强**：
   - 网页可以远程控制本地助手（开始/停止监听）
   - 本地助手可以主动上报进度
   - 支持多设备管理

## 实施步骤

1. 后端添加 WebSocket 中继服务
2. 本地助手启动时连接 WebSocket + 打开浏览器
3. 网页前端监听 WebSocket 消息
4. 改进UI显示连接状态

## 回退兼容

保留现有的 HTTP 轮询方式作为后备：
- WebSocket 连接失败时，回退到 HTTP 轮询
- 支持旧版本浏览器
