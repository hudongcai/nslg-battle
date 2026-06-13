const express = require('express');
const mysql = require('mysql2/promise');
const cors = require('cors');

const app = express();
const PORT = 3000;

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// ========== Token 工具函数 ==========
// token 格式：mock-token-{phone}-{timestamp}
function extractPhoneFromToken(token) {
  if (!token) return null;
  const t = token.replace(/^Bearer\s+/i, '').trim();
  const m = t.match(/^mock-token-(1\d{10})-\d+$/);
  return m ? m[1] : null;
}

// 敏感操作中间件：验证 token 对应用户仍存在且未被禁用
// 注意：必须返回 HTTP 401 状态码，前端 cloudRequest 才能正确捕获并触发强制退出
async function requireActiveUser(req, res, next) {
  const rawToken = req.headers['authorization'] || '';
  // 没有携带任何 token，直接拒绝（敏感接口必须登录）
  if (!rawToken) {
    return res.status(401).json({ code: 401, message: '未登录，请先登录' });
  }
  const phone = extractPhoneFromToken(rawToken);
  if (!phone) {
    // token 存在但格式无法解析（旧格式 token），要求重新登录
    return res.status(401).json({ code: 401, message: '登录状态已过期，请重新登录' });
  }
  try {
    const [rows] = await pool.query('SELECT id, status FROM users WHERE phone = ? LIMIT 1', [phone]);
    if (rows.length === 0) {
      return res.status(401).json({ code: 401, message: '账号不存在，请重新登录' });
    }
    if (rows[0].status === 0) {
      return res.status(401).json({ code: 401, message: '账号已被禁用，请联系管理员' });
    }
    req.authPhone = phone;
    req.authUserId = rows[0].id;
    next();
  } catch (err) {
    next(); // 数据库异常不阻断请求
  }
}

// ========== 全局用户存活中间件 ==========
// 对所有 /api/* 请求：携带新格式 token 时验证用户仍存在且未被禁用
// 不影响无 token 的公开请求；POST 敏感接口仍保留 requireActiveUser 做"无 token 拒绝"兜底
async function globalUserCheck(req, res, next) {
  // 跳过登录/注册接口本身，避免循环
  if (req.path === '/auth/login' || req.path === '/auth/register') return next();

  const rawToken = req.headers['authorization'] || '';
  if (!rawToken) return next(); // 无 token → 公开请求，由各接口自行处理

  const phone = extractPhoneFromToken(rawToken);
  if (!phone) return next(); // 旧格式 token → 由 requireActiveUser 各自处理

  try {
    const [rows] = await pool.query('SELECT id, status FROM users WHERE phone = ? LIMIT 1', [phone]);
    if (rows.length === 0) {
      return res.status(401).json({ code: 401, message: '账号不存在，请重新登录' });
    }
    if (rows[0].status === 0) {
      return res.status(401).json({ code: 401, message: '账号已被禁用，请联系管理员' });
    }
    req.authPhone = phone;
    req.authUserId = rows[0].id;
    next();
  } catch (err) {
    next(); // DB 异常不阻断请求
  }
}

const dbConfig = {
  host: 'localhost',
  port: 3306,
  user: 'nslg-battle-server',
  password: 'hu6956521',
  database: 'nslg_battle',
  charset: 'utf8mb4'
};

let pool;

async function initDB() {
  try {
    pool = mysql.createPool(dbConfig);
    const [rows] = await pool.query('SELECT 1');
    console.log('✅ MySQL 连接成功');
  } catch (err) {
    console.error('❌ MySQL 连接失败:', err.message);
    process.exit(1);
  }
}

// 全局用户存活检查：对所有 /api 路由生效
app.use('/api', globalUserCheck);

app.post('/api/auth/login', async (req, res) => {
  const { phone, password } = req.body;
  if (!phone || !password) {
    return res.json({ code: 400, message: '缺少参数' });
  }
  
  try {
    const [rows] = await pool.query('SELECT * FROM users WHERE phone = ?', [phone]);
    if (rows.length === 0) {
      return res.json({ code: 401, message: '账号或密码错误' });
    }
    
    const user = rows[0];
    if (user.password === password) {
      const points = user.credit_balance != null ? user.credit_balance : 18;

      const loginIp = req.headers['x-forwarded-for']?.split(',')[0].trim() || req.ip || req.connection?.remoteAddress || '';
      await pool.query('UPDATE users SET last_login_at = NOW(), last_login_ip = ? WHERE id = ?', [loginIp, user.id]);
      
      res.json({
        code: 200,
        data: {
          token: 'mock-token-' + user.phone + '-' + Date.now(),
          user: { nickname: user.nickname, phone: user.phone, role: user.role_id, points: points }
        }
      });
    } else {
      res.json({ code: 401, message: '账号或密码错误' });
    }
  } catch (err) {
    res.json({ code: 500, message: err.message });
  }
});

