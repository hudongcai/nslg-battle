// 查看项目和OCR模板的关联关系
const mysql = require('mysql2/promise');

async function checkProjectTemplates() {
  const pool = mysql.createPool({
    host: 'localhost',
    user: 'nslg-battle-server',
    password: 'hu6956521',
    database: 'nslg_battle',
    charset: 'utf8mb4'
  });

  try {
    console.log('\n========================================');
    console.log('📐 项目与OCR模板关联查询');
    console.log('========================================\n');

    // 如果命令行提供了项目ID，只查询该项目
    const targetProjectId = process.argv[2];

    if (targetProjectId) {
      // 查询指定项目
      const [projects] = await pool.query('SELECT id, name FROM projects WHERE id = ? LIMIT 1', [targetProjectId]);

      if (projects.length === 0) {
        console.log('❌ 未找到项目ID:', targetProjectId);
        return;
      }

      await displayProjectTemplate(pool, projects[0]);
    } else {
      // 查询所有项目
      console.log('💡 提示：运行 node 查看项目模板关联.js <项目ID> 可查看指定项目\n');

      const [projects] = await pool.query('SELECT id, name FROM projects ORDER BY created_at DESC LIMIT 20');

      for (const p of projects) {
        await displayProjectTemplate(pool, p);
        console.log('');
      }
    }

    // 显示全局默认模板
    console.log('----------------------------------------');
    console.log('🌐 全局默认模板:');
    const [global] = await pool.query('SELECT id, image_width, image_height, created_at FROM label_configs WHERE project_id = 0 LIMIT 1');
    if (global.length > 0) {
      console.log('   配置ID:', global[0].id);
      console.log('   图片尺寸:', global[0].image_width + 'x' + global[0].image_height);
      console.log('   创建时间:', global[0].created_at);
    } else {
      console.log('   ❌ 未配置全局模板');
    }
    console.log('');

  } finally {
    await pool.end();
  }
}

async function displayProjectTemplate(pool, project) {
  // 查询项目专用模板
  let [config] = await pool.query(
    'SELECT id, project_id, image_width, image_height, created_at FROM label_configs WHERE project_id = ? LIMIT 1',
    [project.id]
  );

  console.log('📁 项目:', project.name);
  console.log('   项目ID:', project.id);

  if (config.length > 0) {
    console.log('   ✅ 使用: 项目专用模板');
    console.log('   配置ID:', config[0].id);
    console.log('   图片尺寸:', config[0].image_width + 'x' + config[0].image_height);
    console.log('   创建时间:', config[0].created_at);
  } else {
    // 查询全局模板
    [config] = await pool.query('SELECT id, image_width, image_height FROM label_configs WHERE project_id = 0 LIMIT 1');
    if (config.length > 0) {
      console.log('   ⚪ 使用: 全局默认模板 (project_id=0)');
      console.log('   配置ID:', config[0].id);
      console.log('   图片尺寸:', config[0].image_width + 'x' + config[0].image_height);
    } else {
      console.log('   ❌ 无可用模板');
    }
  }
}

checkProjectTemplates().catch(console.error);
