const mysql = require('mysql2/promise');

async function checkTable() {
  const pool = mysql.createPool({
    host: 'localhost',
    user: 'nslg-battle-server',
    password: 'hu6956521',
    database: 'nslg_battle',
    charset: 'utf8mb4'
  });

  try {
    console.log('=== label_configs 表结构 ===');
    const [columns] = await pool.query('DESCRIBE label_configs');
    columns.forEach(col => {
      console.log(`${col.Field} - ${col.Type} - ${col.Null} - ${col.Key}`);
    });
    
    console.log('\n=== label_configs 数据样本 ===');
    const [rows] = await pool.query('SELECT * FROM label_configs LIMIT 3');
    console.log('记录数:', rows.length);
    if (rows.length > 0) {
      console.log('列名:', Object.keys(rows[0]));
      rows.forEach((row, idx) => {
        console.log(`\n记录${idx + 1}:`, JSON.stringify(row, null, 2).substring(0, 500));
      });
    }
    
    await pool.end();
  } catch (err) {
    console.error('错误:', err.message);
    process.exit(1);
  }
}

checkTable();
