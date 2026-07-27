const mysql = require('mysql2/promise');

async function checkOcrActualUsage() {
  const pool = mysql.createPool({
    host: 'localhost',
    port: 3306,
    user: 'nslg-battle-server',
    password: 'hu6956521',
    database: 'nslg_battle',
    charset: 'utf8mb4'
  });

  try {
    console.log('=== 检查OCR实际使用的配置 ===\n');

    // 1. 检查最近的识别记录使用的项目
    console.log('1. 最近识别记录的项目归属：');
    const [recentRecords] = await pool.query(`
      SELECT
        id,
        project_id,
        attacker_name,
        enemy_name,
        left_general_1_stars,
        left_general_2_stars,
        left_general_3_stars,
        created_at
      FROM battle_records
      ORDER BY id DESC
      LIMIT 10
    `);

    recentRecords.forEach(r => {
      const projectInfo = r.project_id ? `项目${r.project_id}` : '无项目';
      const stars = `豆豆: L1=${r.left_general_1_stars || 0}, L2=${r.left_general_2_stars || 0}, L3=${r.left_general_3_stars || 0}`;
      console.log(`  战报${r.id} (${projectInfo}): ${r.attacker_name} vs ${r.enemy_name}`);
      console.log(`    ${stars}, 时间:${r.created_at}`);
    });

    // 2. 检查哪些项目有专属配置
    console.log('\n2. 各项目的配置情况：');
    const [configs] = await pool.query(`
      SELECT project_id, CHAR_LENGTH(categories_json) as size
      FROM label_configs
      ORDER BY project_id
    `);

    configs.forEach(cfg => {
      console.log(`  项目 ${cfg.project_id === 0 ? '全局(0)' : cfg.project_id}: 配置大小 ${cfg.size} 字符`);
    });

    // 3. 分析配置使用逻辑
    console.log('\n3. OCR配置使用逻辑分析：');
    console.log('  根据代码 nslg-backend.js:2088-2099 _getLabelConfigForProject():');
    console.log('    ① 优先查询项目专属配置 (project_id = 实际项目ID)');
    console.log('    ② 如果没有，则查询全局配置 (project_id = 0)');
    console.log('    ③ 如果都没有，返回 null (使用自动检测)');
    console.log('');

    // 4. 模拟每个最近记录的配置查询
    console.log('4. 模拟最近记录实际使用的配置：');
    for (const r of recentRecords.slice(0, 5)) {
      const pid = r.project_id || 0;

      // 先查项目配置
      const [projectConfig] = await pool.query(
        'SELECT project_id, CHAR_LENGTH(categories_json) as size FROM label_configs WHERE project_id = ? LIMIT 1',
        [pid]
      );

      // 如果没有且不是全局，查全局配置
      let usedConfig = null;
      if (projectConfig.length > 0) {
        usedConfig = { source: '项目专属配置', project_id: projectConfig[0].project_id, size: projectConfig[0].size };
      } else if (pid !== 0) {
        const [globalConfig] = await pool.query(
          'SELECT project_id, CHAR_LENGTH(categories_json) as size FROM label_configs WHERE project_id = 0 LIMIT 1'
        );
        if (globalConfig.length > 0) {
          usedConfig = { source: '全局配置(回退)', project_id: globalConfig[0].project_id, size: globalConfig[0].size };
        }
      }

      if (usedConfig) {
        console.log(`  战报${r.id} (项目${pid || '无'}): 使用 ${usedConfig.source} (${usedConfig.size}字符)`);
      } else {
        console.log(`  战报${r.id} (项目${pid || '无'}): ⚠️ 未找到配置，使用自动检测`);
      }
    }

    // 5. 测试接口配置获取
    console.log('\n5. 前端测试接口配置来源：');
    console.log('  前端测试时 (ocr-system.js:47-64):');
    console.log('    - 调用 getLabelConfig(projectId)');
    console.log('    - 请求 /api/label-config/{projectId}');
    console.log('    - 后端返回该项目配置，没有则返回全局配置');
    console.log('');
    console.log('  ⚠️ 关键问题：');
    console.log('    如果测试时没有选择项目或项目ID为null：');
    console.log('      → projectId = 0 → 直接查全局配置');
    console.log('    如果测试时选择了某个项目且该项目有专属配置：');
    console.log('      → 使用项目专属配置，不会用全局配置');

    console.log('\n6. 可能导致识别结果不同的原因：');
    console.log('  ✓ 之前测试时使用的配置 vs 现在测试使用的配置不同');
    console.log('  ✓ 项目专属配置与全局配置内容不一致');
    console.log('  ✓ 测试时选择的项目不同');
    console.log('  ✓ 数据库配置最近被修改过');

  } catch (error) {
    console.error('检查失败:', error.message);
  } finally {
    await pool.end();
  }
}

checkOcrActualUsage();
