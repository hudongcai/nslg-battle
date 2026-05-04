# 版本记录 - 真武团三谋队伍克制分析工具

---

## V1.5 - 2026-05-03

### 📝 版本说明
导航系统重构版本，彻底修复了模块切换时内容叠加的 Bug。所有 tab 切换统一由 `switchTab()` 函数管理，确保每次切换只显示一个模块内容。

---

### 🗂️ 模块结构

#### 顶级导航（Top Nav）
由 `updateNavByRole()` 根据用户角色动态显示/隐藏：

| 按钮 ID | 模块名 | 点击行为 | 权限 |
|---------|--------|---------|------|
| `navProjectBtn` | 项目管理 | `showProjectHome()` | 所有登录用户 |
| `navLibraryBtn` | 武将战法库 | `switchTab('library', this)` | 依赖角色权限 |
| `navRankingBtn` | 数值排行 | `switchTab('ranking', this)` | 依赖角色权限 |
| `navPeijiangBtn` | 配将助手 | `switchTab('peijiang', this)` | 依赖角色权限 |
| `navYanwuBtn` | 演武助手 | `switchTab('yanwu', this)` | 依赖角色权限 |
| `navSystemBtn` | 系统配置 | `showSystemConfig()` | 仅超管 |

---

#### 模块详细内容

##### 1. 项目管理 (`tab-project`)
- **入口**: 点击「📁 项目管理」
- **子导航**: `projectSubNav`（进入项目后显示）
  - 📊 战报导入 (`switchTab('data', this)`)
  - ⚔️ 克制分析 (`switchTab('winrate', this)`)
  - ↩ 返回项目列表 (`exitProject()`)
- **主要 UI**:
  - 项目大色块卡片网格（`projectGrid`）
  - 每个卡片显示：项目名、描述、成员数、创建时间
  - 操作按钮：进入、编辑、删除
- **项目内页（tab-data）**:
  - 批量上传战报图片（拖拽/点击）
  - 战报图库（预览、全选、批量删除）
  - 数据底表（搜索、筛选、导出 CSV、清空）
- **项目内页（tab-winrate）**:
  - 敌方高频队伍分析
  - 队伍克制关系分析（含排序）
  - 克制关系总结（优势/劣势）
  - 针对性队伍推荐
  - 溯源功能（点击查看相关战报）
- **JS 文件**: `project-system.js`

##### 2. 武将战法库 (`tab-library`)
- **子标签页**:
  - 🗡️ 武将（`libSubHeroes`）
  - 📜 战法 (`libSubTactics`)
- **武将子模块**:
  - 搜索框（武将名/自带战法）
  - 筛选：阵营、品质、赛季、兵种、标签
  - 武将卡片网格（武力/智力/统率/先攻、缘分）
- **战法子模块**:
  - 搜索框（战法名/描述）
  - 筛选：类型、特征、品质、赛季
  - 战法卡片网格（发动率、描述）
- **JS**: 内联在 `index.html`（函数：`renderHeroes`, `renderTactics`, `switchLibSub`）

##### 3. 数值排行 (`tab-ranking`)
- **功能**: 武将数值排行
- **筛选**: 属性（武力/智力/统率/先攻）、阵营、品质
- **表格列**: 排名、武将、阵营、兵种、数值、自带战法、赛季、标签
- **JS**: 内联在 `index.html`（函数：`renderRanking`）

##### 4. 配将助手 (`tab-peijiang`)
- **功能**: 选择武将，自动推荐战法和缘分
- **UI**: 3 个武将选择槽位
- **输出**:
  - 推荐战法（每个武将的 `suggest_skills`）
  - 缘分显示（满足条件的 bonds）
- **JS**: 内联在 `index.html`（函数：`onPeijiangChange`）

##### 5. 演武助手 (`tab-yanwu`)
- **功能**: 我方队伍 vs 敌方队伍分析
- **UI**: 我方 3 人 + 敌方 3 人选择
- **输出**:
  - 我方队伍分析（武将、自带战法、数值）
  - 敌方队伍分析
  - 武力/智力对比
  - 缘分触发情况
- **JS**: 内联在 `index.html`（函数：`onYanwuChange`）

##### 6. 系统配置 (`tab-user/syslog/datamgmt/rolemanage`)
- **入口**: 点击「⚙️ 系统配置」（仅超管可见）
- **子导航**: `systemSubNav`
  - 👥 用户管理 (`switchTab('user', this)`)
  - 📋 系统日志 (`switchTab('syslog', this)`)
  - 🛡️ 角色管理 (`switchTab('rolemanage', this)`)
  - 📦 数据管理 (`switchTab('datamgmt', this)`)
