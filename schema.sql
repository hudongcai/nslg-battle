-- NSLG 战报工具 - D1 数据库建表 SQL
-- 在 Cloudflare D1 中执行此 SQL 创建表结构

-- ========== 项目表 ==========
CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  creator_phone TEXT NOT NULL,
  visibility TEXT DEFAULT 'private' CHECK(visibility IN ('public', 'private')),
  members TEXT DEFAULT '[]',  -- JSON array of phone numbers
  battle_record_ids TEXT DEFAULT '[]',  -- JSON array of record IDs
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- 索引
CREATE INDEX IF NOT EXISTS idx_projects_creator ON projects(creator_phone);
CREATE INDEX IF NOT EXISTS idx_projects_visibility ON projects(visibility);

-- ========== 战报表 ==========
CREATE TABLE IF NOT EXISTS records (
  id TEXT PRIMARY KEY,
  project_id TEXT,
  user_phone TEXT NOT NULL,
  data TEXT NOT NULL,  -- JSON string of battle data
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE SET NULL
);

-- 索引
CREATE INDEX IF NOT EXISTS idx_records_project ON records(project_id);
CREATE INDEX IF NOT EXISTS idx_records_user ON records(user_phone);
CREATE INDEX IF NOT EXISTS idx_records_created ON records(created_at DESC);

-- ========== 用户表（云端同步）==========
CREATE TABLE IF NOT EXISTS cloud_users (
  phone TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  password TEXT NOT NULL,
  role TEXT DEFAULT 'member' CHECK(role IN ('super_admin', 'admin', 'member')),
  points INTEGER DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- 索引
CREATE INDEX IF NOT EXISTS idx_cloud_users_role ON cloud_users(role);

-- ========== 项目权限表 ==========
CREATE TABLE IF NOT EXISTS project_permissions (
  id TEXT PRIMARY KEY,
  phone TEXT NOT NULL,
  project_id TEXT NOT NULL,
  can_edit INTEGER DEFAULT 0,  -- 0=false, 1=true
  can_delete INTEGER DEFAULT 0,
  granted_by TEXT NOT NULL,
  granted_at INTEGER NOT NULL,
  FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE,
  FOREIGN KEY(phone) REFERENCES cloud_users(phone) ON DELETE CASCADE,
  UNIQUE(phone, project_id)
);

-- 索引
CREATE INDEX IF NOT EXISTS idx_permissions_phone ON project_permissions(phone);
CREATE INDEX IF NOT EXISTS idx_permissions_project ON project_permissions(project_id);

-- ========== 系统日志表 ==========
CREATE TABLE IF NOT EXISTS cloud_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  level TEXT NOT NULL DEFAULT 'info',
  module TEXT NOT NULL,
  action TEXT,
  detail TEXT,
  user_phone TEXT,
  created_at INTEGER NOT NULL
);

-- 索引
CREATE INDEX IF NOT EXISTS idx_cloud_logs_created ON cloud_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_cloud_logs_user ON cloud_logs(user_phone);

-- ========== 初始化超管账号 ==========
-- 密码：hu6956521 (你需要先生成这个密码的哈希值)
-- 注意：实际部署时，密码应该在前端注册时加密，这里只是表结构
INSERT OR IGNORE INTO cloud_users (phone, name, password, role, points, created_at, updated_at)
VALUES ('13651810449', '超管', 'hu6956521', 'super_admin', 999999, unixepoch(), unixepoch());
