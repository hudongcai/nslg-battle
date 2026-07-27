const mysql = require('mysql2/promise');

async function checkOCRConfig() {
  const pool = mysql.createPool({
    host: 'localhost',
    user: 'nslg-battle-server',
    password: 'hu6956521',
    database: 'nslg_battle',
    charset: 'utf8mb4',
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
  });

  try {
    // 1. 检查 label_configs 表中全局配置
    console.log('=== 1. 全局 label_configs 配置 ===');
    const [globalConfigs] = await pool.query(
      'SELECT project_id, label_config FROM label_configs WHERE project_id IS NULL'
    );
    if (globalConfigs.length > 0) {
      const config = JSON.parse(globalConfigs[0].label_config);
      console.log('全局配置存在，categories数量:', config.categories?.length || 0);
      
      // 查找豆豆相关的配置
      const doudouCategories = config.categories?.filter(c => 
        c.cat?.includes('豆豆') || c.key?.includes('dou')
      ) || [];
      
      console.log('\n豆豆相关配置:');
      doudouCategories.forEach(cat => {
        console.log(`  ${cat.cat} (${cat.key}):`, cat.box);
      });
    } else {
      console.log('❌ 未找到全局配置');
    }

    // 2. 检查 ocr_schemes 表
    console.log('\n=== 2. OCR方案表 ===');
    const [schemes] = await pool.query(
      'SELECT id, name, user_phone, image_width, image_height, created_at FROM ocr_schemes ORDER BY id'
    );
    console.log('方案数量:', schemes.length);
    schemes.forEach(s => {
      console.log(`  [${s.id}] ${s.name} - ${s.user_phone || '全局'} (${s.image_width}x${s.image_height})`);
    });

    // 3. 检查最新方案的详细配置
    if (schemes.length > 0) {
      const latestScheme = schemes[schemes.length - 1];
      console.log(`\n=== 3. 最新方案"${latestScheme.name}"详细信息 ===`);
      const [schemeDetails] = await pool.query(
        'SELECT * FROM ocr_schemes WHERE id = ?',
        [latestScheme.id]
      );
      if (schemeDetails.length > 0) {
        const detail = schemeDetails[0];
        const boxes = JSON.parse(detail.boxes);
        const slots = JSON.parse(detail.test_alliance_slots);
        
        console.log('图片尺寸:', detail.image_width, 'x', detail.image_height);
        console.log('boxes数量:', boxes.length);
        console.log('测试同盟槽位:', slots);
        
        // 显示前15个box（包含豆豆相关的）
        console.log('\n前15个识别框:');
        boxes.slice(0, 15).forEach((box, idx) => {
          console.log(`  [${idx}] rx1:${box.rx1.toFixed(3)} ry1:${box.ry1.toFixed(3)} rx2:${box.rx2.toFixed(3)} ry2:${box.ry2.toFixed(3)}`);
        });
      }
    }

    await pool.end();
  } catch (err) {
    console.error('错误:', err);
  }
}

checkOCRConfig();
