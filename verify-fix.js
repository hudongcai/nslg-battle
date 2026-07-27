const mysql = require('mysql2/promise');

async function verify() {
  const pool = mysql.createPool({
    host: 'localhost',
    user: 'nslg-battle-server',
    password: 'hu6956521',
    database: 'nslg_battle',
    charset: 'utf8mb4'
  });

  try {
    const [rows] = await pool.query(
      'SELECT id, name, image_width, image_height, LENGTH(boxes) as boxes_length, SUBSTRING(boxes, 1, 50) as boxes_preview FROM ocr_schemes WHERE name = ?',
      ['数据库全局配置']
    );
    
    if (rows.length > 0) {
      const r = rows[0];
      console.log('方案ID:', r.id);
      console.log('尺寸:', r.image_width, 'x', r.image_height);
      console.log('boxes字段长度:', r.boxes_length, '字节');
      console.log('boxes前50字符:', r.boxes_preview);
      
      // 重新读取完整数据
      const [full] = await pool.query('SELECT boxes FROM ocr_schemes WHERE id = ?', [r.id]);
      try {
        const boxes = JSON.parse(full[0].boxes);
        console.log('\n✅ JSON解析成功!');
        console.log('boxes数组长度:', boxes.length);
        console.log('豆豆L2 (索引9):', boxes[9]);
      } catch (e) {
        console.log('\n❌ JSON解析失败:', e.message);
      }
    }
    
    await pool.end();
  } catch (err) {
    console.error('错误:', err);
  }
}

verify();