app.post('/api/auth/register', async (req, res) => {
  const { phone, password, name, role } = req.body;
  if (!phone || !password) {
    return res.json({ code: 400, message: '缺少参数' });
  }
  
  try {
    const [existRows] = await pool.query('SELECT * FROM users WHERE phone = ?', [phone]);
    if (existRows.length > 0) {
      return res.json({ code: 400, message: '该手机号已注册' });
    }
    
    const now = new Date();
    const [userResult] = await pool.query(
      'INSERT INTO users (phone, password, nickname, role_id, status, credit_balance, credit_total_earned, credit_total_consumed, created_at, updated_at) ' +
      'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [phone, password, name || `用户${phone.slice(-4)}`, role || 'member', 1, 18, 0, 0, now, now]
    );
    const newUserId = userResult.insertId;
    try {
      await pool.query(
        'INSERT INTO credit_logs (user_id, change_amount, balance_after, type, description, operator_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [newUserId, 18, 18, 'register', '新用户注册免费赠送', newUserId, now]
      );
    } catch (logErr) {
      console.error('[register] credit_log INSERT 失败:', logErr.message);
    }

    res.json({
      code: 200,
      message: '注册成功',
      data: { phone, nickname: name || `用户${phone.slice(-4)}`, role: role || 'member' }
    });
  } catch (err) {
    res.json({ code: 500, message: err.message });
  }
});

app.get('/api/auth/profile', async (req, res) => {
  try {
    const token = req.headers['authorization'] || req.query.token;
    if (!token) {
      return res.json({ code: 401, message: '未登录' });
    }

    const phone = extractPhoneFromToken(token);
    if (!phone) {
      return res.json({ code: 401, message: '无效的登录凭证，请重新登录' });
    }
    const [userRows] = await pool.query('SELECT * FROM users WHERE phone = ?', [phone]);

    if (userRows.length === 0) {
      return res.json({ code: 401, message: '账号不存在，请重新登录' });
    }

    const user = userRows[0];
    if (user.status === 0) {
      return res.json({ code: 401, message: '账号已被禁用' });
    }
    res.json({
      code: 200,
      data: {
        phone: user.phone,
        nickname: user.nickname,
        role: user.role_id,
        points: user.credit_balance != null ? user.credit_balance : 18,
        avatar: user.avatar || '',
        status: user.status
      }
    });
  } catch (err) {
    res.json({ code: 500, message: err.message });
  }
});

app.get('/api/users', async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT * FROM users ORDER BY id');
    res.json({
      code: 200,
      data: rows.map(u => ({
        id: u.id,
        phone: u.phone,
        nickname: u.nickname,
        role_id: u.role_id,
        status: u.status,
        points: u.credit_balance || 0,
        created_at: u.created_at
      }))
    });
  } catch (err) {
    res.json({ code: 500, message: err.message });
  }
});

app.delete('/api/users/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    const [userRows] = await pool.query('SELECT * FROM users WHERE id = ?', [id]);
    if (userRows.length === 0) {
      return res.json({ code: 404, message: '用户不存在' });
    }
    
    await pool.query('DELETE FROM project_members WHERE user_id = ?', [id]);
    await pool.query('DELETE FROM users WHERE id = ?', [id]);
    
    res.json({ code: 200, message: '删除成功' });
  } catch (err) {
    res.json({ code: 500, message: err.message });
  }
});

app.put('/api/users/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { nickname, role_id, status, points } = req.body;

    const [userRows] = await pool.query('SELECT * FROM users WHERE id = ?', [id]);
    if (userRows.length === 0) {
      return res.status(404).json({ code: 404, message: '用户不存在' });
    }
    
    const updates = [];
    const params = [];
    
    if (nickname !== undefined) {
      updates.push('nickname = ?');
      params.push(nickname);
    }
    if (role_id !== undefined) {
      updates.push('role_id = ?');
      params.push(role_id);
    }
    if (status !== undefined) {
      updates.push('status = ?');
      params.push(status);
    }
    if (points !== undefined) {
      updates.push('credit_balance = ?');
      params.push(points);
    }
    
    if (updates.length === 0) {
      return res.json({ code: 400, message: '没有需要更新的字段' });
    }
    
    params.push(id);
    
    await pool.query(`UPDATE users SET ${updates.join(', ')} WHERE phone = ?`, params);
    
    res.json({ code: 200, message: '更新成功' });
  } catch (err) {
    res.json({ code: 500, message: err.message });
  }
});

