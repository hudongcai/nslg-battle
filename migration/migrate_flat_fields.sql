-- ============================================================
-- 战报武将/战法扁平化迁移脚本
-- 执行前提：battle_records 中已有 left_generals / right_generals / left_tactics / right_tactics JSON 列
-- 执行后：原 JSON 列保留，新增 24 个独立 VARCHAR 列并从 JSON 迁移数据
-- ============================================================

-- Step 1: 新增 24 个独立字段
ALTER TABLE battle_records
  ADD COLUMN left_general_1   VARCHAR(50)  DEFAULT NULL,
  ADD COLUMN left_general_2   VARCHAR(50)  DEFAULT NULL,
  ADD COLUMN left_general_3   VARCHAR(50)  DEFAULT NULL,
  ADD COLUMN right_general_1  VARCHAR(50)  DEFAULT NULL,
  ADD COLUMN right_general_2  VARCHAR(50)  DEFAULT NULL,
  ADD COLUMN right_general_3  VARCHAR(50)  DEFAULT NULL,
  ADD COLUMN left_tactic_1_1  VARCHAR(100) DEFAULT NULL,
  ADD COLUMN left_tactic_1_2  VARCHAR(100) DEFAULT NULL,
  ADD COLUMN left_tactic_1_3  VARCHAR(100) DEFAULT NULL,
  ADD COLUMN left_tactic_2_1  VARCHAR(100) DEFAULT NULL,
  ADD COLUMN left_tactic_2_2  VARCHAR(100) DEFAULT NULL,
  ADD COLUMN left_tactic_2_3  VARCHAR(100) DEFAULT NULL,
  ADD COLUMN left_tactic_3_1  VARCHAR(100) DEFAULT NULL,
  ADD COLUMN left_tactic_3_2  VARCHAR(100) DEFAULT NULL,
  ADD COLUMN left_tactic_3_3  VARCHAR(100) DEFAULT NULL,
  ADD COLUMN right_tactic_1_1 VARCHAR(100) DEFAULT NULL,
  ADD COLUMN right_tactic_1_2 VARCHAR(100) DEFAULT NULL,
  ADD COLUMN right_tactic_1_3 VARCHAR(100) DEFAULT NULL,
  ADD COLUMN right_tactic_2_1 VARCHAR(100) DEFAULT NULL,
  ADD COLUMN right_tactic_2_2 VARCHAR(100) DEFAULT NULL,
  ADD COLUMN right_tactic_2_3 VARCHAR(100) DEFAULT NULL,
  ADD COLUMN right_tactic_3_1 VARCHAR(100) DEFAULT NULL,
  ADD COLUMN right_tactic_3_2 VARCHAR(100) DEFAULT NULL,
  ADD COLUMN right_tactic_3_3 VARCHAR(100) DEFAULT NULL;

-- Step 2: 从现有 JSON 数组迁移数据到独立字段
-- NULLIF(..., 'null') 防止 JSON null 值写成字符串 "null"
UPDATE battle_records SET
  left_general_1   = NULLIF(JSON_UNQUOTE(JSON_EXTRACT(left_generals,  '$[0]')), 'null'),
  left_general_2   = NULLIF(JSON_UNQUOTE(JSON_EXTRACT(left_generals,  '$[1]')), 'null'),
  left_general_3   = NULLIF(JSON_UNQUOTE(JSON_EXTRACT(left_generals,  '$[2]')), 'null'),
  right_general_1  = NULLIF(JSON_UNQUOTE(JSON_EXTRACT(right_generals, '$[0]')), 'null'),
  right_general_2  = NULLIF(JSON_UNQUOTE(JSON_EXTRACT(right_generals, '$[1]')), 'null'),
  right_general_3  = NULLIF(JSON_UNQUOTE(JSON_EXTRACT(right_generals, '$[2]')), 'null'),
  left_tactic_1_1  = NULLIF(JSON_UNQUOTE(JSON_EXTRACT(left_tactics,   '$[0]')), 'null'),
  left_tactic_1_2  = NULLIF(JSON_UNQUOTE(JSON_EXTRACT(left_tactics,   '$[1]')), 'null'),
  left_tactic_1_3  = NULLIF(JSON_UNQUOTE(JSON_EXTRACT(left_tactics,   '$[2]')), 'null'),
  left_tactic_2_1  = NULLIF(JSON_UNQUOTE(JSON_EXTRACT(left_tactics,   '$[3]')), 'null'),
  left_tactic_2_2  = NULLIF(JSON_UNQUOTE(JSON_EXTRACT(left_tactics,   '$[4]')), 'null'),
  left_tactic_2_3  = NULLIF(JSON_UNQUOTE(JSON_EXTRACT(left_tactics,   '$[5]')), 'null'),
  left_tactic_3_1  = NULLIF(JSON_UNQUOTE(JSON_EXTRACT(left_tactics,   '$[6]')), 'null'),
  left_tactic_3_2  = NULLIF(JSON_UNQUOTE(JSON_EXTRACT(left_tactics,   '$[7]')), 'null'),
  left_tactic_3_3  = NULLIF(JSON_UNQUOTE(JSON_EXTRACT(left_tactics,   '$[8]')), 'null'),
  right_tactic_1_1 = NULLIF(JSON_UNQUOTE(JSON_EXTRACT(right_tactics,  '$[0]')), 'null'),
  right_tactic_1_2 = NULLIF(JSON_UNQUOTE(JSON_EXTRACT(right_tactics,  '$[1]')), 'null'),
  right_tactic_1_3 = NULLIF(JSON_UNQUOTE(JSON_EXTRACT(right_tactics,  '$[2]')), 'null'),
  right_tactic_2_1 = NULLIF(JSON_UNQUOTE(JSON_EXTRACT(right_tactics,  '$[3]')), 'null'),
  right_tactic_2_2 = NULLIF(JSON_UNQUOTE(JSON_EXTRACT(right_tactics,  '$[4]')), 'null'),
  right_tactic_2_3 = NULLIF(JSON_UNQUOTE(JSON_EXTRACT(right_tactics,  '$[5]')), 'null'),
  right_tactic_3_1 = NULLIF(JSON_UNQUOTE(JSON_EXTRACT(right_tactics,  '$[6]')), 'null'),
  right_tactic_3_2 = NULLIF(JSON_UNQUOTE(JSON_EXTRACT(right_tactics,  '$[7]')), 'null'),
  right_tactic_3_3 = NULLIF(JSON_UNQUOTE(JSON_EXTRACT(right_tactics,  '$[8]')), 'null')
WHERE left_generals IS NOT NULL OR right_generals IS NOT NULL;

-- Step 3: 验证（可选）
-- SELECT id, left_general_1, left_general_2, left_general_3,
--        left_tactic_1_1, left_tactic_1_2, left_tactic_1_3
-- FROM battle_records LIMIT 5;
