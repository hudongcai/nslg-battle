const express = require('express');
const mysql = require('mysql2/promise');
const cors = require('cors');
const XLSX = require('xlsx');
const os = require('os');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { mapPaddleResult } = require('./ocr-parser');

const app = express();
const PORT = 3000;

app.use(cors({
  origin: true,                      // 反射请求的 origin，支持任意来源
  credentials: false,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With']
}));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use(express.static(__dirname, { maxAge: 0 }));

// ========== Token ==========
function extractPhoneFromToken(token) {
  if (!token) return null;
  const t = token.replace(/^Bearer\s+/i, '').trim();
  const m = t.match(/^mock-token-(1\d{10})-\d+$/);
  return m ? m[1] : null;
}

async function requireActiveUser(req, res, next) {
  const rawToken = req.headers['authorization'] || '';
  if (!rawToken) return res.status(401).json({ code: 401, message: '未登录，请先登录' });
  const phone = extractPhoneFromToken(rawToken);
  if (!phone) return res.status(401).json({ code: 401, message: '登录状态已过期，请重新登录' });
  try {
    const [rows] = await pool.query('SELECT id, status FROM users WHERE phone = ? LIMIT 1', [phone]);
    if (rows.length === 0) return res.status(401).json({ code: 401, message: '账号不存在，请重新登录' });
    if (rows[0].status === 0) return res.status(401).json({ code: 401, message: '账号已被禁用，请联系管理员' });
    req.authPhone = phone;
    req.authUserId = rows[0].id;
    next();
  } catch (err) { next(); }
}

async function globalUserCheck(req, res, next) {
  if (req.path === '/auth/login' || req.path === '/auth/register') return next();
  const rawToken = req.headers['authorization'] || '';
  if (!rawToken) return next();
  const phone = extractPhoneFromToken(rawToken);
  if (!phone) return next();
  try {
    const [rows] = await pool.query('SELECT id, status FROM users WHERE phone = ? LIMIT 1', [phone]);
    if (rows.length === 0) return res.status(401).json({ code: 401, message: '账号不存在，请重新登录' });
    if (rows[0].status === 0) return res.status(401).json({ code: 401, message: '账号已被禁用，请联系管理员' });
    req.authPhone = phone;
    req.authUserId = rows[0].id;
    next();
  } catch (err) { next(); }
}

const dbConfig = {
  host:     process.env.DB_HOST     || 'localhost',
  port:     process.env.DB_PORT     || 3306,
  user:     process.env.DB_USER     || 'nslg-battle-server',
  password: process.env.DB_PASS     || 'hu6956521',
  database: process.env.DB_NAME     || 'nslg_battle',
  charset: 'utf8mb4',
  dateStrings: true
};

let pool;

async function initDB() {
  try {
    pool = mysql.createPool(dbConfig);
    await pool.query('SELECT 1');
    console.log('✅ MySQL 连接成功');
    await pool.query(`CREATE TABLE IF NOT EXISTS star_box_configs (
      id INT AUTO_INCREMENT PRIMARY KEY, project_id INT NOT NULL,
      image_width INT NOT NULL DEFAULT 0, image_height INT NOT NULL DEFAULT 0,
      boxes_json LONGTEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uk_project (project_id)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
    await pool.query(`CREATE TABLE IF NOT EXISTS label_configs (
      id INT AUTO_INCREMENT PRIMARY KEY, project_id BIGINT NOT NULL,
      image_width INT NOT NULL DEFAULT 0, image_height INT NOT NULL DEFAULT 0,
      categories_json LONGTEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uk_project (project_id)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
    await pool.query(`CREATE TABLE IF NOT EXISTS ocr_watch_tasks (
      id BIGINT AUTO_INCREMENT PRIMARY KEY,
      user_id BIGINT NOT NULL,
      project_id BIGINT NOT NULL,
      folder_path VARCHAR(512) NOT NULL DEFAULT '',
      status ENUM('idle','running','paused','error') NOT NULL DEFAULT 'idle',
      pending_count INT DEFAULT 0,
      processed_count INT DEFAULT 0,
      processed_files_json JSON DEFAULT NULL,
      last_error VARCHAR(500) DEFAULT '',
      last_heartbeat DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uk_user_project (user_id, project_id),
      KEY idx_user_project (user_id, project_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
    await pool.query(`ALTER TABLE label_configs MODIFY COLUMN project_id BIGINT NOT NULL`).catch(()=>{});
    await pool.query(`ALTER TABLE local_helper_clients ADD COLUMN access_token VARCHAR(128) DEFAULT ''`).catch(()=>{});
    await pool.query(`ALTER TABLE local_helper_clients ADD COLUMN token_expires_at DATETIME NULL`).catch(()=>{});
    await pool.query(`ALTER TABLE project_player_dict ADD UNIQUE KEY uk_proj_player (project_id, player_name)`).catch(()=>{});
    await pool.query(`ALTER TABLE ocr_watch_tasks ADD COLUMN pending_files_json JSON DEFAULT NULL`).catch(()=>{});
    await pool.query(`ALTER TABLE ocr_watch_tasks ADD COLUMN processed_files_json JSON DEFAULT NULL`).catch(()=>{});
    await pool.query(`ALTER TABLE ocr_watch_tasks ADD COLUMN current_file VARCHAR(512) DEFAULT ''`).catch(()=>{});
    await pool.query(`ALTER TABLE ocr_watch_tasks ADD COLUMN pending_count INT DEFAULT 0`).catch(()=>{});
    await pool.query(`ALTER TABLE ocr_watch_tasks ADD COLUMN processed_count INT DEFAULT 0`).catch(()=>{});
    await pool.query(`ALTER TABLE ocr_watch_tasks ADD COLUMN last_heartbeat DATETIME NULL`).catch(()=>{});
    await pool.query(`ALTER TABLE ocr_watch_tasks ADD COLUMN last_error VARCHAR(500) DEFAULT ''`).catch(()=>{});
    // OCR 待处理任务表
    await pool.query(`CREATE TABLE IF NOT EXISTS ocr_pending_tasks (
      id BIGINT AUTO_INCREMENT PRIMARY KEY,
      user_id BIGINT NOT NULL,
      project_id BIGINT,
      image_base64 LONGTEXT NOT NULL,
      image_name VARCHAR(255),
      battle_date DATE,
      label_config JSON,
      helper_task_id BIGINT,
      status ENUM('pending','processing','done','failed') NOT NULL DEFAULT 'pending',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      KEY idx_user_status (user_id, status),
      KEY idx_project_status (project_id, status)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
    // 常用查询索引
    try { await pool.query(`ALTER TABLE battle_records ADD INDEX idx_project (project_id)`); } catch (e) { if (e.code !== 'ER_DUP_KEYNAME') console.warn('idx_project:', e.message); }
    try { await pool.query(`ALTER TABLE battle_records ADD INDEX idx_project_date (project_id, battle_date)`); } catch (e) { if (e.code !== 'ER_DUP_KEYNAME') console.warn('idx_project_date:', e.message); }
    try { await pool.query(`ALTER TABLE battle_records ADD INDEX idx_created (created_at)`); } catch (e) { if (e.code !== 'ER_DUP_KEYNAME') console.warn('idx_created:', e.message); }
    // 清理 OCR 噪音
    const [r1] = await pool.query(`UPDATE battle_records SET left_alliance = '' WHERE left_alliance = '...' OR CHAR_LENGTH(left_alliance) <= 1`);
    const [r2] = await pool.query(`UPDATE battle_records SET right_alliance = '' WHERE right_alliance = '...' OR CHAR_LENGTH(right_alliance) <= 1`);
    if (r1.affectedRows > 0 || r2.affectedRows > 0) console.log(`🧹 清理噪音: left ${r1.affectedRows}, right ${r2.affectedRows}`);
    const [globalCfg] = await pool.query('SELECT id FROM label_configs WHERE project_id = 0');
    if (globalCfg.length === 0) {
      await pool.query(`INSERT IGNORE INTO label_configs (project_id, image_width, image_height, categories_json)
        SELECT 0, image_width, image_height, categories_json FROM label_configs WHERE project_id IN (1, 2) LIMIT 1`);
      console.log('📐 全局标注配置已创建 (project_id=0)');
    }
  } catch (err) { console.error('❌ MySQL 连接失败:', err.message); process.exit(1); }
}

app.use('/api', globalUserCheck);

function parseMysqlDateTime(value) {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  const text = String(value).trim();
  if (!text) return null;
  const normalized = text.includes('T') ? text : text.replace(' ', 'T');
  const parsed = new Date(normalized);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

async function requireOcrUploadActor(req, res, next) {
  const rawToken = req.headers['authorization'] || '';
  if (!rawToken) return res.status(401).json({ code: 401, message: '未登录，请先登录' });
  const helperToken = rawToken.replace(/^Bearer\s+/i, '').trim();
  if (helperToken.startsWith('helper-auth-')) {
    try {
      const [rows] = await pool.query(
        `SELECT c.id, c.user_id, u.phone, u.status
         FROM local_helper_clients c
         INNER JOIN users u ON u.id = c.user_id
         WHERE c.access_token = ? AND (c.token_expires_at IS NULL OR c.token_expires_at > NOW())
         LIMIT 1`,
        [helperToken]
      );
      if (!rows.length) return res.status(401).json({ code: 401, message: '本地助手令牌无效或已过期' });
      if (rows[0].status === 0) return res.status(401).json({ code: 401, message: '账号已被禁用，请联系管理员' });
      req.authPhone = rows[0].phone;
      req.authUserId = rows[0].user_id;
      req.helperClientId = rows[0].id;
      return next();
    } catch (err) {
      return res.status(500).json({ code: 500, message: err.message });
    }
  }
  return requireActiveUser(req, res, next);
}

function buildMockToken(phone) {
  return 'mock-token-' + phone + '-' + Date.now();
}

function parseTaskStats(raw) {
  if (!raw) return { discovered: 0, uploaded: 0, parsed: 0, failed: 0, pending: 0, pendingFiles: [], currentFile: '' };
  try {
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return {
      discovered: Number(parsed.discovered || 0),
      uploaded: Number(parsed.uploaded || 0),
      parsed: Number(parsed.parsed || 0),
      failed: Number(parsed.failed || 0),
      pending: Number(parsed.pending || 0),
      pendingFiles: Array.isArray(parsed.pendingFiles)
        ? parsed.pendingFiles.map(item => String(item || '').trim()).filter(Boolean).slice(0, 200)
        : [],
      currentFile: String(parsed.currentFile || '').trim().slice(0, 260)
    };
  } catch (e) {
    return { discovered: 0, uploaded: 0, parsed: 0, failed: 0, pending: 0, pendingFiles: [], currentFile: '' };
  }
}

function safeJsonParse(raw, fallback) {
  if (raw === null || raw === undefined) return fallback;
  if (typeof raw === 'object') return raw;           // mysql2 可能已自动解析 JSON 列
  if (typeof raw === 'string' && raw.trim() !== '') {
    try { return JSON.parse(raw); } catch (e) {}
  }
  return fallback;
}

function normalizeMySqlDateTime(value) {
  const formatLocalDateTime = (date) => {
    const pad = (num) => String(num).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
  };
  if (!value) return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return formatLocalDateTime(value);
  }
  const text = String(value).trim();
  if (!text) return null;
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(text)) return text;
  const date = new Date(text);
  if (Number.isNaN(date.getTime())) return null;
  return formatLocalDateTime(date);
}

function taskStatusLabel(status) {
  const labels = {
    pending_bind: '待绑定目录',
    ready: '待启动',
    running: '运行中',
    paused: '已暂停',
    offline: '助手离线',
    completed: '已完成',
    stopped: '已停止',
    error: '部分失败'
  };
  return labels[status] || status;
}

// async function getLiveTaskSuccessCountMap(userId, projectIds) {
//   const validProjectIds = [...new Set((projectIds || [])
//     .map(id => Number(id))
//     .filter(id => Number.isInteger(id) && id > 0))];
// 
//   const resultMap = new Map();
//   if (!validProjectIds.length) {
//     return resultMap;
//   }
// 
//   const placeholders = validProjectIds.map(() => '?').join(',');
//   const [rows] = await pool.query(
//     `SELECT bg.project_id, COUNT(DISTINCT bg.original_name) AS success_count
//      FROM battle_gallery bg
//      INNER JOIN battle_records br ON bg.battle_id = br.id
//      WHERE bg.uploaded_by = ?
//        AND bg.project_id IN (${placeholders})
//        AND bg.status = 1
//        AND bg.original_name != ''
//        AND br.left_general_1 IS NOT NULL
//        AND br.left_general_1 != ''
//      GROUP BY bg.project_id`,
//     [userId, ...validProjectIds]
//   );
// 
//   rows.forEach(row => {
//     resultMap.set(Number(row.project_id), Number(row.success_count || 0));
//   });
//   return resultMap;
// }
// 
// function mergeTaskStatsWithLiveSuccess(rawStats, liveSuccessCount) {
//   const stats = parseTaskStats(rawStats);
//   const successCount = Number.isInteger(Number(liveSuccessCount)) ? Number(liveSuccessCount) : 0;
//   stats.uploaded = successCount;
//   stats.parsed = successCount;
//   return stats;
// }

// async function requireHelperClient(req, res, next) {
//   const rawToken = req.headers['authorization'] || '';
//   const token = rawToken.replace(/^Bearer\s+/i, '').trim();
//   if (!token || !token.startsWith('helper-auth-')) return res.status(401).json({ code: 401, message: '本地助手未连接' });
//   try {
//     const [rows] = await pool.query(
//       `SELECT id, user_id, device_id, device_name, helper_version
//        FROM local_helper_clients
//        WHERE access_token = ? AND (token_expires_at IS NULL OR token_expires_at > NOW())
//        LIMIT 1`,
//       [token]
//     );
//     if (!rows.length) return res.status(401).json({ code: 401, message: '本地助手令牌无效或已过期' });
//     req.helperClient = rows[0];
//     // 每次 helper 认证成功都更新心跳，确保无任务时也保持 online
//     pool.query('UPDATE local_helper_clients SET status = \'online\', last_seen_at = NOW() WHERE id = ?', [rows[0].id]).catch(() => {});
//     next();
//   } catch (err) {
//     res.status(500).json({ code: 500, message: err.message });
//   }
// }

// ========== 认证 ==========
app.post('/api/auth/login', async (req, res) => {
  const { phone, password } = req.body;
  if (!phone || !password) return res.json({ code: 400, message: '缺少参数' });
  try {
    const [rows] = await pool.query('SELECT * FROM users WHERE phone = ?', [phone]);
    if (rows.length === 0) return res.json({ code: 401, message: '账号或密码错误' });
    const user = rows[0];
    if (user.password === password) {
      const points = user.credit_balance != null ? user.credit_balance : 18;
      const loginIp = req.headers['x-forwarded-for']?.split(',')[0].trim() || req.ip || req.connection?.remoteAddress || '';
      await pool.query('UPDATE users SET last_login_at = NOW(), last_login_ip = ? WHERE id = ?', [loginIp, user.id]);
      res.json({ code: 200, data: { token: 'mock-token-' + user.phone + '-' + Date.now(), user: { nickname: user.nickname, phone: user.phone, role: user.role_id, points: points } } });
    } else { res.json({ code: 401, message: '账号或密码错误' }); }
  } catch (err) { res.json({ code: 500, message: err.message }); }
});

app.post('/api/auth/register', async (req, res) => {
  const { phone, password, name, role } = req.body;
  if (!phone || !password) return res.json({ code: 400, message: '缺少参数' });
  try {
    const [existRows] = await pool.query('SELECT * FROM users WHERE phone = ?', [phone]);
    if (existRows.length > 0) return res.json({ code: 400, message: '该手机号已注册' });
    const now = new Date();
    const [userResult] = await pool.query(
      'INSERT INTO users (phone, password, nickname, role_id, status, credit_balance, credit_total_earned, credit_total_consumed, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [phone, password, name || `用户${phone.slice(-4)}`, role || 'member', 1, 18, 0, 0, now, now]);
    const newUserId = userResult.insertId;
    try { await pool.query('INSERT INTO credit_logs (user_id, change_amount, balance_after, type, description, operator_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)', [newUserId, 18, 18, 'register', '新用户注册免费赠送', newUserId, now]); } catch (e) {}
    res.json({ code: 200, message: '注册成功', data: { phone, nickname: name || `用户${phone.slice(-4)}`, role: role || 'member' } });
  } catch (err) { res.json({ code: 500, message: err.message }); }
});

app.get('/api/auth/profile', async (req, res) => {
  try {
    const token = req.headers['authorization'] || req.query.token;
    if (!token) return res.json({ code: 401, message: '未登录' });
    const phone = extractPhoneFromToken(token);
    if (!phone) return res.json({ code: 401, message: '无效的登录凭证' });
    const [userRows] = await pool.query('SELECT * FROM users WHERE phone = ?', [phone]);
    if (userRows.length === 0) return res.json({ code: 401, message: '账号不存在' });
    const user = userRows[0];
    if (user.status === 0) return res.json({ code: 401, message: '账号已被禁用' });
    res.json({ code: 200, data: { phone: user.phone, nickname: user.nickname, role: user.role_id, points: user.credit_balance ?? 18, avatar: user.avatar || '', status: user.status } });
  } catch (err) { res.json({ code: 500, message: err.message }); }
});

// ========== 用户管理 ==========
app.get('/api/users', async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT * FROM users ORDER BY id');
    res.json({ code: 200, data: rows.map(u => ({ id: u.id, phone: u.phone, nickname: u.nickname, role_id: u.role_id, status: u.status, points: u.credit_balance || 0, created_at: u.created_at })) });
  } catch (err) { res.json({ code: 500, message: err.message }); }
});

app.delete('/api/users/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const [userRows] = await pool.query('SELECT * FROM users WHERE id = ?', [id]);
    if (userRows.length === 0) return res.json({ code: 404, message: '用户不存在' });
    await pool.query('DELETE FROM project_members WHERE user_id = ?', [id]);
    await pool.query('DELETE FROM users WHERE id = ?', [id]);
    res.json({ code: 200, message: '删除成功' });
  } catch (err) { res.json({ code: 500, message: err.message }); }
});