app.post('/api/users/:id/reset-password', async (req, res) => {
  try {
    const { id } = req.params;
    const { newPassword } = req.body;
    if (!newPassword || newPassword.length < 6) {
      return res.json({ code: 400, message: '密码至少6位' });
    }
    const [userRows] = await pool.query('SELECT id FROM users WHERE id = ?', [id]);
    if (userRows.length === 0) {
      return res.json({ code: 404, message: '用户不存在' });
    }
    await pool.query('UPDATE users SET password = ? WHERE id = ?', [newPassword, id]);
    res.json({ code: 200, message: '密码重置成功' });
  } catch (err) {
    res.json({ code: 500, message: err.message });
  }
});

app.get('/api/projects', async (req, res) => {
  try {
    const { phone } = req.query;
    if (!phone) {
      return res.status(400).json({ code: 400, message: '缺少 phone 参数' });
    }
    
    const [userRows] = await pool.query('SELECT * FROM users WHERE phone = ?', [phone]);
    if (userRows.length === 0) {
      return res.status(400).json({ code: 400, message: '用户不存在' });
    }
    
    const user = userRows[0];
    
    const countSub = `(SELECT COUNT(*) FROM project_members pm2 WHERE pm2.project_id = p.id) + 1 AS member_count, (SELECT COUNT(*) FROM battle_records br WHERE br.project_id = p.id) AS battle_count`;
    let query = `SELECT DISTINCT p.id, p.name, p.description, p.creator_id, p.status, p.is_public, p.created_at, p.updated_at, u.phone as creator_phone, ${countSub} FROM projects p LEFT JOIN users u ON p.creator_id = u.id`;
    let params = [];

    if (user.role_id !== 'super_admin') {
      query = `SELECT DISTINCT p.id, p.name, p.description, p.creator_id, p.status, p.is_public, p.created_at, p.updated_at, u.phone as creator_phone, ${countSub} FROM projects p LEFT JOIN users u ON p.creator_id = u.id LEFT JOIN project_members pm ON p.id = pm.project_id WHERE p.creator_id = ? OR pm.user_id = ? OR p.is_public = 1`;
      params = [user.id, user.id];
    }

    const [rows] = await pool.query(query, params);
    res.json({
      code: 200,
      data: rows.map(p => ({
        id: p.id,
        name: p.name,
        description: p.description,
        creator_id: p.creator_id,
        creator_phone: p.creator_phone || '',
        status: p.status,
        is_public: p.is_public,
        member_count: p.member_count,
        battle_count: p.battle_count,
        created_at: p.created_at,
        updated_at: p.updated_at
      }))
    });
  } catch (err) {
    res.json({ code: 500, message: err.message });
  }
});

app.get('/api/projects/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const [rows] = await pool.query(
      `SELECT p.id, p.name, p.description, p.creator_id, p.status, p.is_public, p.created_at, p.updated_at,
        u.phone as creator_phone,
        (SELECT COUNT(*) FROM project_members pm WHERE pm.project_id = p.id) + 1 AS member_count,
        (SELECT COUNT(*) FROM battle_records br WHERE br.project_id = p.id) AS battle_count
       FROM projects p LEFT JOIN users u ON p.creator_id = u.id WHERE p.id = ?`,
      [id]
    );

    if (rows.length === 0) {
      return res.json({ code: 404, message: '项目不存在' });
    }

    const p = rows[0];
    res.json({
      code: 200,
      data: {
        id: p.id,
        name: p.name,
        description: p.description,
        creator_id: p.creator_id,
        creator_phone: p.creator_phone || '',
        status: p.status,
        is_public: p.is_public,
        member_count: p.member_count,
        battle_count: p.battle_count,
        created_at: p.created_at,
        updated_at: p.updated_at
      }
    });
  } catch (err) {
    res.json({ code: 500, message: err.message });
  }
});

