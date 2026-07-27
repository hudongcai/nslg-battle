const mysql = require('mysql2/promise');

async function deleteScheme() {
  const pool = mysql.createPool({
    host: 'localhost',
    user: 'nslg-battle-server',
    password: 'hu6956521',
    database: 'nslg_battle',
    charset: 'utf8mb4'
  });

  try {
    console.log('删除损坏的方案"数据库全局配置"...');
    await pool.query('DELETE FROM ocr_schemes WHERE name = ?', ['数据库全局配置']);
    console.log('✅ 已删除');
    
    await pool.end();
  } catch (err) {
    console.error('错误:', err);
  }
}

deleteScheme();
