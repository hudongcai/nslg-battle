const mysql = require('mysql2/promise');

async function checkAndFix() {
  const pool = mysql.createPool({
    host: 'localhost',
    port: 3306,
    user: 'nslg-battle-server',
    password: 'hu6956521',
    database: 'nslg_battle',
    charset: 'utf8mb4'
  });

  try {
    console.log('=== OCR配置方案完整诊断 ===\n');

    // 1. 查看全局配置的完整内容
    console.log('1. 全局配置内容（project_id=0）：');
    const [globalConfig] = await pool.query(
      'SELECT * FROM label_configs WHERE project_id = 0 LIMIT 1'
    );

    if (globalConfig.length === 0) {
      console.log('  ❌ 没有全局配置！');
      console.log('  需要在前端「系统配置 → OCR采集模板设置」中创建并绑定全局配置');
    } else {
      const cfg = globalConfig[0];
      console.log(`  ✅ 全局配置存在`);
      console.log(`  - ID: ${cfg.id}`);
      console.log(`  - 图片尺寸: ${cfg.image_width} x ${cfg.image_height}`);
      console.log(`  - 配置大小: ${cfg.categories_json ? cfg.categories_json.length : 0} 字符`);
      console.log(`  - 更新时间: ${cfg.updated_at}`);

      try {
        const categories = JSON.parse(cfg.categories_json || '{}');
        const categoryKeys = Object.keys(categories);
        console.log(`  - 包含字段: ${categoryKeys.join(', ')}`);

        console.log('\n  详细配置区域数量：');
        categoryKeys.forEach(key => {
          const boxes = categories[key]?.boxes || [];
          console.log(`    - ${key}: ${boxes.length} 个区域`);
        });
      } catch (e) {
        console.log(`  ⚠️ 配置JSON解析失败: ${e.message}`);
      }
    }

    // 2. 检查所有项目配置
    console.log('\n2. 所有项目的配置：');
    const [allConfigs] = await pool.query(
      'SELECT project_id, CHAR_LENGTH(categories_json) as size, updated_at FROM label_configs ORDER BY project_id'
    );

    allConfigs.forEach(cfg => {
      console.log(`  - 项目 ${cfg.project_id === 0 ? '全局' : cfg.project_id}: ${cfg.size}字符, 更新于 ${cfg.updated_at}`);
    });

    // 3. 检查最近是否有OCR任务
    console.log('\n3. 最近的OCR识别记录：');
    const [recentBattles] = await pool.query(`
      SELECT id, attacker_name, enemy_name, created_at
      FROM battle_records
      WHERE created_by IS NOT NULL
      ORDER BY id DESC
      LIMIT 5
    `);

    if (recentBattles.length === 0) {
      console.log('  ⚠️ 没有任何OCR识别记录');
    } else {
      recentBattles.forEach(b => {
        console.log(`  - 战报${b.id}: ${b.attacker_name} vs ${b.enemy_name}, 时间:${b.created_at}`);
      });
    }

    // 4. 给出解决方案
    console.log('\n4. 解决方案：');
    console.log('');
    console.log('【方案下拉菜单看不到的问题】');
    console.log('  原因：方案存储在浏览器 localStorage，换环境后数据丢失');
    console.log('  解决：');
    console.log('    方法A: 在新环境中点击「📥 导入方案」，从旧环境导出的JSON文件导入');
    console.log('    方法B: 点击「🔄 从数据库还原」，将数据库中实际生效的配置还原为方案');
    console.log('    方法C: 重新配置一次（如果配置简单）');
    console.log('');
    console.log('【是否使用全局配置】');
    if (globalConfig.length > 0) {
      console.log('  ✅ 已实现全局配置功能');
      console.log('  ✅ OCR识别时会自动使用全局配置（如果项目没有专属配置）');
      console.log('  ✅ 数据库中已有全局配置');
      console.log('');
      console.log('  当前架构：');
      console.log('    1. 前端：方案管理界面（localStorage存储方案列表）');
      console.log('    2. 数据库：label_configs表（存储实际生效的配置）');
      console.log('    3. OCR识别：从数据库读取配置，优先项目配置，无则用全局配置');
      console.log('');
      console.log('  工作流程：');
      console.log('    ① 在前端创建/编辑方案（存localStorage）');
      console.log('    ② 点击「绑定生效」将方案写入数据库');
      console.log('    ③ OCR识别时从数据库读取配置使用');
    } else {
      console.log('  ❌ 数据库中没有全局配置');
      console.log('  需要操作：');
      console.log('    1. 登录系统，进入「系统配置 → OCR采集模板设置」');
      console.log('    2. 选择「所需引用方案的项目」为「全局配置」');
      console.log('    3. 创建或选择一个方案');
      console.log('    4. 点击「绑定生效」');
    }

  } catch (error) {
    console.error('诊断失败:', error.message);
  } finally {
    await pool.end();
  }
}

checkAndFix();