app.post('/api/projects', requireActiveUser, async (req, res) => {
  try {
    const { id, name, description, desc, creator_id, creator_phone, is_public, visibility } = req.body;

    // 字段兼容：前端可能用 desc/visibility/creator_phone
    const finalDesc = description || desc || '';
    const finalPublic = (is_public || visibility === 'public') ? 1 : 0;

    // creator_id：优先直接传入，否则通过 creator_phone 查询
    let finalCreatorId = creator_id || null;
    if (!finalCreatorId && creator_phone) {
      const [urows] = await pool.query('SELECT id FROM users WHERE phone = ?', [creator_phone]);
      if (urows.length) finalCreatorId = urows[0].id;
    }

    // 前端传来的 id 可能是 'proj_xxx_xxx' 字符串（BIGINT 列不接受），
    // 只有纯整数才直接使用，否则设为 null 让 MySQL AUTO_INCREMENT 分配
    const parsedId = id ? Number(id) : NaN;
    const projectId = Number.isInteger(parsedId) && parsedId > 0 ? parsedId : null;
    const now = new Date();

    const [insertResult] = await pool.query(
      'INSERT INTO projects (id, name, description, creator_id, is_public, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 1, ?, ?)',
      [projectId, name, finalDesc, finalCreatorId, finalPublic, now, now]
    );

    // AUTO_INCREMENT 分配的 id 在 insertResult.insertId 里
    const actualId = insertResult.insertId || projectId;
    res.json({ code: 200, data: { id: actualId } });
  } catch (err) {
    res.json({ code: 500, message: err.message });
  }
});

app.put('/api/projects/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { name, description, desc, is_public, visibility, status } = req.body;

    const updates = [];
    const params = [];

    if (name !== undefined) {
      updates.push('name = ?');
      params.push(name);
    }
    if (description !== undefined || desc !== undefined) {
      updates.push('description = ?');
      params.push(description !== undefined ? description : desc);
    }
    // is_public 支持直接传 is_public 或 visibility 字符串
    if (is_public !== undefined) {
      updates.push('is_public = ?');
      params.push(is_public ? 1 : 0);
    } else if (visibility !== undefined) {
      updates.push('is_public = ?');
      params.push(visibility === 'public' ? 1 : 0);
    }
    if (status !== undefined) {
      updates.push('status = ?');
      params.push(status);
    }
    
    updates.push('updated_at = NOW()');
    params.push(id);
    
    await pool.query(`UPDATE projects SET ${updates.join(', ')} WHERE id = ?`, params);
    
    res.json({ code: 200, message: '更新成功' });
  } catch (err) {
    res.json({ code: 500, message: err.message });
  }
});

app.delete('/api/projects/:id', async (req, res) => {
  try {
    const { id } = req.params;
    await pool.query('DELETE FROM project_members WHERE project_id = ?', [id]);
    await pool.query('DELETE FROM battle_gallery WHERE project_id = ?', [id]);
    await pool.query('DELETE FROM battle_records WHERE project_id = ?', [id]);
    await pool.query('DELETE FROM projects WHERE id = ?', [id]);
    res.json({ code: 200, message: '删除成功' });
  } catch (err) {
    res.json({ code: 500, message: err.message });
  }
});

// ========== 项目成员管理 API ==========
app.get('/api/projects/:id/members', async (req, res) => {
  try {
    const { id } = req.params;
    const [rows] = await pool.query(
      'SELECT pm.*, u.phone, u.nickname, u.role_id as user_role FROM project_members pm LEFT JOIN users u ON pm.user_id = u.id WHERE pm.project_id = ?',
      [id]
    );
    res.json({
      code: 200,
      data: rows.map(r => ({
        id: r.id,
        project_id: r.project_id,
        user_id: r.user_id,
        phone: r.phone || '',
        role: r.role || 'viewer',
        nickname: r.nickname || '',
        joined_at: r.joined_at
      }))
    });
  } catch (err) {
    res.json({ code: 500, message: err.message });
  }
});

app.post('/api/projects/:id/members', async (req, res) => {
  try {
    const { id } = req.params;
    const { phone, role } = req.body;
    
    if (!phone) {
      return res.json({ code: 400, message: '缺少 phone 参数' });
    }
    
    const [userRows] = await pool.query('SELECT id FROM users WHERE phone = ?', [phone]);
    if (userRows.length === 0) {
      return res.json({ code: 404, message: '用户不存在' });
    }
    
    const userId = userRows[0].id;
    const now = new Date();
    await pool.query(
      'INSERT INTO project_members (project_id, user_id, role, joined_at) VALUES (?, ?, ?, ?)',
      [id, userId, role || 'viewer', now]
    );
    // 同步更新项目的 member_count 和 updated_at
    await pool.query(
      'UPDATE projects SET member_count = (SELECT COUNT(*)+1 FROM project_members WHERE project_id = ?), updated_at = NOW() WHERE id = ?',
      [id, id]
    );

    res.json({ code: 200, message: '添加成功' });
  } catch (err) {
    res.json({ code: 500, message: err.message });
  }
});

