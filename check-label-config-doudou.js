const mysql = require('mysql2/promise');

async function checkDoudouConfig() {
  const pool = mysql.createPool({
    host: 'localhost',
    user: 'nslg-battle-server',
    password: 'hu6956521',
    database: 'nslg_battle',
    charset: 'utf8mb4'
  });

  try {
    console.log('=== 检查豆豆识别配置 ===\n');
    
    // 1. 检查全局 label_configs
    console.log('1. 检查全局label_configs表:');
    const [configs] = await pool.query(
      'SELECT project_id, label_config FROM label_configs WHERE project_id IS NULL LIMIT 1'
    );
    
    if (configs.length > 0) {
      const config = JSON.parse(configs[0].label_config);
      console.log('   找到全局配置，categories数量:', config.categories?.length || 0);
      
      // 查找豆豆相关配置
      if (config.categories) {
        const doudouCats = config.categories.filter((c, idx) => {
          return c.cat?.includes('豆豆') || c.key?.toLowerCase().includes('dou') || idx >= 8 && idx <= 13;
        });
        
        console.log('\n   豆豆相关配置 (索引8-13通常是豆豆区域):');
        doudouCats.forEach((cat, idx) => {
          const actualIdx = config.categories.indexOf(cat);
          console.log(`   [${actualIdx}] ${cat.cat} (${cat.key}):`, cat.box);
        });
      }
    } else {
      console.log('   ❌ 未找到全局配置');
    }
    
    // 2. 检查项目绑定的配置
    console.log('\n2. 检查项目绑定配置:');
    const [projects] = await pool.query(
      'SELECT id, name FROM projects ORDER BY id LIMIT 5'
    );
    
    for (const proj of projects) {
      const [projConfigs] = await pool.query(
        'SELECT label_config FROM label_configs WHERE project_id = ?',
        [proj.id]
      );
      
      if (projConfigs.length > 0) {
        const config = JSON.parse(projConfigs[0].label_config);
        console.log(`   项目[${proj.id}] ${proj.name}: ${config.categories?.length || 0}个categories`);
        
        // 显示豆豆配置
        if (config.categories) {
          const doudouCats = config.categories.filter(c => 
            c.cat?.includes('豆豆') || c.key?.toLowerCase().includes('dou')
          );
          if (doudouCats.length > 0) {
            doudouCats.forEach(cat => {
              console.log(`      - ${cat.cat}: ${JSON.stringify(cat.box)}`);
            });
          }
        }
      }
    }
    
    await pool.end();
  } catch (err) {
    console.error('错误:', err.message);
  }
}

checkDoudouConfig();