app.put('/api/users/:id', async (req, res) => {
  try {
    const { id } = req.params; const { nickname, role_id, status, points } = req.body;
    const [userRows] = await pool.query('SELECT * FROM users WHERE id = ?', [id]);
    if (userRows.length === 0) return res.status(404).json({ code: 404, message: '用户不存在' });
    const updates = [], params = [];
    if (nickname !== undefined) { updates.push('nickname = ?'); params.push(nickname); }
    if (role_id !== undefined) { updates.push('role_id = ?'); params.push(role_id); }
    if (status !== undefined) { updates.push('status = ?'); params.push(status); }
    if (points !== undefined) { updates.push('credit_balance = ?'); params.push(points); }
    if (updates.length === 0) return res.json({ code: 400, message: '没有需要更新的字段' });
    params.push(id);
    await pool.query(`UPDATE users SET ${updates.join(', ')} WHERE phone = ?`, params);
    res.json({ code: 200, message: '更新成功' });
  } catch (err) { res.json({ code: 500, message: err.message }); }
});

app.post('/api/users/:id/reset-password', async (req, res) => {
  try {
    const { id } = req.params; const { newPassword } = req.body;
    if (!newPassword || newPassword.length < 6) return res.json({ code: 400, message: '密码至少6位' });
    const [userRows] = await pool.query('SELECT id FROM users WHERE id = ?', [id]);
    if (userRows.length === 0) return res.json({ code: 404, message: '用户不存在' });
    await pool.query('UPDATE users SET password = ? WHERE id = ?', [newPassword, id]);
    res.json({ code: 200, message: '密码重置成功' });
  } catch (err) { res.json({ code: 500, message: err.message }); }
});

// ========== 项目管理 ==========
app.get('/api/projects', async (req, res) => {
  try {
    const { phone } = req.query;
    if (!phone) return res.status(400).json({ code: 400, message: '缺少 phone 参数' });
    const [userRows] = await pool.query('SELECT * FROM users WHERE phone = ?', [phone]);
    if (userRows.length === 0) return res.status(400).json({ code: 400, message: '用户不存在' });
    const user = userRows[0];
    const countSub = `(SELECT COUNT(*) FROM project_members pm2 WHERE pm2.project_id = p.id) + 1 AS member_count, (SELECT COUNT(*) FROM battle_records br WHERE br.project_id = p.id) AS battle_count`;
    let query = `SELECT DISTINCT p.id, p.name, p.description, p.creator_id, p.status, p.is_public, p.left_alliances, p.right_alliances, p.created_at, p.updated_at, u.phone as creator_phone, ${countSub} FROM projects p LEFT JOIN users u ON p.creator_id = u.id`;
    let params = [];
    if (user.role_id !== 'super_admin') {
      query = `SELECT DISTINCT p.id, p.name, p.description, p.creator_id, p.status, p.is_public, p.left_alliances, p.right_alliances, p.created_at, p.updated_at, u.phone as creator_phone, ${countSub} FROM projects p LEFT JOIN users u ON p.creator_id = u.id LEFT JOIN project_members pm ON p.id = pm.project_id WHERE p.creator_id = ? OR pm.user_id = ? OR p.is_public = 1`;
      params = [user.id, user.id];
    }
    const [rows] = await pool.query(query, params);
    res.json({ code: 200, data: rows.map(p => ({
      id: p.id, name: p.name, description: p.description, creator_id: p.creator_id, creator_phone: p.creator_phone || '',
      status: p.status, is_public: p.is_public,
      left_alliances: Array.isArray(p.left_alliances) ? p.left_alliances : (() => { try { return JSON.parse(p.left_alliances || '[]'); } catch { return []; } })(),
      right_alliances: Array.isArray(p.right_alliances) ? p.right_alliances : (() => { try { return JSON.parse(p.right_alliances || '[]'); } catch { return []; } })(),
      member_count: p.member_count, battle_count: p.battle_count, created_at: p.created_at, updated_at: p.updated_at
    })) });
  } catch (err) { res.json({ code: 500, message: err.message }); }
});