app.delete('/api/projects/:id/members/:phone', async (req, res) => {
  try {
    const { id, phone } = req.params;
    
    const [userRows] = await pool.query('SELECT id FROM users WHERE phone = ?', [phone]);
    if (userRows.length === 0) {
      return res.json({ code: 404, message: '用户不存在' });
    }
    const userId = userRows[0].id;
    
    await pool.query('DELETE FROM project_members WHERE project_id = ? AND user_id = ?', [id, userId]);
    // 同步更新项目的 member_count 和 updated_at
    await pool.query(
      'UPDATE projects SET member_count = (SELECT COUNT(*)+1 FROM project_members WHERE project_id = ?), updated_at = NOW() WHERE id = ?',
      [id, id]
    );

    res.json({ code: 200, message: '删除成功' });
  } catch (err) {
    res.json({ code: 500, message: err.message });
  }
});

app.get('/api/roles', async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT * FROM roles');
    res.json({ code: 200, data: rows });
  } catch (err) {
    res.json({ code: 500, message: err.message });
  }
});

app.post('/api/roles', async (req, res) => {
  try {
    const { id, name, permissions, isBuiltIn } = req.body;

    const roleId = id || 'role_' + Date.now();

    await pool.query(
      `INSERT INTO roles (id, name, permissions, is_built_in) VALUES (?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE name=VALUES(name), permissions=VALUES(permissions), is_built_in=VALUES(is_built_in)`,
      [roleId, name, JSON.stringify(permissions || []), isBuiltIn ? 1 : 0]
    );

    res.json({ code: 200, data: { id: roleId } });
  } catch (err) {
    res.json({ code: 500, message: err.message });
  }
});

app.delete('/api/roles/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    await pool.query('DELETE FROM roles WHERE id = ?', [id]);
    
    res.json({ code: 200, message: '删除成功' });
  } catch (err) {
    res.json({ code: 500, message: err.message });
  }
});

// ========== 战报管理 API ==========
app.get('/api/battles', async (req, res) => {
  try {
    const { projectId } = req.query;
    
    let query = 'SELECT * FROM battle_records';
    let params = [];
    
    if (projectId) {
      query += ' WHERE project_id = ?';
      params = [projectId];
    }
    
    query += ' ORDER BY created_at DESC';
    
    const [rows] = await pool.query(query, params);
    res.json({
      code: 200,
      data: rows.map(r => ({
        id: r.id,
        project_id: r.project_id,
        attacker_name: r.attacker_name,
        enemy_name: r.enemy_name,
        result: r.result,
        battle_date: r.battle_date,
        description: r.description,
        left_loss: r.left_loss,
        right_loss: r.right_loss,
        left_total: r.left_total,
        right_total: r.right_total,
        left_loss_rate: r.left_loss_rate,
        right_loss_rate: r.right_loss_rate,
        left_generals: r.left_generals,
        right_generals: r.right_generals,
        left_tactics: r.left_tactics,
        right_tactics: r.right_tactics,
        left_formation: r.left_formation,
        right_formation: r.right_formation,
        left_alliance: r.left_alliance,
        right_alliance: r.right_alliance,
        created_at: r.created_at,
        updated_at: r.updated_at
      }))
    });
  } catch (err) {
    res.json({ code: 500, message: err.message });
  }
});