- **用户管理（`tab-user`）**:
  - 用户表格（头像、姓名、手机号、角色、注册时间、操作）
  - 支持：重置密码、删除用户、角色变更
- **系统日志（`tab-syslog`）**:
  - 日志表格（时间、用户、角色、操作类型、详情、IP）
  - 搜索 + 类型筛选
  - 导出日志
- **数据管理（`tab-datamgmt`）**:
  - 导出所有数据（JSON 备份）
  - 从备份导入数据
  - 新账号数据迁移指南
- **角色管理（`tab-rolemanage`）**:
  - 角色卡片列表
  - 创建/编辑/删除角色
  - 权限开关配置
- **JS 文件**: `user-system.js`, `project-system.js`, `role-system.v2.js`

---

### 🔧 本版本修复的 Bug

1. **导航切换内容叠加**:
   - 根因：`exitProject()` 和 `showProjectHome()` 直接操作 `style.display`，绕过了 `switchTab` 的隐藏逻辑
   - 修复：改为调用 `switchTab('project', ...)` 统一处理
   - 同上修复 `showSystemConfig()`

2. **`switchTab` 隐藏不彻底**:
   - 根因：某些 tab 内容有内联 `style="display:block"`，`display='none'` 被覆盖
   - 修复：改用 `style.setProperty('display', 'none', 'important')` 强制隐藏

3. **`systemSubNav` 未纳入管理**:
   - 根因：`switchTab` 只处理了 `projectSubNav`，未处理 `systemSubNav`
   - 修复：新增 `SYS_TABS` 常量，`switchTab` 中同时管理两个子导航

4. **登出后导航状态未重置**:
   - 修复：`logout()` 中调用 `resetNavState()` 重置所有导航按钮和子导航

5. **`projectGrid` 跨 Tab 泄漏**:
   - 根因：项目卡片的 `onclick` 没有防御判断，切换到其他 Tab 后点击可能触发
   - 修复：`showProjectHome()` 切换 tab 后延迟渲染，`enterProject()` 中增加 `tabVisible` 防御

---

### 📦 文件版本（Cache Bust 版本号）

| 文件 | 版本号 | 最后修改 |
|------|--------|---------|
| `index.html` | - | 2026-05-03 |
| `data-system.js` | `?v=202605030050` | 2026-05-03 |
| `user-system.js` | `?v=202605022130` | 2026-05-02 |
| `project-system.js` | `?v=202605030050` | 2026-05-03 |
| `role-system.v2.js` | `?v=202605022130` | 2026-05-02 |
| `ocr-system.js` | `?v=20260502d` | 2026-05-02 |
| `diagnose.js` | `?v=202605030030` | 2026-05-03 |

---

### 💾 如何恢复到此版本

1. **保留此 `VERSION.md` 文件**
2. **回滚代码**：将各 JS 文件恢复到对应版本号的状态
3. **强制刷新浏览器**：`Ctrl + Shift + R`（清除缓存）
4. **验证模块切换**：依次点击各模块，确认无内容叠加

---

### 📌 注意事项

- **浏览器缓存**：每次修改 JS 文件后，必须更新 `index.html` 中对应的版本号（如 `v=202605030050`）
- **角色权限**：`updateNavByRole()` 读取 `getRolePermissions(roleId)` 动态显示导航按钮
- **超管账号**：手机 `13651810449`，密码 `hu6956521`
- **数据备份**：在「系统配置 → 数据管理」中导出 JSON 备份

---

## V1.6 - 2026-05-03（进行中）

### 📝 版本说明
在 V1.5 基础上，新增"新增用户"功能，并修复注册页面跳转 Bug。

---

### 🆕 新增功能

#### 1. 用户管理 — 新增用户按钮
- **位置**：`tab-user` 页面标题行右侧（仅超管可见）
- **交互**：点击"＋ 新增用户"→ 弹出 `addUserModal`
- **表单字段**：
  - 姓名（选填，不填则自动生成"用户xxxx"）
  - 手机号（必填，11位验证，重复检测）
  - 密码（必填，至少6位）
  - 角色（下拉选择，从 `roles` DB 动态加载，兜底显示内置角色）
- **提交**：`doAddUser()` → 写入 `SanMoUserDB` → 刷新用户表格 → 自动关闭弹窗
- **JS 函数**：`showAddUserModal()` / `closeAddUserModal()` / `doAddUser()`

