# 战报 OCR 系统健康诊断方案

> 诊断日期：2026-06-20  
> 范围：OCR 识别 → 解析 → 数据库存储 → 前端展示 全链路

---

## 一、数据流全景

```
┌──────────┐    ┌─────────────────────────────────────────────────┐    ┌──────────┐
│ PaddleOCR │───→│  mapPaddleResult()  (ocr-parser.js:233)         │───→│  MySQL   │
│ :8003     │    │  winnerMap → correctByDatabase → setFlat       │    │battle_   │
│ (Python)  │    │  数组→24个扁平列 + JSON数组双写                  │    │records   │
└──────────┘    └─────────────────────────────────────────────────┘    └──────────┘
                                                                             │
                                                                     GET /api/battles
                                                                             │
                                                                             ▼
                                                              ┌─────────────────────┐
                                                              │  index.html 前端     │
                                                              │  allRecords[]       │
                                                              │  renderDataTable()  │
                                                              │  28列表格展示        │
                                                              └─────────────────────┘
```

**三条核心路径：**
| 阶段 | 文件 | 函数/位置 |
|------|------|-----------|
| OCR 识别 | `ocr_paddle_service.py` | `extract_with_config()` → 标注配置驱动 |
| 解析入库 | `ocr-parser.js:233` | `mapPaddleResult()` → winnerMap + correctByDatabase + setFlat |
| 前端展示 | `index.html:1936` | `renderDataTable()` → 28列表格 |

---

## 二、问题清单（按严重程度排序）

### 🔴 P0 — 严重问题（建议优先处理）

#### P0-1. 数据库双写冗余（battle_records 表）
**现状：** 每条战报同时存储两份相同数据：
- 4 个 JSON 数组列：`left_generals`, `right_generals`, `left_tactics`, `right_tactics`
- 24 个扁平列：`left_general_1..3`, `left_tactic_1_1..3_3`, `right_*` (对称)

**影响：** 每行 ~50%+ 冗余存储，INSERT/UPDATE 写入翻倍，查询返回字段数过多

**建议方案：**
- **选项A（推荐）：** 删掉 24 个扁平列，保留 JSON 数组列。前端 `getGenerals()`/`getTactics()` 改为从数组取值。前端代码极小改动——`getGenerals(r, 'left')` 改为读 `r.left_generals`（已存在但当前未用）
- **选项B：** 删掉 JSON 数组列，保留扁平列。减少前端改动，但查询需要携带更多列名
- 无论选哪个，INSERT 语句从 54 个参数减少到约 30 个

---

#### P0-2. 两套武将/战法字典并存且不同源
**现状：**
| 字典 | 位置 | 用途 | 数据量 |
|------|------|------|--------|
| `game-data.json` | 文件系统 | `correctByDatabase()` 纠错 | ~200+ 武将/战法 |
| `ocr_hero_dict` / `ocr_tactic_dict` | MySQL | API 传给 PaddleOCR 做匹配 | 管理员可维护 |

**影响：**
- 两套字典需要独立维护，容易不同步
- `correctByDatabase()` 用 Levenshtein 做**第二次**纠正（PaddleOCR 已经用 MySQL 字典匹配过一次）
- 两次纠正用不同字典，可能产生不一致结果——PaddleOCR 输出"诸葛亮"（MySQL dict 匹配），但 `correctByDatabase()` 用 game-data.json 重新 Levenshtein 匹配可能改为别的名字

**建议方案：**
- **删除 `correctByDatabase()` 的二道纠正**，信任 PaddleOCR 的匹配结果
- 或将 `correctByDatabase()` 改为直接查询 MySQL 字典做精确匹配（不做 Levenshtein 模糊匹配）
- 长远：`game-data.json` 改为从 MySQL 导出，或取消 game-data.json 中的 heroNames/allTactics

---

### 🟠 P1 — 中等问题

#### P1-1. 死代码：`parseOCRResponse()` (ocr-parser.js:91-229, 138行)
- 仅在模块中定义和导出，**从未被调用**
- `nslg-backend.js:5` 虽然 import 了它，但整个后端没有任何地方调用
- 前端 HTML 内 `parseDoubaoResponse()` (line 1270) 有**独立重复实现**
- **建议：** 删除，或合并前端 `parseDoubaoResponse()` 到此后统一维护

#### P1-2. 死代码：`OCR_PROMPT` 常量 (ocr-parser.js:274-358, 85行)
- 定义的详细 OCR Prompt 导入到后端但从未使用
- 前端 `callDoubaoAPI()` 有自己内联的 prompt 文本
- **建议：** 删除，或让前端引用此常量（但需要解决前后端共享问题）

#### P1-3. 字段命名混乱：attacker_name vs leftPlayer
**现状：**
| 层面 | 左方玩家 | 右方玩家 |
|------|----------|----------|
| PaddleOCR 输出 | `leftPlayer` | `rightPlayer` |
| DB 列名 | `attacker_name` | `enemy_name` |
| 前端 IndexedDB | `leftPlayer` | `rightPlayer` |
| API body 兼容 | `attackerName` / `attacker_name` | `enemyName` / `enemy_name` |

**影响：** "attacker"（攻击方）的命名容易误导——左方不一定是攻击方，胜方也不一定是左方。前端和 OCR 层统一用 left/right 语义，但 DB 层用了 attacker/enemy。

