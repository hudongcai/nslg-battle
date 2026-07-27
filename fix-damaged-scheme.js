const mysql = require('mysql2/promise');

async function fixScheme() {
  const pool = mysql.createPool({
    host: 'localhost',
    user: 'nslg-battle-server',
    password: 'hu6956521',
    database: 'nslg_battle',
    charset: 'utf8mb4'
  });

  try {
    console.log('=== 从label_configs获取正确配置并修复方案 ===\n');
    
    // 1. 从label_configs获取project_id=2的配置（之前确认有正确数据）
    const [configs] = await pool.query(
      'SELECT * FROM label_configs WHERE project_id = 2 LIMIT 1'
    );
    
    if (configs.length === 0) {
      console.log('❌ 未找到project_id=2的配置');
      await pool.end();
      return;
    }
    
    const config = configs[0];
    const categoriesJson = JSON.parse(config.categories_json);
    
    console.log('从label_configs读取配置:');
    console.log('  图片尺寸:', config.image_width, 'x', config.image_height);
    console.log('  stars配置存在:', !!categoriesJson.stars);
    
    if (categoriesJson.stars && categoriesJson.stars.boxes) {
      console.log('  豆豆框数量:', categoriesJson.stars.boxes.length);
      
      // 2. 构建正确的boxes数组（按照LE_BOX_DEFS的顺序）
      const boxes = [];
      
      // 这是前端LE_BOX_DEFS中豆豆的索引位置（8-13）
      const doudouKeys = ['L1', 'L2', 'L3', 'R1', 'R2', 'R3'];
      
      // 填充前8个框（假设为空或默认值）
      for (let i = 0; i < 8; i++) {
        boxes.push({ rx1: 0, ry1: 0, rx2: 0.1, ry2: 0.1 });
      }
      
      // 填充豆豆框（索引8-13）
      doudouKeys.forEach(key => {
        const box = categoriesJson.stars.boxes.find(b => b.key === key);
        if (box) {
          boxes.push({
            rx1: box.rx1,
            ry1: box.ry1,
            rx2: box.rx2,
            ry2: box.ry2
          });
        } else {
          boxes.push({ rx1: 0, ry1: 0, rx2: 0.1, ry2: 0.1 });
        }
      });
      
      console.log('\n构建的boxes数组长度:', boxes.length);
      console.log('豆豆L2的坐标:', boxes[9]);  // L2在索引9
      
      // 3. 更新数据库
      await pool.query(
        `UPDATE ocr_schemes 
         SET image_width = ?, 
             image_height = ?, 
             boxes = ?,
             updated_at = CURRENT_TIMESTAMP
         WHERE name = ?`,
        [
          config.image_width,
          config.image_height,
          JSON.stringify(boxes),
          '数据库全局配置'
        ]
      );
      
      console.log('\n✅ 方案"数据库全局配置"已修复');
      
      // 4. 验证
      const [updated] = await pool.query(
        'SELECT boxes FROM ocr_schemes WHERE name = ?',
        ['数据库全局配置']
      );
      
      const parsedBoxes = JSON.parse(updated[0].boxes);
      console.log('验证: boxes数组长度=', parsedBoxes.length);
      console.log('验证: L2坐标=', parsedBoxes[9]);
    }
    
    await pool.end();
  } catch (err) {
    console.error('错误:', err);
    process.exit(1);
  }
}

fixScheme();