app.get('/api/projects/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const [rows] = await pool.query(`SELECT p.id, p.name, p.description, p.creator_id, p.status, p.is_public, p.left_alliances, p.right_alliances, p.created_at, p.updated_at,
      u.phone as creator_phone, (SELECT COUNT(*) FROM project_members pm WHERE pm.project_id = p.id) + 1 AS member_count,
      (SELECT COUNT(*) FROM battle_records br WHERE br.project_id = p.id) AS battle_count
      FROM projects p LEFT JOIN users u ON p.creator_id = u.id WHERE p.id = ?`, [id]);
    if (rows.length === 0) return res.json({ code: 404, message: '项目不存在' });
    const p = rows[0];
    res.json({ code: 200, data: {
      id: p.id, name: p.name, description: p.description, creator_id: p.creator_id, creator_phone: p.creator_phone || '',
      status: p.status, is_public: p.is_public,
      left_alliances: Array.isArray(p.left_alliances) ? p.left_alliances : (() => { try { return JSON.parse(p.left_alliances || '[]'); } catch { return []; } })(),
      right_alliances: Array.isArray(p.right_alliances) ? p.right_alliances : (() => { try { return JSON.parse(p.right_alliances || '[]'); } catch { return []; } })(),
      member_count: p.member_count, battle_count: p.battle_count, created_at: p.created_at, updated_at: p.updated_at
    }});
  } catch (err) { res.json({ code: 500, message: err.message }); }
});

app.post('/api/projects', requireActiveUser, async (req, res) => {
  try {
    const { id, name, description, desc, creator_id, creator_phone, is_public, visibility, left_alliances, right_alliances } = req.body;
    const finalDesc = description || desc || '';
    const finalPublic = (is_public || visibility === 'public') ? 1 : 0;
    const leftAl = JSON.stringify(Array.isArray(left_alliances) ? left_alliances.slice(0,3) : []);
    const rightAl = JSON.stringify(Array.isArray(right_alliances) ? right_alliances.slice(0,3) : []);
    let finalCreatorId = creator_id || null;
    if (!finalCreatorId && creator_phone) { const [urows] = await pool.query('SELECT id FROM users WHERE phone = ?', [creator_phone]); if (urows.length) finalCreatorId = urows[0].id; }
    const parsedId = id ? Number(id) : NaN;
    const projectId = Number.isInteger(parsedId) && parsedId > 0 ? parsedId : null;
    const now = new Date();
    const [insertResult] = await pool.query(
      'INSERT INTO projects (id, name, description, creator_id, is_public, status, left_alliances, right_alliances, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?, ?)',
      [projectId, name, finalDesc, finalCreatorId, finalPublic, leftAl, rightAl, now, now]);
    res.json({ code: 200, data: { id: insertResult.insertId || projectId } });
  } catch (err) { res.json({ code: 500, message: err.message }); }
});

app.put('/api/projects/:id', async (req, res) => {
  try {
    const { id } = req.params; const { name, description, desc, is_public, visibility, status, left_alliances, right_alliances } = req.body;
    const updates = [], params = [];
    if (name !== undefined) { updates.push('name = ?'); params.push(name); }
    if (description !== undefined || desc !== undefined) { updates.push('description = ?'); params.push(description !== undefined ? description : desc); }
    if (is_public !== undefined) { updates.push('is_public = ?'); params.push(is_public ? 1 : 0); }
    else if (visibility !== undefined) { updates.push('is_public = ?'); params.push(visibility === 'public' ? 1 : 0); }
    if (status !== undefined) { updates.push('status = ?'); params.push(status); }
    if (left_alliances !== undefined) { updates.push('left_alliances = ?'); params.push(JSON.stringify(Array.isArray(left_alliances) ? left_alliances.slice(0,3) : [])); }
    if (right_alliances !== undefined) { updates.push('right_alliances = ?'); params.push(JSON.stringify(Array.isArray(right_alliances) ? right_alliances.slice(0,3) : [])); }
    updates.push('updated_at = NOW()'); params.push(id);
    await pool.query(`UPDATE projects SET ${updates.join(', ')} WHERE id = ?`, params);
    res.json({ code: 200, message: '更新成功' });
  } catch (err) { res.json({ code: 500, message: err.message }); }
});

app.delete('/api/projects/:id', async (req, res) => {
  try {
    const { id } = req.params;
    await pool.query('DELETE FROM project_members WHERE project_id = ?', [id]);
    await pool.query('DELETE FROM battle_gallery WHERE project_id = ?', [id]);
    await pool.query('DELETE FROM battle_records WHERE project_id = ?', [id]);
    await pool.query('DELETE FROM projects WHERE id = ?', [id]);
    res.json({ code: 200, message: '删除成功' });
  } catch (err) { res.json({ code: 500, message: err.message }); }
});

// ========== 项目成员 ==========
app.get('/api/projects/:id/members', async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT pm.*, u.phone, u.nickname, u.role_id as user_role FROM project_members pm LEFT JOIN users u ON pm.user_id = u.id WHERE pm.project_id = ?', [req.params.id]);
    res.json({ code: 200, data: rows.map(r => ({ id: r.id, project_id: r.project_id, user_id: r.user_id, phone: r.phone || '', role: r.role || 'viewer', nickname: r.nickname || '', joined_at: r.joined_at })) });
  } catch (err) { res.json({ code: 500, message: err.message }); }
});

app.post('/api/projects/:id/members', async (req, res) => {
  try {
    const { id } = req.params; const { phone, role } = req.body;
    if (!phone) return res.json({ code: 400, message: '缺少 phone 参数' });
    const [userRows] = await pool.query('SELECT id FROM users WHERE phone = ?', [phone]);
    if (userRows.length === 0) return res.json({ code: 404, message: '用户不存在' });
    await pool.query('INSERT INTO project_members (project_id, user_id, role, joined_at) VALUES (?, ?, ?, ?)', [id, userRows[0].id, role || 'viewer', new Date()]);
    res.json({ code: 200, message: '添加成功' });
  } catch (err) { res.json({ code: 500, message: err.message }); }
});

app.delete('/api/projects/:id/members/:phone', async (req, res) => {
  try {
    const { id, phone } = req.params;
    const [userRows] = await pool.query('SELECT id FROM users WHERE phone = ?', [phone]);
    if (userRows.length === 0) return res.json({ code: 404, message: '用户不存在' });
    await pool.query('DELETE FROM project_members WHERE project_id = ? AND user_id = ?', [id, userRows[0].id]);
    res.json({ code: 200, message: '删除成功' });
  } catch (err) { res.json({ code: 500, message: err.message }); }
});

// ========== 玩家字典 ==========
app.get('/api/projects/:id/player-dict', async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT id, player_name, alliance_name, side, created_at FROM project_player_dict WHERE project_id = ? ORDER BY side, player_name', [req.params.id]);
    res.json({ code: 200, data: rows });
  } catch (err) { res.json({ code: 500, message: err.message }); }
});

app.post('/api/projects/:id/player-dict/import', requireSuperAdmin, async (req, res) => {
  try {
    const { id } = req.params; const { fileBase64, side: defaultSide = 'unknown' } = req.body;
    if (!fileBase64) return res.json({ code: 400, message: '缺少 fileBase64' });
    const buf = Buffer.from(fileBase64, 'base64'); const wb = XLSX.read(buf, { type: 'buffer' }); const ws = wb.Sheets[wb.SheetNames[0]];
    const rawRows = XLSX.utils.sheet_to_json(ws, { defval: '', header: 1 });
    const KNOWN_HEADERS = ['player_name','玩家名','玩家','alliance_name','联盟','联盟名','side','阵营'];
    const hasHeader = (rawRows[0] || []).some(c => KNOWN_HEADERS.includes(String(c).trim()));
    const rows = hasHeader ? XLSX.utils.sheet_to_json(ws, { defval: '' }) : rawRows.map(r => ({ player_name: String(r[0] || '').trim() }));
    let added = 0, skipped = 0;
    for (const row of rows) {
      const playerName = (row['player_name'] || row['玩家名'] || row['玩家'] || '').toString().trim();
      if (!playerName) { skipped++; continue; }
      const allianceName = (row['alliance_name'] || row['联盟'] || row['联盟名'] || '').toString().trim();
      const side = (['left','right','unknown'].includes(row['side']) ? row['side'] : row['阵营'] === '左' ? 'left' : row['阵营'] === '右' ? 'right' : defaultSide);
      await pool.query(`INSERT INTO project_player_dict (project_id, player_name, alliance_name, side) VALUES (?, ?, ?, ?) ON DUPLICATE KEY UPDATE alliance_name = VALUES(alliance_name), side = VALUES(side)`, [id, playerName, allianceName || null, side]);
      added++;
    }
    res.json({ code: 200, data: { added, skipped } });
  } catch (err) { res.json({ code: 500, message: err.message }); }
});

app.delete('/api/projects/:id/player-dict/:playerId', requireSuperAdmin, async (req, res) => {
  try { await pool.query('DELETE FROM project_player_dict WHERE id = ? AND project_id = ?', [req.params.playerId, req.params.id]); res.json({ code: 200, message: '删除成功' }); }
  catch (err) { res.json({ code: 500, message: err.message }); }
});

// ========== 角色 ==========
app.get('/api/roles', async (req, res) => {
  try { const [rows] = await pool.query('SELECT * FROM roles'); res.json({ code: 200, data: rows }); }
  catch (err) { res.json({ code: 500, message: err.message }); }
});

app.post('/api/roles', async (req, res) => {
  try {
    const { id, name, permissions, isBuiltIn } = req.body;
    await pool.query(`INSERT INTO roles (id, name, permissions, is_built_in) VALUES (?, ?, ?, ?) ON DUPLICATE KEY UPDATE name=VALUES(name), permissions=VALUES(permissions), is_built_in=VALUES(is_built_in)`, [id || 'role_' + Date.now(), name, JSON.stringify(permissions || []), isBuiltIn ? 1 : 0]);
    res.json({ code: 200, data: { id: id || 'role_' + Date.now() } });
  } catch (err) { res.json({ code: 500, message: err.message }); }
});

app.delete('/api/roles/:id', async (req, res) => {
  try { await pool.query('DELETE FROM roles WHERE id = ?', [req.params.id]); res.json({ code: 200, message: '删除成功' }); }
  catch (err) { res.json({ code: 500, message: err.message }); }
});

// ========== 战报 ==========
// 规范化请求体: 兼容 camelCase/snake_case/数组/扁平字段
function normalizeBattleBody(body) {
  const fv = v => (v && v !== '') ? v : null;
  const out = {
    projectId:         body.projectId,
    attacker_name:     body.attacker_name || body.attackerName || '',
    enemy_name:        body.enemy_name  || body.enemyName  || '',
    result:            body.result      || '',
    battle_date:       body.battle_date || body.battleDate || '',
    description:       body.description || '',
    left_loss:         body.left_loss  ?? body.leftLoss  ?? body.leftDamage  ?? null,
    right_loss:        body.right_loss ?? body.rightLoss ?? body.rightDamage ?? null,
    left_total:        body.left_total  ?? body.leftTotal  ?? body.leftTroops  ?? null,
    right_total:       body.right_total ?? body.rightTotal ?? body.rightTroops ?? null,
    left_loss_rate:    body.left_loss_rate  ?? body.leftLossRate  ?? null,
    right_loss_rate:   body.right_loss_rate ?? body.rightLossRate ?? null,
    left_formation:    (body.left_formation  ?? body.leftFormation)  || '',
    right_formation:   (body.right_formation ?? body.rightFormation) || '',
    left_alliance:     (body.left_alliance   ?? body.leftAlliance)   || '',
    right_alliance:    (body.right_alliance  ?? body.rightAlliance)  || '',
    left_general_1_stars:  body.left_general_1_stars  ?? body.leftGeneral1Stars  ?? 0,
    left_general_2_stars:  body.left_general_2_stars  ?? body.leftGeneral2Stars  ?? 0,
    left_general_3_stars:  body.left_general_3_stars  ?? body.leftGeneral3Stars  ?? 0,
    right_general_1_stars: body.right_general_1_stars ?? body.rightGeneral1Stars ?? 0,
    right_general_2_stars: body.right_general_2_stars ?? body.rightGeneral2Stars ?? 0,
    right_general_3_stars: body.right_general_3_stars ?? body.rightGeneral3Stars ?? 0,
  };
  const left_generals  = body.left_generals  ?? body.leftGenerals;
  const right_generals = body.right_generals ?? body.rightGenerals;
  const left_tactics   = body.left_tactics   ?? body.leftTactics;
  const right_tactics  = body.right_tactics  ?? body.rightTactics;
  out.lg = Array.isArray(left_generals)  ? left_generals  : [fv(body.leftGeneral1 || body.left_general_1), fv(body.leftGeneral2 || body.left_general_2), fv(body.leftGeneral3 || body.left_general_3)];
  out.rg = Array.isArray(right_generals) ? right_generals : [fv(body.rightGeneral1 || body.right_general_1), fv(body.rightGeneral2 || body.right_general_2), fv(body.rightGeneral3 || body.right_general_3)];
  out.lt = Array.isArray(left_tactics)   ? left_tactics   : [fv(body.leftTactic1_1 || body.left_tactic_1_1), fv(body.leftTactic1_2 || body.left_tactic_1_2), fv(body.leftTactic1_3 || body.left_tactic_1_3), fv(body.leftTactic2_1 || body.left_tactic_2_1), fv(body.leftTactic2_2 || body.left_tactic_2_2), fv(body.leftTactic2_3 || body.left_tactic_2_3), fv(body.leftTactic3_1 || body.left_tactic_3_1), fv(body.leftTactic3_2 || body.left_tactic_3_2), fv(body.leftTactic3_3 || body.left_tactic_3_3)];
  out.rt = Array.isArray(right_tactics)  ? right_tactics  : [fv(body.rightTactic1_1 || body.right_tactic_1_1), fv(body.rightTactic1_2 || body.right_tactic_1_2), fv(body.rightTactic1_3 || body.right_tactic_1_3), fv(body.rightTactic2_1 || body.right_tactic_2_1), fv(body.rightTactic2_2 || body.right_tactic_2_2), fv(body.rightTactic2_3 || body.right_tactic_2_3), fv(body.rightTactic3_1 || body.right_tactic_3_1), fv(body.rightTactic3_2 || body.right_tactic_3_2), fv(body.rightTactic3_3 || body.right_tactic_3_3)];
  return out;
}

app.get('/api/battles', async (req, res) => {
  try {
    const { projectId } = req.query;
    let query = 'SELECT * FROM battle_records', params = [];
    if (projectId) { query += ' WHERE project_id = ?'; params = [projectId]; }
    query += ' ORDER BY created_at DESC';
    const [rows] = await pool.query(query, params);
    res.json({ code: 200, data: rows.map(r => ({
      id: r.id, project_id: r.project_id,
      leftPlayer: r.attacker_name, rightPlayer: r.enemy_name,
      attacker_name: r.attacker_name, enemy_name: r.enemy_name,
      result: r.result, battle_date: r.battle_date, description: r.description,
      left_loss: r.left_loss, right_loss: r.right_loss, left_total: r.left_total, right_total: r.right_total,
      left_loss_rate: r.left_loss_rate, right_loss_rate: r.right_loss_rate,
      left_general_1: r.left_general_1, left_general_2: r.left_general_2, left_general_3: r.left_general_3,
      right_general_1: r.right_general_1, right_general_2: r.right_general_2, right_general_3: r.right_general_3,
      left_tactic_1_1: r.left_tactic_1_1, left_tactic_1_2: r.left_tactic_1_2, left_tactic_1_3: r.left_tactic_1_3,
      left_tactic_2_1: r.left_tactic_2_1, left_tactic_2_2: r.left_tactic_2_2, left_tactic_2_3: r.left_tactic_2_3,
      left_tactic_3_1: r.left_tactic_3_1, left_tactic_3_2: r.left_tactic_3_2, left_tactic_3_3: r.left_tactic_3_3,
      right_tactic_1_1: r.right_tactic_1_1, right_tactic_1_2: r.right_tactic_1_2, right_tactic_1_3: r.right_tactic_1_3,
      right_tactic_2_1: r.right_tactic_2_1, right_tactic_2_2: r.right_tactic_2_2, right_tactic_2_3: r.right_tactic_2_3,
      right_tactic_3_1: r.right_tactic_3_1, right_tactic_3_2: r.right_tactic_3_2, right_tactic_3_3: r.right_tactic_3_3,
      left_formation: r.left_formation, right_formation: r.right_formation,
      left_alliance: r.left_alliance, right_alliance: r.right_alliance,
      left_general_1_stars: r.left_general_1_stars, left_general_2_stars: r.left_general_2_stars, left_general_3_stars: r.left_general_3_stars,
      right_general_1_stars: r.right_general_1_stars, right_general_2_stars: r.right_general_2_stars, right_general_3_stars: r.right_general_3_stars,
      created_at: r.created_at, updated_at: r.updated_at
    })) });
  } catch (err) { res.json({ code: 500, message: err.message }); }
});

app.post('/api/battles', globalUserCheck, async (req, res) => {
  try {
    const b = normalizeBattleBody(req.body);
    const now = new Date();

    if (b.projectId && b.battle_date && b.attacker_name && b.enemy_name) {
      const [dup] = await pool.query('SELECT id FROM battle_records WHERE project_id=? AND battle_date=? AND attacker_name=? AND enemy_name=? AND result=? LIMIT 1', [b.projectId, b.battle_date, b.attacker_name, b.enemy_name, b.result || '']);
      if (dup.length > 0) return res.json({ code: 200, data: { id: dup[0].id } });
    }

    const fv = v => (v && v !== '') ? v : null;
    const f = (arr, i) => (arr[i] && arr[i] !== '') ? arr[i] : null;

    const [resultRow] = await pool.query(
      'INSERT INTO battle_records (project_id, attacker_name, enemy_name, result, battle_date, description, left_loss, right_loss, left_total, right_total, left_loss_rate, right_loss_rate, left_formation, right_formation, left_alliance, right_alliance, left_general_1, left_general_2, left_general_3, right_general_1, right_general_2, right_general_3, left_tactic_1_1, left_tactic_1_2, left_tactic_1_3, left_tactic_2_1, left_tactic_2_2, left_tactic_2_3, left_tactic_3_1, left_tactic_3_2, left_tactic_3_3, right_tactic_1_1, right_tactic_1_2, right_tactic_1_3, right_tactic_2_1, right_tactic_2_2, right_tactic_2_3, right_tactic_3_1, right_tactic_3_2, right_tactic_3_3, left_general_1_stars, left_general_2_stars, left_general_3_stars, right_general_1_stars, right_general_2_stars, right_general_3_stars, created_by, status, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
      [b.projectId, b.attacker_name, b.enemy_name, b.result, b.battle_date, b.description, b.left_loss, b.right_loss, b.left_total, b.right_total, b.left_loss_rate ?? null, b.right_loss_rate ?? null, b.left_formation, b.right_formation, b.left_alliance, b.right_alliance, f(b.lg,0), f(b.lg,1), f(b.lg,2), f(b.rg,0), f(b.rg,1), f(b.rg,2), f(b.lt,0), f(b.lt,1), f(b.lt,2), f(b.lt,3), f(b.lt,4), f(b.lt,5), f(b.lt,6), f(b.lt,7), f(b.lt,8), f(b.rt,0), f(b.rt,1), f(b.rt,2), f(b.rt,3), f(b.rt,4), f(b.rt,5), f(b.rt,6), f(b.rt,7), f(b.rt,8), b.left_general_1_stars, b.left_general_2_stars, b.left_general_3_stars, b.right_general_1_stars, b.right_general_2_stars, b.right_general_3_stars, 1, 1, now, now]
    );
    res.json({ code: 200, data: { id: resultRow.insertId } });
  } catch (err) { res.json({ code: 500, message: err.message }); }
});

app.put('/api/battles/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const b = normalizeBattleBody(req.body);
    const f = (arr, i) => (arr[i] && arr[i] !== '') ? arr[i] : null;
    const now = new Date();
    await pool.query(
      'UPDATE battle_records SET attacker_name=?, enemy_name=?, result=?, battle_date=?, description=?, left_alliance=?, right_alliance=?, left_loss=?, right_loss=?, left_total=?, right_total=?, left_loss_rate=?, right_loss_rate=?, left_formation=?, right_formation=?, left_general_1=?, left_general_2=?, left_general_3=?, right_general_1=?, right_general_2=?, right_general_3=?, left_tactic_1_1=?, left_tactic_1_2=?, left_tactic_1_3=?, left_tactic_2_1=?, left_tactic_2_2=?, left_tactic_2_3=?, left_tactic_3_1=?, left_tactic_3_2=?, left_tactic_3_3=?, right_tactic_1_1=?, right_tactic_1_2=?, right_tactic_1_3=?, right_tactic_2_1=?, right_tactic_2_2=?, right_tactic_2_3=?, right_tactic_3_1=?, right_tactic_3_2=?, right_tactic_3_3=?, updated_at=? WHERE id=?',
      [b.attacker_name, b.enemy_name, b.result, b.battle_date, b.description, b.left_alliance||'', b.right_alliance||'', b.left_loss, b.right_loss, b.left_total, b.right_total, b.left_loss_rate??null, b.right_loss_rate??null, b.left_formation, b.right_formation, f(b.lg,0), f(b.lg,1), f(b.lg,2), f(b.rg,0), f(b.rg,1), f(b.rg,2), f(b.lt,0), f(b.lt,1), f(b.lt,2), f(b.lt,3), f(b.lt,4), f(b.lt,5), f(b.lt,6), f(b.lt,7), f(b.lt,8), f(b.rt,0), f(b.rt,1), f(b.rt,2), f(b.rt,3), f(b.rt,4), f(b.rt,5), f(b.rt,6), f(b.rt,7), f(b.rt,8), now, id]
    );
    res.json({ code: 200, message: '更新成功' });
  } catch (err) { res.json({ code: 500, message: err.message }); }
});

app.delete('/api/battles/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM battle_gallery WHERE battle_id = ?', [req.params.id]);
    await pool.query('DELETE FROM battle_records WHERE id = ?', [req.params.id]);
    res.json({ code: 200, message: '删除成功' });
  } catch (err) { res.json({ code: 500, message: err.message }); }
});

// ========== 积分 ==========
app.put('/api/user_credits', async (req, res) => {
  try {
    const { phone, balance, type, description, operator_id, operator_phone } = req.body;
    if (!phone || balance === undefined) return res.json({ code: 400, message: '缺少参数' });
    const [rows] = await pool.query('SELECT id, credit_balance FROM users WHERE phone = ?', [phone]);
    if (rows.length === 0) return res.json({ code: 404, message: '用户不存在' });
    const userId = rows[0].id, oldBalance = rows[0].credit_balance || 0, changeAmount = balance - oldBalance;
    await pool.query('UPDATE users SET credit_balance = ? WHERE id = ?', [balance, userId]);
    let finalOperatorId = operator_id || null;
    if (!finalOperatorId && operator_phone) { const [opRows] = await pool.query('SELECT id FROM users WHERE phone = ?', [operator_phone]); if (opRows.length) finalOperatorId = opRows[0].id; }
    const logType = type || 'adjust', logDesc = description || '超管调整积分';
    if (!finalOperatorId && logType === 'consume') finalOperatorId = userId;
    await pool.query('INSERT INTO credit_logs (user_id, change_amount, balance_after, type, description, operator_id, created_at) VALUES (?, ?, ?, ?, ?, ?, NOW())', [userId, changeAmount, balance, logType, logDesc, finalOperatorId]);
    res.json({ code: 200, message: '更新成功' });
  } catch (err) { res.json({ code: 500, message: err.message }); }
});

// ========== 数据库管理 ==========
app.get('/api/db/tables', async (req, res) => {
  try {
    const [tableList] = await pool.query("SELECT table_name as name FROM information_schema.tables WHERE table_schema = 'nslg_battle'");
    const tables = [];
    for (const tbl of tableList) { const [countResult] = await pool.query(`SELECT COUNT(*) as cnt FROM \`${tbl.name}\``); tables.push({ name: tbl.name, count: countResult[0].cnt }); }
    res.json({ code: 200, data: tables });
  } catch (err) { res.json({ code: 500, message: err.message }); }
});

