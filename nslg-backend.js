const express = require('express');
const mysql = require('mysql2/promise');
const cors = require('cors');

const app = express();
const PORT = 3000;

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use((req, res, next) => {
  req.setEncoding('utf8');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  next();
});

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
      const [creditRows] = await pool.query('SELECT balance FROM user_credits WHERE user_id = ?', [user.id]);
      const points = creditRows.length > 0 ? creditRows[0].balance : 18;
      
      res.json({ 
        code: 200, 
        data: { 
          token: 'mock-token-' + Date.now(), 
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
      'INSERT INTO users (phone, password, nickname, role_id, status, created_at, updated_at) ' +
      'VALUES (?, ?, ?, ?, ?, ?, ?)',
      [phone, password, name || `用户${phone.slice(-4)}`, role || 'member', 1, now, now]
    );
    
    const userId = userResult.insertId;
    
    await pool.query(
      'INSERT INTO user_credits (user_id, balance, total_earned, total_consumed, last_updated) ' +
      'VALUES (?, ?, ?, ?, ?)',
      [userId, 18, 0, 0, now]
    );
    
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
    
    const phone = token.split('-').pop();
    const [userRows] = await pool.query('SELECT * FROM users WHERE phone = ?', [phone]);
    
    if (userRows.length === 0) {
      return res.json({ code: 401, message: '用户不存在' });
    }
    
    const user = userRows[0];
    const [creditRows] = await pool.query('SELECT balance FROM user_credits WHERE user_id = ?', [user.id]);
    const points = creditRows.length > 0 ? creditRows[0].balance : 18;
    
    res.json({
      code: 200,
      data: {
        phone: user.phone,
        nickname: user.nickname,
        role: user.role_id,
        points: points,
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
    const [rows] = await pool.query(`
      SELECT u.*, uc.balance as points 
      FROM users u 
      LEFT JOIN user_credits uc ON u.id = uc.user_id
    `);
    res.json({
      code: 200,
      data: rows.map(u => ({
        id: u.id,
        phone: u.phone,
        nickname: u.nickname,
        role_id: u.role_id,
        status: u.status,
        points: u.points || 0,
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
    
    await pool.query('DELETE FROM user_credits WHERE user_id = ?', [id]);
    await pool.query('DELETE FROM project_members WHERE user_id = ?', [id]);
    await pool.query('DELETE FROM users WHERE id = ?', [id]);
    
    res.json({ code: 200, message: '删除成功' });
  } catch (err) {
    res.json({ code: 500, message: err.message });
  }
});

app.put('/api/users/:phone', async (req, res) => {
  try {
    const { phone } = req.params;
    const { nickname, role_id, status, points } = req.body;
    
    const [userRows] = await pool.query('SELECT * FROM users WHERE phone = ?', [phone]);
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
      updates.push('points = ?');
      params.push(points);
    }
    
    if (updates.length === 0) {
      return res.json({ code: 400, message: '没有需要更新的字段' });
    }
    
    params.push(phone);
    
    await pool.query(`UPDATE users SET ${updates.join(', ')} WHERE phone = ?`, params);
    
    res.json({ code: 200, message: '更新成功' });
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
    
    let query = 'SELECT * FROM projects';
    let params = [];
    
    if (user.role_id !== 'super_admin') {
      query = 'SELECT p.* FROM projects p LEFT JOIN project_members pm ON p.id = pm.project_id WHERE p.creator_id = ? OR pm.phone = ?';
      params = [phone, phone];
    }
    
    const [rows] = await pool.query(query, params);
    res.json({
      code: 200,
      data: rows.map(p => ({
        id: p.id,
        name: p.name,
        description: p.description,
        creator_id: p.creator_id,
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
    const [rows] = await pool.query('SELECT * FROM projects WHERE id = ?', [id]);
    
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

app.post('/api/projects', async (req, res) => {
  try {
    const { id, name, description, creator_id, is_public } = req.body;
    
    const projectId = id || Date.now();
    const now = new Date();
    
    const [result] = await pool.query(
      'INSERT INTO projects (id, name, description, creator_id, is_public, created_at, updated_at) ' +
      'VALUES (?, ?, ?, ?, ?, ?, ?)',
      [projectId, name, description, creator_id, is_public ? 1 : 0, now, now]
    );
    
    res.json({ code: 200, data: { id: projectId } });
  } catch (err) {
    res.json({ code: 500, message: err.message });
  }
});

app.put('/api/projects/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { name, description, is_public, status } = req.body;
    
    const updates = [];
    const params = [];
    
    if (name !== undefined) {
      updates.push('name = ?');
      params.push(name);
    }
    if (description !== undefined) {
      updates.push('description = ?');
      params.push(description);
    }
    if (is_public !== undefined) {
      updates.push('is_public = ?');
      params.push(is_public ? 1 : 0);
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
    
    const [result] = await pool.query(
      'INSERT INTO roles (id, name, permissions, is_built_in) VALUES (?, ?, ?, ?)',
      [roleId, name, JSON.stringify(permissions || []), isBuiltIn ? 1 : 0]
    );
    
    res.json({ code: 200, data: { id: roleId } });
  } catch (err) {
    res.json({ code: 500, message: err.message });
  }
});

app.put('/api/roles/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { name, permissions, isBuiltIn } = req.body;
    
    const updates = [];
    const params = [];
    
    if (name !== undefined) {
      updates.push('name = ?');
      params.push(name);
    }
    if (permissions !== undefined) {
      updates.push('permissions = ?');
      params.push(JSON.stringify(permissions));
    }
    if (isBuiltIn !== undefined) {
      updates.push('is_built_in = ?');
      params.push(isBuiltIn ? 1 : 0);
    }
    
    if (updates.length === 0) {
      return res.json({ code: 400, message: '没有需要更新的字段' });
    }
    
    params.push(id);
    
    await pool.query(`UPDATE roles SET ${updates.join(', ')} WHERE id = ?`, params);
    
    res.json({ code: 200, message: '更新成功' });
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
        left_generals: r.left_generals,
        right_generals: r.right_generals,
        left_tactics: r.left_tactics,
        right_tactics: r.right_tactics,
        left_formation: r.left_formation,
        right_formation: r.right_formation,
        created_at: r.created_at,
        updated_at: r.updated_at
      }))
    });
  } catch (err) {
    res.json({ code: 500, message: err.message });
  }
});

app.post('/api/battles', async (req, res) => {
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
    
    res.json({ code: 200, data: { id: resultRow.insertId } });
  } catch (err) {
    res.json({ code: 500, message: err.message });
  }
});

app.put('/api/battles/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { attacker_name, enemy_name, result, battle_date, description,
            left_loss, right_loss, left_total, right_total, left_generals, right_generals,
            left_tactics, right_tactics, left_formation, right_formation } = req.body;
    
    const now = new Date();
    
    await pool.query(
      'UPDATE battle_records SET attacker_name = ?, enemy_name = ?, result = ?, battle_date = ?, description = ?, ' +
      'left_loss = ?, right_loss = ?, left_total = ?, right_total = ?, left_generals = ?, right_generals = ?, ' +
      'left_tactics = ?, right_tactics = ?, left_formation = ?, right_formation = ?, updated_at = ? ' +
      'WHERE id = ?',
      [attacker_name, enemy_name, result, battle_date, description,
       left_loss, right_loss, left_total, right_total, left_generals, right_generals,
       left_tactics, right_tactics, left_formation, right_formation, now, id]
    );
    
    res.json({ code: 200, message: '更新成功' });
  } catch (err) {
    res.json({ code: 500, message: err.message });
  }
});

app.delete('/api/battles/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    await pool.query('DELETE FROM battle_records WHERE id = ?', [id]);
    
    res.json({ code: 200, message: '删除成功' });
  } catch (err) {
    res.json({ code: 500, message: err.message });
  }
});

