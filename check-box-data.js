const mysql = require('mysql2/promise');

async function checkBoxData() {
  const pool = mysql.createPool({
    host: 'localhost',
    user: 'nslg-battle-server',
    password: 'hu6956521',
    database: 'nslg_battle',
    charset: 'utf8mb4'
  });

  try {
    const [rows] = await pool.query(
      'SELECT id, name, boxes FROM ocr_schemes WHERE name = ? LIMIT 1',
      ['数据库全局配置']
    );
    
    if (rows.length > 0) {
      console.log('方案ID:', rows[0].id);
      console.log('方案名称:', rows[0].name);
      console.log('boxes字段类型:', typeof rows[0].boxes);
      console.log('boxes字段内容(前200字符):', String(rows[0].boxes).substring(0, 200));
      
      // 尝试解析
      try {
        const boxes = JSON.parse(rows[0].boxes);
        console.log('\n✅ JSON解析成功，boxes数量:', boxes.length);
      } catch (e) {
        console.log('\n❌ JSON解析失败:', e.message);
      }
    }
    
    await pool.end();
  } catch (err) {
    console.error('错误:', err.message);
  }
}

checkBoxData();
