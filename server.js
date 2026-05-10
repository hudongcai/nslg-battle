const express = require('express');
const mysql = require('mysql2/promise');
const axios = require('axios');
const cors = require('cors');

const app = express();
const PORT = 3000;

app.use(cors({
  origin: ['https://www.zhenwu.fun', 'http://localhost:8080', 'http://127.0.0.1:8080'],
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'token']
}));
app.use(express.json());

const dbConfig = {
  host: 'localhost',
  port: 3306,
  user: 'nslg-battle-server',
  password: 'hu6956521',
  database: 'nslg_battle'
};

const D1_API_BASE = 'https://www.zhenwu.fun/api';

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
      
      const clientIP = req.ip || req.connection.remoteAddress || req.socket.remoteAddress || (req.connection.socket ? req.connection.socket.remoteAddress : null);
      const ip = clientIP === '::1' || clientIP === '::ffff:127.0.0.1' ? '127.0.0.1' : clientIP;
      
      await pool.query('UPDATE users SET last_login_at = CURRENT_TIMESTAMP, last_login_ip = ? WHERE id = ?', [ip, user.id]);
      
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
    res.status(500).json({ code: 500, message: err.message });
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
    res.status(500).json({ code: 500, message: err.message });
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
    res.status(500).json({ code: 500, message: err.message });
  }
});

const SYNC_TABLES = ['users', 'projects', 'battle_records', 'system_logs', 'user_credits'];

async function syncTableToD1(tableName) {
  try {
    const [rows] = await pool.query(`SELECT * FROM \`${tableName}\``);
    
    const response = await axios.post(`${D1_API_BASE}/db/sync/${tableName}`, {
      data: rows,
      overwrite: true
    });

    return { success: response.data.code === 200, message: response.data.message, count: rows.length };
  } catch (error) {
    return { success: false, message: error.message, count: 0 };
  }
}

app.post('/api/sync/all', async (req, res) => {
  const results = [];
  
  for (const table of SYNC_TABLES) {
    const result = await syncTableToD1(table);
    results.push({ table, ...result });
  }
  
  const allSuccess = results.every(r => r.success);
  res.json({
    code: allSuccess ? 200 : 500,
    message: allSuccess ? '全部同步成功' : '部分同步失败',
    data: results
  });
});

app.post('/api/sync/:table', async (req, res) => {
  const tableName = req.params.table;
  
  if (!SYNC_TABLES.includes(tableName)) {
    return res.json({ code: 400, message: `不支持的表: ${tableName}` });
  }
  
  const result = await syncTableToD1(tableName);
  res.json({
    code: result.success ? 200 : 500,
    message: result.message,
    data: { count: result.count }
  });
});

app.get('/api/sync/status', async (req, res) => {
  try {
    const status = {};
    for (const table of SYNC_TABLES) {
      const [rows] = await pool.query(`SELECT COUNT(*) as count FROM \`${table}\``);
      status[table] = rows[0].count;
    }
    
    res.json({
      code: 200,
      message: '获取状态成功',
      data: { mysql: status }
    });
  } catch (error) {
    res.json({ code: 500, message: error.message });
  }
});

// ========== 用户管理 API ==========
app.get('/api/users', async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT * FROM users');
    res.json({
      code: 200,
      data: rows.map(u => ({
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

app.get('/api/users/:phone', async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT * FROM users WHERE phone = ?', [req.params.phone]);
    if (rows.length === 0) {
      res.json({ code: 404, message: '用户不存在' });
    } else {
      res.json({ code: 200, data: rows[0] });
    }
  } catch (err) {
    res.json({ code: 500, message: err.message });
  }
});

app.put('/api/users/:phone', async (req, res) => {
  try {
    const { points } = req.body;
    await pool.query('UPDATE users SET points = ? WHERE phone = ?', [points, req.params.phone]);
    res.json({ code: 200, message: '更新成功' });
  } catch (err) {
    res.json({ code: 500, message: err.message });
  }
});

// ========== 项目管理 API ==========
app.get('/api/projects', async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT * FROM projects');
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
    const [rows] = await pool.query('SELECT * FROM projects WHERE id = ?', [req.params.id]);
    if (rows.length === 0) {
      res.json({ code: 404, message: '项目不存在' });
    } else {
      res.json({ code: 200, data: rows[0] });
    }
  } catch (err) {
    res.json({ code: 500, message: err.message });
  }
});

app.post('/api/projects', async (req, res) => {
  try {
    const { id, name, description, creator_id, is_public = 0 } = req.body;
    const now = Date.now();
    await pool.query(
      'INSERT INTO projects (id, name, description, creator_id, is_public, member_count, battle_count, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 0, 0, ?, ?)',
      [id, name, description, creator_id, is_public, now, now]
    );
    res.json({ code: 200, message: '创建成功', data: { id, name } });
  } catch (err) {
    res.json({ code: 500, message: err.message });
  }
});

app.put('/api/projects/:id', async (req, res) => {
  try {
    const { name, description, is_public } = req.body;
    await pool.query(
      'UPDATE projects SET name = ?, description = ?, is_public = ?, updated_at = ? WHERE id = ?',
      [name, description, is_public, Date.now(), req.params.id]
    );
    res.json({ code: 200, message: '更新成功' });
  } catch (err) {
    res.json({ code: 500, message: err.message });
  }
});

app.delete('/api/projects/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM projects WHERE id = ?', [req.params.id]);
    res.json({ code: 200, message: '删除成功' });
  } catch (err) {
    res.json({ code: 500, message: err.message });
  }
});

// ========== 角色管理 API ==========
app.get('/api/roles', async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT * FROM roles');
    res.json({ code: 200, data: rows });
  } catch (err) {
    res.json({ code: 500, message: err.message });
  }
});

app.listen(PORT, async () => {
  await initDB();
  console.log(`🚀 服务运行在 http://localhost:${PORT}`);
});