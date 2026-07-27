const mysql = require('mysql2/promise');

async function checkSchemes() {
  const pool = mysql.createPool({
    host: 'localhost',
    user: 'nslg-battle-server',
    password: 'hu6956521',
    database: 'nslg_battle',
    charset: 'utf8mb4'
  });

  try {
    console.log('=== ocr_schemes 表中的所有方案 ===');
    const [schemes] = await pool.query(
      'SELECT id, name, user_phone, image_width, image_height, created_at FROM ocr_schemes ORDER BY id'
    );
    
    if (schemes.length === 0) {
      console.log('❌ ocr_schemes 表为空，没有任何方案');
    } else {
      console.log(`找到 ${schemes.length} 个方案:\n`);
      schemes.forEach(s => {
        const owner = s.user_phone || '全局';
        console.log(`[${s.id}] ${s.name}`);
        console.log(`    所有者: ${owner}`);
        console.log(`    尺寸: ${s.image_width}x${s.image_height}`);
        console.log(`    创建时间: ${s.created_at}`);
        console.log('');
      });
    }
    
    await pool.end();
  } catch (err) {
    console.error('错误:', err.message);
    process.exit(1);
  }
}

checkSchemes();