app.post('/api/battles', requireActiveUser, async (req, res) => {
  try {
    const body = req.body;
    const projectId = body.projectId;
    const attacker_name = body.attacker_name || body.attackerName;
    const enemy_name = body.enemy_name || body.enemyName;
    const result = body.result;
    const battle_date = body.battle_date || body.battleDate;
    const description = body.description;
    const left_loss = body.left_loss || body.leftLoss;
    const right_loss = body.right_loss || body.rightLoss;
    const left_total = body.left_total || body.leftTotal;
    const right_total = body.right_total || body.rightTotal;
    const left_generals = body.left_generals || body.leftGenerals;
    const right_generals = body.right_generals || body.rightGenerals;
    const left_tactics = body.left_tactics || body.leftTactics;
    const right_tactics = body.right_tactics || body.rightTactics;
    const left_formation = body.left_formation || body.leftFormation;
    const right_formation = body.right_formation || body.rightFormation;
    const left_alliance = body.left_alliance || body.leftAlliance;
    const right_alliance = body.right_alliance || body.rightAlliance;
    
    const now = new Date();
    
    const left_generals_str = Array.isArray(left_generals) ? JSON.stringify(left_generals) : left_generals;
    const right_generals_str = Array.isArray(right_generals) ? JSON.stringify(right_generals) : right_generals;
    const left_tactics_str = Array.isArray(left_tactics) ? JSON.stringify(left_tactics) : left_tactics;
    const right_tactics_str = Array.isArray(right_tactics) ? JSON.stringify(right_tactics) : right_tactics;
    
    const [resultRow] = await pool.query(
      'INSERT INTO battle_records (project_id, attacker_name, enemy_name, result, battle_date, description, ' +
      'left_loss, right_loss, left_total, right_total, left_generals, right_generals, ' +
      'left_tactics, right_tactics, left_formation, right_formation, left_alliance, right_alliance, ' +
      'created_by, status, created_at, updated_at) ' +
      'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [projectId, attacker_name, enemy_name, result, battle_date, description,
       left_loss, right_loss, left_total, right_total, left_generals_str, right_generals_str,
       left_tactics_str, right_tactics_str, left_formation, right_formation, left_alliance, right_alliance,
       1, 1, now, now]
    );
    
    // 同步更新所属项目的 battle_count 和 updated_at
    if (projectId) {
      await pool.query(
        'UPDATE projects SET battle_count = (SELECT COUNT(*) FROM battle_records WHERE project_id = ?), updated_at = NOW() WHERE id = ?',
        [projectId, projectId]
      );
    }
    res.json({ code: 200, data: { id: resultRow.insertId } });
  } catch (err) {
    res.json({ code: 500, message: err.message });
  }
});

app.put('/api/battles/:id', async (req, res) => {
  try {
    const { id } = req.params;
    // 兼容 camelCase 和 snake_case
    const attacker_name = req.body.attacker_name || req.body.attackerName;
    const enemy_name = req.body.enemy_name || req.body.enemyName;
    const result = req.body.result;
    const battle_date = req.body.battle_date || req.body.battleDate;
    const description = req.body.description;
    const left_alliance = req.body.left_alliance || req.body.leftAlliance;
    const right_alliance = req.body.right_alliance || req.body.rightAlliance;
    const left_loss = req.body.left_loss || req.body.leftLoss;
    const right_loss = req.body.right_loss || req.body.rightLoss;
    const left_total = req.body.left_total || req.body.leftTotal;
    const right_total = req.body.right_total || req.body.rightTotal;
    const left_loss_rate = req.body.left_loss_rate || req.body.leftLossRate;
    const right_loss_rate = req.body.right_loss_rate || req.body.rightLossRate;
    let left_generals = req.body.left_generals || req.body.leftGenerals;
    let right_generals = req.body.right_generals || req.body.rightGenerals;
    let left_tactics = req.body.left_tactics || req.body.leftTactics;
    let right_tactics = req.body.right_tactics || req.body.rightTactics;
    const left_formation = req.body.left_formation || req.body.leftFormation;
    const right_formation = req.body.right_formation || req.body.rightFormation;

    // JSON 序列化数组字段
    const left_generals_str = Array.isArray(left_generals) ? JSON.stringify(left_generals) : left_generals;
    const right_generals_str = Array.isArray(right_generals) ? JSON.stringify(right_generals) : right_generals;
    const left_tactics_str = Array.isArray(left_tactics) ? JSON.stringify(left_tactics) : left_tactics;
    const right_tactics_str = Array.isArray(right_tactics) ? JSON.stringify(right_tactics) : right_tactics;

    const now = new Date();

    await pool.query(
      'UPDATE battle_records SET attacker_name = ?, enemy_name = ?, result = ?, battle_date = ?, description = ?, ' +
      'left_alliance = ?, right_alliance = ?, ' +
      'left_loss = ?, right_loss = ?, left_total = ?, right_total = ?, ' +
      'left_loss_rate = ?, right_loss_rate = ?, ' +
      'left_generals = ?, right_generals = ?, ' +
      'left_tactics = ?, right_tactics = ?, left_formation = ?, right_formation = ?, updated_at = ? ' +
      'WHERE id = ?',
      [attacker_name, enemy_name, result, battle_date, description,
       left_alliance || '', right_alliance || '',
       left_loss, right_loss, left_total, right_total,
       left_loss_rate ?? null, right_loss_rate ?? null,
       left_generals_str, right_generals_str,
       left_tactics_str, right_tactics_str, left_formation, right_formation, now, id]
    );

    res.json({ code: 200, message: '更新成功' });
  } catch (err) {
    res.json({ code: 500, message: err.message });
  }
});

