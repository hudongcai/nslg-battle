const mysql = require('mysql2/promise');

async function debug() {
  const pool = mysql.createPool({
    host: 'localhost',
    user: 'nslg-battle-server',
    password: 'hu6956521',
    database: 'nslg_battle',
    charset: 'utf8mb4'
  });

  try {
    const [rows] = await pool.query('SELECT boxes FROM ocr_schemes WHERE id = 13');
    const boxesData = rows[0].boxes;
    
    console.log('数据类型:', typeof boxesData);
    console.log('数据长度:', String(boxesData).length);
    console.log('\n完整内容:');
    console.log(String(boxesData));
    
    await pool.end();
  } catch (err) {
    console.error('错误:', err);
  }
}

debug();
