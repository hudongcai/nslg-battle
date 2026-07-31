# 如何查看本地助手 WebSocket 连接日志

## 方式1：双击批处理文件（最简单）

**文件位置：** `C:\nslg-battle\local-helper\启动本地助手-查看日志.bat`

**操作步骤：**
1. 打开文件夹 `C:\nslg-battle\local-helper\`
2. 双击 `启动本地助手-查看日志.bat`
3. 会打开一个绿色的命令行窗口，显示所有日志

**看到的日志：**
```
══════════════════════════════════════════════════
  本地助手 - WebSocket 连接日志
══════════════════════════════════════════════════

[调试] 配置已加载: { apiBase: 'http://localhost:3000/api', hasToken: true, helperClientId: 1 }
[WebSocket] 连接到: ws://localhost:3000
🚀 本地助手已启动 v3.0-refactored
   API: http://localhost:3000/api
   配置: 已配置
✅ [WebSocket] 已连接到服务器          ← 这里！
✅ [WebSocket] 注册成功: 连接成功      ← 这里！
[首次启动] 打开浏览器: http://localhost:3000/?helperConnected=1
```

---

## 方式2：双击 PowerShell 脚本

**文件位置：** `C:\nslg-battle\local-helper\启动本地助手-查看日志.ps1`

**操作步骤：**
1. 打开文件夹 `C:\nslg-battle\local-helper\`
2. 右键点击 `启动本地助手-查看日志.ps1`
3. 选择 **"使用 PowerShell 运行"**
4. 会打开一个蓝色的 PowerShell 窗口，显示彩色日志

---

## 方式3：命令行启动（高级用户）

**打开 PowerShell 或 CMD，执行：**

```powershell
cd C:\nslg-battle\local-helper
node local-helper.js --no-prompt
```

所有日志会直接显示在当前窗口中。

---

## 方式4：使用现有的 UI 程序（但看不到 WebSocket 日志）

**文件位置：** `C:\nslg-battle\local-helper\helper-ui.ps1`

**注意：** 这个 UI 程序有图形界面，但 **看不到 WebSocket 连接日志**。
如果你想看日志，请用上面的方式 1 或 2。

---

## 关键日志说明

| 日志内容 | 含义 |
|---------|------|
| `[WebSocket] 连接到: ws://localhost:3000` | 开始连接 WebSocket |
| `✅ [WebSocket] 已连接到服务器` | 连接成功 |
| `✅ [WebSocket] 注册成功: 连接成功` | 本地助手已注册到服务器 |
| `[首次启动] 打开浏览器` | 自动打开浏览器（仅首次） |
| `[任务123] ✅ screenshot001.png` | 文件上传成功 |
| `⚠️ [WebSocket] 连接断开` | 与服务器断开连接 |
| `🔄 [WebSocket] 重新连接成功` | 自动重连成功 |

---

## 常见问题

### Q: 为什么看不到 WebSocket 连接日志？

**A:** 检查以下几点：
1. 后端服务是否运行？（访问 http://localhost:3000 看是否正常）
2. 配置文件是否正确？（`local-helper.config.json` 中有 `helperToken`）
3. 是否显示"未配置"？（说明配置文件加载失败）

### Q: 显示"[WebSocket] 未配置，跳过连接"怎么办？

**A:** 配置文件加载失败，通常是因为：
- 配置文件不存在
- 配置文件有 BOM（字节顺序标记）
- 配置文件格式错误

解决方法：
```powershell
cd C:\nslg-battle\local-helper
node -e "const fs = require('fs'); const config = { apiBase: 'http://localhost:3000/api', helperToken: 'helper-auth-398976a352767055230ff524c36e801f7411', taskFolders: { '1': 'C:\\nslg-battle\\screenshots\\4' }, helperClientId: 1, deviceId: 'device-1785377462977', lastFolderPath: 'C:\\nslg-battle\\screenshots\\4' }; fs.writeFileSync('local-helper.config.json', JSON.stringify(config, null, 2), 'utf8'); console.log('✅ 配置文件已修复');"
```

### Q: 如何停止本地助手？

**A:** 直接关闭日志窗口，或按 `Ctrl+C`

---

## 测试完整流程

1. **停止现有的本地助手**（如果有的话）
2. **双击** `启动本地助手-查看日志.bat`
3. **观察日志**，确认看到：
   - ✅ [WebSocket] 已连接到服务器
   - ✅ [WebSocket] 注册成功
4. **浏览器应该自动打开**（仅首次）
5. **按 F12 打开浏览器控制台**，查看：
   - `[本地助手] 检测到首次连接: 1`
   - `[本地助手] 上线: {...}`

---

## 快捷方式

你还可以创建桌面快捷方式：

1. 右键 `启动本地助手-查看日志.bat`
2. 选择 **"创建快捷方式"**
3. 把快捷方式拖到桌面
4. 重命名为 **"本地助手（查看日志）"**

以后只需双击桌面快捷方式即可启动并查看日志！