#### 2. 注册页面跳转修复
- **根因**：`registerModal` 是 `loginOverlay` 的子元素，但 `showRegister()` 调用 `ov.classList.add('hidden')` 把父层隐藏了，导致注册弹窗也不可见
- **修复**：将 `registerModal` 移出 `loginOverlay`，成为独立元素
- **配套修复**：
  - `showRegister()`：显示 `registerModal`，隐藏 `loginOverlay`
  - `closeRegister()`：隐藏 `registerModal`，调用 `showLogin()` 回到登录页（避免用户卡在空白页）
- **HTML 结构变更**：`registerModal` 现在位于 `loginOverlay` 的关闭标签之后，是 `body` 的直接子元素

---

### 🔧 本版本修复的 Bug

1. **注册页面不显示**：
   - 根因：`registerModal` 嵌套在 `loginOverlay` 内，父层隐藏导致子元素不可见
   - 修复：HTML 结构调整为两者平级，`showRegister()` / `closeRegister()` 各自独立控制显示

2. **关闭注册弹窗后卡空白页**：
   - 根因：`closeRegister()` 只隐藏了弹窗，未恢复登录页
   - 修复：`closeRegister()` 末尾调用 `showLogin()`

3. **`showAddUserModal()` 角色下拉为空**：
   - 根因：`roleDBGetAll()` 返回空数组时，下拉没有选项
   - 修复：增加内置角色兜底（`super_admin` / `admin` / `member`），默认选中 `member`

---

### 📦 文件版本（Cache Bust 版本号）

| 文件 | 版本号 | 最后修改 |
|------|--------|---------|
| `index.html` | - | 2026-05-03 |
| `user-system.js` | `?v=2026050301` | 2026-05-03 |
| 其他 JS | 同 V1.5 | 未变更 |

---

### 📌 注意事项

- **浏览器缓存**：`user-system.js` 版本号已更新为 `v=2026050301`，用户需 `Ctrl+Shift+R` 硬刷新
- **新增用户权限**：仅超管能看到"新增用户"按钮（该按钮在 `tab-user` 内，`tab-user` 本身只有超管能进入）
- **注册流程**：修复后，点击"没有账号？注册" → 正确显示注册弹窗（独立遮罩）→ 点击 X 或"已有账号？登录" → 正确回到登录页

---

*更新时间：2026-05-03 01:30*
*更新人：AI 助手*


---

## V1.7 - 2026-05-03

### 📝 版本说明
新增「数据权限」模块，在系统配置下提供项目级别的用户访问授权管理。

---

### 🆕 新增功能

#### 数据权限（系统配置 → 🔐 数据权限）

**权限规则（优先级从高到低）：**

| 优先级 | 规则 | 说明 |
|--------|------|------|
| 1 | `super_admin` | 超管看全部项目 |
| 2 | `creator === 当前用户` | 自己创建的项目 |
| 3 | `memberPhones` 包含当前用户 | 被加为成员的项目 |
| 4 | `visibility === 'public'` | 公开项目所有人可见 |
| 5 | `projAccess` 授权表 | 超管额外授权（本版新增）|

**UI 功能：**
- 按项目展示权限矩阵：每个项目列出所有普通用户，并标注权限来源
- 权限来源标注：「创建者」/「成员」/「公开」/「已授权」/「无权限」
- 已授权用户可点击「撤销」，未授权用户可点击「授权」
- 授权/撤销操作写入系统日志

**数据存储：**
- 授权记录存储在 `SanMoUserDB` v3 → `projAccess` store
- 字段：`{id: phone+'_'+projectId, phone, projectId, grantedBy, grantedAt}`

**战报过滤联动：**
- `loadAllRecords()` 升级：普通用户的战报过滤改为基于 `getVisibleProjects()` 的结果，使授权的项目战报也对被授权用户可见

---

### 🔧 技术变更

- **新文件**：`data-perm.js`
- **DB 升级**：`SanMoUserDB` v2 → v3，新增 `projAccess` store
- **覆盖函数**：`window.getVisibleProjects` 由 `data-perm.js` 覆盖，加入授权表判断
- **修改文件**：
  - `index.html`：`systemSubNav` 新增「数据权限」按钮；新增 `tab-dataperm`；引入 `data-perm.js`
  - `data-system.js`：`SYS_TABS` 加入 `dataperm`；`switchTab` 加入 `dataperm` 渲染回调；`loadAllRecords` 改为按可见项目集合过滤战报
  - `user-system.js`：`openUserDB` 升级至 v3，添加 `projAccess` store 创建代码

---

*更新时间：2026-05-03 10:25*
*更新人：AI 助手*


