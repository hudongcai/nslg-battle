const express = require('express');
const mysql = require('mysql2/promise');
const cors = require('cors');

const app = express();
const PORT = 3000;

app.use(cors());
app.use(express.json());

const dbConfig = {
  host: 'localhost',
  port: 3306,
  user: 'nslg-battle-server',
  password: 'hu6956521',
  database: 'nslg_battle'
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
      res.json({ 
        code: 200, 
        data: { 
          token: 'mock-token-' + Date.now(), 
          user: { nickname: user.nickname, phone: user.phone, role: user.role_id } 
        } 
      });
    } else {
      res.json({ code: 401, message: '账号或密码错误' });
    }
  } catch (err) {
    res.json({ code: 500, message: err.message });
  }
});

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

app.get('/api/roles', async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT * FROM roles');
    res.json({ code: 200, data: rows });
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