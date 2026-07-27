const mysql = require('mysql2/promise');

async function checkDoudou() {
  const pool = mysql.createPool({
    host: 'localhost',
    user: 'nslg-battle-server',
    password: 'hu6956521',
    database: 'nslg_battle',
    charset: 'utf8mb4'
  });

  try {
    console.log('=== 检查豆豆配置 ===\n');
    
    // 获取项目2的配置（从样本数据看project_id=2有配置）
    const [rows] = await pool.query(
      'SELECT * FROM label_configs WHERE project_id = 2 LIMIT 1'
    );
    
    if (rows.length > 0) {
      const config = JSON.parse(rows[0].categories_json);
      console.log('项目ID:', rows[0].project_id);
      console.log('图片尺寸:', rows[0].image_width, 'x', rows[0].image_height);
      console.log('\n豆豆配置 (stars):');
      
      if (config.stars && config.stars.boxes) {
        console.log('豆豆名称:', config.stars.name);
        console.log('豆豆框数量:', config.stars.boxes.length);
        console.log('\n所有豆豆框:');
        config.stars.boxes.forEach((box, idx) => {
          console.log(`  [${idx}] ${box.label} (${box.key}): rx1=${box.rx1.toFixed(4)} ry1=${box.ry1.toFixed(4)} rx2=${box.rx2.toFixed(4)} ry2=${box.ry2.toFixed(4)}`);
        });
        
        // 特别检查L2（左2）
        const l2Box = config.stars.boxes.find(b => b.key === 'L2');
        if (l2Box) {
          console.log('\n【重点】我方豆豆2 (L2) 配置:');
          console.log('  相对坐标:', `rx1=${l2Box.rx1} ry1=${l2Box.ry1} rx2=${l2Box.rx2} ry2=${l2Box.ry2}`);
          console.log('  绝对坐标:', `x1=${l2Box.x1} y1=${l2Box.y1} x2=${l2Box.x2} y2=${l2Box.y2}`);
        }
      }
    } else {
      console.log('未找到配置');
    }
    
    await pool.end();
  } catch (err) {
    console.error('错误:', err);
  }
}

checkDoudou();