app.get('/api/db/table/:tableName', async (req, res) => {
  try {
    const { tableName } = req.params; const { page = 1, pageSize = 20, search } = req.query; const offset = (page - 1) * pageSize;
    let query = `SELECT * FROM \`${tableName}\``, countQuery = `SELECT COUNT(*) as total FROM \`${tableName}\``, params = [];
    if (search) { query += ` WHERE CONCAT_WS(' ', id, name, description, phone) LIKE ?`; countQuery += ` WHERE CONCAT_WS(' ', id, name, description, phone) LIKE ?`; params.push(`%${search}%`); }
    query += ` LIMIT ?, ?`;
    const [rows] = await pool.query(query, [...params, offset, parseInt(pageSize)]);
    const [countResult] = await pool.query(countQuery, [...params]);
    const [columns] = await pool.query(`DESCRIBE \`${tableName}\``);
    res.json({ code: 200, data: { rows, columns: columns.map(col => ({ field: col.Field, type: col.Type })), pagination: { page: parseInt(page), pageSize: parseInt(pageSize), total: countResult[0].total, totalPages: Math.ceil(countResult[0].total / pageSize) } } });
  } catch (err) { res.json({ code: 500, message: err.message }); }
});

app.get('/api/db/table/:tableName/desc', async (req, res) => {
  try { const [columns] = await pool.query(`DESCRIBE \`${req.params.tableName}\``); res.json({ code: 200, data: { table: req.params.tableName, columns: columns.map(col => ({ field: col.Field, type: col.Type, nullable: col.Null === 'YES', key: col.Key, default: col.Default, extra: col.Extra })) } }); }
  catch (err) { res.json({ code: 500, message: err.message }); }
});

// ========== OCR 代理 ==========
const DOUBAO_API_KEY = process.env.DOUBAO_API_KEY || 'ark-74b37e3f-3407-4070-b918-71d6a455bc5a-19ae6';
const DOUBAO_URL = 'https://ark.cn-beijing.volces.com/api/v3/chat/completions';
const PADDLE_URL = 'http://127.0.0.1:8003/ocr';
const PADDLE_TEST_URL = 'http://127.0.0.1:8003/test';
const PADDLE_STARS_URL = 'http://127.0.0.1:8003/test-stars';
const PADDLE_CACHE_IMG_URL = 'http://127.0.0.1:8003/cache-image';

// ── OCR 全局串行锁（防止并发调用 PaddleOCR 撑爆内存）──
// PaddleOCR 单进程处理一张图约用 1-2 GB；并发两路直接 OOM 死机
const OCR_QUEUE_LIMIT = 5;      // 最多允许 N 个任务在队列里等待
const OCR_COOLDOWN_MS = 3000;   // 每张图处理完后冷却 3 秒让内存回收
const OCR_MEM_THRESHOLD = 0.88; // 可用内存低于总量 12% 时暂停等待
let _ocrLockPromise = Promise.resolve();
let _ocrQueueDepth = 0;

// 等到内存充裕再继续（最多等 60 秒）
async function _waitForMemory(imageName) {
  const total = os.totalmem();
  for (let i = 0; i < 12; i++) {
    const usedRatio = (total - os.freemem()) / total;
    if (usedRatio < OCR_MEM_THRESHOLD) return;
    console.warn(`[OCR] 内存占用 ${(usedRatio * 100).toFixed(1)}%，等待 5s 后继续 文件=${imageName}`);
    await new Promise(r => setTimeout(r, 5000));
  }
  console.warn(`[OCR] 内存等待超时，强制继续 文件=${imageName}`);
}

function withOcrLock(fn, imageName) {
  if (_ocrQueueDepth >= OCR_QUEUE_LIMIT) {
    return Promise.reject(Object.assign(new Error('OCR队列已满，请稍后重试'), { code: 'OCR_QUEUE_FULL' }));
  }
  _ocrQueueDepth++;
  const next = _ocrLockPromise.then(async () => {
    await _waitForMemory(imageName);
    try {
      return await fn();
    } finally {
      // 任务完成后冷却，让 Python GC 有时间回收内存
      await new Promise(r => setTimeout(r, OCR_COOLDOWN_MS));
      _ocrQueueDepth = Math.max(0, _ocrQueueDepth - 1);
    }
  });
  _ocrLockPromise = next.catch(() => {});
  return next;
}

// ── 公共 PaddleOCR 调用（带串行锁 + 错误分类）──
// 返回 { record, paddleRaw, paddleProcessError }
// record 非 null 表示成功；paddleProcessError 非 null 表示 Python 内部错误；
// 两者均 null 表示服务真正不可达（多次重连均失败）
//
// 重试策略分两层：
//   连接失败（服务重启中）→ 每 10s 静默重连，最多等 90s（覆盖计划重启窗口）
//   HTTP 错误（服务在跑但返回异常）→ 快速重试 3 次后报错
async function _callPaddleOcr(body, imageName) {
  return withOcrLock(async () => {
    const CONNECT_RETRY_MS = 10000;   // 连接失败时每隔 10s 重试
    const CONNECT_MAX_RETRIES = 9;    // 最多等 90s（覆盖 OCR 服务重启加载时间）
    const HTTP_MAX_RETRIES = 3;       // HTTP 异常最多重试 3 次
    const HTTP_RETRY_BASE_MS = 2000;

    let record = null, paddleRaw = null, paddleProcessError = null;

    for (let ci = 0; ci < CONNECT_MAX_RETRIES; ci++) {
      let connected = false;
      for (let hi = 0; hi < HTTP_MAX_RETRIES; hi++) {
        try {
          const paddleResp = await fetch(PADDLE_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
            signal: AbortSignal.timeout(240000)
          });
          connected = true;
          if (paddleResp.ok) {
            paddleRaw = await paddleResp.json();
            if (paddleRaw.ok) { record = mapPaddleResult(paddleRaw); break; }
            // Python 内部处理失败 → 不重试
            paddleProcessError = paddleRaw.error || 'Python OCR 处理失败';
            console.error(`[OCR] Python处理失败 文件=${imageName}:`, paddleProcessError);
            if (paddleRaw.trace) console.error(`[OCR] Traceback:`, paddleRaw.trace.slice(0, 500));
            break;
          }
          console.warn(`[OCR] HTTP ${paddleResp.status} (HTTP重试 ${hi + 1}/${HTTP_MAX_RETRIES}) 文件=${imageName}`);
          if (hi < HTTP_MAX_RETRIES - 1) {
            await new Promise(r => setTimeout(r, HTTP_RETRY_BASE_MS * Math.pow(2, hi)));
          }
        } catch (e) {
          // 连接失败（服务不在线/正在重启）→ 跳出 HTTP 重试，进入连接等待
          break;
        }
      }
      // 已拿到结果（成功或 Python 内部错误）→ 退出
      if (connected) break;
      // 服务不可达，静默等待后重连
      if (ci < CONNECT_MAX_RETRIES - 1) {
        console.warn(`[OCR] 服务不可达，${CONNECT_RETRY_MS / 1000}s 后重连 (${ci + 1}/${CONNECT_MAX_RETRIES}) 文件=${imageName}`);
        await new Promise(r => setTimeout(r, CONNECT_RETRY_MS));
      } else {
        console.error(`[OCR] 服务连接超时，已等待 ${CONNECT_RETRY_MS * CONNECT_MAX_RETRIES / 1000}s 文件=${imageName}`);
      }
    }
    return { record, paddleRaw, paddleProcessError };
  }, imageName);
}

// ── 字典缓存（减少长时间批处理中的 DB 查询）──
const _dictCache = { heroNames: null, tacticNames: null, playerDicts: {} };
const _DICT_CACHE_TTL_MS = 5 * 60 * 1000;  // 5 分钟

async function getCachedDicts(projectId) {
  const now = Date.now();
  // 英雄 & 战法字典（全局，很少变动）
  if (!_dictCache.heroNames || (now - _dictCache.heroNames._ts) > _DICT_CACHE_TTL_MS) {
    const [rows] = await pool.query('SELECT name FROM ocr_hero_dict ORDER BY id');
    _dictCache.heroNames = { data: rows.map(r => r.name), _ts: now };
  }
  if (!_dictCache.tacticNames || (now - _dictCache.tacticNames._ts) > _DICT_CACHE_TTL_MS) {
    const [rows] = await pool.query('SELECT name FROM ocr_tactic_dict ORDER BY id');
    _dictCache.tacticNames = { data: rows.map(r => r.name), _ts: now };
  }
  // 项目玩家字典（按 projectId 缓存）
  const pid = projectId || 0;
  const pc = _dictCache.playerDicts[pid];
  if (!pc || (now - pc._ts) > _DICT_CACHE_TTL_MS) {
    if (projectId) {
      const [rows] = await pool.query(
        'SELECT DISTINCT player_name, alliance_name FROM project_player_dict WHERE project_id = ? AND (player_name != \'\' OR alliance_name != \'\')',
        [projectId]
      );
      _dictCache.playerDicts[pid] = {
        data: {
          playerNames: [...new Set(rows.map(r => r.player_name).filter(Boolean))],
          allianceNames: [...new Set(rows.map(r => r.alliance_name).filter(Boolean))],
        },
        _ts: now,
      };
    } else {
      _dictCache.playerDicts[pid] = { data: { playerNames: [], allianceNames: [] }, _ts: now };
    }
  }
  return {
    heroNames: _dictCache.heroNames.data,
    tacticNames: _dictCache.tacticNames.data,
    playerNames: _dictCache.playerDicts[pid].data.playerNames,
    allianceNames: _dictCache.playerDicts[pid].data.allianceNames,
  };
}

app.post('/api/ocr-paddle', requireActiveUser, async (req, res) => {
  try {
    const { image, labelConfig } = req.body;
    if (!image) return res.status(400).json({ ok: false, error: '缺少 image 参数' });
    const body = { image }; if (labelConfig) body.labelConfig = labelConfig;
    const resp = await fetch(PADDLE_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(60000) });
    if (!resp.ok) return res.status(502).json({ ok: false, error: `OCR服务异常: ${resp.status}` });
    res.json(await resp.json());
  } catch (err) { res.status(503).json({ ok: false, error: `OCR服务不可用: ${err.message}` }); }
});