app.delete('/api/battles/:id', async (req, res) => {
  try {
    const { id } = req.params;
    // 先查出所属项目，删除后同步更新 updated_at
    const [bRows] = await pool.query('SELECT project_id FROM battle_records WHERE id = ?', [id]);
    const bProjectId = bRows.length ? bRows[0].project_id : null;

    await pool.query('DELETE FROM battle_gallery WHERE battle_id = ?', [id]);
    await pool.query('DELETE FROM battle_records WHERE id = ?', [id]);

    if (bProjectId) {
      await pool.query(
        'UPDATE projects SET battle_count = (SELECT COUNT(*) FROM battle_records WHERE project_id = ?), updated_at = NOW() WHERE id = ?',
        [bProjectId, bProjectId]
      );
    }
    res.json({ code: 200, message: '删除成功' });
  } catch (err) {
    res.json({ code: 500, message: err.message });
  }
});

// ========== 积分管理 API ==========
// 按手机号更新积分（前端调用）
app.put('/api/user_credits', async (req, res) => {
  try {
    const { phone, balance, type, description, operator_id, operator_phone } = req.body;
    if (!phone || balance === undefined) return res.json({ code: 400, message: '缺少参数' });
    const [rows] = await pool.query('SELECT id, credit_balance FROM users WHERE phone = ?', [phone]);
    if (rows.length === 0) return res.json({ code: 404, message: '用户不存在' });
    const userId = rows[0].id;
    const oldBalance = rows[0].credit_balance || 0;
    const changeAmount = balance - oldBalance;
    await pool.query('UPDATE users SET credit_balance = ? WHERE id = ?', [balance, userId]);
    let finalOperatorId = operator_id || null;
    if (!finalOperatorId && operator_phone) {
      const [opRows] = await pool.query('SELECT id FROM users WHERE phone = ?', [operator_phone]);
      if (opRows.length) finalOperatorId = opRows[0].id;
    }
    const logType = type || 'adjust';
    const logDesc = description || '超管调整积分';
    // 消费/无操作者时，操作者即用户本身
    if (!finalOperatorId && logType === 'consume') finalOperatorId = userId;
    await pool.query(
      'INSERT INTO credit_logs (user_id, change_amount, balance_after, type, description, operator_id, created_at) VALUES (?, ?, ?, ?, ?, ?, NOW())',
      [userId, changeAmount, balance, logType, logDesc, finalOperatorId]
    );
    res.json({ code: 200, message: '更新成功' });
  } catch (err) {
    res.json({ code: 500, message: err.message });
  }
});


app.get('/api/db/tables', async (req, res) => {
  try {
    const [tableList] = await pool.query(
      "SELECT table_name as name FROM information_schema.tables WHERE table_schema = 'nslg_battle'"
    );
    
    const tables = [];
    for (const tbl of tableList) {
      const [countResult] = await pool.query(`SELECT COUNT(*) as cnt FROM \`${tbl.name}\``);
      tables.push({
        name: tbl.name,
        count: countResult[0].cnt
      });
    }
    
    res.json({ code: 200, data: tables });
  } catch (err) {
    res.json({ code: 500, message: err.message });
  }
});

app.get('/api/db/table/:tableName', async (req, res) => {
  try {
    const { tableName } = req.params;
    const { page = 1, pageSize = 20, search } = req.query;
    const offset = (page - 1) * pageSize;
    
    let query = `SELECT * FROM \`${tableName}\``;
    let countQuery = `SELECT COUNT(*) as total FROM \`${tableName}\``;
    let params = [];
    
    if (search) {
      query += ` WHERE CONCAT_WS(' ', id, name, description, phone) LIKE ?`;
      countQuery += ` WHERE CONCAT_WS(' ', id, name, description, phone) LIKE ?`;
      params.push(`%${search}%`);
    }
    
    query += ` LIMIT ?, ?`;
    const queryParams = [...params, offset, parseInt(pageSize)];
    const countParams = [...params];
    
    const [rows] = await pool.query(query, queryParams);
    const [countResult] = await pool.query(countQuery, countParams);
    const total = countResult[0].total;
    
    const [columns] = await pool.query(`DESCRIBE \`${tableName}\``);
    
    res.json({
      code: 200,
      data: {
        rows,
        columns: columns.map(col => ({ field: col.Field, type: col.Type })),
        pagination: {
          page: parseInt(page),
          pageSize: parseInt(pageSize),
          total,
          totalPages: Math.ceil(total / pageSize)
        }
      }
    });
  } catch (err) {
    res.json({ code: 500, message: err.message });
  }
});