// ========== 积分管理 API ==========
app.get('/api/user_credits', async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT uc.*, u.phone, u.nickname 
      FROM user_credits uc 
      LEFT JOIN users u ON uc.user_id = u.id 
      ORDER BY uc.id
    `);
    res.json({
      code: 200,
      data: rows.map(u => ({
        id: u.id,
        user_id: u.user_id,
        phone: u.phone || '',
        nickname: u.nickname || '',
        balance: u.balance || 0,
        total_earned: u.total_earned || 0,
        total_consumed: u.total_consumed || 0,
        last_updated: u.last_updated
      }))
    });
  } catch (err) {
    res.json({ code: 500, message: err.message });
  }
});

app.get('/api/user_credits/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    const [rows] = await pool.query(`
      SELECT uc.*, u.phone, u.nickname 
      FROM user_credits uc 
      LEFT JOIN users u ON uc.user_id = u.id 
      WHERE uc.user_id = ?
    `, [userId]);
    
    if (rows.length === 0) {
      return res.json({ code: 404, message: '用户不存在' });
    }
    
    const u = rows[0];
    res.json({
      code: 200,
      data: {
        id: u.id,
        user_id: u.user_id,
        phone: u.phone || '',
        nickname: u.nickname || '',
        balance: u.balance || 0,
        total_earned: u.total_earned || 0,
        total_consumed: u.total_consumed || 0,
        last_updated: u.last_updated
      }
    });
  } catch (err) {
    res.json({ code: 500, message: err.message });
  }
});

app.put('/api/user_credits/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    const { balance, total_earned, total_consumed } = req.body;
    
    const [rows] = await pool.query('SELECT * FROM user_credits WHERE user_id = ?', [userId]);
    
    if (rows.length === 0) {
      return res.json({ code: 404, message: '用户不存在' });
    }
    
    const updates = [];
    const params = [];
    
    if (balance !== undefined) {
      updates.push('balance = ?');
      params.push(balance);
    }
    if (total_earned !== undefined) {
      updates.push('total_earned = ?');
      params.push(total_earned);
    }
    if (total_consumed !== undefined) {
      updates.push('total_consumed = ?');
      params.push(total_consumed);
    }
    
    if (updates.length === 0) {
      return res.json({ code: 400, message: '没有需要更新的字段' });
    }
    
    updates.push('last_updated = NOW()');
    params.push(userId);
    
    await pool.query(`UPDATE user_credits SET ${updates.join(', ')} WHERE user_id = ?`, params);
    
    res.json({ code: 200, message: '更新成功' });
  } catch (err) {
    res.json({ code: 500, message: err.message });
  }
});

// 按手机号更新积分（前端调用）
app.put('/api/user_credits', async (req, res) => {
  try {
    const { phone, balance } = req.body;
    
    if (!phone || balance === undefined) {
      return res.json({ code: 400, message: '缺少参数' });
    }
    
    const [userRows] = await pool.query('SELECT id FROM users WHERE phone = ?', [phone]);
    if (userRows.length === 0) {
      return res.json({ code: 404, message: '用户不存在' });
    }
    
    const userId = userRows[0].id;
    
    await pool.query('UPDATE user_credits SET balance = ?, last_updated = NOW() WHERE user_id = ?', [balance, userId]);
    
    res.json({ code: 200, message: '更新成功' });
  } catch (err) {
    res.json({ code: 500, message: err.message });
  }
});

// ========== 积分日志 API ==========
app.get('/api/credit_logs', async (req, res) => {
  try {
    const { user_id, page = 1, pageSize = 50 } = req.query;
    const offset = (page - 1) * pageSize;
    
    let query = `
      SELECT cl.*, u.phone, u.nickname 
      FROM credit_logs cl 
      LEFT JOIN users u ON cl.user_id = u.id
    `;
    let params = [];
    
    if (user_id) {
      query += ' WHERE cl.user_id = ?';
      params.push(user_id);
    }
    
    query += ' ORDER BY cl.created_at DESC LIMIT ?, ?';
    params.push(offset, parseInt(pageSize));
    
    const [rows] = await pool.query(query, params);
    
    res.json({
      code: 200,
      data: rows.map(log => ({
        id: log.id,
        user_id: log.user_id,
        phone: log.phone || '',
        nickname: log.nickname || '',
        change_amount: log.change_amount || 0,
        balance_after: log.balance_after || 0,
        type: log.type || '',
        description: log.description || '',
        related_id: log.related_id,
        operator_id: log.operator_id,
        created_at: log.created_at
      }))
    });
  } catch (err) {
    res.json({ code: 500, message: err.message });
  }
});

app.post('/api/credit_logs', async (req, res) => {
  try {
    const { user_id, change_amount, balance_after, type, description, related_id, operator_id } = req.body;
    
    const [result] = await pool.query(
      'INSERT INTO credit_logs (user_id, change_amount, balance_after, type, description, related_id, operator_id, created_at) ' +
      'VALUES (?, ?, ?, ?, ?, ?, ?, NOW())',
      [user_id, change_amount, balance_after, type, description, related_id, operator_id]
    );
    
    res.json({ code: 200, data: { id: result.insertId } });
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

app.listen(PORT, async () => {
  await initDB();
  console.log(`🚀 服务运行在 http://localhost:${PORT}`);
});