app.post('/api/ocr', requireActiveUser, async (req, res) => {
  try {
    const response = await fetch(DOUBAO_URL, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${DOUBAO_API_KEY}` }, body: JSON.stringify(req.body) });
    const data = await response.json();
    if (!response.ok) return res.status(response.status).json({ error: data.error || data, code: response.status });
    res.json(data);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ========== OCR 任务队列接口 ==========

// 1. 创建待处理任务（自动监听使用）
app.post('/api/battles/ocr-tasks', requireOcrUploadActor, async (req, res) => {
  try {
    const { image, projectId, imageName, battleDate, labelConfig, helperTaskId } = req.body;
    if (!image) return res.json({ code: 400, message: '缺少图片数据' });

    const phone = req.authPhone;
    const [uRows] = await pool.query('SELECT id, credit_balance FROM users WHERE phone = ? LIMIT 1', [phone]);
    if (!uRows.length) return res.json({ code: 401, message: '用户不存在' });
    const userId = uRows[0].id;

    // 不预扣积分，等待执行时再扣
    const cleanImage = image.replace(/^data:[^;]+;base64,/, '');

    const [result] = await pool.query(
      `INSERT INTO ocr_pending_tasks
       (user_id, project_id, image_base64, image_name, battle_date, label_config, helper_task_id, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', NOW(), NOW())`,
      [userId, projectId || null, cleanImage, imageName || '', battleDate || null, labelConfig ? JSON.stringify(labelConfig) : null, helperTaskId || null]
    );

    // 如果是自动监听任务，更新 ocr_watch_tasks 的 pending_count
    if (helperTaskId) {
      console.log('[OCR-Tasks] 更新 pending_count, helperTaskId:', helperTaskId);
      const [updateResult] = await pool.query(
        `UPDATE ocr_watch_tasks
         SET pending_count = (SELECT COUNT(*) FROM ocr_pending_tasks WHERE helper_task_id = ? AND status = 'pending')
         WHERE id = ?`,
        [helperTaskId, helperTaskId]
      );
      console.log('[OCR-Tasks] UPDATE 影响行数:', updateResult.affectedRows);
    }

    res.json({ code: 200, message: '任务已加入队列', data: { taskId: result.insertId } });
  } catch (err) {
    console.error('[OCR-Tasks] 创建任务失败:', err);
    res.json({ code: 500, message: err.message });
  }
});

// 2. 获取待处理任务列表
app.get('/api/battles/ocr-tasks', requireActiveUser, async (req, res) => {
  try {
    const { projectId, status } = req.query;
    const userId = req.authUserId;

    let sql = 'SELECT id, project_id, image_name, battle_date, status, helper_task_id, created_at FROM ocr_pending_tasks WHERE user_id = ?';
    const params = [userId];

    if (projectId) {
      sql += ' AND project_id = ?';
      params.push(Number(projectId));
    }

    if (status) {
      sql += ' AND status = ?';
      params.push(status);
    }

    sql += ' ORDER BY created_at ASC LIMIT 100';

    const [tasks] = await pool.query(sql, params);
    res.json({ code: 200, data: tasks });
  } catch (err) {
    console.error('[OCR-Tasks] 获取任务列表失败:', err);
    res.json({ code: 500, message: err.message });
  }
});

// 3. 执行OCR处理（前端统一调用）
app.post('/api/battles/ocr-execute', requireActiveUser, async (req, res) => {
  try {
    const { taskId } = req.body;
    if (!taskId) return res.json({ code: 400, message: '缺少任务ID' });

    const userId = req.authUserId;
    const phone = req.authPhone;

    // 获取任务
    const [tasks] = await pool.query(
      'SELECT id, user_id, project_id, image_base64, image_name, battle_date, label_config, helper_task_id, status FROM ocr_pending_tasks WHERE id = ? AND user_id = ? LIMIT 1',
      [taskId, userId]
    );

    if (!tasks.length) return res.json({ code: 404, message: '任务不存在' });
    const task = tasks[0];

    if (task.status !== 'pending') return res.json({ code: 400, message: '任务状态无效' });

    // 检查积分
    const [uRows] = await pool.query('SELECT id, credit_balance FROM users WHERE id = ? LIMIT 1', [userId]);
    if (!uRows.length) return res.json({ code: 401, message: '用户不存在' });
    if ((uRows[0].credit_balance || 0) <= 0) return res.json({ code: 402, message: '积分不足' });

    // 更新任务状态为处理中
    await pool.query('UPDATE ocr_pending_tasks SET status = ?, updated_at = NOW() WHERE id = ?', ['processing', taskId]);

    // 执行OCR
    const { heroNames, tacticNames, playerNames, allianceNames } = await getCachedDicts(task.project_id);
    const ocrBody = { image: task.image_base64, heroNames, tacticNames, playerNames, allianceNames };

    if (task.label_config) {
      try {
        ocrBody.labelConfig = JSON.parse(task.label_config);
      } catch (e) {}
    }

    let ocrResult;
    try {
      ocrResult = await _callPaddleOcr(ocrBody, task.image_name);
    } catch (e) {
      await pool.query('UPDATE ocr_pending_tasks SET status = ?, updated_at = NOW() WHERE id = ?', ['failed', taskId]);
      if (e.code === 'OCR_QUEUE_FULL') return res.json({ code: 429, message: 'OCR队列已满，请稍后重试' });
      throw e;
    }

    const { record, paddleRaw, paddleProcessError } = ocrResult;

    const pendingTactics = [];
    if (paddleRaw && paddleRaw.ok) {
      for (const t of [...(paddleRaw.leftTactics || []), ...(paddleRaw.rightTactics || [])]) {
        if (typeof t === 'string' && t.startsWith('待确认:')) { const raw = t.slice(4).trim(); if (raw) pendingTactics.push(raw); }
      }
    }

    if (paddleProcessError) {
      await pool.query('UPDATE ocr_pending_tasks SET status = ?, updated_at = NOW() WHERE id = ?', ['failed', taskId]);
      return res.json({ code: 422, message: `图片处理失败: ${paddleProcessError}` });
    }

    if (!record) {
      await pool.query('UPDATE ocr_pending_tasks SET status = ?, updated_at = NOW() WHERE id = ?', ['failed', taskId]);
      return res.json({ code: 503, message: 'OCR 服务不可用，请检查本地 PaddleOCR 是否正在运行' });
    }

    const now = new Date();
    record.battleDate = task.battle_date || now.toISOString().split('T')[0];
    record.time = now.toLocaleString('zh-CN');

    const fv = v => (v && v !== '') ? v : null;
    const insertParams = [
      task.project_id || null, record.leftPlayer || record.attackerName || '', record.rightPlayer || record.enemyName || '',
      record.result || '', record.battleDate, '',
      fv(record.leftLoss), fv(record.rightLoss), fv(record.leftTotal), fv(record.rightTotal),
      record.leftLossRate != null ? record.leftLossRate : null, record.rightLossRate != null ? record.rightLossRate : null,
      fv(record.leftFormation), fv(record.rightFormation), fv(record.leftAlliance), fv(record.rightAlliance),
      fv(record.leftGeneral1), fv(record.leftGeneral2), fv(record.leftGeneral3),
      fv(record.rightGeneral1), fv(record.rightGeneral2), fv(record.rightGeneral3),
      fv(record.leftTactic1_1), fv(record.leftTactic1_2), fv(record.leftTactic1_3),
      fv(record.leftTactic2_1), fv(record.leftTactic2_2), fv(record.leftTactic2_3),
      fv(record.leftTactic3_1), fv(record.leftTactic3_2), fv(record.leftTactic3_3),
      fv(record.rightTactic1_1), fv(record.rightTactic1_2), fv(record.rightTactic1_3),
      fv(record.rightTactic2_1), fv(record.rightTactic2_2), fv(record.rightTactic2_3),
      fv(record.rightTactic3_1), fv(record.rightTactic3_2), fv(record.rightTactic3_3),
      record.leftGeneral1Stars ?? 0, record.leftGeneral2Stars ?? 0, record.leftGeneral3Stars ?? 0,
      record.rightGeneral1Stars ?? 0, record.rightGeneral2Stars ?? 0, record.rightGeneral3Stars ?? 0,
      userId, 1, now, now
    ];

    const [insertResult] = await pool.query(
      'INSERT INTO battle_records (project_id, attacker_name, enemy_name, result, battle_date, description, left_loss, right_loss, left_total, right_total, left_loss_rate, right_loss_rate, left_formation, right_formation, left_alliance, right_alliance, left_general_1, left_general_2, left_general_3, right_general_1, right_general_2, right_general_3, left_tactic_1_1, left_tactic_1_2, left_tactic_1_3, left_tactic_2_1, left_tactic_2_2, left_tactic_2_3, left_tactic_3_1, left_tactic_3_2, left_tactic_3_3, right_tactic_1_1, right_tactic_1_2, right_tactic_1_3, right_tactic_2_1, right_tactic_2_2, right_tactic_2_3, right_tactic_3_1, right_tactic_3_2, right_tactic_3_3, left_general_1_stars, left_general_2_stars, left_general_3_stars, right_general_1_stars, right_general_2_stars, right_general_3_stars, created_by, status, created_at, updated_at) VALUES (' + insertParams.map(() => '?').join(',') + ')',
      insertParams
    );
    const newId = insertResult.insertId;

    for (const raw of [...new Set(pendingTactics)]) {
      await pool.query(`INSERT INTO ocr_tactic_pending (raw_text, detect_count, source_battle_id, status, created_at) VALUES (?, 1, ?, 'pending', NOW()) ON DUPLICATE KEY UPDATE detect_count = detect_count + 1`, [raw, newId]);
    }

    if (task.image_base64) {
      const imageBuf = Buffer.from(task.image_base64, 'base64');
      await pool.query('INSERT INTO battle_gallery (project_id, battle_id, image_data, original_name, file_size, uploaded_by, created_at, updated_at) VALUES (?,?,?,?,?,?,NOW(),NOW())', [task.project_id || null, newId, imageBuf, task.image_name || '', imageBuf.length, userId]);
    }

    await pool.query('UPDATE users SET credit_balance = credit_balance - 1 WHERE id = ?', [userId]);
    await pool.query('INSERT INTO credit_logs (user_id, change_amount, balance_after, type, description, operator_id, created_at) SELECT ?, -1, credit_balance, ?, ?, ?, NOW() FROM users WHERE id = ?', [userId, 'consume', `OCR识别: ${task.image_name || '战报'}`, userId, userId]);

    // 更新任务状态为完成
    await pool.query('UPDATE ocr_pending_tasks SET status = ?, updated_at = NOW() WHERE id = ?', ['done', taskId]);

    // 更新 helper 任务统计
    if (task.helper_task_id) {
      const helperTaskId = Number(task.helper_task_id);
      if (Number.isInteger(helperTaskId) && helperTaskId > 0) {
        // 更新 pending_count 和 processed_count
        await pool.query(
          `UPDATE ocr_watch_tasks
           SET pending_count = (SELECT COUNT(*) FROM ocr_pending_tasks WHERE helper_task_id = ? AND status = 'pending'),
               processed_count = (SELECT COUNT(*) FROM ocr_pending_tasks WHERE helper_task_id = ? AND status = 'done'),
               last_heartbeat = NOW(),
               updated_at = NOW()
           WHERE id = ?`,
          [helperTaskId, helperTaskId, helperTaskId]
        );
      }
    }

    res.json({ code: 200, message: '识别成功', data: { battleId: newId, record } });
  } catch (err) {
    console.error('[OCR-Execute] 执行失败:', err);
    res.json({ code: 500, message: err.message });
  }
});

// 4. 批量删除待处理任务（清空队列）
app.post('/api/battles/ocr-clear-pending', requireActiveUser, async (req, res) => {
  try {
    const { projectId } = req.body;
    const userId = req.authUserId;

    if (!projectId) return res.json({ code: 400, message: '缺少项目ID' });

    // 删除当前项目的所有 pending 状态任务
    const [deleteResult] = await pool.query(
      'DELETE FROM ocr_pending_tasks WHERE user_id = ? AND project_id = ? AND status = ?',
      [userId, Number(projectId), 'pending']
    );

    // 更新所有关联监听任务的 pending_count
    await pool.query(
      `UPDATE ocr_watch_tasks
       SET pending_count = (SELECT COUNT(*) FROM ocr_pending_tasks WHERE helper_task_id = ocr_watch_tasks.id AND status = 'pending'),
           updated_at = NOW()
       WHERE user_id = ? AND project_id = ?`,
      [userId, Number(projectId)]
    );

    res.json({ code: 200, message: '清空成功', data: { deletedCount: deleteResult.affectedRows } });
  } catch (err) {
    console.error('[OCR-Clear] 清空失败:', err);
    res.json({ code: 500, message: err.message });
  }
});

// ========== OCR 一站式上传（手动上传使用，保留兼容）==========
app.post('/api/battles/ocr-upload', requireOcrUploadActor, async (req, res) => {
  try {
    const { image, projectId, imageName, battleDate: clientDate, labelConfig } = req.body;
    if (!image) return res.json({ code: 400, message: '缺少图片数据' });
    const phone = req.authPhone;
    const [uRows] = await pool.query('SELECT id, credit_balance FROM users WHERE phone = ? LIMIT 1', [phone]);
    if (!uRows.length) return res.json({ code: 401, message: '用户不存在' });
    const userId = uRows[0].id;
    if ((uRows[0].credit_balance || 0) <= 0) return res.json({ code: 402, message: '积分不足' });
    const cleanImage = image.replace(/^data:[^;]+;base64,/, '');

    const { heroNames, tacticNames, playerNames, allianceNames } = await getCachedDicts(projectId);

    const ocrBody = { image: cleanImage, heroNames, tacticNames, playerNames, allianceNames };
    if (labelConfig) ocrBody.labelConfig = labelConfig;
    let ocrResult;
    try {
      ocrResult = await _callPaddleOcr(ocrBody, imageName);
    } catch (e) {
      if (e.code === 'OCR_QUEUE_FULL') return res.json({ code: 429, message: 'OCR队列已满，请稍后重试' });
      throw e;
    }
    const { record, paddleRaw, paddleProcessError } = ocrResult;

    const pendingTactics = [];
    if (paddleRaw && paddleRaw.ok) {
      for (const t of [...(paddleRaw.leftTactics || []), ...(paddleRaw.rightTactics || [])]) {
        if (typeof t === 'string' && t.startsWith('待确认:')) { const raw = t.slice(4).trim(); if (raw) pendingTactics.push(raw); }
      }
    }
    // 处理失败（Python 内部错误）→ 422，前端立即跳过不重试
    if (paddleProcessError) return res.json({ code: 422, message: `图片处理失败: ${paddleProcessError}` });
    // 服务不可达 → 503，前端可重试
    if (!record) return res.json({ code: 503, message: 'OCR 服务不可用，请检查本地 PaddleOCR 是否正在运行' });

    const now = new Date();
    record.battleDate = clientDate || now.toISOString().split('T')[0];
    record.time = now.toLocaleString('zh-CN');

    const fv = v => (v && v !== '') ? v : null;
    const insertParams = [
      projectId || null, record.leftPlayer || record.attackerName || '', record.rightPlayer || record.enemyName || '',
      record.result || '', record.battleDate, '',
      fv(record.leftLoss), fv(record.rightLoss), fv(record.leftTotal), fv(record.rightTotal),
      record.leftLossRate != null ? record.leftLossRate : null, record.rightLossRate != null ? record.rightLossRate : null,
      fv(record.leftFormation), fv(record.rightFormation), fv(record.leftAlliance), fv(record.rightAlliance),
      fv(record.leftGeneral1), fv(record.leftGeneral2), fv(record.leftGeneral3),
      fv(record.rightGeneral1), fv(record.rightGeneral2), fv(record.rightGeneral3),
      fv(record.leftTactic1_1), fv(record.leftTactic1_2), fv(record.leftTactic1_3),
      fv(record.leftTactic2_1), fv(record.leftTactic2_2), fv(record.leftTactic2_3),
      fv(record.leftTactic3_1), fv(record.leftTactic3_2), fv(record.leftTactic3_3),
      fv(record.rightTactic1_1), fv(record.rightTactic1_2), fv(record.rightTactic1_3),
      fv(record.rightTactic2_1), fv(record.rightTactic2_2), fv(record.rightTactic2_3),
      fv(record.rightTactic3_1), fv(record.rightTactic3_2), fv(record.rightTactic3_3),
      record.leftGeneral1Stars ?? 0, record.leftGeneral2Stars ?? 0, record.leftGeneral3Stars ?? 0,
      record.rightGeneral1Stars ?? 0, record.rightGeneral2Stars ?? 0, record.rightGeneral3Stars ?? 0,
      userId, 1, now, now
    ];

    const [insertResult] = await pool.query(
      'INSERT INTO battle_records (project_id, attacker_name, enemy_name, result, battle_date, description, left_loss, right_loss, left_total, right_total, left_loss_rate, right_loss_rate, left_formation, right_formation, left_alliance, right_alliance, left_general_1, left_general_2, left_general_3, right_general_1, right_general_2, right_general_3, left_tactic_1_1, left_tactic_1_2, left_tactic_1_3, left_tactic_2_1, left_tactic_2_2, left_tactic_2_3, left_tactic_3_1, left_tactic_3_2, left_tactic_3_3, right_tactic_1_1, right_tactic_1_2, right_tactic_1_3, right_tactic_2_1, right_tactic_2_2, right_tactic_2_3, right_tactic_3_1, right_tactic_3_2, right_tactic_3_3, left_general_1_stars, left_general_2_stars, left_general_3_stars, right_general_1_stars, right_general_2_stars, right_general_3_stars, created_by, status, created_at, updated_at) VALUES (' + insertParams.map(() => '?').join(',') + ')',
      insertParams
    );
    const newId = insertResult.insertId;

    for (const raw of [...new Set(pendingTactics)]) {
      await pool.query(`INSERT INTO ocr_tactic_pending (raw_text, detect_count, source_battle_id, status, created_at) VALUES (?, 1, ?, 'pending', NOW()) ON DUPLICATE KEY UPDATE detect_count = detect_count + 1`, [raw, newId]);
    }

    if (image) {
      const imageBuf = Buffer.from(cleanImage, 'base64');
      await pool.query('INSERT INTO battle_gallery (project_id, battle_id, image_data, original_name, file_size, uploaded_by, created_at, updated_at) VALUES (?,?,?,?,?,?,NOW(),NOW())', [projectId || null, newId, imageBuf, imageName || '', imageBuf.length, userId]);
    }

    await pool.query('UPDATE users SET credit_balance = credit_balance - 1 WHERE id = ?', [userId]);
    await pool.query('INSERT INTO credit_logs (user_id, change_amount, balance_after, type, description, operator_id, created_at) SELECT ?, -1, credit_balance, ?, ?, ?, NOW() FROM users WHERE id = ?', [userId, 'consume', `OCR识别: ${imageName || '战报'}`, userId, userId]);

    if (req.body && req.body.helperTaskId) {
      const taskId = Number(req.body.helperTaskId);
      if (Number.isInteger(taskId) && taskId > 0) {
        const [taskRows] = await pool.query('SELECT stats_json FROM ocr_watch_tasks WHERE id = ? AND user_id = ? LIMIT 1', [taskId, userId]);
        if (taskRows.length) {
          const currentStats = parseTaskStats(taskRows[0].stats_json);
          currentStats.uploaded += 1;
          currentStats.parsed += 1;
          currentStats.pending = Math.max(0, currentStats.discovered - currentStats.uploaded);
          await pool.query(
            `UPDATE ocr_watch_tasks
             SET status = 'running',
                 helper_client_id = COALESCE(?, helper_client_id),
                 last_heartbeat_at = NOW(),
                 last_upload_at = NOW(),
                 last_error = NULL,
                 stats_json = ?,
                 updated_at = NOW()
             WHERE id = ?`,
            [req.helperClientId || null, JSON.stringify(currentStats), taskId]
          );
        }
      }
    }
    record.id = newId; record.cloudId = newId; record.projectId = projectId;
    record.attackerName = record.leftPlayer || ''; record.enemyName = record.rightPlayer || '';
    res.json({ code: 200, data: record });
  } catch (err) { console.error('[OCR-Upload]', err); res.json({ code: 500, message: err.message }); }
});

// ========== 战报图片 ==========
app.post('/api/gallery', requireActiveUser, async (req, res) => {
  try {
    const { battle_id, project_id, image_data, original_name, uploader_phone } = req.body;
    if (!image_data || !project_id) return res.json({ code: 400, message: '缺少参数' });
    let uploaded_by = null;
    if (uploader_phone) { const [uRows] = await pool.query('SELECT id FROM users WHERE phone = ? LIMIT 1', [uploader_phone]); if (uRows.length > 0) uploaded_by = uRows[0].id; }
    const raw = typeof image_data === 'string' ? image_data.replace(/^data:[^;]+;base64,/, '') : image_data;
    const imageBuf = Buffer.isBuffer(raw) ? raw : Buffer.from(raw, 'base64');
    if (battle_id) {
      const [exist] = await pool.query('SELECT id FROM battle_gallery WHERE battle_id = ?', [battle_id]);
      if (exist.length > 0) { await pool.query('UPDATE battle_gallery SET image_data=?, original_name=?, file_size=?, uploaded_by=?, updated_at=NOW() WHERE battle_id=?', [imageBuf, original_name || '', imageBuf.length, uploaded_by, battle_id]); return res.json({ code: 200, data: { id: exist[0].id } }); }
    }
    const [result] = await pool.query('INSERT INTO battle_gallery (project_id, battle_id, image_data, original_name, file_size, uploaded_by, created_at, updated_at) VALUES (?,?,?,?,?,?,NOW(),NOW())', [project_id, battle_id || null, imageBuf, original_name || '', imageBuf.length, uploaded_by]);
    res.json({ code: 200, data: { id: result.insertId } });
  } catch (err) { res.json({ code: 500, message: err.message }); }
});

app.get('/api/gallery/by-battle/:battleId', async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT id, battle_id, image_data FROM battle_gallery WHERE battle_id=? AND status=1 LIMIT 1', [req.params.battleId]);
    if (!rows.length) return res.json({ code: 404, message: '无图片' });
    const row = rows[0];
    // 将 Buffer 转为 base64，前端可直用
    if (Buffer.isBuffer(row.image_data)) {
      row.image_data = 'data:image/png;base64,' + row.image_data.toString('base64');
    }
    res.json({ code: 200, data: row });
  }
  catch (err) { res.json({ code: 500, message: err.message }); }
});