**建议方案：**
- **短期：** 统一 API 响应增加 `leftPlayer`/`rightPlayer` 别名，前端直接用（无需改动 DB）
- **长期：** DB 列重命名 `attacker_name`→`left_player`, `enemy_name`→`right_player`（需要迁移脚本）

#### P1-4. API 层过度兼容（两处重复的字段名适配代码）
- `POST /api/battles`: lines 806-832 (~27行) 
- `PUT /api/battles/:id`: lines 956-989 (~34行)
- 都支持 `camelCase` + `snake_case` + 数组格式 + 扁平格式的排列组合
- 逻辑完全相同，但以代码重复形式存在

**建议方案：**
- 抽取 `normalizeBattleBody(body)` 公共函数
- 收敛为单一命名规范（推荐 camelCase 的 OCR 原始格式）

---

### 🟡 P2 — 优化建议

#### P2-1. Levenshtein 距离重复计算无缓存
- `correctByDatabase()` 对每条记录的所有武将/战法都跑完整字典的 Levenshtein
- Python 端 `best_match()` 同样逻辑
- 对于已匹配过的 OCR 错误模式（如"陆逊"常被误读为"陆孙"），每次都重新计算
- **建议：** 加简单的 LRU 缓存 `Map<raw, corrected>`

#### P2-2. battle_count 冗余 UPDATE 查询
- 每次新增/删除战报后，单独执行：
  ```sql
  UPDATE projects SET battle_count = (SELECT COUNT(*) FROM battle_records WHERE project_id=?), updated_at=NOW()
  ```
- 共 3 处：`POST /api/battles`, `POST /api/battles/ocr-upload`, `DELETE /api/battles/:id`
- **建议：** 改为 DB 触发器自动维护，或项目查询时实时 COUNT（更快，无额外写入）

#### P2-3. 图片存储优化
- `battle_gallery.image_data` 存 base64 字符串（比二进制大 ~33%）
- 每次 GET `/api/gallery/image/:battleId` 都要 `Buffer.from(raw, 'base64')` 解码
- **建议：** 存储为 `LONGBLOB`，免除编解码开销

#### P2-4. Python 端逐列重新 OCR（战术识别）
- `process_side()` 为 6 个武将位置各跑一次 `ocr_region()`——每次调用完整的 PaddleOCR 推理
- 加上全图 OCR，总共 7 次 PaddleOCR 推理/每张图
- **建议：** 全图 OCR 已经覆盖所有文字，尝试只用全图结果按坐标分配（当前 `analyze_battle` 的做法），列 OCR 作为补充即可

---

### 🟢 P3 — 轻微问题

#### P3-1. FORMATIONS 列表硬编码在 Python 端
- `ocr_paddle_service.py:39`: `['一字阵', '箕形阵', '雁形阵', '方圆阵', '锥形阵', '鱼鳞阵', '钩行阵', '偃月阵']`
- 如果游戏新增阵型，需要同步改代码
- **建议：** 移到 `game-data.json` 或 MySQL 配置表

#### P3-2. `parseDoubaoResponse()` 前端重复实现
- `index.html:1270` 有独立 LLM 文本解析逻辑
- 与 `ocr-parser.js` 的 `parseOCRResponse()` 高度相似但有细节差异
- **建议：** 后续若保留 LLM 路径，统一到服务端 `parseOCRResponse()`，前端只调 API

#### P3-3. 数据库缺少显式索引
- 当前未见 `battle_records` 的显式索引创建
- 高频查询 pattern: `WHERE project_id=?`, `WHERE project_id=? AND battle_date=?`, `ORDER BY created_at DESC`
- **建议：** 添加 `INDEX idx_project (project_id)`, `INDEX idx_project_date (project_id, battle_date)`, `INDEX idx_created (created_at)`

---

## 三、建议执行顺序

| 优先级 | 任务 | 预期收益 | 风险 |
|--------|------|----------|------|
| 1 | P1-1/P1-2 删除死代码 | 减少混淆，净减 220+ 行 | 极低 |
| 2 | P1-3 统一字段命名 | 减少维护成本 | 低（需兼容过渡） |
| 3 | P0-1 数据库去双写冗余 | 存储减半，写入加速 | 中（需前端配合改动） |
| 4 | P0-2 合并字典系统 | 消除不一致风险 | 中（需验证 OCR 准确率） |
| 5 | P2-1 加缓存 | CPU 减少 30-50% | 极低 |
| 6 | P2-2 去除 battle_count UPDATE | 减少 DB 写入 | 低 |
| 7 | P2-3 图片存 BLOB | 存储-25%，响应加速 | 低 |
| 8 | P3-3 加索引 | 查询加速 | 极低 |

---

## 四、验证方式

每项改动后，建议按以下 checklist 验证：

- [ ] 模板测试接口 `POST /api/ocr-preview/test` 返回结果一致
- [ ] 上传接口 `POST /api/battles/ocr-upload` 返回结构完整
- [ ] 前端表格 28 列全部正常展示
- [ ] 克制分析/溯源功能正常
- [ ] CSV 导出字段完整
- [ ] 历史数据兼容（旧记录的 `result` 字段、数组/扁平列）
