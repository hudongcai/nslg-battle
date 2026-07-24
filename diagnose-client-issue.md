# 客户监听问题诊断指南

## 当前症状
- ✅ 本地助手显示"4个全部通过"
- ❌ 网页显示任务状态"等待中"
- ❌ 没有图片上传
- ❌ 客户机器的 Node.js 报错：`Unknown column 'folder_status'`

## 需要确认的关键问题

### 1. 客户机器上运行的是什么 Node.js 进程？

**请在客户机器上执行：**
```powershell
Get-Process node | ForEach-Object {
    $proc = $_
    $cmdLine = (Get-WmiObject Win32_Process -Filter "ProcessId = $($proc.Id)").CommandLine
    Write-Host "PID: $($proc.Id)"
    Write-Host "命令行: $cmdLine"
    Write-Host "启动时间: $($proc.StartTime)"
    Write-Host ""
}
```

**期望结果：**
- 应该只有一个 node 进程：`node local-helper.js`
- 如果有 `node nslg-backend.js`，那就是问题所在！

### 2. 客户的本地助手配置

**检查本地助手配置文件：**
```powershell
Get-Content "C:\...\local-helper\local-helper.config.json" | ConvertFrom-Json | ConvertTo-Json -Depth 10
```

**检查项：**
- `apiBase` 是否是 `https://api.zhenwu.fun/api`
- `helperToken` 是否存在
- `deviceId` 是否存在

### 3. 客户的本地助手日志

**查看最新日志：**
```powershell
Get-Content "C:\...\local-helper\helper-worker.log" -Tail 50
Get-Content "C:\...\local-helper\helper-worker.err.log" -Tail 50
```

## 可能的问题原因

### 情况 A：客户机器上运行了旧版后端
**症状：** 客户机器上有 `node nslg-backend.js` 进程

**原因：** 客户不应该运行后端，只需要运行本地助手

**解决方案：**
1. 停止客户机器上的 nslg-backend.js
2. 只运行本地助手（local-helper.js）

### 情况 B：客户使用了旧版本的本地助手
**症状：** 本地助手代码版本过旧，调用了不存在的接口

**解决方案：**
1. 下载最新版本安装包
2. 重新安装本地助手

### 情况 C：客户连接到了错误的 API
**症状：** apiBase 配置错误，连接到本地而非生产环境

**解决方案：**
1. 修改 `local-helper.config.json` 中的 `apiBase` 为 `https://api.zhenwu.fun/api`
2. 重启本地助手

## 诊断步骤

1. **执行步骤 1**：确认客户机器上运行的 Node.js 进程
2. **根据结果选择解决方案**
3. **验证修复**：在监听目录放入新图片，检查是否上传成功

## 联系我

完成诊断后，请告诉我：
- 客户机器上运行的 Node.js 进程命令行
- 本地助手配置文件内容
- 最新的日志内容

我会给出具体的解决方案。