app.get('/api/gallery/imagenames', requireOcrUploadActor, async (req, res) => {
  try {
    let query, params = [req.authUserId];
    const projectId = req.query.projectId || '';
    if (req.query.successOnly === 'true') {
      query = `SELECT DISTINCT bg.original_name FROM battle_gallery bg INNER JOIN battle_records br ON bg.battle_id = br.id WHERE bg.uploaded_by = ? AND bg.original_name != '' AND bg.status = 1 AND br.left_general_1 IS NOT NULL AND br.left_general_1 != ''`;
      if (projectId) { query += ` AND bg.project_id = ?`; params.push(projectId); }
    } else {
      query = `SELECT DISTINCT original_name FROM battle_gallery WHERE uploaded_by = ? AND original_name != '' AND status = 1`;
      if (projectId) { query += ` AND project_id = ?`; params.push(projectId); }
    }
    const [rows] = await pool.query(query, params);
    res.json({ code: 200, data: rows.map(r => r.original_name) });
  } catch (err) { res.json({ code: 500, message: err.message }); }
});

app.get('/api/gallery/image/:battleId', async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT image_data FROM battle_gallery WHERE battle_id = ? AND status = 1 LIMIT 1', [req.params.battleId]);
    if (!rows.length) return res.status(404).json({ code: 404, message: '无图片' });
    let raw = rows[0].image_data;
    if (!raw) return res.status(404).json({ code: 404, message: '图片数据为空' });
    let mime = 'image/png';
    if (typeof raw === 'string') {
      // legacy: 旧 base64 文本数据
      const m = raw.match(/^data:(image\/[\w+-]+);base64,/);
      if (m) { mime = m[1]; raw = raw.slice(m[0].length); }
      raw = Buffer.from(raw, 'base64');
    }
    res.setHeader('Content-Type', mime);
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.send(raw);
  } catch (err) { res.status(500).json({ code: 500, message: err.message }); }
});

app.get('/api/gallery/has-image/:battleId', async (req, res) => {
  try { const [rows] = await pool.query('SELECT 1 FROM battle_gallery WHERE battle_id = ? AND status = 1 LIMIT 1', [req.params.battleId]); res.json({ code: 200, data: { hasImage: rows.length > 0 } }); }
  catch (err) { res.json({ code: 500, message: err.message }); }
});

// ========== 下载 ==========
app.get('/api/download/screenshot-tool', (req, res) => {
  const fp = path.resolve(__dirname, 'release', '三谋战报截图工具.exe');
  if (!fs.existsSync(fp)) return res.status(404).json({ code: 404, message: '文件不存在' });
  res.download(fp, '三谋战报截图工具.exe', (err) => { if (err && !res.headersSent) res.status(500).json({ code: 500, message: '下载失败：' + err.message }); });
});

app.get('/download/start-helper.bat', (req, res) => {
  const fp = path.resolve(__dirname, 'start-helper.bat');
  if (!fs.existsSync(fp)) return res.status(404).json({ code: 404, message: '文件不存在' });
  res.download(fp, '启动本地助手.bat');
});

// ========== 星标框选 ==========
app.post('/api/star-boxes', requireActiveUser, async (req, res) => {
  try {
    const { projectId, imageWidth, imageHeight, boxes } = req.body;
    if (!projectId || !boxes || !Array.isArray(boxes) || boxes.length !== 6) return res.json({ code: 400, message: '参数错误：需要 projectId 和 6 个框选区域' });
    await pool.query(`INSERT INTO star_box_configs (project_id, image_width, image_height, boxes_json) VALUES (?, ?, ?, ?) ON DUPLICATE KEY UPDATE image_width=VALUES(image_width), image_height=VALUES(image_height), boxes_json=VALUES(boxes_json), updated_at=NOW()`, [projectId, imageWidth || 0, imageHeight || 0, JSON.stringify(boxes)]);
    res.json({ code: 200, message: '保存成功' });
  } catch (err) { res.json({ code: 500, message: err.message }); }
});

app.get('/api/star-boxes/:projectId', async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT * FROM star_box_configs WHERE project_id = ? LIMIT 1', [req.params.projectId]);
    if (!rows.length) return res.json({ code: 200, data: null });
    const r = rows[0];
    res.json({ code: 200, data: { id: r.id, projectId: r.project_id, imageWidth: r.image_width, imageHeight: r.image_height, boxes: JSON.parse(r.boxes_json || '[]'), updatedAt: r.updated_at } });
  } catch (err) { res.json({ code: 500, message: err.message }); }
});

// ========== 标注配置 ==========
app.post('/api/label-config', requireActiveUser, async (req, res) => {
  try {
    const { projectId, imageWidth, imageHeight, categories, global } = req.body;
    if (!categories || typeof categories !== 'object') return res.json({ code: 400, message: '参数错误：需要 categories 对象' });
    const pid = global ? 0 : (projectId || 0); if (!pid && !global) return res.json({ code: 400, message: '需要 projectId 或 global=true' });
    await pool.query(`INSERT INTO label_configs (project_id, image_width, image_height, categories_json) VALUES (?, ?, ?, ?) ON DUPLICATE KEY UPDATE image_width=VALUES(image_width), image_height=VALUES(image_height), categories_json=VALUES(categories_json), updated_at=NOW()`, [pid, imageWidth || 0, imageHeight || 0, JSON.stringify(categories)]);
    res.json({ code: 200, message: '保存成功' });
  } catch (err) { res.json({ code: 500, message: err.message }); }
});

app.get('/api/label-config/:projectId', async (req, res) => {
  try {
    let [rows] = await pool.query('SELECT * FROM label_configs WHERE project_id = ? LIMIT 1', [req.params.projectId]);
    if (!rows.length) [rows] = await pool.query('SELECT * FROM label_configs WHERE project_id = 0 LIMIT 1');
    if (!rows.length) return res.json({ code: 200, data: null });
    const r = rows[0];
    res.json({ code: 200, data: { id: r.id, projectId: r.project_id, imageWidth: r.image_width, imageHeight: r.image_height, categories: JSON.parse(r.categories_json || '{}'), updatedAt: r.updated_at, isGlobal: r.project_id === 0 } });
  } catch (err) { res.json({ code: 500, message: err.message }); }
});

// ========== OCR 字段库 ==========
async function requireSuperAdmin(req, res, next) {
  const phone = extractPhoneFromToken(req.headers['authorization'] || '');
  if (!phone) return res.status(401).json({ code: 401, message: '未登录' });
  const [rows] = await pool.query('SELECT role_id FROM users WHERE phone = ? LIMIT 1', [phone]);
  if (!rows.length || rows[0].role_id !== 'super_admin') return res.status(403).json({ code: 403, message: '无权限，仅超管可操作' });
  req.authPhone = phone; next();
}

app.get('/api/ocr-dict/heroes', requireSuperAdmin, async (req, res) => {
  try { const { q } = req.query; let sql = 'SELECT id, name, created_at FROM ocr_hero_dict', params = []; if (q) { sql += ' WHERE name LIKE ?'; params.push('%' + q + '%'); } sql += ' ORDER BY id ASC'; res.json({ code: 200, data: await pool.query(sql, params).then(([r]) => r) }); }
  catch (err) { res.json({ code: 500, message: err.message }); }
});
app.post('/api/ocr-dict/heroes', requireSuperAdmin, async (req, res) => {
  try { const { name } = req.body; if (!name || !name.trim()) return res.json({ code: 400, message: '名称不能为空' }); await pool.query('INSERT INTO ocr_hero_dict (name) VALUES (?)', [name.trim()]); res.json({ code: 200, message: '添加成功' }); }
  catch (err) { if (err.code === 'ER_DUP_ENTRY') return res.json({ code: 409, message: '已存在' }); res.json({ code: 500, message: err.message }); }
});
app.put('/api/ocr-dict/heroes/:id', requireSuperAdmin, async (req, res) => {
  try { const { name } = req.body; if (!name || !name.trim()) return res.json({ code: 400, message: '名称不能为空' }); const [r] = await pool.query('UPDATE ocr_hero_dict SET name = ? WHERE id = ?', [name.trim(), req.params.id]); if (!r.affectedRows) return res.json({ code: 404, message: '不存在' }); res.json({ code: 200, message: '更新成功' }); }
  catch (err) { if (err.code === 'ER_DUP_ENTRY') return res.json({ code: 409, message: '名称已存在' }); res.json({ code: 500, message: err.message }); }
});
app.delete('/api/ocr-dict/heroes/:id', requireSuperAdmin, async (req, res) => {
  try { await pool.query('DELETE FROM ocr_hero_dict WHERE id = ?', [req.params.id]); res.json({ code: 200, message: '删除成功' }); } catch (err) { res.json({ code: 500, message: err.message }); }
});
app.post('/api/ocr-dict/heroes/batch', requireSuperAdmin, async (req, res) => {
  try { const { names } = req.body; if (!Array.isArray(names) || !names.length) return res.json({ code: 400, message: '参数错误' }); let added = 0, skipped = 0; for (const n of names) { const name = (n || '').trim(); if (!name) continue; const [r] = await pool.query('INSERT IGNORE INTO ocr_hero_dict (name) VALUES (?)', [name]); r.affectedRows ? added++ : skipped++; } res.json({ code: 200, message: `导入完成：新增 ${added} 条，跳过重复 ${skipped} 条` }); }
  catch (err) { res.json({ code: 500, message: err.message }); }
});

app.get('/api/ocr-dict/tactics', requireSuperAdmin, async (req, res) => {
  try { const { q } = req.query; let sql = 'SELECT id, name, created_at FROM ocr_tactic_dict', params = []; if (q) { sql += ' WHERE name LIKE ?'; params.push('%' + q + '%'); } sql += ' ORDER BY id ASC'; res.json({ code: 200, data: await pool.query(sql, params).then(([r]) => r) }); }
  catch (err) { res.json({ code: 500, message: err.message }); }
});
app.post('/api/ocr-dict/tactics', requireSuperAdmin, async (req, res) => {
  try { const { name } = req.body; if (!name || !name.trim()) return res.json({ code: 400, message: '名称不能为空' }); await pool.query('INSERT INTO ocr_tactic_dict (name) VALUES (?)', [name.trim()]); res.json({ code: 200, message: '添加成功' }); }
  catch (err) { if (err.code === 'ER_DUP_ENTRY') return res.json({ code: 409, message: '已存在' }); res.json({ code: 500, message: err.message }); }
});
app.put('/api/ocr-dict/tactics/:id', requireSuperAdmin, async (req, res) => {
  try { const { name } = req.body; if (!name || !name.trim()) return res.json({ code: 400, message: '名称不能为空' }); const [r] = await pool.query('UPDATE ocr_tactic_dict SET name = ? WHERE id = ?', [name.trim(), req.params.id]); if (!r.affectedRows) return res.json({ code: 404, message: '不存在' }); res.json({ code: 200, message: '更新成功' }); }
  catch (err) { if (err.code === 'ER_DUP_ENTRY') return res.json({ code: 409, message: '名称已存在' }); res.json({ code: 500, message: err.message }); }
});
app.delete('/api/ocr-dict/tactics/:id', requireSuperAdmin, async (req, res) => {
  try { await pool.query('DELETE FROM ocr_tactic_dict WHERE id = ?', [req.params.id]); res.json({ code: 200, message: '删除成功' }); } catch (err) { res.json({ code: 500, message: err.message }); }
});
app.post('/api/ocr-dict/tactics/batch', requireSuperAdmin, async (req, res) => {
  try { const { names } = req.body; if (!Array.isArray(names) || !names.length) return res.json({ code: 400, message: '参数错误' }); let added = 0, skipped = 0; for (const n of names) { const name = (n || '').trim(); if (!name) continue; const [r] = await pool.query('INSERT IGNORE INTO ocr_tactic_dict (name) VALUES (?)', [name]); r.affectedRows ? added++ : skipped++; } res.json({ code: 200, message: `导入完成：新增 ${added} 条，跳过重复 ${skipped} 条` }); }
  catch (err) { res.json({ code: 500, message: err.message }); }
});

app.get('/api/ocr-dict/tactics/pending', requireSuperAdmin, async (req, res) => {
  try { const { status = 'pending' } = req.query; const [rows] = await pool.query(`SELECT p.*, br.id as battle_id, br.attacker_name, br.enemy_name FROM ocr_tactic_pending p LEFT JOIN battle_records br ON br.id = p.source_battle_id WHERE p.status = ? ORDER BY p.detect_count DESC, p.created_at DESC`, [status]); res.json({ code: 200, data: rows }); }
  catch (err) { res.json({ code: 500, message: err.message }); }
});
app.post('/api/ocr-dict/tactics/pending/:id/approve', requireSuperAdmin, async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT * FROM ocr_tactic_pending WHERE id = ?', [req.params.id]);
    if (!rows.length) return res.json({ code: 404, message: '不存在' });
    const { raw_text, source_battle_id } = rows[0];
    await pool.query('INSERT IGNORE INTO ocr_tactic_dict (name) VALUES (?)', [raw_text]);
    const [uRow] = await pool.query('SELECT id FROM users WHERE phone = ? LIMIT 1', [req.authPhone]);
    await pool.query('UPDATE ocr_tactic_pending SET status = "approved", reviewed_by = ?, reviewed_at = NOW() WHERE id = ?', [uRow[0]?.id, req.params.id]);
    if (source_battle_id) {
      const tacFields = ['left_tactic_1_1','left_tactic_1_2','left_tactic_1_3','left_tactic_2_1','left_tactic_2_2','left_tactic_2_3','left_tactic_3_1','left_tactic_3_2','left_tactic_3_3','right_tactic_1_1','right_tactic_1_2','right_tactic_1_3','right_tactic_2_1','right_tactic_2_2','right_tactic_2_3','right_tactic_3_1','right_tactic_3_2','right_tactic_3_3'];
      const updates = tacFields.map(f => `${f} = IF(${f} = ?, ?, ${f})`).join(', ');
      const params = []; tacFields.forEach(() => { params.push('待确认:' + raw_text, raw_text); }); params.push(source_battle_id);
      await pool.query(`UPDATE battle_records SET ${updates} WHERE id = ?`, params);
    }
    res.json({ code: 200, message: `"${raw_text}" 已确认入库` });
  } catch (err) { res.json({ code: 500, message: err.message }); }
});
app.post('/api/ocr-dict/tactics/pending/:id/reject', requireSuperAdmin, async (req, res) => {
  try { const [uRow] = await pool.query('SELECT id FROM users WHERE phone = ? LIMIT 1', [req.authPhone]); await pool.query('UPDATE ocr_tactic_pending SET status = "rejected", reviewed_by = ?, reviewed_at = NOW() WHERE id = ?', [uRow[0]?.id, req.params.id]); res.json({ code: 200, message: '已驳回' }); }
  catch (err) { res.json({ code: 500, message: err.message }); }
});
app.get('/api/ocr-dict/all', requireActiveUser, async (req, res) => {
  try { const [[heroes], [tactics]] = await Promise.all([pool.query('SELECT name FROM ocr_hero_dict ORDER BY id'), pool.query('SELECT name FROM ocr_tactic_dict ORDER BY id')]); res.json({ code: 200, data: { heroNames: heroes.map(r => r.name), tacticNames: tactics.map(r => r.name) } }); }
  catch (err) { res.json({ code: 500, message: err.message }); }
});

