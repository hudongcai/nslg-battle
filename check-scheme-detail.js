const mysql = require('mysql2/promise');

async function checkScheme() {
  const pool = mysql.createPool({
    host: 'localhost',
    user: 'nslg-battle-server',
    password: 'hu6956521',
    database: 'nslg_battle',
    charset: 'utf8mb4'
  });

  try {
    console.log('=== 方案"数据库全局配置"详细信息 ===\n');
    const [rows] = await pool.query(
      'SELECT * FROM ocr_schemes WHERE name = ? LIMIT 1',
      ['数据库全局配置']
    );
    
    if (rows.length === 0) {
      console.log('❌ 未找到该方案');
    } else {
      const s = rows[0];
      console.log('ID:', s.id);
      console.log('名称:', s.name);
      console.log('所有者手机:', s.user_phone || 'NULL (全局)');
      console.log('图片尺寸:', s.image_width, 'x', s.image_height);
      console.log('创建时间:', s.created_at);
      console.log('更新时间:', s.updated_at);
      
      const boxes = JSON.parse(s.boxes);
      console.log('\nboxes数量:', boxes.length);
      console.log('前5个box:');
      boxes.slice(0, 5).forEach((box, idx) => {
        console.log(`  [${idx}] rx1=${box.rx1.toFixed(4)} ry1=${box.ry1.toFixed(4)} rx2=${box.rx2.toFixed(4)} ry2=${box.ry2.toFixed(4)}`);
      });
      
      const slots = JSON.parse(s.test_alliance_slots);
      console.log('\ntest_alliance_slots:', slots);
      
      const names = JSON.parse(s.test_player_names);
      console.log('test_player_names:', names);
    }
    
    await pool.end();
  } catch (err) {
    console.error('错误:', err.message);
    process.exit(1);
  }
}

checkScheme();
