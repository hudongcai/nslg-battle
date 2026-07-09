# 本地助手发布检查清单

## ✅ 已完成的调整

### 1. 核心功能修复
- [x] 修复重复提交已解析文件的问题
- [x] 本地助手在扫描时会查询后端已成功解析的文件列表
- [x] 合并本地状态和后端状态，避免重复提交

### 2. 配置调整
- [x] 默认API地址改为生产环境：`https://api.zhenwu.fun/api`
- [x] Setup提示文字优化，引导用户访问网页获取Token
- [x] 简化配置流程，API地址可直接回车使用默认值

### 3. 发布文件
- [x] `local-helper.minimal.js` - 主程序（已修复重复提交bug）
- [x] `启动助手.bat` - Windows一键启动脚本
- [x] `LOCAL_HELPER_README.md` - 详细使用文档
- [x] `downloads/local-helper.zip` - 打包好的发布包（7.37 KB）

### 4. 前端集成
- [x] 实现 `downloadLocalHelperPackage()` - 下载助手包
- [x] 实现 `connectLocalHelperWithMode()` - 显示配置Token
- [x] 实现 `manualRefreshHelperStatus()` - 刷新状态
- [x] 配置信息以模态框形式展示，用户友好

### 5. 后端支持
- [x] `/api/ocr-watch/helper-config` 接口生成Token
- [x] `/api/gallery/imagenames?successOnly=true` 接口返回已解析文件
- [x] 静态文件服务支持 `/downloads/local-helper.zip` 下载

## 📋 发布前检查项

### 后端检查
- [ ] 确认 Cloudflare 隧道运行正常：`https://api.zhenwu.fun`
- [ ] 确认 `/api/ocr-watch/helper-config` 接口可访问
- [ ] 确认 `/downloads/local-helper.zip` 可下载
- [ ] 确认 MySQL 数据库连接正常

### 前端检查
- [ ] 确认 `www.zhenwu.fun` 已部署最新版本
- [ ] 测试"下载本地助手"按钮功能
- [ ] 测试"首次链接助手"按钮功能
- [ ] 确认配置Token模态框正常显示

### 功能测试
- [ ] 在测试机器上完整走一遍用户流程：
  1. 下载助手包
  2. 解压到本地
  3. 运行 `启动助手.bat`
  4. 输入API地址（回车使用默认）
  5. 粘贴Token完成配置
  6. 助手成功启动
  7. 网页端配置监听任务
  8. 添加新截图验证自动上传
  9. 确认不会重复提交已解析的文件

## 📝 用户使用流程

### 首次使用
1. 用户访问 `www.zhenwu.fun` 并登录
2. 进入"自动解析"页面
3. 点击"下载本地助手"，浏览器下载 `local-helper.zip`
4. 解压到本地目录（如 `C:\三谋战报助手\`）
5. 双击运行 `启动助手.bat`
6. 首次运行会自动进入配置向导：
   - API地址：直接回车使用默认值
   - Token：回到网页点击"首次链接助手"，复制Token粘贴
7. 配置完成，助手自动启动
8. 在网页端选择监听目录，点击"运行"
9. 本地助手开始监听文件夹，自动上传新截图

### 日常使用
1. 双击 `启动助手.bat` 启动（或设置开机自启）
2. 在网页端管理监听任务（启动/停止/查看进度）
3. 截图工具保存到监听目录，自动解析

## ⚠️ 已知限制和注意事项

1. **Node.js 依赖**：用户需要自行安装 Node.js 18+
2. **网络要求**：需要能访问 `https://api.zhenwu.fun`
3. **单实例运行**：同一目录下只能运行一个助手实例
4. **Token安全**：Token存储在本地配置文件，用户应妥善保管
5. **文件夹权限**：监听的文件夹需要有读取权限

## 🚀 发布步骤

### 1. 准备发布文件
```bash
# 确保所有文件都已提交到 Git
git add local-helper.minimal.js 启动助手.bat LOCAL_HELPER_README.md downloads/
git commit -m "feat: 本地助手 v2.1 发布版本"
```

### 2. 部署前端
```bash
git push origin main
# GitHub Actions 自动部署到 www.zhenwu.fun
```

### 3. 验证部署
- 访问 `https://www.zhenwu.fun` 确认前端已更新
- 访问 `https://api.zhenwu.fun/downloads/local-helper.zip` 确认可下载
- 测试完整用户流程

### 4. 通知用户
- 更新用户文档
- 发布更新公告
- 提供技术支持渠道

## 📞 技术支持

如用户遇到问题，常见解决方案：
1. Token验证失败 → 重新获取Token
2. 网络连接失败 → 检查防火墙和网络
3. 重复提交文件 → 更新到v2.1版本
4. Node.js未安装 → 引导安装 https://nodejs.org

---

**版本**: v2.1  
**发布日期**: 2026-07-09  
**主要更新**: 修复重复提交bug，优化配置流程，生产环境就绪