// ========== OCR 测试 ==========
async function _getCategories(projectId, provided) {
  if (provided && typeof provided === 'object' && Object.keys(provided).length > 0) return provided;
  let [rows] = await pool.query('SELECT categories_json FROM label_configs WHERE project_id = ? LIMIT 1', [projectId || 0]);
  if (!rows.length) [rows] = await pool.query('SELECT categories_json FROM label_configs WHERE project_id = 0 LIMIT 1');
  return rows.length ? JSON.parse(rows[0].categories_json || '{}') : {};
}

app.post('/api/ocr-preview/cache-image', requireSuperAdmin, async (req, res) => {
  try { const { imageBase64, token } = req.body; if (!imageBase64) return res.json({ code: 400, message: '缺少 imageBase64' }); const pyResp = await fetch(PADDLE_CACHE_IMG_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ image: imageBase64, token: token || '' }) }); res.json({ code: 200, token: (await pyResp.json()).token }); }
  catch (err) { res.json({ code: 500, message: err.message }); }
});

app.post('/api/ocr-preview/test', requireSuperAdmin, async (req, res) => {
  try {
    const { projectId, imageBase64, imageToken, categories, playerNames, allianceNames } = req.body;
    if (!imageBase64 && !imageToken) return res.json({ code: 400, message: '缺少 imageBase64 或 imageToken' });
    const cats = await _getCategories(projectId, categories);
    const catKeys = Object.keys(cats);
    const [heroRows, tacticRows] = await Promise.all([
      catKeys.includes('heroNames') ? pool.query('SELECT name FROM ocr_hero_dict ORDER BY id').then(([r]) => r) : Promise.resolve([]),
      catKeys.includes('tactics') ? pool.query('SELECT name FROM ocr_tactic_dict ORDER BY id').then(([r]) => r) : Promise.resolve([])
    ]);
    const pyResp = await fetch(PADDLE_TEST_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ image: imageToken ? '' : imageBase64, imageToken: imageToken || '', categories: cats, heroNames: heroRows.map(r => r.name), tacticNames: tacticRows.map(r => r.name), playerNames: Array.isArray(playerNames) ? playerNames : [], allianceNames: Array.isArray(allianceNames) ? allianceNames : [] }), signal: AbortSignal.timeout(180000) });
    res.json({ code: 200, data: await pyResp.json() });
  } catch (err) { res.json({ code: 500, message: err.message }); }
});

app.post('/api/ocr-preview/test-stars', requireSuperAdmin, async (req, res) => {
  try {
    const { projectId, imageBase64, imageToken, categories, mode = 'both' } = req.body;
    if (!imageBase64 && !imageToken) return res.json({ code: 400, message: '缺少 imageBase64 或 imageToken' });
    const cats = await _getCategories(projectId, categories);
    const pyResp = await fetch(PADDLE_STARS_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ image: imageToken ? '' : imageBase64, imageToken: imageToken || '', categories: cats, mode }), signal: AbortSignal.timeout(180000) });
    res.json({ code: 200, data: await pyResp.json() });
  } catch (err) { res.json({ code: 500, message: err.message }); }
});

// ========== 旧版 local-helper 路由已移除（v2.0 重构）==========

const FOLDER_WATCH_CONFIG_PATH = path.join(__dirname, 'folder_watch_config.json');

function loadFolderWatchConfig() {
  try {
    if (fs.existsSync(FOLDER_WATCH_CONFIG_PATH))
      return JSON.parse(fs.readFileSync(FOLDER_WATCH_CONFIG_PATH, 'utf8'));
  } catch (e) {}
  return { enabled: false, folderPath: '', projectId: null, ownerPhone: '', intervalSec: 10 };
}

function saveFolderWatchConfig(cfg) {
  fs.writeFileSync(FOLDER_WATCH_CONFIG_PATH, JSON.stringify(cfg, null, 2), 'utf8');
}

const folderWatchState = { running: false, timer: null, lastScanAt: null, processedCount: 0, errorCount: 0, pendingFiles: 0, lastError: null };

async function _getLabelConfigForProject(projectId) {
  const pid = projectId || 0;
  const [rows] = await pool.query('SELECT categories_json FROM label_configs WHERE project_id = ? LIMIT 1', [pid]);
  if (rows.length && rows[0].categories_json) {
    try { return JSON.parse(rows[0].categories_json); } catch (e) {}
  }
  if (pid !== 0) {
    const [g] = await pool.query('SELECT categories_json FROM label_configs WHERE project_id = 0 LIMIT 1');
    if (g.length && g[0].categories_json) { try { return JSON.parse(g[0].categories_json); } catch (e) {} }
  }
  return null;
}

async function _processOcrImageFile(filePath, imageName, projectId, userId) {
  const imageBuffer = await fs.promises.readFile(filePath);
  const cleanImage = imageBuffer.toString('base64');
  const { heroNames, tacticNames, playerNames, allianceNames } = await getCachedDicts(projectId);
  const labelCfg = await _getLabelConfigForProject(projectId);

  const ocrBody = { image: cleanImage, heroNames, tacticNames, playerNames, allianceNames };
  if (labelCfg) ocrBody.labelConfig = labelCfg;
  const { record, paddleRaw, paddleProcessError } = await _callPaddleOcr(ocrBody, imageName);
  if (paddleProcessError) throw new Error(`图片处理失败: ${paddleProcessError}`);
  if (!record) throw new Error('OCR 服务不可用');

  const now = new Date();
  record.battleDate = now.toISOString().split('T')[0];
  const fv = v => (v && v !== '') ? v : null;
  const insertParams = [
    projectId || null, record.leftPlayer || '', record.rightPlayer || '',
    record.result || '', record.battleDate, '',
    fv(record.leftLoss), fv(record.rightLoss), fv(record.leftTotal), fv(record.rightTotal),
    record.leftLossRate ?? null, record.rightLossRate ?? null,
    fv(record.leftFormation), fv(record.rightFormation), fv(record.leftAlliance), fv(record.rightAlliance),
    fv(record.leftGeneral1), fv(record.leftGeneral2), fv(record.leftGeneral3),
    fv(record.rightGeneral1), fv(record.rightGeneral2), fv(record.rightGeneral3),
    fv(record.leftTactic1_1), fv(record.leftTactic1_2), fv(record.leftTactic1_3),
    fv(record.leftTactic2_1), fv(record.leftTactic2_2), fv(record.leftTactic2_3),
    fv(record.leftTactic3_1), fv(record.leftTactic3_2), fv(record.leftTactic3_3),
    fv(record.rightTactic1_1), fv(record.rightTactic1_2), fv(record.rightTactic1_3),
    fv(record.rightTactic2_1), fv(record.rightTactic2_2), fv(record.rightTactic2_3),
    fv(record.rightTactic3_1), fv(record.rightTactic3_2), fv(record.rightTactic3_3),
    record.leftGeneral1Stars ?? 0, record.leftGeneral2Stars ?? 0, record.leftGeneral3Stars ?? 0,
    record.rightGeneral1Stars ?? 0, record.rightGeneral2Stars ?? 0, record.rightGeneral3Stars ?? 0,
    userId, 1, now, now
  ];
  const [ins] = await pool.query(
    'INSERT INTO battle_records (project_id, attacker_name, enemy_name, result, battle_date, description, left_loss, right_loss, left_total, right_total, left_loss_rate, right_loss_rate, left_formation, right_formation, left_alliance, right_alliance, left_general_1, left_general_2, left_general_3, right_general_1, right_general_2, right_general_3, left_tactic_1_1, left_tactic_1_2, left_tactic_1_3, left_tactic_2_1, left_tactic_2_2, left_tactic_2_3, left_tactic_3_1, left_tactic_3_2, left_tactic_3_3, right_tactic_1_1, right_tactic_1_2, right_tactic_1_3, right_tactic_2_1, right_tactic_2_2, right_tactic_2_3, right_tactic_3_1, right_tactic_3_2, right_tactic_3_3, left_general_1_stars, left_general_2_stars, left_general_3_stars, right_general_1_stars, right_general_2_stars, right_general_3_stars, created_by, status, created_at, updated_at) VALUES (' + insertParams.map(() => '?').join(',') + ')',
    insertParams
  );
  const newId = ins.insertId;
  await pool.query('INSERT INTO battle_gallery (project_id, battle_id, image_data, original_name, file_size, uploaded_by, created_at, updated_at) VALUES (?,?,?,?,?,?,NOW(),NOW())', [projectId || null, newId, imageBuffer, imageName, imageBuffer.length, userId]);
  await pool.query('UPDATE users SET credit_balance = credit_balance - 1 WHERE id = ?', [userId]);
  await pool.query('INSERT INTO credit_logs (user_id, change_amount, balance_after, type, description, operator_id, created_at) SELECT ?, -1, credit_balance, ?, ?, ?, NOW() FROM users WHERE id = ?', [userId, 'consume', `服务端OCR: ${imageName}`, userId, userId]);
  if (paddleRaw && paddleRaw.ok) {
    for (const t of [...(paddleRaw.leftTactics || []), ...(paddleRaw.rightTactics || [])]) {
      if (typeof t === 'string' && t.startsWith('待确认:')) { const raw = t.slice(4).trim(); if (raw) await pool.query(`INSERT INTO ocr_tactic_pending (raw_text, detect_count, source_battle_id, status, created_at) VALUES (?, 1, ?, 'pending', NOW()) ON DUPLICATE KEY UPDATE detect_count = detect_count + 1`, [raw, newId]); }
    }
  }
  return newId;
}

async function _scanFolderOnce() {
  const cfg = loadFolderWatchConfig();
  if (!cfg.folderPath || !cfg.ownerPhone) return;
  const [uRows] = await pool.query('SELECT id, credit_balance FROM users WHERE phone = ? AND status = 1 LIMIT 1', [cfg.ownerPhone]);
  if (!uRows.length) { folderWatchState.lastError = '配置用户不存在'; return; }
  const { id: userId, credit_balance } = uRows[0];
  if ((credit_balance || 0) <= 0) { folderWatchState.lastError = '积分不足，自动停止'; stopFolderWatch(); return; }

  let files;
  try { files = (await fs.promises.readdir(cfg.folderPath)).filter(f => /\.(png|jpg|jpeg)$/i.test(f)); }
  catch (e) { folderWatchState.lastError = '读取文件夹失败: ' + e.message; return; }

  const pending = [];
  for (const name of files) {
    // 只有已成功 OCR 的才跳过（有有效武将数据的 battle_records 才算成功）
    // 未成功的、没处理过的都重新处理
    const [ex] = await pool.query(
      `SELECT bg.id FROM battle_gallery bg
       INNER JOIN battle_records br ON bg.battle_id = br.id
       WHERE bg.original_name = ? AND bg.status = 1
       AND br.left_general_1 IS NOT NULL AND br.left_general_1 != ''
       LIMIT 1`,
      [name]
    );
    if (!ex.length) pending.push(name);
  }
  const skipped = files.length - pending.length;
  folderWatchState.lastScanAt = new Date().toISOString();
  folderWatchState.pendingFiles = pending.length;
  if (skipped > 0 || pending.length > 0) {
    console.log(`[FolderWatch] 扫描完成: ${files.length} 文件, 跳过 ${skipped} 已处理, ${pending.length} 待处理`);
  }

  for (const name of pending) {
    if (!folderWatchState.running) break;
    try {
      await _processOcrImageFile(path.join(cfg.folderPath, name), name, cfg.projectId, userId);
      folderWatchState.processedCount++;
      folderWatchState.pendingFiles = Math.max(0, folderWatchState.pendingFiles - 1);
      folderWatchState.lastError = null;
      console.log(`[FolderWatch] ✅ ${name}`);
    } catch (e) {
      folderWatchState.errorCount++;
      folderWatchState.lastError = `${name}: ${e.message}`;
      console.error(`[FolderWatch] ❌ ${name}:`, e.message);
    }
  }
}

function startFolderWatch() {
  if (folderWatchState.running) return;
  const cfg = loadFolderWatchConfig();
  if (!cfg.folderPath) return;
  folderWatchState.running = true;
  const iv = Math.max(5, cfg.intervalSec || 10) * 1000;
  // 使用 setTimeout 链代替 setInterval，确保上一次扫描完成后才开始下一次
  // 避免长时间扫描导致的重叠执行和资源竞争
  const tick = async () => {
    if (!folderWatchState.running) return;
    const startTime = Date.now();
    try { await _scanFolderOnce(); } catch (e) { console.error('[FolderWatch]', e.message); }
    if (!folderWatchState.running) return;
    // 计算下次扫描间隔：保证两次扫描开始时间间隔至少为 iv
    const elapsed = Date.now() - startTime;
    const delay = Math.max(1000, iv - elapsed);
    folderWatchState.timer = setTimeout(tick, delay);
  };
  folderWatchState.timer = setTimeout(tick, 0);
  console.log(`[FolderWatch] 启动 路径=${cfg.folderPath} 间隔=${iv / 1000}s`);
}

function stopFolderWatch() {
  folderWatchState.running = false;
  if (folderWatchState.timer) { clearTimeout(folderWatchState.timer); folderWatchState.timer = null; }
  console.log('[FolderWatch] 已停止');
}

app.get('/api/folder-watch/status', requireSuperAdmin, (req, res) => {
  const cfg = loadFolderWatchConfig();
  res.json({ code: 200, data: { config: cfg, state: { running: folderWatchState.running, lastScanAt: folderWatchState.lastScanAt, processedCount: folderWatchState.processedCount, errorCount: folderWatchState.errorCount, pendingFiles: folderWatchState.pendingFiles, lastError: folderWatchState.lastError } } });
});

app.post('/api/folder-watch/config', requireSuperAdmin, (req, res) => {
  const cfg = loadFolderWatchConfig();
  const { folderPath, projectId, ownerPhone, intervalSec } = req.body;
  if (folderPath !== undefined) cfg.folderPath = folderPath;
  if (projectId !== undefined) cfg.projectId = projectId;
  if (ownerPhone !== undefined) cfg.ownerPhone = ownerPhone;
  if (intervalSec !== undefined) cfg.intervalSec = Math.max(5, parseInt(intervalSec) || 10);
  saveFolderWatchConfig(cfg);
  if (folderWatchState.running) { stopFolderWatch(); startFolderWatch(); }
  res.json({ code: 200, data: cfg });
});

app.post('/api/folder-watch/start', requireSuperAdmin, (req, res) => {
  const cfg = loadFolderWatchConfig();
  if (!cfg.folderPath) return res.json({ code: 400, message: '请先配置文件夹路径' });
  if (!cfg.ownerPhone) return res.json({ code: 400, message: '请先配置处理账号' });
  cfg.enabled = true; saveFolderWatchConfig(cfg);
  startFolderWatch();
  res.json({ code: 200, message: '已启动' });
});

app.post('/api/folder-watch/stop', requireSuperAdmin, (req, res) => {
  const cfg = loadFolderWatchConfig();
  cfg.enabled = false; saveFolderWatchConfig(cfg);
  stopFolderWatch();
  res.json({ code: 200, message: '已停止' });
});