app.get('/api/db/table/:tableName/desc', async (req, res) => {
  try {
    const { tableName } = req.params;
    const [columns] = await pool.query(`DESCRIBE \`${tableName}\``);
    res.json({
      code: 200,
      data: {
        table: tableName,
        columns: columns.map(col => ({
          field: col.Field,
          type: col.Type,
          nullable: col.Null === 'YES',
          key: col.Key,
          default: col.Default,
          extra: col.Extra
        }))
      }
    });
  } catch (err) {
    res.json({ code: 500, message: err.message });
  }
});

// ========== OCR 代理（豆包视觉模型）==========
const DOUBAO_API_KEY = 'ark-74b37e3f-3407-4070-b918-71d6a455bc5a-19ae6';
const DOUBAO_URL = 'https://ark.cn-beijing.volces.com/api/v3/chat/completions';

app.post('/api/ocr', requireActiveUser, async (req, res) => {
  try {
    const response = await fetch(DOUBAO_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${DOUBAO_API_KEY}`
      },
      body: JSON.stringify(req.body)
    });
    const data = await response.json();
    if (!response.ok) {
      return res.status(response.status).json({ error: data.error || data, code: response.status });
    }
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ========== 战报图片（battle_gallery）==========
// 上传图片（与战报绑定）
app.post('/api/gallery', requireActiveUser, async (req, res) => {
  try {
    const { battle_id, project_id, image_data, original_name, file_size, uploader_phone } = req.body;
    if (!image_data || !project_id) return res.json({ code: 400, message: '缺少参数' });

    // 通过 phone 查 user_id
    let uploaded_by = null;
    if (uploader_phone) {
      const [uRows] = await pool.query('SELECT id FROM users WHERE phone = ? LIMIT 1', [uploader_phone]);
      if (uRows.length > 0) uploaded_by = uRows[0].id;
    }

    // 如果 battle_id 已有图片则更新，否则插入
    if (battle_id) {
      const [exist] = await pool.query('SELECT id FROM battle_gallery WHERE battle_id = ?', [battle_id]);
      if (exist.length > 0) {
        await pool.query(
          'UPDATE battle_gallery SET image_data=?, original_name=?, file_size=?, uploaded_by=?, updated_at=NOW() WHERE battle_id=?',
          [image_data, original_name || '', file_size || 0, uploaded_by, battle_id]
        );
        return res.json({ code: 200, data: { id: exist[0].id } });
      }
    }
    const [result] = await pool.query(
      'INSERT INTO battle_gallery (project_id, battle_id, image_data, original_name, file_size, uploaded_by, created_at, updated_at) VALUES (?,?,?,?,?,?,NOW(),NOW())',
      [project_id, battle_id || null, image_data, original_name || '', file_size || 0, uploaded_by]
    );
    res.json({ code: 200, data: { id: result.insertId } });
  } catch (err) {
    res.json({ code: 500, message: err.message });
  }
});
// 获取单张图片数据
// 通过 battle_id 获取图片数据
app.get('/api/gallery/by-battle/:battleId', async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT id, battle_id, image_data FROM battle_gallery WHERE battle_id=? AND status=1 LIMIT 1', [req.params.battleId]);
    if (rows.length === 0) return res.json({ code: 404, message: '无图片' });
    res.json({ code: 200, data: rows[0] });
  } catch (err) {
    res.json({ code: 500, message: err.message });
  }
});

// ========== 截图工具安装包下载 ==========
const path = require('path');
const fs   = require('fs');

app.get('/api/download/screenshot-tool', (req, res) => {
  const filePath = path.resolve(__dirname, 'release', '三谋战报截图工具.exe');
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ code: 404, message: '文件不存在，请联系管理员' });
  }
  res.download(filePath, '三谋战报截图工具.exe', (err) => {
    if (err && !res.headersSent) {
      res.status(500).json({ code: 500, message: '下载失败：' + err.message });
    }
  });
});

app.listen(PORT, async () => {
  await initDB();
  console.log(`🚀 服务运行在 http://localhost:${PORT}`);
});