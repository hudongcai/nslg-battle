# OCR配置方案永久存储功能

## 功能概述

将OCR采集模板的配置方案从 **浏览器localStorage** 迁移到 **MySQL数据库**，实现跨环境、跨设备永久保存和访问。

## 实现内容

### 1. 数据库表结构

**表名：`ocr_schemes`**

```sql
CREATE TABLE ocr_schemes (
  id INT PRIMARY KEY AUTO_INCREMENT,
  name VARCHAR(100) NOT NULL,              -- 方案名称
  user_phone VARCHAR(20),                  -- 用户手机号
  image_width INT,                         -- 参考图片宽度
  image_height INT,                        -- 参考图片高度
  boxes JSON,                              -- 框坐标数组
  test_alliance_slots JSON,                -- 测试联盟槽位数据
  test_player_names JSON,                  -- 测试玩家名称
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY unique_name_user (name, user_phone),
  INDEX idx_user (user_phone)
);
```

### 2. 后端API接口

**位置：`nslg-backend.js` (第1952-2070行)**

#### 获取方案列表
- **接口：** `GET /api/ocr-schemes`
- **说明：** 获取当前用户的所有配置方案列表
- **返回：** `{ code: 200, data: [{id, name, image_width, image_height, created_at, updated_at}, ...] }`

#### 获取方案详情
- **接口：** `GET /api/ocr-schemes/:name`
- **说明：** 获取指定方案的完整数据（包括boxes坐标等）
- **返回：** `{ code: 200, data: {id, name, imageWidth, imageHeight, boxes, testAllianceSlots, testPlayerNames, ...} }`

#### 保存/更新方案
- **接口：** `POST /api/ocr-schemes`
- **说明：** 保存新方案或更新已有方案
- **参数：** `{name, imageWidth, imageHeight, boxes, testAllianceSlots, testPlayerNames}`
- **返回：** `{ code: 200, message: '保存成功' }`

#### 删除方案
- **接口：** `DELETE /api/ocr-schemes/:name`
- **说明：** 删除指定方案
- **返回：** `{ code: 200, message: '删除成功' }`

### 3. 前端改造

**文件：`ocr-region-editor.js`**

#### 核心函数改造
- `_getSchemeNames()` - 从API获取方案列表（原localStorage读取）
- `_getSchemeData(name)` - 从API获取方案数据（原localStorage读取）
- `_saveSchemeData(name, data)` - 保存到API（原localStorage保存）
- `_renderSchemeSelect()` - 异步加载方案下拉列表
- `leSaveConfig()` - 异步保存配置
- `leNewScheme()` - 异步创建新方案
- `leLoadScheme(name)` - 异步加载方案
- `leDeleteScheme()` - 异步删除方案（通过API）
- `leRestoreFromDB()` - 从数据库还原配置到方案
- `leCreateDefaultScheme()` - 创建默认方案
- `leExportSchemes()` - 导出方案到JSON
- `leImportSchemes()` - 从JSON导入方案

### 4. 用户身份识别

- 使用 `Authorization` header 中的 token 提取用户手机号
- 每个用户只能看到和操作自己的方案
- 方案通过 `(name, user_phone)` 联合唯一键确保同一用户不会重复方案名

## 使用流程

### 保存方案
1. 在 OCR采集模板设置页面调整框坐标
2. 点击"保存配置"或"新建方案"
3. 输入方案名称
4. ✅ 方案自动保存到云端数据库

### 跨环境使用
1. 在任意浏览器/设备登录同一账号
2. 进入 OCR采集模板设置
3. 下拉菜单自动显示所有已保存方案
4. 选择方案即可加载使用

### 绑定到项目
1. 选择要绑定的方案
2. 选择目标项目（或全局配置）
3. 点击"绑定生效"
4. 该方案的坐标会写入 `label_configs` 表，供OCR识别使用

## 技术特点

✅ **跨环境共享** - 数据存储在服务器，任何地方登录都能访问  
✅ **永久保存** - 不受浏览器缓存清理影响  
✅ **用户隔离** - 每个用户只能看到自己的方案  
✅ **向后兼容** - 保留导入/导出功能，支持JSON格式迁移  
✅ **原子操作** - 使用 `ON DUPLICATE KEY UPDATE` 确保保存/更新的原子性  

## 测试验证

### 后端API测试
```bash
# 获取方案列表
curl -H "Authorization: Bearer mock-token-13651810449-123" http://localhost:3000/api/ocr-schemes

# 保存方案
curl -X POST http://localhost:3000/api/ocr-schemes \
  -H "Authorization: Bearer mock-token-13651810449-123" \
  -H "Content-Type: application/json" \
  -d '{"name":"测试方案","imageWidth":2560,"imageHeight":1440,"boxes":[]}'

# 删除方案
curl -X DELETE http://localhost:3000/api/ocr-schemes/测试方案 \
  -H "Authorization: Bearer mock-token-13651810449-123"
```

### 前端功能测试
1. 登录 www.zhenwu.fun
2. 进入"系统配置 - OCR采集模板设置"
3. 上传图片并调整坐标
4. 点击"保存配置"，输入方案名
5. 刷新页面，验证方案下拉列表中能看到刚保存的方案
6. 换另一台电脑/浏览器登录同一账号，验证能看到相同的方案列表

## 部署说明

1. **数据库迁移**：已自动创建 `ocr_schemes` 表
2. **后端代码**：`nslg-backend.js` 已更新，需重启服务
3. **前端代码**：`ocr-region-editor.js` 已更新，需清除浏览器缓存或强制刷新

## 注意事项

- ⚠️ localStorage中的旧方案不会自动迁移，需要使用"导出"→"导入"功能手动迁移
- ⚠️ 方案名称在同一用户下必须唯一
- ⚠️ 保存方案不等于绑定到项目，还需要在"绑定生效"中选择方案并绑定

## 文件清单

- `create-ocr-schemes-table.sql` - 数据库表DDL
- `create-ocr-schemes-table.js` - Node.js创建表脚本
- `nslg-backend.js` - 后端API实现
- `ocr-region-editor.js` - 前端逻辑改造
- `restart-backend.bat` - 后端服务重启脚本

---
**实现日期：** 2026-07-27  
**实现人员：** Kiro AI Assistant  
**版本：** v1.0