// 调用 Windows 原生文件夹选择对话框，返回用户选择的路径
app.post('/api/folder-watch/pick-folder', requireSuperAdmin, (req, res) => {
  const fs = require('fs');
  const path = require('path');
  const { execSync } = require('child_process');
  const tmpFile = path.join(os.tmpdir(), 'nslg_pick_folder.ps1');

  const script = `
Add-Type -AssemblyName System.Windows.Forms
[System.Windows.Forms.Application]::EnableVisualStyles()
$dialog = New-Object System.Windows.Forms.FolderBrowserDialog
$dialog.Description = "选择截图文件夹"
$dialog.ShowNewFolderButton = $false
$dialog.RootFolder = [Environment+SpecialFolder]::Desktop
if ($dialog.ShowDialog() -eq 'OK') {
    Write-Output $dialog.SelectedPath
}
`.trim();

  try {
    fs.writeFileSync(tmpFile, script, 'utf-8');
    const result = execSync(`powershell -STA -NoProfile -NonInteractive -File "${tmpFile}"`, {
      encoding: 'utf-8',
      timeout: 120000,
      windowsHide: true
    }).trim();
    try { fs.unlinkSync(tmpFile); } catch (_) {}

    if (result) {
      res.json({ code: 200, data: { path: result } });
    } else {
      res.json({ code: 400, message: '未选择文件夹或操作取消' });
    }
  } catch (e) {
    try { fs.unlinkSync(tmpFile); } catch (_) {}
    console.error('[FolderWatch] 文件夹选择器失败:', e.message);
    res.json({ code: 500, message: '无法打开文件夹选择对话框: ' + e.message });
  }
});

// ========== 本地助手下载接口 ==========
app.get('/download/local-helper', (req, res) => {
  const filePath = path.join(__dirname, 'downloads', 'zhenwu-local-helper-setup.exe');

  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ code: 404, message: '安装包不存在' });
  }

  // 设置响应头，强制下载
  res.setHeader('Content-Type', 'application/octet-stream');
  res.setHeader('Content-Disposition', 'attachment; filename="zhenwu-local-helper-setup-202607112103.exe"');

  // 流式传输文件
  const fileStream = fs.createReadStream(filePath);
  fileStream.pipe(res);

  fileStream.on('error', (err) => {
    console.error('[Download] 文件传输失败:', err);
    if (!res.headersSent) {
      res.status(500).json({ code: 500, message: '下载失败' });
    }
  });
});

app.listen(PORT, async () => {
  await initDB();
  console.log(`🚀 服务运行在 http://localhost:${PORT}`);
  // 若上次已开启监听，自动恢复
  const _fwCfg = loadFolderWatchConfig();
  if (_fwCfg.enabled && _fwCfg.folderPath) { startFolderWatch(); }
});
// ========== 新版战报自动监听 API (v2.0) ==========
// 这是新的简化版 API，替代旧的 /api/local-helper 路由

// 辅助函数：生成随机 Token
function randomToken(prefix, size = 18) {
  return `${prefix}${crypto.randomBytes(size).toString('hex')}`;
}

// 1. 获取当前项目任务
app.get('/api/ocr-watch/tasks', requireOcrUploadActor, async (req, res) => {
  try {
    const rawProjectId = req.query?.projectId;
    const hasProjectFilter = rawProjectId !== undefined && rawProjectId !== null && String(rawProjectId).trim() !== '';
    const projectId = hasProjectFilter ? Number(rawProjectId) : null;

    if (hasProjectFilter && (!Number.isInteger(projectId) || projectId <= 0)) {
      return res.json({ code: 400, message: '项目参数无效' });
    }

    let sql = 'SELECT id, user_id, project_id, folder_path, status, pending_count, processed_count, processed_files_json, pending_files_json, current_file, last_error, last_heartbeat, created_at, updated_at, (SELECT COUNT(*) FROM battle_records br WHERE br.project_id = ocr_watch_tasks.project_id AND br.status = 1) AS actual_processed FROM ocr_watch_tasks WHERE user_id = ?';
    const params = [req.authUserId];

    if (hasProjectFilter) {
      sql += ' AND project_id = ?';
      params.push(projectId);
    }

    sql += ' ORDER BY updated_at DESC, id DESC';

    const [rows] = await pool.query(sql, params);
    const data = rows.map(r => ({
      id: r.id,
      projectId: r.project_id,
      folderPath: r.folder_path || '',
      status: r.status,
      pendingCount: r.pending_count || 0,
      processedCount: Number(r.actual_processed) || 0,
      processedFilesJson: safeJsonParse(r.processed_files_json, []),
      pendingFiles: safeJsonParse(r.pending_files_json, []),
      currentFile: r.current_file || '',
      lastError: r.last_error || '',
      lastHeartbeat: r.last_heartbeat,
      createdAt: r.created_at,
      updatedAt: r.updated_at
    }));

    // 如果有项目过滤，返回单个对象；否则返回数组
    if (hasProjectFilter) {
      res.json({ code: 200, data: data[0] || null });
    } else {
      res.json({ code: 200, data });
    }
  } catch (err) {
    console.error('[OCR-Watch] 获取任务失败:', err);
    res.json({ code: 500, message: err.message });
  }
});

// 2. 创建/更新任务
app.post('/api/ocr-watch/tasks', requireActiveUser, async (req, res) => {
  try {
    const { projectId, folderPath } = req.body || {};
    const normalizedProjectId = Number(projectId);

    if (!Number.isInteger(normalizedProjectId) || normalizedProjectId <= 0) {
      return res.json({ code: 400, message: '项目参数无效' });
    }

    const normalizedFolder = String(folderPath || '').trim().slice(0, 512);

    // 检查是否已存在
    const [existing] = await pool.query(
      'SELECT id, status FROM ocr_watch_tasks WHERE user_id = ? AND project_id = ? LIMIT 1',
      [req.authUserId, normalizedProjectId]
    );

    if (existing.length) {
      // 更新
      const updateFields = ['updated_at = NOW()'];
      const updateParams = [];

      if (normalizedFolder !== undefined) {
        updateFields.push('folder_path = ?');
        updateParams.push(normalizedFolder);
        // 切换目录时，清空已处理文件列表
        updateFields.push('processed_files_json = NULL');
        updateFields.push('processed_count = 0');
        updateFields.push('pending_count = 0');
      }

      updateParams.push(existing[0].id);
      await pool.query(`UPDATE ocr_watch_tasks SET ${updateFields.join(', ')} WHERE id = ?`, updateParams);
      res.json({ code: 200, data: { id: existing[0].id } });
    } else {
      // 创建
      const taskName = `监听任务-${normalizedProjectId}`;
      const [result] = await pool.query(
        'INSERT INTO ocr_watch_tasks (user_id, project_id, task_name, folder_path, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, NOW(), NOW())',
        [req.authUserId, normalizedProjectId, taskName, normalizedFolder, 'idle']
      );
      res.json({ code: 200, data: { id: result.insertId } });
    }
  } catch (err) {
    console.error('[OCR-Watch] 创建/更新任务失败:', err);
    res.json({ code: 500, message: err.message });
  }
});

// 3. 控制任务
app.post('/api/ocr-watch/tasks/:id/control', requireActiveUser, async (req, res) => {
  try {
    const taskId = Number(req.params.id);
    const { action } = req.body || {};
    const actionMap = { start: 'running', resume: 'running', pause: 'paused', stop: 'idle' };

    if (!Number.isInteger(taskId) || taskId <= 0) {
      return res.json({ code: 400, message: '任务参数无效' });
    }

    if (!action || !actionMap[action]) {
      return res.json({ code: 400, message: '不支持的操作' });
    }

    // 检查任务是否存在
    const [task] = await pool.query(
      'SELECT id, folder_path, status FROM ocr_watch_tasks WHERE id = ? AND user_id = ? LIMIT 1',
      [taskId, req.authUserId]
    );

    if (!task.length) {
      return res.json({ code: 404, message: '任务不存在' });
    }

    // 检查目录是否已设置
    if (!task[0].folder_path && actionMap[action] === 'running') {
      return res.json({ code: 400, message: '请先设置监听目录' });
    }

    // 状态转换逻辑
    const nextStatus = actionMap[action];
    const updateFields = ['status = ?', 'updated_at = NOW()'];
    const updateParams = [nextStatus];

    // 开始时清空错误信息、心跳和待处理数量
    if (nextStatus === 'running') {
      updateFields.push('last_error = ?');
      updateParams.push('');
      updateFields.push('last_heartbeat = NULL');
    }

    // 停止时清空待处理数量
    if (nextStatus === 'idle') {
      updateFields.push('pending_count = 0');
    }

    updateParams.push(taskId);
    await pool.query(`UPDATE ocr_watch_tasks SET ${updateFields.join(', ')} WHERE id = ?`, updateParams);

    res.json({ code: 200, message: '操作成功' });
  } catch (err) {
    console.error('[OCR-Watch] 控制任务失败:', err);
    res.json({ code: 500, message: err.message });
  }
});

// 4. 助手进度上报
app.post('/api/ocr-watch/tasks/:id/progress', async (req, res) => {
  try {
    const taskId = Number(req.params.id);
    const { pendingCount, processedCount, processedFilesJson, pendingFiles, currentFile, lastError, lastHeartbeat } = req.body || {};

    if (!Number.isInteger(taskId) || taskId <= 0) {
      return res.json({ code: 400, message: '任务参数无效' });
    }

    const updateFields = ['updated_at = NOW()'];
    const updateParams = [];

    // pendingCount 不从客户端接收，由后端自动计算
    // if (pendingCount !== undefined) {
    //   updateFields.push('pending_count = ?');
    //   updateParams.push(Number(pendingCount));
    // }

    if (processedCount !== undefined) {
      updateFields.push('processed_count = ?');
      updateParams.push(Number(processedCount));
    }

    if (processedFilesJson && Array.isArray(processedFilesJson)) {
      updateFields.push('processed_files_json = ?');
      updateParams.push(JSON.stringify(processedFilesJson));
    }

    if (pendingFiles !== undefined) {
      updateFields.push('pending_files_json = ?');
      updateParams.push(Array.isArray(pendingFiles) ? JSON.stringify(pendingFiles) : null);
    }

    // pending_count 从 ocr_pending_tasks 表实时查询
    updateFields.push('pending_count = (SELECT COUNT(*) FROM ocr_pending_tasks WHERE helper_task_id = ? AND status = ?)');
    updateParams.push(taskId);
    updateParams.push('pending');

    if (currentFile !== undefined) {
      updateFields.push('current_file = ?');
      updateParams.push(String(currentFile || '').slice(0, 512));
    }

    if (lastError !== undefined) {
      updateFields.push('last_error = ?');
      updateParams.push(String(lastError).slice(0, 500));
    }

    if (lastHeartbeat !== undefined) {
      updateFields.push('last_heartbeat = ?');
      // ISO 8601 UTC → MySQL DATETIME 本地时间（UTC+8）
      // "2026-07-07T13:03:47.768Z" → Date对象 → "2026-07-07 21:03:47"
      try {
        const utcDate = new Date(lastHeartbeat);
        const pad = num => String(num).padStart(2, '0');
        const localDatetime = `${utcDate.getFullYear()}-${pad(utcDate.getMonth() + 1)}-${pad(utcDate.getDate())} ${pad(utcDate.getHours())}:${pad(utcDate.getMinutes())}:${pad(utcDate.getSeconds())}`;
        updateParams.push(localDatetime);
      } catch (e) {
        // 降级：直接去除格式符号
        updateParams.push(String(lastHeartbeat).replace('T', ' ').replace(/\.\d+Z$/, '').replace('Z', ''));
      }
    }

    updateParams.push(taskId);
    await pool.query(`UPDATE ocr_watch_tasks SET ${updateFields.join(', ')} WHERE id = ?`, updateParams);

    res.json({ code: 200, message: '进度已更新' });
  } catch (err) {
    console.error('[OCR-Watch] 更新进度失败:', err);
    res.json({ code: 500, message: err.message });
  }
});

// 5. 助手配置获取（用于首次安装）
app.get('/api/ocr-watch/helper-config', requireActiveUser, async (req, res) => {
  try {
    const os = require('os');
    const deviceId = req.query.deviceId || 'device-' + Date.now();
    const deviceName = req.query.deviceName || os.hostname() || 'Unknown';

    // 检查是否已有该设备的 token
    let [existing] = await pool.query(
      'SELECT access_token FROM local_helper_clients WHERE user_id = ? AND device_id = ? LIMIT 1',
      [req.authUserId, deviceId]
    );

    let helperToken;
    if (existing.length > 0 && existing[0].access_token) {
      // 复用已有 token
      helperToken = existing[0].access_token;
    } else {
      // 生成新的永久 token
      helperToken = randomToken('helper-auth-');

      // 存储到数据库（token_expires_at 为 NULL 表示永久有效）
      if (existing.length > 0) {
        await pool.query(
          'UPDATE local_helper_clients SET access_token = ?, token_expires_at = NULL, status = ?, updated_at = NOW() WHERE user_id = ? AND device_id = ?',
          [helperToken, 'online', req.authUserId, deviceId]
        );
      } else {
        await pool.query(
          'INSERT INTO local_helper_clients (user_id, device_id, device_name, access_token, token_expires_at, status, helper_version) VALUES (?, ?, ?, ?, NULL, ?, ?)',
          [req.authUserId, deviceId, deviceName, helperToken, 'online', '2.0']
        );
      }
    }

    // 返回配置信息
    res.json({
      code: 200,
      data: {
        helperToken,
        apiBase: req.protocol + '://' + req.get('host') + '/api',
        userId: req.authUserId,
        deviceId
      }
    });
  } catch (err) {
    console.error('[OCR-Watch] 获取助手配置失败:', err);
    res.json({ code: 500, message: err.message });
  }
});

// 打开原生 Windows 文件夹选择对话框
// 使用编译好的 C# WinForms exe（控制台模式，天然支持 STA + 消息泵）
app.get('/api/ocr-watch/select-folder', requireActiveUser, async (req, res) => {
  const fs = require('fs');
  const path = require('path');
  const os = require('os');
  const cp = require('child_process');

  const exePath = path.join(__dirname, 'fpicker.exe');
  const resultPath = path.join(os.tmpdir(), 'nslg_folder_result.txt');

  if (!fs.existsSync(exePath)) {
    return res.json({ code: 500, data: { path: null }, message: 'exe not found' });
  }

  try {
    try { fs.unlinkSync(resultPath); } catch (e) {}

    // 获取用户上次选择的路径（从数据库）
    let initialPath = '';
    try {
      const [rows] = await pool.query(
        'SELECT folder_path FROM ocr_watch_tasks WHERE user_id = ? AND project_id = ? ORDER BY updated_at DESC LIMIT 1',
        [req.authUserId, req.query.projectId || 0]
      );
      if (rows.length > 0 && rows[0].folder_path) {
        initialPath = rows[0].folder_path;
      }
    } catch (e) {
      console.log('[select-folder] 无法获取历史路径:', e.message);
    }

    // 调用 fpicker.exe，传入初始路径
    let cmdArgs = '"' + exePath + '" "' + resultPath + '"';
    if (initialPath) {
      cmdArgs += ' "' + initialPath.replace(/"/g, '') + '"';
    }
    console.log('[select-folder] initialPath:', initialPath);
    console.log('[select-folder] cmdArgs:', cmdArgs);
    cp.execSync('cmd /c start "FolderPicker" /min /wait ' + cmdArgs, { timeout: 120000 });

    let folderPath = null;
    try {
      const raw = fs.readFileSync(resultPath, 'utf8').trim();
      if (raw && raw !== 'CANCELLED' && !raw.startsWith('ERROR:')) {
        folderPath = raw;
      }
      fs.unlinkSync(resultPath);
    } catch (e) {}

    res.json({ code: 200, data: { path: folderPath || null } });
  } catch (err) {
    try { fs.unlinkSync(resultPath); } catch (e) {}
    res.json({ code: 200, data: { path: null } });
  }
});