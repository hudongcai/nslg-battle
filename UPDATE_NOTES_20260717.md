# 更新说明 - 2026年7月17日

## 修复内容

### 1. 修复网页登录问题 ✅
**问题：** 访问 https://www.zhenwu.fun/?setup=1 时，点击登录按钮无反应

**原因：** 
- XLSX 脚本标签未闭合（`<script>` 缺少 `</script>`）
- 导致所有后续 JS 文件失效，`getToken()` 函数未加载

**修复：**
- Commit ff76afb: 修复 XLSX 脚本标签闭合
- Commit 3ac299d: cloud-sync.js 和 user-system.js 改为同步加载

**状态：** ✅ 已部署到生产环境

---

### 2. 修复自动监听OCR缺失同盟信息 ✅
**问题：** 通过自动监听上传的战报，OCR 解析后左侧同盟和右侧同盟字段为空

**原因：**
本地助手在上传 OCR 任务时，没有传递 `labelConfig` 参数，导致后端执行 OCR 时无法使用项目配置的识别区域模板

**修复：**
- Commit 11e75d6: 修改 `local-helper.minimal.js`
  - 在上传任务前通过 `/api/label-config/:projectId` 获取项目的 OCR 模板配置
  - 将 `labelConfig` 作为参数传递给 `/api/battles/ocr-tasks` 接口

**影响范围：** 本地助手（需要重新打包和安装）

---

## 更新方法

### 前端更新（已自动完成）
前端代码已通过 GitHub Actions 自动部署到 https://www.zhenwu.fun

### 本地助手更新（需要手动操作）

**方式1：从源码打包（推荐开发者）**
```bash
# 1. 拉取最新代码
git pull origin main

# 2. 打包本地助手（需要先解决 pkg 网络问题或使用 nexe）
pkg local-helper.minimal.js -t node18-win-x64 -o local-helper.exe

# 或使用 nexe（无需下载额外运行时）
npm install -g nexe
nexe local-helper.minimal.js -o local-helper.exe
```

**方式2：等待官方发布**
等待管理员打包完成后，下载最新的 `local-helper.exe` 并替换

---

## 验证方法

### 验证登录修复
1. 访问 https://www.zhenwu.fun/?setup=1
2. 输入账号密码点击登录
3. 应该能正常进入主界面

### 验证OCR同盟识别修复
1. 更新本地助手到最新版本
2. 启动本地助手并激活自动监听
3. 放一张新的战报截图到监听目录
4. 等待自动上传和解析
5. 检查数据库或前端表格，左右同盟字段应该有值

---

## 技术细节

### 代码变更

**local-helper.minimal.js (uploadFile 函数)**
```javascript
// 获取项目的 OCR 模板配置
let labelConfig = null;
if (task.projectId) {
  try {
    const configData = await apiFetch(config, `/label-config/${task.projectId}`);
    if (configData && configData.code === 200 && configData.data) {
      labelConfig = configData.data.categories;
    }
  } catch (e) {
    console.warn('[uploadFile] 获取 labelConfig 失败:', e.message);
  }
}

// 传递 labelConfig（如果有）
if (labelConfig) {
  body.labelConfig = labelConfig;
}
```

### 数据流程
```
本地助手上传任务
  ↓ 获取 labelConfig
/api/label-config/:projectId
  ↓ 返回 OCR 模板配置
  ↓ 传递给
/api/battles/ocr-tasks
  ↓ 保存到
ocr_pending_tasks.label_config
  ↓ 执行 OCR 时使用
PaddleOCR 服务
  ↓ 正确识别同盟区域
战报数据完整
```

---

## 相关 Commit

- `ff76afb` - 修复关键bug：XLSX脚本标签未闭合导致后续所有JS文件失效
- `3ac299d` - 修复setup=1自动配置时getToken未定义问题：cloud-sync.js和user-system.js改为同步加载
- `11e75d6` - 修复自动监听OCR解析缺失右侧同盟：上传任务时获取并传递labelConfig

---

## 注意事项

1. **前端修复已生效**，无需用户操作
2. **本地助手需要更新**才能修复同盟识别问题
3. 已解析的旧战报不会自动更新，只有新上传的战报才会包含同盟信息
4. 如果对方玩家未加入同盟，右侧同盟字段仍然为空（这是正常的）

---

更新时间：2026年7月17日 01:00
